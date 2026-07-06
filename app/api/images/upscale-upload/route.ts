import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { boundedSharp } from "@/lib/image-limits";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, transaction } from "@/lib/db";
import { enqueueGenerationJob } from "@/lib/generation-queue";
import { createJob, findReferenceByChecksum, getActiveQueueStats, getJobById, getReferenceImageById } from "@/lib/repository";
import { readStoredFile, saveImageBuffer } from "@/lib/storage";
import { computeUpscaleSize } from "@/lib/image-size";
import { requestBodyTooLarge } from "@/lib/request-guard";
import { getDailyGenerationLimit } from "@/lib/usage-limits";
import { allowedImageTypes } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const AI_UPSCALE_PROMPT =
  "在不改变画面内容、构图、主体、色彩和风格的前提下,将这张图片高清化:增强细节与清晰度、去除模糊与噪点、提升纹理质感,输出更高分辨率的同一张图。不要添加、删除或改动任何元素。";

type UpscaleReference = { source: "library"; referenceImageId?: string; localPath: string; mimeType: string; byteSize: number };

// 对一张参考图(新上传文件 或 已存在的参考图 id)做 AI 4K 高清化:当作参考走编辑接口在模型原生 4K 重画
// (runner 用 sharp 兜底到 4K),结果作为一条新生成记录(无 parent)。
export async function POST(request: Request) {
  const user = await requireUser();
  if (requestBodyTooLarge(request)) {
    return NextResponse.json({ error: "上传内容过大", code: "payload_too_large" }, { status: 413 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("image");
  const referenceImageId =
    typeof formData?.get("referenceImageId") === "string" ? String(formData.get("referenceImageId")).trim() : "";

  // 队列 + 日次守门(与生成一致)
  const queueStats = await getActiveQueueStats(user);
  if (queueStats.queued + queueStats.running + 1 > config.maxGenerationQueueSize) {
    return NextResponse.json(
      {
        error: `当前队列已满(排队 ${queueStats.queued} / 进行中 ${queueStats.running} / 上限 ${config.maxGenerationQueueSize}),请稍后再试`,
        code: "queue_full",
        retryAfterSeconds: 30
      },
      { status: 429, headers: { "retry-after": "30" } }
    );
  }
  const dailyGenerationLimit = await getDailyGenerationLimit();
  if (dailyGenerationLimit > 0) {
    const daily = await query<{ count: string }>(
      `select count(*)::text as count from generation_jobs where user_id = $1 and created_at >= current_date`,
      [user.id]
    );
    if (Number(daily.rows[0]?.count ?? 0) + 1 > dailyGenerationLimit) {
      return NextResponse.json({ error: `今日生成次数已达上限（${dailyGenerationLimit} 次）` }, { status: 429 });
    }
  }

  // 解析来源:上传文件 或 已有参考图 id;统一得到 reference(参考图元信息)+ dimsBuffer(用于读尺寸)
  let reference: UpscaleReference;
  let dimsBuffer: Buffer;

  if (file instanceof File && file.size > 0) {
    if (!allowedImageTypes.has(file.type)) {
      return NextResponse.json({ error: "只支持 PNG、JPEG 或 WebP" }, { status: 400 });
    }
    if (file.size > config.maxUploadMb * 1024 * 1024) {
      return NextResponse.json({ error: `图片不能超过 ${config.maxUploadMb}MB` }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    dimsBuffer = buffer;
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const existing = await findReferenceByChecksum(checksum);
    if (existing) {
      reference = {
        source: "library",
        referenceImageId: existing.id,
        localPath: existing.local_path,
        mimeType: existing.mime_type,
        byteSize: existing.byte_size
      };
    } else {
      const stored = await saveImageBuffer(buffer, file.type, "references", `${user.id.slice(0, 8)}-up-${randomUUID()}`);
      const inserted = await query<{ id: string }>(
        `insert into reference_images (user_id, local_path, mime_type, byte_size, checksum)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [user.id, stored.relativePath, stored.mimeType, stored.byteSize, stored.checksum]
      );
      reference = {
        source: "library",
        referenceImageId: inserted.rows[0]?.id,
        localPath: stored.relativePath,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize
      };
    }
  } else if (referenceImageId) {
    const refImage = await getReferenceImageById(referenceImageId);
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
    const stored = await readStoredFile(refImage.local_path);
    dimsBuffer = stored.buffer;
  } else {
    return NextResponse.json({ error: "请上传图片或指定参考图" }, { status: 400 });
  }

  // 读尺寸算 4K 目标(读不到则回退方形 4K)
  let width = 0;
  let height = 0;
  try {
    const meta = await boundedSharp(dimsBuffer).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    // 忽略:用回退尺寸
  }
  const targetLongEdge = config.upscaleLongEdge;
  const size = width && height ? computeUpscaleSize(width, height, targetLongEdge) : "2880x2880";
  const computedLongEdge = (() => {
    const [tw, th] = size.split("x").map((n) => Number(n));
    return Math.max(tw || targetLongEdge, th || targetLongEdge);
  })();

  const now = new Date().toISOString();
  const job = await transaction(async (client) =>
    createJob(client, {
      user_id: user.id,
      model: config.imageModelGpt,
      prompt: AI_UPSCALE_PROMPT,
      size,
      count: 1,
      status: "queued",
      request_metadata: {
        size,
        count: 1,
        reference,
        references: [reference],
        upscale: { mode: "ai", targetLongEdge: computedLongEdge },
        progress: {
          phase: "queued",
          current: 0,
          total: 1,
          percent: 5,
          message: "图片高清化任务已进入后台队列",
          updatedAt: now
        }
      }
    })
  );

  enqueueGenerationJob(job.id);
  const full = await getJobById(job.id, user);
  return NextResponse.json({ job: full, mode: "ai" }, { status: 202 });
}
