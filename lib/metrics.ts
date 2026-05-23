import { listAiKeySummaries } from "./api-keys";
import { query } from "./db";
import type { GenerationStatus } from "./types";

/**
 * 运营指标:面向管理员与 Prometheus 采集。所有数据从 generation_jobs 表 + key 池
 * JSONB 实时计算,无新表无 cron。设计上让单次调用代价可控 —— 当前用 3 条 SQL,
 * 历史窗口固定 24h 内,行数级数据库都能毫秒返回。
 */

export type StatusCount = Partial<Record<GenerationStatus, number>>;

export type SuccessRate = {
  windowHours: number;
  succeeded: number;
  terminal: number;
  rate: number | null;
};

export type PhaseTimingQuantiles = {
  count: number;
  p50: number | null;
  p95: number | null;
};

export type PhaseTimingMetrics = {
  upstream_wait: PhaseTimingQuantiles;
  download_decode: PhaseTimingQuantiles;
  db_insert: PhaseTimingQuantiles;
};

export type AiKeyMetrics = {
  total: number;
  enabled: number;
  disabled: number;
  totalSuccess: number;
  totalFailure: number;
};

export type OperationalMetrics = {
  queueDepth: {
    queued: number;
    running: number;
  };
  recentJobs24h: {
    total: number;
    byStatus: StatusCount;
  };
  successRate1h: SuccessRate;
  successRate24h: SuccessRate;
  phaseTimingsMs: PhaseTimingMetrics;
  aiKeys: AiKeyMetrics;
  checkedAt: string;
};

const TERMINAL_STATUSES = ["succeeded", "failed", "upstream_error", "interrupted", "canceled"] as const;

function emptyPhaseQuantiles(): PhaseTimingQuantiles {
  return { count: 0, p50: null, p95: null };
}

function emptyPhaseMetrics(): PhaseTimingMetrics {
  return {
    upstream_wait: emptyPhaseQuantiles(),
    download_decode: emptyPhaseQuantiles(),
    db_insert: emptyPhaseQuantiles()
  };
}

function emptyMetrics(): OperationalMetrics {
  return {
    queueDepth: { queued: 0, running: 0 },
    recentJobs24h: { total: 0, byStatus: {} },
    successRate1h: { windowHours: 1, succeeded: 0, terminal: 0, rate: null },
    successRate24h: { windowHours: 24, succeeded: 0, terminal: 0, rate: null },
    phaseTimingsMs: emptyPhaseMetrics(),
    aiKeys: { total: 0, enabled: 0, disabled: 0, totalSuccess: 0, totalFailure: 0 },
    checkedAt: new Date().toISOString()
  };
}

async function loadStatusCounts(): Promise<{
  queueDepth: { queued: number; running: number };
  recentJobs24h: { total: number; byStatus: StatusCount };
}> {
  // 一次性把 queued/running 全量 + 最近 24h 终态分布拉回来
  const result = await query<{ status: string; bucket: string; count: string }>(`
    with current as (
      select status, 'active'::text as bucket, count(*)::bigint as count
      from generation_jobs
      where status in ('queued', 'running')
      group by status
    ),
    recent as (
      select status, 'recent24h'::text as bucket, count(*)::bigint as count
      from generation_jobs
      where created_at >= now() - interval '24 hours'
      group by status
    )
    select status, bucket, count::text as count from current
    union all
    select status, bucket, count::text as count from recent
  `);

  const queueDepth = { queued: 0, running: 0 };
  const byStatus: StatusCount = {};
  let total24h = 0;

  for (const row of result.rows) {
    const count = Number(row.count);
    if (row.bucket === "active") {
      if (row.status === "queued") queueDepth.queued = count;
      else if (row.status === "running") queueDepth.running = count;
    } else if (row.bucket === "recent24h") {
      byStatus[row.status as GenerationStatus] = count;
      total24h += count;
    }
  }

  return {
    queueDepth,
    recentJobs24h: { total: total24h, byStatus }
  };
}

