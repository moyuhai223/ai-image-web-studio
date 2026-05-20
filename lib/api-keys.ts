import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config, requireEnv } from "./config";
import { query, transaction } from "./db";

const SETTINGS_KEY = "ai_key_pool";
const CIPHER_ALGORITHM = "aes-256-gcm";
const DEFAULT_AUTO_DISABLE_FAILURES = 3;
const MIN_AUTO_DISABLE_FAILURES = 1;
const MAX_AUTO_DISABLE_FAILURES = 20;

type StoredAiKey = {
  id: string;
  label: string;
  preview: string;
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: string;
  createdBy: string | null;
  enabled: boolean;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastUsedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  disabledReason: string | null;
};

type StoredAiKeySettings = {
  version: 1;
  nextIndex: number;
  keys: StoredAiKey[];
  autoDisableEnabled: boolean;
  autoDisableFailureThreshold: number;
};

export type AiKeySummary = {
  id: string;
  label: string;
  preview: string;
  createdAt: string;
  enabled: boolean;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastUsedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  disabledReason: string | null;
};

export type AiKeySettingsSummary = {
  keys: AiKeySummary[];
  nextIndex: number;
  autoDisableEnabled: boolean;
  autoDisableFailureThreshold: number;
};

export type AiApiKeySelection = {
  apiKey: string;
  keyId: string | null;
  keyLabel: string;
  keyPreview: string | null;
  source: "pool" | "env";
};

function emptySettings(): StoredAiKeySettings {
  return {
    version: 1,
    nextIndex: 0,
    keys: [],
    autoDisableEnabled: true,
    autoDisableFailureThreshold: DEFAULT_AUTO_DISABLE_FAILURES
  };
}

function encryptionKey() {
  return createHash("sha256").update(config.authSecret).digest();
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function isStoredAiKey(value: unknown): value is StoredAiKey {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.label === "string" &&
    typeof record.preview === "string" &&
    typeof record.iv === "string" &&
    typeof record.tag === "string" &&
    typeof record.ciphertext === "string" &&
    typeof record.createdAt === "string"
  );
}

function normalizeStoredKey(value: StoredAiKey): StoredAiKey {
  const record = value as Record<string, unknown>;
  return {
    id: value.id,
    label: value.label,
    preview: value.preview,
    iv: value.iv,
    tag: value.tag,
    ciphertext: value.ciphertext,
    createdAt: value.createdAt,
    createdBy: typeof record.createdBy === "string" ? record.createdBy : null,
    enabled: record.enabled !== false,
    successCount: numberOrZero(record.successCount),
    failureCount: numberOrZero(record.failureCount),
    consecutiveFailures: numberOrZero(record.consecutiveFailures),
    lastUsedAt: stringOrNull(record.lastUsedAt),
    lastSucceededAt: stringOrNull(record.lastSucceededAt),
    lastFailedAt: stringOrNull(record.lastFailedAt),
    disabledReason: stringOrNull(record.disabledReason)
  };
}

function normalizedIndex(value: unknown, length: number) {
  if (length <= 0) return 0;
  const numeric = typeof value === "number" && Number.isInteger(value) ? value : 0;
  return ((numeric % length) + length) % length;
}

function normalizeFailureThreshold(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_AUTO_DISABLE_FAILURES;
  return Math.min(MAX_AUTO_DISABLE_FAILURES, Math.max(MIN_AUTO_DISABLE_FAILURES, Math.trunc(numeric)));
}

function normalizeSettings(value: unknown): StoredAiKeySettings {
  if (!value || typeof value !== "object") return emptySettings();
  const record = value as Record<string, unknown>;
  const keys = (Array.isArray(record.keys) ? record.keys : []).filter(isStoredAiKey).map(normalizeStoredKey);
  return {
    version: 1,
    nextIndex: normalizedIndex(record.nextIndex, keys.length),
    keys,
    autoDisableEnabled: record.autoDisableEnabled !== false,
    autoDisableFailureThreshold: normalizeFailureThreshold(record.autoDisableFailureThreshold)
  };
}

function normalizePlainKey(value: string) {
  const key = value.trim();
  if (key.length < 8 || /\s/.test(key)) {
    throw new Error("AI Key 格式不正确");
  }
  return key;
}

function normalizeLabel(value: string | undefined, fallback: string) {
  const label = value?.trim().slice(0, 64);
  return label || fallback;
}

function previewKey(value: string) {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

function encryptKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: encrypted.toString("base64url")
  };
}

function decryptKey(value: StoredAiKey) {
  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, encryptionKey(), Buffer.from(value.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("AI Key 解密失败，请检查 AUTH_SECRET 是否发生变化");
  }
}

function summarizeSettings(settings: StoredAiKeySettings): AiKeySettingsSummary {
  return {
    keys: settings.keys.map((item) => ({
      id: item.id,
      label: item.label,
      preview: item.preview,
      createdAt: item.createdAt,
      enabled: item.enabled,
      successCount: item.successCount,
      failureCount: item.failureCount,
      consecutiveFailures: item.consecutiveFailures,
      lastUsedAt: item.lastUsedAt,
      lastSucceededAt: item.lastSucceededAt,
      lastFailedAt: item.lastFailedAt,
      disabledReason: item.disabledReason
    })),
    nextIndex: settings.nextIndex,
    autoDisableEnabled: settings.autoDisableEnabled,
    autoDisableFailureThreshold: settings.autoDisableFailureThreshold
  };
}

