import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { clearAuditLogs, listAuditLogs, writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "审计日志读取失败";
}

export async function GET(request: Request) {
  await requireAdmin();

  try {
    const url = new URL(request.url);
    const logs = await listAuditLogs({
      limit: Number(url.searchParams.get("limit") ?? 80),
      username: url.searchParams.get("username") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      targetType: url.searchParams.get("targetType") ?? undefined,
      keyword: url.searchParams.get("keyword") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined
    });
    return NextResponse.json({ logs }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();

  try {
    const deletedCount = await clearAuditLogs();
    await writeAuditLog({
      user,
      request,
      action: "清空审计日志",
      targetType: "audit_logs",
      detail: { deletedCount }
    });
    const logs = await listAuditLogs({ limit: 80 });
    return NextResponse.json({ deletedCount, logs }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
