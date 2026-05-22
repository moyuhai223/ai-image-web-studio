import { cookies } from "next/headers";
import { createLogger } from "./logger";
import {
  DEFAULT_UI_THEME_MODE,
  normalizeUiTheme,
  normalizeUiThemeMode,
  resolveUiThemeMode,
  UI_THEME_COOKIE_NAME,
  type UiThemeId,
  type UiThemeMode
} from "./ui-theme-options";

export {
  DEFAULT_UI_THEME,
  DEFAULT_UI_THEME_MODE,
  normalizeUiTheme,
  normalizeUiThemeMode,
  resolveUiThemeMode,
  UI_THEME_COOKIE_NAME,
  type UiThemeId,
  type UiThemeMode
} from "./ui-theme-options";

const log = createLogger("ui-theme");

export type UiThemePreference = {
  mode: UiThemeMode;
  theme: UiThemeId;
};

export async function getUiThemePreference(): Promise<UiThemePreference> {
  let mode: UiThemeMode = DEFAULT_UI_THEME_MODE;
  try {
    const store = await cookies();
    mode = normalizeUiThemeMode(store.get(UI_THEME_COOKIE_NAME)?.value);
  } catch (error) {
    log.warn("Failed to load UI theme", { error });
  }

  return {
    mode,
    theme: resolveUiThemeMode(mode)
  };
}

export async function getUiTheme(): Promise<UiThemeId> {
  const preference = await getUiThemePreference();
  return preference.theme;
}
