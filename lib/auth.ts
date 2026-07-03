import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { query } from "./db";
import { config } from "./config";
import type { User } from "./types";

const SESSION_COOKIE = "ai_image_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  username: string;
  role: User["role"];
  /** 签发时用户的 session_epoch;与 DB 当前值不一致即视为已撤销。旧 token 无此字段按 0 处理。 */
  epoch?: number;
  exp: number;
};

type SessionUser = Pick<User, "id" | "username" | "role"> & { session_epoch?: number };

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string) {
  return createHmac("sha256", config.authSecret).update(data).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSessionToken(user: SessionUser) {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    epoch: user.session_epoch ?? 0,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function parseSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(user: SessionUser) {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const session = parseSessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const result = await query<User>(
    `select id, username, role, active, must_change_password, session_epoch, created_at, updated_at
     from users
     where id = $1 and active = true`,
    [session.userId]
  );

  const user = result.rows[0];
  if (!user) return null;
  // 会话撤销:token 内 epoch 与 DB 当前值不一致即失效(改密/重置/停用后旧 token 立即作废)。
  // 旧 token 无 epoch 字段按 0 处理,与既有用户默认 0 相符,避免升级后全员被登出。
  if ((session.epoch ?? 0) !== user.session_epoch) return null;

  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
