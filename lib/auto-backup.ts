import { query } from "./db";
import { createDataBackup, listDataBackups, pruneDataBackups, type DataBackupItem } from "./data-backup";

const SETTINGS_KEY = "data_backup_policy";

export type AutoBackupPolicy = {
  enabled: boolean;
  intervalHours: number;
  retainCount: number;
  lastRunAt: string | null;
  lastBackupFilename: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type AutoBackupPolicyInput = {
  enabled?: unknown;
  intervalHours?: unknown;
  retainCount?: unknown;
};

const DEFAULT_POLICY: AutoBackupPolicy = {
  enabled: false,
  intervalHours: 24,
  retainCount: 7,
  lastRunAt: null,
  lastBackupFilename: null,
  lastError: null,
  updatedAt: null
};

let autoBackupCheckPromise: Promise<void> | null = null;

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizePolicy(value: unknown): AutoBackupPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_POLICY;
  }

  const raw = value as Partial<AutoBackupPolicy>;
  return {
    enabled: raw.enabled === true,
    intervalHours: normalizeNumber(raw.intervalHours, DEFAULT_POLICY.intervalHours, 1, 24 * 30),
    retainCount: normalizeNumber(raw.retainCount, DEFAULT_POLICY.retainCount, 1, 100),
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    lastBackupFilename: typeof raw.lastBackupFilename === "string" ? raw.lastBackupFilename : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "自动备份失败";
}

function isDue(policy: AutoBackupPolicy) {
  if (!policy.enabled) return false;
  if (!policy.lastRunAt) return true;
  const lastRun = Date.parse(policy.lastRunAt);
  if (!Number.isFinite(lastRun)) return true;
  return Date.now() - lastRun >= policy.intervalHours * 60 * 60 * 1000;
}

async function savePolicy(policy: AutoBackupPolicy, userId: string | null) {
  await query(
    `insert into app_settings (key, value, updated_by, updated_at)
     values ($1, $2::jsonb, $3, now())
     on conflict (key) do update
     set value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify({ ...policy, updatedAt: new Date().toISOString() }), userId]
  );
}

export async function getAutoBackupPolicy(): Promise<AutoBackupPolicy> {
  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  return normalizePolicy(result.rows[0]?.value);
}

export async function updateAutoBackupPolicy(input: AutoBackupPolicyInput, userId: string): Promise<AutoBackupPolicy> {
  const current = await getAutoBackupPolicy();
  const next: AutoBackupPolicy = {
    ...current,
    enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    intervalHours: normalizeNumber(input.intervalHours, current.intervalHours, 1, 24 * 30),
    retainCount: normalizeNumber(input.retainCount, current.retainCount, 1, 100),
    lastError: input.enabled === false ? null : current.lastError
  };

  await savePolicy(next, userId);
  return getAutoBackupPolicy();
}

export async function runAutoBackupCheck() {
  if (autoBackupCheckPromise) return autoBackupCheckPromise;

  autoBackupCheckPromise = (async () => {
    const policy = await getAutoBackupPolicy();
    if (!isDue(policy)) return;

    try {
      const backup = await createDataBackup();
      await pruneDataBackups(policy.retainCount);
      await savePolicy(
        {
          ...policy,
          lastRunAt: new Date().toISOString(),
          lastBackupFilename: backup.filename,
          lastError: null
        },
        null
      );
    } catch (error) {
      await savePolicy(
        {
          ...policy,
          lastError: errorMessage(error)
        },
        null
      ).catch(() => undefined);
      throw error;
    }
  })();

  try {
    await autoBackupCheckPromise;
  } finally {
    autoBackupCheckPromise = null;
  }
}

export async function getBackupPanelState(): Promise<{ backups: DataBackupItem[]; policy: AutoBackupPolicy }> {
  const [backups, policy] = await Promise.all([listDataBackups(), getAutoBackupPolicy()]);
  return { backups, policy };
}
