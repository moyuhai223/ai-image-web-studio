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
  /**
   * 登录限流取「真实客户端 IP」的可信来源头。默认 cf-connecting-ip——Cloudflare 注入且客户端不可伪造
   * (源站只接受反代流量时)。**不要**盲信 X-Forwarded-For 首段(客户端可任意伪造,曾致 IP 维度限流被绕过)。
   * 不走 Cloudflare 的部署应改为反代权威注入的头(并确保反代覆盖/剥离入站同名头);置空则回退到尽力而为的启发式。
   */
  trustedClientIpHeader: (process.env.TRUSTED_CLIENT_IP_HEADER ?? "cf-connecting-ip").trim().toLowerCase(),
  timeZone: process.env.APP_TIME_ZONE ?? process.env.TZ ?? DEFAULT_TIME_ZONE,
  aiBaseUrl: optionalUrlEnv(process.env.PROVIDER_BASE_URL),
  aiApiKey: process.env.PROVIDER_API_KEY ?? "",
  imageModelGpt: process.env.IMAGE_MODEL_GPT ?? "gpt-image-2",
  imageModelNano: process.env.IMAGE_MODEL_NANO_BANANA ?? "Nano Banana 2",
  imageModelGemini: process.env.IMAGE_MODEL_GEMINI ?? "gemini-3.1-flash-image",
  storageRoot: process.env.LOCAL_STORAGE_ROOT ?? "./storage",
  maxUploadMb: numberEnv(process.env.MAX_UPLOAD_MB, 20),
  /** 单个 multipart 请求体总上限(MB):formData() 会先全量缓冲进内存,超此即 413 早退防 OOM。默认 100。 */
  maxRequestBodyMb: numberEnv(process.env.MAX_REQUEST_BODY_MB, 100),
  /** 备份包上传上限(MB):备份可能远大于图片,单独放宽,但仍设有界上限防 OOM。默认 1024(1GB)。 */
  maxBackupUploadMb: numberEnv(process.env.MAX_BACKUP_UPLOAD_MB, 1024),
  /**
   * 站点公开源(如 https://draw.mjj.link)。设置后对状态变更请求做 Origin/Referer 同源校验(CSRF 纵深防御)。
   * 留空则不校验(默认,避免反代改写 Host 误伤);会话 cookie 已是 sameSite=lax 作为主要 CSRF 防线。
   */
  appOrigin: (process.env.APP_ORIGIN ?? "").trim().replace(/\/+$/, ""),
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
  /** v0.7.25: 生成失败自动重试上限——仅对瞬时错误(上游 5xx/无图/超时/网络/auth_unavailable)。0 = 关闭。默认 2。 */
  generationAutoRetryMax: numberEnv(process.env.GENERATION_AUTO_RETRY_MAX, 2, 0),
  /** 自动重试基准退避毫秒;第 N 次重试约等 base*N(默认 8000 → 8s、16s),上限 60s。 */
  generationAutoRetryBackoffMs: numberEnv(process.env.GENERATION_AUTO_RETRY_BACKOFF_MS, 8000),
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

/** 公开已知的弱/默认 AUTH_SECRET —— 出现在代码默认值与 docker-compose 占位符里,等同无密钥。 */
const KNOWN_WEAK_AUTH_SECRETS = new Set(["", "dev-only-change-me", "replace-with-a-long-random-secret"]);

/**
 * 生产启动断言:AUTH_SECRET 同时用于会话 HMAC 签名与 AI Key 池/优化 Key 的 AES 加密,
 * 一旦是公开默认值即可被离线伪造 admin 会话 + 解密全部上游 Key。生产环境若仍是空值/已知默认值,
 * 直接拒绝启动(fail-fast);长度不足 32 只告警不拦(避免误伤已设中等强度密钥的既有部署)。
 * 由 instrumentation.ts 的 register() 在服务器启动时调用——不在模块 import 期跑,避免破坏 next build。
 */
export function assertProductionSecrets() {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.AUTH_SECRET ?? "";
  if (KNOWN_WEAK_AUTH_SECRETS.has(secret)) {
    throw new Error(
      "启动被拒绝:生产环境必须设置 AUTH_SECRET 为一个高熵随机值(当前为空或仍是公开默认值)。" +
        "该密钥用于会话签名与上游 Key 加密,使用默认值会导致会话伪造与密钥泄露。请设置 ≥32 字符的随机值后重启。"
    );
  }
  if (secret.length < 32) {
    // eslint-disable-next-line no-console
    console.warn(
      "[security] AUTH_SECRET 长度不足 32 字符,强度偏弱,建议更换为 ≥32 字符的高熵随机值(会话签名 + 密钥加密共用此密钥)。"
    );
  }
}
