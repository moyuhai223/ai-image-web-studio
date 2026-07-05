import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { requestBodyTooLarge } from "@/lib/request-guard";
import { generateSchema, allowedImageTypes } from "@/lib/validation";
import { enqueueGenerationJob } from "@/lib/generation-queue";
import {
  createJob,
  findReferenceByChecksum,
  getActiveQueueStats,
  getImageForUser,
  getJobById,
  getReferenceImageById
} from "@/lib/repository";
import { saveImageBuffer } from "@/lib/storage";
import { normalizeImageSize } from "@/lib/image-size";

export const runtime = "nodejs";
export const maxDuration = 300;

type ReferenceMetadata = {
  localPath: string;
  mimeType: string;
  byteSize: number;
  source: "upload" | "library" | "generated";
  sourceImageId?: string;
  referenceImageId?: string;
};

type ReferenceItem = {
  type: "upload" | "library" | "generated";
  id?: string;
  uploadIndex?: number;
};

function parseReferenceItems(value: FormDataEntryValue | null): ReferenceItem[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items = parsed
      .map((item): ReferenceItem | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        if (record.type === "upload" && Number.isInteger(record.uploadIndex)) {
          return { type: "upload", uploadIndex: Number(record.uploadIndex) } satisfies ReferenceItem;
        }
        if ((record.type === "library" || record.type === "generated") && typeof record.id === "string") {
          return { type: record.type, id: record.id } satisfies ReferenceItem;
        }
        return null;
      })
      .filter((item): item is ReferenceItem => Boolean(item));
    return items.slice(0, config.maxReferenceImages);
  } catch {
    return [];
  }
}

