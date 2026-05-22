import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueGenerationJob, startGenerationQueue } from "@/lib/generation-queue";
import { requeueJobWithGeneratedImageCleanup } from "@/lib/generated-image-cleanup";
import { cancelJobForUser, getJobById } from "@/lib/repository";

export const runtime = "nodejs";

type ControlAction = "cancel" | "requeue";

function parseAction(value: unknown): ControlAction | null {
  return value === "cancel" || value === "requeue" ? value : null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = parseAction(body.action);

  if (!action) {
    return NextResponse.json({ error: "控制动作无效" }, { status: 400 });
  }

  if (action === "cancel") {
    const ok = await cancelJobForUser(id, user);
    if (!ok) {
      return NextResponse.json({ error: "记录不存在，或当前状态不能取消" }, { status: 409 });
    }
    await writeAuditLog({
      user,
      request,
      action: "取消生成任务",
      targetType: "generation_job",
      targetId: id
    });
    startGenerationQueue();
    const job = await getJobById(id, user);
    return NextResponse.json({ ok: true, job }, { headers: { "cache-control": "no-store" } });
  }

  const result = await requeueJobWithGeneratedImageCleanup(id, user);
  if (!result) {
    return NextResponse.json({ error: "记录不存在或无权操作" }, { status: 404 });
  }
  if (result.status === "invalid_state") {
    return NextResponse.json({ error: "当前状态不能重新排队" }, { status: 409 });
  }
  if (result.status === "file_error" || result.status === "image_records_remaining") {
    return NextResponse.json(
      {
        error: "旧图片删除失败，任务未重新排队，可稍后重试",
        ...result.cleanup
      },
      { status: 500 }
    );
  }

  enqueueGenerationJob(id);
  await writeAuditLog({
    user,
    request,
    action: "重新排队生成任务",
    targetType: "generation_job",
    targetId: id,
    detail: result.cleanup
  });
  const job = await getJobById(id, user);
  return NextResponse.json({ ok: true, job, ...result.cleanup }, { headers: { "cache-control": "no-store" } });
}
