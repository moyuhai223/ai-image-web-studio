import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { query, transaction } from "@/lib/db";
import { enqueueGenerationJob } from "@/lib/generation-queue";
import { createJob, getActiveQueueStats, getImageForUser, getJobById } from "@/lib/repository";
import { computeUpscaleSize } from "@/lib/image-size";
import { getDailyGenerationLimit } from "@/lib/usage-limits";
import { upscaleSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const AI_UPSCALE_PROMPT =
  "在不改变画面内容、构图、主体、色彩和风格的前提下,将这张图片高清化:增强细节与清晰度、去除模糊与噪点、提升纹理质感,输出更高分辨率的同一张图。不要添加、删除或改动任何元素。";

async function dailyLimitExceeded(userId: string): Promise<number | false> {
  const limit = await getDailyGenerationLimit();
  if (limit <= 0) return false;
  const daily = await query<{ count: string }>(
    `select count(*)::text as count from generation_jobs where user_id = $1 and created_at >= current_date`,
    [userId]
  );
  return Number(daily.rows[0]?.count ?? 0) + 1 > limit ? limit : false;
}

/**
 * AI 高清重绘:固定用 gpt-image-2(不继承源模型),以源图为参考走编辑接口请求模型原生 4K。
 * 不做 sharp 拉伸兜底,也不因分辨率判失败——模型返回什么就存什么,有图即成功,提升与否用户自行判断。
 * 模型组按 gpt-image-2 自动路由(在列出该模型的启用组间轮询)。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;

  const parsed = upscaleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const source = await getImageForUser(id, user);
  if (!source) {
    return NextResponse.json({ error: "图片不存在或无权访问" }, { status: 404 });
  }

  const exceededLimit = await dailyLimitExceeded(user.id);
  if (exceededLimit !== false) {
    return NextResponse.json({ error: `今日生成次数已达上限（${exceededLimit} 次）` }, { status: 429 });
  }

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

  // 按源图比例请求模型原生 4K(满足 gpt-image-2 约束:长边≤3840、/16、像素预算)。
  // 只是「请求」——模型返回什么分辨率就存什么,不再校验或兜底。
  const size =
    source.width && source.height
      ? computeUpscaleSize(source.width, source.height, config.upscaleLongEdge)
      : "2880x2880";

  const reference = {
    source: "generated" as const,
    sourceImageId: source.id,
    localPath: source.local_path,
    mimeType: source.mime_type,
    byteSize: source.byte_size
  };
  const now = new Date().toISOString();

  const job = await transaction(async (client) =>
    createJob(client, {
      user_id: user.id,
      // 高清化固定 gpt-image-2:模型组按模型自动路由,不继承源任务的模型/组
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
        upscale: { mode: "ai", sourceImageId: source.id },
        progress: {
          phase: "queued",
          current: 0,
          total: 1,
          percent: 5,
          message: "高清重绘任务已进入后台队列",
          updatedAt: now
        }
      }
    })
  );

  enqueueGenerationJob(job.id);
  const full = await getJobById(job.id, user);
  return NextResponse.json({ job: full, mode: "ai" }, { status: 202 });
}
