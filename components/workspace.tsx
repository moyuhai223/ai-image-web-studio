"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Download, ImagePlus, Pencil, Play, RefreshCcw, Sparkles, X } from "lucide-react";
import { CopyPromptButton } from "./copy-prompt-button";
import { DeleteRecordButton } from "./delete-record-button";
import { FavoriteImageButton } from "./favorite-image-button";
import { ImageWithSkeleton } from "./image-with-skeleton";
import { ImageLightbox, type LightboxItem } from "./image-lightbox";
import { ImageTagsEditor } from "./image-tags-editor";
import { JobControlButton } from "./job-control-button";
import { dispatchJobNotification } from "./job-notification-center";
import { REFERENCE_BASKET_APPLY_EVENT, readReferenceBasketItems, ReferenceBasketButton, type ReferenceBasketItem } from "./reference-basket";
import { DangerConfirmDialog } from "./danger-confirm-dialog";
import { generationStatusLabel, isRetryableGenerationStatus, isTerminalGenerationStatus } from "@/lib/generation-status";
import { normalizeImageSize } from "@/lib/image-size";
import { imageThumbnailUrl, THUMBNAIL_QUERY } from "@/lib/thumbnails";
import { resolutionTier } from "@/lib/image-size";
import { ROTATE_PRESET_ID } from "@/lib/provider-rotation";
import type { GeneratedImage, GenerationJob, JobWithImages, PromptTemplate, ReferenceImage } from "@/lib/types";

type ModelOption = {
  label: string;
  value: string;
};

type RecentJob = GenerationJob & {
  thumbnail_id: string | null;
  thumbnail_width?: number | null;
  thumbnail_height?: number | null;
  thumbnail_favorite?: boolean;
  ref_source_image_id?: string | null;
  ref_library_image_id?: string | null;
};

type HistoryJob = RecentJob & {
  localOnly?: boolean;
};

type QueueJob = RecentJob & {
  queue_position: number | null;
};

type QueueSnapshot = {
  queued: number;
  running: number;
  concurrency: number;
  jobs: QueueJob[];
};

type RecentReferenceImage = Pick<ReferenceImage, "id" | "byte_size">;

type SelectedReference = {
  key: string;
  type: "upload" | "generated" | "library";
  id?: string;
  file?: File;
  title: string;
  detail: string;
  imageSrc?: string;
  objectUrl?: string;
};

type GenerateResponse = {
  job?: JobWithImages | null;
  jobs?: JobWithImages[];
  error?: string;
  code?: string;
  retryAfterSeconds?: number;
  jobId?: string;
};

type LimitsConfig = {
  maxReferenceImages: number;
  allowedImageMimes: string[];
  maxUploadMb: number;
};

type WorkspacePresetOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

// 客户端默认值,与服务端 lib/config.ts 的 fallback 保持一致。
// 首次挂载时会异步拉取 /api/config/limits 覆盖。
const DEFAULT_LIMITS: LimitsConfig = {
  maxReferenceImages: 4,
  allowedImageMimes: ["image/png", "image/jpeg", "image/webp"],
  maxUploadMb: 20
};

const PRESET_STORAGE_KEY = "ai-image-web-studio:preset-id";

type PromptTemplateOption = Pick<PromptTemplate, "id" | "title" | "category" | "content">;

const sizeValues = new Set(["auto", "1024x1024", "1024x1824", "1824x1024", "1360x1024", "1024x1360", "2880x2880", "3840x2160", "2160x3840", "3264x2448", "2448x3264"]);
const countValues = new Set(["1", "2", "3", "4"]);
const ACTIVE_QUEUE_POLL_MS = 3500;
const IDLE_QUEUE_POLL_MS = 25000;
const ACTIVE_JOB_POLL_MS = 1800;

const initialQueueSnapshot: QueueSnapshot = { queued: 0, running: 0, concurrency: 1, jobs: [] };
function isTerminalStatus(status: GenerationJob["status"]) {
  return isTerminalGenerationStatus(status);
}

function progressPercent(job: JobWithImages) {
  if (job.progress) return job.progress.percent;
  if (job.status === "succeeded") return 100;
  if (job.status === "failed" || job.status === "upstream_error") return job.images.length > 0 ? 80 : 45;
  if (job.status === "interrupted") return job.images.length > 0 ? 80 : 35;
  if (job.status === "canceled") return 0;
  if (job.status === "queued") return 5;
  return Math.min(90, Math.max(35, 35 + Math.round((job.images.length / Math.max(1, job.count)) * 45)));
}

