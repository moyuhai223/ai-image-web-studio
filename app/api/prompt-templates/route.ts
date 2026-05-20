import { NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { createPromptTemplate, deletePromptTemplate, listPromptTemplates, updatePromptTemplate } from "@/lib/prompt-templates";
import { deletePromptTemplateSchema, promptTemplateSchema, updatePromptTemplateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validationError(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: Array<{ message?: string }> }).issues;
    return issues?.[0]?.message ?? "参数无效";
  }
  return error instanceof Error ? error.message : "操作失败";
}

export async function GET() {
  await requireUser();
  const templates = await listPromptTemplates();
  return NextResponse.json({ templates }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await requireAdmin();

  try {
    const parsed = promptTemplateSchema.parse(await request.json().catch(() => ({})));
    const template = await createPromptTemplate({
      ...parsed,
      userId: user.id
    });
    await writeAuditLog({
      user,
      request,
      action: "新增提示词模板",
      targetType: "prompt_template",
      targetId: template.id,
      detail: { title: template.title, category: template.category }
    });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: validationError(error) }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();

  try {
    const parsed = updatePromptTemplateSchema.parse(await request.json().catch(() => ({})));
    const template = await updatePromptTemplate(parsed);
    if (!template) {
      return NextResponse.json({ error: "模板不存在" }, { status: 404 });
    }
    await writeAuditLog({
      user,
      request,
      action: "更新提示词模板",
      targetType: "prompt_template",
      targetId: template.id,
      detail: { title: template.title, category: template.category }
    });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json({ error: validationError(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();

  try {
    const parsed = deletePromptTemplateSchema.parse(await request.json().catch(() => ({})));
    const ok = await deletePromptTemplate(parsed.id);
    if (!ok) {
      return NextResponse.json({ error: "模板不存在" }, { status: 404 });
    }
    await writeAuditLog({
      user,
      request,
      action: "删除提示词模板",
      targetType: "prompt_template",
      targetId: parsed.id
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: validationError(error) }, { status: 400 });
  }
}
