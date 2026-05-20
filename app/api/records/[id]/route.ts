import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { deleteJobWithGeneratedImages } from "@/lib/generated-image-cleanup";
import { getJobById } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const job = await getJobById(id, user);
  if (!job) {
    return NextResponse.json({ error: "记录不存在或无权访问" }, { status: 404 });
  }

  return NextResponse.json({ job }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const result = await deleteJobWithGeneratedImages(id, user);

  if (!result) {
    return NextResponse.json({ error: "记录不存在或无权删除" }, { status: 404 });
  }
  if (result.status === "blocked") {
    return NextResponse.json({ error: "运行中或排队中的任务请先取消，完成后再删除" }, { status: 409 });
  }
  if (result.status === "file_error" || result.status === "image_records_remaining") {
    return NextResponse.json(
      {
        error: "图片文件删除失败，数据库记录已保留，可稍后重试",
        ...result.cleanup
      },
      { status: 500 }
    );
  }

  await writeAuditLog({
    user,
    request,
    action: "删除生成记录",
    targetType: "generation_job",
    targetId: id,
    detail: result.cleanup
  });
  return NextResponse.json({ ok: true, ...result.cleanup });
}
