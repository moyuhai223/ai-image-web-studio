import { NextResponse } from "next/server";
import { runAutoBackupCheck } from "@/lib/auto-backup";
import { getSystemHealth } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getSystemHealth();
  void runAutoBackupCheck().catch((error) => {
    console.warn("Auto backup check failed:", error);
  });
  return NextResponse.json(
    health,
    {
      status: health.ok ? 200 : 503,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
