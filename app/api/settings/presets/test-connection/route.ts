import { NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
import { requireAdmin } from "@/lib/auth";
import { respondError } from "@/lib/api-errors";
import { getNextAiApiKey } from "@/lib/api-keys";
import { listProviderPresets, normalizeAiBaseUrl } from "@/lib/provider-settings";
import { writeAuditLog } from "@/lib/audit-log";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";

const log = createLogger("settings.presets.test");

// 5s 探活够大多数 provider 响应,又能快速暴露死链
const PROBE_TIMEOUT_MS = 5000;

type TestResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  baseUrl: string;
  keyLabel: string | null;
  error?: string;
};

async function probeBaseUrl(baseUrl: string, apiKey: string): Promise<{ ok: boolean; status: number | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });

    // 2xx/3xx 都算连通(部分代理对 /v1/models 限制 401 不代表不通,但仍按失败展示 — 让用户换个能访问 /v1/models 的 key)
    if (response.ok) return { ok: true, status: response.status };

    let errorText = "";
    try {
      const body = await response.text();
      errorText = body.length > 240 ? `${body.slice(0, 240)}…` : body;
    } catch {
      errorText = "";
    }
    return {
      ok: false,
      status: response.status,
      error: errorText || `HTTP ${response.status}`
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, status: null, error: `请求超时(${PROBE_TIMEOUT_MS / 1000}s)` };
    }
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "网络错误"
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const user = await requireAdmin();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let baseUrl = "";
    let presetId: string | null = null;
    let presetName: string | null = null;

    if (typeof body.id === "string" && body.id.trim()) {
      const presets = await listProviderPresets();
      const preset = presets.find((item) => item.id === body.id);
      if (!preset) {
        return NextResponse.json({ error: "Preset 不存在" }, { status: 404 });
      }
      baseUrl = preset.baseUrl;
      presetId = preset.id;
      presetName = preset.name;
    } else if (typeof body.baseUrl === "string") {
      baseUrl = normalizeAiBaseUrl(body.baseUrl);
    } else {
      return NextResponse.json({ error: "请提供要测试的 Preset id 或 baseUrl" }, { status: 400 });
    }

    let selection: Awaited<ReturnType<typeof getNextAiApiKey>>;
    try {
      selection = await getNextAiApiKey([], presetId);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          status: null,
          latencyMs: 0,
          baseUrl,
          keyLabel: null,
          error: error instanceof Error ? error.message : "没有可用的 AI Key"
        } satisfies TestResult,
        { status: 200 }
      );
    }

    const startedAt = performance.now();
    const probeResult = await probeBaseUrl(baseUrl, selection.apiKey);
    const latencyMs = Math.round(performance.now() - startedAt);

    const result: TestResult = {
      ok: probeResult.ok,
      status: probeResult.status,
      latencyMs,
      baseUrl,
      keyLabel: selection.keyLabel,
      error: probeResult.ok ? undefined : probeResult.error
    };

    await writeAuditLog({
      user,
      request,
      action: "测试 Provider Preset 连通性",
      targetType: "provider_preset",
      targetId: presetId ?? null,
      detail: {
        presetName,
        baseUrl,
        ok: result.ok,
        status: result.status,
        latencyMs: result.latencyMs,
        keyLabel: selection.keyLabel,
        error: result.error
      }
    });

    if (!result.ok) {
      log.warn("Preset connectivity probe failed", {
        presetId,
        presetName,
        baseUrl,
        status: result.status,
        error: result.error
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return respondError(error, { context: "settings.presets.test", fallbackStatus: 400 });
  }
}
