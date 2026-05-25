import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import type { GeneratedImage, GenerationJob, GenerationStatus, ImageVersionNode, JobWithImages, ReferenceImage, User } from "./types";

const jobListColumns = `
  j.id,
  j.user_id,
  j.model,
  j.prompt,
  j.size,
  j.count,
  j.status,
  j.provider,
  j.provider_request_id,
  j.error_message,
  '{}'::jsonb as request_metadata,
  null::jsonb as response_metadata,
  j.request_metadata->'progress' as progress,
  j.started_at,
  j.completed_at,
  j.duration_ms,
  j.created_at,
  j.updated_at
`;

export type JobListFilters = {
  status?: GenerationStatus;
  model?: string;
  size?: string;
  username?: string;
  q?: string;
  tag?: string;
  period?: "today" | "7d" | "30d";
};

export type FavoriteImageFilters = Pick<JobListFilters, "q" | "tag" | "model" | "size" | "period">;

export function normalizeImageTags(input: unknown) {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of input) {
    const tag = String(item ?? "").trim().replace(/^#+/, "").replace(/\s+/g, " ");
    if (!tag || tag.length > 32) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function buildJobListWhere(user: User, filters: JobListFilters = {}) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (user.role !== "admin") {
    params.push(user.id);
    clauses.push(`j.user_id = $${params.length}`);
  }

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`j.status = $${params.length}`);
  }

  if (filters.model) {
    params.push(filters.model);
    clauses.push(`j.model = $${params.length}`);
  }

  if (filters.size) {
    params.push(filters.size);
    clauses.push(`j.size = $${params.length}`);
  }

  if (filters.username && user.role === "admin") {
    params.push(`%${filters.username}%`);
    clauses.push(`u.username ilike $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    clauses.push(`(
      j.prompt ilike $${params.length}
      or j.model ilike $${params.length}
      or j.size ilike $${params.length}
      or exists (
        select 1
        from generated_images qi
        join generated_image_tags qt on qt.image_id = qi.id
        where qi.job_id = j.id and qt.tag ilike $${params.length}
      )
    )`);
  }

  if (filters.tag) {
    params.push(filters.tag);
    clauses.push(`exists (
      select 1
      from generated_images ti
      join generated_image_tags tt on tt.image_id = ti.id
      where ti.job_id = j.id and lower(tt.tag) = lower($${params.length})
    )`);
  }

  if (filters.period === "today") {
    clauses.push(`j.created_at >= current_date`);
  } else if (filters.period === "7d") {
    clauses.push(`j.created_at >= now() - interval '7 days'`);
  } else if (filters.period === "30d") {
    clauses.push(`j.created_at >= now() - interval '30 days'`);
  }

  return {
    where: clauses.length > 0 ? `where ${clauses.join(" and ")}` : "",
    params
  };
}

export async function listRecentJobs(user: User, limit = 24) {
  const where = user.role === "admin" ? "" : "where j.user_id = $1";
  const params = [user.id, limit];
  const limitParam = "$2";

  // v0.6.1: 相关子查询 → LATERAL JOIN 重构
  // - thumbnail_favorite 改 EXISTS → LEFT JOIN on PK(generated_image_favorites 主键
  //   (user_id, image_id),命中 index-only scan,比 EXISTS 子查询省一次 nested-loop)
  // - thumbnail_tags / tags 改 LATERAL,planner 可见性更好,future-proof
  //   依赖索引(已存在,schema.sql:143-149):
  //     generated_images_job_idx (job_id, sort_order)
  //     generated_image_tags_image_idx (image_id)
  //     generated_image_favorites pk (user_id, image_id)
  const result = await query<GenerationJob & { thumbnail_id: string | null; thumbnail_tags: string[]; thumbnail_favorite: boolean }>(
    `select ${jobListColumns},
            u.username,
            thumb.id::text as thumbnail_id,
            (fav.image_id is not null) as thumbnail_favorite,
            coalesce(thumb_tags.tags, '{}'::text[]) as thumbnail_tags,
            coalesce(job_tags.tags, '{}'::text[]) as tags
     from generation_jobs j
     join users u on u.id = j.user_id
     left join lateral (
       select i.id
       from generated_images i
       where i.job_id = j.id
       order by i.sort_order asc, i.created_at asc
       limit 1
     ) thumb on true
     left join generated_image_favorites fav
       on fav.image_id = thumb.id and fav.user_id = $1
     left join lateral (
       select array_agg(t.tag order by lower(t.tag), t.tag) as tags
       from generated_image_tags t
       where t.image_id = thumb.id
     ) thumb_tags on true
     left join lateral (
       select array_agg(distinct t.tag order by t.tag) as tags
       from generated_images i
       join generated_image_tags t on t.image_id = i.id
       where i.job_id = j.id
     ) job_tags on true
     ${where}
     order by j.created_at desc
     limit ${limitParam}`,
    params
  );

  return result.rows;
}

export async function getActiveQueueStats(user: User) {
  const where = user.role === "admin" ? "" : "and user_id = $1";
  const params = user.role === "admin" ? [] : [user.id];
  const result = await query<{ status: GenerationJob["status"]; count: string }>(
    `select status, count(*)::text as count
     from generation_jobs
     where status in ('queued', 'running') ${where}
     group by status`,
    params
  );

  return {
    queued: Number(result.rows.find((row) => row.status === "queued")?.count ?? 0),
    running: Number(result.rows.find((row) => row.status === "running")?.count ?? 0)
  };
}

export async function listActiveQueueJobs(user: User, limit = 8) {
  const where = user.role === "admin" ? "" : "and j.user_id = $1";
  const params = user.role === "admin" ? [limit] : [user.id, limit];
  const limitParam = user.role === "admin" ? "$1" : "$2";

  const result = await query<GenerationJob & { queue_position: number | null; thumbnail_id: string | null }>(
    `select ${jobListColumns},
            u.username,
            (select min(i.id::text) from generated_images i where i.job_id = j.id) as thumbnail_id,
            case
              when j.status = 'queued' then row_number() over (partition by j.status order by j.created_at asc)::integer
              else null
            end as queue_position
     from generation_jobs j
     join users u on u.id = j.user_id
     where j.status in ('queued', 'running') ${where}
     order by case when j.status = 'running' then 0 else 1 end, j.created_at asc
     limit ${limitParam}`,
    params
  );

  return result.rows;
}

export type JobListItem = GenerationJob & {
  thumbnail_id: string | null;
  thumbnail_tags: string[];
  thumbnail_favorite: boolean;
};

export type FavoriteImageListItem = GeneratedImage & {
  job_prompt: string;
  job_model: string;
  job_size: string;
  job_status: GenerationStatus;
  job_duration_ms: number | null;
  job_created_at: string;
  username: string;
};

export async function listJobsPage(user: User, page: number, pageSize: number, filters: JobListFilters = {}) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(50, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const built = buildJobListWhere(user, filters);
  const params = [...built.params, user.id, safePageSize, offset];
  const favoriteUserParam = `$${params.length - 2}`;
  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;

  // v0.6.1: 同 listRecentJobs 的相关子查询 → LATERAL JOIN 重构,详见上面的注释。
  // /records 分页每次 ≤50 行,改完后大列表场景下 PG 可以走 hash aggregate 一次性出标签集合,
  // 比 50 次相关子查询少一遍 nested-loop。EXISTS → LEFT JOIN 在大数据集上节流更明显。
  const result = await query<JobListItem>(
    `select ${jobListColumns},
            u.username,
            thumb.id::text as thumbnail_id,
            (fav.image_id is not null) as thumbnail_favorite,
            coalesce(thumb_tags.tags, '{}'::text[]) as thumbnail_tags,
            coalesce(job_tags.tags, '{}'::text[]) as tags
     from generation_jobs j
     join users u on u.id = j.user_id
     left join lateral (
       select i.id
       from generated_images i
       where i.job_id = j.id
       order by i.sort_order asc, i.created_at asc
       limit 1
     ) thumb on true
     left join generated_image_favorites fav
       on fav.image_id = thumb.id and fav.user_id = ${favoriteUserParam}
     left join lateral (
       select array_agg(t.tag order by lower(t.tag), t.tag) as tags
       from generated_image_tags t
       where t.image_id = thumb.id
     ) thumb_tags on true
     left join lateral (
       select array_agg(distinct t.tag order by t.tag) as tags
       from generated_images i
       join generated_image_tags t on t.image_id = i.id
       where i.job_id = j.id
     ) job_tags on true
     ${built.where}
     order by j.created_at desc
     limit ${limitParam}
     offset ${offsetParam}`,
    params
  );

  return result.rows;
}

export async function countJobs(user: User, filters: JobListFilters = {}) {
  const built = buildJobListWhere(user, filters);
  const result = await query<{ count: string }>(
    `select count(*)::text as count
     from generation_jobs j
     join users u on u.id = j.user_id
     ${built.where}`,
    built.params
  );

  return Number(result.rows[0]?.count ?? 0);
}

function buildFavoriteImageWhere(user: User, filters: FavoriteImageFilters = {}) {
  const clauses = [`f.user_id = $1`, `($2::text = 'admin' or j.user_id = $1)`];
  const params: unknown[] = [user.id, user.role];

  if (filters.q) {
    params.push(`%${filters.q}%`);
    clauses.push(`(
      j.prompt ilike $${params.length}
      or j.model ilike $${params.length}
      or j.size ilike $${params.length}
      or exists (
        select 1
        from generated_image_tags qt
        where qt.image_id = i.id and qt.tag ilike $${params.length}
      )
    )`);
  }

  if (filters.tag) {
    params.push(filters.tag);
    clauses.push(`exists (
      select 1
      from generated_image_tags tt
      where tt.image_id = i.id and lower(tt.tag) = lower($${params.length})
    )`);
  }

  if (filters.model) {
    params.push(filters.model);
    clauses.push(`j.model = $${params.length}`);
  }

  if (filters.size) {
    params.push(filters.size);
    clauses.push(`j.size = $${params.length}`);
  }

  if (filters.period === "today") {
    clauses.push(`f.created_at >= current_date`);
  } else if (filters.period === "7d") {
    clauses.push(`f.created_at >= now() - interval '7 days'`);
  } else if (filters.period === "30d") {
    clauses.push(`f.created_at >= now() - interval '30 days'`);
  }

  return {
    where: `where ${clauses.join(" and ")}`,
    params
  };
}

export async function countFavoriteImages(user: User, filters: FavoriteImageFilters = {}) {
  const built = buildFavoriteImageWhere(user, filters);
  const result = await query<{ count: string }>(
    `select count(*)::text as count
     from generated_image_favorites f
     join generated_images i on i.id = f.image_id
     join generation_jobs j on j.id = i.job_id
     ${built.where}`,
    built.params
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function listFavoriteImagesPage(user: User, page: number, pageSize: number, filters: FavoriteImageFilters = {}) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(60, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const built = buildFavoriteImageWhere(user, filters);
  const params = [...built.params, safePageSize, offset];
  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;
  const result = await query<FavoriteImageListItem>(
    `select i.*,
            true as is_favorite,
            f.created_at::text as favorite_created_at,
            j.prompt as job_prompt,
            j.model as job_model,
            j.size as job_size,
            j.status as job_status,
            j.duration_ms as job_duration_ms,
            j.created_at::text as job_created_at,
            u.username,
            coalesce(array_agg(t.tag order by lower(t.tag), t.tag) filter (where t.tag is not null), '{}'::text[]) as tags
     from generated_image_favorites f
     join generated_images i on i.id = f.image_id
     join generation_jobs j on j.id = i.job_id
     join users u on u.id = j.user_id
     left join generated_image_tags t on t.image_id = i.id
     ${built.where}
     group by i.id, f.created_at, j.id, u.username
     order by f.created_at desc
     limit ${limitParam} offset ${offsetParam}`,
    params
  );

  return result.rows;
}

export async function getJobById(id: string, user: User): Promise<JobWithImages | null> {
  const result = await query<GenerationJob>(
    `select ${jobListColumns},
            u.username,
            j.response_metadata #>> '{requests,0,keyLabel}' as provider_key_label,
            j.response_metadata #>> '{requests,0,keySource}' as provider_key_source
     from generation_jobs j
     join users u on u.id = j.user_id
     where j.id = $1 and ($2::text = 'admin' or j.user_id = $3)`,
    [id, user.role, user.id]
  );
  const job = result.rows[0];
  if (!job) return null;

  const images = await query<GeneratedImage>(
    `select i.*,
            exists(
              select 1
              from generated_image_favorites f
              where f.image_id = i.id and f.user_id = $2
            ) as is_favorite,
            coalesce(array_agg(t.tag order by lower(t.tag), t.tag) filter (where t.tag is not null), '{}'::text[]) as tags
     from generated_images i
     left join generated_image_tags t on t.image_id = i.id
     where i.job_id = $1
     group by i.id
     order by i.sort_order asc`,
    [id, user.id]
  );

  return { ...job, images: images.rows };
}

export async function getImageForUser(imageId: string, user: User) {
  const result = await query<GeneratedImage & { user_id: string }>(
    `select i.*,
            j.user_id,
            exists(
              select 1
              from generated_image_favorites f
              where f.image_id = i.id and f.user_id = $3
            ) as is_favorite,
            coalesce(array_agg(t.tag order by lower(t.tag), t.tag) filter (where t.tag is not null), '{}'::text[]) as tags
     from generated_images i
     join generation_jobs j on j.id = i.job_id
     left join generated_image_tags t on t.image_id = i.id
     where i.id = $1 and ($2::text = 'admin' or j.user_id = $3)
     group by i.id, j.user_id`,
    [imageId, user.role, user.id]
  );

  return result.rows[0] ?? null;
}

export async function setImageFavoriteForUser(imageId: string, user: User, favorite: boolean) {
  return transaction(async (client) => {
    const imageResult = await client.query<{ id: string }>(
      `select i.id
       from generated_images i
       join generation_jobs j on j.id = i.job_id
       where i.id = $1 and ($2::text = 'admin' or j.user_id = $3)`,
      [imageId, user.role, user.id]
    );
    if (!imageResult.rows[0]) return null;

    if (favorite) {
      await client.query(
        `insert into generated_image_favorites (user_id, image_id)
         values ($1, $2)
         on conflict do nothing`,
        [user.id, imageId]
      );
      return true;
    }

    await client.query(
      `delete from generated_image_favorites where user_id = $1 and image_id = $2`,
      [user.id, imageId]
    );
    return false;
  });
}

export async function listImageTagsForUser(user: User, limit = 80) {
  const safeLimit = Math.max(1, Math.min(200, limit));
  const params = user.role === "admin" ? [safeLimit] : [user.id, safeLimit];
  const where = user.role === "admin" ? "" : "where j.user_id = $1";
  const limitParam = user.role === "admin" ? "$1" : "$2";
  const result = await query<{ tag: string; usage_count: string }>(
    `select t.tag, count(*)::text as usage_count, max(t.created_at) as last_used_at
     from generated_image_tags t
     join generated_images i on i.id = t.image_id
     join generation_jobs j on j.id = i.job_id
     ${where}
     group by t.tag
     order by max(t.created_at) desc, lower(t.tag) asc
     limit ${limitParam}`,
    params
  );
  return result.rows.map((row) => ({ tag: row.tag, usage_count: Number(row.usage_count) }));
}

export async function setImageTagsForUser(imageId: string, rawTags: unknown, user: User) {
  const tags = normalizeImageTags(rawTags);

  return transaction(async (client) => {
    const imageResult = await client.query<{ id: string }>(
      `select i.id
       from generated_images i
       join generation_jobs j on j.id = i.job_id
       where i.id = $1 and ($2::text = 'admin' or j.user_id = $3)
       for update`,
      [imageId, user.role, user.id]
    );
    if (!imageResult.rows[0]) return null;

    await client.query(`delete from generated_image_tags where image_id = $1`, [imageId]);
    for (const tag of tags) {
      await client.query(
        `insert into generated_image_tags (image_id, tag, created_by)
         values ($1, $2, $3)
         on conflict do nothing`,
        [imageId, tag, user.id]
      );
    }
    return tags;
  });
}

export async function addTagsToJobsForUser(jobIds: string[], rawTags: unknown, user: User) {
  const tags = normalizeImageTags(rawTags);
  const uniqueJobIds = Array.from(new Set(jobIds)).slice(0, 100);
  if (uniqueJobIds.length === 0 || tags.length === 0) {
    return { tags, jobCount: 0, imageCount: 0 };
  }

  return transaction(async (client) => {
    const images = await client.query<{ id: string; job_id: string }>(
      `select i.id::text as id, j.id::text as job_id
       from generated_images i
       join generation_jobs j on j.id = i.job_id
       where j.id = any($1::uuid[])
         and ($2::text = 'admin' or j.user_id = $3)`,
      [uniqueJobIds, user.role, user.id]
    );
    const imageIds = images.rows.map((row) => row.id);
    if (imageIds.length === 0) {
      return { tags, jobCount: 0, imageCount: 0 };
    }

    await client.query(
      `insert into generated_image_tags (image_id, tag, created_by)
       select image_id, tag, $3::uuid
       from unnest($1::uuid[]) as image_id
       cross join unnest($2::text[]) as tag
       on conflict do nothing`,
      [imageIds, tags, user.id]
    );

    return {
      tags,
      jobCount: new Set(images.rows.map((row) => row.job_id)).size,
      imageCount: imageIds.length
    };
  });
}

/**
 * 与 addTagsToJobsForUser 同样的 unnest 批插入,但单位是 image id 而不是 job id.
 * 用于 /favorites 的批量"加标签":选中的是图,直接按 i.id 过滤,无需先解出 job.
 * user scope:admin 可加任意图;member 只能加自己 job 下的图.
 */
export async function addTagsToImagesForUser(imageIds: string[], rawTags: unknown, user: User) {
  const tags = normalizeImageTags(rawTags);
  const uniqueImageIds = Array.from(new Set(imageIds)).slice(0, 100);
  if (uniqueImageIds.length === 0 || tags.length === 0) {
    return { tags, imageCount: 0 };
  }

  return transaction(async (client) => {
    const images = await client.query<{ id: string }>(
      `select i.id::text as id
       from generated_images i
       join generation_jobs j on j.id = i.job_id
       where i.id = any($1::uuid[])
         and ($2::text = 'admin' or j.user_id = $3)`,
      [uniqueImageIds, user.role, user.id]
    );
    const allowedIds = images.rows.map((row) => row.id);
    if (allowedIds.length === 0) {
      return { tags, imageCount: 0 };
    }

    await client.query(
      `insert into generated_image_tags (image_id, tag, created_by)
       select image_id, tag, $3::uuid
       from unnest($1::uuid[]) as image_id
       cross join unnest($2::text[]) as tag
       on conflict do nothing`,
      [allowedIds, tags, user.id]
    );

    return { tags, imageCount: allowedIds.length };
  });
}

/**
 * 批量取消"当前用户"对若干图片的收藏(generated_image_favorites 联合主键 user_id, image_id).
 * 不影响其他用户的收藏关系;admin 调用也只清自己的收藏,语义符合"我的收藏作品集"页.
 * 返回实际删除的行数.
 */
export async function unfavoriteImagesForUser(imageIds: string[], user: User) {
  const uniqueImageIds = Array.from(new Set(imageIds)).slice(0, 100);
  if (uniqueImageIds.length === 0) {
    return { removed: 0 };
  }
  const result = await query(
    `delete from generated_image_favorites
     where user_id = $1 and image_id = any($2::uuid[])`,
    [user.id, uniqueImageIds]
  );
  return { removed: result.rowCount ?? 0 };
}

export async function listImageVersionChainForJob(jobId: string, user: User) {
  const result = await query<ImageVersionNode>(
    `with recursive
       seed as (
         select i.id
         from generated_images i
         join generation_jobs j on j.id = i.job_id
         where j.id = $1 and ($2::text = 'admin' or j.user_id = $3)
       ),
       ancestors as (
         select i.id, i.parent_image_id
         from generated_images i
         join generation_jobs j on j.id = i.job_id
         join seed s on s.id = i.id
         where $2::text = 'admin' or j.user_id = $3

         union

         select parent.id, parent.parent_image_id
         from generated_images parent
         join generation_jobs parent_job on parent_job.id = parent.job_id
         join ancestors child on child.parent_image_id = parent.id
         where $2::text = 'admin' or parent_job.user_id = $3
       ),
       roots as (
         select distinct a.id
         from ancestors a
         where a.parent_image_id is null
            or not exists (
              select 1
              from generated_images parent
              join generation_jobs parent_job on parent_job.id = parent.job_id
              where parent.id = a.parent_image_id
                and ($2::text = 'admin' or parent_job.user_id = $3)
            )
       ),
       tree as (
         select
           i.id,
           i.job_id,
           i.parent_image_id,
           i.local_path,
           i.mime_type,
           i.width,
           i.height,
           i.byte_size,
           i.checksum,
           i.sort_order,
           i.created_at::text as created_at,
           0::integer as depth,
           array[i.id] as path_ids,
           array[to_char(i.created_at, 'YYYYMMDDHH24MISSMS') || i.id::text] as path_key,
           j.prompt as job_prompt,
           j.model as job_model,
           j.size as job_size,
           j.status as job_status,
           j.created_at::text as job_created_at
         from generated_images i
         join generation_jobs j on j.id = i.job_id
         join roots r on r.id = i.id
         where $2::text = 'admin' or j.user_id = $3

         union all

         select
           child.id,
           child.job_id,
           child.parent_image_id,
           child.local_path,
           child.mime_type,
           child.width,
           child.height,
           child.byte_size,
           child.checksum,
           child.sort_order,
           child.created_at::text as created_at,
           tree.depth + 1 as depth,
           tree.path_ids || child.id as path_ids,
           tree.path_key || (to_char(child.created_at, 'YYYYMMDDHH24MISSMS') || child.id::text) as path_key,
           child_job.prompt as job_prompt,
           child_job.model as job_model,
           child_job.size as job_size,
           child_job.status as job_status,
           child_job.created_at::text as job_created_at
         from generated_images child
         join generation_jobs child_job on child_job.id = child.job_id
         join tree on child.parent_image_id = tree.id
         where ($2::text = 'admin' or child_job.user_id = $3)
           and not child.id = any(tree.path_ids)
       )
     select
       tree.id,
       tree.job_id,
       tree.parent_image_id,
       tree.local_path,
       tree.mime_type,
       tree.width,
       tree.height,
       tree.byte_size,
       tree.checksum,
       tree.sort_order,
       tree.created_at,
       tree.depth,
       exists(select 1 from seed where seed.id = tree.id) as is_current,
       tree.job_prompt,
       tree.job_model,
       tree.job_size,
       tree.job_status,
       tree.job_created_at
     from tree
     order by tree.path_key`,
    [jobId, user.role, user.id]
  );

  return result.rows;
}

export async function cancelJobForUser(jobId: string, user: User) {
  const result = await query<{ id: string }>(
    `update generation_jobs
     set status = 'canceled',
         error_message = null,
         request_metadata = jsonb_set(
           request_metadata,
           '{progress}',
           jsonb_build_object(
             'phase', 'canceled',
             'current', coalesce((request_metadata #>> '{progress,current}')::integer, 0),
             'total', count,
             'percent', 0,
             'message', '任务已取消',
             'updatedAt', now()::text
           ),
           true
         ),
         completed_at = now(),
         duration_ms = case
           when started_at is null then null
           else greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer)
         end,
         updated_at = now()
     where id = $1
       and ($2::text = 'admin' or user_id = $3)
       and status in ('queued', 'running')
     returning id`,
    [jobId, user.role, user.id]
  );

  return Boolean(result.rows[0]);
}

export async function createJob(
  client: PoolClient,
  input: Pick<GenerationJob, "user_id" | "model" | "prompt" | "size" | "count" | "status" | "request_metadata">
) {
  const result = await client.query<GenerationJob>(
    `insert into generation_jobs (user_id, model, prompt, size, count, status, request_metadata)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [input.user_id, input.model, input.prompt, input.size, input.count, input.status, input.request_metadata]
  );
  return result.rows[0];
}

export async function listReferenceImages() {
  return query<ReferenceImage & { username: string }>(
    `select r.*, u.username
     from reference_images r
     join users u on u.id = r.user_id
     order by r.created_at desc`
  );
}

export type ReferenceImageWithUsage = ReferenceImage & {
  username: string;
  usage_count: number;
  last_used_at: string | null;
  related_jobs: { id: string; prompt: string; status: string; created_at: string }[] | null;
};

export async function listReferenceImagesWithUsage(page = 1, pageSize = 24) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(100, pageSize));
  const offset = (safePage - 1) * safePageSize;

  const [countResult, dataResult] = await Promise.all([
    query<{ count: string }>(
      `select count(*)::text as count from reference_images`
    ),
    query<ReferenceImageWithUsage>(
      `with page_refs as (
         select r.*, u.username
         from reference_images r
         join users u on u.id = r.user_id
         order by r.created_at desc
         limit $1 offset $2
       ),
       usage_rows as (
         select
           pr.id as reference_id,
           j.id as job_id,
           j.prompt,
           j.status,
           j.created_at,
           count(j.id) over (partition by pr.id)::int as usage_count,
           max(j.created_at) over (partition by pr.id) as last_used_at,
           row_number() over (partition by pr.id order by j.created_at desc) as row_number
         from page_refs pr
         left join generation_jobs j
           on j.request_metadata -> 'reference' ->> 'localPath' = pr.local_path
              or exists (
                select 1
                from jsonb_array_elements(coalesce(j.request_metadata -> 'references', '[]'::jsonb)) as ref(value)
                where ref.value ->> 'localPath' = pr.local_path
              )
       ),
       usage as (
         select
           reference_id,
           coalesce(max(usage_count), 0)::int as usage_count,
           max(last_used_at) as last_used_at,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id', job_id,
                 'prompt', left(prompt, 60),
                 'status', status,
                 'created_at', created_at
               )
               order by created_at desc
             ) filter (where job_id is not null and row_number <= 5),
             '[]'::jsonb
           ) as related_jobs
         from usage_rows
         group by reference_id
       )
       select
         pr.*,
         coalesce(usage.usage_count, 0)::int as usage_count,
         usage.last_used_at,
         coalesce(usage.related_jobs, '[]'::jsonb) as related_jobs
       from page_refs pr
       left join usage on usage.reference_id = pr.id
       order by pr.created_at desc`,
      [safePageSize, offset]
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0),
    page: safePage,
    pageSize: safePageSize
  };
}

