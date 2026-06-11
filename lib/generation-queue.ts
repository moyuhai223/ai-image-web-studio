import { randomUUID } from "node:crypto";
import { config } from "./config";
import { query } from "./db";
import { processGenerationJob } from "./generation-runner";
import { createLogger } from "./logger";

const log = createLogger("queue");

type QueueState = {
  pending: Set<string>;
  runningJobIds: Set<string>;
  draining: boolean;
  recovered: boolean;
  started: boolean;
  watchdog: ReturnType<typeof setInterval> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __aiImageGenerationQueue: QueueState | undefined;
}

const queueState =
  globalThis.__aiImageGenerationQueue ??
  (globalThis.__aiImageGenerationQueue = {
    pending: new Set<string>(),
    runningJobIds: new Set<string>(),
    draining: false,
    recovered: false,
    started: false,
    watchdog: null
  });

queueState.runningJobIds ??= new Set<string>();
queueState.recovered ??= false;

function concurrencyLimit() {
  return Math.max(1, config.maxGenerationConcurrency);
}

function timeoutMessage() {
  return `等待模型返回失败：模型请求超过 ${Math.round(config.generationTimeoutMs / 60000)} 分钟未返回，已自动判定失败`;
}

function slowWarningMs() {
  return Math.min(5 * 60 * 1000, Math.max(60 * 1000, Math.floor(config.generationTimeoutMs / 2)));
}

function slowWarningMessage() {
  return `模型请求已等待超过 ${Math.round(slowWarningMs() / 60000)} 分钟，仍在等待返回；超过 ${Math.round(config.generationTimeoutMs / 60000)} 分钟才会判定失败`;
}

async function warnSlowRunningJobs() {
  const result = await query<{ id: string }>(
    `with params as (
       select $1::integer as warning_ms, $2::text as warning_message
     )
     update generation_jobs
     set request_metadata = jsonb_set(
           request_metadata,
           '{progress}',
           coalesce(request_metadata->'progress', '{}'::jsonb) || jsonb_build_object(
             'message', params.warning_message,
             'updatedAt', now()::text,
             'slowNotifiedAt', now()::text
           ),
           true
         ),
         updated_at = now()
     from params
     where status = 'running'
       and request_metadata #>> '{progress,phase}' in ('requesting', 'submitting')
       and request_metadata #>> '{progress,requestStartedAt}' is not null
       and request_metadata #>> '{progress,slowNotifiedAt}' is null
       and (request_metadata #>> '{progress,requestStartedAt}')::timestamptz < now() - (params.warning_ms * interval '1 millisecond')
     returning id`,
    [slowWarningMs(), slowWarningMessage()]
  );

  return result.rows.map((row) => row.id);
}

async function failTimedOutRunningJobs() {
  const result = await query<{ id: string }>(
    `with params as (
       select $1::integer as timeout_ms, $2::text as timeout_message
     )
     update generation_jobs
     set status = 'failed',
         error_message = params.timeout_message,
         request_metadata = jsonb_set(
           request_metadata,
           '{progress}',
           jsonb_build_object(
             'phase', 'failed',
             'current', coalesce((request_metadata #>> '{progress,current}')::integer, 0),
             'total', count,
             'percent', coalesce((request_metadata #>> '{progress,percent}')::integer, 35),
             'message', params.timeout_message,
             'updatedAt', now()::text
           ),
           true
         ),
         completed_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::integer),
         updated_at = now()
     from params
     where status = 'running'
       -- v0.6.1: 之前 case 在非 requesting/submitting 阶段 fallback 到 updated_at,
       -- 但 updated_at 会被每次 progress 写入(包括 watchdog 自己的 slow-warning)
       -- 推到 now(),导致卡死/失控的下载/处理永远 timeout 不掉。
       -- 改为统一以 progress.requestStartedAt(模型请求真正开始时间)为基准,
       -- 走绝对耗时判断;它在 'requesting' 阶段一次性写入,之后不再变化。
       -- 没有 requestStartedAt(老数据或还没进 requesting)时回退到 started_at → created_at。
       -- v0.7.30: 自动重试的任务以第一轮的 firstRequestStartedAt 为基准——所有重试轮共享
       -- 同一个超时预算,避免每轮重置导致最坏 N×timeout 才死透。
       and coalesce(
         (nullif(request_metadata #>> '{autoRetry,firstRequestStartedAt}', ''))::timestamptz,
         (nullif(request_metadata #>> '{progress,requestStartedAt}', ''))::timestamptz,
         started_at,
         created_at
       ) < now() - (params.timeout_ms * interval '1 millisecond')
     returning id`,
    [config.generationTimeoutMs, timeoutMessage()]
  );

  if (result.rowCount) {
    log.warn("Marked timed out generation jobs as failed", { count: result.rowCount });
  }

  return result.rows.map((row) => row.id);
}

