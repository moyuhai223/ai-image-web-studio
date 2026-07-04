import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { query, transaction } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { deleteStoredImageFiles } from "@/lib/storage";
import { createLogger } from "@/lib/logger";
import { updateUserSchema } from "@/lib/validation";
import type { User } from "@/lib/types";
import type { PoolClient } from "pg";

export const runtime = "nodejs";

const log = createLogger("api.users");

class LastActiveAdminError extends Error {
  constructor() {
    super("至少需要保留一个启用的管理员");
    this.name = "LastActiveAdminError";
  }
}

async function countActiveAdmins() {
  const result = await query<{ count: string }>(
    `select count(*)::text as count from users where role = 'admin' and active = true`
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * 在事务内校验「停用/降级/删除后仍保留 ≥1 个启用管理员」的不变量。先取固定 key 的事务级 advisory lock
 * 串行化所有会改变管理员数的操作,再锁内重算——防两个并发请求各删/降一个管理员导致零管理员锁死(TOCTOU)。
 */
async function assertKeepsAnAdmin(client: PoolClient) {
  await client.query(`select pg_advisory_xact_lock(hashtext('admin-invariant'))`);
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from users where role = 'admin' and active = true`
  );
  if (Number(result.rows[0]?.count ?? 0) <= 1) throw new LastActiveAdminError();
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
    const nextActive = parsed.data.active;
    if (target.id === currentUser.id && !nextActive) {
      return NextResponse.json({ error: "不能禁用当前登录账号" }, { status: 400 });
    }

    // 停用时递增 session_epoch,让该用户已签发的会话 token 立即失效(active=true 过滤是主保险,epoch 兜底防再启用后旧 token 复活)。
    // last-admin 校验与写在同一事务 + advisory lock 内,防并发绕过。
    try {
      await transaction(async (client) => {
        if (target.role === "admin" && target.active && !nextActive) await assertKeepsAnAdmin(client);
        if (nextActive) {
          await client.query(`update users set active = true, updated_at = now() where id = $1`, [id]);
        } else {
          await client.query(`update users set active = false, session_epoch = session_epoch + 1, updated_at = now() where id = $1`, [id]);
        }
      });
    } catch (error) {
      if (error instanceof LastActiveAdminError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    await writeAuditLog({
      user: currentUser,
      request,
      action: nextActive ? "启用用户" : "禁用用户",
      targetType: "user",
      targetId: id,
      detail: { username: target.username }
    });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "resetPassword") {
    const passwordHash = await hashPassword(parsed.data.password);
    // 递增 session_epoch:管理员重置密码后,该用户旧会话 token 立即失效。
    await query(
      `update users set password_hash = $2, session_epoch = session_epoch + 1, updated_at = now() where id = $1`,
      [id, passwordHash]
    );
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
    const nextRole = parsed.data.role;
    // last-admin 校验与写在同一事务 + advisory lock 内,防并发把最后一个管理员降级。
    try {
      await transaction(async (client) => {
        if (target.role === "admin" && target.active && nextRole !== "admin") await assertKeepsAnAdmin(client);
        await client.query(`update users set role = $2, updated_at = now() where id = $1`, [id, nextRole]);
      });
    } catch (error) {
      if (error instanceof LastActiveAdminError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    await writeAuditLog({
      user: currentUser,
      request,
      action: "修改用户角色",
      targetType: "user",
      targetId: id,
      detail: { username: target.username, role: nextRole }
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const currentUser = await requireAdmin();
  const { id } = await context.params;

  const targetResult = await query<User>(
    `select id, username, role, active, created_at, updated_at from users where id = $1`,
    [id]
  );
  const target = targetResult.rows[0];
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (target.id === currentUser.id) {
    return NextResponse.json({ error: "不能删除当前登录账号" }, { status: 400 });
  }
  // 早退乐观检查(减少无谓事务);真正的不变量在下面事务内 assertKeepsAnAdmin 加锁复算。
  if (target.role === "admin" && target.active && (await countActiveAdmins()) <= 1) {
    return NextResponse.json({ error: "至少需要保留一个启用的管理员" }, { status: 400 });
  }

  // transferImages=true(默认):把该用户的图片转给当前管理员接管,不删图;=false:连图带文件一并删除。
  const transferImages = new URL(request.url).searchParams.get("transferImages") !== "false";

  let result: { paths: string[]; transferred: number };
  try {
    result = await transaction(async (client) => {
    if (target.role === "admin" && target.active) await assertKeepsAnAdmin(client);
    if (transferImages) {
      // 生成图归属通过 generation_jobs.user_id 派生,改 job 的 user_id 即把其全部生成图转给管理员;
      // 参考图有独立 user_id,一并改。改完再删用户,jobs/refs 已不属该用户,不会被级联删除,文件保留。
      const movedJobs = await client.query(
        `update generation_jobs set user_id = $2, updated_at = now() where user_id = $1`,
        [id, currentUser.id]
      );
      await client.query(`update reference_images set user_id = $2 where user_id = $1`, [id, currentUser.id]);
      await client.query(`delete from users where id = $1`, [id]);
      return { paths: [] as string[], transferred: movedJobs.rowCount ?? 0 };
    }

    // 一并删除:先收集落盘文件路径(生成图 + 参考图),再删用户(FK on delete cascade 删其 jobs/images/refs/收藏行)。
    // 磁盘文件不受级联影响,commit 后再逐个 best-effort unlink(缺失/失败不回滚删除)。
    const generated = await client.query<{ local_path: string }>(
      `select i.local_path
       from generated_images i
       join generation_jobs j on j.id = i.job_id
       where j.user_id = $1`,
      [id]
    );
    const references = await client.query<{ local_path: string }>(
      `select local_path from reference_images where user_id = $1`,
      [id]
    );
    await client.query(`delete from users where id = $1`, [id]);
    return {
      paths: [...generated.rows, ...references.rows].map((row) => row.local_path).filter(Boolean),
      transferred: 0
    };
    });
  } catch (error) {
    if (error instanceof LastActiveAdminError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const { paths, transferred } = result;

  let filesRemoved = 0;
  for (const relativePath of paths) {
    try {
      await deleteStoredImageFiles(relativePath);
      filesRemoved += 1;
    } catch (error) {
      log.warn("删除用户时清理文件失败", { relativePath, error });
    }
  }

  await writeAuditLog({
    user: currentUser,
    request,
    action: transferImages ? "删除用户(图片转管理员)" : "删除用户(一并删图)",
    targetType: "user",
    targetId: id,
    detail: { username: target.username, role: target.role, transferImages, transferredJobs: transferred, filesRemoved, filesTotal: paths.length }
  });

  return NextResponse.json({ ok: true, transferImages, transferredJobs: transferred, filesRemoved, filesTotal: paths.length });
}
