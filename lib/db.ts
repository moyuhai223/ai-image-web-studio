import pg from "pg";
import { config } from "./config";

const { Pool } = pg;

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
    max: 10,
    options: postgresTimeZoneOption()
  });
  pool.on("connect", (client) => {
    client.query(`set time zone '${config.timeZone.replaceAll("'", "''")}'`).catch((error) => {
      console.warn("Failed to set database session timezone:", error);
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
    console.warn("Failed to close database pool cleanly:", error);
  }
}
