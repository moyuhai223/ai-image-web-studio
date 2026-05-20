import { randomUUID } from "node:crypto";
import { query } from "./db";
import { generateWithProvider } from "./provider";
import { deleteStoredImageFiles, imageSourceToBuffer, readStoredFile, saveImageBuffer } from "./storage";
import type { GenerationJob, GenerationProgress } from "./types";

export type GenerationRunInput = {
  prompt: string;
  model: string;
  size: string;
  count: number;
  referenceDataUrl?: string;
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

async function getReferenceInfo(requestMetadata: Record<string, unknown>) {
  const reference = asRecord(requestMetadata.reference);
  if (!reference) return {};

  const localPath = typeof reference.localPath === "string" ? reference.localPath : "";
  const mimeType = typeof reference.mimeType === "string" ? reference.mimeType : "";
  const sourceImageId = typeof reference.sourceImageId === "string" ? reference.sourceImageId : undefined;
  if (!localPath || !mimeType) return { parentImageId: sourceImageId };

  const file = await readStoredFile(localPath);
  return {
    referenceDataUrl: `data:${mimeType};base64,${file.buffer.toString("base64")}`,
    parentImageId: sourceImageId
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

async function markFailed(jobId: string, runId: string, input: GenerationRunInput, providerResults: unknown[], error: unknown) {
  const raw = sanitizeProviderMetadata((error as Error & { raw?: unknown }).raw ?? null);
  const failedProgress = progress({
    phase: "failed",
    current: providerResults.length,
    total: input.count,
    percent: providerResults.length > 0 ? Math.min(95, Math.round((providerResults.length / input.count) * 90)) : 35,
    message: errorMessage(error)
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
    [jobId, errorMessage(error), raw, failedProgress, runId]
  );
}

async function markFailedBeforeInput(jobId: string, runId: string, error: unknown) {
  const failedProgress = progress({
    phase: "failed",
    current: 0,
    total: 1,
    percent: 35,
    message: errorMessage(error)
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
    [jobId, errorMessage(error), sanitizeProviderMetadata((error as Error & { raw?: unknown }).raw ?? null), failedProgress, runId]
  );
}

export async function processGenerationJob(jobId: string, claimedRunId?: string) {
  let input: GenerationRunInput | null = null;
  const providerResults = [];
  const runId = claimedRunId ?? randomUUID();

  try {
    if (!claimedRunId) {
      await markRunning(jobId, runId);
    } else {
      await assertActiveRun(jobId, runId);
    }

    input = await loadGenerationInput(jobId);
    await updateProgress(
      jobId,
      runId,
      progress({
        phase: "requesting",
        current: 0,
        total: input.count,
        percent: 10,
        message: "后台任务已启动，准备请求模型"
      })
    );

    for (let index = 0; index < input.count; index += 1) {
      const current = index + 1;
      const requestStartedAt = new Date().toISOString();
      await updateProgress(
        jobId,
        runId,
        progress({
          phase: "requesting",
          current: index,
          total: input.count,
          percent: Math.min(90, 10 + Math.round((index / input.count) * 70)),
          message: `正在请求第 ${current}/${input.count} 张图片`,
          requestStartedAt
        })
      );
      const providerResult = await generateWithProvider({
        ...input,
        count: 1
      });
      providerResults.push(providerResult);

      await updateProgress(
        jobId,
        runId,
        progress({
          phase: "downloading",
          current: index,
          total: input.count,
          percent: Math.min(92, 18 + Math.round((index / input.count) * 70)),
          message: `第 ${current}/${input.count} 张已返回，正在读取图片`
        })
      );

      for (const image of providerResult.images.slice(0, 1)) {
        await assertActiveRun(jobId, runId);
        const source = await imageSourceToBuffer(image);
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
            console.warn(`Failed to delete canceled image file for job ${jobId}:`, deleteError);
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
      await markFailedBeforeInput(jobId, runId, error);
      console.warn(`Generation job ${jobId} failed before loading input:`, error);
      return;
    }
    await markFailed(jobId, runId, input, providerResults, error);
    console.warn(`Generation job ${jobId} failed:`, error);
  }
}
