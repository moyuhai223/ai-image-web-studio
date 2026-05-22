import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { ApiError, respondError } from "@/lib/api-errors";
import { listDataBackups, restoreDataBackup, saveUploadedDataBackup } from "@/lib/data-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function restoreFromJson(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { filename?: unknown };
  if (typeof body.filename !== "string") {
    throw new ApiError("请选择要恢复的备份文件", 400);
  }
  return restoreDataBackup(body.filename);
}

async function restoreFromUpload(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ApiError("请选择要上传恢复的 .tar.gz 备份包", 400);
  }
  const filename = await saveUploadedDataBackup(file);
  return restoreDataBackup(filename);
}

export async function POST(request: Request) {
  const user = await requireAdmin();

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const result = contentType.includes("multipart/form-data")
      ? await restoreFromUpload(request)
      : await restoreFromJson(request);
    await writeAuditLog({
      user,
      request,
      action: "恢复数据备份",
      targetType: "backup",
      targetId: result.restoredFrom,
      detail: {
        safetyBackup: result.safetyBackup.filename,
        fileCount: result.fileCount,
        fileBytes: result.fileBytes
      }
    });
    const backups = await listDataBackups();
    return NextResponse.json({ result, backups }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "backups.restore.POST" });
  }
}
