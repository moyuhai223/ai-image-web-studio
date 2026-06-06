"use client";

import { CheckCircle2, CircleAlert, CircleX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isTerminalGenerationStatus } from "@/lib/generation-status";
import type { GenerationStatus } from "@/lib/types";

type RecentJob = {
  id: string;
  prompt: string;
  status: GenerationStatus;
  error_message: string | null;
  count: number;
};

type JobNotificationDetail = {
  job: RecentJob;
};

type Toast = {
  id: string;
  jobId: string;
  status: GenerationStatus;
  title: string;
  message: string;
  href: string;
};

const TRACKED_KEY = "ai-image-studio-tracked-jobs";
const NOTIFIED_KEY = "ai-image-studio-notified-jobs";
const EVENT_NAME = "ai-image-job-notification";
const POLL_MS = 4500;

// 浏览器系统通知:用户在顶栏「完成提醒」开关里开启,偏好持久化在 localStorage。
// 只有开启 + 浏览器已授权时才算启用。
export const BROWSER_NOTIFY_KEY = "ai-image-studio-browser-notify";

export function isBrowserNotifyEnabled() {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  try {
    return window.localStorage.getItem(BROWSER_NOTIFY_KEY) === "1";
  } catch {
    return false;
  }
}

// 开启「完成提醒」后,任务完成即弹系统通知 —— 无论页面是否在前台都推送(用户明确要系统推送)。
function maybeShowBrowserNotification(job: RecentJob, copy: { title: string; message: string }) {
  if (!isBrowserNotifyEnabled()) return;
  try {
    const notification = new Notification(copy.title, {
      body: job.prompt ? shortPrompt(job.prompt) : copy.message,
      tag: `${job.id}:${job.status}`
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      notification.close();
    };
  } catch {
    // 某些环境(如移动端 Chrome 需 ServiceWorker)直接 new Notification 会抛,忽略。
  }
}

function isActiveStatus(status: GenerationStatus) {
  return status === "queued" || status === "running";
}

function isTerminalStatus(status: GenerationStatus) {
  return isTerminalGenerationStatus(status);
}

function storageRead(key: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function storageWrite(key: string, values: Iterable<string>) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(Array.from(values).slice(-80)));
}

function statusCopy(job: RecentJob) {
  if (job.status === "succeeded") {
    return {
      title: "图片生成完成",
      message: `${job.count} 张图片已保存，可以查看结果。`
    };
  }

  if (job.status === "failed") {
    return {
      title: "图片生成失败",
      message: job.error_message ?? "任务失败，可以查看详情或重试。"
    };
  }

  if (job.status === "upstream_error") {
    return {
      title: "上游服务返回失败",
      message: job.error_message ?? "上游服务暂不可用，可以稍后重试。"
    };
  }

  if (job.status === "interrupted") {
    return {
      title: "任务被中断",
      message: job.error_message ?? "服务重启时任务被中断，可点击重试。"
    };
  }

  return {
    title: "任务已取消",
    message: "后台生成任务已停止。"
  };
}

function shortPrompt(prompt: string) {
  const text = prompt.trim();
  if (text.length <= 42) return text;
  return `${text.slice(0, 42)}...`;
}

function toastClass(status: GenerationStatus) {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "upstream_error") return "failed";
  if (status === "interrupted") return "canceled";
  return "canceled";
}

function ToastIcon({ status }: { status: GenerationStatus }) {
  if (status === "succeeded") return <CheckCircle2 size={18} />;
  if (status === "failed" || status === "upstream_error") return <CircleAlert size={18} />;
  return <CircleX size={18} />;
}

export function JobNotificationCenter() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const trackedJobs = useRef<Set<string>>(new Set());
  const notifiedJobs = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const pollController = useRef<AbortController | null>(null);

  function persist() {
    storageWrite(TRACKED_KEY, trackedJobs.current);
    storageWrite(NOTIFIED_KEY, notifiedJobs.current);
  }

  function removeToast(id: string) {
    setDismissingIds((current) => new Set(current).add(id));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      setDismissingIds((current) => { const next = new Set(current); next.delete(id); return next; });
    }, 220);
  }

  function pushToast(job: RecentJob) {
    if (!isTerminalStatus(job.status)) return;
    const notifyKey = `${job.id}:${job.status}`;
    if (notifiedJobs.current.has(notifyKey)) return;

    notifiedJobs.current.add(notifyKey);
    trackedJobs.current.delete(job.id);
    persist();

    const copy = statusCopy(job);
    const toast: Toast = {
      id: `${notifyKey}:${Date.now()}`,
      jobId: job.id,
      status: job.status,
      title: copy.title,
      message: `${copy.message}${job.prompt ? ` ${shortPrompt(job.prompt)}` : ""}`,
      href: `/records/${job.id}`
    };

    setToasts((current) => [toast, ...current].slice(0, 4));
    window.setTimeout(() => removeToast(toast.id), 8500);
    maybeShowBrowserNotification(job, copy);
  }

  async function pollRecentJobs() {
    // 默认页面隐藏时停止轮询省资源;但开启了系统通知时要继续轮询,才能在用户离开时检测到完成并弹通知。
    if (document.hidden && initialized.current && !isBrowserNotifyEnabled()) return;
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;

    let data: { jobs?: RecentJob[] };
    try {
      const response = await fetch("/api/recent-jobs", { cache: "no-store", signal: controller.signal });
      data = (await response.json().catch(() => ({}))) as { jobs?: RecentJob[] };
      if (!response.ok || !Array.isArray(data.jobs) || controller.signal.aborted) return;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("Job notification polling failed:", error);
      }
      return;
    } finally {
      if (pollController.current === controller) pollController.current = null;
    }

    for (const job of data.jobs) {
      if (isActiveStatus(job.status)) {
        trackedJobs.current.add(job.id);
        continue;
      }

      if (initialized.current && isTerminalStatus(job.status) && trackedJobs.current.has(job.id)) {
        pushToast(job);
      }
    }

    initialized.current = true;
    persist();
  }

  useEffect(() => {
    trackedJobs.current = new Set(storageRead(TRACKED_KEY));
    notifiedJobs.current = new Set(storageRead(NOTIFIED_KEY));

    void pollRecentJobs();
    const timer = window.setInterval(() => {
      void pollRecentJobs();
    }, POLL_MS);

    function handleJobNotification(event: Event) {
      const detail = (event as CustomEvent<JobNotificationDetail>).detail;
      if (!detail?.job) return;
      trackedJobs.current.add(detail.job.id);
      pushToast(detail.job);
    }

    window.addEventListener(EVENT_NAME, handleJobNotification);
    return () => {
      window.clearInterval(timer);
      pollController.current?.abort();
      window.removeEventListener(EVENT_NAME, handleJobNotification);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite" aria-label="任务通知">
      {toasts.map((toast) => (
        <article className={`toast-card ${toastClass(toast.status)}${dismissingIds.has(toast.id) ? " dismissing" : ""}`} key={toast.id}>
          <div className="toast-icon">
            <ToastIcon status={toast.status} />
          </div>
          <a className="toast-content" href={toast.href}>
            <strong>{toast.title}</strong>
            <span className="small muted">{toast.message}</span>
          </a>
          <button className="toast-close" type="button" aria-label="关闭通知" onClick={() => removeToast(toast.id)}>
            <X size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}

export function dispatchJobNotification(job: RecentJob) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<JobNotificationDetail>(EVENT_NAME, { detail: { job } }));
}
