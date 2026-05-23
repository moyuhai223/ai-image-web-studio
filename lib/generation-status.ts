import type { GenerationStatus } from "./types";

export const generationStatusLabels: Record<GenerationStatus, string> = {
  queued: "队列中",
  running: "生成中",
  succeeded: "成功",
  failed: "失败",
  canceled: "已取消",
  interrupted: "已中断",
  upstream_error: "上游错误"
};

export const TERMINAL_GENERATION_STATUSES: ReadonlySet<GenerationStatus> = new Set([
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
  "upstream_error"
]);

export const RETRYABLE_GENERATION_STATUSES: ReadonlySet<GenerationStatus> = new Set([
  "failed",
  "canceled",
  "interrupted",
  "upstream_error"
]);

export function isTerminalGenerationStatus(status: GenerationStatus | string) {
  return TERMINAL_GENERATION_STATUSES.has(status as GenerationStatus);
}

export function isRetryableGenerationStatus(status: GenerationStatus | string) {
  return RETRYABLE_GENERATION_STATUSES.has(status as GenerationStatus);
}

export function generationStatusLabel(status: GenerationStatus | string) {
  return (generationStatusLabels as Record<string, string>)[status] ?? status;
}