async function recoverInterruptedJobs() {
  // Stage 2: 默认把 running 任务标为 'interrupted' 终态,让用户主动决定是否重试;
  // 设置 AUTO_REQUEUE_ON_RESTART=true 可恢复旧行为(自动重排队)。
  if (config.autoRequeueOnRestart) {
    const result = await query<{ id: string }>(
      `update generation_jobs
       set status = 'queued',
           started_at = null,
           completed_at = null,
           duration_ms = null,
           error_message = null,
           request_metadata = jsonb_set(
             jsonb_set(
               request_metadata,
               '{control}',
               (coalesce(request_metadata->'control', '{}'::jsonb) - 'runId') || jsonb_build_object('recoveredAt', now()::text),
               true
             ),
             '{progress}',
             jsonb_build_object(
               'phase', 'queued',
               'current', 0,
               'total', count,
               'percent', 5,
               'message', '服务重启后任务已恢复到后台队列',
               'updatedAt', now()::text
             ),
             true
           ),
           updated_at = now()
       where status = 'running'
       returning id`
    );

    if (result.rowCount) {
      log.warn("Auto-requeued interrupted generation jobs after process start", { count: result.rowCount });
    }
    return;
  }

  // v0.7.30: 自动重试退避中的任务(autoRetry.attempts 在 1..max)不落 interrupted 终态——
  // 它们本来就会被重新排队,重启只是打断了退避计时,直接翻回 queued 继续重试(次数已持久化)。
  const retried = await query<{ id: string }>(
    `update generation_jobs
     set status = 'queued',
         started_at = null,
         request_metadata = jsonb_set(
           jsonb_set(
             request_metadata,
             '{control}',
             (coalesce(request_metadata->'control', '{}'::jsonb) - 'runId') || jsonb_build_object('recoveredAt', now()::text),
             true
           ),
           '{progress}',
           jsonb_build_object(
             'phase', 'queued',
             'current', 0,
             'total', count,
             'percent', 5,
             'message', '服务重启时任务在自动重试等待中,已恢复排队继续重试',
             'updatedAt', now()::text
           ),
           true
         ),
         updated_at = now()
     where status = 'running'
       and coalesce((request_metadata #>> '{autoRetry,attempts}')::integer, 0) between 1 and $1
     returning id`,
    [config.generationAutoRetryMax]
  );
  if (retried.rowCount) {
    log.warn("Re-queued auto-retrying jobs after process start", { count: retried.rowCount });
  }

  const result = await query<{ id: string }>(
    `update generation_jobs
     set status = 'interrupted',
         completed_at = now(),
         duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, created_at))) * 1000)::integer),
         error_message = '服务重启时任务正在执行,已标记为中断。可在记录页点击“重试”重新排队。',
         request_metadata = jsonb_set(
           jsonb_set(
             request_metadata,
             '{control}',
             (coalesce(request_metadata->'control', '{}'::jsonb) - 'runId') || jsonb_build_object('interruptedAt', now()::text),
             true
           ),
           '{progress}',
           jsonb_build_object(
             'phase', 'interrupted',
             'current', coalesce((request_metadata #>> '{progress,current}')::integer, 0),
             'total', count,
             'percent', coalesce((request_metadata #>> '{progress,percent}')::integer, 35),
             'message', '服务重启时任务被中断,可在记录页重新排队',
             'updatedAt', now()::text
           ),
           true
         ),
         updated_at = now()
     where status = 'running'
     returning id`
  );

  if (result.rowCount) {
    log.warn("Marked running jobs as interrupted after process start", { count: result.rowCount });
  }
}

async function runningCount() {
  const result = await query<{ count: string }>(
    `select count(*)::text as count
     from generation_jobs
     where status = 'running'`
  );
  return Number(result.rows[0]?.count ?? 0);
}

function claimedProgressMessage() {
  return "后台 worker 已认领任务，准备读取参数";
}

async function claimSpecificJob(jobId: string, runId: string) {
  const result = await query<{ id: string }>(
    `update generation_jobs
     set status = 'running',
         started_at = coalesce(started_at, now()),
         completed_at = null,
         duration_ms = null,
         request_metadata = jsonb_set(
           jsonb_set(
             request_metadata,
             '{control}',
             coalesce(request_metadata->'control', '{}'::jsonb) || jsonb_build_object('runId', $2::text, 'startedAt', now()::text),
             true
           ),
           '{progress}',
           jsonb_build_object(
             'phase', 'requesting',
             'current', 0,
             'total', count,
             'percent', 10,
             'message', $3::text,
             'updatedAt', now()::text
           ),
           true
         ),
         updated_at = now()
     where id = $1 and status = 'queued'
     returning id`,
    [jobId, runId, claimedProgressMessage()]
  );

  return result.rows[0]?.id ?? null;
}

