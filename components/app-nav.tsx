import Link from "next/link";
import { Cloud, FileText, Heart, Image, LogOut, Settings, Table2 } from "lucide-react";
import { JobNotificationCenter } from "./job-notification-center";
import { MobileTabBar } from "./mobile-tab-bar";
import { ReferenceBasketTray } from "./reference-basket";
import { ThemeModeSelect } from "./theme-mode-select";
import type { User } from "@/lib/types";
import type { UiThemeMode } from "@/lib/ui-theme-options";
import { APP_VERSION_LABEL } from "@/lib/version";

export function AppNav({ user, themeMode }: { user: User; themeMode: UiThemeMode }) {
  return (
    <header className="topbar">
      {/* topbar-inner 把内容宽度与 workspace 对齐(同 max-width + margin auto)。
          外层 header 保留全宽背景/边框/sticky 行为,内层做布局和居中,
          这样在 2K+ 屏上 brand/nav 不再贴左边、与居中的正文左右对不齐。 */}
      <div className="topbar-inner">
        <Link className="brand" href="/" prefetch={false}>
          <span className="brand-mark">
            <Image size={18} />
          </span>
          <span className="brand-title">AI Image Studio</span>
          <span className="version-pill">{APP_VERSION_LABEL}</span>
        </Link>
        <nav className="nav">
          <Link href="/records" prefetch={false} aria-label="记录" title="记录">
            <Table2 size={16} />
            <span className="nav-label">记录</span>
          </Link>
          <Link href="/favorites" prefetch={false} aria-label="收藏" title="收藏">
            <Heart size={16} />
            <span className="nav-label">收藏</span>
          </Link>
          <Link href="/cache-guide" prefetch={false} aria-label="缓存" title="缓存">
            <Cloud size={16} />
            <span className="nav-label">缓存</span>
          </Link>
          <Link href="/changelog" prefetch={false} aria-label="日志" title="日志">
            <FileText size={16} />
            <span className="nav-label">日志</span>
          </Link>
          {user.role === "admin" ? (
            <Link href="/settings" prefetch={false} aria-label="设置" title="设置">
              <Settings size={16} />
              <span className="nav-label">设置</span>
            </Link>
          ) : null}
          <ThemeModeSelect initialMode={themeMode} />
          <form action="/api/auth/logout" method="post">
            <button className="ghost-button" type="submit" aria-label={`退出登录：${user.username}`} title={`退出登录：${user.username}`}>
              <LogOut size={16} />
              <span className="nav-label">{user.username}</span>
            </button>
          </form>
        </nav>
        <JobNotificationCenter />
        <ReferenceBasketTray />
      </div>
      {/* 移动端底部 Tab 导航:桌面端 CSS 隐藏,≤680px 承载主导航。
          fixed 定位,放 header 末尾即可,不影响顶栏布局。 */}
      <MobileTabBar user={user} />
    </header>
  );
}
