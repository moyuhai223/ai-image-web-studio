import { spawn } from "node:child_process";
import { initializeDatabase } from "./database.mjs";

await initializeDatabase({
  databaseUrl: process.env.DATABASE_URL,
  createAdmin: true
});

const server = spawn("node", ["server.js"], {
  stdio: "inherit",
  env: process.env
});

server.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
