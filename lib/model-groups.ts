import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { normalizeAiBaseUrl } from "./base-url";
import { query, transaction } from "./db";
import { assertPublicBaseUrl } from "./egress-guard";
import { decryptSecret, encryptSecret, isSecretCipher, previewSecret } from "./secret-box";

/**
 * 模型组(Model Groups):把 baseUrl + 单个 key + 该网关支持的模型列表绑成一个自包含的组。
 * 工作台只选模型,选中即锁定其组的 baseUrl+key,杜绝「选了模型但 baseUrl 不支持」的错配。
 * 存于 app_settings 的 model_groups 行(JSONB)。key 用 secret-box(aes-256-gcm)加密,只在服务端解密。
 */
const SETTINGS_KEY = "model_groups";
const SETTINGS_CACHE_TTL_MS = 60_000;

export type ModelOption = { value: string; label: string };

type StoredModelGroup = {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelOption[];
  // 单个 key 的密文(secret-box);groups 首建时若未给 key 则三者为空串,resolve 时视为无 key。
  iv: string;
  tag: string;
  ciphertext: string;
  keyPreview: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
};

type StoredModelGroups = { version: 1; groups: StoredModelGroup[] };

/** 客户端安全摘要:不含明文 key,也不含密文 iv/tag/ciphertext,只给掩码 keyPreview 与是否已配置 key。 */
export type ModelGroupSummary = {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelOption[];
  keyPreview: string;
  hasKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

/** 工作台模型下拉的一项:一个(组, 模型)对。 */
export type GroupModelOption = { groupId: string; groupName: string; model: string; label: string };

let cached: { settings: StoredModelGroups; expiresAt: number } | null = null;

export function invalidateModelGroupsCache() {
  cached = null;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultSettings(): StoredModelGroups {
  return { version: 1, groups: [] };
}

function normalizeGroupName(value: unknown): string {
  if (typeof value !== "string") throw new Error("模型组名称格式不正确");
  const trimmed = value.trim().slice(0, 64);
  if (!trimmed) throw new Error("模型组名称不能为空");
  return trimmed;
}

/** 规整模型列表:每项 {value,label},value 去空、去重,label 缺省用 value。至少一个。 */
function normalizeModels(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) throw new Error("模型列表格式不正确");
  const out: ModelOption[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const modelValue = typeof record.value === "string" ? record.value.trim().slice(0, 120) : "";
    if (!modelValue || seen.has(modelValue)) continue;
    seen.add(modelValue);
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim().slice(0, 80) : modelValue;
    out.push({ value: modelValue, label });
  }
  if (out.length === 0) throw new Error("模型组至少需要一个模型");
  return out;
}

function ensureSingleDefault(settings: StoredModelGroups): StoredModelGroups {
  const enabledDefaults = settings.groups.filter((group) => group.isDefault);
  if (enabledDefaults.length === 0 && settings.groups.length > 0) {
    settings.groups[0].isDefault = true;
    return settings;
  }
  if (enabledDefaults.length > 1) {
    let kept = false;
    for (const group of settings.groups) {
      if (group.isDefault && !kept) {
        kept = true;
        continue;
      }
      group.isDefault = false;
    }
  }
  return settings;
}

function normalizeStoredGroup(value: unknown): StoredModelGroup | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.baseUrl !== "string") return null;
  if (!Array.isArray(r.models)) return null;
  const models = (r.models as unknown[])
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const rec = m as Record<string, unknown>;
      if (typeof rec.value !== "string" || !rec.value.trim()) return null;
      return { value: rec.value, label: typeof rec.label === "string" && rec.label ? rec.label : rec.value };
    })
    .filter(Boolean) as ModelOption[];
  if (models.length === 0) return null;
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.baseUrl,
    models,
    iv: typeof r.iv === "string" ? r.iv : "",
    tag: typeof r.tag === "string" ? r.tag : "",
    ciphertext: typeof r.ciphertext === "string" ? r.ciphertext : "",
    keyPreview: typeof r.keyPreview === "string" ? r.keyPreview : "",
    enabled: r.enabled !== false,
    isDefault: Boolean(r.isDefault),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : nowIso(),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : nowIso(),
    createdBy: typeof r.createdBy === "string" ? r.createdBy : null
  };
}

function normalizeSettings(value: unknown): StoredModelGroups {
  if (!value || typeof value !== "object") return defaultSettings();
  const r = value as Record<string, unknown>;
  if (!Array.isArray(r.groups)) return defaultSettings();
  const groups = r.groups.map(normalizeStoredGroup).filter(Boolean) as StoredModelGroup[];
  return ensureSingleDefault({ version: 1, groups });
}

function groupHasKey(group: StoredModelGroup): boolean {
  return Boolean(group.iv && group.tag && group.ciphertext);
}

function toSummary(group: StoredModelGroup): ModelGroupSummary {
  return {
    id: group.id,
    name: group.name,
    baseUrl: group.baseUrl,
    models: group.models,
    keyPreview: group.keyPreview,
    hasKey: groupHasKey(group),
    enabled: group.enabled,
    isDefault: group.isDefault,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt
  };
}

