import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { respondError } from "@/lib/api-errors";
import { addTagsToImagesForUser, normalizeImageTags, unfavoriteImagesForUser } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkAction = "add_tags" | "unfavorite";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && UUID_RE.test(item)))).slice(0, 100);
}

function parseAction(value: unknown): BulkAction | null {
  return value === "add_tags" || value === "unfavorite" ? value : null;
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
      return NextResponse.json({ error: "请先选择图片" }, { status: 400 });
    }

    if (action === "add_tags") {
      const tags = normalizeImageTags(body.tags);
      if (tags.length === 0) {
        return NextResponse.json({ error: "请输入要添加的标签" }, { status: 400 });
      }

      const result = await addTagsToImagesForUser(ids, tags, user);
      await writeAuditLog({
        user,
        request,
        action: "批量为收藏图片加标签",
        targetType: "generated_image",
        detail: { requested: ids.length, ...result }
      });
      return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
    }

    // unfavorite:只移除当前用户对这些图片的收藏关联,不动图片本身、不影响其他用户的收藏
    const result = await unfavoriteImagesForUser(ids, user);
    await writeAuditLog({
      user,
      request,
      action: "批量取消收藏",
      targetType: "generated_image",
      detail: { requested: ids.length, ...result }
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "favorites.bulk.POST" });
  }
}
