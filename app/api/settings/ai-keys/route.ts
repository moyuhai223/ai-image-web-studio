import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { addAiKey, deleteAiKey, setAiKeyEnabled, setAiKeyFailurePolicy } from "@/lib/api-keys";

export const runtime = "nodejs";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败";
}

export async function POST(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.apiKey !== "string") {
      return NextResponse.json({ error: "请输入 AI Key" }, { status: 400 });
    }

    const settings = await addAiKey({
      apiKey: body.apiKey,
      label: typeof body.label === "string" ? body.label : undefined,
      userId: user.id
    });
    await writeAuditLog({
      user,
      request,
      action: "新增 AI Key",
      targetType: "ai_key",
      detail: { label: typeof body.label === "string" ? body.label : "" }
    });
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.id !== "string") {
      return NextResponse.json({ error: "请选择要删除的 Key" }, { status: 400 });
    }

    const settings = await deleteAiKey({ id: body.id, userId: user.id });
    await writeAuditLog({
      user,
      request,
      action: "删除 AI Key",
      targetType: "ai_key",
      targetId: body.id
    });
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "failure-policy") {
      if (typeof body.autoDisableEnabled !== "boolean" || typeof body.autoDisableFailureThreshold !== "number") {
        return NextResponse.json({ error: "失败策略参数无效" }, { status: 400 });
      }

      const settings = await setAiKeyFailurePolicy({
        autoDisableEnabled: body.autoDisableEnabled,
        autoDisableFailureThreshold: body.autoDisableFailureThreshold,
        userId: user.id
      });
      await writeAuditLog({
        user,
        request,
        action: "更新 Key 失败策略",
        targetType: "ai_key_policy",
        detail: {
          autoDisableEnabled: body.autoDisableEnabled,
          autoDisableFailureThreshold: body.autoDisableFailureThreshold
        }
      });
      return NextResponse.json(settings);
    }

    if (typeof body.id !== "string" || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "参数无效" }, { status: 400 });
    }

    const settings = await setAiKeyEnabled({ id: body.id, enabled: body.enabled, userId: user.id });
    await writeAuditLog({
      user,
      request,
      action: body.enabled ? "启用 AI Key" : "停用 AI Key",
      targetType: "ai_key",
      targetId: body.id
    });
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
