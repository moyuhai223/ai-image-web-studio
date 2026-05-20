import type { GenerationStatus } from "./types";

export const generationStatusLabels: Record<GenerationStatus, string> = {
  queued: "队列中",
  running: "生成中",
  succeeded: "成功",
  failed: "失败",
  canceled: "已取消"
};

export function generationStatusLabel(status: GenerationStatus | string) {
  return (generationStatusLabels as Record<string, string>)[status] ?? status;
}
