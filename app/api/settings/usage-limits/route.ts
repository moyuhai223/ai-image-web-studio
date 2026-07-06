import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import {
  DAILY_GENERATION_LIMIT_MAX,
  MAX_GENERATION_CONCURRENCY_MAX,
  getUsageLimits,
  updateUsageLimits
} from "@/lib/usage-limits";

export const runtime = "nodejs";

/** 只接受 JSON number(前端本就发 number)——不做字符串 coerce,防止空串被 Number() 成 0。 */
function parseIntField(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

export async function GET() {
  await requireAdmin();
  try {
    return NextResponse.json(await getUsageLimits());
  } catch (error) {
    return respondError(error, { context: "settings.usageLimits.GET", fallbackStatus: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: { dailyGenerationLimit?: number; maxGenerationConcurrency?: number } = {};
    if (body.dailyGenerationLimit !== undefined) {
      const limit = parseIntField(body.dailyGenerationLimit, 0, DAILY_GENERATION_LIMIT_MAX);
      if (limit === null) {
        return NextResponse.json(
          { error: `每日上限必须是 0~${DAILY_GENERATION_LIMIT_MAX} 的整数(0 = 不限)` },
          { status: 400 }
        );
      }
      patch.dailyGenerationLimit = limit;
    }
    if (body.maxGenerationConcurrency !== undefined) {
      const concurrency = parseIntField(body.maxGenerationConcurrency, 1, MAX_GENERATION_CONCURRENCY_MAX);
      if (concurrency === null) {
        return NextResponse.json(
          { error: `并发数必须是 1~${MAX_GENERATION_CONCURRENCY_MAX} 的整数` },
          { status: 400 }
        );
      }
      patch.maxGenerationConcurrency = concurrency;
    }
    if (patch.dailyGenerationLimit === undefined && patch.maxGenerationConcurrency === undefined) {
      return NextResponse.json({ error: "请提供要修改的设置项" }, { status: 400 });
    }

    const previous = await getUsageLimits();
    const updated = await updateUsageLimits({ ...patch, userId: user.id });
    await writeAuditLog({
      user,
      request,
      action: "修改用量限制",
      targetType: "usage_limits",
      detail: {
        ...(patch.dailyGenerationLimit !== undefined
          ? { dailyGenerationLimit: { from: previous.dailyGenerationLimit, to: updated.dailyGenerationLimit } }
          : {}),
        ...(patch.maxGenerationConcurrency !== undefined
          ? { maxGenerationConcurrency: { from: previous.maxGenerationConcurrency, to: updated.maxGenerationConcurrency } }
          : {})
      }
    });
    return NextResponse.json(updated);
  } catch (error) {
    return respondError(error, { context: "settings.usageLimits.PATCH", fallbackStatus: 400 });
  }
}