async function loadSettingsForUpdate(client: PoolClient): Promise<StoredModelGroups> {
  await client.query(
    `insert into app_settings (key, value) values ($1, $2::jsonb) on conflict (key) do nothing`,
    [SETTINGS_KEY, JSON.stringify(defaultSettings())]
  );
  const result = await client.query<{ value: unknown }>(
    `select value from app_settings where key = $1 for update`,
    [SETTINGS_KEY]
  );
  return normalizeSettings(result.rows[0]?.value);
}

async function saveSettings(client: PoolClient, settings: StoredModelGroups, updatedBy?: string) {
  ensureSingleDefault(settings);
  if (updatedBy) {
    await client.query(
      `update app_settings set value = $2::jsonb, updated_by = $3, updated_at = now() where key = $1`,
      [SETTINGS_KEY, JSON.stringify(settings), updatedBy]
    );
    return;
  }
  await client.query(`update app_settings set value = $2::jsonb, updated_at = now() where key = $1`, [
    SETTINGS_KEY,
    JSON.stringify(settings)
  ]);
}

/** 缓存的原始设置(含密文,仅服务端用;绝不直接下发客户端)。 */
async function getModelGroupsSettings(): Promise<StoredModelGroups> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.settings;
  const result = await query<{ value: unknown }>(`select value from app_settings where key = $1`, [SETTINGS_KEY]);
  const settings = normalizeSettings(result.rows[0]?.value);
  cached = { settings, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return settings;
}

/** 后台列表:客户端安全摘要(无 key)。 */
export async function listModelGroups(): Promise<ModelGroupSummary[]> {
  return (await getModelGroupsSettings()).groups.map(toSummary);
}

/** 工作台模型下拉:拍平所有启用组的模型。 */
export async function listGroupModelOptions(): Promise<GroupModelOption[]> {
  const groups = (await getModelGroupsSettings()).groups.filter((g) => g.enabled);
  const options: GroupModelOption[] = [];
  for (const group of groups) {
    for (const model of group.models) {
      options.push({ groupId: group.id, groupName: group.name, model: model.value, label: model.label });
    }
  }
  return options;
}

/** 启用组默认模型的默认组 id(工作台预选)。 */
export async function getDefaultGroupId(): Promise<string | null> {
  const groups = (await getModelGroupsSettings()).groups.filter((g) => g.enabled);
  return groups.find((g) => g.isDefault)?.id ?? groups[0]?.id ?? null;
}

/** 记录/收藏页模型筛选:所有启用组里出现过的去重模型。 */
export async function listDistinctModelValues(): Promise<ModelOption[]> {
  const groups = (await getModelGroupsSettings()).groups.filter((g) => g.enabled);
  const seen = new Map<string, string>();
  for (const group of groups) {
    for (const model of group.models) {
      if (!seen.has(model.value)) seen.set(model.value, model.label);
    }
  }
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
}

export type ResolvedModelGroup = {
  group: { id: string; name: string; baseUrl: string };
  apiKey: string; // 明文;仅服务端。无 key 时为空串,由调用方走 env 兜底。
};

function toResolved(group: StoredModelGroup): ResolvedModelGroup {
  let apiKey = "";
  if (groupHasKey(group)) {
    try {
      apiKey = decryptSecret({ iv: group.iv, tag: group.tag, ciphertext: group.ciphertext });
    } catch {
      apiKey = "";
    }
  }
  return { group: { id: group.id, name: group.name, baseUrl: group.baseUrl }, apiKey };
}

/**
 * 服务端解析:groupId → {baseUrl, 明文 apiKey}。找不到指定组则回退默认启用组、再回退任一启用组;
 * 无任何启用组返回 null(调用方走 env 兜底)。
 */
export async function resolveModelGroup(groupId?: string | null): Promise<ResolvedModelGroup | null> {
  const groups = (await getModelGroupsSettings()).groups.filter((g) => g.enabled);
  const group =
    (groupId ? groups.find((g) => g.id === groupId) : null) ??
    groups.find((g) => g.isDefault) ??
    groups[0] ??
    null;
  return group ? toResolved(group) : null;
}

// 每个模型一个轮询游标(进程内存,重启归零即可)。同名模型分布在多个组时按序轮流取组。
const rotationCursors = new Map<string, number>();

/**
 * 模型感知解析(生成链路用):
 * - 传了 groupId(手动指定)且该组仍启用 → 锁定该组;
 * - 否则(自动)在「列出了该模型」的启用组之间轮询;
 * - 该模型不在任何组里 → 回退默认启用组/首个启用组(兼容 env 场景的旧行为);
 * - 无任何启用组 → null(调用方走 env 兜底)。
 */
