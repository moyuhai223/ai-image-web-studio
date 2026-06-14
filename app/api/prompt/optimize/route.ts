import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { respondError } from "@/lib/api-errors";
import {
  optimizePrompt,
  PromptOptimizeDisabledError,
  PromptOptimizeNotConfiguredError,
  OPTIMIZE_INPUT_MAX_LENGTH
} from "@/lib/prompt-optimize";

export const runtime = "nodejs";

// 轻量 per-user 内存限流(单进程足够):60 秒窗口内最多 12 次,且两次间隔 ≥1.5 秒。
const WINDOW_MS = 60_000;
const MAX_IN_WINDOW = 12;
const MIN_GAP_MS = 1500;
const hits = new Map<string, number[]>();

function checkRateLimit(userId: string): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((ts) => now - ts < WINDOW_MS);
  if (recent.length > 0 && now - recent[recent.length - 1] < MIN_GAP_MS) {
    return { ok: false, retryAfterMs: MIN_GAP_MS - (now - recent[recent.length - 1]) };
  }
  if (recent.length >= MAX_IN_WINDOW) {
    return { ok: false, retryAfterMs: WINDOW_MS - (now - recent[0]) };
  }
  recent.push(now);
  hits.set(userId, recent);
  return { ok: true };
}

export async function POST(request: Request) {
  const user = await requireUser();

  try {
    const limit = checkRateLimit(user.id);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "操作太频繁,请稍候再试" },
        { status: 429, headers: { "retry-after": String(Math.ceil((limit.retryAfterMs ?? WINDOW_MS) / 1000)) } }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) {
      return NextResponse.json({ error: "请输入要优化的提示词" }, { status: 400 });
    }
    if (prompt.length > OPTIMIZE_INPUT_MAX_LENGTH * 4) {
      return NextResponse.json({ error: "提示词过长" }, { status: 400 });
    }

    const result = await optimizePrompt(prompt, {
      model: typeof body.model === "string" ? body.model : undefined,
      size: typeof body.size === "string" ? body.size : undefined,
      hasReference: body.hasReference === true
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PromptOptimizeDisabledError) {
      return NextResponse.json({ error: "提示词优化未启用" }, { status: 403 });
    }
    if (error instanceof PromptOptimizeNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return respondError(error, { context: "prompt.optimize.POST", fallbackStatus: 502 });
  }
}
