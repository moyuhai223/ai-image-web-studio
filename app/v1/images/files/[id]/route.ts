import { NextResponse } from "next/server";
import { openAiError, verifySignedImageQuery } from "@/lib/api-key-auth";
import { getImageById } from "@/lib/repository";
import { statStoredFile, streamStoredFile } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * 对外 API(response_format=url)的签名图片下载:免登录,仅验 HMAC 限时签名。
 * 签名由 /v1/images/generations 成功响应生成(持有效 API Key 才拿得到),即授权凭证。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  if (!verifySignedImageQuery(id, searchParams.get("exp"), searchParams.get("sig"))) {
    return openAiError(403, "链接无效或已过期", "invalid_signature");
  }

  const image = await getImageById(id);
  if (!image) {
    return openAiError(404, "图片不存在", "not_found");
  }

  const stats = await statStoredFile(image.local_path).catch(() => null);
  if (!stats) {
    return openAiError(404, "图片文件不存在", "not_found");
  }

  return new NextResponse(streamStoredFile(image.local_path), {
    status: 200,
    headers: {
      "content-type": image.mime_type,
      "content-length": String(stats.size),
      "cache-control": "private, max-age=3600"
    }
  });
}
