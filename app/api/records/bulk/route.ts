import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import { deleteJobWithGeneratedImages, type DeleteJobCleanupResult } from "@/lib/generated-image-cleanup";
import { createLogger } from "@/lib/logger";
import { addTagsToJobsForUser, normalizeImageTags } from "@/lib/repository";

const log = createLogger("records.bulk");

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

    // v0.6.1: 每项独立 try/catch,防止单条抛错导致整批 500 + 客户端
     //  丢失已删除项的可见性。deleteJobWithGeneratedImages 内部已经是
     //  「文件清理→事务删 job 记录」,本身原子性已经够;这里只需保证
     //  批量循环不会因为一项异常就把后面 N-1 项的结果也丢掉。
    const results: Array<{ id: string; result: DeleteJobCleanupResult | null; errored: boolean }> = [];
    for (const id of ids) {
      try {
        const result = await deleteJobWithGeneratedImages(id, user);
        results.push({ id, result, errored: false });
      } catch (error) {
        log.warn("Bulk delete: single job threw, continuing with rest", { id, error });
        results.push({ id, result: null, errored: true });
      }
    }

    const deleted = results.filter((item) => item.result?.status === "deleted").length;
    const blocked = results.filter((item) => item.result?.status === "blocked").length;
    const missing = results.filter((item) => !item.errored && !item.result).length;
    const errored = results.filter((item) => item.errored).length;
    const failed = results.length - deleted - blocked - missing - errored;

    await writeAuditLog({
      user,
      request,
      action: "批量删除生成记录",
      targetType: "generation_job",
      detail: { requested: ids.length, deleted, blocked, missing, failed, errored }
    });
    return NextResponse.json(
      {
        ok: failed === 0 && errored === 0,
        deleted,
        blocked,
        missing,
        failed,
        errored
      },
      { status: failed === 0 && errored === 0 ? 200 : 207, headers: { "cache-control": "no-store" } }
    );
  } catch (error) {
    return respondError(error, { context: "records.bulk.POST" });
  }
}
