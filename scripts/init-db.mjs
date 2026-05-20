import { initializeDatabase } from "./database.mjs";

await initializeDatabase({
  databaseUrl: process.env.DATABASE_URL,
  log: true
});
