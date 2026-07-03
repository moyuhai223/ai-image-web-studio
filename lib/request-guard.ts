import { config } from "./config";

/**
 * 请求体总大小早退检查:multipart 的 request.formData() 会把整个 body 先缓冲进内存,
 * 且各路由的 file.size 校验只覆盖 File part(几百 MB 的文本字段可绕过)。这里在 formData() 前
 * 读 content-length 早退 413,防内存耗尽。反代层 client_max_body_size 是主要防线,本函数是应用层兜底。
 * content-length 缺失(分块传输)时无法预判,返回 false 交由后续逐 part 校验。
 */
export function requestBodyTooLarge(request: Request, maxBytes = config.maxRequestBodyMb * 1024 * 1024): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const len = Number(raw);
  return Number.isFinite(len) && len > maxBytes;
}

/**
 * CSRF 纵深防御:对状态变更请求做 Origin/Referer 同源校验。
 * 仅当配置了 config.appOrigin 时生效(避免反代改写 Host 误伤);未配置则恒放行——
 * 会话 cookie 的 sameSite=lax 是主要 CSRF 防线,本校验是可选加固。
 * 返回 true = 违规(应拒绝);false = 放行。
 */
export function crossOriginViolation(request: Request): boolean {
  const expected = config.appOrigin;
  if (!expected) return false; // 未配置 → 不校验

  const origin = request.headers.get("origin");
  if (origin) return normalizeOrigin(origin) !== expected;

  // 无 Origin(部分同源导航/老客户端):回退看 Referer;两者都无则放行(不误伤)
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return normalizeOrigin(new URL(referer).origin) !== expected;
  } catch {
    return true; // Referer 无法解析 → 保守拒绝
  }
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}
