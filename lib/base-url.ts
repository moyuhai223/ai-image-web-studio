function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

// app 自身会往 baseUrl 后面拼 /v1/...(如 /v1/images/generations)。若用户把 baseUrl 填成
// https://host/v1,会变成双 /v1 → 404。这里容错:剥掉结尾的 /v1,使填不填 /v1 都能用。
function stripTrailingApiVersion(value: string) {
  return value.replace(/\/v1$/i, "");
}

/** 校验并归一化 Provider / 模型组的 Base URL:仅 http/https,剥掉结尾的 / 和 /v1。非法即抛。 */
export function normalizeAiBaseUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Provider Base URL 格式不正确");
  }

  const trimmed = stripTrailingSlash(value.trim());
  if (!trimmed) {
    throw new Error("Provider Base URL 不能为空");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Provider Base URL 不是有效的网址");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Provider Base URL 仅支持 http 或 https");
  }

  return stripTrailingApiVersion(stripTrailingSlash(url.toString()));
}
