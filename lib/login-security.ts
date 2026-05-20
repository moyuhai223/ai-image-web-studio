import { query } from "./db";

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_WINDOW_MINUTES = 15;

export function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
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
