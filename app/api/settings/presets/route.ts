import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import {
  createProviderPreset,
  deleteProviderPreset,
  getProviderSettings,
  setDefaultProviderPreset,
  updateProviderPreset
} from "@/lib/provider-settings";

export const runtime = "nodejs";

export async function GET() {
  await requireAdmin();
  try {
    const settings = await getProviderSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return respondError(error, { context: "settings.presets.GET", fallbackStatus: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.name !== "string" || typeof body.baseUrl !== "string") {
      return NextResponse.json({ error: "请填写 Preset 名称和 Base URL" }, { status: 400 });
    }

    const result = await createProviderPreset({
      name: body.name,
      baseUrl: body.baseUrl,
      isDefault: body.isDefault === true,
      userId: user.id
    });

    await writeAuditLog({
      user,
      request,
      action: "新增 Provider Preset",
      targetType: "provider_preset",
      targetId: result.preset.id,
      detail: { name: result.preset.name, baseUrl: result.preset.baseUrl, isDefault: result.preset.isDefault }
    });
    return NextResponse.json(result.summary);
  } catch (error) {
    return respondError(error, { context: "settings.presets.POST", fallbackStatus: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "请选择要更新的 Preset" }, { status: 400 });
    }

    if (body.action === "set-default") {
      const result = await setDefaultProviderPreset({ id: body.id, userId: user.id });
      await writeAuditLog({
        user,
        request,
        action: "设为默认 Provider Preset",
        targetType: "provider_preset",
        targetId: body.id,
        detail: { name: result.preset.name }
      });
      return NextResponse.json(result.summary);
    }

    if (typeof body.name !== "string" && typeof body.baseUrl !== "string") {
      return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
    }

    const result = await updateProviderPreset({
      id: body.id,
      name: typeof body.name === "string" ? body.name : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      userId: user.id
    });
    await writeAuditLog({
      user,
      request,
      action: "更新 Provider Preset",
      targetType: "provider_preset",
      targetId: body.id,
      detail: { name: result.preset.name, baseUrl: result.preset.baseUrl }
    });
    return NextResponse.json(result.summary);
  } catch (error) {
    return respondError(error, { context: "settings.presets.PATCH", fallbackStatus: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "请选择要删除的 Preset" }, { status: 400 });
    }

    const summary = await deleteProviderPreset({ id: body.id, userId: user.id });
    await writeAuditLog({
      user,
      request,
      action: "删除 Provider Preset",
      targetType: "provider_preset",
      targetId: body.id
    });
    return NextResponse.json(summary);
  } catch (error) {
    return respondError(error, { context: "settings.presets.DELETE", fallbackStatus: 400 });
  }
}
