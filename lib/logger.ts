type LogLevel = "debug" | "info" | "warn" | "error";
type LogFormat = "text" | "json";
type LogContext = Record<string, unknown> | Error | undefined;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const IS_BROWSER = typeof window !== "undefined";

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resolveLevel(): LogLevel {
  const raw = (readEnv("LOG_LEVEL") ?? "info").toLowerCase();
  return raw in LEVEL_PRIORITY ? (raw as LogLevel) : "info";
}

function resolveFormat(): LogFormat {
  if (IS_BROWSER) return "text";
  const raw = (readEnv("LOG_FORMAT") ?? "text").toLowerCase();
  return raw === "json" ? "json" : "text";
}

const MIN_LEVEL = resolveLevel();
const FORMAT = resolveFormat();
const MIN_PRIORITY = LEVEL_PRIORITY[MIN_LEVEL];

function serializeError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: error.message
  };
  if (error.stack) out.stack = error.stack;
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined) {
    out.cause = cause instanceof Error ? serializeError(cause) : cause;
  }
  return out;
}

function normalizeContext(ctx: LogContext): Record<string, unknown> | undefined {
  if (ctx === undefined) return undefined;
  if (ctx instanceof Error) return { error: serializeError(ctx) };
  if (typeof ctx !== "object" || ctx === null) return { value: ctx };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx)) {
    result[key] = value instanceof Error ? serializeError(value) : value;
  }
  return result;
}

function emit(level: LogLevel, name: string, msg: string, ctx: LogContext) {
  if (LEVEL_PRIORITY[level] < MIN_PRIORITY) return;
  const ts = new Date().toISOString();
  const fields = normalizeContext(ctx);
  const useStderr = level === "warn" || level === "error";

  let line: string;
  if (FORMAT === "json") {
    const record: Record<string, unknown> = { ts, level, logger: name, msg };
    if (fields) record.ctx = fields;
    line = JSON.stringify(record);
  } else {
    const tag = level.toUpperCase().padEnd(5);
    let fieldStr = "";
    if (fields) {
      try {
        fieldStr = ` ${JSON.stringify(fields)}`;
      } catch {
        fieldStr = " [unserializable context]";
      }
    }
    line = `${ts} ${tag} [${name}] ${msg}${fieldStr}`;
  }

  if (useStderr) console.error(line);
  else console.log(line);
}

export type Logger = {
  debug: (msg: string, ctx?: LogContext) => void;
  info: (msg: string, ctx?: LogContext) => void;
  warn: (msg: string, ctx?: LogContext) => void;
  error: (msg: string, ctx?: LogContext) => void;
};

export function createLogger(name: string): Logger {
  return {
    debug: (msg, ctx) => emit("debug", name, msg, ctx),
    info: (msg, ctx) => emit("info", name, msg, ctx),
    warn: (msg, ctx) => emit("warn", name, msg, ctx),
    error: (msg, ctx) => emit("error", name, msg, ctx)
  };
}
