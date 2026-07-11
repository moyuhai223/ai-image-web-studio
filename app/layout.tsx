import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_SC, Plus_Jakarta_Sans } from "next/font/google";
import { Suspense } from "react";
import { NavigationProgress } from "@/components/navigation-progress";
import { getUiThemePreference } from "@/lib/ui-theme";
import "./globals.css";
// 独立美化主题包(玻璃拟态+黑曜石霓虹):必须在 globals.css 之后引入,靠源序覆盖基础 token;
// 不想要这套皮肤时注释掉这一行即回默认主题。
import "./theme-pack.css";

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

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap"
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // SSR 时把解析出的主题写到 <html>,让首屏背景/色彩模式就正确,消除深色主题的白闪(FOUC)。
  const { theme, mode } = await getUiThemePreference();
  return (
    <html
      lang="zh-CN"
      data-theme={theme}
      data-theme-mode={mode}
      className={`${inter.variable} ${notoSansSC.variable} ${jetbrainsMono.variable} ${plusJakartaSans.variable}`}
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
