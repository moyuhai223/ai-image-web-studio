import { config } from "./config";
import { query } from "./db";
import { listModelGroups } from "./model-groups";
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

export type ProviderGroupHealth = {
  id: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
  enabled: boolean;
  models: number;
  hasKey: boolean;
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
    groups: ProviderGroupHealth[];
    defaultGroupId: string | null;
  };
  database: HealthCheckResult;
  storage: HealthCheckResult & {
    path: string;
  };
  // 模型组摘要:total=组数,enabled=启用且已配 key 的组数。
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
    groups: [],
    defaultGroupId: null
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
      const groups = await listModelGroups();
      const defaultGroup = groups.find((group) => group.isDefault) ?? groups[0] ?? null;
      provider = {
        baseUrl: defaultGroup?.baseUrl || config.aiBaseUrl,
        source: groups.length > 0 ? "database" : "env",
        groups: groups.map((group) => ({
          id: group.id,
          name: group.name,
          baseUrl: group.baseUrl,
          isDefault: group.isDefault,
          enabled: group.enabled,
          models: group.models.length,
          hasKey: group.hasKey
        })),
        defaultGroupId: defaultGroup?.id ?? null
      };
      const usable = groups.filter((group) => group.enabled && group.hasKey).length;
      keyCount = { total: groups.length, enabled: usable, disabled: groups.length - usable };
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
