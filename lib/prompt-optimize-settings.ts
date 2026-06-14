import type { PoolClient } from "pg";
import { query, transaction } from "./db";

const SETTINGS_KEY = "prompt_optimize";

/**
 * 提示词优化设置。沿用 provider-settings 的 module-level cache + 写路径主动
 * invalidate + TTL 兜底。单进程(next start)下足够。
 */
const SETTINGS_CACHE_TTL_MS = 60_000;

export const DEFAULT_OPTIMIZE_MODEL = "gpt-5.5";

export const DEFAULT_OPTIMIZE_SYSTEM_PROMPT = [
  "你是 AI 绘画提示词优化助手。把用户给的简短或粗糙的画面描述,改写成一段更具体、更利于文生图模型出图的高质量提示词。",
  "要求:补全主体细节、构图、光线、色彩氛围、风格与质感等关键要素;保留用户原意与明确指定的内容(指定的文字、数量、颜色不得篡改);",
  "不要新增用户没有暗示的具体人物身份或敏感内容;语言与用户输入保持一致(中文输入就用中文)。",
  "只输出优化后的提示词本身,不要解释、不要加引号或 Markdown。"
].join("");

export const OPTIMIZE_MODEL_MAX_LENGTH = 120;
export const OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH = 4000;

export type PromptOptimizeSettings = {
  enabled: boolean;
  model: string;
  systemPrompt: string;
  updatedAt: string | null;
};

type CachedSettings = {
  settings: PromptOptimizeSettings;
  expiresAt: number;
};

let cachedSettings: CachedSettings | null = null;

export function invalidatePromptOptimizeCache() {
  cachedSettings = null;
}

function defaultSettings(): PromptOptimizeSettings {
  return {
    enabled: true,
    model: DEFAULT_OPTIMIZE_MODEL,
    systemPrompt: DEFAULT_OPTIMIZE_SYSTEM_PROMPT,
    updatedAt: null
  };
}

function clampText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function normalizeSettings(value: unknown): PromptOptimizeSettings {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const fallback = defaultSettings();
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    model: clampText(record.model, fallback.model, OPTIMIZE_MODEL_MAX_LENGTH),
    systemPrompt: clampText(record.systemPrompt, fallback.systemPrompt, OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt
  };
}

async function loadSettingsForUpdate(client: PoolClient): Promise<PromptOptimizeSettings> {
  await client.query(
    `insert into app_settings (key, value)
     values ($1, $2::jsonb)
     on conflict (key) do nothing`,
    [SETTINGS_KEY, JSON.stringify(defaultSettings())]
  );

  const result = await client.query<{ value: unknown }>(
    `select value from app_settings where key = $1 for update`,
    [SETTINGS_KEY]
  );
  return normalizeSettings(result.rows[0]?.value);
}

export async function getPromptOptimizeSettings(): Promise<PromptOptimizeSettings> {
  const now = Date.now();
  if (cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.settings;
  }

  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  const settings = result.rows[0] ? normalizeSettings(result.rows[0].value) : defaultSettings();

  cachedSettings = { settings, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return settings;
}

export async function updatePromptOptimizeSettings(input: {
  enabled?: boolean;
  model?: string;
  systemPrompt?: string;
  userId: string;
}): Promise<PromptOptimizeSettings> {
  const updated = await transaction(async (client) => {
    const current = await loadSettingsForUpdate(client);
    const next: PromptOptimizeSettings = {
      enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
      model: input.model !== undefined ? clampText(input.model, current.model, OPTIMIZE_MODEL_MAX_LENGTH) : current.model,
      systemPrompt:
        input.systemPrompt !== undefined
          ? clampText(input.systemPrompt, current.systemPrompt, OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH)
          : current.systemPrompt,
      updatedAt: new Date().toISOString()
    };

    await client.query(
      `update app_settings
       set value = $2::jsonb, updated_by = $3, updated_at = now()
       where key = $1`,
      [SETTINGS_KEY, JSON.stringify(next), input.userId]
    );
    return next;
  });

  invalidatePromptOptimizeCache();
  return updated;
}
