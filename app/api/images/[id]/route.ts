import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isIfRangeSatisfied, parseByteRangeHeader } from "@/lib/http-range";
import { getImageForUser } from "@/lib/repository";
import { readOrCreateThumbnail, statStoredFile, streamStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const thumbnail = searchParams.get("thumb") === "1";
  const image = await getImageForUser(id, user);

  if (!image) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }

  const file = thumbnail ? await readOrCreateThumbnail(image.local_path) : null;
  const stats = file?.stats ?? await statStoredFile(image.local_path);
  const contentType = thumbnail ? "image/webp" : image.mime_type;
  const cacheControl = thumbnail ? "private, max-age=604800, immutable" : "private, max-age=3600";
  const etag = thumbnail
    ? `W/"thumb-${image.id}-${stats.size}-${Math.round(stats.mtimeMs)}"`
    : `"${image.checksum}"`;
  const lastModified = stats.mtime.toUTCString();

  if (request.headers.get("if-none-match") === etag || request.headers.get("if-modified-since") === lastModified) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        etag,
        "last-modified": lastModified,
        "cache-control": cacheControl
      }
    });
  }

  if (!thumbnail && isIfRangeSatisfied(request.headers.get("if-range"), etag, lastModified)) {
    const rangeResult = parseByteRangeHeader(request.headers.get("range"), stats.size);
    if (rangeResult.kind === "invalid") {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes */${stats.size}`,
          "cache-control": cacheControl,
          etag,
          "last-modified": lastModified
        }
      });
    }
    if (rangeResult.kind === "range") {
      return new NextResponse(streamStoredFile(image.local_path, rangeResult.range), {
        status: 206,
        headers: {
          "content-type": contentType,
          "content-length": String(rangeResult.range.length),
          "content-range": rangeResult.range.contentRange,
          "accept-ranges": "bytes",
          "cache-control": cacheControl,
          etag,
          "last-modified": lastModified
        }
      });
    }
  }

  return new NextResponse(file ? file.buffer : streamStoredFile(image.local_path), {
    headers: {
      "content-type": contentType,
      "content-length": String(stats.size),
      "cache-control": cacheControl,
      ...(!thumbnail ? { "accept-ranges": "bytes" } : {}),
      etag,
      "last-modified": lastModified
    }
  });
}
