import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { API_KEY_PREFIX } from "./api-keys";
import { config } from "./config";
import { query } from "./db";
import type { User } from "./types";

/**
 * 对外 API(/v1/*)的 bearer 鉴权:Authorization: Bearer sk-aiws-… → sha256 → api_keys 查表。
 * 每请求实时查库(无缓存),吊销/停用/强制改密下一个请求立即失效。
 */
export type ApiKeyAuth = { user: User; keyId: string };

export async function authenticateApiKey(request: Request): Promise<ApiKeyAuth | null> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1]?.trim();
  // 前缀剪枝:非本站 key 直接拒,不打 DB
  if (!token || !token.startsWith(API_KEY_PREFIX)) return null;

  const hash = createHash("sha256").update(token).digest("hex");
  const result = await query<User & { key_id: string }>(
    `select u.id, u.username, u.role, u.active, u.must_change_password,
            u.session_epoch, u.created_at, u.updated_at, k.id as key_id
     from api_keys k
     join users u on u.id = k.user_id
     where k.key_hash = $1 and k.revoked_at is null and u.active = true`,
    [hash]
  );
  const row = result.rows[0];
  if (!row) return null;
  // 强制改密中的账号视同不可用,与 requireUser 语义对齐(防止绕过改密总闸继续用 API)
  if (row.must_change_password) return null;

  // last_used_at 节流更新:60s 内最多写一次,fire-and-forget 不阻塞请求
  void query(
    `update api_keys set last_used_at = now()
     where id = $1 and (last_used_at is null or last_used_at < now() - interval '60 seconds')`,
    [row.key_id]
  ).catch(() => undefined);

  const { key_id, ...user } = row;
  return { user: user as User, keyId: key_id };
}

/** OpenAI 风格错误响应,/v1/* 端点统一使用。 */
export function openAiError(status: number, message: string, code: string, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type, param: null, code } }, { status });
}

export function invalidApiKeyResponse() {
  return openAiError(401, "Incorrect API key provided. 请登录网页在「API Key」页面创建有效的密钥。", "invalid_api_key");
}

// ---- 签名图片 URL(response_format=url):HMAC 限时公开链接,零存储 ----

const SIGNED_IMAGE_TTL_SECONDS = 24 * 3600;

function imageSignature(imageId: string, exp: number): string {
  return createHmac("sha256", config.authSecret).update(`v1-image:${imageId}:${exp}`).digest("base64url");
}

export function buildSignedImageUrl(origin: string, imageId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SIGNED_IMAGE_TTL_SECONDS;
  return `${origin}/v1/images/files/${imageId}?exp=${exp}&sig=${imageSignature(imageId, exp)}`;
}

export function verifySignedImageQuery(imageId: string, exp: string | null, sig: string | null): boolean {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || !Number.isInteger(expNum)) return false;
  if (expNum < Math.floor(Date.now() / 1000)) return false;
  if (!sig) return false;
  const expected = Buffer.from(imageSignature(imageId, expNum));
  const provided = Buffer.from(sig);
  // HMAC 校验必须常数时间比较(可被逐位试探);长度不同直接拒
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
