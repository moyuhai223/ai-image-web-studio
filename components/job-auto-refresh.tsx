"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isTerminalGenerationStatus } from "@/lib/generation-status";
import type { GenerationStatus } from "@/lib/types";

/**
 * 任务详情页轮询刷新。
 *
 * 任务详情是 SSR 页面,默认不会自动更新进度;之前点 `重试` 只触发一次
 * `router.refresh()`,任务从 queued → running 的后续进度都看不到。
 *
 * 这里在 status 为非终态时每 2s 触发一次 `router.refresh()`,触达终态
 * 立即停止;切到后台 tab(`visibilityState !== 'visible'`)时暂停以避免
 * 浪费 DB 查询。注意 `router.refresh()` 在 Next.js 中只会重跑 server
 * component,不会丢前端状态,代价较小。
 *
 * 不直接订阅 `/api/queue/stream` 的原因:SSE 事件携带的是 jobId 和 phase,
 * 还是要再走一次 server fetch 才能渲染详情页的完整字段。直接 polling
 * router.refresh 更简单,2s 的间隔在用户感知上已经接近实时。
 */
export function JobAutoRefresh({
  status,
  intervalMs = 2000
}: {
  status: GenerationStatus;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (isTerminalGenerationStatus(status)) return;

    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      router.refresh();
    };

    const handle = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [status, intervalMs, router]);

  return null;
}
