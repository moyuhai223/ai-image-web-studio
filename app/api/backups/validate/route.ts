import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { ApiError, respondError } from "@/lib/api-errors";
import { listDataBackups, validateDataBackup, validateUploadedDataBackup } from "@/lib/data-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function validateFromJson(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { filename?: unknown };
  if (typeof body.filename !== "string") {
    throw new ApiError("请选择要校验的备份文件", 400);
  }
  return {
    validation: await validateDataBackup(body.filename),
    uploadedFilename: null
  };
}

async function validateFromUpload(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ApiError("请选择要上传校验的 .tar.gz 备份包", 400);
  }

  const result = await validateUploadedDataBackup(file);
  return {
    validation: result.validation,
    uploadedFilename: result.filename
  };
}

export async function POST(request: Request) {
  const user = await requireAdmin();

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const result = contentType.includes("multipart/form-data")
      ? await validateFromUpload(request)
      : await validateFromJson(request);
    await writeAuditLog({
      user,
      request,
      action: "校验数据备份",
      targetType: "backup",
      targetId: result.validation.filename,
      detail: {
        uploaded: Boolean(result.uploadedFilename),
        warnings: result.validation.warnings.length
      }
    });
    const backups = await listDataBackups();
    return NextResponse.json({ ...result, backups }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return respondError(error, { context: "backups.validate.POST", fallbackStatus: 400 });
  }
}
