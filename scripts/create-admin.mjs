import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const [, , username, password] = process.argv;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

if (!username || !password || password.length < 8) {
  console.error("Usage: npm run user:create -- <username> <password-min-8-chars>");
  process.exit(1);
}

async function hashPassword(input) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(input, salt, 64);
  return `scrypt$${salt}$${Buffer.from(hash).toString("base64url")}`;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const passwordHash = await hashPassword(password);
  await client.query(
    `insert into users (username, password_hash, role, active, must_change_password)
     values ($1, $2, 'admin', true, false)
     on conflict (username) do update
     set password_hash = excluded.password_hash, role = 'admin', active = true, must_change_password = false, updated_at = now()`,
    [username, passwordHash]
  );
  console.log(`Admin user saved: ${username}`);
} finally {
  await client.end();
}
