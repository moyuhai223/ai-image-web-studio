import { NextResponse } from "next/server";
import path from "node:path";
import { requireUser } from "@/lib/auth";
import { isIfRangeSatisfied, parseByteRangeHeader } from "@/lib/http-range";
import { getImageForUser } from "@/lib/repository";
import { statStoredFile, streamStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await context.params;
  const image = await getImageForUser(id, user);

  if (!image) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }

  const stats = await statStoredFile(image.local_path);
  const etag = `"${image.checksum}"`;
  const lastModified = stats.mtime.toUTCString();
  const contentDisposition = `attachment; filename="${path.basename(image.local_path)}"`;

  if (isIfRangeSatisfied(request.headers.get("if-range"), etag, lastModified)) {
    const rangeResult = parseByteRangeHeader(request.headers.get("range"), stats.size);
    if (rangeResult.kind === "invalid") {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes */${stats.size}`,
          etag,
          "last-modified": lastModified
        }
      });
    }
    if (rangeResult.kind === "range") {
      return new NextResponse(streamStoredFile(image.local_path, rangeResult.range), {
        status: 206,
        headers: {
          "content-type": image.mime_type,
          "content-length": String(rangeResult.range.length),
          "content-range": rangeResult.range.contentRange,
          "accept-ranges": "bytes",
          "content-disposition": contentDisposition,
          etag,
          "last-modified": lastModified
        }
      });
    }
  }

  return new NextResponse(streamStoredFile(image.local_path), {
    headers: {
      "content-type": image.mime_type,
      "content-length": String(stats.size),
      "accept-ranges": "bytes",
      "content-disposition": contentDisposition,
      etag,
      "last-modified": lastModified
    }
  });
}
