import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "./config";
import { query, transaction } from "./db";

const SETTINGS_KEY = "provider_settings";

/**
 * v0.6.1: provider-settings read cache
 *
 * 之前每次 generateWithProvider() 都会 resolveProvider() → getProviderSettings()
 * → SQL select。高并发下纯浪费 DB 连接。改为 module-level cache,写路径
 * 主动 invalidate,加 TTL 兜底防止漏 invalidate。
 *
 * 单进程模型下足够。如果未来真上多 worker(目前 next start 单进程),
 * 需要换 listen/notify 或 short-TTL only 策略。
 */
const SETTINGS_CACHE_TTL_MS = 60_000;

type CachedSummary = {
  summary: ProviderSettingsSummary;
  expiresAt: number;
};

let cachedSettings: CachedSummary | null = null;

export function invalidateProviderSettingsCache() {
  cachedSettings = null;
}

export type ProviderPreset = {
  id: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type StoredV2 = {
  version: 2;
  presets: ProviderPreset[];
  activePresetId: string | null;
};

type StoredProviderSettings = StoredV2;

export type ProviderPresetSummary = {
  id: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
};

export type ProviderSettingsSummary = {
  aiBaseUrl: string;
  source: "database" | "env";
  presets: ProviderPreset[];
  activePresetId: string | null;
};

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function normalizeAiBaseUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Provider Base URL 格式不正确");
  }

  const trimmed = stripTrailingSlash(value.trim());
  if (!trimmed) {
    throw new Error("Provider Base URL 不能为空");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Provider Base URL 不是有效的网址");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Provider Base URL 仅支持 http 或 https");
  }

  return stripTrailingSlash(url.toString());
}

function normalizePresetName(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Preset 名称格式不正确");
  }
  const trimmed = value.trim().slice(0, 64);
  if (!trimmed) {
    throw new Error("Preset 名称不能为空");
  }
  return trimmed;
}

function newPreset(input: {
  id?: string;
  name: string;
  baseUrl: string;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}): ProviderPreset {
  const now = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    name: normalizePresetName(input.name),
    baseUrl: normalizeAiBaseUrl(input.baseUrl),
    isDefault: Boolean(input.isDefault),
    createdAt: now,
    updatedAt: input.updatedAt ?? now
  };
}

function envDefaultPreset(): ProviderPreset | null {
  if (!config.aiBaseUrl) return null;
  try {
    return newPreset({
      id: "default",
      name: "默认",
      baseUrl: config.aiBaseUrl,
      isDefault: true
    });
  } catch {
    return null;
  }
}

function defaultSettings(): StoredV2 {
  const seed = envDefaultPreset();
  return {
    version: 2,
    presets: seed ? [seed] : [],
    activePresetId: seed?.id ?? null
  };
}

function ensureSingleDefault(settings: StoredV2): StoredV2 {
  const defaults = settings.presets.filter((preset) => preset.isDefault);

  if (defaults.length === 0 && settings.presets.length > 0) {
    settings.presets[0].isDefault = true;
    settings.activePresetId = settings.presets[0].id;
    return settings;
  }

  if (defaults.length > 1) {
    let keptOne = false;
    for (const preset of settings.presets) {
      if (preset.isDefault && !keptOne) {
        keptOne = true;
        continue;
      }
      preset.isDefault = false;
    }
  }

  const currentDefault = settings.presets.find((preset) => preset.isDefault) ?? null;
  if (currentDefault) {
    settings.activePresetId = currentDefault.id;
  } else if (settings.presets.length === 0) {
    settings.activePresetId = null;
  }

  return settings;
}

function normalizeStoredPreset(value: unknown): ProviderPreset | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.baseUrl !== "string") {
    return null;
  }

  try {
    return newPreset({
      id: record.id,
      name: record.name,
      baseUrl: record.baseUrl,
      isDefault: Boolean(record.isDefault),
      createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined
    });
  } catch {
    return null;
  }
}

