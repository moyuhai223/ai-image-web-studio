import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { updateUserSchema } from "@/lib/validation";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

async function countActiveAdmins() {
  const result = await query<{ count: string }>(
    `select count(*)::text as count from users where role = 'admin' and active = true`
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const currentUser = await requireAdmin();
  const { id } = await context.params;
  const parsed = updateUserSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  const targetResult = await query<User>(
    `select id, username, role, active, created_at, updated_at from users where id = $1`,
    [id]
  );
  const target = targetResult.rows[0];
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (parsed.data.action === "setActive") {
    if (target.id === currentUser.id && !parsed.data.active) {
      return NextResponse.json({ error: "不能禁用当前登录账号" }, { status: 400 });
    }

    if (target.role === "admin" && target.active && !parsed.data.active && (await countActiveAdmins()) <= 1) {
      return NextResponse.json({ error: "至少需要保留一个启用的管理员" }, { status: 400 });
    }

    await query(`update users set active = $2, updated_at = now() where id = $1`, [id, parsed.data.active]);
    await writeAuditLog({
      user: currentUser,
      request,
      action: parsed.data.active ? "启用用户" : "禁用用户",
      targetType: "user",
      targetId: id,
      detail: { username: target.username }
    });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "resetPassword") {
    const passwordHash = await hashPassword(parsed.data.password);
    await query(`update users set password_hash = $2, updated_at = now() where id = $1`, [id, passwordHash]);
    await writeAuditLog({
      user: currentUser,
      request,
      action: "重置用户密码",
      targetType: "user",
      targetId: id,
      detail: { username: target.username }
    });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "setRole") {
    if (target.role === "admin" && target.active && parsed.data.role !== "admin" && (await countActiveAdmins()) <= 1) {
      return NextResponse.json({ error: "至少需要保留一个启用的管理员" }, { status: 400 });
    }

    await query(`update users set role = $2, updated_at = now() where id = $1`, [id, parsed.data.role]);
    await writeAuditLog({
      user: currentUser,
      request,
      action: "修改用户角色",
      targetType: "user",
      targetId: id,
      detail: { username: target.username, role: parsed.data.role }
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}
