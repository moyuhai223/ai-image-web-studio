import { randomUUID } from "node:crypto";
import { config } from "./config";
import { query } from "./db";
import { processGenerationJob } from "./generation-runner";

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
       and (
         case
           when request_metadata #>> '{progress,phase}' in ('requesting', 'submitting')
             then coalesce(
               (nullif(request_metadata #>> '{progress,requestStartedAt}', ''))::timestamptz,
               updated_at,
               started_at,
               created_at
             )
           else coalesce(updated_at, started_at, created_at)
         end
       ) < now() - (params.timeout_ms * interval '1 millisecond')
     returning id`,
    [config.generationTimeoutMs, timeoutMessage()]
  );

  if (result.rowCount) {
    console.warn(`Marked ${result.rowCount} timed out generation job(s) as failed.`);
  }

  return result.rows.map((row) => row.id);
}

async function recoverInterruptedJobs() {
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
    console.warn(`Recovered ${result.rowCount} interrupted generation job(s) after process start.`);
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

async function drainQueue() {
  if (queueState.draining) return;
  queueState.draining = true;

  try {
    await recoverInterruptedJobsOnce();
    releaseLocalJobs(await failTimedOutRunningJobs());

    while (queueState.runningJobIds.size < concurrencyLimit()) {
      const pendingJobId = queueState.pending.values().next().value as string | undefined;
      if (pendingJobId) {
        queueState.pending.delete(pendingJobId);
      }

      const runId = randomUUID();
      const jobId = await claimJob(runId, pendingJobId);
      if (!jobId) break;

      queueState.runningJobIds.add(jobId);
      console.info(`Generation queue claimed job ${jobId}.`);
      void processGenerationJob(jobId, runId)
        .catch((error) => {
          console.warn(`Background generation job ${jobId} crashed:`, error);
        })
        .finally(() => {
          queueState.runningJobIds.delete(jobId);
          void drainQueue();
        });
    }
  } catch (error) {
    console.warn("Generation queue drain failed:", error);
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
        console.warn("Generation queue timeout watchdog failed:", error);
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