async function claimNextJob(runId: string) {
  const result = await query<{ id: string }>(
    `with next_job as (
       select id
       from generation_jobs
       where status = 'queued'
       order by created_at asc
       for update skip locked
       limit 1
     )
     update generation_jobs j
     set status = 'running',
         started_at = coalesce(j.started_at, now()),
         completed_at = null,
         duration_ms = null,
         request_metadata = jsonb_set(
           jsonb_set(
             j.request_metadata,
             '{control}',
             coalesce(j.request_metadata->'control', '{}'::jsonb) || jsonb_build_object('runId', $1::text, 'startedAt', now()::text),
             true
           ),
           '{progress}',
           jsonb_build_object(
             'phase', 'requesting',
             'current', 0,
             'total', j.count,
             'percent', 10,
             'message', $2::text,
             'updatedAt', now()::text
           ),
           true
         ),
         updated_at = now()
     from next_job
     where j.id = next_job.id
     returning j.id`,
    [runId, claimedProgressMessage()]
  );

  return result.rows[0]?.id ?? null;
}

async function claimJob(runId: string, preferredJobId?: string) {
  if ((await runningCount()) >= concurrencyLimit()) return null;
  if (preferredJobId) {
    const claimed = await claimSpecificJob(preferredJobId, runId);
    if (claimed) return claimed;
  }
  return claimNextJob(runId);
}

async function recoverInterruptedJobsOnce() {
  if (queueState.recovered) return;
  await recoverInterruptedJobs();
  queueState.recovered = true;
}

function releaseLocalJobs(jobIds: string[]) {
  for (const jobId of jobIds) {
    queueState.runningJobIds.delete(jobId);
  }
}

async function syncLocalRunningJobs() {
  const localJobIds = Array.from(queueState.runningJobIds);
  if (localJobIds.length === 0) return;

  const result = await query<{ id: string }>(
    `select id
     from generation_jobs
     where status = 'running'
       and id = any($1::uuid[])`,
    [localJobIds]
  );
  const activeJobIds = new Set(result.rows.map((row) => row.id));

  for (const jobId of localJobIds) {
    if (!activeJobIds.has(jobId)) {
      queueState.runningJobIds.delete(jobId);
    }
  }
}

async function drainQueue() {
  if (queueState.draining) return;
  queueState.draining = true;

  try {
    await recoverInterruptedJobsOnce();
    releaseLocalJobs(await failTimedOutRunningJobs());
    await syncLocalRunningJobs();

    while (queueState.runningJobIds.size < concurrencyLimit()) {
      const pendingJobId = queueState.pending.values().next().value as string | undefined;
      if (pendingJobId) {
        queueState.pending.delete(pendingJobId);
      }

      const runId = randomUUID();
      const jobId = await claimJob(runId, pendingJobId);
      if (!jobId) break;

      queueState.runningJobIds.add(jobId);
      log.info("Generation queue claimed job", { jobId });
      void processGenerationJob(jobId, runId)
        .catch((error) => {
          log.warn("Background generation job crashed", { jobId, error });
        })
        .finally(() => {
          queueState.runningJobIds.delete(jobId);
          void drainQueue();
        });
    }
  } catch (error) {
    log.warn("Generation queue drain failed", { error });
  } finally {
    queueState.draining = false;
  }
}

function startQueueWatchdog() {
  if (queueState.watchdog) return;

  const intervalMs = Math.max(5000, Math.min(30000, Math.floor(config.generationTimeoutMs / 5)));
  const watchdog = setInterval(() => {
    void warnSlowRunningJobs()
      .then(() => failTimedOutRunningJobs())
      .then((jobIds) => {
        releaseLocalJobs(jobIds);
        return drainQueue();
      })
      .catch((error) => {
        log.warn("Generation queue timeout watchdog failed", { error });
      });
  }, intervalMs);

  if (typeof watchdog === "object" && "unref" in watchdog && typeof watchdog.unref === "function") {
    watchdog.unref();
  }

  queueState.watchdog = watchdog;
}

export function enqueueGenerationJob(jobId: string) {
  queueState.pending.add(jobId);
  startQueueWatchdog();
  void drainQueue();
}

export function startGenerationQueue() {
  if (!queueState.started) {
    queueState.started = true;
  }
  startQueueWatchdog();
  void drainQueue();
}
