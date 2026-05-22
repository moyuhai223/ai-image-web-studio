import { spawn } from "node:child_process";
import { initializeDatabase } from "./database.mjs";

const SHUTDOWN_GRACE_MS = 25_000;
const FORWARDED_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];

await initializeDatabase({
  databaseUrl: process.env.DATABASE_URL,
  createAdmin: true
});

const server = spawn("node", ["server.js"], {
  stdio: "inherit",
  env: process.env
});

let shuttingDown = false;
let forceKillTimer = null;

server.on("exit", (code, signal) => {
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

server.on("error", (error) => {
  console.error("[start-production] failed to spawn server:", error);
  process.exit(1);
});

function forwardSignal(signal) {
  if (shuttingDown) {
    console.warn(`[start-production] received ${signal} again; SIGKILL forced.`);
    if (!server.killed) server.kill("SIGKILL");
    return;
  }
  shuttingDown = true;
  console.log(`[start-production] received ${signal}, forwarding to server (timeout ${SHUTDOWN_GRACE_MS}ms)`);
  if (!server.killed) server.kill(signal);
  forceKillTimer = setTimeout(() => {
    if (!server.killed) {
      console.warn(`[start-production] server did not exit within ${SHUTDOWN_GRACE_MS}ms, sending SIGKILL`);
      server.kill("SIGKILL");
    }
  }, SHUTDOWN_GRACE_MS);
  forceKillTimer.unref?.();
}

for (const signal of FORWARDED_SIGNALS) {
  process.on(signal, () => forwardSignal(signal));
}
