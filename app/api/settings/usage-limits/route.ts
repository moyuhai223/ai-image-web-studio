import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import {
  DAILY_GENERATION_LIMIT_MAX,
  getDailyGenerationLimit,
  updateDailyGenerationLimit
} from "@/lib/usage-limits";

export const runtime = "nodejs";

export async function GET() {
  await requireAdmin();
  try {
    return NextResponse.json({ dailyGenerationLimit: await getDailyGenerationLimit() });
  } catch (error) {
    return respondError(error, { context: "settings.usageLimits.GET", fallbackStatus: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // 只接受 JSON number(前端本就发 number)——不做字符串 coerce,防止空串被 Number() 成 0(不限)。
    const num = body.dailyGenerationLimit;
    if (typeof num !== "number" || !Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
      return NextResponse.json({ error: "每日上限必须是不小于 0 的整数(0 = 不限)" }, { status: 400 });
    }
    if (num > DAILY_GENERATION_LIMIT_MAX) {
      return NextResponse.json({ error: `每日上限不能超过 ${DAILY_GENERATION_LIMIT_MAX}` }, { status: 400 });
    }

    const previous = await getDailyGenerationLimit();
    const updated = await updateDailyGenerationLimit({ limit: num, userId: user.id });
    await writeAuditLog({
      user,
      request,
      action: "修改每日生成上限",
      targetType: "usage_limits",
      detail: { dailyGenerationLimit: { from: previous, to: updated } }
    });
    return NextResponse.json({ dailyGenerationLimit: updated });
  } catch (error) {
    return respondError(error, { context: "settings.usageLimits.PATCH", fallbackStatus: 400 });
  }
}
