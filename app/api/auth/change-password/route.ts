import { NextResponse } from "next/server";
import { getCurrentUser, setSessionCookie } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { query } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { crossOriginViolation } from "@/lib/request-guard";
import { changePasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (crossOriginViolation(request)) {
    return NextResponse.json({ error: "请求来源校验失败" }, { status: 403 });
  }
  // 自助改密：用 getCurrentUser 而非 requireUser，避免被强制改密总闸重定向(否则死循环)。
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "新密码不能与当前密码相同" }, { status: 400 });
  }

  const result = await query<{ password_hash: string }>(
    `select password_hash from users where id = $1 and active = true`,
    [user.id]
  );
  const row = result.rows[0];
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return NextResponse.json({ error: "当前密码错误" }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  // 递增 session_epoch 使所有旧 token 立即失效(改密应踢掉泄露的会话),再给当前会话重发新 cookie。
  const updated = await query<{ session_epoch: number }>(
    `update users
     set password_hash = $2, must_change_password = false, session_epoch = session_epoch + 1, updated_at = now()
     where id = $1
     returning session_epoch`,
    [user.id, passwordHash]
  );
  await setSessionCookie({ ...user, session_epoch: updated.rows[0]?.session_epoch ?? user.session_epoch });

  await writeAuditLog({
    user,
    request,
    action: "修改密码",
    targetType: "user",
    targetId: user.id,
    detail: { username: user.username }
  });

  return NextResponse.json({ ok: true });
}
