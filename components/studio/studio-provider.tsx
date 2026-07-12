"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dispatchJobNotification } from "../job-notification-center";
import { REFERENCE_BASKET_APPLY_EVENT, readReferenceBasketItems, type ReferenceBasketItem } from "../reference-basket";
import { normalizeImageSize } from "@/lib/image-size";
import { imageThumbnailUrl } from "@/lib/thumbnails";
import type { GroupModelOption } from "@/lib/model-groups";
import type { JobWithImages } from "@/lib/types";
import {
  ACTIVE_JOB_POLL_MS,
  ACTIVE_QUEUE_POLL_MS,
  DEFAULT_LIMITS,
  IDLE_QUEUE_POLL_MS,
  MODEL_SELECTION_STORAGE_KEY,
  activePhaseTimingsFromJobs,
  basketItemsToSelectedReferences,
  createReferenceKey,
  formatFileSize,
  formatPhaseTimings,
  imageToLightboxItem,
  initialQueueSnapshot,
  isAbortError,
  isTerminalStatus,
  jobToRecent,
  normalizeCount,
  optionKey,
  pickSizeSelection,
  queueHasWork,
  summarizeJobs,
  waitFor,
  type GenerateResponse,
  type HistoryJob,
  type LimitsConfig,
  type PromptTemplateOption,
  type QueueSnapshot,
  type RecentJob,
  type RecentReferenceImage,
  type SelectedReference
} from "./studio-model";

export type StudioProviderProps = {
  groupModelOptions: GroupModelOption[];
  defaultGroupId: string | null;
  promptTemplates: PromptTemplateOption[];
  recentReferenceImages: RecentReferenceImage[];
  promptOptimizeEnabled?: boolean;
};

/**
 * 创作台状态中心:原 workspace.tsx 的全部 state/effect/函数逐字搬迁至此,
 * 供三栏 + 底部 Composer 四个区域经 useStudio() 共享。
 * 唯一行为改动:submit 从 new FormData(form) 收集 DOM 改为纯受控构造(字段完全一致)。
 */
