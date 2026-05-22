import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import { getAutoBackupPolicy, updateAutoBackupPolicy } from "@/lib/auto-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();

  try {
    const policy = await getAutoBackupPolicy();
    return NextResponse.json({ policy }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "backups.policy.GET" });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const policy = await updateAutoBackupPolicy(body, user.id);
    await writeAuditLog({
      user,
      request,
      action: "更新自动备份策略",
      targetType: "backup_policy",
      detail: {
        enabled: policy.enabled,
        intervalHours: policy.intervalHours,
        retainCount: policy.retainCount
      }
    });
    return NextResponse.json({ policy }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "backups.policy.PATCH", fallbackStatus: 400 });
  }
}
