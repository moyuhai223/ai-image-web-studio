import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { decryptSecret, encryptSecret, isSecretCipher, previewSecret, type SecretCipher } from "./secret-box";

const SETTINGS_KEY = "prompt_optimize";

/**
 * 提示词优化设置。沿用 provider-settings 的 module-level cache + 写路径主动
 * invalidate + TTL 兜底。单进程(next start)下足够。
 *
 * 凭据隔离:优化用的 baseUrl / apiKey / model 独立存储,与画图 Key 池/preset 完全隔离。
 * - apiKey 用 secret-box(aes-256-gcm)加密后存进 app_settings,永不回传前端(仅给掩码预览)。
 * - baseUrl 留空 → 运行时回退画图默认 preset 的地址(同厂商省事);apiKey 必填、不回退画图 key。
 */
const SETTINGS_CACHE_TTL_MS = 60_000;

export const DEFAULT_OPTIMIZE_MODEL = "gpt-5.5";
export const DEFAULT_OPTIMIZE_BASE_URL = "";

export const DEFAULT_OPTIMIZE_SYSTEM_PROMPT = [
  "你是 AI 绘画提示词优化助手。把用户给的简短或粗糙的画面描述,改写成一段更具体、更利于文生图模型出图的高质量提示词。",
  "要求:补全主体细节、构图、光线、色彩氛围、风格与质感等关键要素;保留用户原意与明确指定的内容(指定的文字、数量、颜色不得篡改);",
  "不要新增用户没有暗示的具体人物身份或敏感内容;语言与用户输入保持一致(中文输入就用中文)。",
  "只输出优化后的提示词本身,不要解释、不要加引号或 Markdown。"
].join("");

export const OPTIMIZE_MODEL_MAX_LENGTH = 120;
export const OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH = 4000;
export const OPTIMIZE_BASE_URL_MAX_LENGTH = 300;

type StoredPromptOptimize = {
  enabled: boolean;
  baseUrl: string;
  apiKey: SecretCipher | null;
  apiKeyPreview: string | null;
  model: string;
  systemPrompt: string;
  updatedAt: string | null;
};

/** 给后台/前台用的掩码视图:不含明文 key。 */
export type PromptOptimizeSummary = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  updatedAt: string | null;
};

/** 仅服务端:含解密后的明文 key,用于实际调用。 */
export type PromptOptimizeRuntime = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  apiKey: string | null;
};

type CachedSettings = {
  settings: StoredPromptOptimize;
  expiresAt: number;
};

let cachedSettings: CachedSettings | null = null;

export function invalidatePromptOptimizeCache() {
  cachedSettings = null;
}

function defaultSettings(): StoredPromptOptimize {
  return {
    enabled: true,
    baseUrl: DEFAULT_OPTIMIZE_BASE_URL,
    apiKey: null,
    apiKeyPreview: null,
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

/** baseUrl 允许为空(空=回退画图地址);非空必须是 http(s) 且去掉尾斜杠。 */
export function normalizeOptimizeBaseUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("优化 Base URL 格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("优化 Base URL 必须以 http:// 或 https:// 开头");
  }
  return trimmed.replace(/\/+$/, "").slice(0, OPTIMIZE_BASE_URL_MAX_LENGTH);
}

function normalizeStored(value: unknown): StoredPromptOptimize {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const fallback = defaultSettings();
  const apiKey = isSecretCipher(record.apiKey) ? record.apiKey : null;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : fallback.enabled,
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl.trim().slice(0, OPTIMIZE_BASE_URL_MAX_LENGTH) : fallback.baseUrl,
    apiKey,
    apiKeyPreview: apiKey && typeof record.apiKeyPreview === "string" ? record.apiKeyPreview : null,
    model: clampText(record.model, fallback.model, OPTIMIZE_MODEL_MAX_LENGTH),
    systemPrompt: clampText(record.systemPrompt, fallback.systemPrompt, OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt
  };
}

async function loadSettingsForUpdate(client: PoolClient): Promise<StoredPromptOptimize> {
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
  return normalizeStored(result.rows[0]?.value);
}

async function getStored(): Promise<StoredPromptOptimize> {
  const now = Date.now();
  if (cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.settings;
  }
  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  const settings = result.rows[0] ? normalizeStored(result.rows[0].value) : defaultSettings();
  cachedSettings = { settings, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return settings;
}

function toSummary(settings: StoredPromptOptimize): PromptOptimizeSummary {
  return {
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    hasApiKey: Boolean(settings.apiKey),
    apiKeyPreview: settings.apiKeyPreview,
    updatedAt: settings.updatedAt
  };
}

export async function getPromptOptimizeSummary(): Promise<PromptOptimizeSummary> {
  return toSummary(await getStored());
}

export async function getPromptOptimizeRuntime(): Promise<PromptOptimizeRuntime> {
  const settings = await getStored();
  let apiKey: string | null = null;
  if (settings.apiKey) {
    try {
      apiKey = decryptSecret(settings.apiKey);
    } catch {
      apiKey = null; // AUTH_SECRET 变更 / 密文损坏:视为未配置,提示重填
    }
  }
  return {
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    apiKey
  };
}

export async function updatePromptOptimizeSettings(input: {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  userId: string;
}): Promise<PromptOptimizeSummary> {
  const updated = await transaction(async (client) => {
    const current = await loadSettingsForUpdate(client);

    let apiKey = current.apiKey;
    let apiKeyPreview = current.apiKeyPreview;
    if (input.clearApiKey) {
      apiKey = null;
      apiKeyPreview = null;
    } else if (input.apiKey !== undefined && input.apiKey.trim()) {
      const plain = input.apiKey.trim();
      if (plain.length < 8 || /\s/.test(plain)) {
        throw new Error("API Key 格式不正确");
      }
      apiKey = encryptSecret(plain);
      apiKeyPreview = previewSecret(plain);
    }

    const next: StoredPromptOptimize = {
      enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
      baseUrl: input.baseUrl !== undefined ? normalizeOptimizeBaseUrl(input.baseUrl) : current.baseUrl,
      apiKey,
      apiKeyPreview,
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
  return toSummary(updated);
}