export async function resolveGroupForModel(model: string, groupId?: string | null): Promise<ResolvedModelGroup | null> {
  const groups = (await getModelGroupsSettings()).groups.filter((g) => g.enabled);
  const serving = groups.filter((g) => g.models.some((m) => m.value === model));
  if (groupId) {
    const pinned = groups.find((g) => g.id === groupId);
    // 指定组仍启用且仍列出该模型 → 锁定;(该模型已不在任何组时也尊重指定,等同兜底)
    // 组还在但已不服务该模型 → 落回自动轮询,防止把模型发给不支持它的网关。
    if (pinned && (serving.length === 0 || serving.some((g) => g.id === pinned.id))) {
      return toResolved(pinned);
    }
  }
  if (serving.length > 0) {
    const cursor = rotationCursors.get(model) ?? 0;
    rotationCursors.set(model, cursor + 1);
    return toResolved(serving[cursor % serving.length]);
  }
  const fallback = groups.find((g) => g.isDefault) ?? groups[0] ?? null;
  return fallback ? toResolved(fallback) : null;
}

function applyKey(group: StoredModelGroup, apiKey: string) {
  const cipher = encryptSecret(apiKey);
  group.iv = cipher.iv;
  group.tag = cipher.tag;
  group.ciphertext = cipher.ciphertext;
  group.keyPreview = previewSecret(apiKey);
}

export async function createModelGroup(input: {
  name: string;
  baseUrl: string;
  models: unknown;
  apiKey: string;
  isDefault?: boolean;
  enabled?: boolean;
  userId: string;
}) {
  const name = normalizeGroupName(input.name);
  const baseUrl = normalizeAiBaseUrl(input.baseUrl);
  // 保存前即拒绝内网/元数据地址(纵深防御:不依赖发请求时的出站兜底)。
  await assertPublicBaseUrl(baseUrl);
  const models = normalizeModels(input.models);
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (!apiKey) throw new Error("请填写该组的 API Key");

  const result = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const group: StoredModelGroup = {
      id: randomUUID(),
      name,
      baseUrl,
      models,
      iv: "",
      tag: "",
      ciphertext: "",
      keyPreview: "",
      enabled: input.enabled !== false,
      isDefault: settings.groups.length === 0 || Boolean(input.isDefault),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: input.userId
    };
    applyKey(group, apiKey);
    if (group.isDefault) settings.groups.forEach((g) => (g.isDefault = false));
    settings.groups.push(group);
    await saveSettings(client, settings, input.userId);
    return toSummary(group);
  });
  invalidateModelGroupsCache();
  return result;
}

export async function updateModelGroup(input: {
  id: string;
  name?: string;
  baseUrl?: string;
  models?: unknown;
  apiKey?: string; // 只写:仅当传了非空才重新加密;留空=不改 key
  enabled?: boolean;
  isDefault?: boolean;
  userId: string;
}) {
  // 在进事务(select … for update 持行锁)前完成 baseUrl 规整与出站校验,避免持锁做 DNS。
  let normalizedBaseUrl: string | undefined;
  if (typeof input.baseUrl === "string") {
    normalizedBaseUrl = normalizeAiBaseUrl(input.baseUrl);
    await assertPublicBaseUrl(normalizedBaseUrl);
  }
  const result = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const group = settings.groups.find((g) => g.id === input.id);
    if (!group) throw new Error("模型组不存在");

    if (typeof input.name === "string") group.name = normalizeGroupName(input.name);
    if (normalizedBaseUrl !== undefined) group.baseUrl = normalizedBaseUrl;
    if (input.models !== undefined) group.models = normalizeModels(input.models);
    if (typeof input.apiKey === "string" && input.apiKey.trim()) applyKey(group, input.apiKey.trim());
    if (typeof input.enabled === "boolean") group.enabled = input.enabled;

    if (input.isDefault === true) {
      settings.groups.forEach((g) => (g.isDefault = g.id === group.id));
    } else if (input.isDefault === false && group.isDefault) {
      throw new Error("至少需要保留一个默认模型组。请先把其他组设为默认。");
    }
    group.updatedAt = nowIso();
    await saveSettings(client, settings, input.userId);
    return toSummary(group);
  });
  invalidateModelGroupsCache();
  return result;
}

export async function deleteModelGroup(input: { id: string; userId: string }) {
  const result = await transaction(async (client) => {
    const settings = await loadSettingsForUpdate(client);
    const group = settings.groups.find((g) => g.id === input.id);
    if (!group) throw new Error("模型组不存在");
    // 有其它组时禁止删默认(先改默认);删最后一个组允许(→ env 兜底)。
    if (group.isDefault && settings.groups.length > 1) {
      throw new Error("默认模型组不能直接删除,请先把其他组设为默认。");
    }
    settings.groups = settings.groups.filter((g) => g.id !== input.id);
    await saveSettings(client, settings, input.userId);
    return settings.groups.map(toSummary);
  });
  invalidateModelGroupsCache();
  return result;
}

export async function setDefaultModelGroup(input: { id: string; userId: string }) {
  return updateModelGroup({ id: input.id, isDefault: true, userId: input.userId });
}
