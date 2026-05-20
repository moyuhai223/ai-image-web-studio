import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { query, transaction } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { generateSchema, allowedImageTypes } from "@/lib/validation";
import { enqueueGenerationJob } from "@/lib/generation-queue";
import { createJob, findReferenceByChecksum, getImageForUser, getJobById, getReferenceImageById } from "@/lib/repository";
import { saveImageBuffer } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await requireUser();
  const formData = await request.formData();
  const parsed = generateSchema.safeParse({
    prompt: formData.get("prompt"),
    model: formData.get("model"),
    size: formData.get("size"),
    count: formData.get("count")
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const requestedCount = parsed.data.count;
  const active = await query<{ queued: string }>(
    `select count(*) filter (where status = 'queued')::text as queued
     from generation_jobs
     where status in ('queued', 'running')`
  );
  if (Number(active.rows[0]?.queued ?? 0) + requestedCount > config.maxGenerationQueueSize) {
    return NextResponse.json({ error: `当前排队任务较多，请稍后再试（最多排队 ${config.maxGenerationQueueSize} 个）` }, { status: 429 });
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

  const referenceFile = formData.get("referenceImage");
  const referenceImageId = formData.get("referenceImageId");
  const existingRefId = formData.get("existingRefId");
  let referenceMetadata: Record<string, unknown> | null = null;

  if (referenceFile instanceof File && referenceFile.size > 0) {
    if (!allowedImageTypes.has(referenceFile.type)) {
      return NextResponse.json({ error: "参考图只支持 PNG、JPEG 或 WebP" }, { status: 400 });
    }
    if (referenceFile.size > config.maxUploadMb * 1024 * 1024) {
      return NextResponse.json({ error: `参考图不能超过 ${config.maxUploadMb}MB` }, { status: 400 });
    }
    const buffer = Buffer.from(await referenceFile.arrayBuffer());
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const existing = await findReferenceByChecksum(checksum);
    if (existing) {
      referenceMetadata = { localPath: existing.local_path, mimeType: existing.mime_type, byteSize: existing.byte_size };
    } else {
      const stored = await saveImageBuffer(buffer, referenceFile.type, "references", `${user.id.slice(0, 8)}-ref-${randomUUID()}`);
      await query(
        `insert into reference_images (user_id, local_path, mime_type, byte_size, checksum)
         values ($1, $2, $3, $4, $5)`,
        [user.id, stored.relativePath, stored.mimeType, stored.byteSize, stored.checksum]
      );
      referenceMetadata = { localPath: stored.relativePath, mimeType: stored.mimeType, byteSize: stored.byteSize };
    }
  } else if (typeof existingRefId === "string" && existingRefId.trim()) {
    const refImage = await getReferenceImageById(existingRefId.trim());
    if (!refImage || (user.role !== "admin" && refImage.user_id !== user.id)) {
      return NextResponse.json({ error: "参考图不存在或无权访问" }, { status: 404 });
    }
    referenceMetadata = {
      localPath: refImage.local_path,
      mimeType: refImage.mime_type,
      byteSize: refImage.byte_size
    };
  } else if (typeof referenceImageId === "string" && referenceImageId.trim()) {
    const referenceImage = await getImageForUser(referenceImageId.trim(), user);
    if (!referenceImage) {
      return NextResponse.json({ error: "参考图不存在或无权访问" }, { status: 404 });
    }

    referenceMetadata = {
      sourceImageId: referenceImage.id,
      localPath: referenceImage.local_path,
      mimeType: referenceImage.mime_type,
      byteSize: referenceImage.byte_size
    };
  }

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const jobs = await transaction(async (client) => {
    const created = [];
    for (let index = 0; index < requestedCount; index += 1) {
      created.push(
        await createJob(client, {
          user_id: user.id,
          model: parsed.data.model,
          prompt: parsed.data.prompt,
          size: parsed.data.size,
          count: 1,
          status: "queued",
          request_metadata: {
            size: parsed.data.size,
            count: 1,
            requestedCount,
            batch: {
              id: batchId,
              index: index + 1,
              total: requestedCount
            },
            reference: referenceMetadata,
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

  for (const job of jobs) {
    enqueueGenerationJob(job.id);
  }

  const queued = (await Promise.all(jobs.map((job) => getJobById(job.id, user)))).filter((job) => job !== null);
  return NextResponse.json({ job: queued[0] ?? null, jobs: queued, batch: { id: batchId, total: requestedCount } }, { status: 202 });
}
