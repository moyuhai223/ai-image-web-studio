import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { query } from "./db";
import { createLogger } from "./logger";
import { generateWithProvider } from "./provider";
import { formatProviderErrorInfo, mapProviderError } from "./provider-error-map";
import { deleteStoredImageFiles, imageSourceToBuffer, readStoredFile, saveImageBuffer } from "./storage";
import { ensureLongEdge } from "./upscale";
import type { GenerationJob, GenerationPhaseTimings, GenerationProgress } from "./types";

const log = createLogger("runner");

export type GenerationRunInput = {
  prompt: string;
  model: string;
  size: string;
  count: number;
  referenceDataUrl?: string;
  referenceDataUrls?: string[];
  /** 局部重绘蒙版 data URL(来自 request_metadata.mask),透传给 provider 编辑接口,作用于第一张参考图。 */
  maskDataUrl?: string;
  /** 来自 request_metadata.mask.composite;false 时 provider 跳过合成贴回,直接返回模型编辑图。 */
  maskComposite?: boolean;
  parentImageId?: string;
  /** 来自 request_metadata.providerPresetId;runner 透传给 provider 用于选 baseUrl + key */
  presetId?: string | null;
  /** 来自 request_metadata.upscale.targetLongEdge;非空时把模型输出存盘前 sharp 放大到该长边(AI 高清化收尾到 4K) */
  upscaleTargetLongEdge?: number;
  /** 来自 request_metadata.autoRetry.attempts;已自动重试的次数,用于判断是否还能再重试。 */
  autoRetryAttempts?: number;
};

type StoredJobInput = Pick<GenerationJob, "prompt" | "model" | "size" | "count" | "request_metadata">;

class JobCanceledError extends Error {
  constructor() {
    super("任务已取消或已重新排队");
    this.name = "JobCanceledError";
  }
}

function isJobCanceledError(error: unknown) {
  return error instanceof JobCanceledError;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "生成失败";
}

/**
 * 生成阶段失败时的统一文案。
 * 先把原始 message 喂给 mapProviderError —— 命中已知模式则展示更友好的中文文案,
 * 未命中则保留原 message,便于排查未知错误模式。
 */
function stageErrorMessage(stage: string, error: unknown) {
  const raw = errorMessage(error);
  const info = mapProviderError(raw);
  if (info) {
    return `${stage}失败：${formatProviderErrorInfo(info)}`;
  }
  return `${stage}失败：${raw}`;
}

function referenceCount(input: GenerationRunInput) {
  if (input.referenceDataUrls?.length) return input.referenceDataUrls.length;
  return input.referenceDataUrl ? 1 : 0;
}

function isGptImageModel(model: string) {
  return model === config.imageModelGpt || model.toLowerCase().startsWith("gpt-image");
}

function isNanoBananaModel(model: string) {
  return model === config.imageModelNano || model.toLowerCase().includes("banana");
}

function isGeminiImageModel(model: string) {
  return model === config.imageModelGemini || model.toLowerCase().includes("gemini");
}

function providerWaitingMessage(
  flowLabel: string,
  referenceTotal: number,
  current: number,
  total: number,
  providerName: string | null
) {
  const who = providerName ? `（Provider:${providerName}）` : "";
  return referenceTotal > 0
    ? `${flowLabel}请求已发送${who}，正在等待第 ${current}/${total} 张图片返回（参考图 ${referenceTotal} 张）`
    : `${flowLabel}请求已发送${who}，正在等待第 ${current}/${total} 张图片返回`;
}

function providerFlowLabel(input: GenerationRunInput, referenceTotal: number) {
  if (isGptImageModel(input.model)) {
    return referenceTotal > 0 ? "Image 2 编辑接口" : "Image 2 生成接口";
  }
  if (isNanoBananaModel(input.model)) {
    return referenceTotal > 0 ? "Banana 2 多模态编辑流程" : "Banana 2 多模态生成流程";
  }
  if (isGeminiImageModel(input.model)) {
    return referenceTotal > 0 ? "Gemini 多模态编辑流程" : "Gemini 多模态生成流程";
  }
  return referenceTotal > 0 ? "图片编辑流程" : "图片生成流程";
}

function sanitizeProviderMetadata(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return "[image data omitted]";
    if (value.length > 500) return `${value.slice(0, 500)}...[truncated ${value.length} chars]`;
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderMetadata(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (["b64_json", "image_url", "url"].includes(key) && typeof nested === "string" && nested.startsWith("data:image/")) {
        output[key] = "[image data omitted]";
      } else {
        output[key] = sanitizeProviderMetadata(nested);
      }
    }
    return output;
  }

  return value;
}

