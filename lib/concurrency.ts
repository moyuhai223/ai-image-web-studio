/**
 * 进程内并发信号量(fail-fast,不排队)。用于给同步 CPU 重活(如 fast 高清化的 sharp 放大)
 * 设并发上限:满了 tryAcquire 返回 null,调用方直接 429,避免请求线程里的重活打满 CPU/内存。
 *
 * 状态挂在 globalThis 上,和 generation-queue 一样跨模块重载/HMR 存活;单进程语义即可
 * (Next standalone 单实例),多实例部署时每实例各自限流,配合反代/DB 层限额兜底。
 */
type SemaphoreState = { active: number };

declare global {
  // eslint-disable-next-line no-var
  var __aiwsSemaphores: Map<string, SemaphoreState> | undefined;
}

const registry = (globalThis.__aiwsSemaphores ??= new Map<string, SemaphoreState>());

/**
 * 尝试占用一个名额。成功返回 release 函数(幂等),失败(已达上限)返回 null。
 * 用法:const release = tryAcquire("fast-upscale", 2); if (!release) return 429; try { ... } finally { release(); }
 */
export function tryAcquire(name: string, max: number): (() => void) | null {
  const limit = Math.max(1, Math.trunc(max));
  const state = registry.get(name) ?? { active: 0 };
  registry.set(name, state);
  if (state.active >= limit) return null;
  state.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
  };
}
