import { randomUUID } from "node:crypto";
import { config } from "./config";
import { transaction } from "./db";
import { createJob, getActiveQueueStats } from "./repository";
import { getDailyGenerationLimit } from "./usage-limits";
import type { User } from "./types";

/**
 * 纯文本生图的「入闸 + 建任务」:与 /api/generate 同款三道配额闸
 * (早退队列闸 → 早退日限闸 → 事务内 per-user advisory lock 权威重查),
 * count 拆成 N 个 count=1 job(共享 batch id),供对外 API(/v1)等无参考图场景复用。
 * 同一把 advisory lock(hashtext(user.id))⇒ 网页 + API 双通道并发也无法绕过配额。
 */
export class QuotaExceededError extends Error {
  readonly kind: "queue_full" | "daily_limit";
  constructor(kind: "queue_full" | "daily_limit", message: string) {
    super(message);
    this.name = "QuotaExceededError";
    this.kind = kind;
  }
}

export type TextGenerationIntake = {
  user: User;
  model: string;
  prompt: string;
  /** 已经过 normalizeImageSize 的尺寸("auto" 或 "WxH") */
  size: string;
  /** 1..4,调用方先夹紧 */
  count: number;
  /** 合并进每个 job 的 request_metadata(如 { source: "api", apiKeyId }) */
  extraMetadata?: Record<string, unknown>;
};

export type CreatedGenerationJob = { id: string };

export async function createTextGenerationJobs(input: TextGenerationIntake): Promise<{
  jobs: CreatedGenerationJob[];
  batchId: string;
}> {
  const { user, model, prompt, size, count } = input;

  // 乐观早退(省掉超限时的后续开销);真正防并发绕过的闸门在下面事务里
  const queueStats = await getActiveQueueStats(user);
  if (queueStats.queued + queueStats.running + count > config.maxGenerationQueueSize) {
    throw new QuotaExceededError(
      "queue_full",
      `当前队列已满(排队 ${queueStats.queued} / 进行中 ${queueStats.running} / 上限 ${config.maxGenerationQueueSize}),请稍后再试`
    );
  }
  const dailyGenerationLimit = await getDailyGenerationLimit();

  const batchId = randomUUID();
  const now = new Date().toISOString();

  const jobs = await transaction(async (client) => {
    // 配额 TOCTOU 防护:per-user advisory lock 串行化同一用户的并发建任务,锁内权威重算
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [user.id]);

    const activeRes = await client.query<{ count: string }>(
      `select count(*)::text as count from generation_jobs where user_id = $1 and status in ('queued', 'running')`,
      [user.id]
    );
    if (Number(activeRes.rows[0]?.count ?? 0) + count > config.maxGenerationQueueSize) {
      throw new QuotaExceededError("queue_full", `当前队列已满(上限 ${config.maxGenerationQueueSize}),请稍后再试`);
    }
    if (dailyGenerationLimit > 0) {
      const dailyRes = await client.query<{ count: string }>(
        `select count(*)::text as count from generation_jobs where user_id = $1 and created_at >= current_date`,
        [user.id]
      );
      if (Number(dailyRes.rows[0]?.count ?? 0) + count > dailyGenerationLimit) {
        throw new QuotaExceededError("daily_limit", `今日生成次数已达上限（${dailyGenerationLimit} 次）`);
      }
    }

    const created: CreatedGenerationJob[] = [];
    for (let index = 0; index < count; index += 1) {
      created.push(
        await createJob(client, {
          user_id: user.id,
          model,
          prompt,
          size,
          count: 1,
          status: "queued",
          request_metadata: {
            size,
            count: 1,
            requestedCount: count,
            batch: { id: batchId, index: index + 1, total: count },
            providerGroupId: null,
            ...(input.extraMetadata ?? {}),
            progress: {
              phase: "queued",
              current: 0,
              total: 1,
              percent: 5,
              message: count > 1 ? `批量任务 ${index + 1}/${count} 已进入后台队列` : "任务已进入后台队列",
              updatedAt: now
            }
          }
        })
      );
    }
    return created;
  });

  return { jobs, batchId };
}
