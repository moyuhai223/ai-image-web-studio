-- Stage 2 (v0.5.0): subdivide terminal states for generation jobs.
-- Adds two new statuses:
--   * interrupted    : job was running when the process died (recoverInterruptedJobs)
--   * upstream_error : provider returned an error mapped to category=upstream
-- request_metadata.progress now also carries phaseTimings (no schema change needed for JSONB).

alter table generation_jobs drop constraint if exists generation_jobs_status_check;

alter table generation_jobs
  add constraint generation_jobs_status_check
  check (status in (
    'queued',
    'running',
    'succeeded',
    'failed',
    'canceled',
    'interrupted',
    'upstream_error'
  ));
