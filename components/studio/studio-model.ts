import { imageThumbnailUrl } from "@/lib/thumbnails";
import { generationStatusLabel, isTerminalGenerationStatus } from "@/lib/generation-status";
import type { LightboxItem } from "../image-lightbox";
import type { ReferenceBasketItem } from "../reference-basket";
import type { GeneratedImage, GenerationJob, JobWithImages, PromptTemplate, ReferenceImage } from "@/lib/types";

/** 选择记忆的编码:groupId::model。groupId 为空串 = 自动轮询。 */
export function optionKey(groupId: string, model: string) {
  return `${groupId}::${model}`;
}

export type RecentJob = GenerationJob & {
  thumbnail_id: string | null;
  thumbnail_width?: number | null;
  thumbnail_height?: number | null;
  thumbnail_favorite?: boolean;
  ref_source_image_id?: string | null;
  ref_library_image_id?: string | null;
};

export type HistoryJob = RecentJob & {
  localOnly?: boolean;
};

export type QueueJob = RecentJob & {
  queue_position: number | null;
};

export type QueueSnapshot = {
  queued: number;
  running: number;
  concurrency: number;
  jobs: QueueJob[];
};

export type RecentReferenceImage = Pick<ReferenceImage, "id" | "byte_size">;

export type SelectedReference = {
  key: string;
  type: "upload" | "generated" | "library";
  id?: string;
  file?: File;
  title: string;
  detail: string;
  imageSrc?: string;
  objectUrl?: string;
};

export type GenerateResponse = {
  job?: JobWithImages | null;
  jobs?: JobWithImages[];
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
  jobId?: string;
};

export type LimitsConfig = {
  maxReferenceImages: number;
  allowedImageMimes: string[];
  maxUploadMb: number;
};

// 客户端默认值,与服务端 lib/config.ts 的 fallback 保持一致。
// 首次挂载时会异步拉取 /api/config/limits 覆盖。
export const DEFAULT_LIMITS: LimitsConfig = {
  maxReferenceImages: 4,
  allowedImageMimes: ["image/png", "image/jpeg", "image/webp"],
  maxUploadMb: 20
};

export const MODEL_SELECTION_STORAGE_KEY = "ai-image-web-studio:model-selection";

export type PromptTemplateOption = Pick<PromptTemplate, "id" | "title" | "category" | "content">;

// A4 比例 = 1:√2(1.414)。2K 档 1472x2080(偏差 0.08%);4K 档 2416x3424(8.27MP,贴像素预算上限,
// A4 比例下长边到不了 3840 是 gpt-image-2 的 8.3MP 硬约束,偏差 0.21%)。
export const sizeValues = new Set(["auto", "1024x1024", "1024x1824", "1824x1024", "1360x1024", "1024x1360", "2080x1472", "1472x2080", "2880x2880", "3840x2160", "2160x3840", "3264x2448", "2448x3264", "3424x2416", "2416x3424"]);
export const countValues = new Set(["1", "2", "3", "4"]);
export const ACTIVE_QUEUE_POLL_MS = 3500;
export const IDLE_QUEUE_POLL_MS = 25000;
export const ACTIVE_JOB_POLL_MS = 1800;

export const initialQueueSnapshot: QueueSnapshot = { queued: 0, running: 0, concurrency: 1, jobs: [] };

export function isTerminalStatus(status: GenerationJob["status"]) {
  return isTerminalGenerationStatus(status);
}

export function progressPercent(job: JobWithImages) {
  if (job.progress) return job.progress.percent;
  if (job.status === "succeeded") return 100;
  if (job.status === "failed" || job.status === "upstream_error") return job.images.length > 0 ? 80 : 45;
  if (job.status === "interrupted") return job.images.length > 0 ? 80 : 35;
  if (job.status === "canceled") return 0;
  if (job.status === "queued") return 5;
  return Math.min(90, Math.max(35, 35 + Math.round((job.images.length / Math.max(1, job.count)) * 45)));
}

export function summarizeJobs(jobs: JobWithImages[]) {
  if (jobs.length === 0) return null;

  const saved = jobs.reduce((sum, current) => sum + current.images.length, 0);
  const total = jobs.reduce((sum, current) => sum + Math.max(1, current.count), 0);
  const completed = jobs.filter((current) => isTerminalStatus(current.status)).length;
  const failed = jobs.filter(
    (current) => current.status === "failed" || current.status === "upstream_error" || current.status === "interrupted"
  ).length;
  const canceled = jobs.filter((current) => current.status === "canceled").length;
  const succeeded = jobs.filter((current) => current.status === "succeeded").length;
  const status: GenerationJob["status"] = jobs.some((current) => current.status === "running")
    ? "running"
    : jobs.some((current) => current.status === "queued")
      ? "queued"
      : jobs.some((current) => current.status === "interrupted")
        ? "interrupted"
        : jobs.some((current) => current.status === "upstream_error")
          ? "upstream_error"
          : failed > 0
            ? "failed"
            : canceled > 0 && succeeded === 0
              ? "canceled"
              : "succeeded";
  const percent = Math.round(jobs.reduce((sum, current) => sum + progressPercent(current), 0) / jobs.length);

  return {
    status,
    terminal: completed === jobs.length,
    percent,
    saved,
    total,
    completed,
    failed,
    label: jobs.length > 1 ? `批量 ${completed}/${jobs.length}` : generationStatusLabel(jobs[0].status),
    message:
      jobs.length > 1
        ? `批量生成 ${completed}/${jobs.length} 个任务已完成，已保存 ${saved}/${total} 张`
        : jobs[0].progress?.message ?? (jobs[0].status === "queued" ? "任务已进入后台队列" : "后台生成中，完成后会自动刷新")
  };
}

