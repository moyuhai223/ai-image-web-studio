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
  message: string;
  updatedAt: string;
} | null;

export type SystemHealth = {
  ok: boolean;
  version: {
    current: string;
    label: string;
  };
  provider: {
    baseUrl: string;
    source: "database" | "env";
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
    source: "env"
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
        source: providerSettings.source
      };
    } catch {
      provider = {
        baseUrl: config.aiBaseUrl,
        source: "env"
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
      const latestError = await query<{
        id: string;
        model: string;
        error_message: string;
        updated_at: string;
      }>(
        `select id, model, error_message, updated_at
         from generation_jobs
         where status = 'failed' and error_message is not null
         order by updated_at desc
         limit 1`
      );
      const row = latestError.rows[0];
      if (row) {
        lastGenerationError = {
          id: row.id,
          model: row.model,
          message: row.error_message,
          updatedAt: row.updated_at
        };
      }
    } catch (error) {
      lastGenerationError = {
        id: "",
        model: "",
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
    provider: {
      baseUrl: provider.baseUrl,
      source: provider.source
    },
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
