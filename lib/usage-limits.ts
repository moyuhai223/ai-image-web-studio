import type { PoolClient } from "pg";
import { query, transaction } from "./db";

/**
 * 用量/运行限制设置:每日生成上限 + 生成并发数。存于 app_settings 的 usage_limits 行(JSONB),
 * 后台可改,即时生效(60s 读缓存 + 写路径主动失效)。
 * 取代原 env 变量 DAILY_GENERATION_LIMIT(0 = 不限)与 MAX_GENERATION_CONCURRENCY。
 */
const SETTINGS_KEY = "usage_limits";
const SETTINGS_CACHE_TTL_MS = 60_000;

export const DEFAULT_DAILY_GENERATION_LIMIT = 50;
export const DAILY_GENERATION_LIMIT_MAX = 100_000;
export const DEFAULT_MAX_GENERATION_CONCURRENCY = 2;
// sharp/生成都是 CPU+内存重活,并发给个硬上限防误设(如 2000)拖垮机器。
export const MAX_GENERATION_CONCURRENCY_MAX = 32;

type StoredUsageLimits = {
  dailyGenerationLimit: number;
  maxGenerationConcurrency: number;
  updatedAt: string | null;
};

let cached: { settings: StoredUsageLimits; expiresAt: number } | null = null;

export function invalidateUsageLimitsCache() {
  cached = null;
}

function defaultSettings(): StoredUsageLimits {
  return {
    dailyGenerationLimit: DEFAULT_DAILY_GENERATION_LIMIT,
    maxGenerationConcurrency: DEFAULT_MAX_GENERATION_CONCURRENCY,
    updatedAt: null
  };
}

/** 规整:非负整数,超上限截断;非法值回默认。 */
export function normalizeDailyLimit(value: unknown): number {
  const num = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) return DEFAULT_DAILY_GENERATION_LIMIT;
  const int = Math.floor(num);
  if (int < 0) return DEFAULT_DAILY_GENERATION_LIMIT;
  return Math.min(int, DAILY_GENERATION_LIMIT_MAX);
}

/** 规整并发:1..32 的整数;非法值回默认 2。 */
export function normalizeConcurrency(value: unknown): number {
  const num = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof num !== "number" || !Number.isFinite(num)) return DEFAULT_MAX_GENERATION_CONCURRENCY;
  const int = Math.floor(num);
  if (int < 1) return DEFAULT_MAX_GENERATION_CONCURRENCY;
  return Math.min(int, MAX_GENERATION_CONCURRENCY_MAX);
}

function normalizeStored(value: unknown): StoredUsageLimits {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    dailyGenerationLimit:
      record.dailyGenerationLimit === undefined ? DEFAULT_DAILY_GENERATION_LIMIT : normalizeDailyLimit(record.dailyGenerationLimit),
    maxGenerationConcurrency:
      record.maxGenerationConcurrency === undefined
        ? DEFAULT_MAX_GENERATION_CONCURRENCY
        : normalizeConcurrency(record.maxGenerationConcurrency),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null
  };
}

async function getStored(): Promise<StoredUsageLimits> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.settings;
  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  const settings = result.rows[0] ? normalizeStored(result.rows[0].value) : defaultSettings();
  cached = { settings, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return settings;
}

/** 每日生成上限(次/人/天);0 = 不限。生成/高清化配额检查用。 */
export async function getDailyGenerationLimit(): Promise<number> {
  return (await getStored()).dailyGenerationLimit;
}

/** 生成并发数(1..32);生成队列与快速高清化并发闸共用。 */
export async function getMaxGenerationConcurrency(): Promise<number> {
  return (await getStored()).maxGenerationConcurrency;
}

export type UsageLimitsSummary = { dailyGenerationLimit: number; maxGenerationConcurrency: number };

export async function getUsageLimits(): Promise<UsageLimitsSummary> {
  const stored = await getStored();
  return { dailyGenerationLimit: stored.dailyGenerationLimit, maxGenerationConcurrency: stored.maxGenerationConcurrency };
}

async function loadSettingsForUpdate(client: PoolClient): Promise<StoredUsageLimits> {
  await client.query(
    `insert into app_settings (key, value) values ($1, $2::jsonb) on conflict (key) do nothing`,
    [SETTINGS_KEY, JSON.stringify(defaultSettings())]
  );
  const result = await client.query<{ value: unknown }>(
    `select value from app_settings where key = $1 for update`,
    [SETTINGS_KEY]
  );
  return normalizeStored(result.rows[0]?.value);
}

export async function updateUsageLimits(input: {
  dailyGenerationLimit?: number;
  maxGenerationConcurrency?: number;
  userId: string;
}): Promise<UsageLimitsSummary> {
  const updated = await transaction(async (client) => {
    const current = await loadSettingsForUpdate(client);
    const next: StoredUsageLimits = {
      dailyGenerationLimit:
        input.dailyGenerationLimit === undefined ? current.dailyGenerationLimit : normalizeDailyLimit(input.dailyGenerationLimit),
      maxGenerationConcurrency:
        input.maxGenerationConcurrency === undefined
          ? current.maxGenerationConcurrency
          : normalizeConcurrency(input.maxGenerationConcurrency),
      updatedAt: new Date().toISOString()
    };
    await client.query(
      `update app_settings set value = $2::jsonb, updated_by = $3, updated_at = now() where key = $1`,
      [SETTINGS_KEY, JSON.stringify(next), input.userId]
    );
    return next;
  });
  invalidateUsageLimitsCache();
  return { dailyGenerationLimit: updated.dailyGenerationLimit, maxGenerationConcurrency: updated.maxGenerationConcurrency };
}