export async function listUnusedReferenceImages() {
  return query<{ id: string; local_path: string }>(
    `select r.id, r.local_path
     from reference_images r
     where not exists (
       select 1 from generation_jobs j
       where j.request_metadata -> 'reference' ->> 'localPath' = r.local_path
          or exists (
            select 1
            from jsonb_array_elements(coalesce(j.request_metadata -> 'references', '[]'::jsonb)) as ref(value)
            where ref.value ->> 'localPath' = r.local_path
          )
     )`
  );
}

export async function findReferenceByChecksum(checksum: string) {
  const result = await query<ReferenceImage>(
    `select * from reference_images where checksum = $1 limit 1`,
    [checksum]
  );
  return result.rows[0] ?? null;
}

export async function getReferenceImageById(id: string) {
  const result = await query<ReferenceImage>(
    `select * from reference_images where id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getLatestReferenceImageForUser(user: User) {
  const rows = await listRecentReferenceImagesForUser(user, 1);
  return rows[0] ?? null;
}

export async function listRecentReferenceImagesForUser(user: User, limit = 5) {
  const safeLimit = Math.max(1, Math.min(8, limit));
  const result = await query<ReferenceImage>(
    `select *
     from reference_images
     where user_id = $1
     order by created_at desc
     limit ${safeLimit}`,
    [user.id]
  );
  return result.rows;
}

export async function mergeDuplicateReferences() {
  return transaction(async (client) => {
    const groups = await client.query<{ checksum: string; keep_id: string; keep_path: string }>(
      `select r.checksum,
              (array_agg(r.id order by r.created_at asc))[1]::text as keep_id,
              (array_agg(r.local_path order by r.created_at asc))[1] as keep_path
       from reference_images r
       group by r.checksum
       having count(*) > 1`
    );

    const removedPaths: string[] = [];

    for (const group of groups.rows) {
      const duplicates = await client.query<{ id: string; local_path: string }>(
        `select id, local_path from reference_images
         where checksum = $1 and id != $2`,
        [group.checksum, group.keep_id]
      );

      for (const dup of duplicates.rows) {
        await client.query(
          `update generation_jobs
           set request_metadata = jsonb_set(
             request_metadata,
             '{reference,localPath}',
             to_jsonb($1::text)
           )
           where request_metadata -> 'reference' ->> 'localPath' = $2`,
          [group.keep_path, dup.local_path]
        );
        await client.query(
          `update generation_jobs j
           set request_metadata = jsonb_set(
             request_metadata,
             '{references}',
             (
               select jsonb_agg(
                 case
                   when ref.value ->> 'localPath' = $2 then jsonb_set(ref.value, '{localPath}', to_jsonb($1::text), true)
                   else ref.value
                 end
                 order by ref.ordinality
               )
               from jsonb_array_elements(coalesce(j.request_metadata -> 'references', '[]'::jsonb)) with ordinality ref(value, ordinality)
             ),
             true
           )
           where exists (
             select 1
             from jsonb_array_elements(coalesce(j.request_metadata -> 'references', '[]'::jsonb)) as ref(value)
             where ref.value ->> 'localPath' = $2
           )`,
          [group.keep_path, dup.local_path]
        );

        await client.query(`delete from reference_images where id = $1`, [dup.id]);

        if (dup.local_path !== group.keep_path) {
          removedPaths.push(dup.local_path);
        }
      }
    }

    return { merged: groups.rows.length, removedPaths };
  });
}

export async function deleteReferenceImage(id: string) {
  const result = await query<{ local_path: string }>(
    `delete from reference_images where id = $1 returning local_path`,
    [id]
  );
  return result.rows[0] ?? null;
}
