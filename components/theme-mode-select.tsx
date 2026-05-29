"use client";

import { useEffect, useMemo, useState } from "react";
import { Palette } from "lucide-react";
import {
  normalizeUiThemeMode,
  resolveUiThemeMode,
  uiThemeModeOptions,
  UI_THEME_COOKIE_NAME,
  type UiThemeMode
} from "@/lib/ui-theme-options";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function saveThemeMode(mode: UiThemeMode) {
  window.localStorage.setItem(UI_THEME_COOKIE_NAME, mode);
  document.cookie = `${UI_THEME_COOKIE_NAME}=${encodeURIComponent(mode)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

let themeTransitionTimer: number | undefined;

function applyThemeMode(mode: UiThemeMode) {
  const theme = resolveUiThemeMode(mode);
  const root = document.documentElement;
  // 切换瞬间打开过渡开关:globals.css 里 `.theme-transitioning *` 只在此 class
  // 存在时给 color/background/border 加 transition,避免常态交互/首屏被全局 transition 拖累。
  // 仅在 prefers-reduced-motion: no-preference 下生效(媒体查询里),尊重减少动效偏好。
  root.classList.add("theme-transitioning");
  root.dataset.themeMode = mode;
  root.dataset.theme = theme;
  document.querySelectorAll<HTMLElement>(".shell, .login-wrap").forEach((node) => {
    node.dataset.theme = theme;
  });
  window.clearTimeout(themeTransitionTimer);
  themeTransitionTimer = window.setTimeout(() => {
    root.classList.remove("theme-transitioning");
  }, 280);
}

export function ThemeModeSelect({ initialMode }: { initialMode: UiThemeMode }) {
  const [mode, setMode] = useState<UiThemeMode>(initialMode);
  const currentLabel = useMemo(() => uiThemeModeOptions.find((item) => item.id === mode)?.name ?? "自动", [mode]);

  useEffect(() => {
    const storedMode = window.localStorage.getItem(UI_THEME_COOKIE_NAME);
    if (storedMode) {
      const saved = normalizeUiThemeMode(storedMode);
      if (saved === mode) {
        applyThemeMode(mode);
        return;
      }
      setMode(saved);
      saveThemeMode(saved);
      applyThemeMode(saved);
      return;
    }
    applyThemeMode(mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== "auto") return;
    const timer = window.setInterval(() => applyThemeMode("auto"), 60 * 1000);
    return () => window.clearInterval(timer);
  }, [mode]);

  function updateMode(value: string) {
    const nextMode = normalizeUiThemeMode(value);
    setMode(nextMode);
    saveThemeMode(nextMode);
    applyThemeMode(nextMode);
  }

  return (
    <label className="theme-mode-control" title={`界面主题：${currentLabel}`}>
      <Palette size={16} aria-hidden="true" />
      <select className="theme-mode-select" aria-label="界面主题" value={mode} onChange={(event) => updateMode(event.target.value)}>
        {uiThemeModeOptions.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}
