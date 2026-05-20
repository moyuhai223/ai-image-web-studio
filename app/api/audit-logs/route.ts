import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listAuditLogs } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "审计日志读取失败";
}

export async function GET(request: Request) {
  await requireAdmin();

  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 80);
    const logs = await listAuditLogs(limit);
    return NextResponse.json({ logs }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
