import { config } from "./config";
import { query } from "./db";

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_WINDOW_MINUTES = 15;

/**
 * 取真实客户端 IP 用于登录限流。优先读可信来源头(默认 cf-connecting-ip,由 Cloudflare 注入、
 * 客户端不可伪造),该头缺失才回退到反代设的 x-real-ip,最后才是可被伪造的 x-forwarded-for 首段。
 * 之前无条件取 XFF 首段,攻击者每请求换个伪造 IP 即可绕过 IP 维度限流做撞库(已修)。
 */
export function getClientIp(request: Request) {
  const trusted = config.trustedClientIpHeader;
  if (trusted) {
    const value = request.headers.get(trusted)?.split(",")[0]?.trim();
    if (value) return value;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

export async function checkLoginAllowed(username: string, ip: string) {
  const result = await query<{ count: string }>(
    `select count(*)::text as count
     from login_attempts
     where success = false
       and created_at > now() - ($3::text || ' minutes')::interval
       and (lower(username) = lower($1) or ip = $2)`,
    [username, ip, String(LOGIN_WINDOW_MINUTES)]
  );
  const failures = Number(result.rows[0]?.count ?? 0);
  return {
    allowed: failures < LOGIN_FAILURE_LIMIT,
    failures,
    limit: LOGIN_FAILURE_LIMIT,
    windowMinutes: LOGIN_WINDOW_MINUTES
  };
}

export async function recordLoginAttempt(input: { username: string; ip: string; success: boolean }) {
  await query(
    `insert into login_attempts (username, ip, success)
     values ($1, $2, $3)`,
    [input.username, input.ip, input.success]
  );

  if (input.success) {
    await query(
      `delete from login_attempts
       where success = false and (lower(username) = lower($1) or ip = $2)`,
      [input.username, input.ip]
    );
  }

  await query(`delete from login_attempts where created_at < now() - interval '7 days'`);
}