function useStudioState({
  groupModelOptions,
  defaultGroupId,
  promptTemplates,
  recentReferenceImages,
  promptOptimizeEnabled = false
}: StudioProviderProps) {
  // 同名模型跨组合并为一项;label 取默认组的,否则第一处出现的。
  const dedupedModels = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of groupModelOptions) {
      if (!map.has(o.model) || o.groupId === defaultGroupId) map.set(o.model, o.label);
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [groupModelOptions, defaultGroupId]);
  // 服务某模型的组列表(去重)。多组时可手动指定线路,默认自动轮询。
  const servingGroupsFor = (modelValue: string) => {
    const seen = new Set<string>();
    const groups: Array<{ groupId: string; groupName: string }> = [];
    for (const o of groupModelOptions) {
      if (o.model !== modelValue || seen.has(o.groupId)) continue;
      seen.add(o.groupId);
      groups.push({ groupId: o.groupId, groupName: o.groupName });
    }
    return groups;
  };
  // 初始:默认组的首个模型,否则第一项;线路默认自动轮询(groupId 空串)。
  const initialModel = useMemo(() => {
    return (
      groupModelOptions.find((o) => o.groupId === defaultGroupId)?.model ??
      groupModelOptions[0]?.model ??
      ""
    );
  }, [groupModelOptions, defaultGroupId]);
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
  const [model, setModel] = useState(initialModel);
  // 线路:空串 = 自动(在服务该模型的组之间轮询);指定组 id = 锁定该组。
  const [groupId, setGroupId] = useState("");
  const [size, setSize] = useState("auto");
  const [customWidth, setCustomWidth] = useState("2048");
  const [customHeight, setCustomHeight] = useState("2048");
  const [upscalingKey, setUpscalingKey] = useState("");
  const [upscaleConfirmKey, setUpscaleConfirmKey] = useState("");
  const [upscaleError, setUpscaleError] = useState("");
  const [count, setCount] = useState("1");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedRecentIndex, setSelectedRecentIndex] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState("");
  const [optimizeUndo, setOptimizeUndo] = useState<string | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<{ original: string; optimized: string } | null>(null);
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([]);
  const [maskOpen, setMaskOpen] = useState(false);
  const [maskBlob, setMaskBlob] = useState<Blob | null>(null);
  // 局部重绘合成开关:开(默认)=出图后把编辑区贴回原图高清版;关=直接用模型编辑图。
  const [maskComposite, setMaskComposite] = useState(true);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [limits, setLimits] = useState<LimitsConfig>(DEFAULT_LIMITS);
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

  // 最近用过的提示词:从已加载的最近记录按文本去重,取最近 12 条,供输入框快速召回。
  const recentPrompts = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of history) {
      const text = item.prompt?.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
      if (result.length >= 12) break;
    }
    return result;
  }, [history]);

  const activeJobs = useMemo(() => (batchJobs.length > 0 ? batchJobs : job ? [job] : []), [batchJobs, job]);
  const activeImages = useMemo(() => activeJobs.flatMap((currentJob) => currentJob.images), [activeJobs]);
  const activeLightboxItems = useMemo(() => activeImages.map(imageToLightboxItem), [activeImages]);
  const activeSummary = useMemo(() => summarizeJobs(activeJobs), [activeJobs]);
  const activePhaseTimingsText = useMemo(() => {
    const timings = activePhaseTimingsFromJobs(activeJobs);
    return formatPhaseTimings(timings);
  }, [activeJobs]);
  // 当前模型可用的线路(组);≥2 条时显示线路选择。
  const servingGroups = servingGroupsFor(model);
  const pinnedGroup = groupId ? servingGroups.find((g) => g.groupId === groupId) ?? null : null;
  const modelLabel = (() => {
    const base = dedupedModels.find((m) => m.value === model)?.label ?? model;
    return pinnedGroup ? `${base} · ${pinnedGroup.groupName}` : base;
  })();
  const referenceSummary = selectedReferences.length > 0 ? `${selectedReferences.length} 张参考图` : "无参考图";
  // 局部重绘蒙版画在第一张参考图上(上传用 objectUrl,生成/库用 imageSrc)。
  const primaryReferenceSrc = selectedReferences[0]?.objectUrl ?? selectedReferences[0]?.imageSrc ?? "";

  // 参考图清空时,关掉局部重绘并丢弃蒙版。
  useEffect(() => {
    if (selectedReferences.length === 0) {
      setMaskOpen(false);
      setMaskBlob(null);
    }
  }, [selectedReferences.length]);

  // 蒙版预览:把黑白蒙版(白=要改)着色成红色半透明 PNG,叠加在主参考图缩略图上,
  // 让用户不打开编辑器也能看到涂抹了哪里。
  const [maskPreviewUrl, setMaskPreviewUrl] = useState("");
  useEffect(() => {
    if (!maskBlob) {
      setMaskPreviewUrl("");
      return;
    }
    let cancelled = false;
    let url = "";
    (async () => {
      try {
        const bitmap = await createImageBitmap(maskBlob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.data.length; i += 4) {
          const painted = data.data[i] > 128;
          data.data[i] = 239;
          data.data[i + 1] = 68;
          data.data[i + 2] = 68;
          data.data[i + 3] = painted ? 150 : 0;
        }
        ctx.putImageData(data, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setMaskPreviewUrl(url);
      } catch {
        // 预览失败不影响蒙版本身
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [maskBlob]);

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
    const urlModel = params.get("model");
    const nextModel = urlModel && groupModelOptions.some((o) => o.model === urlModel) ? urlModel : model;
    const sizeSel = pickSizeSelection(params.get("size"));
    const nextCount = normalizeCount(params.get("count"));

    if (nextPrompt) setPrompt(nextPrompt);
    if (nextModel) {
      setModel(nextModel);
      setGroupId(""); // URL 复用不带组:走自动轮询
    }
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
      formData.set("groupId", ""); // 自动轮询
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 模型选择记忆(groupId::model,groupId 空串 = 自动轮询):挂载时若存的模型仍在选项里则恢复;
  // 存的指定组已不再服务该模型时,只恢复模型、线路退回自动。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY);
      if (!stored) return;
      const separator = stored.indexOf("::");
      if (separator < 0) return;
      const storedGroupId = stored.slice(0, separator);
      const storedModel = stored.slice(separator + 2);
      if (!storedModel || !groupModelOptions.some((o) => o.model === storedModel)) return;
      setModel(storedModel);
      // 仅当存的组仍服务该模型、且该模型仍有多条线路(线路下拉可见,用户能改回自动)时才保留锁定。
      const servingIds = new Set(
        groupModelOptions.filter((o) => o.model === storedModel).map((o) => o.groupId)
      );
      const keepPin = Boolean(storedGroupId) && servingIds.has(storedGroupId) && servingIds.size > 1;
      setGroupId(keepPin ? storedGroupId : "");
    } catch {
      // localStorage 不可用,忽略
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选择变化时持久化(groupId 可为空串 = 自动)。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (model) window.localStorage.setItem(MODEL_SELECTION_STORAGE_KEY, optionKey(groupId, model));
    } catch {
      // 忽略 localStorage 异常
    }
  }, [groupId, model]);

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

  /**
   * 提交生成:纯受控构造 FormData(字段与旧 new FormData(form) 完全一致:
   * prompt/model/groupId/size/count + appendSelectedReferences 追加的参考图/蒙版字段)。
   */
  async function submit() {
    const formData = new FormData();
    formData.set("prompt", prompt);
    formData.set("model", model);
    formData.set("groupId", groupId);
    // 自定义尺寸时用归一化后的 WxH 覆盖 select 的 "custom" 占位值;预设/auto 原样提交
    formData.set("size", size === "custom" ? normalizeImageSize(`${customWidth}x${customHeight}`) : size);
    formData.set("count", count);
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
    // 复用历史任务的模型:仍有组服务它则选中,线路走自动轮询;否则保持当前选择。
    if (recent.model && groupModelOptions.some((o) => o.model === recent.model)) {
      setModel(recent.model);
      setGroupId("");
    }
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

  function applyRecentPrompt(mode: "replace" | "append") {
    const text = recentPrompts[Number(selectedRecentIndex)];
    if (!text) return;
    const current = prompt.trim();
    const prefix = mode === "append" && current ? `${current}\n\n` : "";
    setPrompt(`${prefix}${text}`);
  }

  async function optimizePrompt() {
    const current = prompt.trim();
    if (!current || optimizing || optimizeResult) return;
    setOptimizing(true);
    setOptimizeError("");

    const resolvedSize = size === "custom" ? `${customWidth}x${customHeight}` : size;
    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: current,
          model,
          size: resolvedSize && resolvedSize !== "auto" ? resolvedSize : undefined,
          hasReference: selectedReferences.length > 0
        })
      });
      const data = (await response.json().catch(() => ({}))) as { optimized?: string; error?: string };
      if (!response.ok || !data.optimized) {
        setOptimizeError(data.error ?? "优化失败,请稍后再试");
        return;
      }
      // 不直接覆盖:先给出原文↔优化后的对比,由用户决定采用或放弃。
      setOptimizeResult({ original: current, optimized: data.optimized });
    } catch {
      setOptimizeError("优化请求失败,请检查网络后重试");
    } finally {
      setOptimizing(false);
    }
  }

  function applyOptimizeResult() {
    if (!optimizeResult) return;
    setOptimizeUndo(optimizeResult.original);
    setPrompt(optimizeResult.optimized);
    setOptimizeResult(null);
  }

  function discardOptimizeResult() {
    setOptimizeResult(null);
  }

  function undoOptimize() {
    if (optimizeUndo === null) return;
    setPrompt(optimizeUndo);
    setOptimizeUndo(null);
    setOptimizeError("");
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
    // 局部重绘:有蒙版时随参考图一起提交(作用于第一张参考图)。maskBlob 由全屏编辑器在涂抹后写入,关闭弹窗后仍保留。
    if (maskBlob && selectedReferences.length > 0) {
      formData.append("maskImage", maskBlob, "mask.png");
      // 合成开关:默认开;关掉时显式告知服务端,直接返回模型编辑图。
      formData.append("maskComposite", maskComposite ? "true" : "false");
    }
  }

  return {
    // props 透传
    promptTemplates,
    recentReferenceImages,
    promptOptimizeEnabled,
    // 派生
    dedupedModels,
    servingGroups,
    pinnedGroup,
    modelLabel,
    referenceSummary,
    primaryReferenceSrc,
    recentPrompts,
    activeJobs,
    activeImages,
    activeLightboxItems,
    activeSummary,
    activePhaseTimingsText,
    // 表单参数
    loading,
    error,
    prompt,
    setPrompt,
    model,
    setModel,
    groupId,
    setGroupId,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    count,
    setCount,
    // 模板/召回/优化
    selectedTemplateId,
    setSelectedTemplateId,
    selectedRecentIndex,
    setSelectedRecentIndex,
    optimizing,
    optimizeError,
    optimizeUndo,
    optimizeResult,
    optimizePrompt,
    applyOptimizeResult,
    discardOptimizeResult,
    undoOptimize,
    applyPromptTemplate,
    applyRecentPrompt,
    handlePromptKeyDown,
    promptTextareaRef,
    // 参考图/蒙版
    limits,
    selectedReferences,
    referencesOpen,
    setReferencesOpen,
    referenceFileInputRef,
    handleReferenceFileChange,
    toggleLibraryReference,
    removeSelectedReference,
    clearAllReferences,
    moveSelectedReference,
    maskOpen,
    setMaskOpen,
    maskBlob,
    setMaskBlob,
    maskComposite,
    setMaskComposite,
    maskPreviewUrl,
    upscalingKey,
    upscaleConfirmKey,
    setUpscaleConfirmKey,
    upscaleError,
    setUpscaleError,
    upscaleReference,
    // 结果/历史/队列
    job,
    batchJobs,
    history,
    historyLoading,
    historyLoaded,
    queue,
    queueLoading,
    loadQueueStatus,
    loadRecentJobs,
    applyTaskParams,
    editFromImage,
    removeHistoryItem,
    refreshJobLists,
    // 提交
    submit
  };
}

export type StudioContextValue = ReturnType<typeof useStudioState>;

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children, ...props }: StudioProviderProps & { children: ReactNode }) {
  const value = useStudioState(props);
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const context = useContext(StudioContext);
  if (!context) throw new Error("useStudio must be used within StudioProvider");
  return context;
}
