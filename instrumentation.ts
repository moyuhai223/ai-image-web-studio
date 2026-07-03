/**
 * Next.js 启动钩子(server boot 时运行一次,不在 build 期跑)。
 * 用于生产环境的安全断言:弱/默认 AUTH_SECRET 直接拒绝启动。
 */
export async function register() {
  // 仅在 Node.js runtime 执行(edge runtime 无进程级密钥语义)。
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionSecrets } = await import("./lib/config");
  assertProductionSecrets();
}
