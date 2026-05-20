import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { importAwesomeGptImagePrompts } from "@/lib/prompt-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireAdmin();
  const result = await importAwesomeGptImagePrompts(user.id);

  await writeAuditLog({
    user,
    request,
    action: "导入精选提示词库",
    targetType: "prompt_template",
    detail: {
      source: result.source.name,
      inserted: result.inserted,
      updated: result.updated,
      total: result.total
    }
  });

  return NextResponse.json(result);
}