async function loadSuccessRate(windowHours: number): Promise<SuccessRate> {
  const result = await query<{
    terminal: string;
    succeeded: string;
  }>(
    `select
       count(*)::bigint as terminal,
       count(*) filter (where status = 'succeeded')::bigint as succeeded
     from generation_jobs
     where status = any($1)
       and completed_at >= now() - ($2 || ' hours')::interval`,
    [TERMINAL_STATUSES as unknown as string[], String(windowHours)]
  );

  const terminal = Number(result.rows[0]?.terminal ?? 0);
  const succeeded = Number(result.rows[0]?.succeeded ?? 0);
  return {
    windowHours,
    succeeded,
    terminal,
    rate: terminal > 0 ? succeeded / terminal : null
  };
}

/**
 * phaseTimings 存在 request_metadata.progress.phaseTimings JSONB,数值是 ms。
 * 用 PG percentile_cont 直接算 p50/p95,避免把行拉到应用层算 ——
 * 在 10w 行级别也能 sub-100ms 返回。null 值会被 percentile_cont 跳过。
 */
async function loadPhaseTimings(): Promise<PhaseTimingMetrics> {
  const result = await query<{
    phase: string;
    count: string;
    p50: string | null;
    p95: string | null;
  }>(
    `with timings as (
       select
         (request_metadata #>> '{progress,phaseTimings,upstream_wait_ms}')::numeric as upstream_wait,
         (request_metadata #>> '{progress,phaseTimings,download_decode_ms}')::numeric as download_decode,
         (request_metadata #>> '{progress,phaseTimings,db_insert_ms}')::numeric as db_insert
       from generation_jobs
       where completed_at >= now() - interval '24 hours'
         and status = 'succeeded'
         and request_metadata #> '{progress,phaseTimings}' is not null
     )
     select 'upstream_wait' as phase,
            count(upstream_wait)::bigint as count,
            percentile_cont(0.5) within group (order by upstream_wait)::text as p50,
            percentile_cont(0.95) within group (order by upstream_wait)::text as p95
     from timings
     union all
     select 'download_decode',
            count(download_decode)::bigint,
            percentile_cont(0.5) within group (order by download_decode)::text,
            percentile_cont(0.95) within group (order by download_decode)::text
     from timings
     union all
     select 'db_insert',
            count(db_insert)::bigint,
            percentile_cont(0.5) within group (order by db_insert)::text,
            percentile_cont(0.95) within group (order by db_insert)::text
     from timings`
  );

  const metrics = emptyPhaseMetrics();
  for (const row of result.rows) {
    const target = (metrics as Record<string, PhaseTimingQuantiles>)[row.phase];
    if (!target) continue;
    target.count = Number(row.count);
    target.p50 = row.p50 !== null ? Number(row.p50) : null;
    target.p95 = row.p95 !== null ? Number(row.p95) : null;
  }
  return metrics;
}

async function loadAiKeyMetrics(): Promise<AiKeyMetrics> {
  const summary = await listAiKeySummaries();
  let totalSuccess = 0;
  let totalFailure = 0;
  let enabled = 0;
  for (const key of summary.keys) {
    totalSuccess += key.successCount;
    totalFailure += key.failureCount;
    if (key.enabled) enabled += 1;
  }
  return {
    total: summary.keys.length,
    enabled,
    disabled: summary.keys.length - enabled,
    totalSuccess,
    totalFailure
  };
}

export async function getOperationalMetrics(): Promise<OperationalMetrics> {
  try {
    // 4 项查询并行,降低端点 P99
    const [statusBlock, sr1h, sr24h, phaseTimings, aiKeys] = await Promise.all([
      loadStatusCounts(),
      loadSuccessRate(1),
      loadSuccessRate(24),
      loadPhaseTimings(),
      loadAiKeyMetrics()
    ]);

    return {
      queueDepth: statusBlock.queueDepth,
      recentJobs24h: statusBlock.recentJobs24h,
      successRate1h: sr1h,
      successRate24h: sr24h,
      phaseTimingsMs: phaseTimings,
      aiKeys,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    // metrics 失败不该挂掉调用方;返回空指标 + checkedAt 让上层知道时间点
    const fallback = emptyMetrics();
    fallback.checkedAt = new Date().toISOString();
    (fallback as OperationalMetrics & { error?: string }).error =
      error instanceof Error ? error.message : "metrics unavailable";
    return fallback;
  }
}
