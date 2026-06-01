import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const MIGRATION_LOCK_ID = 7419001;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationId(filename) {
  return filename.replace(/\.sql$/i, "");
}

async function readMigrations() {
  const migrationsDir = path.join(process.cwd(), "scripts", "migrations");
  if (!(await pathExists(migrationsDir).catch(() => false))) return [];

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/^\d+[-_].+\.sql$/i.test(entry.name)) continue;
    const fullPath = path.join(migrationsDir, entry.name);
    const sql = await readFile(fullPath, "utf8");
    migrations.push({
      id: migrationId(entry.name),
      filename: entry.name,
      checksum: checksum(sql),
      sql
    });
  }

  return migrations.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function waitForDatabase(databaseUrl) {
  let lastError;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const client = new pg.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {}
      await sleep(1000);
    }
  }
  throw lastError ?? new Error("Database is not reachable");
}

export async function hashPassword(input) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(input, salt, 64);
  return `scrypt$${salt}$${Buffer.from(hash).toString("base64url")}`;
}

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function applyMigrations(client) {
  await ensureMigrationTable(client);
  const migrations = await readMigrations();
  if (migrations.length === 0) return [];

  const applied = [];
  await client.query("select pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_ID]);
  try {
    for (const migration of migrations) {
      const existing = await client.query(
        `select checksum from schema_migrations where id = $1`,
        [migration.id]
      );
      const existingChecksum = existing.rows[0]?.checksum;

      if (existingChecksum) {
        if (existingChecksum !== migration.checksum) {
          throw new Error(`数据库迁移校验不一致：${migration.id}`);
        }
        continue;
      }

      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into schema_migrations (id, checksum) values ($1, $2)`,
          [migration.id, migration.checksum]
        );
        await client.query("commit");
        applied.push(migration.id);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_ID]).catch(() => undefined);
  }

  return applied;
}

export async function initializeDatabase({
  databaseUrl,
  createAdmin = false,
  adminUsername = process.env.ADMIN_USERNAME,
  adminPassword = process.env.ADMIN_PASSWORD,
  log = false
}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  await waitForDatabase(databaseUrl);

  const schemaPath = path.join(process.cwd(), "lib", "schema.sql");
  const schema = await readFile(schemaPath, "utf8");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(schema);
    const appliedMigrations = await applyMigrations(client);

    if (createAdmin) {
      // 新装即使密码留空也建默认管理员 admin/admin,并强制首次登录改密;
      // 管理员若在安装表单里自填了密码,视为已设密、不强制。
      // on conflict do nothing：既有安装(admin 已存在)完全不受影响。
      const username = (adminUsername ?? "").trim() || "admin";
      const explicitPassword = typeof adminPassword === "string" && adminPassword.length > 0;
      const password = explicitPassword ? adminPassword : "admin";
      const mustChangePassword = !explicitPassword;
      const passwordHash = await hashPassword(password);
      await client.query(
        `insert into users (username, password_hash, role, active, must_change_password)
         values ($1, $2, 'admin', true, $3)
         on conflict (username) do nothing`,
        [username, passwordHash, mustChangePassword]
      );
    }

    if (log) {
      const suffix = appliedMigrations.length > 0 ? ` Applied migrations: ${appliedMigrations.join(", ")}.` : "";
      console.log(`Database schema initialized.${suffix}`);
    }
  } finally {
    await client.end();
  }
}
