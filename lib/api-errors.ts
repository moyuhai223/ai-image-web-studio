import { NextResponse } from "next/server";
import { createLogger } from "./logger";

const log = createLogger("api-error");

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type RespondOptions = {
  context: string;
  fallbackStatus?: number;
  fallbackMessage?: string;
};

const DEFAULT_FALLBACK: Record<number, string> = {
  400: "请求参数无效",
  401: "未授权访问",
  403: "无权访问",
  404: "资源不存在",
  409: "当前状态不允许该操作",
  500: "服务暂时不可用，请稍后再试"
};

function logServerError(context: string, status: number, error: unknown) {
  log.error(context, { status, error });
}

export function respondError(error: unknown, options: RespondOptions) {
  if (error instanceof ApiError) {
    if (error.status >= 500) logServerError(options.context, error.status, error);
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const status = options.fallbackStatus ?? 500;
  logServerError(options.context, status, error);

  if (status >= 500) {
    const message = options.fallbackMessage ?? DEFAULT_FALLBACK[status] ?? "服务暂时不可用，请稍后再试";
    return NextResponse.json({ error: message }, { status });
  }

  const passthrough = error instanceof Error
    ? error.message
    : options.fallbackMessage ?? DEFAULT_FALLBACK[status] ?? "请求处理失败";
  return NextResponse.json({ error: passthrough }, { status });
}
