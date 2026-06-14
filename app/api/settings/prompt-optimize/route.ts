import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import {
  getPromptOptimizeSettings,
  updatePromptOptimizeSettings,
  OPTIMIZE_MODEL_MAX_LENGTH,
  OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH
} from "@/lib/prompt-optimize-settings";

export const runtime = "nodejs";

export async function GET() {
  await requireAdmin();
  try {
    const settings = await getPromptOptimizeSettings();
    return NextResponse.json(settings);
  } catch (error) {
    return respondError(error, { context: "settings.promptOptimize.GET", fallbackStatus: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: { enabled?: boolean; model?: string; systemPrompt?: string; userId: string } = { userId: user.id };

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled 必须是布尔值" }, { status: 400 });
      }
      patch.enabled = body.enabled;
    }
    if (body.model !== undefined) {
      if (typeof body.model !== "string" || !body.model.trim()) {
        return NextResponse.json({ error: "请输入文本模型名称" }, { status: 400 });
      }
      if (body.model.trim().length > OPTIMIZE_MODEL_MAX_LENGTH) {
        return NextResponse.json({ error: `模型名称不能超过 ${OPTIMIZE_MODEL_MAX_LENGTH} 个字符` }, { status: 400 });
      }
      patch.model = body.model;
    }
    if (body.systemPrompt !== undefined) {
      if (typeof body.systemPrompt !== "string" || !body.systemPrompt.trim()) {
        return NextResponse.json({ error: "预设提示词不能为空" }, { status: 400 });
      }
      if (body.systemPrompt.trim().length > OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH) {
        return NextResponse.json({ error: `预设提示词不能超过 ${OPTIMIZE_SYSTEM_PROMPT_MAX_LENGTH} 个字符` }, { status: 400 });
      }
      patch.systemPrompt = body.systemPrompt;
    }

    const settings = await updatePromptOptimizeSettings(patch);
    await writeAuditLog({
      user,
      request,
      action: "更新提示词优化设置",
      targetType: "prompt_optimize_settings",
      detail: { enabled: settings.enabled, model: settings.model }
    });

    return NextResponse.json(settings);
  } catch (error) {
    return respondError(error, { context: "settings.promptOptimize.PATCH", fallbackStatus: 400 });
  }
}