function normalizeSettings(value: unknown): StoredV2 {
  if (!value || typeof value !== "object") return defaultSettings();
  const record = value as Record<string, unknown>;

  if (record.version === 2 && Array.isArray(record.presets)) {
    const presets = record.presets.map(normalizeStoredPreset).filter(Boolean) as ProviderPreset[];
    const activePresetId =
      typeof record.activePresetId === "string" && presets.some((preset) => preset.id === record.activePresetId)
        ? record.activePresetId
        : null;

    return ensureSingleDefault({
      version: 2,
      presets,
      activePresetId
    });
  }

  return defaultSettings();
}

async function loadSettingsForUpdate(client: PoolClient): Promise<StoredV2> {
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

async function saveSettings(client: PoolClient, settings: StoredV2, updatedBy?: string) {
  ensureSingleDefault(settings);
  if (updatedBy) {
    await client.query(
      `update app_settings
       set value = $2::jsonb, updated_by = $3, updated_at = now()
       where key = $1`,
      [SETTINGS_KEY, JSON.stringify(settings), updatedBy]
    );
    return;
  }
  await client.query(
    `update app_settings
     set value = $2::jsonb, updated_at = now()
     where key = $1`,
    [SETTINGS_KEY, JSON.stringify(settings)]
  );
}

function summarize(settings: StoredV2, fallbackEnvBaseUrl: string): ProviderSettingsSummary {
  const defaultPreset = settings.presets.find((preset) => preset.isDefault) ?? settings.presets[0] ?? null;
  if (defaultPreset) {
    return {
      aiBaseUrl: defaultPreset.baseUrl,
      source: "database",
      presets: settings.presets,
      activePresetId: settings.activePresetId
    };
  }

  return {
    aiBaseUrl: fallbackEnvBaseUrl,
    source: fallbackEnvBaseUrl ? "env" : "database",
    presets: [],
    activePresetId: null
  };
}

function envFallbackUrl() {
  if (!config.aiBaseUrl) return "";
  try {
    return normalizeAiBaseUrl(config.aiBaseUrl);
  } catch {
    return "";
  }
}

export async function getProviderSettings(): Promise<ProviderSettingsSummary> {
  const now = Date.now();
  if (cachedSettings && cachedSettings.expiresAt > now) {
    return cachedSettings.summary;
  }

  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  const summary = result.rows[0]
    ? summarize(normalizeSettings(result.rows[0].value), envFallbackUrl())
    : summarize(defaultSettings(), envFallbackUrl());

  cachedSettings = { summary, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return summary;
}

export async function listProviderPresets(): Promise<ProviderPreset[]> {
  return (await getProviderSettings()).presets;
}

export async function listProviderPresetSummaries(): Promise<ProviderPresetSummary[]> {
  const presets = await listProviderPresets();
  return presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    baseUrl: preset.baseUrl,
    isDefault: preset.isDefault
  }));
}

function resolvePreset(settings: StoredV2, presetId: string | null | undefined): ProviderPreset | null {
  if (presetId) {
    const direct = settings.presets.find((preset) => preset.id === presetId);
    if (direct) return direct;
  }
  const defaultPreset = settings.presets.find((preset) => preset.isDefault);
  if (defaultPreset) return defaultPreset;
  return settings.presets[0] ?? null;
}

export type ResolvedProvider = {
  preset: ProviderPreset | null;
  baseUrl: string;
};

export async function resolveProvider(presetId?: string | null): Promise<ResolvedProvider> {
  const settings = await getProviderSettings();
  const stored: StoredV2 = {
    version: 2,
    presets: settings.presets,
    activePresetId: settings.activePresetId
  };
  const preset = resolvePreset(stored, presetId);
  const baseUrl = preset?.baseUrl ?? settings.aiBaseUrl ?? "";
  if (!baseUrl) {
    throw new Error("Provider Base URL 未配置");
  }
  return { preset, baseUrl };
}

