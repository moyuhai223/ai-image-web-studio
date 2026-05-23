import { listAiKeySummaries } from "./api-keys";
import { config } from "./config";
import { query } from "./db";
import { getProviderSettings } from "./provider-settings";
import { checkStorageWritable, getStorageRoot } from "./storage";
import { APP_VERSION, APP_VERSION_LABEL } from "./version";

export type HealthCheckResult = {
  ok: boolean;
  error?: string;
};

export type LastGenerationError = {
  id: string;
  model: string;
  status: string;
  message: string;
  updatedAt: string;
} | null;

export type ProviderPresetHealth = {
  id: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
};

export type SystemHealth = {
  ok: boolean;
  version: {
    current: string;
    label: string;
  };
  provider: {
    baseUrl: string;
    source: "database" | "env";
    presets: ProviderPresetHealth[];
    defaultPresetId: string | null;
  };
  database: HealthCheckResult;
  storage: HealthCheckResult & {
    path: string;
  };
  keys: {
    total: number;
    enabled: number;
    disabled: number;
    error: string | null;
  };
  lastGenerationError: LastGenerationError;
  checkedAt: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const database: HealthCheckResult = { ok: false };
  const storage: HealthCheckResult & { path: string } = { ok: false, path: getStorageRoot() };
  let keyCount = { total: 0, enabled: 0, disabled: 0 };
  let keyError: string | null = null;
  let lastGenerationError: LastGenerationError = null;
  let provider: SystemHealth["provider"] = {
    baseUrl: config.aiBaseUrl,
    source: "env",
    presets: [],
    defaultPresetId: null
  };

  try {
    await query("select 1 as ok");
    database.ok = true;
  } catch (error) {
    database.error = errorMessage(error);
  }

  try {
    storage.path = await checkStorageWritable();
    storage.ok = true;
  } catch (error) {
    storage.error = errorMessage(error);
  }

  if (database.ok) {
    try {
      const providerSettings = await getProviderSettings();
      provider = {
        baseUrl: providerSettings.aiBaseUrl,
        source: providerSettings.source,
        presets: providerSettings.presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          baseUrl: preset.baseUrl,
          isDefault: preset.isDefault
        })),
        defaultPresetId: providerSettings.presets.find((preset) => preset.isDefault)?.id ?? null
      };
    } catch {
      provider = {
        baseUrl: config.aiBaseUrl,
        source: "env",
        presets: [],
        defaultPresetId: null
      };
    }

    try {
      const summary = await listAiKeySummaries();
      const enabled = summary.keys.filter((key) => key.enabled).length;
      keyCount = {
        total: summary.keys.length,
        enabled,
        disabled: summary.keys.length - enabled
      };
    } catch (error) {
      keyError = errorMessage(error);
    }

    try {
      // 包括 Stage 2 新增的 upstream_error / interrupted 终态,任一种都属于"用户可见的失败"。
      const latestError = await query<{
        id: string;
        model: string;
        status: string;
        error_message: string;
        updated_at: string;
      }>(
        `select id, model, status, error_message, updated_at
         from generation_jobs
         where status in ('failed', 'upstream_error', 'interrupted')
           and error_message is not null
         order by updated_at desc
         limit 1`
      );
      const row = latestError.rows[0];
      if (row) {
        lastGenerationError = {
          id: row.id,
          model: row.model,
          status: row.status,
          message: row.error_message,
          updatedAt: row.updated_at
        };
      }
    } catch (error) {
      lastGenerationError = {
        id: "",
        model: "",
        status: "unknown",
        message: errorMessage(error),
        updatedAt: new Date().toISOString()
      };
    }
  }

  return {
    ok: database.ok && storage.ok,
    version: {
      current: APP_VERSION,
      label: APP_VERSION_LABEL
    },
    provider,
    database,
    storage,
    keys: {
      ...keyCount,
      error: keyError
    },
    lastGenerationError,
    checkedAt: new Date().toISOString()
  };
}
