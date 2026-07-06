import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { tryAcquire } from "@/lib/concurrency";
import { query, transaction } from "@/lib/db";
import { enqueueGenerationJob } from "@/lib/generation-queue";
import { createJob, getActiveQueueStats, getImageForUser, getJobById } from "@/lib/repository";
import { readStoredFile, saveImageBuffer } from "@/lib/storage";
import { computeUpscaleSize } from "@/lib/image-size";
import { upscaleBufferToLongEdge } from "@/lib/upscale";
import { getDailyGenerationLimit } from "@/lib/usage-limits";
import { upscaleSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const AI_UPSCALE_PROMPT =
  "在不改变画面内容、构图、主体、色彩和风格的前提下,将这张图片高清化:增强细节与清晰度、去除模糊与噪点、提升纹理质感,输出更高分辨率的同一张图。不要添加、删除或改动任何元素。";

async function dailyLimitExceeded(userId: string): Promise<number | false> {
  const limit = await getDailyGenerationLimit();
  if (limit <= 0) return false;
  const daily = await query<{ count: string }>(
    `select count(*)::text as count from generation_jobs where user_id = $1 and created_at >= current_date`,
    [userId]
  );
  return Number(daily.rows[0]?.count ?? 0) + 1 > limit ? limit : false;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;

  const parsed = upscaleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }
  const { mode } = parsed.data;

  const source = await getImageForUser(id, user);
  if (!source) {
    return NextResponse.json({ error: "图片不存在或无权访问" }, { status: 404 });
  }

  const exceededLimit = await dailyLimitExceeded(user.id);
  if (exceededLimit !== false) {
    return NextResponse.json({ error: `今日生成次数已达上限（${exceededLimit} 次）` }, { status: 429 });
  }

  const targetLongEdge = config.upscaleLongEdge;

  // ---- 快速放大(sharp):同步完成,直接建一条 succeeded 任务 + 子版本图 ----
  // 并发闸:fast 分支在请求线程内同步跑 sharp(CPU/内存重活),不走生成队列。
  // 若不限并发,单用户反复打此端点即可耗尽 CPU/内存(DoS)。用信号量限到与生成同样的并发上限,
  // 满了直接 429(快速失败,不排队占连接)。
  if (mode === "fast") {
    const release = tryAcquire("fast-upscale", config.maxGenerationConcurrency);
    if (!release) {
      return NextResponse.json(
        { error: "高清化服务繁忙,请稍后再试", code: "upscale_busy", retryAfterSeconds: 5 },
        { status: 429, headers: { "retry-after": "5" } }
      );
    }
    try {
      const file = await readStoredFile(source.local_path);
      const upscaled = await upscaleBufferToLongEdge(file.buffer, targetLongEdge);
      const stored = await saveImageBuffer(upscaled.buffer, upscaled.mimeType, "images", `${source.job_id}-up`);
      const now = new Date().toISOString();

      const job = await transaction(async (client) => {
      const created = await createJob(client, {
        user_id: user.id,
        model: "upscale-fast",
        prompt: `高清化（快速放大 ${upscaled.width}×${upscaled.height}）`,
        size: `${upscaled.width}x${upscaled.height}`,
        count: 1,
        status: "succeeded",
        request_metadata: {
          upscale: { mode: "fast", sourceImageId: source.id, targetLongEdge },
          progress: {
            phase: "succeeded",
            current: 1,
            total: 1,
            percent: 100,
            message: "高清化完成",
            updatedAt: now
          }
        }
      });
      await client.query(
        `insert into generated_images
           (job_id, parent_image_id, local_path, mime_type, width, height, byte_size, checksum, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
        [created.id, source.id, stored.relativePath, stored.mimeType, stored.width, stored.height, stored.byteSize, stored.checksum]
      );
      await client.query(
        `update generation_jobs set completed_at = now(), duration_ms = 0, updated_at = now() where id = $1`,
        [created.id]
      );
      return created;
    });

      const full = await getJobById(job.id, user);
      return NextResponse.json({ job: full, mode: "fast" }, { status: 201 });
    } finally {
      release();
    }
  }

  // ---- AI 高清重绘:走队列,以源图为参考做编辑重绘,runner 存盘前 sharp 收尾到 4K ----
  const queueStats = await getActiveQueueStats(user);
  if (queueStats.queued + queueStats.running + 1 > config.maxGenerationQueueSize) {
    return NextResponse.json(
      {
        error: `当前队列已满(排队 ${queueStats.queued} / 进行中 ${queueStats.running} / 上限 ${config.maxGenerationQueueSize}),请稍后再试`,
        code: "queue_full",
        retryAfterSeconds: 30
      },
      { status: 429, headers: { "retry-after": "30" } }
    );
  }

  const sourceJob = await query<{ model: string; groupId: string | null }>(
    `select model, request_metadata #>> '{providerGroupId}' as "groupId"
     from generation_jobs where id = $1`,
    [source.job_id]
  );
  const srcModel = sourceJob.rows[0]?.model ?? "";
  const model = srcModel && !srcModel.startsWith("upscale") ? srcModel : config.imageModelGpt;
  const groupId = sourceJob.rows[0]?.groupId ?? null;

  // 直接请求模型原生 4K(按源图比例算尺寸,满足 gpt-image-2 约束:长边≤3840、/16、像素预算);
  // 模型支持则原生出 4K,代理/模型不支持时由 runner 的 ensureLongEdge sharp 兜底到同一长边。
  const size =
    source.width && source.height
      ? computeUpscaleSize(source.width, source.height, targetLongEdge)
      : "2880x2880";
  const computedLongEdge = (() => {
    const [tw, th] = size.split("x").map((n) => Number(n));
    return Math.max(tw || targetLongEdge, th || targetLongEdge);
  })();

  const reference = {
    source: "generated" as const,
    sourceImageId: source.id,
    localPath: source.local_path,
    mimeType: source.mime_type,
    byteSize: source.byte_size
  };
  const now = new Date().toISOString();

  const job = await transaction(async (client) =>
    createJob(client, {
      user_id: user.id,
      model,
      prompt: AI_UPSCALE_PROMPT,
      size,
      count: 1,
      status: "queued",
      request_metadata: {
        size,
        count: 1,
        reference,
        references: [reference],
        providerGroupId: groupId,
        upscale: { mode: "ai", sourceImageId: source.id, targetLongEdge: computedLongEdge },
        progress: {
          phase: "queued",
          current: 0,
          total: 1,
          percent: 5,
          message: "高清重绘任务已进入后台队列",
          updatedAt: now
        }
      }
    })
  );

  enqueueGenerationJob(job.id);
  const full = await getJobById(job.id, user);
  return NextResponse.json({ job: full, mode: "ai" }, { status: 202 });
}
