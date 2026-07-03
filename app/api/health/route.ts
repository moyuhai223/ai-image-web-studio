import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
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

  // 详细诊断(上游网关地址、存储路径、Key 统计、最近失败任务)只对管理员可见——
  // 未认证/普通用户仅拿到存活状态,避免信息泄露(健康检查只看状态码,不受影响)。
  const user = await getCurrentUser().catch(() => null);
  const body =
    user?.role === "admin" ? health : { ok: health.ok, checkedAt: health.checkedAt };

  return NextResponse.json(body, {
    status: health.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
