export const uiThemes = [
  {
    id: "studio",
    name: "专业工作台",
    description: "浅色、紧凑、适合长期使用"
  },
  {
    id: "gallery",
    name: "图片画廊",
    description: "图片更突出，按北京时间自动浅色/深色"
  },
  {
    id: "dark",
    name: "深色创作台",
    description: "深色背景，适合夜间创作"
  }
] as const;

export type UiThemeId = (typeof uiThemes)[number]["id"];
export type UiThemeMode = UiThemeId | "auto";
/** 解析后的实际主题:在可选主题之外多出「深色画廊」——它不是可选模式,只由 gallery 在夜间解析得到。 */
export type ResolvedUiTheme = UiThemeId | "gallery-dark";

export const DEFAULT_UI_THEME: UiThemeId = "studio";
export const DEFAULT_UI_THEME_MODE: UiThemeMode = "auto";
export const UI_THEME_COOKIE_NAME = "ai-image-theme-mode";

export const uiThemeModeOptions: readonly {
  id: UiThemeMode;
  name: string;
  description: string;
}[] = [
  {
    id: "auto",
    name: "自动",
    description: "按北京时间白天/夜间自动切换"
  },
  ...uiThemes
];

export function normalizeUiTheme(value: unknown): UiThemeId {
  return uiThemes.some((theme) => theme.id === value) ? (value as UiThemeId) : DEFAULT_UI_THEME;
}

export function normalizeUiThemeMode(value: unknown): UiThemeMode {
  if (value === "auto") return "auto";
  return uiThemes.some((theme) => theme.id === value) ? (value as UiThemeId) : DEFAULT_UI_THEME_MODE;
}

function getShanghaiHour(date: Date) {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  }).format(date);
  const parsed = Number(hour);
  return parsed === 24 ? 0 : parsed;
}

export function resolveAutoUiTheme(date = new Date()): UiThemeId {
  const hour = getShanghaiHour(date);
  return hour >= 7 && hour < 19 ? "studio" : "dark";
}

export function resolveUiThemeMode(mode: UiThemeMode, date = new Date()): ResolvedUiTheme {
  if (mode === "auto") return resolveAutoUiTheme(date);
  // 画廊模式跟随白天/夜间:沿用 auto 的 7/19 点边界,夜间解析成深色画廊。
  if (mode === "gallery") return resolveAutoUiTheme(date) === "dark" ? "gallery-dark" : "gallery";
  return normalizeUiTheme(mode);
}
