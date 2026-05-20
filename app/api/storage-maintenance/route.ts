import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { cleanupFailedTaskImages, cleanupOrphanFiles, rebuildAllThumbnails, scanStorageMaintenance } from "@/lib/storage-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MaintenanceAction = "cleanup_orphans" | "rebuild_thumbnails" | "cleanup_failed_images";

function parseAction(value: unknown): MaintenanceAction | null {
  if (value === "cleanup_orphans" || value === "rebuild_thumbnails" || value === "cleanup_failed_images") return value;
  return null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "存储维护失败";
}

export async function GET() {
  await requireAdmin();

  try {
    const scan = await scanStorageMaintenance();
    return NextResponse.json({ scan }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireAdmin();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = parseAction(body.action);
    if (!action) {
      return NextResponse.json({ error: "维护动作无效" }, { status: 400 });
    }

    const result =
      action === "cleanup_orphans"
        ? await cleanupOrphanFiles()
        : action === "rebuild_thumbnails"
          ? await rebuildAllThumbnails()
          : await cleanupFailedTaskImages();

    await writeAuditLog({
      user,
      request,
      action: "执行存储维护",
      targetType: "storage",
      targetId: action,
      detail: result as Record<string, unknown>
    });
    return NextResponse.json({ result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
