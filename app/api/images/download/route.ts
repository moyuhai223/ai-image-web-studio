import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { respondError } from "@/lib/api-errors";
import { listImagesForDownload } from "@/lib/repository";
import { readStoredFile } from "@/lib/storage";
import { createZipStream } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((v): v is string => typeof v === "string" && UUID_RE.test(v)))).slice(0, 100);
}

function extFromMime(mime: string): string {
  if (/png/i.test(mime)) return "png";
  if (/webp/i.test(mime)) return "webp";
  if (/jpe?g/i.test(mime)) return "jpg";
  if (/gif/i.test(mime)) return "gif";
  return "img";
}

// 批量下载所选图片为一个 ZIP。imageIds(收藏页单图)和/或 jobIds(记录页整条记录的图片)。
export async function POST(request: Request) {
  const user = await requireUser();

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const imageIds = parseIds(body.imageIds);
    const jobIds = parseIds(body.jobIds);
    if (imageIds.length === 0 && jobIds.length === 0) {
      return NextResponse.json({ error: "请先选择要下载的图片" }, { status: 400 });
    }

    const rows = await listImagesForDownload({ imageIds, jobIds }, user);
    if (rows.length === 0) {
      return NextResponse.json({ error: "没有可下载的图片(可能无权限或已被删除)" }, { status: 404 });
    }

    // mode=list:不打包,只返回 owned 图片 id 列表,客户端逐张走 /api/images/{id}/download 下载原图。
    if (body.mode === "list") {
      return NextResponse.json({ ids: rows.map((row) => row.id) }, { headers: { "cache-control": "no-store" } });
    }

    const entries = rows.map((row, index) => ({
      name: `${String(index + 1).padStart(3, "0")}-${row.id.slice(0, 8)}.${extFromMime(row.mime_type)}`,
      getData: async () => (await readStoredFile(row.local_path)).buffer
    }));

    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const filename = `ai-image-studio-${stamp}.zip`;

    return new Response(createZipStream(entries), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    return respondError(error, { context: "images.download.POST", fallbackStatus: 500 });
  }
}