function summarizeJobs(jobs: JobWithImages[]) {
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

function queueHasWork(snapshot: QueueSnapshot) {
  return snapshot.queued > 0 || snapshot.running > 0 || snapshot.jobs.some((item) => !isTerminalStatus(item.status));
}

function jobToRecent(nextJob: JobWithImages): RecentJob {
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

function progressTailLeft(percent: number) {
  return `${Math.min(99, Math.max(0, percent))}%`;
}

/**
 * 把 phaseTimings(毫秒)转成 "等待模型 12.0s · 下载 1.2s · 入库 80ms" 之类的简短文本。
 * 没有任何阶段数据时返回 null,调用方不渲染。
 */
function formatPhaseTimings(timings: NonNullable<JobWithImages["progress"]>["phaseTimings"]) {
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
function activePhaseTimingsFromJobs(jobs: JobWithImages[]) {
  for (const job of jobs) {
    const timings = job.progress?.phaseTimings;
    if (timings && (timings.upstream_wait_ms || timings.download_decode_ms || timings.db_insert_ms)) {
      return timings;
    }
  }
  return undefined;
}

function formatFileSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
}

function referenceSourceLabel(type: SelectedReference["type"]) {
  if (type === "upload") return "上传文件";
  if (type === "generated") return "生成图";
  return "参考图库";
}

function createReferenceKey(prefix: string) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function basketItemsToSelectedReferences(items: ReferenceBasketItem[]): SelectedReference[] {
  return items.map((item, index) => ({
    key: `generated:${item.imageId}`,
    type: "generated",
    id: item.imageId,
    title: index === 0 ? "图篮主参考图" : `图篮参考图 ${index + 1}`,
    detail: item.prompt ? item.prompt : "从参考图篮导入",
    imageSrc: imageThumbnailUrl(item.imageId)
  }));
}

function waitFor(ms: number, signal: AbortSignal) {
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

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function Workspace({
  models,
  promptTemplates,
  recentReferenceImages
}: {
  models: ModelOption[];
  promptTemplates: PromptTemplateOption[];
  recentReferenceImages: RecentReferenceImage[];
}) {
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [queueLoading, setQueueLoading] = useState(true);
  const [error, setError] = useState("");
  const [job, setJob] = useState<JobWithImages | null>(null);
  const [batchJobs, setBatchJobs] = useState<JobWithImages[]>([]);
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const [queue, setQueue] = useState<QueueSnapshot>(initialQueueSnapshot);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(models[0]?.value ?? "");
  const [size, setSize] = useState("auto");
  const [customWidth, setCustomWidth] = useState("2048");
  const [customHeight, setCustomHeight] = useState("2048");
  const [upscalingKey, setUpscalingKey] = useState("");
  const [upscaleConfirmKey, setUpscaleConfirmKey] = useState("");
  const [upscaleError, setUpscaleError] = useState("");
  const [count, setCount] = useState("1");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([]);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [limits, setLimits] = useState<LimitsConfig>(DEFAULT_LIMITS);
  const [presets, setPresets] = useState<WorkspacePresetOption[]>([]);
  const [presetId, setPresetId] = useState<string>("");
  const autoRunStarted = useRef(false);
  const mountedRef = useRef(false);
  const pollTokenRef = useRef(0);
  const queueTimerRef = useRef<number | null>(null);
  const queueSnapshotRef = useRef<QueueSnapshot>(initialQueueSnapshot);
  const watchedJobIdsRef = useRef<string[]>([]);
  const pollControllerRef = useRef<AbortController | null>(null);
  const queueControllerRef = useRef<AbortController | null>(null);
  const recentControllerRef = useRef<AbortController | null>(null);
  const queueEventSourceRef = useRef<EventSource | null>(null);
  const queueStreamFailuresRef = useRef(0);
  const queueStreamDisabledRef = useRef(false);
  const queueStreamReconnectTimerRef = useRef<number | null>(null);
  // 最近记录自动同步:记上一次队列快照的「活动任务签名」,变化时去抖刷新最近记录。
  const prevQueueSignatureRef = useRef<string | null>(null);
  const recentSyncTimerRef = useRef<number | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);
  const referenceObjectUrlsRef = useRef<Set<string>>(new Set());

  const activeJobs = useMemo(() => (batchJobs.length > 0 ? batchJobs : job ? [job] : []), [batchJobs, job]);
  const activeImages = useMemo(() => activeJobs.flatMap((currentJob) => currentJob.images), [activeJobs]);
  const activeLightboxItems = useMemo(() => activeImages.map(imageToLightboxItem), [activeImages]);
  const activeSummary = useMemo(() => summarizeJobs(activeJobs), [activeJobs]);
  const activePhaseTimingsText = useMemo(() => {
    const timings = activePhaseTimingsFromJobs(activeJobs);
    return formatPhaseTimings(timings);
  }, [activeJobs]);
  const modelLabel = models.find((item) => item.value === model)?.label ?? model;
  const referenceSummary = selectedReferences.length > 0 ? `${selectedReferences.length} 张参考图` : "无参考图";

  useEffect(() => {
    mountedRef.current = true;
    void loadRecentJobs();
    void loadQueueStatus();
    openQueueStream();
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearQueueTimer();
        queueControllerRef.current?.abort();
        pollControllerRef.current?.abort();
        closeQueueStream();
        return;
      }

      void loadQueueStatus(true);
      openQueueStream();
      if (watchedJobIdsRef.current.length > 0) {
        void pollJobs(watchedJobIdsRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const params = new URLSearchParams(window.location.search);
    const editImageId = params.get("referenceImageId");
    const existingRefId = params.get("refImageId");
    const shouldImportBasket = params.get("basket") === "1";
    const nextPrompt = params.get("prompt") ?? "";
    const nextModel = normalizeModel(params.get("model"), models, model);
    const sizeSel = pickSizeSelection(params.get("size"));
    const nextCount = normalizeCount(params.get("count"));

    if (nextPrompt) setPrompt(nextPrompt);
    if (nextModel) setModel(nextModel);
    setSize(sizeSel.size);
    if (sizeSel.size === "custom") {
      setCustomWidth(sizeSel.width);
      setCustomHeight(sizeSel.height);
    }
    setCount(nextCount);

    const urlReferences: Array<{ type: "generated" | "library"; id: string }> = [];
    if (editImageId) {
      addGeneratedReference(editImageId);
      urlReferences.push({ type: "generated", id: editImageId });
    }
    if (existingRefId) {
      addLibraryReference(existingRefId);
      urlReferences.push({ type: "library", id: existingRefId });
    }
    if (shouldImportBasket) {
      addBasketReferences(readReferenceBasketItems());
    }

    const handleBasketApply = () => {
      addBasketReferences(readReferenceBasketItems());
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener(REFERENCE_BASKET_APPLY_EVENT, handleBasketApply);

    if (params.get("autorun") === "1" && nextPrompt && !autoRunStarted.current) {
      autoRunStarted.current = true;
      const formData = new FormData();
      formData.set("prompt", nextPrompt);
      formData.set("model", nextModel);
      formData.set("size", normalizeImageSize(params.get("size") ?? ""));
      formData.set("count", nextCount);
      if (urlReferences.length > 0) {
        formData.set("referenceItems", JSON.stringify(urlReferences));
        for (const reference of urlReferences) {
          formData.append(reference.type === "generated" ? "referenceImageIds" : "existingRefIds", reference.id);
        }
      }
      void startGeneration(formData);
    }

    if (editImageId || existingRefId || shouldImportBasket || nextPrompt || params.get("autorun") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
    }

    return () => {
      mountedRef.current = false;
      clearQueueTimer();
      closeQueueStream();
      window.removeEventListener(REFERENCE_BASKET_APPLY_EVENT, handleBasketApply);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pollControllerRef.current?.abort();
      queueControllerRef.current?.abort();
      recentControllerRef.current?.abort();
      if (recentSyncTimerRef.current !== null) window.clearTimeout(recentSyncTimerRef.current);
      for (const url of referenceObjectUrlsRef.current) URL.revokeObjectURL(url);
      referenceObjectUrlsRef.current.clear();
    };
  }, []);

  // 拉取服务端的 limits 配置(参考图最大张数 / 允许 MIME / 单图大小上限)。
  // 客户端不能 import lib/config(Node-only),所以走 /api/config/limits。
  // 失败时静默回退到 DEFAULT_LIMITS,不影响功能。
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/config/limits", { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as Partial<LimitsConfig>;
        if (controller.signal.aborted) return;
        setLimits({
          maxReferenceImages: Number(data.maxReferenceImages) || DEFAULT_LIMITS.maxReferenceImages,
          allowedImageMimes:
            Array.isArray(data.allowedImageMimes) && data.allowedImageMimes.length > 0
              ? data.allowedImageMimes
              : DEFAULT_LIMITS.allowedImageMimes,
          maxUploadMb: Number(data.maxUploadMb) || DEFAULT_LIMITS.maxUploadMb
        });
      } catch {
        // 静默,沿用 DEFAULT_LIMITS
      }
    })();
    return () => controller.abort();
  }, []);

  // 拉取 Provider Preset 列表(普通用户可见的脱敏摘要:仅 id/name/isDefault,不暴露 baseUrl)。
  // 失败时静默回退到空数组,默认走后端 default preset。
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/presets", { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as {
          presets?: WorkspacePresetOption[];
          defaultPresetId?: string | null;
        };
        if (controller.signal.aborted) return;
        const fetchedPresets = Array.isArray(data.presets) ? data.presets : [];
        setPresets(fetchedPresets);

        // 优先使用 localStorage 记忆的选择(允许「自动轮换」这个特殊值,或仍存在的 preset id)。
        let initial = "";
        try {
          const stored = window.localStorage.getItem(PRESET_STORAGE_KEY);
          if (stored && (stored === ROTATE_PRESET_ID || fetchedPresets.some((preset) => preset.id === stored))) {
            initial = stored;
          }
        } catch {
          // localStorage 不可用(隐私模式 / 配额满),忽略。
        }
        // 没有记忆值时:≥2 个 Provider 默认走「自动轮换」;否则用后端 default preset。
        if (!initial) {
          initial = fetchedPresets.length >= 2 ? ROTATE_PRESET_ID : (data.defaultPresetId ?? "");
        }
        setPresetId(initial);
      } catch {
        // 静默,sticks with empty presets
      }
    })();
    return () => controller.abort();
  }, []);

  // presetId 变化时持久化到 localStorage,下次进入页面自动恢复。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (presetId) {
        window.localStorage.setItem(PRESET_STORAGE_KEY, presetId);
      } else {
        window.localStorage.removeItem(PRESET_STORAGE_KEY);
      }
    } catch {
      // 忽略 localStorage 异常
    }
  }, [presetId]);

  function clearQueueTimer() {
    if (queueTimerRef.current !== null) {
      window.clearTimeout(queueTimerRef.current);
      queueTimerRef.current = null;
    }
  }

  function scheduleQueueRefresh(snapshot = queueSnapshotRef.current) {
    clearQueueTimer();
    if (!mountedRef.current || document.hidden) return;
    // 当 SSE 连接活跃时,polling 仅作为兜底心跳(用 idle 间隔,确保最长 25s 内一定 refresh)。
    const sseActive = queueEventSourceRef.current?.readyState === EventSource.OPEN;
    const delay = sseActive
      ? IDLE_QUEUE_POLL_MS
      : queueHasWork(snapshot)
        ? ACTIVE_QUEUE_POLL_MS
        : IDLE_QUEUE_POLL_MS;
    queueTimerRef.current = window.setTimeout(() => {
      void loadQueueStatus(true);
    }, delay);
  }

  // 队列「活动任务签名」= 所有在队/运行任务的 id:status 集合(排序后拼接)。
  // 任务入队 / queued→running / 完成离开队列,签名都会变,用来判断是否要同步最近记录。
  function queueSignature(snapshot: QueueSnapshot) {
    const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
    return jobs
      .map((item) => `${item.id}:${item.status}`)
      .sort()
      .join("|");
  }

  // 去抖刷新最近记录:SSE 高频推送 / 生成结束多次触发都合并成一次「静默」拉取
  // (不闪 loading、保留本地乐观占位),避免连打 /api/recent-jobs。
  function scheduleRecentSync() {
    if (recentSyncTimerRef.current !== null) return;
    recentSyncTimerRef.current = window.setTimeout(() => {
      recentSyncTimerRef.current = null;
      if (mountedRef.current && !document.hidden) void loadRecentJobs(true);
    }, 400);
  }

  /**
   * 应用 SSE / polling 拉取到的快照。
   * 这里集中处理 setState + ref 更新,避免两路接入同一份状态时漏改。
   */
  function applyQueueSnapshot(snapshot: QueueSnapshot) {
    queueSnapshotRef.current = snapshot;
    setQueue(snapshot);
    // 「首页刷新状态时同步刷新最近记录」:SSE 与 polling 都汇聚到这里,
    // 活动任务签名一变(新任务 / 状态流转 / 完成)就去抖刷新最近记录。
    const signature = queueSignature(snapshot);
    if (prevQueueSignatureRef.current !== null && prevQueueSignatureRef.current !== signature) {
      scheduleRecentSync();
    }
    prevQueueSignatureRef.current = signature;
  }

  function closeQueueStream() {
    if (queueStreamReconnectTimerRef.current !== null) {
      window.clearTimeout(queueStreamReconnectTimerRef.current);
      queueStreamReconnectTimerRef.current = null;
    }
    if (queueEventSourceRef.current) {
      try {
        queueEventSourceRef.current.close();
      } catch {
        // ignore
      }
      queueEventSourceRef.current = null;
    }
  }

  function openQueueStream() {
    if (queueStreamDisabledRef.current) return;
    if (!mountedRef.current) return;
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
      queueStreamDisabledRef.current = true;
      return;
    }
    if (queueEventSourceRef.current) return;

    let source: EventSource;
    try {
      source = new EventSource("/api/queue/stream", { withCredentials: true });
    } catch (error) {
      console.warn("EventSource init failed, falling back to polling:", error);
      queueStreamDisabledRef.current = true;
      return;
    }
    queueEventSourceRef.current = source;

    const handleSnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const nextQueue: QueueSnapshot = {
          queued: Number(data.queued ?? 0),
          running: Number(data.running ?? 0),
          concurrency: Number(data.concurrency ?? 1),
          jobs: Array.isArray(data.jobs) ? data.jobs : []
        };
        applyQueueSnapshot(nextQueue);
        setQueueLoading(false);
        queueStreamFailuresRef.current = 0;
      } catch (error) {
        console.warn("Queue stream payload parse failed:", error);
      }
    };

    source.addEventListener("snapshot", handleSnapshot);
    source.addEventListener("update", handleSnapshot);
    source.addEventListener("bye", () => {
      // 服务端主动关闭(达到最大时长),重连即可。
      closeQueueStream();
      queueStreamReconnectTimerRef.current = window.setTimeout(() => {
        openQueueStream();
      }, 500);
    });
    source.onerror = () => {
      queueStreamFailuresRef.current += 1;
      closeQueueStream();
      // 连续 3 次失败后彻底关掉 SSE,走旧 polling
      if (queueStreamFailuresRef.current >= 3) {
        queueStreamDisabledRef.current = true;
        console.warn("Queue stream disabled after repeated failures, falling back to polling");
        void loadQueueStatus(true);
        return;
      }
      // 否则指数退避后重连
      const delay = Math.min(15000, 1000 * 2 ** Math.max(0, queueStreamFailuresRef.current - 1));
      queueStreamReconnectTimerRef.current = window.setTimeout(() => {
        openQueueStream();
      }, delay);
    };
  }

  async function loadQueueStatus(silent = false) {
    if (document.hidden) return;
    if (!silent) setQueueLoading(true);
    queueControllerRef.current?.abort();
    const controller = new AbortController();
    queueControllerRef.current = controller;
    try {
      const response = await fetch("/api/queue", { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.ok && mountedRef.current && !controller.signal.aborted) {
        const nextQueue = {
          queued: Number(data.queued ?? 0),
          running: Number(data.running ?? 0),
          concurrency: Number(data.concurrency ?? 1),
          jobs: data.jobs ?? []
        };
        applyQueueSnapshot(nextQueue);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn("Queue status refresh failed:", error);
      }
    } finally {
      const isCurrent = queueControllerRef.current === controller;
      if (isCurrent) queueControllerRef.current = null;
      if (mountedRef.current) {
        setQueueLoading(false);
        if (isCurrent) scheduleQueueRefresh();
      }
    }
  }

  async function loadRecentJobs(silent = false) {
    // silent=true 用于自动同步(SSE/生成结束):不闪 loading 占位,体验更顺。
    if (!silent) setHistoryLoading(true);
    recentControllerRef.current?.abort();
    const controller = new AbortController();
    recentControllerRef.current = controller;
    try {
      const response = await fetch("/api/recent-jobs", { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.ok && mountedRef.current && !controller.signal.aborted) {
        const serverJobs: HistoryJob[] = data.jobs ?? [];
        const serverIds = new Set(serverJobs.map((item) => item.id));
        // 保留尚未出现在服务端结果里的本地乐观占位(刚点生成、还没拿到真实 jobId),
        // 避免自动同步把 pending 占位冲掉。
        setHistory((current) => {
          const pendingLocal = current.filter((item) => item.localOnly && !serverIds.has(item.id));
          return [...pendingLocal, ...serverJobs].slice(0, 6);
        });
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn("Recent jobs refresh failed:", error);
      }
    } finally {
      if (recentControllerRef.current === controller) recentControllerRef.current = null;
      if (mountedRef.current) {
        setHistoryLoaded(true);
        if (!silent) setHistoryLoading(false);
      }
    }
  }

  useEffect(() => {
    // 全局粘贴:剪贴板里有图片(如截图 Ctrl+V)就加为参考图;只有文字时放行,不影响往提示词粘贴
    function handlePaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      event.preventDefault();
      addUploadFiles(files);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 有参考图时默认展开参考区(便于查看/管理);无参考图保持收起(初始)。只自动展开,不强制收起,
  // 这样没有参考图时仍可手动展开去上传。
  useEffect(() => {
    if (selectedReferences.length > 0) setReferencesOpen(true);
  }, [selectedReferences.length]);

  async function startGeneration(formData: FormData) {
    pollTokenRef.current += 1;
    pollControllerRef.current?.abort();
    setLoading(true);
    setError("");
    setJob(null);
    setBatchJobs([]);
    const requestedCount = Number(normalizeCount(String(formData.get("count") ?? "1")));
    const createdAt = new Date().toISOString();
    const pendingJobs: HistoryJob[] = Array.from({ length: requestedCount }, (_, index) => ({
      id: `pending-${Date.now()}-${index}`,
      user_id: "",
      model: String(formData.get("model") ?? ""),
      prompt: String(formData.get("prompt") ?? ""),
      size: String(formData.get("size") ?? ""),
      count: 1,
      status: "queued",
      provider: "provider",
      provider_request_id: null,
      error_message: null,
      request_metadata: {
        batch: {
          index: index + 1,
          total: requestedCount
        }
      },
      response_metadata: null,
      started_at: null,
      completed_at: null,
      duration_ms: null,
      created_at: createdAt,
      updated_at: createdAt,
      thumbnail_id: null,
      localOnly: true
    }));
    const pendingIds = new Set(pendingJobs.map((item) => item.id));

    setHistory((current) => [...pendingJobs, ...current].slice(0, 6));

    const response = await fetch("/api/generate", {
      method: "POST",
      body: formData
    });
    const data = (await response.json().catch(() => ({}))) as GenerateResponse;

    if (!response.ok) {
      setLoading(false);
      // 队列已满(429 + code=queue_full)给一句更友好的提示,告诉用户可以稍后再试。
      const isQueueFull = response.status === 429 && data.code === "queue_full";
      const baseMessage = data.error ?? "生成失败";
      const displayMessage = isQueueFull
        ? `${baseMessage}（约 ${data.retryAfterSeconds ?? 30} 秒后可再次尝试）`
        : baseMessage;
      setError(displayMessage);
      setHistory((current) =>
        current.map((item) =>
          pendingIds.has(item.id)
            ? {
                ...item,
                id: pendingJobs.length === 1 ? data.jobId ?? item.id : item.id,
                status: "failed",
                error_message: displayMessage,
                updated_at: new Date().toISOString(),
                localOnly: !data.jobId
              }
            : item
        )
      );
      return;
    }

    const returnedJobs = data.jobs?.length ? data.jobs : data.job ? [data.job] : [];

    if (returnedJobs.length > 0) {
      setJob(returnedJobs[0]);
      setBatchJobs(returnedJobs);
      const returnedIds = new Set(returnedJobs.map((item) => item.id));
      const recentJobs = returnedJobs.map(jobToRecent);
      setHistory((current) =>
        [
          ...recentJobs,
          ...current.filter((item) => !pendingIds.has(item.id) && !returnedIds.has(item.id))
        ].slice(0, 6)
      );
      void loadQueueStatus(true);
      if (returnedJobs.every((item) => isTerminalStatus(item.status))) {
        setLoading(false);
        returnedJobs.forEach(dispatchJobNotification);
        // 生成结束(直接终态,如缓存命中/秒回)→ 同步刷新最近记录,拿真实缩略图/状态。
        scheduleRecentSync();
      } else {
        void pollJobs(returnedJobs.map((item) => item.id));
      }
    } else {
      setLoading(false);
      setError("任务创建失败");
      setHistory((current) => current.filter((item) => !pendingIds.has(item.id)));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // 自定义尺寸时用归一化后的 WxH 覆盖 select 的 "custom" 占位值;预设/auto 原样提交
    formData.set("size", size === "custom" ? normalizeImageSize(`${customWidth}x${customHeight}`) : size);
    appendSelectedReferences(formData);
    await startGeneration(formData);
  }

  async function pollJobs(jobIds: string[]) {
    const watchedIds = Array.from(new Set(jobIds));
    watchedJobIdsRef.current = watchedIds;
    pollControllerRef.current?.abort();
    if (document.hidden) return;
    const controller = new AbortController();
    pollControllerRef.current = controller;
    const token = ++pollTokenRef.current;

    try {
      for (;;) {
        await waitFor(ACTIVE_JOB_POLL_MS, controller.signal);
        if (!mountedRef.current || token !== pollTokenRef.current || controller.signal.aborted) return;
        if (document.hidden) return;

        const results = await Promise.all(
          watchedIds.map(async (jobId) => {
            const response = await fetch(`/api/records/${jobId}`, { cache: "no-store", signal: controller.signal });
            const data = (await response.json().catch(() => ({}))) as { job?: JobWithImages; error?: string };
            if (!response.ok || !data.job) {
              throw new Error(data.error ?? "任务状态读取失败");
            }
            return data.job;
          })
        );

        if (!mountedRef.current || token !== pollTokenRef.current || controller.signal.aborted) return;

        setJob(results[0] ?? null);
        setBatchJobs(results);
        const nextJobs = results.map(jobToRecent);
        const nextIds = new Set(nextJobs.map((item) => item.id));
        setHistory((current) => [...nextJobs, ...current.filter((item) => !nextIds.has(item.id))].slice(0, 6));
        void loadQueueStatus(true);

        if (results.every((item) => isTerminalStatus(item.status))) {
          watchedJobIdsRef.current = [];
          setLoading(false);
          results.forEach(dispatchJobNotification);
          const failed = results.filter(
            (item) => item.status === "failed" || item.status === "upstream_error" || item.status === "interrupted"
          );
          if (failed.length > 0) {
            setError(failed.length === 1 ? failed[0].error_message ?? "生成失败" : `${failed.length} 个任务生成失败，请在记录里查看详情`);
          }
          // 生成结束 → 同步刷新最近记录(真实缩略图/状态/标签),不只靠轮询的乐观更新。
          scheduleRecentSync();
          return;
        }
      }
    } catch (error) {
      if (isAbortError(error)) return;
      if (mountedRef.current && token === pollTokenRef.current) {
        setLoading(false);
        setError("任务状态读取失败");
      }
    } finally {
      if (pollControllerRef.current === controller) pollControllerRef.current = null;
    }
  }

  function applyTaskParams(recent: RecentJob) {
    setPrompt(recent.prompt);
    setModel(normalizeModel(recent.model, models, model));
    const recentSel = pickSizeSelection(recent.size);
    setSize(recentSel.size);
    if (recentSel.size === "custom") {
      setCustomWidth(recentSel.width);
      setCustomHeight(recentSel.height);
    }
    setCount(normalizeCount(String(recent.count)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editFromImage(imageId: string) {
    addGeneratedReference(imageId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function removeHistoryItem(recordId: string) {
    setHistory((current) => current.filter((item) => item.id !== recordId));
    setJob((current) => (current?.id === recordId ? null : current));
    setBatchJobs((current) => current.filter((item) => item.id !== recordId));
  }

  function refreshJobLists() {
    void loadQueueStatus(true);
    void loadRecentJobs();
  }

  function selectTemplatePlaceholder(nextPrompt: string, insertedStart: number) {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    const range = findPlaceholderRange(nextPrompt, insertedStart);
    const start = range?.start ?? nextPrompt.length;
    const end = range?.end ?? nextPrompt.length;

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  }

  function findPlaceholderRange(value: string, cursor: number, direction: 1 | -1 = 1) {
    const ranges = Array.from(value.matchAll(/\{[^{}]*\}/g), (match) => ({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length
    }));
    if (ranges.length === 0) return null;

    if (direction === -1) {
      return [...ranges].reverse().find((range) => range.start < cursor) ?? ranges[ranges.length - 1];
    }

    return ranges.find((range) => range.start >= cursor) ?? ranges[0];
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    const cursor = event.shiftKey ? event.currentTarget.selectionStart : event.currentTarget.selectionEnd;
    const range = findPlaceholderRange(prompt, cursor, event.shiftKey ? -1 : 1);
    if (!range) return;
    event.preventDefault();
    event.currentTarget.setSelectionRange(range.start, range.end);
  }

  function applyPromptTemplate(mode: "replace" | "append") {
    const template = promptTemplates.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    const current = prompt.trim();
    const prefix = mode === "append" && current ? `${current}\n\n` : "";
    const nextPrompt = `${prefix}${template.content}`;
    setPrompt(nextPrompt);
    selectTemplatePlaceholder(nextPrompt, prefix.length);
  }

  function addSelectedReferences(nextReferences: SelectedReference[]) {
    if (nextReferences.length === 0) return;
    setSelectedReferences((current) => {
      const next = [...current];
      let skipped = 0;
      for (const reference of nextReferences) {
        if (next.some((item) => item.key === reference.key)) continue;
        if (next.length >= limits.maxReferenceImages) {
          skipped += 1;
          if (reference.objectUrl) {
            URL.revokeObjectURL(reference.objectUrl);
            referenceObjectUrlsRef.current.delete(reference.objectUrl);
          }
          continue;
        }
        next.push(reference);
      }
      if (skipped > 0) {
        window.setTimeout(() => setError(`最多选择 ${limits.maxReferenceImages} 张参考图，多余图片已忽略`), 0);
      }
      return next;
    });
  }

  function removeSelectedReference(key: string) {
    setSelectedReferences((current) => {
      const removed = current.find((item) => item.key === key);
      if (removed?.objectUrl) {
        URL.revokeObjectURL(removed.objectUrl);
        referenceObjectUrlsRef.current.delete(removed.objectUrl);
      }
      return current.filter((item) => item.key !== key);
    });
  }

  function clearAllReferences() {
    setSelectedReferences((current) => {
      for (const reference of current) {
        if (reference.objectUrl) {
          URL.revokeObjectURL(reference.objectUrl);
          referenceObjectUrlsRef.current.delete(reference.objectUrl);
        }
      }
      return [];
    });
  }

  function moveSelectedReference(key: string, direction: -1 | 1) {
    setSelectedReferences((current) => {
      const index = current.findIndex((item) => item.key === key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function addGeneratedReference(imageId: string) {
    addSelectedReferences([
      {
        key: `generated:${imageId}`,
        type: "generated",
        id: imageId,
        title: "生成图参考",
        detail: "将已生成图片作为修图参考",
        imageSrc: imageThumbnailUrl(imageId)
      }
    ]);
  }

  function addBasketReferences(items: ReferenceBasketItem[]) {
    addSelectedReferences(basketItemsToSelectedReferences(items));
  }

  function addLibraryReference(referenceId: string, byteSize?: number) {
    addSelectedReferences([
      {
        key: `library:${referenceId}`,
        type: "library",
        id: referenceId,
        title: "参考图库",
        detail: byteSize ? formatFileSize(byteSize) : "使用已保存的参考图",
        imageSrc: `/api/reference-images/${referenceId}?thumb=1`
      }
    ]);
  }

  function toggleLibraryReference(reference: RecentReferenceImage) {
    const key = `library:${reference.id}`;
    if (selectedReferences.some((item) => item.key === key)) {
      removeSelectedReference(key);
      return;
    }
    addLibraryReference(reference.id, reference.byte_size);
  }

  function addUploadFiles(files: File[]) {
    // 只收 PNG/JPG/WebP(与后端 allowedImageTypes 一致);剪贴板/拖拽来的非法类型直接忽略
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    const imageFiles = files.filter((file) => allowed.includes(file.type));
    if (imageFiles.length === 0) return;
    const nextReferences = imageFiles.map((rawFile) => {
      // 剪贴板里的图片常没有文件名,补一个,避免后端按扩展名处理时出错
      const file = rawFile.name
        ? rawFile
        : new File([rawFile], `pasted-${Date.now()}.${rawFile.type.split("/")[1] || "png"}`, { type: rawFile.type });
      const objectUrl = URL.createObjectURL(file);
      referenceObjectUrlsRef.current.add(objectUrl);
      return {
        key: createReferenceKey("upload"),
        type: "upload" as const,
        file,
        title: file.name,
        detail: formatFileSize(file.size),
        imageSrc: objectUrl,
        objectUrl
      };
    });
    addSelectedReferences(nextReferences);
  }

  function handleReferenceFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    addUploadFiles(Array.from(event.currentTarget.files ?? []));
    if (referenceFileInputRef.current) {
      referenceFileInputRef.current.value = "";
    }
  }

  // 对单张参考图做 AI 4K 高清化:上传项发文件、参考库项发 referenceImageId、生成图项走生成图高清化接口。
  // 结果作为新记录入队,完成后经队列同步出现在「最近记录 / 记录」。
  async function upscaleReference(reference: SelectedReference) {
    setUpscalingKey(reference.key);
    setUpscaleError("");
    try {
      let response: Response;
      if (reference.type === "generated" && reference.id) {
        response = await fetch(`/api/images/${reference.id}/upscale`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "ai" })
        });
      } else if (reference.type === "upload" && reference.file) {
        const body = new FormData();
        body.append("image", reference.file, reference.file.name || "upload.png");
        response = await fetch("/api/images/upscale-upload", { method: "POST", body });
      } else if (reference.type === "library" && reference.id) {
        const body = new FormData();
        body.append("referenceImageId", reference.id);
        response = await fetch("/api/images/upscale-upload", { method: "POST", body });
      } else {
        setUpscaleConfirmKey("");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setUpscaleError(data.error ?? "高清化失败");
        return;
      }
      setUpscaleConfirmKey("");
      void loadRecentJobs(true);
    } catch {
      setUpscaleError("网络错误,请重试");
    } finally {
      setUpscalingKey("");
    }
  }

  function appendSelectedReferences(formData: FormData) {
    const items: Array<{ type: "upload" | "generated" | "library"; id?: string; uploadIndex?: number }> = [];
    let uploadIndex = 0;
    for (const reference of selectedReferences) {
      if (reference.type === "upload" && reference.file) {
        formData.append("referenceImages", reference.file, reference.file.name);
        items.push({ type: "upload", uploadIndex });
        uploadIndex += 1;
      } else if (reference.type === "generated" && reference.id) {
        formData.append("referenceImageIds", reference.id);
        items.push({ type: "generated", id: reference.id });
      } else if (reference.type === "library" && reference.id) {
        formData.append("existingRefIds", reference.id);
        items.push({ type: "library", id: reference.id });
      }
    }
    if (items.length > 0) {
      formData.set("referenceItems", JSON.stringify(items));
    }
  }

  return (
    <div className="workspace">
      <form className="panel generation-panel" onSubmit={submit}>
        <div className="panel-header">
          <h1 className="panel-title">生成图片</h1>
          <span className="status">Provider</span>
        </div>
        <div className="panel-body generation-form">
          <section className="form-section prompt-section">
            <div className="form-section-title">
              <span>提示词</span>
              <span className="small muted">{prompt.trim().length} 字</span>
            </div>
            {promptTemplates.length > 0 ? (
              <div className="field generation-template">
                <label htmlFor="prompt-template">提示词模板</label>
                <div className="template-picker">
                  <select
                    className="select"
                    id="prompt-template"
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                  >
                    <option value="">选择模板</option>
                    {promptTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        [{template.category}] {template.title}
                      </option>
                    ))}
                  </select>
                  <button className="status" type="button" onClick={() => applyPromptTemplate("replace")} disabled={!selectedTemplateId}>
                    填入
                  </button>
                  <button className="status" type="button" onClick={() => applyPromptTemplate("append")} disabled={!selectedTemplateId}>
                    追加
                  </button>
                </div>
              </div>
            ) : null}
            <div className="field prompt-field">
              <label htmlFor="prompt">画面描述</label>
              <textarea
                ref={promptTextareaRef}
                className="textarea"
                id="prompt"
                name="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                placeholder="描述你要生成的画面、风格、主体、构图和细节"
                required
              />
            </div>
          </section>

          <section className="form-section parameter-section">
            <div className="form-section-title">
              <span>参数</span>
              <span className="small muted">{model} · {size} · {count} 张</span>
            </div>
            <div className="generation-controls">
              <div className="field">
                <label htmlFor="model">模型</label>
                <select className="select" id="model" name="model" value={model} onChange={(event) => setModel(event.target.value)}>
                  {models.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>
              {presets.length >= 2 ? (
                <div className="field">
                  <label htmlFor="preset">Provider</label>
                  <select
                    className="select"
                    id="preset"
                    name="presetId"
                    value={presetId}
                    onChange={(event) => setPresetId(event.target.value)}
                  >
                    <option value={ROTATE_PRESET_ID}>🔄 自动轮换(全部 Provider)</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                        {preset.isDefault ? "（默认）" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="presetId" value={presetId} />
              )}
              <div className="field">
                <label htmlFor="size">尺寸</label>
                <select className="select" id="size" name="size" value={size} onChange={(event) => setSize(event.target.value)}>
                  <option value="auto">自动 - auto</option>
                  <option value="1024x1024">1:1 - 1024x1024</option>
                  <option value="1024x1824">9:16 - 1024x1824</option>
                  <option value="1824x1024">16:9 - 1824x1024</option>
                  <option value="1360x1024">4:3 - 1360x1024</option>
                  <option value="1024x1360">3:4 - 1024x1360</option>
                  <option value="2880x2880">1:1 4K - 2880x2880</option>
                  <option value="3840x2160">16:9 4K - 3840x2160</option>
                  <option value="2160x3840">9:16 4K - 2160x3840</option>
                  <option value="3264x2448">4:3 4K - 3264x2448</option>
                  <option value="2448x3264">3:4 4K - 2448x3264</option>
                  <option value="custom">自定义…</option>
                </select>
                {size === "custom" ? (
                  <div className="custom-size-row">
                    <input
                      className="input"
                      type="number"
                      min={256}
                      max={3840}
                      step={16}
                      value={customWidth}
                      onChange={(event) => setCustomWidth(event.target.value)}
                      aria-label="自定义宽度（像素）"
                      placeholder="宽"
                    />
                    <span className="custom-size-x">×</span>
                    <input
                      className="input"
                      type="number"
                      min={256}
                      max={3840}
                      step={16}
                      value={customHeight}
                      onChange={(event) => setCustomHeight(event.target.value)}
                      aria-label="自定义高度（像素）"
                      placeholder="高"
                    />
                    <span className="small muted custom-size-hint">→ {normalizeImageSize(`${customWidth}x${customHeight}`)}（自动取 16 倍数 / 限 4K）</span>
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="count">数量</label>
                <select className="select" id="count" name="count" value={count} onChange={(event) => setCount(event.target.value)}>
                  <option value="1">1 张</option>
                  <option value="2">2 张</option>
                  <option value="3">3 张</option>
                  <option value="4">4 张</option>
                </select>
              </div>
            </div>
          </section>

          <section className="form-section reference-section">
            <button
              className="form-section-title reference-section-toggle"
              type="button"
              aria-expanded={referencesOpen}
              aria-controls="reference-section-body"
              onClick={() => setReferencesOpen((current) => !current)}
            >
              <span>参考图</span>
              <span className="reference-section-toggle-meta">
                <span className="small muted">{referenceSummary} · 最多 {limits.maxReferenceImages} 张</span>
                <span className="status action-button action-neutral reference-section-toggle-status">
                  <ChevronDown size={14} />
                  {referencesOpen ? "收起" : "展开"}
                </span>
              </span>
            </button>
            {referencesOpen ? (
              <div className="reference-section-body" id="reference-section-body">
                <div className="reference-picker">
                  <label
                    className={`reference-option upload-reference-option ${selectedReferences.some((reference) => reference.type === "upload") ? "selected" : ""}`}
                    htmlFor="referenceImage"
                  >
                    <span className="reference-option-thumb reference-upload-thumb">
                      <ImagePlus size={20} />
                    </span>
                    <span>上传参考</span>
                    <small>PNG / JPG / WebP，可多选 · 支持 Ctrl+V 粘贴截图</small>
                  </label>
                  {recentReferenceImages.map((reference, index) => (
                    <button
                      key={reference.id}
                      className={`reference-option reference-option-image${selectedReferences.some((item) => item.key === `library:${reference.id}`) ? " selected" : ""}`}
                      type="button"
                      onClick={() => toggleLibraryReference(reference)}
                    >
                      <img src={`/api/reference-images/${reference.id}?thumb=1`} alt="" />
                      <span>{index === 0 ? "最近参考" : `参考 ${index + 1}`}</span>
                      <small>{selectedReferences.some((item) => item.key === `library:${reference.id}`) ? "已选择" : formatFileSize(reference.byte_size)}</small>
                    </button>
                  ))}
                </div>
                <input
                  ref={referenceFileInputRef}
                  className="file-input"
                  id="referenceImage"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={handleReferenceFileChange}
                />
                <div className="reference-selection-stack">
                  {selectedReferences.length > 0 ? (
                    <>
                      {selectedReferences.map((reference, index) => (
                        <div
                          className={`reference-chip current-reference-chip ${reference.type === "upload" ? "upload-reference-chip" : ""}`}
                          key={reference.key}
                        >
                          {reference.imageSrc ? (
                            <img src={reference.imageSrc} alt="" />
                          ) : (
                            <div className="reference-chip-icon">
                              <ImagePlus size={20} />
                            </div>
                          )}
                          <div>
                            <div className="reference-chip-title-row">
                              <strong>{index === 0 ? "主参考图" : `参考图 ${index + 1}`}</strong>
                              <span className="status">{referenceSourceLabel(reference.type)}</span>
                            </div>
                            <p className="small muted">{reference.title} · {reference.detail}</p>
                          </div>
                          <div className="reference-chip-actions">
                            <button className="status" type="button" disabled={index === 0} onClick={() => moveSelectedReference(reference.key, -1)}>
                              <ArrowUp size={13} />
                            </button>
                            <button
                              className="status"
                              type="button"
                              disabled={index === selectedReferences.length - 1}
                              onClick={() => moveSelectedReference(reference.key, 1)}
                            >
                              <ArrowDown size={13} />
                            </button>
                            <button
                              className="status action-button action-upscale"
                              type="button"
                              disabled={upscalingKey === reference.key}
                              onClick={() => {
                                setUpscaleError("");
                                setUpscaleConfirmKey(reference.key);
                              }}
                            >
                              <Sparkles size={13} />
                              {upscalingKey === reference.key ? "处理中…" : "高清化"}
                            </button>
                            <button className="status" type="button" onClick={() => removeSelectedReference(reference.key)}>
                              <X size={13} />
                              移除
                            </button>
                          </div>
                        </div>
                      ))}
                      <button className="status reference-clear-all" type="button" onClick={clearAllReferences}>
                        清空参考图
                      </button>
                    </>
                  ) : (
                    <p className="small muted reference-empty-copy">未选择参考图。可上传多张、选择最近参考图，或在图片卡片点击“编辑”加入参考图。</p>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <DangerConfirmDialog
            open={Boolean(upscaleConfirmKey)}
            title="确认高清化"
            description="将对这张参考图做 AI 4K 高清重绘:会消耗一次生成额度,且可能轻微改变画面。"
            confirmLabel="确认重绘"
            loadingLabel="提交中"
            loading={Boolean(upscalingKey)}
            error={upscaleError}
            icon={<Sparkles size={20} />}
            confirmIcon={<Sparkles size={16} />}
            onClose={() => {
              if (upscalingKey) return;
              setUpscaleConfirmKey("");
              setUpscaleError("");
            }}
            onConfirm={() => {
              const target = selectedReferences.find((item) => item.key === upscaleConfirmKey);
              if (target) void upscaleReference(target);
            }}
          />

          <div className="generation-submit">
            {error ? <p className="small form-error">{error}</p> : null}
            <div className="generation-summary-bar" aria-label="生成参数确认">
              <span>{modelLabel}</span>
              <span>{size}</span>
              <span>{count} 张</span>
              <span>{referenceSummary}</span>
            </div>
            <button className="button" type="submit" disabled={loading}>
              <Play size={17} />
              {loading ? "生成中" : "开始生成"}
            </button>
          </div>
        </div>
      </form>

      <div className="center-stack">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">结果预览</h2>
            {activeSummary ? <span className={`status ${activeSummary.status}`}>{activeSummary.label}</span> : null}
          </div>
          <div className="panel-body">
            {activeImages.length > 0 ? (
              <div className="preview-stack">
                {activeSummary && !activeSummary.terminal ? (
                  <div className="inline-progress batch-progress" aria-label="批量生成进度">
                    <div className="flow-track" aria-hidden="true">
                      <div className={`flow-bar ${activeSummary.status}`} style={{ width: `${activeSummary.percent}%` }} />
                      <div className="flow-tail" style={{ left: progressTailLeft(activeSummary.percent) }} />
                    </div>
                    <p className="small muted">{activeSummary.percent}% · 已保存 {activeSummary.saved} / {activeSummary.total} 张</p>
                    {activePhaseTimingsText ? (
                      <p className="small muted phase-timings">{activePhaseTimingsText}</p>
                    ) : null}
                  </div>
                ) : null}
                <div className="preview-grid">
                  {activeImages.map((image, index) => (
                    <ImageCard
                      key={image.id}
                      image={image}
                      galleryItems={activeLightboxItems}
                      galleryIndex={index}
                      onEdit={editFromImage}
                    />
                  ))}
                </div>
              </div>
            ) : loading ? (
              <div className="empty-state preview-empty-state">
                <div className="preview-placeholder" aria-hidden="true">
                  <span className="preview-placeholder-tile wide" />
                  <span className="preview-placeholder-tile" />
                  <span className="preview-placeholder-tile" />
                </div>
                <div className="preview-empty-copy">
                  <ImagePlus size={34} />
                  <p>{activeSummary?.message ?? "正在创建后台任务"}</p>
                  {activeSummary ? (
                    <div className="inline-progress" aria-label="生成进度">
                      <div className="flow-track" aria-hidden="true">
                        <div className={`flow-bar ${activeSummary.status}`} style={{ width: `${activeSummary.percent}%` }} />
                        {!activeSummary.terminal ? <div className="flow-tail" style={{ left: progressTailLeft(activeSummary.percent) }} /> : null}
                      </div>
                      <p className="small muted">{activeSummary.percent}% · 已保存 {activeSummary.saved} / {activeSummary.total} 张</p>
                      {activePhaseTimingsText ? (
                        <p className="small muted phase-timings">{activePhaseTimingsText}</p>
                      ) : null}
                    </div>
                  ) : (
                    null
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-state preview-empty-state">
                <div className="preview-placeholder" aria-hidden="true">
                  <span className="preview-placeholder-tile wide" />
                  <span className="preview-placeholder-tile" />
                  <span className="preview-placeholder-tile" />
                </div>
                <div className="preview-empty-copy">
                  <ImagePlus size={34} />
                  <p>生成结果会出现在这里</p>
                  <p className="small muted">填写提示词、选择参数后，新的图片会在这里铺开预览。</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">任务队列</h2>
            <div className="actions">
              <button className="status" type="button" onClick={() => loadQueueStatus()} disabled={queueLoading}>
                {queueLoading ? "刷新中" : "刷新"}
              </button>
            </div>
          </div>
          <div className="panel-body queue-list">
            <div className="queue-summary">
              <span className="status running">运行 <span className="num">{queue.running} / {queue.concurrency}</span></span>
              <span className="status queued">排队 <span className="num">{queue.queued}</span></span>
            </div>
            {queueLoading && queue.jobs.length === 0 ? <p className="muted small">正在加载任务队列...</p> : null}
            {!queueLoading && queue.jobs.length === 0 ? <p className="muted small">当前没有排队或运行中的任务。</p> : null}
            {queue.jobs.map((item) => (
              <article className="queue-item" key={item.id}>
                <div className="queue-item-head">
                  <span className={`status ${item.status}`}>{generationStatusLabel(item.status)}</span>
                  <span className="small muted">
                    {item.status === "queued" && item.queue_position ? <>队列 <span className="num">#{item.queue_position}</span></> : item.username ?? ""}
                  </span>
                </div>
                <p className="small queue-prompt">{item.prompt.slice(0, 72)}</p>
                {item.progress ? (
                  <>
                    <div className="flow-track queue-progress" aria-label="任务进度">
                      <div className={`flow-bar ${item.status}`} style={{ width: `${item.progress.percent}%` }} />
                      <div className="flow-tail" style={{ left: progressTailLeft(item.progress.percent) }} />
                    </div>
                    <p className="small muted">
                      <span className="num">{item.progress.percent}%</span> · 已保存 <span className="num">{item.progress.current} / {item.count}</span> 张
                    </p>
                    {(() => {
                      const text = formatPhaseTimings(item.progress.phaseTimings);
                      return text ? <p className="small muted phase-timings">{text}</p> : null;
                    })()}
                  </>
                ) : (
                  <p className="small muted"><span className="num">{item.count}</span> 张 · {item.model}</p>
                )}
                <div className="actions">
                  <JobControlButton action="cancel" recordId={item.id} onDone={refreshJobLists} />
                  <a className="status action-button action-detail" href={`/records/${item.id}`}>详情</a>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <aside className="side-stack">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">最近记录</h2>
            <div className="actions">
              <button className="status" type="button" onClick={() => loadRecentJobs()} disabled={historyLoading}>
                {historyLoading ? "加载中" : "加载"}
              </button>
              <a className="status" href="/records">全部</a>
            </div>
          </div>
          <div className="panel-body history-list">
            {historyLoading ? <p className="muted small">正在加载最近记录...</p> : null}
            {!historyLoading && !historyLoaded && history.length === 0 ? <p className="muted small">还没有加载最近记录。</p> : null}
            {!historyLoading && historyLoaded && history.length === 0 ? <p className="muted small">还没有生成记录。</p> : null}
            {history.map((recent) => {
              const resTier = resolutionTier(recent.thumbnail_width, recent.thumbnail_height);
              const resBadge = resTier ? <span className={`res-badge res-badge-${resTier === "4K" ? "4k" : "2k"}`}>{resTier}</span> : null;
              // 无输出图(失败/排队中)但是编辑/参考任务时,用「源图」缩略图 + 「编辑源」角标,方便看出编辑的是哪张。
              const refThumbUrl = recent.thumbnail_id
                ? null
                : recent.ref_source_image_id
                  ? imageThumbnailUrl(recent.ref_source_image_id)
                  : recent.ref_library_image_id
                    ? `/api/reference-images/${recent.ref_library_image_id}?${THUMBNAIL_QUERY}`
                    : null;
              const refBadge = refThumbUrl ? <span className="ref-badge">编辑源</span> : null;
              const recentThumb = recent.thumbnail_id ? (
                <ImageWithSkeleton className="thumb" wrapperClassName="thumb-skeleton" src={imageThumbnailUrl(recent.thumbnail_id)} alt="" />
              ) : refThumbUrl ? (
                <ImageWithSkeleton className="thumb" wrapperClassName="thumb-skeleton" src={refThumbUrl} alt="编辑源图" />
              ) : (
                <div className="thumb" />
              );
              return (
              <article className="history-item" key={recent.id}>
                {!recent.localOnly ? (
                  <a className="thumb-link" href={`/records/${recent.id}`} aria-label="查看记录详情">
                    {recentThumb}
                    {resBadge}
                    {refBadge}
                  </a>
                ) : (
                  <div className="thumb-link">
                    {recentThumb}
                    {resBadge}
                    {refBadge}
                  </div>
                )}
                <div className="history-content">
                  <div className="history-status-row">
                    <div className={`status ${recent.status}`}>{generationStatusLabel(recent.status)}</div>
                    <span className="small muted history-meta">{recent.model} · {recent.username ?? ""}</span>
                    <CopyPromptButton prompt={recent.prompt} />
                  </div>
                  <p className="small history-prompt" title={recent.prompt}>{recent.prompt}</p>
                  <div className="actions">
                    {recent.localOnly ? (
                      <span className={`status ${recent.status}`}>{generationStatusLabel(recent.status)}</span>
                    ) : null}
                    {!recent.localOnly && isRetryableGenerationStatus(recent.status) ? (
                      <JobControlButton action="requeue" recordId={recent.id} onDone={refreshJobLists} />
                    ) : null}
                    {!recent.localOnly && (recent.status === "queued" || recent.status === "running") ? (
                      <JobControlButton action="cancel" recordId={recent.id} onDone={refreshJobLists} />
                    ) : null}
                    {recent.thumbnail_id ? (
                      <ReferenceBasketButton imageId={recent.thumbnail_id} prompt={recent.prompt} />
                    ) : null}
                    {!recent.localOnly && recent.thumbnail_id ? (
                      <FavoriteImageButton imageId={recent.thumbnail_id} initialFavorite={recent.thumbnail_favorite ?? false} />
                    ) : null}
                    {!recent.localOnly && recent.status !== "queued" && recent.status !== "running" ? (
                      <DeleteRecordButton recordId={recent.id} onDeleted={() => removeHistoryItem(recent.id)} />
                    ) : null}
                    {recent.status === "succeeded" ? (
                      <button className="status action-button action-rerun" type="button" onClick={() => applyTaskParams(recent)} disabled={loading}>
                        <RefreshCcw size={13} />
                        重做
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        </section>
      </aside>
    </div>
  );
}

function normalizeModel(value: string | null, models: ModelOption[], fallback: string) {
  if (value && models.some((model) => model.value === value)) return value;
  return fallback || models[0]?.value || "";
}

// 把一个尺寸值解析成下拉选择状态:命中预设档→选中该档;形如 WxH 的非预设→「自定义」并回填宽高;否则 auto。
function pickSizeSelection(raw: string | null): { size: string; width: string; height: string } {
  const value = (raw ?? "").trim();
  if (value && sizeValues.has(value)) return { size: value, width: "", height: "" };
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value);
  if (match) return { size: "custom", width: match[1], height: match[2] };
  return { size: "auto", width: "", height: "" };
}

function normalizeCount(value: string | null) {
  return value && countValues.has(value) ? value : "1";
}

function imageToLightboxItem(image: GeneratedImage): LightboxItem {
  return {
    src: `/api/images/${image.id}`,
    downloadHref: `/api/images/${image.id}/download`,
    alt: "生成图片"
  };
}

function ImageCard({
  image,
  galleryItems,
  galleryIndex,
  onEdit
}: {
  image: GeneratedImage;
  galleryItems: LightboxItem[];
  galleryIndex: number;
  onEdit: (imageId: string) => void;
}) {
  return (
    <article className="image-card">
      <ImageLightbox
        src={`/api/images/${image.id}`}
        downloadHref={`/api/images/${image.id}/download`}
        alt="生成图片"
        items={galleryItems}
        initialIndex={galleryIndex}
      >
        <ImageWithSkeleton src={imageThumbnailUrl(image.id)} alt="生成图片" />
      </ImageLightbox>
      <footer>
        <div className="image-card-meta">
          <span className="small muted">{Math.round(image.byte_size / 1024)} KB</span>
          <ImageTagsEditor imageId={image.id} initialTags={image.tags ?? []} />
        </div>
        <div className="actions image-card-actions">
          <FavoriteImageButton imageId={image.id} initialFavorite={image.is_favorite ?? false} />
          <ReferenceBasketButton imageId={image.id} />
          <button className="status action-button action-edit" type="button" onClick={() => onEdit(image.id)}>
            <Pencil size={13} />
            编辑
          </button>
          <a className="status action-button action-download" href={`/api/images/${image.id}/download`}>
            <Download size={13} />
            下载
          </a>
        </div>
      </footer>
    </article>
  );
}
