import { config } from "./config";
import { query } from "./db";

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_WINDOW_MINUTES = 15;
// username 维度改按「不同来源 IP 数」触发,而非累计次数——否则任意人从任意 IP 连错密码即可锁死他人账号(锁定 DoS)。
// 单个攻击 IP 只算 1 个 distinct ip(且其自身早已被 IP 维度的 5 次上限锁住),需真正的分布式攻击(≥此值个不同 IP)才锁账号。
const LOGIN_USERNAME_DISTINCT_IP_LIMIT = 10;

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
  const result = await query<{ ip_failures: string; username_distinct_ips: string }>(
    `select
       count(*) filter (where ip = $2)::text as ip_failures,
       count(distinct ip) filter (where lower(username) = lower($1))::text as username_distinct_ips
     from login_attempts
     where success = false
       and created_at > now() - ($3::text || ' minutes')::interval`,
    [username, ip, String(LOGIN_WINDOW_MINUTES)]
  );
  const ipFailures = Number(result.rows[0]?.ip_failures ?? 0);
  const usernameDistinctIps = Number(result.rows[0]?.username_distinct_ips ?? 0);
  // 两道闸:① 同一来源 IP 15 分钟内失败 ≥5 次(挡单机暴破);② 同一账号被 ≥10 个不同 IP 攻击(挡分布式撞库)。
  const allowed = ipFailures < LOGIN_FAILURE_LIMIT && usernameDistinctIps < LOGIN_USERNAME_DISTINCT_IP_LIMIT;
  return {
    allowed,
    failures: ipFailures,
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
