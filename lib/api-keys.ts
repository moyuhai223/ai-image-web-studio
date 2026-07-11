import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "./api-errors";
import { query, transaction } from "./db";
import type { User } from "./types";

/**
 * 每用户自助 API Key(对外 OpenAI 兼容接口 /v1/* 的 bearer 鉴权)。
 * 只存 sha256 哈希——入站凭据无需还原明文,明文仅创建响应返回一次;
 * key_prefix 是明文前缀,仅用于列表识别。吊销写 revoked_at,不物理删(留审计)。
 */
export const API_KEY_PREFIX = "sk-aiws-";
export const MAX_ACTIVE_KEYS_PER_USER = 10;
const KEY_NAME_MAX_LENGTH = 40;

export type ApiKeySummary = {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** 仅 admin 全量视图带(join users) */
  username?: string;
};

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey() {
  const plaintext = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, API_KEY_PREFIX.length + 6)
  };
}

/** 创建 Key:每人最多 MAX_ACTIVE_KEYS_PER_USER 个有效 Key。返回明文(仅此一次)+ 摘要。 */
export async function createApiKey(userId: string, name: string): Promise<{ plaintext: string; item: ApiKeySummary }> {
  const trimmedName = name.trim().slice(0, KEY_NAME_MAX_LENGTH);
  const generated = generateApiKey();
  // 上限检查与插入同事务 + per-user advisory lock,防并发创建绕过上限(与生图配额闸同模式)
  const item = await transaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`api-keys:${userId}`]);
    const active = await client.query<{ count: string }>(
      `select count(*)::text as count from api_keys where user_id = $1 and revoked_at is null`,
      [userId]
    );
    if (Number(active.rows[0]?.count ?? 0) >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new ApiError(`每人最多保留 ${MAX_ACTIVE_KEYS_PER_USER} 个有效 API Key,请先吊销不用的`, 400);
    }
    const inserted = await client.query<ApiKeySummary>(
      `insert into api_keys (user_id, name, key_hash, key_prefix)
       values ($1, $2, $3, $4)
       returning id, name, key_prefix, last_used_at, revoked_at, created_at`,
      [userId, trimmedName, generated.hash, generated.prefix]
    );
    return inserted.rows[0];
  });
  return { plaintext: generated.plaintext, item };
}

/** 列表:member 只看自己;admin 看全部(带 username)。绝不返回 key_hash。 */
export async function listApiKeys(user: User): Promise<ApiKeySummary[]> {
  if (user.role === "admin") {
    const result = await query<ApiKeySummary>(
      `select k.id, k.name, k.key_prefix, k.last_used_at, k.revoked_at, k.created_at, u.username
       from api_keys k
       join users u on u.id = k.user_id
       order by k.created_at desc`
    );
    return result.rows;
  }
  const result = await query<ApiKeySummary>(
    `select id, name, key_prefix, last_used_at, revoked_at, created_at
     from api_keys
     where user_id = $1
     order by created_at desc`,
    [user.id]
  );
  return result.rows;
}

/** 吊销:owner 或 admin;已吊销/不存在/无权返回 null(调用方回 404)。 */
export async function revokeApiKey(id: string, user: User): Promise<ApiKeySummary | null> {
  const result = await query<ApiKeySummary & { user_id: string }>(
    `update api_keys
     set revoked_at = now()
     where id = $1 and revoked_at is null and ($2 = 'admin' or user_id = $3)
     returning id, user_id, name, key_prefix, last_used_at, revoked_at, created_at`,
    [id, user.role, user.id]
  );
  return result.rows[0] ?? null;
}
