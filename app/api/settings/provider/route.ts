import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import { setProviderBaseUrl } from "@/lib/provider-settings";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.aiBaseUrl !== "string") {
      return NextResponse.json({ error: "请输入 Provider Base URL" }, { status: 400 });
    }

    const settings = await setProviderBaseUrl({
      aiBaseUrl: body.aiBaseUrl,
      userId: user.id
    });
    await writeAuditLog({
      user,
      request,
      action: "更新 Provider Base URL",
      targetType: "provider_settings",
      detail: { aiBaseUrl: settings.aiBaseUrl }
    });

    return NextResponse.json(settings);
  } catch (error) {
    return respondError(error, { context: "settings.provider.PATCH", fallbackStatus: 400 });
  }
}
