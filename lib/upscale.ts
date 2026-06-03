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

// gpt-image-2 的 4K 像素预算(约 8.3MP);超过会被模型自动降采样。
export const UPSCALE_MAX_PIXELS = 8_294_400;

function roundDownTo16(value: number) {
  return Math.max(16, Math.floor(value / 16) * 16);
}

/**
 * 按源图宽高比算一个尽量接近 longEdge 的「原生 4K」尺寸字符串(WxH),满足 gpt-image-2 约束:
 * 长边 ≤ longEdge(≤3840)、宽高均为 16 的倍数、总像素 ≤ UPSCALE_MAX_PIXELS(向下取整以稳妥落在预算内)。
 * 例:1024×1024 → 2880x2880;1024×576 → 3840x2160。
 */
export function computeUpscaleSize(width: number, height: number, longEdge: number = UPSCALE_DEFAULT_LONG_EDGE): string {
  const w0 = Math.max(1, Math.trunc(width));
  const h0 = Math.max(1, Math.trunc(height));
  const cap = Math.min(Math.max(16, Math.trunc(longEdge)), 3840);
  const scale = cap / Math.max(w0, h0);
  let w = w0 * scale;
  let h = h0 * scale;
  const pixels = w * h;
  if (pixels > UPSCALE_MAX_PIXELS) {
    const k = Math.sqrt(UPSCALE_MAX_PIXELS / pixels);
    w *= k;
    h *= k;
  }
  return `${roundDownTo16(w)}x${roundDownTo16(h)}`;
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
