"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * 全局顶部进度条 (YouTube / GitHub 风格).
 *
 * Next.js App Router 没有原生的 navigation lifecycle 事件,要让用户在点
 * 链接 / 提交表单时看到"页面正在切换"的反馈,只能自己组合:
 *
 * 1. 监听文档级的 a-tag click 和 form submit — 这两个是最常见的导航触发器。
 *    点击立刻 setActive(true) + 进度条爬到 80%,给用户即时反馈。
 * 2. pathname / searchParams 变化触发 useEffect — 说明 server component
 *    已完成 streaming 第一帧,进度条爬到 100% 然后淡出。
 *
 * 不打 patch fetch/XHR,避免和 SSE、轮询冲突。`router.refresh()` 这种
 * 内部刷新故意不触发(它本身是后台拉数据,弹个全局进度条反而吵)。
 *
 * 边界处理:
 * - 跨域 / target="_blank" / download / 锚点 / 相同 URL 都跳过
 * - cmd/ctrl/shift/middle-click 系列(打开新 tab/窗口)也跳过
 * - hash-only 变化(#section-1)跳过 — 不算真导航
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const hideTimerRef = useRef<number | null>(null);
  const firstRenderRef = useRef(true);

  // 首次挂载不触发"完成"动画(避免一进页面就闪一下)
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (!active) return;

    // 路由完成 → 进度爬到 100% → 300ms 后淡出
    setProgress(100);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setActive(false);
      setProgress(0);
      hideTimerRef.current = null;
    }, 320);

    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [pathname, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function start() {
      // 已经在显示中就重置回 0 重新爬(避免连点链接时卡在 80%)
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setActive(true);
      setProgress(0);
      // 下一帧再设到 80%,触发 CSS transition 动画
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setProgress(80));
      });
    }

    function handleClick(event: MouseEvent) {
      // 修饰键 / 中键 — 用户想开新 tab,不算本页导航
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button !== 0) return;

      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor || !(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) return;
      if (href.startsWith("javascript:")) return;
      if (href.startsWith("mailto:") || href.startsWith("tel:")) return;

      let target: URL;
      try {
        target = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (target.origin !== window.location.origin) return;
      // 仅 hash 变化不算导航
      if (
        target.pathname === window.location.pathname &&
        target.search === window.location.search &&
        target.hash !== window.location.hash
      ) {
        return;
      }
      // 完全相同的 URL 也不算
      if (target.href === window.location.href) return;

      start();
    }

    function handleSubmit(event: SubmitEvent) {
      const form = event.target as HTMLFormElement | null;
      if (!form) return;
      // method=dialog / 阻止默认行为的表单都跳过(无法可靠检测前者,放过即可)
      start();
    }

    document.addEventListener("click", handleClick, { capture: true });
    document.addEventListener("submit", handleSubmit, { capture: true });
    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
      document.removeEventListener("submit", handleSubmit, { capture: true });
    };
  }, []);

  return (
    <div
      className={`nav-progress${active ? " visible" : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-hidden={!active}
    >
      <div className="nav-progress-bar" style={{ width: `${progress}%` }} />
    </div>
  );
}
