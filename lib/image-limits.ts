import sharp from "sharp";

/**
 * 处理用户上传/上游返回图片时的最大解码像素数。sharp 默认上限 268MP,一张 ~16000×16000 的高压缩 PNG
 * (文件才几百 KB、能过字节/MIME 闸)解码时单张 RGBA 峰值可达 ~1GB,叠加并发即打爆内存(OOM DoS)。
 * 4000 万像素约 8000×5000,足够覆盖合法参考图/4K 需求,又能挡住解压炸弹。
 */
export const MAX_INPUT_PIXELS = 40_000_000;

/**
 * 统一入口:所有解码「非受信来源图片」(用户上传参考图、上游返回图、待缩略图等)的 sharp 调用都应走这里,
 * 强制带 limitInputPixels,避免遗漏某个入口导致超大像素图 OOM。第二参数可继续透传 raw/failOn 等 sharp 选项。
 */
export function boundedSharp(input: Parameters<typeof sharp>[0], options?: Parameters<typeof sharp>[1]) {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, ...options });
}
