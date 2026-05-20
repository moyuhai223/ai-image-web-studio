const DEFAULT_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_TIME_ZONE = "Asia/Shanghai";

function numberEnv(value: string | undefined, fallback: number, min = 1) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= min ? Math.trunc(parsed) : fallback;
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  authSecret: process.env.AUTH_SECRET ?? "dev-only-change-me",
  timeZone: process.env.APP_TIME_ZONE ?? process.env.TZ ?? DEFAULT_TIME_ZONE,
  aiBaseUrl: (process.env.AI_ZH_CI_BASE_URL ?? "https://ai.zh.ci").replace(/\/$/, ""),
  aiApiKey: process.env.AI_ZH_CI_API_KEY ?? "",
  imageModelGpt: process.env.IMAGE_MODEL_GPT ?? "gpt-image-2",
  imageModelNano: process.env.IMAGE_MODEL_NANO_BANANA ?? "Nano Banana 2",
  storageRoot: process.env.LOCAL_STORAGE_ROOT ?? "./storage",
  maxUploadMb: numberEnv(process.env.MAX_UPLOAD_MB, 20),
  maxGenerationConcurrency: numberEnv(process.env.MAX_GENERATION_CONCURRENCY, 2),
  maxGenerationQueueSize: numberEnv(process.env.MAX_GENERATION_QUEUE_SIZE, 20),
  dailyGenerationLimit: numberEnv(process.env.DAILY_GENERATION_LIMIT, 50, 0),
  generationTimeoutMs: numberEnv(process.env.GENERATION_TIMEOUT_MS, DEFAULT_GENERATION_TIMEOUT_MS),
  githubRepositorySlug: process.env.GITHUB_REPOSITORY_SLUG ?? "moyuhai223/ai-image-web-studio"
};

export function requireEnv(value: string, label: string) {
  if (!value) {
    throw new Error(`${label} is not configured`);
  }

  return value;
}
