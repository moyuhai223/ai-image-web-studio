import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getDataBackupFile } from "@/lib/data-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string) {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ filename: string }> }) {
  await requireAdmin();

  const { filename } = await context.params;
  const file = await getDataBackupFile(filename).catch(() => null);
  if (!file) {
    return NextResponse.json({ error: "备份文件不存在" }, { status: 404 });
  }

  return new NextResponse(Readable.toWeb(createReadStream(file.fullPath)) as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": "application/gzip",
      "content-length": String(file.byteSize),
      "content-disposition": contentDisposition(file.filename),
      "cache-control": "private, no-store"
    }
  });
}