export function queueHasWork(snapshot: QueueSnapshot) {
  return snapshot.queued > 0 || snapshot.running > 0 || snapshot.jobs.some((item) => !isTerminalStatus(item.status));
}

export function jobToRecent(nextJob: JobWithImages): RecentJob {
  const meta = nextJob.request_metadata as
    | { reference?: { sourceImageId?: string; referenceImageId?: string }; references?: Array<{ sourceImageId?: string; referenceImageId?: string }> }
    | null
    | undefined;
  const ref0 = meta?.reference ?? meta?.references?.[0] ?? null;
  return {
    ...nextJob,
    thumbnail_id: nextJob.images?.[0]?.id ?? null,
    thumbnail_width: nextJob.images?.[0]?.width ?? null,
    thumbnail_height: nextJob.images?.[0]?.height ?? null,
    thumbnail_favorite: nextJob.images?.[0]?.is_favorite ?? false,
    ref_source_image_id: ref0?.sourceImageId ?? null,
    ref_library_image_id: ref0?.referenceImageId ?? null
  };
}

export function progressTailLeft(percent: number) {
  return `${Math.min(99, Math.max(0, percent))}%`;
}

/**
 * 把 phaseTimings(毫秒)转成 "等待模型 12.0s · 下载 1.2s · 入库 80ms" 之类的简短文本。
 * 没有任何阶段数据时返回 null,调用方不渲染。
 */
export function formatPhaseTimings(timings: NonNullable<JobWithImages["progress"]>["phaseTimings"]) {
  if (!timings) return null;
  const parts: string[] = [];
  const format = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
  if (typeof timings.upstream_wait_ms === "number" && timings.upstream_wait_ms > 0) {
    parts.push(`等待模型 ${format(timings.upstream_wait_ms)}`);
  }
  if (typeof timings.download_decode_ms === "number" && timings.download_decode_ms > 0) {
    parts.push(`下载 ${format(timings.download_decode_ms)}`);
  }
  if (typeof timings.db_insert_ms === "number" && timings.db_insert_ms > 0) {
    parts.push(`入库 ${format(timings.db_insert_ms)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * 拿一组并行任务里"任意一个有 phaseTimings 的 job"的计时数据。
 * 批量场景目前只展示第一个有数据的,够用。
 */
export function activePhaseTimingsFromJobs(jobs: JobWithImages[]) {
  for (const job of jobs) {
    const timings = job.progress?.phaseTimings;
    if (timings && (timings.upstream_wait_ms || timings.download_decode_ms || timings.db_insert_ms)) {
      return timings;
    }
  }
  return undefined;
}

export function formatFileSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
}

export function referenceSourceLabel(type: SelectedReference["type"]) {
  if (type === "upload") return "上传文件";
  if (type === "generated") return "生成图";
  return "参考图库";
}

export function createReferenceKey(prefix: string) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function basketItemsToSelectedReferences(items: ReferenceBasketItem[]): SelectedReference[] {
  return items.map((item, index) => ({
    key: `generated:${item.imageId}`,
    type: "generated",
    id: item.imageId,
    title: index === 0 ? "图篮主参考图" : `图篮参考图 ${index + 1}`,
    detail: item.prompt ? item.prompt : "从参考图篮导入",
    imageSrc: imageThumbnailUrl(item.imageId)
  }));
}

export function waitFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

// 把一个尺寸值解析成下拉选择状态:命中预设档→选中该档;形如 WxH 的非预设→「自定义」并回填宽高;否则 auto。
export function pickSizeSelection(raw: string | null): { size: string; width: string; height: string } {
  const value = (raw ?? "").trim();
  if (value && sizeValues.has(value)) return { size: value, width: "", height: "" };
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value);
  if (match) return { size: "custom", width: match[1], height: match[2] };
  return { size: "auto", width: "", height: "" };
}

export function normalizeCount(value: string | null) {
  return value && countValues.has(value) ? value : "1";
}

export function imageToLightboxItem(image: GeneratedImage): LightboxItem {
  return {
    src: `/api/images/${image.id}`,
    downloadHref: `/api/images/${image.id}/download`,
    alt: "生成图片"
  };
}
