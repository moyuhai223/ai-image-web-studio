import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDataBackup, deleteDataBackup, listDataBackups } from "@/lib/data-backup";
import { getAutoBackupPolicy } from "@/lib/auto-backup";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();

  try {
    const [backups, policy] = await Promise.all([listDataBackups(), getAutoBackupPolicy()]);
    return NextResponse.json({ backups, policy }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "backups.GET" });
  }
}

export async function POST(request: Request) {
  const user = await requireAdmin();

  try {
    const backup = await createDataBackup();
    await writeAuditLog({
      user,
      request,
      action: "创建数据备份",
      targetType: "backup",
      targetId: backup.filename,
      detail: { fileCount: backup.fileCount, fileBytes: backup.fileBytes }
    });
    const backups = await listDataBackups();
    return NextResponse.json({ backup, backups }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "backups.POST" });
  }
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as { filename?: unknown };
    if (typeof body.filename !== "string") {
      return NextResponse.json({ error: "请选择要删除的备份文件" }, { status: 400 });
    }

    await deleteDataBackup(body.filename);
    await writeAuditLog({
      user,
      request,
      action: "删除数据备份",
      targetType: "backup",
      targetId: body.filename
    });
    const backups = await listDataBackups();
    return NextResponse.json({ ok: true, backups }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "backups.DELETE" });
  }
}
