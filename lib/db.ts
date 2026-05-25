import pg from "pg";
import { config } from "./config";
import { createLogger } from "./logger";

const { Pool } = pg;
const log = createLogger("db");

declare global {
  var __aiImagePool: pg.Pool | undefined;
}

function postgresTimeZoneOption() {
  const timeZone = /^[A-Za-z0-9_./+-]+$/.test(config.timeZone) ? config.timeZone : "Asia/Shanghai";
  return `-c timezone=${timeZone}`;
}

function createPool() {
  if (!config.databaseUrl) {
    return null;
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    // v0.6.1: 上调默认 max 10→20 + 加 connectionTimeoutMillis(pg 默认 0=无穷等)
    // 当 maxGenerationConcurrency 上调或并发用户多时,旧的 10 个连接很容易撑爆。
    max: config.dbPoolMax,
    connectionTimeoutMillis: config.dbPoolConnectionTimeoutMs,
    options: postgresTimeZoneOption()
  });
  pool.on("error", (error) => {
    // v0.6.1: idle 客户端发生错误时(比如 DB 重启) pg 默认会 throw,
    // 必须监听 error 事件防止 unhandled exception 把进程拖崩。
    log.warn("Idle pool client error", { error });
  });
  pool.on("connect", (client) => {
    client.query(`set time zone '${config.timeZone.replaceAll("'", "''")}'`).catch((error) => {
      log.warn("Failed to set database session timezone", { error });
    });
  });

  return pool;
}

export function getPool() {
  if (!globalThis.__aiImagePool) {
    const pool = createPool();
    if (!pool) {
      throw new Error("DATABASE_URL is not configured");
    }
    globalThis.__aiImagePool = pool;
  }

  return globalThis.__aiImagePool;
}

export async function query<T>(text: string, values: unknown[] = []) {
  const result = await getPool().query(text, values);
  return result as unknown as pg.QueryResult<T & pg.QueryResultRow>;
}

export async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  const existing = globalThis.__aiImagePool;
  if (!existing) return;
  globalThis.__aiImagePool = undefined;
  try {
    await existing.end();
  } catch (error) {
    log.warn("Failed to close database pool cleanly", { error });
  }
}