/**
 * 兼容旧接口：直接修改 default preset 的 baseUrl。如果没有 default
 * preset 则新建一个。
 */
export async function setProviderBaseUrl(input: { aiBaseUrl: string; userId: string }) {
  const aiBaseUrl = normalizeAiBaseUrl(input.aiBaseUrl);

  const summary = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    let defaultPreset = settings.presets.find((preset) => preset.isDefault) ?? settings.presets[0];
    if (defaultPreset) {
      defaultPreset.baseUrl = aiBaseUrl;
      defaultPreset.isDefault = true;
      defaultPreset.updatedAt = new Date().toISOString();
    } else {
      defaultPreset = newPreset({ id: "default", name: "默认", baseUrl: aiBaseUrl, isDefault: true });
      settings.presets.push(defaultPreset);
    }
    settings.activePresetId = defaultPreset.id;
    await saveSettings(client, settings, input.userId);
    return summarize(settings, envFallbackUrl());
  });
  // v0.6.1: 写后 invalidate,放在 transaction 之外 —— 事务失败会抛出,这里不执行
  invalidateProviderSettingsCache();
  return summary;
}

export async function createProviderPreset(input: { name: string; baseUrl: string; isDefault?: boolean; userId: string }) {
  const result = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const preset = newPreset({
      name: input.name,
      baseUrl: input.baseUrl,
      isDefault: settings.presets.length === 0 || Boolean(input.isDefault)
    });

    if (preset.isDefault) {
      settings.presets.forEach((existing) => {
        existing.isDefault = false;
      });
    }

    settings.presets.push(preset);
    if (preset.isDefault) settings.activePresetId = preset.id;
    await saveSettings(client, settings, input.userId);
    return { preset, summary: summarize(settings, envFallbackUrl()) };
  });
  invalidateProviderSettingsCache();
  return result;
}

export async function updateProviderPreset(input: {
  id: string;
  name?: string;
  baseUrl?: string;
  isDefault?: boolean;
  userId: string;
}) {
  const result = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const preset = settings.presets.find((existing) => existing.id === input.id);
    if (!preset) {
      throw new Error("Preset 不存在");
    }

    if (typeof input.name === "string") preset.name = normalizePresetName(input.name);
    if (typeof input.baseUrl === "string") preset.baseUrl = normalizeAiBaseUrl(input.baseUrl);
    preset.updatedAt = new Date().toISOString();

    if (input.isDefault === true) {
      settings.presets.forEach((existing) => {
        existing.isDefault = existing.id === preset.id;
      });
      settings.activePresetId = preset.id;
    } else if (input.isDefault === false && preset.isDefault) {
      throw new Error("至少需要保留一个默认 Preset。请先把其他 Preset 设为默认。");
    }

    await saveSettings(client, settings, input.userId);
    return { preset, summary: summarize(settings, envFallbackUrl()) };
  });
  invalidateProviderSettingsCache();
  return result;
}

export async function deleteProviderPreset(input: { id: string; userId: string }) {
  const summary = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const preset = settings.presets.find((existing) => existing.id === input.id);
    if (!preset) {
      throw new Error("Preset 不存在");
    }
    if (preset.isDefault) {
      throw new Error("默认 Preset 不能直接删除，请先把其他 Preset 设为默认。");
    }
    settings.presets = settings.presets.filter((existing) => existing.id !== input.id);
    if (settings.activePresetId === input.id) {
      const fallback = settings.presets.find((existing) => existing.isDefault) ?? settings.presets[0] ?? null;
      settings.activePresetId = fallback?.id ?? null;
    }
    await saveSettings(client, settings, input.userId);
    return summarize(settings, envFallbackUrl());
  });
  invalidateProviderSettingsCache();
  return summary;
}

export async function setDefaultProviderPreset(input: { id: string; userId: string }) {
  return updateProviderPreset({ id: input.id, isDefault: true, userId: input.userId });
}
