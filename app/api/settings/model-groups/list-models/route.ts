import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { respondError } from "@/lib/api-errors";
import { normalizeAiBaseUrl } from "@/lib/base-url";
import { assertPublicBaseUrl } from "@/lib/egress-guard";
import { resolveModelGroup } from "@/lib/model-groups";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 8000;
const MAX_MODELS = 500;
const MAX_MODEL_ID_LENGTH = 120;

/**
 * 解析网关 /v1/models 的响应,兼容常见形态:
 * - OpenAI:{ data: [{ id: "..." }, ...] }
 * - 部分网关:{ models: [...] } 或直接数组;数组元素为对象(取 id/name)或纯字符串。
 * 返回去重、限长、限量的模型 id 列表(保持网关返回顺序)。
 */
function parseModelIds(payload: unknown): string[] {
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? (record.data as unknown[])
      : Array.isArray(record?.models)
        ? (record.models as unknown[])
        : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    let id = "";
    if (typeof item === "string") {
      id = item;
    } else if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>;
      id = typeof rec.id === "string" ? rec.id : typeof rec.name === "string" ? rec.name : "";
    }
    id = id.trim();
    if (!id || id.length > MAX_MODEL_ID_LENGTH || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/**
 * 拉取网关支持的模型列表,给后台「模型组」编辑器做下拉候选。
 * body:{ id?(已存组,服务端解析 key), baseUrl?(覆盖组地址/未保存组), apiKey?(未保存 key,优先) }
 */
export async function POST(request: Request) {
  await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let baseUrl = "";
    let apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

    if (typeof body.id === "string" && body.id.trim()) {
      // 严格匹配 id(resolveModelGroup 找不到会回退默认组,这里要求精确命中)
      const resolved = await resolveModelGroup(body.id);
      if (!resolved || resolved.group.id !== body.id.trim()) {
        return NextResponse.json({ error: "模型组不存在" }, { status: 404 });
      }
      baseUrl = resolved.group.baseUrl;
      if (!apiKey) apiKey = resolved.apiKey;
    }
    if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
      baseUrl = normalizeAiBaseUrl(body.baseUrl);
    }
    if (!baseUrl) {
      return NextResponse.json({ error: "请提供模型组 id 或 Base URL" }, { status: 400 });
    }

    await assertPublicBaseUrl(baseUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: "GET",
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: controller.signal
      });
      if (!response.ok) {
        // 只回状态码,不透传上游原始错误体
        return NextResponse.json({ error: `上游返回 HTTP ${response.status}` }, { status: 502 });
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      const models = parseModelIds(payload);
      if (models.length === 0) {
        return NextResponse.json({ error: "网关返回了空的模型列表(或格式无法识别),请手动输入模型 id" }, { status: 502 });
      }
      return NextResponse.json({ models });
    } catch (error) {
      if (controller.signal.aborted) {
        return NextResponse.json({ error: `请求超时(${FETCH_TIMEOUT_MS / 1000}s)` }, { status: 504 });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return respondError(error, { context: "settings.model-groups.list-models", fallbackStatus: 400 });
  }
}
