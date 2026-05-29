"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Cloud, FileText, Heart, Image as ImageIcon, LogOut, Menu, Settings, Table2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { User } from "@/lib/types";

/**
 * 移动端底部 Tab 导航(v0.7.0)。
 *
 * 桌面端(>680px)由 CSS 隐藏(`.mobile-tab-bar { display: none }`),完全不影响
 * 现有顶栏导航;≤680px 时顶栏导航链接被 CSS 隐藏,改由这里承载主导航。
 *
 * 4 个固定 Tab:生成 / 记录 / 收藏 / 更多。"更多"弹出底部 sheet,容纳低频入口
 * (设置仅 admin / 缓存 / 日志 / 退出登录),避免把 6+ 项硬塞进底栏。
 */

type TabItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
};

const TABS: TabItem[] = [
  { href: "/", label: "生成", icon: ImageIcon, isActive: (p) => p === "/" },
  { href: "/records", label: "记录", icon: Table2, isActive: (p) => p.startsWith("/records") },
  { href: "/favorites", label: "收藏", icon: Heart, isActive: (p) => p.startsWith("/favorites") }
];

export function MobileTabBar({ user }: { user: User }) {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);

  // 路由切换后自动收起 sheet(点了 sheet 里的链接跳转后不该残留)。
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // sheet 打开时:锁背景滚动 + Esc 关闭。
  useEffect(() => {
    if (!moreOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const moreActive =
    pathname.startsWith("/settings") ||
    pathname.startsWith("/cache-guide") ||
    pathname.startsWith("/changelog");

  return (
    <>
      <nav className="mobile-tab-bar" aria-label="主导航">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.isActive(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={false}
              className={`mobile-tab ${active ? "active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`mobile-tab ${moreActive || moreOpen ? "active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <Menu size={20} aria-hidden="true" />
          <span>更多</span>
        </button>
      </nav>

      {moreOpen ? (
        <div className="mobile-more-overlay" role="presentation" onClick={() => setMoreOpen(false)}>
          <div
            className="mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="更多"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-head">
              <span className="small muted">更多</span>
              <button type="button" className="status" onClick={() => setMoreOpen(false)} aria-label="关闭">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="mobile-more-links">
              {user.role === "admin" ? (
                <Link href="/settings" prefetch={false} className="mobile-more-link">
                  <Settings size={18} aria-hidden="true" />
                  设置
                </Link>
              ) : null}
              <Link href="/cache-guide" prefetch={false} className="mobile-more-link">
                <Cloud size={18} aria-hidden="true" />
                缓存
              </Link>
              <Link href="/changelog" prefetch={false} className="mobile-more-link">
                <FileText size={18} aria-hidden="true" />
                日志
              </Link>
              <form action="/api/auth/logout" method="post" className="mobile-more-logout">
                <button type="submit" className="mobile-more-link" aria-label={`退出登录：${user.username}`}>
                  <LogOut size={18} aria-hidden="true" />
                  退出登录
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
