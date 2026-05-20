import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { setProviderBaseUrl } from "@/lib/provider-settings";

export const runtime = "nodejs";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败";
}

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
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