async function saveReferenceFile(file: File, userId: string): Promise<ReferenceMetadata | NextResponse> {
  if (!allowedImageTypes.has(file.type)) {
    return NextResponse.json({ error: "参考图只支持 PNG、JPEG 或 WebP" }, { status: 400 });
  }
  if (file.size > config.maxUploadMb * 1024 * 1024) {
    return NextResponse.json({ error: `参考图不能超过 ${config.maxUploadMb}MB` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const existing = await findReferenceByChecksum(checksum);
  if (existing) {
    return {
      source: "upload",
      referenceImageId: existing.id,
      localPath: existing.local_path,
      mimeType: existing.mime_type,
      byteSize: existing.byte_size
    };
  }

  const stored = await saveImageBuffer(buffer, file.type, "references", `${userId.slice(0, 8)}-ref-${randomUUID()}`);
  const inserted = await query<{ id: string }>(
    `insert into reference_images (user_id, local_path, mime_type, byte_size, checksum)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [userId, stored.relativePath, stored.mimeType, stored.byteSize, stored.checksum]
  );
  return {
    source: "upload",
    referenceImageId: inserted.rows[0]?.id,
    localPath: stored.relativePath,
    mimeType: stored.mimeType,
    byteSize: stored.byteSize
  };
}

/** 事务内权威配额判定失败时抛出,由 POST 捕获并转成对应的 429 响应。 */
class QuotaError extends Error {
  constructor(readonly body: Record<string, unknown>, readonly headers?: Record<string, string>) {
    super("quota exceeded");
    this.name = "QuotaError";
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (requestBodyTooLarge(request)) {
    return NextResponse.json({ error: "上传内容过大", code: "payload_too_large" }, { status: 413 });
  }
  const formData = await request.formData();
  const parsed = generateSchema.safeParse({
    prompt: formData.get("prompt"),
    model: formData.get("model"),
    size: formData.get("size"),
    count: formData.get("count"),
    groupId: formData.get("groupId")
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const requestedCount = parsed.data.count;
  // 自定义/预设尺寸统一自动裁剪成合规值(/16、长边≤3840、像素预算);"auto" 原样保留
  const requestedSize = normalizeImageSize(parsed.data.size);
  // 提前 429 守门:queued + running 已占满全局并发上限就拒绝,避免任务排到天荒地老。
  // 返回结构带 code 让前端能区分"队列满"和"参数错误";retry-after 由 nginx/客户端兼容。
  const queueStats = await getActiveQueueStats(user);
  const queueOccupied = queueStats.queued + queueStats.running;
  if (queueOccupied + requestedCount > config.maxGenerationQueueSize) {
    return NextResponse.json(
      {
        error: `当前队列已满(排队 ${queueStats.queued} / 进行中 ${queueStats.running} / 上限 ${config.maxGenerationQueueSize}),请稍后再试`,
        code: "queue_full",
        retryAfterSeconds: 30
      },
      {
        status: 429,
        headers: { "retry-after": "30" }
      }
    );
  }

  if (config.dailyGenerationLimit > 0) {
    const daily = await query<{ count: string }>(
      `select count(*)::text as count
       from generation_jobs
       where user_id = $1 and created_at >= current_date`,
      [user.id]
    );
    if (Number(daily.rows[0]?.count ?? 0) + requestedCount > config.dailyGenerationLimit) {
      return NextResponse.json({ error: `今日生成次数已达上限（${config.dailyGenerationLimit} 次）` }, { status: 429 });
    }
  }

  const uploadFiles = formData
    .getAll("referenceImages")
    .filter((value): value is File => value instanceof File && value.size > 0)
    .slice(0, config.maxReferenceImages);
  const legacyFile = formData.get("referenceImage");
  if (legacyFile instanceof File && legacyFile.size > 0 && uploadFiles.length === 0) {
    uploadFiles.push(legacyFile);
  }
  const orderedItems = parseReferenceItems(formData.get("referenceItems"));
  const fallbackItems: ReferenceItem[] =
    orderedItems.length > 0
      ? orderedItems
      : [
          ...uploadFiles.map((_, uploadIndex) => ({ type: "upload" as const, uploadIndex })),
          ...formData.getAll("existingRefIds").map((id) => ({ type: "library" as const, id: String(id) })),
          ...formData.getAll("referenceImageIds").map((id) => ({ type: "generated" as const, id: String(id) })),
          ...(typeof formData.get("existingRefId") === "string" && String(formData.get("existingRefId")).trim()
            ? [{ type: "library" as const, id: String(formData.get("existingRefId")) }]
            : []),
          ...(typeof formData.get("referenceImageId") === "string" && String(formData.get("referenceImageId")).trim()
            ? [{ type: "generated" as const, id: String(formData.get("referenceImageId")) }]
            : [])
        ].slice(0, config.maxReferenceImages);

  const references: ReferenceMetadata[] = [];
  const seenReferencePaths = new Set<string>();
  for (const item of fallbackItems) {
    let reference: ReferenceMetadata | NextResponse | null = null;
    if (item.type === "upload") {
      const file = uploadFiles[item.uploadIndex ?? -1];
      if (!file) continue;
      reference = await saveReferenceFile(file, user.id);
    } else if (item.type === "library" && item.id?.trim()) {
      const refImage = await getReferenceImageById(item.id.trim());
      if (!refImage || (user.role !== "admin" && refImage.user_id !== user.id)) {
        return NextResponse.json({ error: "参考图不存在或无权访问" }, { status: 404 });
      }
      reference = {
        source: "library",
        referenceImageId: refImage.id,
        localPath: refImage.local_path,
        mimeType: refImage.mime_type,
        byteSize: refImage.byte_size
      };
    } else if (item.type === "generated" && item.id?.trim()) {
      const referenceImage = await getImageForUser(item.id.trim(), user);
      if (!referenceImage) {
        return NextResponse.json({ error: "参考图不存在或无权访问" }, { status: 404 });
      }
      reference = {
        source: "generated",
        sourceImageId: referenceImage.id,
        localPath: referenceImage.local_path,
        mimeType: referenceImage.mime_type,
        byteSize: referenceImage.byte_size
      };
    }

    if (reference instanceof NextResponse) return reference;
    if (reference && !seenReferencePaths.has(reference.localPath)) {
      seenReferencePaths.add(reference.localPath);
      references.push(reference);
    }
    if (references.length >= config.maxReferenceImages) break;
  }
  const referenceMetadata = references[0] ?? null;

  // 局部重绘蒙版:仅在有参考图(编辑模式)时接受;存盘并写入 metadata,作用于第一张参考图。
  // composite:出图后是否 sharp 合成贴回原图高清版;前端默认勾选,显式传 "false" 才关。
  let maskMetadata: { localPath: string; mimeType: string; composite: boolean } | null = null;
  const maskFile = formData.get("maskImage");
  if (references.length > 0 && maskFile instanceof File && maskFile.size > 0 && maskFile.size <= 12 * 1024 * 1024) {
    const maskMime = maskFile.type && maskFile.type.startsWith("image/") ? maskFile.type : "image/png";
    const maskBuffer = Buffer.from(await maskFile.arrayBuffer());
    const stored = await saveImageBuffer(maskBuffer, maskMime, "masks", `${user.id.slice(0, 8)}-mask-${randomUUID()}`);
    maskMetadata = {
      localPath: stored.relativePath,
      mimeType: maskMime,
      composite: formData.get("maskComposite") !== "false"
    };
  }

  const batchId = randomUUID();
  const now = new Date().toISOString();
  let jobs: Awaited<ReturnType<typeof createJob>>[];
  try {
    jobs = await transaction(async (client) => {
    // 配额 TOCTOU 修复:per-user advisory lock 串行化同一用户的并发建任务,锁内权威重算队列/日次配额,
    // 再插入。上面的早退检查只是乐观快返(省掉超限时的参考图处理),这里才是防并发绕过的真正闸门。
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [user.id]);

    const activeRes = await client.query<{ count: string }>(
      `select count(*)::text as count from generation_jobs where user_id = $1 and status in ('queued', 'running')`,
      [user.id]
    );
    if (Number(activeRes.rows[0]?.count ?? 0) + requestedCount > config.maxGenerationQueueSize) {
      throw new QuotaError(
        { error: `当前队列已满(上限 ${config.maxGenerationQueueSize}),请稍后再试`, code: "queue_full", retryAfterSeconds: 30 },
        { "retry-after": "30" }
      );
    }
    if (config.dailyGenerationLimit > 0) {
      const dailyRes = await client.query<{ count: string }>(
        `select count(*)::text as count from generation_jobs where user_id = $1 and created_at >= current_date`,
        [user.id]
      );
      if (Number(dailyRes.rows[0]?.count ?? 0) + requestedCount > config.dailyGenerationLimit) {
        throw new QuotaError({ error: `今日生成次数已达上限（${config.dailyGenerationLimit} 次）` });
      }
    }

    const created = [];
    for (let index = 0; index < requestedCount; index += 1) {
      created.push(
        await createJob(client, {
          user_id: user.id,
          model: parsed.data.model,
          prompt: parsed.data.prompt,
          size: requestedSize,
          count: 1,
          status: "queued",
          request_metadata: {
            size: requestedSize,
            count: 1,
            requestedCount,
            batch: {
              id: batchId,
              index: index + 1,
              total: requestedCount
            },
            reference: referenceMetadata,
            references,
            mask: maskMetadata,
            providerGroupId: parsed.data.groupId ?? null,
            progress: {
              phase: "queued",
              current: 0,
              total: 1,
              percent: 5,
              message: requestedCount > 1 ? `批量任务 ${index + 1}/${requestedCount} 已进入后台队列` : "任务已进入后台队列",
              updatedAt: now
            }
          }
        })
      );
    }
    return created;
    });
  } catch (error) {
    if (error instanceof QuotaError) {
      return NextResponse.json(error.body, { status: 429, headers: error.headers });
    }
    throw error;
  }

  for (const job of jobs) {
    enqueueGenerationJob(job.id);
  }

  const queued = (await Promise.all(jobs.map((job) => getJobById(job.id, user)))).filter((job) => job !== null);
  return NextResponse.json({ job: queued[0] ?? null, jobs: queued, batch: { id: batchId, total: requestedCount } }, { status: 202 });
}
