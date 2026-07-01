import sharp from "sharp";
import { getNextAiApiKey, reportAiKeyFailure, reportAiKeySuccess } from "./api-keys";
import { config } from "./config";
import { createLogger } from "./logger";
import { getProviderSettings, resolveProvider } from "./provider-settings";
import { isRotatePreset } from "./provider-rotation";

const log = createLogger("provider");

// Provider 自动轮换:进程级轮询游标(单实例部署足够;重启归零无妨)。
let rotationCursor = 0;

export type ProviderImage = {
  b64?: string;
  url?: string;
  mimeType?: string;
};

export type ProviderResult = {
  requestId: string | null;
  keyId: string | null;
  keyLabel: string | null;
  keySource: "pool" | "env";
  baseUrl: string;
  presetId: string | null;
  presetName: string | null;
  images: ProviderImage[];
  raw: Record<string, unknown>;
};

export type ProviderSelectedInfo = {
  presetId: string | null;
  presetName: string | null;
  baseUrl: string;
};

export type ProviderRequestOptions = {
  presetId?: string | null;
  /** 真正向某个 Provider(preset)发起请求前回调;轮换 failover 时每个被尝试的 preset 都会回调一次。 */
  onProviderSelected?: (info: ProviderSelectedInfo) => void;
};

type ProviderPayloadResult = Omit<ProviderResult, "keyId" | "keyLabel" | "keySource" | "baseUrl" | "presetId" | "presetName">;

type ProviderDeadline = {
  expiresAt: number;
};

class ProviderTimeoutError extends Error {
  constructor() {
    super(`模型请求超过 ${Math.round(config.generationTimeoutMs / 60000)} 分钟未返回，已按失败处理`);
    this.name = "ProviderTimeoutError";
  }
}

type GenerateInput = {
  prompt: string;
  model: string;
  size: string;
  count: number;
  referenceDataUrl?: string;
  referenceDataUrls?: string[];
  /** 局部重绘蒙版(data URL,带 alpha:透明=要改)。仅编辑接口用,作用于第一张参考图。 */
  maskDataUrl?: string;
};

const MAX_KEY_ATTEMPTS = 3;
const IMAGE2_REFERENCE_MAX_SIDE = 1536;
const IMAGE2_REFERENCE_SAFE_BYTES = 4 * 1024 * 1024;
const IMAGE2_SUPPORTED_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

