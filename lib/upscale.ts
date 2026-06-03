import sharp from "sharp";

export const UPSCALE_DEFAULT_LONG_EDGE = 3840;

export type UpscaledImage = {
  buffer: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
};

/**
 * 把图片放大(或缩放)到「长边 = longEdge」,保持宽高比,输出无损 PNG。
 * 用 sharp 的高质量插值 + 适度锐化。4K 高清化的「快速放大」与 AI 重绘后的
 * 「4K 收尾」共用此函数;sharp 已是项目依赖(参考图预处理、缩略图都在用)。
 */
export async function upscaleBufferToLongEdge(
  buffer: Buffer,
  longEdge: number = UPSCALE_DEFAULT_LONG_EDGE
): Promise<UpscaledImage> {
  const target = Math.max(16, Math.trunc(longEdge));
  const result = await sharp(buffer)
    .rotate()
    .resize({ width: target, height: target, fit: "inside", withoutEnlargement: false })
    .sharpen()
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: result.data,
    mimeType: "image/png",
    width: result.info.width,
    height: result.info.height
  };
}

/**
 * 兜底:若图片长边已达 longEdge 的 ~95%(模型已原生出到目标分辨率),返回 null 表示无需处理,
 * 保留原生质量(不重新编码/锐化);否则 sharp 放大到 longEdge。
 */
export async function ensureLongEdge(buffer: Buffer, longEdge: number): Promise<UpscaledImage | null> {
  const meta = await sharp(buffer).metadata().catch(() => null);
  const current = Math.max(meta?.width ?? 0, meta?.height ?? 0);
  if (current >= Math.floor(longEdge * 0.95)) return null;
  return upscaleBufferToLongEdge(buffer, longEdge);
}
