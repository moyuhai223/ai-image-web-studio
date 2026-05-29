import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_SC } from "next/font/google";
import { Suspense } from "react";
import { NavigationProgress } from "@/components/navigation-progress";
import "./globals.css";

/**
 * 字体加载策略(v0.5.x UI 美化):
 *
 * - Inter:西文主字体,可变字重,Google Fonts 上和 Adobe Source Sans 同级
 *   的现代 sans。比 Arial 更紧凑、x-height 更高。
 * - Noto Sans SC:中文主字体(思源黑体简体)。Google Fonts 体积大,next/font
 *   会按 unicode-range 自动子集化,首屏只拉用到的字符,后续按需补齐。
 * - JetBrains Mono:数据展示和代码用等宽字体,数字对齐效果远好于
 *   雅黑/Consolas 兜底。
 *
 * 三组字体都用 `variable` 形式注入 `<html class>`,在 globals.css 里通过
 * `var(--font-sans)` / `var(--font-mono)` 引用。`display: "swap"` 避免
 * FOIT(字体未加载时空白),容忍极短时间 FOUT(回退字体到目标字体的切换)。
 */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans-latin",
  display: "swap",
  axes: ["opsz"]
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-sans-cjk",
  display: "swap",
  weight: ["400", "500", "700"],
  preload: false
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "AI Image Web Studio",
  description: "Small-team AI image generation workspace"
};

/**
 * viewport-fit=cover 让页面延伸到刘海/圆角区域,配合 globals.css 里的
 * env(safe-area-inset-*) 把顶栏、底部 Tab 栏、参考篮托盘避开刘海与 home indicator。
 * 不设 maximumScale,保留用户缩放(无障碍)。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${notoSansSC.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* useSearchParams 在 App Router 里必须包 Suspense,否则整个 body 会
            被强制 client-side 渲染。fallback=null 让进度条静默到首次激活。 */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
