// 纯尺寸计算工具(不依赖 sharp,故客户端与服务端都可安全 import)。
// gpt-image-2 的约束:长边 ≤ 3840、宽高均为 16 的倍数、宽高比 1:3~3:1、总像素 ≤ ~8.3MP。

export const IMAGE_MAX_PIXELS = 8_294_400; // ~8.3MP,gpt-image-2 4K 像素预算
export const IMAGE_MAX_LONG_EDGE = 3840;
const IMAGE_MIN_EDGE = 256;

function floorTo16(value: number) {
  return Math.max(IMAGE_MIN_EDGE, Math.floor(value / 16) * 16);
}

/**
 * 把请求尺寸「自动裁剪」成合规值:宽高都取 16 的倍数、长边 ≤ maxLongEdge、
 * 宽高比夹在 1:3~3:1、总像素 ≤ IMAGE_MAX_PIXELS。"auto" 原样返回,非法输入回退 1024x1024。
 */
export function normalizeImageSize(raw: string | null | undefined, maxLongEdge: number = IMAGE_MAX_LONG_EDGE): string {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "auto") return "auto";

  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value);
  if (!match) return "1024x1024";

  let w = Number(match[1]);
  let h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return "1024x1024";

  // 1) 夹宽高比到 1:3 ~ 3:1
  if (w / h > 3) w = h * 3;
  if (h / w > 3) h = w * 3;

  // 2) 夹长边
  const cap = Math.min(Math.max(16, Math.trunc(maxLongEdge)), IMAGE_MAX_LONG_EDGE);
  const longEdge = Math.max(w, h);
  if (longEdge > cap) {
    const k = cap / longEdge;
    w *= k;
    h *= k;
  }

  // 3) 夹像素预算
  const pixels = w * h;
  if (pixels > IMAGE_MAX_PIXELS) {
    const k = Math.sqrt(IMAGE_MAX_PIXELS / pixels);
    w *= k;
    h *= k;
  }

  return `${floorTo16(w)}x${floorTo16(h)}`;
}

/**
 * 按源图宽高比算一个尽量接近 longEdge 的合规 4K 尺寸(用于 AI 高清化的原生 4K 请求)。
 * 先把长边放大到 longEdge,再交给 normalizeImageSize 统一夹 /16 + 像素预算。
 */
export function computeUpscaleSize(width: number, height: number, longEdge: number = IMAGE_MAX_LONG_EDGE): string {
  const w0 = Math.max(1, Math.trunc(width));
  const h0 = Math.max(1, Math.trunc(height));
  const scale = Math.min(Math.max(16, Math.trunc(longEdge)), IMAGE_MAX_LONG_EDGE) / Math.max(w0, h0);
  return normalizeImageSize(`${Math.round(w0 * scale)}x${Math.round(h0 * scale)}`, longEdge);
}

// 分辨率档位角标(缩略图右下角):按「实际像素长边」归档。
// 2880 是本项目最小的 4K 档(1:1 4K = 2880×2880)长边;高清化结果长边 3840 也落 4K。
// 1600 让常见大图(如 1824×1024)落 2K;≤1024 等不显示角标(返回 null)。
// 注意:必须用图片真实 width/height,不能用 job.size —— AI 高清化的 job.size 仍是源尺寸。
export type ResolutionTier = "4K" | "2K";
const RESOLUTION_TIER_4K = 2880;
const RESOLUTION_TIER_2K = 1600;

export function resolutionTier(width?: number | null, height?: number | null): ResolutionTier | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const longEdge = Math.max(width, height);
  if (longEdge >= RESOLUTION_TIER_4K) return "4K";
  if (longEdge >= RESOLUTION_TIER_2K) return "2K";
  return null;
}
