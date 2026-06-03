const DEFAULT_GENERATION_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TIME_ZONE = "Asia/Shanghai";

function optionalUrlEnv(...values: Array<string | undefined>) {
  const value = values.find((item) => typeof item === "string" && item.trim());
  return value ? value.replace(/\/$/, "") : "";
}

function numberEnv(value: string | undefined, fallback: number, min = 1) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= min ? Math.trunc(parsed) : fallback;
}

function csvEnv(value: string | undefined, fallback: string[]): string[] {
  const source = (value ?? "").trim();
  if (!source) return fallback;
  const items = source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  return fallback;
}

const DEFAULT_ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"];

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  authSecret: process.env.AUTH_SECRET ?? "dev-only-change-me",
  timeZone: process.env.APP_TIME_ZONE ?? process.env.TZ ?? DEFAULT_TIME_ZONE,
  aiBaseUrl: optionalUrlEnv(process.env.PROVIDER_BASE_URL),
  aiApiKey: process.env.PROVIDER_API_KEY ?? "",
  imageModelGpt: process.env.IMAGE_MODEL_GPT ?? "gpt-image-2",
  imageModelNano: process.env.IMAGE_MODEL_NANO_BANANA ?? "Nano Banana 2",
  imageModelGemini: process.env.IMAGE_MODEL_GEMINI ?? "gemini-3.1-flash-image",
  storageRoot: process.env.LOCAL_STORAGE_ROOT ?? "./storage",
  maxUploadMb: numberEnv(process.env.MAX_UPLOAD_MB, 20),
  maxReferenceImages: numberEnv(process.env.MAX_REFERENCE_IMAGES, 4),
  allowedImageMimes: csvEnv(process.env.ALLOWED_IMAGE_MIMES, DEFAULT_ALLOWED_IMAGE_MIMES),
  maxGenerationConcurrency: numberEnv(process.env.MAX_GENERATION_CONCURRENCY, 2),
  maxGenerationQueueSize: numberEnv(process.env.MAX_GENERATION_QUEUE_SIZE, 20),
  /**
   * v0.6.1: DB 连接池上限。之前硬编码 10,在 maxGenerationConcurrency 上调
   * 或并发用户多时会被打满(每个 runner 占 1-2 连接 + SSE long-lived + API 请求)。
   * 默认 20 可覆盖 8 并发 runner + 中等用户量。
   */
  dbPoolMax: numberEnv(process.env.DB_POOL_MAX, 20),
  /**
   * v0.6.1: 拿连接的超时(毫秒)。pg 默认 0(无穷等待)会让 API 端 hang 死,
   * 改为 10s 失败快返回,前端能拿到 5xx 而不是浏览器自己 timeout。
   */
  dbPoolConnectionTimeoutMs: numberEnv(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 10000),
  dailyGenerationLimit: numberEnv(process.env.DAILY_GENERATION_LIMIT, 50, 0),
  generationTimeoutMs: numberEnv(process.env.GENERATION_TIMEOUT_MS, DEFAULT_GENERATION_TIMEOUT_MS),
  /** 4K 高清化的目标长边像素(快速放大与 AI 收尾共用)。默认 3840(4K UHD)。 */
  upscaleLongEdge: numberEnv(process.env.UPSCALE_LONG_EDGE, 3840),
  /**
   * Stage 2 (v0.5.0): 进程重启时,默认把 running 任务改成 'interrupted' 终态,而非自动重排队。
   * 设为 true 可恢复旧行为(自动重排队)。
   */
  autoRequeueOnRestart: booleanEnv(process.env.AUTO_REQUEUE_ON_RESTART, false),
  githubRepositorySlug: process.env.GITHUB_REPOSITORY_SLUG ?? "moyuhai223/ai-image-web-studio"
};

export function requireEnv(value: string, label: string) {
  if (!value) {
    throw new Error(`${label} is not configured`);
  }

  return value;
}
