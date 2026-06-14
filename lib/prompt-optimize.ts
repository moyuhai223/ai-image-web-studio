import { getNextAiApiKey, reportAiKeyFailure, reportAiKeySuccess } from "./api-keys";
import { createLogger } from "./logger";
import { getPromptOptimizeSettings } from "./prompt-optimize-settings";
import { resolveProvider } from "./provider-settings";

const log = createLogger("prompt-optimize");

const OPTIMIZE_TIMEOUT_MS = 45_000;
const MAX_KEY_ATTEMPTS = 3;
export const OPTIMIZE_INPUT_MAX_LENGTH = 2000;

export class PromptOptimizeDisabledError extends Error {
  constructor() {
    super("提示词优化未启用");
    this.name = "PromptOptimizeDisabledError";
  }
}

export type OptimizeContext = {
  /** 目标图像模型(如 gpt-image-2),作为上下文提示优化器 */
  model?: string;
  /** 目标尺寸,如 1024x1024 */
  size?: string;
  /** 是否为带参考图的编辑场景 */
  hasReference?: boolean;
};

/** 把模型回包里的常见包裹剥掉:代码围栏、首尾引号、前后空白。 */
function cleanOptimizedText(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/);
  if (fence) text = fence[1].trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["「", "」"],
    ["『", "』"]
  ];
  for (const [open, close] of quotePairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, text.length - close.length).trim();
      break;
    }
  }
  return text;
}

function buildMessages(rawPrompt: string, systemPrompt: string, ctx: OptimizeContext) {
  const contextLines: string[] = [];
  if (ctx.model) contextLines.push(`目标图像模型:${ctx.model}`);
  if (ctx.size) contextLines.push(`目标尺寸:${ctx.size}`);
  if (ctx.hasReference) contextLines.push("场景:这是对已有图片的编辑/改绘,描述应聚焦在希望产生的变化上。");

  const messages: Array<{ role: "system" | "user"; content: string }> = [{ role: "system", content: systemPrompt }];
  if (contextLines.length > 0) {
    messages.push({ role: "system", content: `补充上下文(供参考,不要照抄进结果):\n${contextLines.join("\n")}` });
  }
  messages.push({ role: "user", content: rawPrompt });
  return messages;
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

/** 只在网络层/超时抛错;HTTP 非 2xx 以 {ok:false} 返回,便于上层分类换 key。 */
async function postChat(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPTIMIZE_TIMEOUT_MS);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    text = await response.text();
  } finally {
    clearTimeout(timeout);
  }

  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { text };
  }
  return { ok: response.ok, status: response.status, json };
}

function errorFromBody(status: number, json: Record<string, unknown>): Error {
  const message =
    typeof json.error === "object" && json.error && "message" in json.error
      ? String((json.error as { message: unknown }).message)
      : `优化请求失败(${status})`;
  return Object.assign(new Error(message), { status });
}

function extractContent(json: Record<string, unknown>): string {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

/**
 * 调用配置的文本模型把粗糙提示词优化成高质量出图提示词。
 * 复用 provider 的 preset/key 轮换与失败上报;成功返回优化后的纯文本。
 */
export async function optimizePrompt(rawPrompt: string, ctx: OptimizeContext = {}): Promise<{ optimized: string; model: string }> {
  const settings = await getPromptOptimizeSettings();
  if (!settings.enabled) {
    throw new PromptOptimizeDisabledError();
  }

  const trimmedInput = rawPrompt.trim().slice(0, OPTIMIZE_INPUT_MAX_LENGTH);
  if (!trimmedInput) {
    throw new Error("请输入要优化的提示词");
  }

  const { preset, baseUrl } = await resolveProvider(null);
  const messages = buildMessages(trimmedInput, settings.systemPrompt, ctx);
  const body = { model: settings.model, messages, temperature: 0.7 };

  const triedKeyIds: string[] = [];
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
    const selection = await getNextAiApiKey(triedKeyIds, preset?.id ?? null);
    if (selection.keyId) triedKeyIds.push(selection.keyId);

    let result: { ok: boolean; status: number; json: Record<string, unknown> };
    try {
      result = await postChat(baseUrl, selection.apiKey, body);
    } catch (error) {
      // 网络层异常或超时(AbortError)
      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError = new Error(`优化请求超过 ${Math.round(OPTIMIZE_TIMEOUT_MS / 1000)} 秒未返回`);
        await reportAiKeyFailure(selection.keyId, timeoutError);
        throw timeoutError;
      }
      await reportAiKeyFailure(selection.keyId, error);
      lastError = error instanceof Error ? error : new Error("优化请求失败");
      if (attempt === MAX_KEY_ATTEMPTS) throw lastError;
      log.warn("optimize network error, trying another key", { attempt, presetId: preset?.id ?? null });
      continue;
    }

    if (!result.ok) {
      const error = errorFromBody(result.status, result.json);
      await reportAiKeyFailure(selection.keyId, error);
      if (isRetryableStatus(result.status) && attempt < MAX_KEY_ATTEMPTS) {
        lastError = error;
        log.warn("optimize key attempt failed, trying another", { attempt, status: result.status, presetId: preset?.id ?? null });
        continue;
      }
      throw error;
    }

    const optimized = cleanOptimizedText(extractContent(result.json));
    if (!optimized) {
      // 空结果通常是模型/提示词问题而非 key 问题,不再换 key 重试。
      const error = new Error("优化结果为空,请重试或在后台换用其它文本模型");
      await reportAiKeyFailure(selection.keyId, error);
      throw error;
    }

    await reportAiKeySuccess(selection.keyId);
    return { optimized, model: settings.model };
  }

  throw lastError ?? new Error("优化请求失败");
}
