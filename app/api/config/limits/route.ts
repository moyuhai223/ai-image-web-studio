import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

/**
 * 给客户端提供运行时配置限制(参考图最大张数、允许的 mime、单张大小上限)。
 * 这些值在服务端从 env 读取,客户端不能直接 import lib/config(那是 Node-only)。
 *
 * 注意:此端点公开(无须登录),只暴露非敏感的限制值。
 */
export async function GET() {
  return NextResponse.json(
    {
      maxReferenceImages: config.maxReferenceImages,
      allowedImageMimes: config.allowedImageMimes,
      maxUploadMb: config.maxUploadMb
    },
    {
      headers: {
        "cache-control": "public, max-age=60"
      }
    }
  );
}
