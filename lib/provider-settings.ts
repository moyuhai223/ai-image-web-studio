import type { PoolClient } from "pg";
import { config } from "./config";
import { query, transaction } from "./db";

const SETTINGS_KEY = "provider_settings";

type StoredProviderSettings = {
  version: 1;
  aiBaseUrl: string;
};

export type ProviderSettingsSummary = {
  aiBaseUrl: string;
  source: "database" | "env";
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

function defaultSettings(): StoredProviderSettings {
  return {
    version: 1,
    aiBaseUrl: normalizeAiBaseUrl(config.aiBaseUrl)
  };
}

function normalizeSettings(value: unknown): StoredProviderSettings | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.aiBaseUrl !== "string") return null;

  try {
    return {
      version: 1,
      aiBaseUrl: normalizeAiBaseUrl(record.aiBaseUrl)
    };
  } catch {
    return null;
  }
}

async function loadSettingsForUpdate(client: PoolClient) {
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
  return normalizeSettings(result.rows[0]?.value) ?? defaultSettings();
}

export async function getProviderSettings(): Promise<ProviderSettingsSummary> {
  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  const stored = normalizeSettings(result.rows[0]?.value);
  if (stored) {
    return {
      aiBaseUrl: stored.aiBaseUrl,
      source: "database"
    };
  }

  return {
    aiBaseUrl: defaultSettings().aiBaseUrl,
    source: "env"
  };
}

export async function getProviderBaseUrl() {
  return (await getProviderSettings()).aiBaseUrl;
}

export async function setProviderBaseUrl(input: { aiBaseUrl: string; userId: string }) {
  const aiBaseUrl = normalizeAiBaseUrl(input.aiBaseUrl);

  return transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    settings.aiBaseUrl = aiBaseUrl;

    await client.query(
      `update app_settings
       set value = $2::jsonb, updated_by = $3, updated_at = now()
       where key = $1`,
      [SETTINGS_KEY, JSON.stringify(settings), input.userId]
    );

    return {
      aiBaseUrl: settings.aiBaseUrl,
      source: "database" as const
    };
  });
}
