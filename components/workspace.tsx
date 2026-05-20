"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ImagePlus, Pencil, Play, RefreshCcw, X } from "lucide-react";
import { CopyPromptButton } from "./copy-prompt-button";
import { DeleteRecordButton } from "./delete-record-button";
import { FavoriteImageButton } from "./favorite-image-button";
import { ImageWithSkeleton } from "./image-with-skeleton";
import { ImageLightbox, type LightboxItem } from "./image-lightbox";
import { ImageTagsEditor } from "./image-tags-editor";
import { JobControlButton } from "./job-control-button";
import { dispatchJobNotification } from "./job-notification-center";
import { generationStatusLabel } from "@/lib/generation-status";
import { imageThumbnailUrl } from "@/lib/thumbnails";
import type { GeneratedImage, GenerationJob, JobWithImages, PromptTemplate, ReferenceImage } from "@/lib/types";

type ModelOption = {
  label: string;
  value: string;
};

type RecentJob = GenerationJob & {
  thumbnail_id: string | null;
  thumbnail_favorite?: boolean;
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

type ReferenceFileInfo = {
  name: string;
  byteSize: number;
};

type RecentReferenceImage = Pick<ReferenceImage, "id" | "byte_size">;

type GenerateResponse = {
  job?: JobWithImages | null;
  jobs?: JobWithImages[];
  error?: string;
  jobId?: string;
};

type PromptTemplateOption = Pick<PromptTemplate, "id" | "title" | "category" | "content">;

const sizeValues = new Set(["auto", "1024x1024", "1024x1824", "1824x1024", "1360x1024", "1024x1360"]);
const countValues = new Set(["1", "2", "3", "4"]);
const ACTIVE_QUEUE_POLL_MS = 3500;
const IDLE_QUEUE_POLL_MS = 25000;
const ACTIVE_JOB_POLL_MS = 1800;

const initialQueueSnapshot: QueueSnapshot = { queued: 0, running: 0, concurrency: 1, jobs: [] };
function isTerminalStatus(status: GenerationJob["status"]) {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function progressPercent(job: JobWithImages) {
  if (job.progress) return job.progress.percent;
  if (job.status === "succeeded") return 100;
  if (job.status === "failed") return job.images.length > 0 ? 80 : 45;
  if (job.status === "canceled") return 0;
  if (job.status === "queued") return 5;
  return Math.min(90, Math.max(35, 35 + Math.round((job.images.length / Math.max(1, job.count)) * 45)));
}

function summarizeJobs(jobs: JobWithImages[]) {
  if (jobs.length === 0) return null;

  const saved = jobs.reduce((sum, current) => sum + current.images.length, 0);
  const total = jobs.reduce((sum, current) => sum + Math.max(1, current.count), 0);
  const completed = jobs.filter((current) => isTerminalStatus(current.status)).length;
  const failed = jobs.filter((current) => current.status === "failed").length;
  const canceled = jobs.filter((current) => current.status === "canceled").length;
  const succeeded = jobs.filter((current) => current.status === "succeeded").length;
  const status: GenerationJob["status"] = jobs.some((current) => current.status === "running")
    ? "running"
    : jobs.some((current) => current.status === "queued")
      ? "queued"
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
  return {
    ...nextJob,
    thumbnail_id: nextJob.images?.[0]?.id ?? null,
    thumbnail_favorite: nextJob.images?.[0]?.is_favorite ?? false
  };
}

function progressTailLeft(percent: number) {
  return `${Math.min(99, Math.max(0, percent))}%`;
}

function formatFileSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
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
  const [count, setCount] = useState("1");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [referenceImageId, setReferenceImageId] = useState("");
  const [refImageId, setRefImageId] = useState("");
  const [referenceFileInfo, setReferenceFileInfo] = useState<ReferenceFileInfo | null>(null);
  const autoRunStarted = useRef(false);
  const mountedRef = useRef(false);
  const pollTokenRef = useRef(0);
  const queueTimerRef = useRef<number | null>(null);
  const queueSnapshotRef = useRef<QueueSnapshot>(initialQueueSnapshot);
  const watchedJobIdsRef = useRef<string[]>([]);
  const pollControllerRef = useRef<AbortController | null>(null);
  const queueControllerRef = useRef<AbortController | null>(null);
  const recentControllerRef = useRef<AbortController | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  const activeJobs = useMemo(() => (batchJobs.length > 0 ? batchJobs : job ? [job] : []), [batchJobs, job]);
  const activeImages = useMemo(() => activeJobs.flatMap((currentJob) => currentJob.images), [activeJobs]);
  const activeLightboxItems = useMemo(() => activeImages.map(imageToLightboxItem), [activeImages]);
  const activeSummary = useMemo(() => summarizeJobs(activeJobs), [activeJobs]);
  const modelLabel = models.find((item) => item.value === model)?.label ?? model;
  const referenceSummary = referenceFileInfo
    ? {
        title: "当前参考图",
        source: "上传文件",
        detail: `${referenceFileInfo.name} · ${formatFileSize(referenceFileInfo.byteSize)}`,
        imageSrc: "",
        icon: "upload"
      }
    : referenceImageId
      ? {
          title: "当前参考图",
          source: "从生成图编辑",
          detail: "将已生成图片作为修图参考",
          imageSrc: imageThumbnailUrl(referenceImageId),
          icon: "image"
        }
      : refImageId
        ? {
            title: "当前参考图",
            source: "参考图库",
            detail: "使用已保存的参考图",
            imageSrc: `/api/reference-images/${refImageId}?thumb=1`,
            icon: "image"
          }
        : null;

  useEffect(() => {
    mountedRef.current = true;
    void loadRecentJobs();
    void loadQueueStatus();
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearQueueTimer();
        queueControllerRef.current?.abort();
        pollControllerRef.current?.abort();
        return;
      }

      void loadQueueStatus(true);
      if (watchedJobIdsRef.current.length > 0) {
        void pollJobs(watchedJobIdsRef.current);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const params = new URLSearchParams(window.location.search);
    const editImageId = params.get("referenceImageId");
    const existingRefId = params.get("refImageId");
    const nextPrompt = params.get("prompt") ?? "";
    const nextModel = normalizeModel(params.get("model"), models, model);
    const nextSize = normalizeSize(params.get("size"));
    const nextCount = normalizeCount(params.get("count"));

    if (nextPrompt) setPrompt(nextPrompt);
    if (nextModel) setModel(nextModel);
    setSize(nextSize);
    setCount(nextCount);

    if (editImageId) {
      setReferenceImageId(editImageId);
    }
    if (existingRefId) {
      setRefImageId(existingRefId);
    }

    if (params.get("autorun") === "1" && nextPrompt && !autoRunStarted.current) {
      autoRunStarted.current = true;
      const formData = new FormData();
      formData.set("prompt", nextPrompt);
      formData.set("model", nextModel);
      formData.set("size", nextSize);
      formData.set("count", nextCount);
      if (editImageId) formData.set("referenceImageId", editImageId);
      if (existingRefId) formData.set("existingRefId", existingRefId);
      void startGeneration(formData);
    }

    if (editImageId || existingRefId || nextPrompt || params.get("autorun") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
    }

    return () => {
      mountedRef.current = false;
      clearQueueTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      pollControllerRef.current?.abort();
      queueControllerRef.current?.abort();
      recentControllerRef.current?.abort();
    };
  }, []);

  function clearQueueTimer() {
    if (queueTimerRef.current !== null) {
      window.clearTimeout(queueTimerRef.current);
      queueTimerRef.current = null;
    }
  }

  function scheduleQueueRefresh(snapshot = queueSnapshotRef.current) {
    clearQueueTimer();
    if (!mountedRef.current || document.hidden) return;
    const delay = queueHasWork(snapshot) ? ACTIVE_QUEUE_POLL_MS : IDLE_QUEUE_POLL_MS;
    queueTimerRef.current = window.setTimeout(() => {
      void loadQueueStatus(true);
    }, delay);
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
        queueSnapshotRef.current = nextQueue;
        setQueue(nextQueue);
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

  async function loadRecentJobs() {
    setHistoryLoading(true);
    recentControllerRef.current?.abort();
    const controller = new AbortController();
    recentControllerRef.current = controller;
    try {
      const response = await fetch("/api/recent-jobs", { cache: "no-store", signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (response.ok && mountedRef.current && !controller.signal.aborted) {
        setHistory(data.jobs ?? []);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn("Recent jobs refresh failed:", error);
      }
    } finally {
      if (recentControllerRef.current === controller) recentControllerRef.current = null;
      if (mountedRef.current) {
        setHistoryLoaded(true);
        setHistoryLoading(false);
      }
    }
  }

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
      provider: "ai.zh.ci",
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
      setError(data.error ?? "生成失败");
      setHistory((current) =>
        current.map((item) =>
          pendingIds.has(item.id)
            ? {
                ...item,
                id: pendingJobs.length === 1 ? data.jobId ?? item.id : item.id,
                status: "failed",
                error_message: data.error ?? "生成失败",
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
    await startGeneration(new FormData(event.currentTarget));
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
          const failed = results.filter((item) => item.status === "failed");
          if (failed.length > 0) {
            setError(failed.length === 1 ? failed[0].error_message ?? "生成失败" : `${failed.length} 个任务生成失败，请在记录里查看详情`);
          }
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
    setSize(normalizeSize(recent.size));
    setCount(normalizeCount(String(recent.count)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function editFromImage(imageId: string) {
    clearReferenceFile();
    setRefImageId("");
    setReferenceImageId(imageId);
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

  function handleReferenceFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) {
      setReferenceImageId("");
      setRefImageId("");
    }
    setReferenceFileInfo(file ? { name: file.name, byteSize: file.size } : null);
  }

  function clearReferenceFile() {
    if (referenceFileInputRef.current) {
      referenceFileInputRef.current.value = "";
    }
    setReferenceFileInfo(null);
  }

  function selectReferenceImage(referenceId: string) {
    clearReferenceFile();
    setReferenceImageId("");
    setRefImageId(referenceId);
  }

  function clearCurrentReference() {
    if (referenceFileInfo) {
      clearReferenceFile();
      return;
    }
    if (referenceImageId) {
      setReferenceImageId("");
      return;
    }
    setRefImageId("");
  }

  return (
    <div className="workspace">
      <form className="panel generation-panel" onSubmit={submit}>
        <div className="panel-header">
          <h1 className="panel-title">生成图片</h1>
          <span className="status">ai.zh.ci</span>
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
              <div className="field">
                <label htmlFor="size">尺寸</label>
                <select className="select" id="size" name="size" value={size} onChange={(event) => setSize(event.target.value)}>
                  <option value="auto">自动 - auto</option>
                  <option value="1024x1024">1:1 - 1024x1024</option>
                  <option value="1024x1824">9:16 - 1024x1824</option>
                  <option value="1824x1024">16:9 - 1824x1024</option>
                  <option value="1360x1024">4:3 - 1360x1024</option>
                  <option value="1024x1360">3:4 - 1024x1360</option>
                </select>
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
            <div className="form-section-title">
              <span>参考图</span>
              <span className="small muted">上传文件优先</span>
            </div>
            <div className="reference-picker">
              <label className={`reference-option upload-reference-option ${referenceFileInfo ? "selected" : ""}`} htmlFor="referenceImage">
                <span className="reference-option-thumb reference-upload-thumb">
                  <ImagePlus size={20} />
                </span>
                <span>{referenceFileInfo ? "已上传" : "上传参考"}</span>
                <small>
                  {referenceFileInfo ? `${referenceFileInfo.name} · ${formatFileSize(referenceFileInfo.byteSize)}` : "PNG / JPG / WebP"}
                </small>
              </label>
              {recentReferenceImages.map((reference, index) => (
                <button
                  key={reference.id}
                  className={`reference-option reference-option-image${refImageId === reference.id ? " selected" : ""}`}
                  type="button"
                  onClick={() => selectReferenceImage(reference.id)}
                >
                  <img src={`/api/reference-images/${reference.id}?thumb=1`} alt="" />
                  <span>{index === 0 ? "最近参考" : `参考 ${index + 1}`}</span>
                  <small>{refImageId === reference.id ? "已选择" : formatFileSize(reference.byte_size)}</small>
                </button>
              ))}
            </div>
            <input
              ref={referenceFileInputRef}
              className="file-input"
              id="referenceImage"
              name="referenceImage"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleReferenceFileChange}
            />
            <div className="reference-selection-stack">
              {referenceSummary ? (
                <div className={`reference-chip current-reference-chip ${referenceSummary.icon === "upload" ? "upload-reference-chip" : ""}`}>
                  {referenceSummary.imageSrc ? (
                    <img src={referenceSummary.imageSrc} alt="" />
                  ) : (
                    <div className="reference-chip-icon">
                      <ImagePlus size={20} />
                    </div>
                  )}
                  <div>
                    <div className="reference-chip-title-row">
                      <strong>{referenceSummary.title}</strong>
                      <span className="status">{referenceSummary.source}</span>
                    </div>
                    <p className="small muted">{referenceSummary.detail}</p>
                  </div>
                  <button className="status" type="button" onClick={clearCurrentReference}>
                    <X size={13} />
                    清除
                  </button>
                </div>
              ) : null}
              {referenceImageId ? <input type="hidden" name="referenceImageId" value={referenceImageId} /> : null}
              {refImageId ? <input type="hidden" name="existingRefId" value={refImageId} /> : null}
            </div>
          </section>

          <div className="generation-submit">
            {error ? <p className="small form-error">{error}</p> : null}
            <div className="generation-summary-bar" aria-label="生成参数确认">
              <span>{modelLabel}</span>
              <span>{size}</span>
              <span>{count} 张</span>
              <span>{referenceSummary ? `${referenceSummary.source}已选` : "无参考图"}</span>
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
                    </div>
                  ) : null}
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
              <span className="status running">运行 {queue.running} / {queue.concurrency}</span>
              <span className="status queued">排队 {queue.queued}</span>
            </div>
            {queueLoading && queue.jobs.length === 0 ? <p className="muted small">正在加载任务队列...</p> : null}
            {!queueLoading && queue.jobs.length === 0 ? <p className="muted small">当前没有排队或运行中的任务。</p> : null}
            {queue.jobs.map((item) => (
              <article className="queue-item" key={item.id}>
                <div className="queue-item-head">
                  <span className={`status ${item.status}`}>{generationStatusLabel(item.status)}</span>
                  <span className="small muted">
                    {item.status === "queued" && item.queue_position ? `队列 #${item.queue_position}` : item.username ?? ""}
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
                      {item.progress.percent}% · 已保存 {item.progress.current} / {item.count} 张
                    </p>
                  </>
                ) : (
                  <p className="small muted">{item.count} 张 · {item.model}</p>
                )}
                <div className="actions">
                  <JobControlButton action="cancel" recordId={item.id} onDone={refreshJobLists} />
                  <a className="status" href={`/records/${item.id}`}>详情</a>
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
              <button className="status" type="button" onClick={loadRecentJobs} disabled={historyLoading}>
                {historyLoading ? "加载中" : "加载"}
              </button>
              <a className="status" href="/records">全部</a>
            </div>
          </div>
          <div className="panel-body history-list">
            {historyLoading ? <p className="muted small">正在加载最近记录...</p> : null}
            {!historyLoading && !historyLoaded && history.length === 0 ? <p className="muted small">还没有加载最近记录。</p> : null}
            {!historyLoading && historyLoaded && history.length === 0 ? <p className="muted small">还没有生成记录。</p> : null}
            {history.map((recent) => (
              <article className="history-item" key={recent.id}>
                {recent.thumbnail_id && !recent.localOnly ? (
                  <a className="thumb-link" href={`/records/${recent.id}`} aria-label="查看记录详情">
                    <ImageWithSkeleton className="thumb" wrapperClassName="thumb-skeleton" src={imageThumbnailUrl(recent.thumbnail_id)} alt="" />
                  </a>
                ) : recent.thumbnail_id ? (
                  <ImageWithSkeleton className="thumb" wrapperClassName="thumb-skeleton" src={imageThumbnailUrl(recent.thumbnail_id)} alt="" />
                ) : (
                  <div className="thumb" />
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
                    ) : (
                      <a className="status" href={`/records/${recent.id}`}>详情</a>
                    )}
                    {!recent.localOnly && (recent.status === "failed" || recent.status === "canceled") ? (
                      <JobControlButton action="requeue" recordId={recent.id} onDone={refreshJobLists} />
                    ) : null}
                    {!recent.localOnly && (recent.status === "queued" || recent.status === "running") ? (
                      <JobControlButton action="cancel" recordId={recent.id} onDone={refreshJobLists} />
                    ) : null}
                    {recent.thumbnail_id ? (
                      <a className="status" href={`/?referenceImageId=${recent.thumbnail_id}`}>
                        <Pencil size={13} />
                        编辑
                      </a>
                    ) : null}
                    {!recent.localOnly && recent.thumbnail_id ? (
                      <FavoriteImageButton imageId={recent.thumbnail_id} initialFavorite={recent.thumbnail_favorite ?? false} />
                    ) : null}
                    {!recent.localOnly && recent.status !== "queued" && recent.status !== "running" ? (
                      <DeleteRecordButton recordId={recent.id} onDeleted={() => removeHistoryItem(recent.id)} />
                    ) : null}
                    <button className="status" type="button" onClick={() => applyTaskParams(recent)} disabled={loading}>
                      <RefreshCcw size={13} />
                      重做
                    </button>
                  </div>
                </div>
              </article>
            ))}
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

function normalizeSize(value: string | null) {
  return value && sizeValues.has(value) ? value : "auto";
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
          <button className="status" type="button" onClick={() => onEdit(image.id)}>
            <Pencil size={13} />
            编辑
          </button>
          <a className="status" href={`/api/images/${image.id}/download`}>
            <Download size={13} />
            下载
          </a>
        </div>
      </footer>
    </article>
  );
}