function extensionForReferenceMime(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function authHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`
  };
}

function createDeadline(): ProviderDeadline {
  return { expiresAt: Date.now() + config.generationTimeoutMs };
}

function remainingDeadlineMs(deadline: ProviderDeadline) {
  return deadline.expiresAt - Date.now();
}

function assertDeadline(deadline: ProviderDeadline) {
  if (remainingDeadlineMs(deadline) <= 0) {
    throw new ProviderTimeoutError();
  }
}

function isProviderTimeoutError(error: unknown) {
  return error instanceof Error && error.name === "ProviderTimeoutError";
}

function timeoutForDeadline(deadline: ProviderDeadline) {
  assertDeadline(deadline);
  return Math.max(1, remainingDeadlineMs(deadline));
}

async function postJson(pathname: string, body: Record<string, unknown>, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutForDeadline(deadline));

  let response: Response;
  let text: string;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted || remainingDeadlineMs(deadline) <= 0) {
      throw new ProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { text };
  }

  if (!response.ok) {
    const message =
      typeof json.error === "object" && json.error && "message" in json.error
        ? String((json.error as { message: unknown }).message)
        : `Provider request failed with ${response.status}`;
    const error = new Error(message);
    (error as Error & { status?: number; raw?: unknown }).status = response.status;
    (error as Error & { status?: number; raw?: unknown }).raw = json;
    throw error;
  }

  return json;
}

async function postForm(pathname: string, body: FormData, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutForDeadline(deadline));

  let response: Response;
  let text: string;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body,
      signal: controller.signal
    });
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted || remainingDeadlineMs(deadline) <= 0) {
      throw new ProviderTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { text };
  }

  if (!response.ok) {
    const message =
      typeof json.error === "object" && json.error && "message" in json.error
        ? String((json.error as { message: unknown }).message)
        : `Provider request failed with ${response.status}`;
    const error = new Error(message);
    (error as Error & { status?: number; raw?: unknown }).status = response.status;
    (error as Error & { status?: number; raw?: unknown }).raw = json;
    throw error;
  }

  return json;
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid reference image data URL");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function blobPartFromBuffer(buffer: Buffer) {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

async function prepareImage2Reference(dataUrl: string, index: number) {
  const reference = parseDataUrl(dataUrl);
  const originalMime = reference.mimeType.toLowerCase();
  const passthrough = () => ({
    buffer: reference.buffer,
    mimeType: IMAGE2_SUPPORTED_MIMES.has(originalMime) ? originalMime : "image/png",
    filename: `reference-${index + 1}.${extensionForReferenceMime(IMAGE2_SUPPORTED_MIMES.has(originalMime) ? originalMime : "image/png")}`
  });

  let metadata: sharp.Metadata | null = null;
  try {
    metadata = await sharp(reference.buffer).metadata();
  } catch (error) {
    log.warn("Image 2 参考图读取元信息失败，使用原文件", { ref: index + 1, error });
    if (IMAGE2_SUPPORTED_MIMES.has(originalMime)) return passthrough();
    throw new Error(`Image 2 参考图 ${index + 1} 预处理失败：${error instanceof Error ? error.message : "图片格式异常"}`);
  }

  const maxEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const needsResize = maxEdge > IMAGE2_REFERENCE_MAX_SIDE;
  const needsTranscode = !IMAGE2_SUPPORTED_MIMES.has(originalMime);
  const oversized = reference.buffer.byteLength > IMAGE2_REFERENCE_SAFE_BYTES;
  const needsRotate = Boolean(metadata.orientation && metadata.orientation > 1);

  if (!needsResize && !needsTranscode && !oversized && !needsRotate) {
    return passthrough();
  }

  try {
    const pipeline = sharp(reference.buffer).rotate();
    if (needsResize || oversized) {
      pipeline.resize({
        width: IMAGE2_REFERENCE_MAX_SIDE,
        height: IMAGE2_REFERENCE_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true
      });
    }
    const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    return {
      buffer,
      mimeType: "image/png",
      filename: `reference-${index + 1}.png`
    };
  } catch (error) {
    if (IMAGE2_SUPPORTED_MIMES.has(originalMime)) {
      log.warn("Image 2 参考图 sharp 处理失败，降级使用原文件", { ref: index + 1, error });
      return passthrough();
    }
    throw new Error(`Image 2 参考图 ${index + 1} 预处理失败：${error instanceof Error ? error.message : "图片格式异常"}`);
  }
}

function getReferenceDataUrls(input: GenerateInput) {
  const values = input.referenceDataUrls?.length ? input.referenceDataUrls : input.referenceDataUrl ? [input.referenceDataUrl] : [];
  return values.filter(Boolean);
}

function isTransientProviderError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    "stream disconnected",
    "terminated",
    "socket",
    "econnreset",
    "etimedout",
    "timed out",
    "fetch failed",
    "body timeout",
    "network"
  ].some((needle) => message.includes(needle));
}

async function retryProvider<T>(label: string, deadline: ProviderDeadline, run: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      assertDeadline(deadline);
      return await run();
    } catch (error) {
      lastError = error;
      if (isProviderTimeoutError(error) || !isTransientProviderError(error) || attempt === 3) {
        throw error;
      }
      const waitMs = Math.min(attempt * 1500, remainingDeadlineMs(deadline));
      if (waitMs <= 0) {
        throw new ProviderTimeoutError();
      }
      log.warn("Provider call failed transiently, retrying", { label, waitMs, error });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}

function normalizeImageGenerations(raw: Record<string, unknown>): ProviderPayloadResult {
  const data = Array.isArray(raw.data) ? raw.data : [];
  const images = data
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.b64_json === "string") return { b64: record.b64_json, mimeType: "image/png" };
      if (typeof record.url === "string") {
        if (record.url.startsWith("data:image/")) return { b64: record.url };
        return { url: record.url };
      }
      return null;
    })
    .filter(Boolean) as ProviderImage[];

  return {
    requestId: typeof raw.id === "string" ? raw.id : null,
    images,
    raw
  };
}

function findImagesInValue(value: unknown, images: ProviderImage[]) {
  if (!value) return;
  if (typeof value === "string") {
    const dataUriMatches = value.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi) ?? [];
    for (const match of dataUriMatches) images.push({ b64: match });

    const urlMatches = value.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp)(?:\?[^\s"'<>]*)?/gi) ?? [];
    for (const match of urlMatches) images.push({ url: match });
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) findImagesInValue(item, images);
    return;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const inlineData = asRecord(record.inlineData) ?? asRecord(record.inline_data);
    if (inlineData) pushInlineImage(inlineData, images);

    const source = asRecord(record.source);
    if (source) pushInlineImage(source, images);

    if (record.type === "image_generation_call" && typeof record.result === "string") {
      images.push({ b64: record.result, mimeType: "image/png" });
    }

    if (typeof record.b64_json === "string") images.push({ b64: record.b64_json, mimeType: "image/png" });
    if (typeof record.image_url === "string") images.push({ url: record.image_url });
    if (typeof record.url === "string" && /^https?:\/\//.test(record.url)) images.push({ url: record.url });
    for (const nested of Object.values(record)) findImagesInValue(nested, images);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pushInlineImage(record: Record<string, unknown>, images: ProviderImage[]) {
  const mimeType = firstString(record, ["mimeType", "mime_type", "mediaType", "media_type"]);
  if (!mimeType.toLowerCase().startsWith("image/")) return;

  const data = firstString(record, ["data", "base64", "b64_json"]);
  if (data) images.push({ b64: data, mimeType });
}

function normalizeChatResult(raw: Record<string, unknown>): ProviderPayloadResult {
  const images: ProviderImage[] = [];
  findImagesInValue(raw, images);
  return {
    requestId: typeof raw.id === "string" ? raw.id : null,
    images,
    raw
  };
}

function isGptImageModel(model: string) {
  return model === config.imageModelGpt || model.toLowerCase().startsWith("gpt-image");
}

function isNanoBananaModel(model: string) {
  return model === config.imageModelNano || model.toLowerCase().includes("banana");
}

// Gemini flash-image(本质与 Nano Banana 同源,都是 Google 多模态出图模型),
// 通过 OpenAI 兼容代理时走 /v1/chat/completions(text + image_url 多模态),
// 而非 /v1/images/edits。匹配显式配置值或名字里带 "gemini" 的自定义模型。
function isGeminiImageModel(model: string) {
  return model === config.imageModelGemini || model.toLowerCase().includes("gemini");
}

type PreparedReference = Awaited<ReturnType<typeof prepareImage2Reference>>;

function buildImageEditForm(input: GenerateInput, references: PreparedReference[], maskBuffer?: Buffer) {
  const form = new FormData();
  form.set("model", input.model);
  // 局部重绘:① 提示词前置极性声明,给 gpt-image 的「软蒙版」加自然语言双保险;
  //          ② 不发 size —— 发 size(尤其 "auto" / 与输入图不等大)会让网关把带蒙版的编辑退化成整图重绘。
  //             省略后输出沿用输入图尺寸,与蒙版天然对齐(参考 infinite-canvas 的做法)。
  form.set("prompt", maskBuffer ? `只修改蒙版透明区域，其他区域保持不变。${input.prompt}` : input.prompt);
  if (!maskBuffer) form.set("size", input.size);
  form.set("n", String(input.count));
  // 不传 response_format:实测网关带上该参数会返回首页 HTML / 报 Unknown parameter,返回体由 normalizeImageGenerations 兼容 b64/url。
  for (const reference of references) {
    form.append("image", new Blob([blobPartFromBuffer(reference.buffer)], { type: reference.mimeType }), reference.filename);
  }
  // 局部重绘蒙版:OpenAI 规定 mask 作用于第一张 image,且须与之等尺寸(由调用方缩放后传入)。
  if (maskBuffer) {
    form.append("mask", new Blob([blobPartFromBuffer(maskBuffer)], { type: "image/png" }), "mask.png");
  }
  return form;
}

/** 把蒙版 data URL 解码并缩放到与(处理后的)第一张参考图等尺寸、带 alpha 的 PNG。 */
async function prepareMaskForReference(maskDataUrl: string, reference: PreparedReference): Promise<Buffer> {
  const parsed = parseDataUrl(maskDataUrl);
  const meta = await sharp(reference.buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  let pipeline = sharp(parsed.buffer).ensureAlpha();
  if (width > 0 && height > 0) {
    pipeline = pipeline.resize(width, height, { fit: "fill", kernel: "nearest" });
  }
  return pipeline.png().toBuffer();
}

async function generateImageEdit(input: GenerateInput, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  const referenceDataUrls = getReferenceDataUrls(input);
  if (referenceDataUrls.length === 0) {
    throw new Error("Reference image is required for image edits");
  }

  const references: PreparedReference[] = [];
  for (let index = 0; index < referenceDataUrls.length; index += 1) {
    references.push(await prepareImage2Reference(referenceDataUrls[index], index));
  }
  const totalBytes = references.reduce((sum, ref) => sum + ref.buffer.byteLength, 0);
  const diagnostic = `refs=${references.length} payload=${(totalBytes / 1024).toFixed(1)}KB size=${input.size} model=${input.model}`;
  log.info("image2 edit submitting", {
    refs: references.length,
    payloadKB: Number((totalBytes / 1024).toFixed(1)),
    size: input.size,
    model: input.model
  });

  // 局部重绘:OpenAI 要求 image 与 mask **同格式、同尺寸**,且 mask 作用于第一张参考图。
  // 蒙版是带 alpha 的 PNG,所以这里把第一张参考图也转成 PNG(尺寸不变),否则「JPEG 图 + PNG 蒙版」
  // 格式不符会被网关忽略 mask → 整图重绘(实测 JPEG 参考图就是这个症状)。
  let maskBuffer: Buffer | undefined;
  if (input.maskDataUrl) {
    references[0] = {
      ...references[0],
      buffer: await sharp(references[0].buffer).png().toBuffer(),
      mimeType: "image/png",
      filename: "reference-1.png"
    };
    maskBuffer = await prepareMaskForReference(input.maskDataUrl, references[0]);
  }

  // 只发一次「不传 response_format」的请求。实测这家网关带上 response_format(无论 url/b64_json)会返回
  // 首页 HTML 或报 Unknown parameter,旧的 b64/url 兜底链只会把真实错误掩盖成「Unknown parameter」。
  // 失败就如实抛(带诊断信息),由任务级自动重试兜过偶发故障。
  try {
    const form = buildImageEditForm(input, references, maskBuffer);
    const raw = await retryProvider("image edit", deadline, () => postForm("/v1/images/edits", form, apiKey, deadline, baseUrl));
    const normalized = normalizeImageGenerations(raw);
    if (normalized.images.length > 0) return normalized;
    throw Object.assign(new Error("Provider returned no edited image"), { raw });
  } catch (error) {
    if (isProviderTimeoutError(error)) throw error;
    throw enrichEditError(error, diagnostic);
  }
}

function enrichEditError(error: unknown, diagnostic: string) {
  if (!(error instanceof Error)) return error;
  const enriched = error as Error & { diagnostic?: string };
  if (!enriched.diagnostic) {
    enriched.diagnostic = diagnostic;
    enriched.message = `${enriched.message}（${diagnostic}）`;
  }
  return enriched;
}

function shouldTryAnotherKey(error: unknown) {
  if (isProviderTimeoutError(error)) return false;
  if (isTransientProviderError(error)) return true;

  const status = (error as Error & { status?: number }).status;
  if (!status) return false;
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function generateImageGeneration(input: GenerateInput, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  const imageRequest = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    n: input.count
  };

  // 不传 response_format:实测网关带上该参数会返回首页 HTML / 报 Unknown parameter。
  // 返回体由 normalizeImageGenerations 兼容 b64/url;失败如实抛,由任务级自动重试兜底。
  const raw = await retryProvider("image generation", deadline, () =>
    postJson("/v1/images/generations", imageRequest, apiKey, deadline, baseUrl)
  );
  const normalized = normalizeImageGenerations(raw);
  if (normalized.images.length > 0) return normalized;
  throw Object.assign(new Error("Provider returned no images"), { raw });
}

async function generateChatImage(input: GenerateInput, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `${input.prompt}\n\nTarget image size: ${input.size}. Keep the final image dimensions divisible by 16.`
    }
  ];
  for (const dataUrl of getReferenceDataUrls(input)) {
    content.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  const raw = await retryProvider("chat image generation", deadline, () =>
    postJson("/v1/chat/completions", {
      model: input.model,
      messages: [{ role: "user", content }],
      n: input.count
    }, apiKey, deadline, baseUrl)
  );
  const normalized = normalizeChatResult(raw);
  if (normalized.images.length === 0) {
    throw Object.assign(new Error("Provider response did not contain an image"), { raw });
  }
  return normalized;
}

const MASK_EDIT_INSTRUCTION = [
  "你将收到两张图片:第一张为原图,第二张为遮罩。",
  "编辑规则(必须严格遵守):",
  "1) 只允许修改遮罩中【白色】区域对应的内容;遮罩中【黑色】区域必须与原图保持完全一致(像素级不变,包括构图、背景、位置、轮廓、大小、颜色、光照、阴影、清晰度、风格、文字水印等)。",
  "2) 白色区域的边缘要自然融合,不要溢出到黑色区域,也不要产生新的改动区域或额外元素。",
  "3) 若编辑要求与「仅修改白色区域、黑色区域完全不变」冲突,优先保证黑色区域不变。",
  "编辑要求:"
].join("\n");

/**
 * 保留原图质量:多模态模型会把整张图按 ~1024px 重画,连没改的区域也降清(结果只几百 KB)。
 * 这里把模型编辑区(白色蒙版)贴回**原图高清版**:蒙版外=原图像素零损失,蒙版内=模型编辑(放大到原尺寸+羽化融合)。
 */
async function compositeMaskedEditOntoOriginal(
  originalDataUrl: string,
  maskDataUrl: string,
  result: ProviderImage
): Promise<ProviderImage> {
  const original = parseDataUrl(originalDataUrl).buffer;
  const meta = await sharp(original).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("无法读取原图尺寸");

  let resultBuffer: Buffer;
  if (result.b64) {
    resultBuffer = Buffer.from(result.b64, "base64");
  } else if (result.url && result.url.startsWith("data:")) {
    resultBuffer = Buffer.from(result.url.split(",")[1] ?? "", "base64");
  } else if (result.url) {
    resultBuffer = Buffer.from(await (await fetch(result.url)).arrayBuffer());
  } else {
    throw new Error("模型结果无图片数据");
  }

  const feather = Math.max(1, Math.round(Math.max(width, height) / 300));
  // 模型结果放大到原尺寸的 RGB
  const resultRgb = await sharp(resultBuffer).resize(width, height, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  // 蒙版 → 单通道羽化 alpha(白=不透明=用编辑区,黑=透明=保原图)
  const maskAlpha = await sharp(parseDataUrl(maskDataUrl).buffer).resize(width, height, { fit: "fill" }).blur(feather).toColourspace("b-w").raw().toBuffer();
  // 编辑结果 + 蒙版 alpha → 半透明覆盖层
  const editWithAlpha = await sharp(resultRgb, { raw: { width, height, channels: 3 } })
    .joinChannel(maskAlpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  // 贴到原图上:蒙版外原图不动,蒙版内被编辑区覆盖,边缘羽化
  const base = sharp(original).composite([{ input: editWithAlpha, blend: "over" }]);
  const isPng = meta.format === "png";
  const composited = isPng ? await base.png().toBuffer() : await base.jpeg({ quality: 92 }).toBuffer();
  return { b64: composited.toString("base64"), mimeType: isPng ? "image/png" : "image/jpeg" };
}

/**
 * 局部重绘:聚合网关对 OpenAI /images/edits 的 mask 参数实现不可靠(实测整图重绘),
 * 改走多模态对话——把【原图 + 黑白遮罩(白=要改、黑=保留) + 强指令】喂给 /v1/chat/completions。
 * 参考开源项目 chunxiuxiamo/ai-image-edit 的实战做法。作用于第一张参考图,其余作为额外上下文。
 * 出图后把编辑区贴回原图高清版,保留原图质量(见 compositeMaskedEditOntoOriginal)。
 */
async function generateMaskedEdit(input: GenerateInput, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  const references = getReferenceDataUrls(input);
  if (references.length === 0 || !input.maskDataUrl) {
    throw new Error("局部重绘需要参考图与蒙版");
  }
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `${MASK_EDIT_INSTRUCTION}\n${input.prompt}\n仅输出一张编辑后的图片,不要输出任何解释文字。` },
    { type: "image_url", image_url: { url: references[0] } },
    { type: "image_url", image_url: { url: input.maskDataUrl } }
  ];
  for (const dataUrl of references.slice(1)) {
    content.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  const raw = await retryProvider("masked chat edit", deadline, () =>
    postJson("/v1/chat/completions", { model: input.model, messages: [{ role: "user", content }], n: input.count }, apiKey, deadline, baseUrl)
  );
  const normalized = normalizeChatResult(raw);
  if (normalized.images.length === 0) {
    throw Object.assign(new Error("Provider response did not contain an image"), { raw });
  }
  // 保留原图质量:把模型编辑区贴回原图高清版。合成失败(如模型挪了构图导致对齐异常)兜底返回模型原图。
  try {
    const composited = await compositeMaskedEditOntoOriginal(references[0], input.maskDataUrl, normalized.images[0]);
    return { ...normalized, images: [composited] };
  } catch (error) {
    log.warn("局部重绘合成贴回原图失败,返回模型原始输出", { error });
    return normalized;
  }
}

async function generateWithSelectedKey(input: GenerateInput, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  // 带蒙版的编辑统一走多模态对话(原图+黑白遮罩+强指令),不依赖网关对 /images/edits mask 的实现。
  if (input.maskDataUrl && getReferenceDataUrls(input).length > 0) {
    return generateMaskedEdit(input, apiKey, deadline, baseUrl);
  }

  if (isGptImageModel(input.model)) {
    return getReferenceDataUrls(input).length > 0
      ? generateImageEdit(input, apiKey, deadline, baseUrl)
      : generateImageGeneration(input, apiKey, deadline, baseUrl);
  }

  if (isNanoBananaModel(input.model) || isGeminiImageModel(input.model)) {
    return generateChatImage(input, apiKey, deadline, baseUrl);
  }

  if (getReferenceDataUrls(input).length > 0) {
    try {
      return await generateImageEdit(input, apiKey, deadline, baseUrl);
    } catch (error) {
      if (isProviderTimeoutError(error) || isTransientProviderError(error)) {
        throw error;
      }
      const status = (error as Error & { status?: number }).status;
      if (status && ![400, 404, 405, 422].includes(status)) throw error;
    }

    return generateChatImage(input, apiKey, deadline, baseUrl);
  }

  try {
    return await generateImageGeneration(input, apiKey, deadline, baseUrl);
  } catch (error) {
    if (isProviderTimeoutError(error) || isTransientProviderError(error)) {
      throw error;
    }
    const status = (error as Error & { status?: number }).status;
    if (status && ![400, 404, 405, 422].includes(status)) throw error;
  }

  return generateChatImage(input, apiKey, deadline, baseUrl);
}

type PresetContext = { baseUrl: string; presetId: string | null; presetName: string | null };

// 单个 Provider(preset)内的尝试:在该 preset 的多个 key 之间轮换(带失败自动停用)。
// 成功返回 ProviderResult;该 preset 内全部不可用时抛错(由上层决定是否 failover 到下一个 preset)。
async function runWithPreset(input: GenerateInput, ctx: PresetContext): Promise<ProviderResult> {
  const { baseUrl, presetId, presetName } = ctx;
  const triedKeyIds: string[] = [];
  let triedEnvKey = false;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
    let selection: Awaited<ReturnType<typeof getNextAiApiKey>>;
    try {
      selection = await getNextAiApiKey(triedKeyIds, presetId);
    } catch (error) {
      if (lastError) throw lastError;
      throw error;
    }

    if (selection.keyId) {
      if (triedKeyIds.includes(selection.keyId)) break;
      triedKeyIds.push(selection.keyId);
    } else {
      if (triedEnvKey) break;
      triedEnvKey = true;
    }

    try {
      const result = await generateWithSelectedKey(input, selection.apiKey, createDeadline(), baseUrl);
      await reportAiKeySuccess(selection.keyId);
      return {
        ...result,
        keyId: selection.keyId,
        keyLabel: selection.keyLabel,
        keySource: selection.source,
        baseUrl,
        presetId,
        presetName
      };
    } catch (error) {
      lastError = error;
      await reportAiKeyFailure(selection.keyId, error);

      if (!shouldTryAnotherKey(error) || attempt === MAX_KEY_ATTEMPTS) {
        throw error;
      }

      log.warn("Provider key attempt failed, trying another key", { attempt, presetId, error });
    }
  }

  if (lastError) throw lastError;
  throw new Error(
    presetName
      ? `Preset「${presetName}」下没有可用的 AI Key`
      : "没有可用的 AI Key"
  );
}

export async function generateWithProvider(
  input: GenerateInput,
  options: ProviderRequestOptions = {}
): Promise<ProviderResult> {
  // 自动轮换:按轮询在所有 Provider(preset)间取一个,选中的失败/无可用 key 时顺延下一个(failover)。
  if (isRotatePreset(options.presetId)) {
    const presets = (await getProviderSettings()).presets;
    if (presets.length > 0) {
      const start = rotationCursor % presets.length;
      rotationCursor = (rotationCursor + 1) % 1_000_000;
      let lastError: unknown;
      for (let i = 0; i < presets.length; i += 1) {
        const preset = presets[(start + i) % presets.length];
        options.onProviderSelected?.({ presetId: preset.id, presetName: preset.name, baseUrl: preset.baseUrl });
        try {
          return await runWithPreset(input, { baseUrl: preset.baseUrl, presetId: preset.id, presetName: preset.name });
        } catch (error) {
          lastError = error;
          log.warn("Provider 轮换:当前 Provider 失败,顺延下一个", {
            presetId: preset.id,
            presetName: preset.name,
            error
          });
        }
      }
      throw lastError ?? new Error("所有 Provider 都不可用");
    }
    // 没有任何 preset → 退回默认/env 解析(下面统一处理)。
  }

  const resolved = await resolveProvider(isRotatePreset(options.presetId) ? null : options.presetId);
  options.onProviderSelected?.({
    presetId: resolved.preset?.id ?? null,
    presetName: resolved.preset?.name ?? null,
    baseUrl: resolved.baseUrl
  });
  return runWithPreset(input, {
    baseUrl: resolved.baseUrl,
    presetId: resolved.preset?.id ?? null,
    presetName: resolved.preset?.name ?? null
  });
}