async function loadSettingsForUpdate(client: PoolClient) {
  await client.query(
    `insert into app_settings (key, value)
     values ($1, $2::jsonb)
     on conflict (key) do nothing`,
    [SETTINGS_KEY, JSON.stringify(emptySettings())]
  );

  const result = await client.query<{ value: unknown }>(
    `select value from app_settings where key = $1 for update`,
    [SETTINGS_KEY]
  );
  return normalizeSettings(result.rows[0]?.value);
}

async function saveSettings(client: PoolClient, settings: StoredAiKeySettings, updatedBy?: string) {
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

function nextEnabledIndex(settings: StoredAiKeySettings, excludedIds = new Set<string>()) {
  if (settings.keys.length === 0) return -1;
  const start = normalizedIndex(settings.nextIndex, settings.keys.length);
  for (let offset = 0; offset < settings.keys.length; offset += 1) {
    const index = (start + offset) % settings.keys.length;
    if (settings.keys[index].enabled && !excludedIds.has(settings.keys[index].id)) return index;
  }
  return -1;
}

export async function listAiKeySummaries() {
  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  return summarizeSettings(normalizeSettings(result.rows[0]?.value));
}

export async function addAiKey(input: { apiKey: string; label?: string; userId: string }) {
  const plainKey = normalizePlainKey(input.apiKey);
  return transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const encrypted = encryptKey(plainKey);
    settings.keys.push({
      id: randomUUID(),
      label: normalizeLabel(input.label, `Key ${settings.keys.length + 1}`),
      preview: previewKey(plainKey),
      createdAt: new Date().toISOString(),
      createdBy: input.userId,
      enabled: true,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastUsedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      disabledReason: null,
      ...encrypted
    });
    settings.nextIndex = normalizedIndex(settings.nextIndex, settings.keys.length);
    await saveSettings(client, settings, input.userId);
    return summarizeSettings(settings);
  });
}

export async function deleteAiKey(input: { id: string; userId: string }) {
  return transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    settings.keys = settings.keys.filter((item) => item.id !== input.id);
    settings.nextIndex = normalizedIndex(settings.nextIndex, settings.keys.length);
    await saveSettings(client, settings, input.userId);
    return summarizeSettings(settings);
  });
}

export async function setAiKeyEnabled(input: { id: string; enabled: boolean; userId: string }) {
  return transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const key = settings.keys.find((item) => item.id === input.id);
    if (!key) throw new Error("Key 不存在");

    key.enabled = input.enabled;
    if (input.enabled) {
      key.consecutiveFailures = 0;
      key.disabledReason = null;
    } else {
      key.disabledReason = "手动停用";
    }

    settings.nextIndex = normalizedIndex(settings.nextIndex, settings.keys.length);
    await saveSettings(client, settings, input.userId);
    return summarizeSettings(settings);
  });
}

export async function setAiKeyFailurePolicy(input: {
  autoDisableEnabled: boolean;
  autoDisableFailureThreshold: number;
  userId: string;
}) {
  return transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    settings.autoDisableEnabled = input.autoDisableEnabled;
    settings.autoDisableFailureThreshold = normalizeFailureThreshold(input.autoDisableFailureThreshold);
    await saveSettings(client, settings, input.userId);
    return summarizeSettings(settings);
  });
}

export async function getNextAiApiKey(excludedKeyIds: string[] = []): Promise<AiApiKeySelection> {
  const excluded = new Set(excludedKeyIds);
  const selected = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const index = nextEnabledIndex(settings, excluded);
    if (index < 0) return null;

    const storedKey = settings.keys[index];
    storedKey.lastUsedAt = new Date().toISOString();
    settings.nextIndex = (index + 1) % settings.keys.length;
    await saveSettings(client, settings);
    return {
      apiKey: decryptKey(storedKey),
      keyId: storedKey.id,
      keyLabel: storedKey.label,
      keyPreview: storedKey.preview,
      source: "pool" as const
    };
  });

  if (selected) return selected;

  return {
    apiKey: requireEnv(config.aiApiKey, "PROVIDER_API_KEY"),
    keyId: null,
    keyLabel: "环境变量 Key",
    keyPreview: null,
    source: "env"
  };
}

export async function reportAiKeySuccess(keyId: string | null) {
  if (!keyId) return;

  await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const key = settings.keys.find((item) => item.id === keyId);
    if (!key) return summarizeSettings(settings);

    key.successCount += 1;
    key.consecutiveFailures = 0;
    key.lastSucceededAt = new Date().toISOString();
    key.disabledReason = key.enabled ? null : key.disabledReason;
    await saveSettings(client, settings);
    return summarizeSettings(settings);
  });
}

export async function reportAiKeyFailure(keyId: string | null, error: unknown) {
  if (!keyId) return;

  await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const key = settings.keys.find((item) => item.id === keyId);
    if (!key) return summarizeSettings(settings);

    key.failureCount += 1;
    key.consecutiveFailures += 1;
    key.lastFailedAt = new Date().toISOString();
    if (settings.autoDisableEnabled && key.consecutiveFailures >= settings.autoDisableFailureThreshold) {
      key.enabled = false;
      key.disabledReason = `连续失败 ${settings.autoDisableFailureThreshold} 次自动停用：${error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)}`;
    }

    await saveSettings(client, settings);
    return summarizeSettings(settings);
  });
}
