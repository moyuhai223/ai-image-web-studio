import { assertPublicBaseUrl } from "./egress-guard";
import { createLogger } from "./logger";
import { getPromptOptimizeRuntime } from "./prompt-optimize-settings";
import { resolveProvider } from "./provider-settings";

const log = createLogger("prompt-optimize");

const OPTIMIZE_TIMEOUT_MS = 45_000;
export const OPTIMIZE_INPUT_MAX_LENGTH = 2000;

export class PromptOptimizeDisabledError extends Error {
  constructor() {
    super("提示词优化未启用");
    this.name = "PromptOptimizeDisabledError";
  }
}

export class PromptOptimizeNotConfiguredError extends Error {
  constructor() {
    super("提示词优化未配置独立 API Key,请在后台填写");
    this.name = "PromptOptimizeNotConfiguredError";
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

/** 只在网络层/超时抛错;HTTP 非 2xx 以 {ok:false} 返回。 */
async function postChat(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  await assertPublicBaseUrl(baseUrl); // SSRF 守卫:拒绝 baseUrl 解析到内网/云元数据
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
 * 用「提示词优化」独立配置(baseUrl + 独立 apiKey + model)把粗糙提示词改写成高质量出图提示词。
 * 凭据与画图 Key 池隔离:apiKey 必填(无则报未配置);baseUrl 留空时回退画图默认 preset 的地址。
 */
export async function optimizePrompt(rawPrompt: string, ctx: OptimizeContext = {}): Promise<{ optimized: string; model: string }> {
  const runtime = await getPromptOptimizeRuntime();
  if (!runtime.enabled) {
    throw new PromptOptimizeDisabledError();
  }
  if (!runtime.apiKey) {
    throw new PromptOptimizeNotConfiguredError();
  }

  const trimmedInput = rawPrompt.trim().slice(0, OPTIMIZE_INPUT_MAX_LENGTH);
  if (!trimmedInput) {
    throw new Error("请输入要优化的提示词");
  }

  // baseUrl 留空 → 回退画图默认 preset 的地址(同厂商);key 不回退,始终用独立 key。
  let baseUrl = runtime.baseUrl;
  if (!baseUrl) {
    baseUrl = (await resolveProvider(null)).baseUrl;
  }

  const messages = buildMessages(trimmedInput, runtime.systemPrompt, ctx);
  const body = { model: runtime.model, messages, temperature: 0.7 };

  let result: { ok: boolean; status: number; json: Record<string, unknown> };
  try {
    result = await postChat(baseUrl, runtime.apiKey, body);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`优化请求超过 ${Math.round(OPTIMIZE_TIMEOUT_MS / 1000)} 秒未返回`);
    }
    log.warn("optimize request network error", { error });
    throw error instanceof Error ? error : new Error("优化请求失败");
  }

  if (!result.ok) {
    throw errorFromBody(result.status, result.json);
  }

  const optimized = cleanOptimizedText(extractContent(result.json));
  if (!optimized) {
    throw new Error("优化结果为空,请重试或在后台换用其它文本模型");
  }
  return { optimized, model: runtime.model };
}
