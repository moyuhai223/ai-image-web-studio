import { requireUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { startGenerationQueue } from "@/lib/generation-queue";
import { createLogger } from "@/lib/logger";
import { getActiveQueueStats, listActiveQueueJobs } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("queue.stream");

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_STREAM_DURATION_MS = 10 * 60 * 1000; // 10 分钟后端主动关闭,客户端会自动重连

type StreamPayload = {
  ts: string;
  queued: number;
  running: number;
  concurrency: number;
  jobs: unknown[];
};

function buildPayload(stats: Awaited<ReturnType<typeof getActiveQueueStats>>, jobs: unknown[]): StreamPayload {
  return {
    ts: new Date().toISOString(),
    queued: stats.queued,
    running: stats.running,
    concurrency: config.maxGenerationConcurrency,
    jobs
  };
}

/**
 * 计算一个轻量 hash,用于判断 payload 是否变化(避免每 500ms 推一份相同数据)。
 * 不考虑 ts 字段(每次都不同)。
 */
function payloadFingerprint(payload: StreamPayload): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ts: _ignored, ...rest } = payload;
  return JSON.stringify(rest);
}

function sseFormat(event: string, data: unknown): string {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}

export async function GET(request: Request) {
  const user = await requireUser();
  startGenerationQueue();

  let lastFingerprint = "";
  let lastHeartbeatAt = Date.now();
  const startedAt = Date.now();

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed, ignore
        }
      };

      const safeEnqueue = (chunk: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch (error) {
          log.debug("Stream enqueue failed (client likely disconnected)", { error });
          cleanup();
          return false;
        }
      };

      request.signal.addEventListener("abort", () => {
        cleanup();
      });

      // 立即推一份初始快照
      try {
        const [stats, jobs] = await Promise.all([
          getActiveQueueStats(user),
          listActiveQueueJobs(user, 8)
        ]);
        const payload = buildPayload(stats, jobs);
        lastFingerprint = payloadFingerprint(payload);
        if (!safeEnqueue(sseFormat("snapshot", payload))) return;
      } catch (error) {
        log.warn("Initial queue snapshot failed", { error });
        safeEnqueue(sseFormat("error", { message: "初始快照失败" }));
      }

      const poll = async () => {
        if (closed) return;
        try {
          const [stats, jobs] = await Promise.all([
            getActiveQueueStats(user),
            listActiveQueueJobs(user, 8)
          ]);
          const payload = buildPayload(stats, jobs);
          const fingerprint = payloadFingerprint(payload);
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            if (!safeEnqueue(sseFormat("update", payload))) return;
          } else if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
            // 没有变化时 25s 发一次心跳,防止中间代理把连接当 idle 关掉
            lastHeartbeatAt = Date.now();
            safeEnqueue(`: heartbeat ${new Date().toISOString()}\n\n`);
          }
        } catch (error) {
          log.warn("Queue stream poll failed", { error });
          safeEnqueue(sseFormat("error", { message: "拉取队列状态失败" }));
        }

        if (Date.now() - startedAt >= MAX_STREAM_DURATION_MS) {
          safeEnqueue(sseFormat("bye", { reason: "max-duration" }));
          cleanup();
          return;
        }

        if (closed) return;
        setTimeout(() => {
          void poll();
        }, POLL_INTERVAL_MS).unref?.();
      };

      setTimeout(() => {
        void poll();
      }, POLL_INTERVAL_MS).unref?.();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    }
  });
}
