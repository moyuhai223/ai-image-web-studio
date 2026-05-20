import { query, transaction } from "./db";
import { deleteStoredImageFiles } from "./storage";
import type { GenerationJob, User } from "./types";

type GeneratedImageCleanupTarget = {
  id: string;
  local_path: string;
  byte_size: number;
};

export type GeneratedImageCleanupSummary = {
  requestedImages: number;
  deletedImages: number;
  deletedFiles: number;
  deletedBytes: number;
  fileErrors: number;
  errors: string[];
};

export type DeleteJobCleanupResult =
  | { status: "blocked"; cleanup: GeneratedImageCleanupSummary }
  | { status: "file_error"; cleanup: GeneratedImageCleanupSummary }
  | { status: "image_records_remaining"; cleanup: GeneratedImageCleanupSummary }
  | { status: "deleted"; cleanup: GeneratedImageCleanupSummary };

export type RequeueJobCleanupResult =
  | { status: "invalid_state"; cleanup: GeneratedImageCleanupSummary }
  | { status: "file_error"; cleanup: GeneratedImageCleanupSummary }
  | { status: "image_records_remaining"; cleanup: GeneratedImageCleanupSummary }
  | { status: "queued"; cleanup: GeneratedImageCleanupSummary };

function emptyCleanupSummary(): GeneratedImageCleanupSummary {
  return {
    requestedImages: 0,
    deletedImages: 0,
    deletedFiles: 0,
    deletedBytes: 0,
    fileErrors: 0,
    errors: []
  };
}

function cleanupErrorMessage(path: string, error: unknown) {
  return `${path}: ${error instanceof Error ? error.message : "删除失败"}`;
}

async function deleteGeneratedImageRows(ids: string[]) {
  if (ids.length === 0) return;
  await query(
    `delete from generated_images
     where id = any($1::uuid[])`,
    [ids]
  );
}

export async function cleanupGeneratedImageFiles(images: GeneratedImageCleanupTarget[]): Promise<GeneratedImageCleanupSummary> {
  const deletedIds: string[] = [];
  const summary = emptyCleanupSummary();
  summary.requestedImages = images.length;

  for (const image of images) {
    try {
      await deleteStoredImageFiles(image.local_path);
      deletedIds.push(image.id);
      summary.deletedImages += 1;
      summary.deletedFiles += 1;
      summary.deletedBytes += image.byte_size;
    } catch (error) {
      summary.fileErrors += 1;
      summary.errors.push(cleanupErrorMessage(image.local_path, error));
    }
  }

  await deleteGeneratedImageRows(deletedIds);
  summary.errors = summary.errors.slice(0, 10);
  return summary;
}

async function getJobForUser(jobId: string, user: User) {
  const result = await query<{ id: string; status: GenerationJob["status"] }>(
    `select id, status
     from generation_jobs
     where id = $1 and ($2::text = 'admin' or user_id = $3)`,
    [jobId, user.role, user.id]
  );
  return result.rows[0] ?? null;
}

async function listJobImages(jobId: string) {
  const result = await query<GeneratedImageCleanupTarget>(
    `select id, local_path, byte_size
     from generated_images
     where job_id = $1
     order by sort_order asc, created_at asc`,
    [jobId]
  );
  return result.rows;
}

async function deleteJobRecordAfterImageCleanup(jobId: string, user: User) {
  return transaction(async (client) => {
    const locked = await client.query<{ id: string; status: GenerationJob["status"] }>(
      `select id, status
       from generation_jobs
       where id = $1 and ($2::text = 'admin' or user_id = $3)
       for update`,
      [jobId, user.role, user.id]
    );
    const job = locked.rows[0];
    if (!job) return null;
    if (job.status === "queued" || job.status === "running") {
      return { status: "blocked" as const };
    }

    const remaining = await client.query<{ count: string }>(
      `select count(*)::text as count
       from generated_images
       where job_id = $1`,
      [jobId]
    );
    if (Number(remaining.rows[0]?.count ?? 0) > 0) {
      return { status: "image_records_remaining" as const };
    }

    await client.query(
      `delete from generation_jobs
       where id = $1 and ($2::text = 'admin' or user_id = $3)`,
      [jobId, user.role, user.id]
    );
    return { status: "deleted" as const };
  });
}

async function requeueJobRecordAfterImageCleanup(jobId: string, user: User) {
  return transaction(async (client) => {
    const locked = await client.query<{ id: string; status: GenerationJob["status"] }>(
      `select id, status
       from generation_jobs
       where id = $1 and ($2::text = 'admin' or user_id = $3)
       for update`,
      [jobId, user.role, user.id]
    );
    const job = locked.rows[0];
    if (!job) return null;
    if (job.status !== "failed" && job.status !== "canceled") {
      return { status: "invalid_state" as const };
    }

    const remaining = await client.query<{ count: string }>(
      `select count(*)::text as count
       from generated_images
       where job_id = $1`,
      [jobId]
    );
    if (Number(remaining.rows[0]?.count ?? 0) > 0) {
      return { status: "image_records_remaining" as const };
    }

    await client.query(
      `update generation_jobs
       set status = 'queued',
           provider_request_id = null,
           error_message = null,
           response_metadata = null,
           started_at = null,
           completed_at = null,
           duration_ms = null,
           request_metadata = jsonb_set(
             jsonb_set(
               request_metadata,
               '{progress}',
               jsonb_build_object(
                 'phase', 'queued',
                 'current', 0,
                 'total', count,
                 'percent', 5,
                 'message', '任务已重新加入后台队列',
                 'updatedAt', now()::text
               ),
               true
             ),
             '{control}',
             (coalesce(request_metadata->'control', '{}'::jsonb) - 'runId') || jsonb_build_object('requeuedAt', now()::text),
             true
           ),
           updated_at = now()
       where id = $1`,
      [jobId]
    );
    return { status: "queued" as const };
  });
}

export async function deleteJobWithGeneratedImages(jobId: string, user: User): Promise<DeleteJobCleanupResult | null> {
  const job = await getJobForUser(jobId, user);
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") {
    return { status: "blocked", cleanup: emptyCleanupSummary() };
  }

  const cleanup = await cleanupGeneratedImageFiles(await listJobImages(jobId));
  if (cleanup.fileErrors > 0) return { status: "file_error", cleanup };

  const result = await deleteJobRecordAfterImageCleanup(jobId, user);
  if (!result) return null;
  return { status: result.status, cleanup };
}

export async function requeueJobWithGeneratedImageCleanup(jobId: string, user: User): Promise<RequeueJobCleanupResult | null> {
  const job = await getJobForUser(jobId, user);
  if (!job) return null;
  if (job.status !== "failed" && job.status !== "canceled") {
    return { status: "invalid_state", cleanup: emptyCleanupSummary() };
  }

  const cleanup = await cleanupGeneratedImageFiles(await listJobImages(jobId));
  if (cleanup.fileErrors > 0) return { status: "file_error", cleanup };

  const result = await requeueJobRecordAfterImageCleanup(jobId, user);
  if (!result) return null;
  return { status: result.status, cleanup };
}

export async function cleanupFailedGeneratedImages() {
  const result = await query<GeneratedImageCleanupTarget>(
    `select i.id, i.local_path, i.byte_size
     from generated_images i
     join generation_jobs j on j.id = i.job_id
     where j.status = 'failed'
     order by i.created_at asc`
  );
  return cleanupGeneratedImageFiles(result.rows);
}
