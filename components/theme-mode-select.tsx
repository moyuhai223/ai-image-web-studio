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

function applyThemeMode(mode: UiThemeMode) {
  const theme = resolveUiThemeMode(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll<HTMLElement>(".shell, .login-wrap").forEach((node) => {
    node.dataset.theme = theme;
  });
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
