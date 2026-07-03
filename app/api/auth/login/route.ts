import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { loginSchema } from "@/lib/validation";
import { checkLoginAllowed, getClientIp, recordLoginAttempt } from "@/lib/login-security";
import { crossOriginViolation } from "@/lib/request-guard";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

type LoginUser = User & { password_hash: string };

export async function POST(request: Request) {
  if (crossOriginViolation(request)) {
    return NextResponse.json({ error: "请求来源校验失败" }, { status: 403 });
  }
  const parsed = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "用户名或密码无效" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const loginAllowed = await checkLoginAllowed(parsed.data.username, ip);
  if (!loginAllowed.allowed) {
    return NextResponse.json(
      { error: `登录失败次数过多，请 ${loginAllowed.windowMinutes} 分钟后再试` },
      { status: 429 }
    );
  }

  const result = await query<LoginUser>(
    `select id, username, password_hash, role, active, created_at, updated_at
     from users
     where username = $1 and active = true`,
    [parsed.data.username]
  );
  const user = result.rows[0];

  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    await recordLoginAttempt({ username: parsed.data.username, ip, success: false });
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  await recordLoginAttempt({ username: parsed.data.username, ip, success: true });
  await setSessionCookie(user);
  return NextResponse.json({ ok: true });
}
