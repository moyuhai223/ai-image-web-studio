import { NextResponse } from "next/server";
import { authenticateApiKey, buildSignedImageUrl, invalidApiKeyResponse, openAiError } from "@/lib/api-key-auth";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { enqueueGenerationJob } from "@/lib/generation-queue";
import { createTextGenerationJobs, QuotaExceededError } from "@/lib/generation-intake";
import { normalizeImageSize } from "@/lib/image-size";
import { getDefaultGroupId, listGroupModelOptions, listDistinctModelValues } from "@/lib/model-groups";
import { requestBodyTooLarge } from "@/lib/request-guard";
import { readStoredFile } from "@/lib/storage";
import { openAiImagesGenerationsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const POLL_DEADLINE_MS = 280_000; // 留 ~20s 余量给读文件/编码,配合 maxDuration=300
const POLL_INTERVAL_MS = 2_000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled", "interrupted", "upstream_error"]);

/**
 * OpenAI 兼容:POST /v1/images/generations——同步生图。
 * bearer 鉴权 → 配额闸(与网页同一把 per-user advisory lock)→ 建任务入队 → 请求内轮询到终态。
 * 成功返回 {created, data:[{b64_json}|{url}]};超时 504(任务留在后台跑,可在网页记录里看)。
 */
export async function POST(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth) return invalidApiKeyResponse();
  if (requestBodyTooLarge(request, 1024 * 1024)) {
    return openAiError(413, "请求体过大", "payload_too_large");
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = openAiImagesGenerationsSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return openAiError(400, parsed.error.issues[0]?.message ?? "参数无效", "invalid_parameters");
  }

  // 模型解析:必须命中已配置的模型组模型;列表为空(env-only 部署)放行透传;
  // 缺省取默认组首个模型,env-only 部署缺省回退 config.imageModelGpt(与网页端行为对齐)
  const available = await listDistinctModelValues();
  let model = parsed.data.model ?? "";
  if (!model) {
    const defaultGroupId = await getDefaultGroupId();
    const options = await listGroupModelOptions();
    model = options.find((o) => o.groupId === defaultGroupId)?.model ?? options[0]?.model ?? "";
    if (!model && available.length === 0) model = config.imageModelGpt;
    if (!model) {
      return openAiError(404, "未指定 model 且站点未配置默认模型组,请传入 model 参数(见 GET /v1/models)", "model_not_found");
    }
  } else if (available.length > 0 && !available.some((m) => m.value === model)) {
    return openAiError(404, `模型 '${model}' 不存在,可用模型见 GET /v1/models`, "model_not_found");
  }

  const count = Math.min(4, Math.max(1, Math.trunc(parsed.data.n ?? 1)));
  const size = normalizeImageSize(parsed.data.size);

  let jobs;
  try {
    const created = await createTextGenerationJobs({
      user: auth.user,
      model,
      prompt: parsed.data.prompt,
      size,
      count,
      extraMetadata: {
        source: "api",
        apiKeyId: auth.keyId,
        ...(parsed.data.user ? { apiUser: parsed.data.user.slice(0, 256) } : {})
      }
    });
    jobs = created.jobs;
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      if (error.kind === "queue_full") {
        const response = openAiError(429, error.message, "queue_full", "rate_limit_error");
        response.headers.set("retry-after", "30");
        return response;
      }
      return openAiError(429, error.message, "daily_limit_exceeded", "insufficient_quota");
    }
    throw error;
  }

  for (const job of jobs) enqueueGenerationJob(job.id);

  // —— 同步等待:轮询任务状态到全部终态或超时 ——
  const jobIds = jobs.map((job) => job.id);
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let rows: Array<{ id: string; status: string; error_message: string | null }> = [];
  for (;;) {
    rows = (
      await query<{ id: string; status: string; error_message: string | null }>(
        `select id, status, error_message from generation_jobs where id = any($1::uuid[])`,
        [jobIds]
      )
    ).rows;
    // rows 短于 jobIds = 有任务在等待期间被删除(网页记录里删掉),缺失行视为终态,立即结算
    if (rows.every((row) => TERMINAL_STATUSES.has(row.status))) break;
    if (Date.now() > deadline) {
      return openAiError(
        504,
        `生成超时(${Math.round(POLL_DEADLINE_MS / 1000)}s):任务仍在后台继续,可登录网页在「记录」中查看结果。任务 ID: ${jobIds.join(", ")}`,
        "generation_timeout",
        "timeout_error"
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const succeededIds = rows.filter((row) => row.status === "succeeded").map((row) => row.id);
  if (succeededIds.length === 0) {
    const firstError = rows.find((row) => row.error_message)?.error_message ?? "生成失败";
    return openAiError(500, firstError, "generation_failed", "server_error");
  }

  // 部分成功返回部分结果(data 可短于 n):同步等待已花完成本,丢弃已产出的图对调用方最差
  const images = (
    await query<{ id: string; local_path: string; mime_type: string }>(
      `select id, local_path, mime_type from generated_images
       where job_id = any($1::uuid[])
       order by created_at asc, sort_order asc`,
      [succeededIds]
    )
  ).rows;
  if (images.length === 0) {
    return openAiError(500, "生成完成但未找到图片文件", "generation_failed", "server_error");
  }

  const origin = config.appOrigin || new URL(request.url).origin;
  const data =
    parsed.data.response_format === "url"
      ? images.map((img) => ({ url: buildSignedImageUrl(origin, img.id) }))
      : await Promise.all(
          images.map(async (img) => ({
            b64_json: (await readStoredFile(img.local_path)).buffer.toString("base64")
          }))
        );

  return NextResponse.json({ created: Math.floor(Date.now() / 1000), data });
}
