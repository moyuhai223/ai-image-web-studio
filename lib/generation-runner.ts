import { randomUUID } from "node:crypto";
import { config } from "./config";
import { query } from "./db";
import { createLogger } from "./logger";
import { generateWithProvider } from "./provider";
import { deleteStoredImageFiles, imageSourceToBuffer, readStoredFile, saveImageBuffer } from "./storage";
import type { GenerationJob, GenerationProgress } from "./types";

const log = createLogger("runner");

export type GenerationRunInput = {
  prompt: string;
  model: string;
  size: string;
  count: number;
  referenceDataUrl?: string;
  referenceDataUrls?: string[];
  parentImageId?: string;
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

function stageErrorMessage(stage: string, error: unknown) {
  return `${stage}失败：${errorMessage(error)}`;
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

function providerFlowLabel(input: GenerationRunInput, referenceTotal: number) {
  if (isGptImageModel(input.model)) {
    return referenceTotal > 0 ? "Image 2 编辑接口" : "Image 2 生成接口";
  }
  if (isNanoBananaModel(input.model)) {
    return referenceTotal > 0 ? "Banana 2 多模态编辑流程" : "Banana 2 多模态生成流程";
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

  return {
    prompt: job.prompt,
    model: job.model,
    size: job.size,
    count: job.count,
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

async function markFailed(jobId: string, runId: string, input: GenerationRunInput, providerResults: unknown[], error: unknown, stage: string) {
  const raw = sanitizeProviderMetadata((error as Error & { raw?: unknown }).raw ?? null);
  const message = stageErrorMessage(stage, error);
  const failedProgress = progress({
    phase: "failed",
    current: providerResults.length,
    total: input.count,
    percent: providerResults.length > 0 ? Math.min(95, Math.round((providerResults.length / input.count) * 90)) : 35,
    message
  });

  await query(
    `update generation_jobs
     set status = 'failed',
         error_message = $2,
         response_metadata = $3,
         request_metadata = jsonb_set(request_metadata, '{progress}', $4::jsonb, true),
         completed_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::integer),
         updated_at = now()
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $5`,
    [jobId, message, raw, failedProgress, runId]
  );
}

async function markFailedBeforeInput(jobId: string, runId: string, error: unknown, stage: string) {
  const message = stageErrorMessage(stage, error);
  const failedProgress = progress({
    phase: "failed",
    current: 0,
    total: 1,
    percent: 35,
    message
  });

  await query(
    `update generation_jobs
     set status = 'failed',
         error_message = $2,
         response_metadata = $3,
         request_metadata = jsonb_set(request_metadata, '{progress}', $4::jsonb, true),
         completed_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::integer),
         updated_at = now()
     where id = $1
       and status = 'running'
       and request_metadata #>> '{control,runId}' = $5`,
    [jobId, message, sanitizeProviderMetadata((error as Error & { raw?: unknown }).raw ?? null), failedProgress, runId]
  );
}

export async function processGenerationJob(jobId: string, claimedRunId?: string) {
  let input: GenerationRunInput | null = null;
  const providerResults = [];
  const runId = claimedRunId ?? randomUUID();
  let failureStage = "读取任务参数";

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
      await updateProgress(
        jobId,
        runId,
        progress({
          phase: "requesting",
          current: index,
          total: input.count,
          percent: Math.min(90, 15 + Math.round((index / input.count) * 68)),
          message:
            totalReferences > 0
              ? `${flowLabel}请求已发送，正在等待第 ${current}/${input.count} 张图片返回（参考图 ${totalReferences} 张）`
              : `${flowLabel}请求已发送，正在等待第 ${current}/${input.count} 张图片返回`,
          referenceCount: totalReferences,
          requestStartedAt
        })
      );
      failureStage = "等待模型返回";
      const providerResult = await generateWithProvider({
        ...input,
        count: 1
      });
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
            message: `正在保存第 ${current}/${input.count} 张到本地`
          })
        );
        const stored = await saveImageBuffer(source.buffer, source.mimeType, "images", `${jobId}-${index + 1}`);
        try {
          failureStage = "写入图片记录";
          await assertActiveRun(jobId, runId);
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
          message: `已保存 ${current}/${input.count} 张图片`
        })
      );
    }

    const doneProgress = progress({
      phase: "succeeded",
      current: input.count,
      total: input.count,
      percent: 100,
      message: "任务已完成"
    });
    await markSucceeded(jobId, runId, providerResults, doneProgress);
  } catch (error) {
    if (isJobCanceledError(error)) return;
    if (!input) {
      await markFailedBeforeInput(jobId, runId, error, failureStage);
      log.warn("Generation job failed before loading input", { jobId, stage: failureStage, error });
      return;
    }
    await markFailed(jobId, runId, input, providerResults, error, failureStage);
    log.warn("Generation job failed", { jobId, stage: failureStage, error });
  }
}
