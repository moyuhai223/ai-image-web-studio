import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import {
  createModelGroup,
  deleteModelGroup,
  listModelGroups,
  setDefaultModelGroup,
  updateModelGroup
} from "@/lib/model-groups";

export const runtime = "nodejs";

export async function GET() {
  await requireAdmin();
  try {
    return NextResponse.json({ groups: await listModelGroups() });
  } catch (error) {
    return respondError(error, { context: "settings.model-groups.GET", fallbackStatus: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.name !== "string" || typeof body.baseUrl !== "string" || typeof body.apiKey !== "string") {
      return NextResponse.json({ error: "请填写模型组名称、Base URL 和 API Key" }, { status: 400 });
    }
    const group = await createModelGroup({
      name: body.name,
      baseUrl: body.baseUrl,
      models: body.models,
      apiKey: body.apiKey,
      isDefault: body.isDefault === true,
      enabled: body.enabled !== false,
      userId: user.id
    });
    // 审计详情绝不含 key
    await writeAuditLog({
      user,
      request,
      action: "新增模型组",
      targetType: "model_group",
      targetId: group.id,
      detail: { name: group.name, baseUrl: group.baseUrl, models: group.models.map((m) => m.value), isDefault: group.isDefault }
    });
    return NextResponse.json(group);
  } catch (error) {
    return respondError(error, { context: "settings.model-groups.POST", fallbackStatus: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "请选择要更新的模型组" }, { status: 400 });
    }

    if (body.action === "set-default") {
      const group = await setDefaultModelGroup({ id: body.id, userId: user.id });
      await writeAuditLog({
        user,
        request,
        action: "设为默认模型组",
        targetType: "model_group",
        targetId: body.id,
        detail: { name: group.name }
      });
      return NextResponse.json(group);
    }

    const group = await updateModelGroup({
      id: body.id,
      name: typeof body.name === "string" ? body.name : undefined,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
      models: body.models,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      userId: user.id
    });
    await writeAuditLog({
      user,
      request,
      action: "更新模型组",
      targetType: "model_group",
      targetId: body.id,
      detail: {
        name: group.name,
        baseUrl: group.baseUrl,
        models: group.models.map((m) => m.value),
        enabled: group.enabled,
        keyChanged: typeof body.apiKey === "string" && body.apiKey.trim().length > 0
      }
    });
    return NextResponse.json(group);
  } catch (error) {
    return respondError(error, { context: "settings.model-groups.PATCH", fallbackStatus: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "请选择要删除的模型组" }, { status: 400 });
    }
    const groups = await deleteModelGroup({ id: body.id, userId: user.id });
    await writeAuditLog({ user, request, action: "删除模型组", targetType: "model_group", targetId: body.id });
    return NextResponse.json({ groups });
  } catch (error) {
    return respondError(error, { context: "settings.model-groups.DELETE", fallbackStatus: 400 });
  }
}
