import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { hashPassword } from "@/lib/password";
import { query } from "@/lib/db";
import { createUserSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireAdmin();
  const parsed = createUserSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  // 同名冲突走「重置密码」语义:递增 session_epoch 使该用户旧会话 token 立即失效,与 PATCH resetPassword 对齐。
  await query(
    `insert into users (username, password_hash, role)
     values ($1, $2, $3)
     on conflict (username) do update
     set password_hash = excluded.password_hash, role = excluded.role, active = true,
         session_epoch = users.session_epoch + 1, updated_at = now()`,
    [parsed.data.username, passwordHash, parsed.data.role]
  );
  await writeAuditLog({
    user,
    request,
    action: "创建或重置用户",
    targetType: "user",
    targetId: parsed.data.username,
    detail: { role: parsed.data.role }
  });

  return NextResponse.json({ ok: true });
}