function progress(input: Omit<GenerationProgress, "updatedAt">): GenerationProgress {
  return {
    ...input,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 累加阶段计时(毫秒)。负值视为 0,小数四舍五入。
 */
function addPhaseTiming(timings: GenerationPhaseTimings, key: keyof GenerationPhaseTimings, deltaMs: number) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  const previous = timings[key] ?? 0;
  timings[key] = Math.round(previous + deltaMs);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function referenceToDataUrl(reference: Record<string, unknown>) {
  const localPath = typeof reference.localPath === "string" ? reference.localPath : "";
  const mimeType = typeof reference.mimeType === "string" ? reference.mimeType : "";
  const sourceImageId = typeof reference.sourceImageId === "string" ? reference.sourceImageId : undefined;
  if (!localPath || !mimeType) return { parentImageId: sourceImageId };

  const file = await readStoredFile(localPath);
  return {
    dataUrl: `data:${mimeType};base64,${file.buffer.toString("base64")}`,
    parentImageId: sourceImageId
  };
}

async function loadMaskDataUrl(requestMetadata: Record<string, unknown>): Promise<string | undefined> {
  const mask = asRecord(requestMetadata.mask);
  const localPath = typeof mask?.localPath === "string" ? mask.localPath : "";
  const mimeType = typeof mask?.mimeType === "string" ? mask.mimeType : "";
  if (!localPath || !mimeType) return undefined;
  const file = await readStoredFile(localPath);
  return `data:${mimeType};base64,${file.buffer.toString("base64")}`;
}

/** request_metadata.mask.composite;仅显式 false 才关(缺省/旧任务=开,保持既有行为)。 */
function loadMaskComposite(requestMetadata: Record<string, unknown>): boolean {
  const mask = asRecord(requestMetadata.mask);
  return mask?.composite !== false;
}

async function getReferenceInfo(requestMetadata: Record<string, unknown>) {
  const references = Array.isArray(requestMetadata.references)
    ? requestMetadata.references.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const legacyReference = asRecord(requestMetadata.reference);
  const orderedReferences = references.length > 0 ? references : legacyReference ? [legacyReference] : [];
  if (orderedReferences.length === 0) return {};

  const loaded = await Promise.all(orderedReferences.map(referenceToDataUrl));
  const referenceDataUrls = loaded.map((item) => item.dataUrl).filter((item): item is string => Boolean(item));
  const parentImageId = loaded.find((item) => item.parentImageId)?.parentImageId;

  return {
    referenceDataUrl: referenceDataUrls[0],
    referenceDataUrls,
    parentImageId
  };
}

async function loadGenerationInput(jobId: string): Promise<GenerationRunInput> {
  const result = await query<StoredJobInput>(
    `select prompt, model, size, count, request_metadata
     from generation_jobs
     where id = $1`,
    [jobId]
  );
  const job = result.rows[0];
  if (!job) {
    throw new Error("任务不存在");
  }
  const referenceInfo = await getReferenceInfo(job.request_metadata);
  const maskDataUrl = await loadMaskDataUrl(job.request_metadata);
  const maskComposite = loadMaskComposite(job.request_metadata);
  const presetId =
    typeof job.request_metadata?.providerPresetId === "string" && job.request_metadata.providerPresetId.trim()
      ? (job.request_metadata.providerPresetId as string)
      : null;

  const upscaleMeta = asRecord(job.request_metadata?.upscale);
  const upscaleTargetRaw = upscaleMeta ? Number(upscaleMeta.targetLongEdge) : NaN;
  const upscaleTargetLongEdge =
    Number.isFinite(upscaleTargetRaw) && upscaleTargetRaw > 0 ? Math.trunc(upscaleTargetRaw) : undefined;

  const autoRetryMeta = asRecord(job.request_metadata?.autoRetry);
  const autoRetryAttempts = autoRetryMeta ? Math.max(0, Math.trunc(Number(autoRetryMeta.attempts) || 0)) : 0;

  return {
    prompt: job.prompt,
    model: job.model,
    size: job.size,
    count: job.count,
    presetId,
    upscaleTargetLongEdge,
    autoRetryAttempts,
    maskDataUrl,
    maskComposite,
    ...referenceInfo
  };
}

async function updateProgress(jobId: string, runId: string, nextProgress: GenerationProgress) {
  const result = await query<{ id: string }>(
    `update generation_jobs
     set request_metadata = jsonb_set(request_metadata, '{progress}', $2::jsonb, true),
         updated_at = now()
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $3
     returning id`,
    [jobId, nextProgress, runId]
  );
  if (!result.rows[0]) throw new JobCanceledError();
}

async function markRunning(jobId: string, runId: string) {
  const result = await query<{ id: string }>(
    `update generation_jobs
     set status = 'running',
         started_at = coalesce(started_at, now()),
         completed_at = null,
         duration_ms = null,
         request_metadata = jsonb_set(
           request_metadata,
           '{control}',
           coalesce(request_metadata->'control', '{}'::jsonb) || jsonb_build_object('runId', $2, 'startedAt', now()::text),
           true
         ),
         updated_at = now()
     where id = $1 and status = 'running'
     returning id`,
    [jobId, runId]
  );
  if (!result.rows[0]) throw new JobCanceledError();
}

async function assertActiveRun(jobId: string, runId: string) {
  const result = await query<{ id: string }>(
    `select id
     from generation_jobs
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $2`,
    [jobId, runId]
  );
  if (!result.rows[0]) throw new JobCanceledError();
}

async function markSucceeded(
  jobId: string,
  runId: string,
  providerResults: Array<{
    requestId: string | null;
    keyId?: string | null;
    keyLabel?: string | null;
    keySource?: "pool" | "env";
    baseUrl?: string;
    presetId?: string | null;
    presetName?: string | null;
    images: unknown[];
    raw: Record<string, unknown>;
  }>,
  doneProgress: GenerationProgress
) {
  const result = await query<{ id: string }>(
    `update generation_jobs
     set status = 'succeeded',
         provider_request_id = $2,
         response_metadata = $3,
         request_metadata = jsonb_set(request_metadata, '{progress}', $4::jsonb, true),
         completed_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::integer),
         updated_at = now()
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $5
     returning id`,
    [
      jobId,
      providerResults.map((result) => result.requestId).filter(Boolean).join(",") || null,
      {
        requests: providerResults.map((result) => ({
          requestId: result.requestId,
          keyId: result.keyId ?? null,
          keyLabel: result.keyLabel ?? null,
          keySource: result.keySource ?? null,
          baseUrl: result.baseUrl ?? null,
          presetId: result.presetId ?? null,
          presetName: result.presetName ?? null,
          imageCount: result.images.length,
          raw: sanitizeProviderMetadata(result.raw)
        }))
      },
      doneProgress,
      runId
    ]
  );
  if (!result.rows[0]) throw new JobCanceledError();
}

/**
 * 把错误分类为 'upstream_error' 或 'failed'。
 * mapProviderError 返回 category === 'upstream' 时,使用更细的终态以便 UI 区分(请稍后重试 vs 检查输入)。
 */
function failureStatusForError(error: unknown): "failed" | "upstream_error" {
  const raw = errorMessage(error);
  const info = mapProviderError(raw);
  return info?.category === "upstream" ? "upstream_error" : "failed";
}

// 只有「瞬时」类错误才自动重试:上游 5xx/无图/auth_unavailable(upstream)、超时(timeout)、网络(network)。
// auth(key 无效)/quota(额度)/validation(输入非法)重试也不会好,不重试。
const RETRYABLE_ERROR_CATEGORIES = new Set(["upstream", "timeout", "network"]);
function isRetryableError(error: unknown): boolean {
  const info = mapProviderError(errorMessage(error));
  return info ? RETRYABLE_ERROR_CATEGORIES.has(info.category) : false;
}

// 退避后把任务从「保持 running 等待」翻回 queued 并重新入队;队列 watchdog/drain 会再领取。
async function requeueAfterAutoRetry(jobId: string, runId: string) {
  try {
    const queuedProgress = progress({
      phase: "queued",
      current: 0,
      total: 1,
      percent: 5,
      message: "已重新排队(自动重试)"
    });
    const res = await query<{ id: string }>(
      `update generation_jobs
       set status = 'queued',
           started_at = null,
           request_metadata = jsonb_set(request_metadata, '{progress}', $3::jsonb, true),
           updated_at = now()
       where id = $1
         and status = 'running'
         and request_metadata #>> '{control,runId}' = $2
       returning id`,
      [jobId, runId, queuedProgress]
    );
    if (res.rowCount === 0) return; // 已被取消/重排/接管,放弃
    // 动态 import 避免与 generation-queue 的静态循环依赖(queue 静态 import 本模块)。
    const { enqueueGenerationJob } = await import("./generation-queue");
    enqueueGenerationJob(jobId);
  } catch (error) {
    log.warn("Auto-retry requeue failed", { jobId, error });
  }
}

/**
 * 瞬时失败时安排自动重试:保持任务 running(不被领取)、attempt+1 写入 metadata,
 * 退避 base*attempt 毫秒后翻回 queued 重新入队。返回 true 表示已安排(调用方不要再 markFailed)。
 * 进程在退避中重启也安全:任务停在 running → 启动时 recoverInterruptedJobs 翻回 queued 重跑(attempt 已持久化)。
 */
async function maybeScheduleAutoRetry(
  jobId: string,
  runId: string,
  input: GenerationRunInput,
  error: unknown
): Promise<boolean> {
  const configuredMax = config.generationAutoRetryMax;
  if (configuredMax <= 0 || !isRetryableError(error)) return false;

  // 「无图」类(模型有响应但没图)常是内容策略拒绝等确定性失败——请求级已经把
  // 默认/b64/url 三种姿势都试过了,任务级再全额重试多半白烧额度。但实测上游断流
  // 也会以 200+错误体表现为"无图",所以保留 1 次机会而不是完全不重试。
  const NO_IMAGE_ERROR_RE = /provider returned no|did not contain an image/i;
  const maxRetries = NO_IMAGE_ERROR_RE.test(errorMessage(error)) ? Math.min(1, configuredMax) : configuredMax;

  const attempt = (input.autoRetryAttempts ?? 0) + 1;
  if (attempt > maxRetries) return false;

  const backoffMs = Math.min(60000, Math.max(1000, config.generationAutoRetryBackoffMs * attempt));
  const waitMessage = `上游失败,自动重试中(第 ${attempt}/${maxRetries} 次,约 ${Math.round(backoffMs / 1000)} 秒后)`;
  const retryProgress = progress({
    phase: "queued",
    current: 0,
    total: input.count,
    percent: 20,
    message: waitMessage
  });

  // firstRequestStartedAt 只在第一次安排重试时记录:作为超时 watchdog 的「总耗时」基准,
  // 让所有重试轮共享同一个 GENERATION_TIMEOUT_MS 预算,而不是每轮重置(避免最坏 N×15min)。
  const res = await query<{ id: string }>(
    `update generation_jobs
     set request_metadata = jsonb_set(
           jsonb_set(
             request_metadata,
             '{autoRetry}',
             coalesce(request_metadata->'autoRetry', '{}'::jsonb)
               || jsonb_build_object('attempts', $3::int)
               || case when request_metadata #>> '{autoRetry,firstRequestStartedAt}' is not null
                    then '{}'::jsonb
                    else jsonb_build_object(
                      'firstRequestStartedAt',
                      coalesce(nullif(request_metadata #>> '{progress,requestStartedAt}', ''), started_at::text, now()::text)
                    )
                  end,
             true
           ),
           '{progress}', $4::jsonb, true
         ),
         updated_at = now()
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $2
     returning id`,
    [jobId, runId, attempt, retryProgress]
  );
  if (res.rowCount === 0) return false; // 任务已取消/被接管,交给调用方(markFailed 也会 no-op)

  const timer = setTimeout(() => {
    void requeueAfterAutoRetry(jobId, runId);
  }, backoffMs);
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
  log.warn("Generation job scheduled for auto-retry", { jobId, attempt, maxRetries, backoffMs });
  return true;
}

async function markFailed(
  jobId: string,
  runId: string,
  input: GenerationRunInput,
  providerResults: unknown[],
  error: unknown,
  stage: string,
  phaseTimings: GenerationPhaseTimings,
  providerName: string | null
) {
  const raw = sanitizeProviderMetadata((error as Error & { raw?: unknown }).raw ?? null);
  const baseMessage = stageErrorMessage(stage, error);
  // 把实际使用的 Provider 带进失败文案,便于判断是哪家 Provider 的问题。
  const message = providerName ? `${baseMessage}（Provider:${providerName}）` : baseMessage;
  const status = failureStatusForError(error);
  const phaseLabel: GenerationProgress["phase"] = status === "upstream_error" ? "upstream_error" : "failed";
  const failedProgress = progress({
    phase: phaseLabel,
    current: providerResults.length,
    total: input.count,
    percent: providerResults.length > 0 ? Math.min(95, Math.round((providerResults.length / input.count) * 90)) : 35,
    message,
    phaseTimings: Object.keys(phaseTimings).length > 0 ? phaseTimings : undefined
  });

  await query(
    `update generation_jobs
     set status = $6,
         error_message = $2,
         response_metadata = $3,
         request_metadata = jsonb_set(request_metadata, '{progress}', $4::jsonb, true),
         completed_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::integer),
         updated_at = now()
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $5`,
    [jobId, message, raw, failedProgress, runId, status]
  );
}

async function markFailedBeforeInput(jobId: string, runId: string, error: unknown, stage: string) {
  const message = stageErrorMessage(stage, error);
  const status = failureStatusForError(error);
  const phaseLabel: GenerationProgress["phase"] = status === "upstream_error" ? "upstream_error" : "failed";
  const failedProgress = progress({
    phase: phaseLabel,
    current: 0,
    total: 1,
    percent: 35,
    message
  });

  await query(
    `update generation_jobs
     set status = $6,
         error_message = $2,
         response_metadata = $3,
         request_metadata = jsonb_set(request_metadata, '{progress}', $4::jsonb, true),
         completed_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::integer),
         updated_at = now()
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $5`,
    [jobId, message, sanitizeProviderMetadata((error as Error & { raw?: unknown }).raw ?? null), failedProgress, runId, status]
  );
}

export async function processGenerationJob(jobId: string, claimedRunId?: string) {
  let input: GenerationRunInput | null = null;
  const providerResults = [];
  const runId = claimedRunId ?? randomUUID();
  let failureStage = "读取任务参数";
  const phaseTimings: GenerationPhaseTimings = {};
  // 实际选中的 Provider 名(轮换/failover 时为最后一次尝试的那个),用于进度与失败消息显示。
  let selectedProviderName: string | null = null;

  try {
    if (!claimedRunId) {
      await markRunning(jobId, runId);
    } else {
      await assertActiveRun(jobId, runId);
    }

    await updateProgress(
      jobId,
      runId,
      progress({
        phase: "loading_references",
        current: 0,
        total: 1,
        percent: 8,
        message: "正在读取任务参数和参考图"
      })
    );
    failureStage = "读取任务参数和参考图";
    input = await loadGenerationInput(jobId);
    const totalReferences = referenceCount(input);
    failureStage = "提交模型前准备";
    await updateProgress(
      jobId,
      runId,
      progress({
        phase: "references_ready",
        current: 0,
        total: input.count,
        percent: 12,
        message: totalReferences > 0 ? `参考图已准备完成（${totalReferences} 张），准备提交模型` : "无参考图，准备提交模型",
        referenceCount: totalReferences
      })
    );

    for (let index = 0; index < input.count; index += 1) {
      const current = index + 1;
      const requestStartedAt = new Date().toISOString();
      const flowLabel = providerFlowLabel(input, totalReferences);
      failureStage = "提交模型请求";
      await updateProgress(
        jobId,
        runId,
        progress({
          phase: "submitting",
          current: index,
          total: input.count,
          percent: Math.min(90, 15 + Math.round((index / input.count) * 68)),
          message:
            totalReferences > 0
              ? `正在提交第 ${current}/${input.count} 张图片到${flowLabel}（参考图 ${totalReferences} 张）`
              : `正在提交第 ${current}/${input.count} 张图片到${flowLabel}`,
          referenceCount: totalReferences,
          requestStartedAt
        })
      );
      const inputCount = input.count;
      const emitRequesting = (providerName: string | null) =>
        updateProgress(
          jobId,
          runId,
          progress({
            phase: "requesting",
            current: index,
            total: inputCount,
            percent: Math.min(90, 15 + Math.round((index / inputCount) * 68)),
            message: providerWaitingMessage(flowLabel, totalReferences, current, inputCount, providerName),
            referenceCount: totalReferences,
            requestStartedAt
          })
        );
      await emitRequesting(null);
      failureStage = "等待模型返回";
      const upstreamStartedAt = performance.now();
      const providerResult = await generateWithProvider(
        { ...input, count: 1 },
        {
          presetId: input.presetId ?? null,
          // 选中(或 failover 切换到)某个 Provider 时,把进度消息更新为实际 Provider 名。
          onProviderSelected: (info) => {
            selectedProviderName = info.presetName;
            void emitRequesting(info.presetName);
          }
        }
      );
      addPhaseTiming(phaseTimings, "upstream_wait_ms", performance.now() - upstreamStartedAt);
      providerResults.push(providerResult);

      failureStage = "读取模型返回图片";
      await updateProgress(
        jobId,
        runId,
        progress({
          phase: "provider_returned",
          current: index,
          total: input.count,
          percent: Math.min(92, 22 + Math.round((index / input.count) * 68)),
          message: `模型已返回第 ${current}/${input.count} 张结果，准备读取图片`
        })
      );

      await updateProgress(
        jobId,
        runId,
        progress({
          phase: "downloading",
          current: index,
          total: input.count,
          percent: Math.min(93, 25 + Math.round((index / input.count) * 68)),
          message: `正在读取第 ${current}/${input.count} 张模型返回图片`
        })
      );

      for (const image of providerResult.images.slice(0, 1)) {
        await assertActiveRun(jobId, runId);
        const downloadDecodeStart = performance.now();
        const source = await imageSourceToBuffer(image);
        failureStage = "保存图片到本地";
        await updateProgress(
          jobId,
          runId,
          progress({
            phase: "saving",
            current: index,
            total: input.count,
            percent: Math.min(95, 22 + Math.round((index / input.count) * 70)),
            message: `正在保存第 ${current}/${input.count} 张到本地`,
            phaseTimings
          })
        );
        let outputBuffer: Buffer = source.buffer;
        let outputMime = source.mimeType;
        if (input.upscaleTargetLongEdge) {
          // AI 高清化的 4K 收尾(兜底):模型已原生出到目标长边则保留不动,
          // 仅当代理/模型没给够时才 sharp 放大,保证最终落 4K 像素。
          const upscaled = await ensureLongEdge(source.buffer, input.upscaleTargetLongEdge);
          if (upscaled) {
            outputBuffer = upscaled.buffer;
            outputMime = upscaled.mimeType;
          }
        }
        const stored = await saveImageBuffer(outputBuffer, outputMime, "images", `${jobId}-${index + 1}`);
        addPhaseTiming(phaseTimings, "download_decode_ms", performance.now() - downloadDecodeStart);
        try {
          failureStage = "写入图片记录";
          await assertActiveRun(jobId, runId);
          const dbInsertStart = performance.now();
          await query(
            `insert into generated_images
               (job_id, parent_image_id, local_path, mime_type, width, height, byte_size, checksum, sort_order)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              jobId,
              input.parentImageId ?? null,
              stored.relativePath,
              stored.mimeType,
              stored.width,
              stored.height,
              stored.byteSize,
              stored.checksum,
              index
            ]
          );
          addPhaseTiming(phaseTimings, "db_insert_ms", performance.now() - dbInsertStart);
        } catch (error) {
          await deleteStoredImageFiles(stored.relativePath).catch((deleteError) => {
            log.warn("Failed to delete canceled image file", { jobId, error: deleteError });
          });
          throw error;
        }
      }

      await updateProgress(
        jobId,
        runId,
        progress({
          phase: "saved",
          current,
          total: input.count,
          percent: Math.min(98, 25 + Math.round((current / input.count) * 70)),
          message: `已保存 ${current}/${input.count} 张图片`,
          phaseTimings
        })
      );
    }

    const doneProgress = progress({
      phase: "succeeded",
      current: input.count,
      total: input.count,
      percent: 100,
      message: "任务已完成",
      phaseTimings: Object.keys(phaseTimings).length > 0 ? phaseTimings : undefined
    });
    await markSucceeded(jobId, runId, providerResults, doneProgress);
  } catch (error) {
    if (isJobCanceledError(error)) return;
    if (!input) {
      await markFailedBeforeInput(jobId, runId, error, failureStage);
      log.warn("Generation job failed before loading input", { jobId, stage: failureStage, error });
      return;
    }
    // 瞬时失败先尝试自动重试(保持 running → 退避后重排队);安排成功就不落终态。
    if (await maybeScheduleAutoRetry(jobId, runId, input, error)) {
      log.warn("Generation job will auto-retry", { jobId, stage: failureStage });
      return;
    }
    await markFailed(jobId, runId, input, providerResults, error, failureStage, phaseTimings, selectedProviderName);
    log.warn("Generation job failed", { jobId, stage: failureStage, error });
  }
}
