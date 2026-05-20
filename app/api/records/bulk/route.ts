import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { deleteJobWithGeneratedImages } from "@/lib/generated-image-cleanup";
import { addTagsToJobsForUser, normalizeImageTags } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkAction = "delete" | "add_tags";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && UUID_RE.test(item)))).slice(0, 100);
}

function parseAction(value: unknown): BulkAction | null {
  return value === "delete" || value === "add_tags" ? value : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "批量操作失败";
}

export async function POST(request: Request) {
  const user = await requireUser();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = parseAction(body.action);
    const ids = parseIds(body.ids);

    if (!action) {
      return NextResponse.json({ error: "批量动作无效" }, { status: 400 });
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: "请先选择记录" }, { status: 400 });
    }

    if (action === "add_tags") {
      const tags = normalizeImageTags(body.tags);
      if (tags.length === 0) {
        return NextResponse.json({ error: "请输入要添加的标签" }, { status: 400 });
      }

      const result = await addTagsToJobsForUser(ids, tags, user);
      await writeAuditLog({
        user,
        request,
        action: "批量添加图片标签",
        targetType: "generation_job",
        detail: { requested: ids.length, ...result }
      });
      return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
    }

    const results = [];
    for (const id of ids) {
      const result = await deleteJobWithGeneratedImages(id, user);
      results.push({ id, result });
    }

    const deleted = results.filter((item) => item.result?.status === "deleted").length;
    const blocked = results.filter((item) => item.result?.status === "blocked").length;
    const missing = results.filter((item) => !item.result).length;
    const failed = results.length - deleted - blocked - missing;

    await writeAuditLog({
      user,
      request,
      action: "批量删除生成记录",
      targetType: "generation_job",
      detail: { requested: ids.length, deleted, blocked, missing, failed }
    });
    return NextResponse.json(
      {
        ok: failed === 0,
        deleted,
        blocked,
        missing,
        failed
      },
      { status: failed === 0 ? 200 : 207, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
