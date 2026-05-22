import { NextResponse } from "next/server";
import { runAutoBackupCheck } from "@/lib/auto-backup";
import { getSystemHealth } from "@/lib/health";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.health");

export async function GET() {
  const health = await getSystemHealth();
  void runAutoBackupCheck().catch((error) => {
    log.warn("Auto backup check failed", { error });
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
