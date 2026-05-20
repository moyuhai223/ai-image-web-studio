import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { getAutoBackupPolicy, updateAutoBackupPolicy } from "@/lib/auto-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "自动备份设置保存失败";
}

export async function GET() {
  await requireAdmin();

  try {
    const policy = await getAutoBackupPolicy();
    return NextResponse.json({ policy }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
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
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
