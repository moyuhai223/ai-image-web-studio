import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { respondError } from "@/lib/api-errors";
import { getOperationalMetrics, type OperationalMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 运营指标端点。
 * - 默认 JSON,供 SystemHealthCard / 仪表盘消费。
 * - `?format=prometheus` 返 Prometheus 文本格式(Content-Type: text/plain; version=0.0.4)。
 * - requireUser:登录即可访问(管理员需要看,普通用户也方便 debug),不绑定 admin。
 */
export async function GET(request: Request) {
  await requireUser();

  try {
    const metrics = await getOperationalMetrics();
    const format = new URL(request.url).searchParams.get("format");

    if (format === "prometheus") {
      return new Response(renderPrometheus(metrics), {
        status: 200,
        headers: {
          // Prometheus 官方 content-type
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    return NextResponse.json(metrics, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return respondError(error, { context: "health.metrics.GET", fallbackStatus: 500 });
  }
}

/** Prometheus 数值序列化:把 null/NaN/Infinity 转 0,负数转 0(指标应非负)。 */
function num(value: number | null | undefined): string {
  if (value === null || value === undefined) return "0";
  if (!Number.isFinite(value)) return "0";
  if (value < 0) return "0";
  return String(value);
}

function renderPrometheus(metrics: OperationalMetrics): string {
  const lines: string[] = [];

  // queue_depth (gauge)
  lines.push("# HELP ai_image_studio_queue_depth Number of jobs in queue by state");
  lines.push("# TYPE ai_image_studio_queue_depth gauge");
  lines.push(`ai_image_studio_queue_depth{state="queued"} ${num(metrics.queueDepth.queued)}`);
  lines.push(`ai_image_studio_queue_depth{state="running"} ${num(metrics.queueDepth.running)}`);

  // jobs_total over last 24h (counter-style gauge: rolling window)
  lines.push("# HELP ai_image_studio_jobs_total Job counts in the last 24h by terminal status");
  lines.push("# TYPE ai_image_studio_jobs_total gauge");
  const knownStatuses = [
    "queued",
    "running",
    "succeeded",
    "failed",
    "upstream_error",
    "interrupted",
    "canceled"
  ] as const;
  for (const status of knownStatuses) {
    const count = metrics.recentJobs24h.byStatus[status] ?? 0;
    lines.push(`ai_image_studio_jobs_total{status="${status}"} ${num(count)}`);
  }

  // success rate (gauge, 0..1)
  lines.push("# HELP ai_image_studio_success_rate Job success rate over a rolling window");
  lines.push("# TYPE ai_image_studio_success_rate gauge");
  lines.push(`ai_image_studio_success_rate{window="1h"} ${num(metrics.successRate1h.rate ?? 0)}`);
  lines.push(`ai_image_studio_success_rate{window="24h"} ${num(metrics.successRate24h.rate ?? 0)}`);

  // phase timing quantiles (gauge in ms)
  lines.push("# HELP ai_image_studio_phase_timing_ms Phase timing percentiles in milliseconds (last 24h)");
  lines.push("# TYPE ai_image_studio_phase_timing_ms gauge");
  const phases: Array<keyof typeof metrics.phaseTimingsMs> = [
    "upstream_wait",
    "download_decode",
    "db_insert"
  ];
  for (const phase of phases) {
    const block = metrics.phaseTimingsMs[phase];
    lines.push(`ai_image_studio_phase_timing_ms{phase="${phase}",quantile="0.5"} ${num(block.p50)}`);
    lines.push(`ai_image_studio_phase_timing_ms{phase="${phase}",quantile="0.95"} ${num(block.p95)}`);
  }
  lines.push("# HELP ai_image_studio_phase_timing_samples Phase timing sample count (last 24h)");
  lines.push("# TYPE ai_image_studio_phase_timing_samples gauge");
  for (const phase of phases) {
    const block = metrics.phaseTimingsMs[phase];
    lines.push(`ai_image_studio_phase_timing_samples{phase="${phase}"} ${num(block.count)}`);
  }

  // AI keys
  lines.push("# HELP ai_image_studio_keys_total AI key counts by state");
  lines.push("# TYPE ai_image_studio_keys_total gauge");
  lines.push(`ai_image_studio_keys_total{state="enabled"} ${num(metrics.aiKeys.enabled)}`);
  lines.push(`ai_image_studio_keys_total{state="disabled"} ${num(metrics.aiKeys.disabled)}`);
  lines.push(`ai_image_studio_keys_total{state="all"} ${num(metrics.aiKeys.total)}`);

  lines.push("# HELP ai_image_studio_key_outcomes_total Cumulative AI key success/failure counts");
  lines.push("# TYPE ai_image_studio_key_outcomes_total counter");
  lines.push(`ai_image_studio_key_outcomes_total{outcome="success"} ${num(metrics.aiKeys.totalSuccess)}`);
  lines.push(`ai_image_studio_key_outcomes_total{outcome="failure"} ${num(metrics.aiKeys.totalFailure)}`);

  // timestamp
  lines.push("# HELP ai_image_studio_metrics_checked_at_seconds Unix timestamp of the metrics snapshot");
  lines.push("# TYPE ai_image_studio_metrics_checked_at_seconds gauge");
  const ts = Math.floor(new Date(metrics.checkedAt).getTime() / 1000);
  lines.push(`ai_image_studio_metrics_checked_at_seconds ${num(ts)}`);

  return lines.join("\n") + "\n";
}
