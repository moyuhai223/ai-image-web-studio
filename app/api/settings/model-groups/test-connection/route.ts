import { NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
import { requireAdmin } from "@/lib/auth";
import { respondError } from "@/lib/api-errors";
import { normalizeAiBaseUrl } from "@/lib/base-url";
import { assertPublicBaseUrl } from "@/lib/egress-guard";
import { resolveModelGroup } from "@/lib/model-groups";

export const runtime = "nodejs";

const PROBE_TIMEOUT_MS = 5000;

type TestResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  baseUrl: string;
  error?: string;
};

async function probeBaseUrl(baseUrl: string, apiKey: string): Promise<{ ok: boolean; status: number | null; error?: string }> {
  try {
    await assertPublicBaseUrl(baseUrl);
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error ? error.message : "出站地址被拒绝" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal
    });
    if (response.ok) return { ok: true, status: response.status };
    // 只回状态码,不透传上游原始错误体(部分网关会在错误体里回显请求头/账号标识)。
    return { ok: false, status: response.status, error: `上游返回 HTTP ${response.status}` };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, status: null, error: `请求超时(${PROBE_TIMEOUT_MS / 1000}s)` };
    }
    return { ok: false, status: null, error: error instanceof Error ? error.message : "网络错误" };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let baseUrl = "";
    let apiKey = "";
    if (typeof body.id === "string" && body.id.trim()) {
      // 测已存在的组:服务端解析 baseUrl+key(客户端拿不到明文 key)。
      // 严格匹配 id——resolveModelGroup 找不到会回退默认组,这里要求精确命中,否则报「不存在」。
      const resolved = await resolveModelGroup(body.id);
      if (!resolved || resolved.group.id !== body.id.trim()) {
        return NextResponse.json({ error: "模型组不存在" }, { status: 404 });
      }
      baseUrl = resolved.group.baseUrl;
      apiKey = resolved.apiKey;
    } else if (typeof body.baseUrl === "string") {
      // 测未保存的组:用请求里的 baseUrl + key
      baseUrl = normalizeAiBaseUrl(body.baseUrl);
      apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    } else {
      return NextResponse.json({ error: "请提供模型组 id 或 baseUrl" }, { status: 400 });
    }

    const startedAt = performance.now();
    const probe = await probeBaseUrl(baseUrl, apiKey);
    const latencyMs = Math.round(performance.now() - startedAt);
    const result: TestResult = {
      ok: probe.ok,
      status: probe.status,
      latencyMs,
      baseUrl,
      error: probe.ok ? undefined : probe.error
    };
    return NextResponse.json(result);
  } catch (error) {
    return respondError(error, { context: "settings.model-groups.test", fallbackStatus: 400 });
  }
}
