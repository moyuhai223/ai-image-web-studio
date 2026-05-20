import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { deleteReferenceImage, getReferenceImageById, listUnusedReferenceImages, listReferenceImagesWithUsage, mergeDuplicateReferences } from "@/lib/repository";
import { deleteStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireAdmin();
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(searchParams.get("pageSize")) || 24));
  const result = await listReferenceImagesWithUsage(page, pageSize);
  return NextResponse.json({
    images: result.rows,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize
  });
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();

  let body: { id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (body.action === "merge_duplicates") {
    const result = await mergeDuplicateReferences();
    const errors: string[] = [];
    for (const filePath of result.removedPaths) {
      try {
        await deleteStoredFile(filePath);
      } catch {
        errors.push(filePath);
      }
    }
    await writeAuditLog({
      user,
      request,
      action: "合并重复参考图",
      targetType: "reference_image",
      detail: { merged: result.merged, removedPaths: result.removedPaths.length, errors: errors.length }
    });
    return NextResponse.json({
      ok: true,
      merged: result.merged,
      filesRemoved: result.removedPaths.length - errors.length,
      errors: errors.length
    });
  }

  if (body.action === "cleanup_unused") {
    const unused = await listUnusedReferenceImages();
    let deleted = 0;
    const errors: string[] = [];
    for (const row of unused.rows) {
      try {
        await deleteStoredFile(row.local_path);
        await deleteReferenceImage(row.id);
        deleted += 1;
      } catch {
        errors.push(row.local_path);
      }
    }
    await writeAuditLog({
      user,
      request,
      action: "清理未使用参考图",
      targetType: "reference_image",
      detail: { deleted, errors: errors.length }
    });
    return NextResponse.json({ ok: true, deleted, errors: errors.length });
  }

  const id = body.id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "缺少参考图 ID" }, { status: 400 });
  }

  const image = await getReferenceImageById(id);
  if (!image) {
    return NextResponse.json({ error: "参考图不存在" }, { status: 404 });
  }

  await deleteStoredFile(image.local_path);
  await deleteReferenceImage(id);
  await writeAuditLog({
    user,
    request,
    action: "删除参考图",
    targetType: "reference_image",
    targetId: id,
    detail: { localPath: image.local_path }
  });
  return NextResponse.json({ ok: true });
}
