import sharp from "sharp";
import { getNextAiApiKey, reportAiKeyFailure, reportAiKeySuccess } from "./api-keys";
import { config } from "./config";
import { getProviderBaseUrl } from "./provider-settings";

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
  images: ProviderImage[];
  raw: Record<string, unknown>;
};

type ProviderPayloadResult = Omit<ProviderResult, "keyId" | "keyLabel" | "keySource" | "baseUrl">;

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
};

const MAX_KEY_ATTEMPTS = 3;
const IMAGE2_REFERENCE_MAX_SIDE = 1536;

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
  try {
    const buffer = await sharp(reference.buffer)
      .rotate()
      .resize({
        width: IMAGE2_REFERENCE_MAX_SIDE,
        height: IMAGE2_REFERENCE_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true
      })
      .png()
      .toBuffer();

    return {
      buffer,
      mimeType: "image/png",
      filename: `reference-${index + 1}.png`
    };
  } catch (error) {
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
      console.warn(`${label} failed transiently, retrying in ${waitMs}ms:`, error);
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

async function generateImageEdit(input: GenerateInput, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  const referenceDataUrls = getReferenceDataUrls(input);
  if (referenceDataUrls.length === 0) {
    throw new Error("Reference image is required for image edits");
  }

  const form = new FormData();
  form.set("model", input.model);
  form.set("prompt", input.prompt);
  form.set("size", input.size);
  form.set("n", String(input.count));
  form.set("response_format", "url");
  for (let index = 0; index < referenceDataUrls.length; index += 1) {
    const reference = await prepareImage2Reference(referenceDataUrls[index], index);
    form.append("image", new Blob([blobPartFromBuffer(reference.buffer)], { type: reference.mimeType }), reference.filename);
  }

  const raw = await retryProvider("image edit generation", deadline, () => postForm("/v1/images/edits", form, apiKey, deadline, baseUrl));
  const normalized = normalizeImageGenerations(raw);
  if (normalized.images.length > 0) return normalized;
  throw Object.assign(new Error("Provider returned no edited image"), { raw });
}

function shouldTryBase64Fallback(error: unknown) {
  if (isProviderTimeoutError(error) || isTransientProviderError(error)) return false;
  const status = (error as Error & { status?: number }).status;
  if (status) return [400, 404, 405, 422].includes(status);

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("response_format") || message.includes("unsupported") || message.includes("provider returned no images");
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

  try {
    const raw = await retryProvider("image url generation", deadline, () =>
      postJson("/v1/images/generations", {
        ...imageRequest,
        response_format: "url"
      }, apiKey, deadline, baseUrl)
    );
    const normalized = normalizeImageGenerations(raw);
    if (normalized.images.length > 0) return normalized;
    throw Object.assign(new Error("Provider returned no images"), { raw });
  } catch (urlError) {
    if (!shouldTryBase64Fallback(urlError)) throw urlError;

    const raw = await retryProvider("image base64 generation", deadline, () =>
      postJson("/v1/images/generations", {
        ...imageRequest,
        response_format: "b64_json"
      }, apiKey, deadline, baseUrl)
    );
    const normalized = normalizeImageGenerations(raw);
    if (normalized.images.length > 0) return normalized;
    throw Object.assign(new Error("Provider returned no images"), { raw });
  }
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

async function generateWithSelectedKey(input: GenerateInput, apiKey: string, deadline: ProviderDeadline, baseUrl: string) {
  if (isGptImageModel(input.model)) {
    return getReferenceDataUrls(input).length > 0
      ? generateImageEdit(input, apiKey, deadline, baseUrl)
      : generateImageGeneration(input, apiKey, deadline, baseUrl);
  }

  if (isNanoBananaModel(input.model)) {
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

export async function generateWithProvider(input: GenerateInput): Promise<ProviderResult> {
  const triedKeyIds: string[] = [];
  let triedEnvKey = false;
  let lastError: unknown;
  const baseUrl = await getProviderBaseUrl();

  for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
    let selection: Awaited<ReturnType<typeof getNextAiApiKey>>;
    try {
      selection = await getNextAiApiKey(triedKeyIds);
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
        baseUrl
      };
    } catch (error) {
      lastError = error;
      await reportAiKeyFailure(selection.keyId, error);

      if (!shouldTryAnotherKey(error) || attempt === MAX_KEY_ATTEMPTS) {
        throw error;
      }

      console.warn(`Provider key attempt ${attempt} failed, trying another key:`, error);
    }
  }

  if (lastError) throw lastError;
  throw new Error("没有可用的 AI Key");
}
