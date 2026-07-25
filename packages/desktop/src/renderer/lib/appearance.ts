// Appearance (light/dark) system for the desktop renderer.
//
// The stylesheet is still chosen by OS platform (Aqua on macOS/Linux, Metro on
// Windows) — that split adapts to each system's native look and is intentional.
// On top of that, each theme ships BOTH a light and a dark variant, selected via
// the `data-appearance` attribute on <html> and driven by CSS variable overrides.
//
// Default per platform matches the theme's native tone: Aqua → light, Metro → dark.
// The user's explicit choice is persisted and wins over the platform default.

export type Appearance = "light" | "dark";
export type ReasoningMode = "normal" | "expanded" | "hidden";

// The visual theme picks the stylesheet that binds the `--ui-*` vocabulary.
// Aqua ships on macOS, Metro on Windows, Glass (glassmorphism) is the Linux
// default and an opt-in alternative on macOS. Fusion is a Windows-only theme
// blending Win8 tile colors with Win11 glassy breath. The user's explicit
// choice is persisted and wins over the platform default.
export type Theme = "aqua" | "metro" | "glass" | "fusion";

const APPEARANCE_KEY = "deepcode.appearance";
const REASONING_KEY = "deepcode.reasoningMode";
const THEME_KEY = "deepcode.theme";

/** DOM id given to the injected theme stylesheet so it can be swapped at runtime. */
export const THEME_LINK_ID = "deepcode-theme-css";

const THEME_STYLESHEETS: Record<Theme, string> = {
  aqua: "./styles.css",
  metro: "./styles-metro.css",
  glass: "./styles-glass.css",
  fusion: "./styles-fusion.css",
};

/** The stylesheet href that binds `--ui-*` tokens for a theme. */
export function themeStylesheet(theme: Theme): string {
  return THEME_STYLESHEETS[theme];
}

/** The native theme for a platform (before any persisted user override). */
export function defaultTheme(platform: string): Theme {
  if (platform === "win32") return "metro";
  if (platform === "linux") return "glass";
  return "aqua";
}

/** The non-glass theme a platform toggles back to when Glass is turned off. */
export function baseTheme(platform: string): Theme {
  return platform === "win32" ? "metro" : "aqua";
}

/**
 * The themes offered to a platform in the settings panel. Themes are
 * platform-scoped — Windows exposes Metro + Fusion, macOS exposes Aqua + Glass,
 * Linux only Glass. Defaults are NOT changed by this map.
 */
export function availableThemes(platform: string): Theme[] {
  if (platform === "win32") return ["metro", "fusion"];
  if (platform === "darwin") return ["aqua", "glass"];
  return ["glass"];
}

export function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "aqua" || stored === "metro" || stored === "glass" || stored === "fusion" ? stored : null;
  } catch {
    return null;
  }
}

export function resolveTheme(platform: string): Theme {
  return getStoredTheme() ?? defaultTheme(platform);
}

/** Swap the injected theme stylesheet in place (no reload required). */
export function applyTheme(theme: Theme): void {
  const link = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null;
  if (link) {
    link.href = themeStylesheet(theme);
  }
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Persisting is best-effort.
  }
}

/** The native tone for a platform's default stylesheet.
 *  Glass (Prism) is always dark-first regardless of platform. */
export function defaultAppearance(platform: string, theme?: Theme): Appearance {
  if (theme === "glass") return "dark";
  return platform === "win32" ? "dark" : "light";
}

export function getStoredAppearance(): Appearance | null {
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

export function resolveAppearance(platform: string, theme?: Theme): Appearance {
  return getStoredAppearance() ?? defaultAppearance(platform, theme);
}

export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.appearance = appearance;
}

export function setAppearance(appearance: Appearance): void {
  applyAppearance(appearance);
  try {
    localStorage.setItem(APPEARANCE_KEY, appearance);
  } catch {
    // Persisting is best-effort.
  }
}

export function getStoredReasoningMode(): ReasoningMode {
  try {
    const stored = localStorage.getItem(REASONING_KEY);
    if (stored === "normal" || stored === "expanded" || stored === "hidden") {
      return stored;
    }
  } catch {
    // Fall through to default.
  }
  return "normal";
}

export function setReasoningMode(mode: ReasoningMode): void {
  try {
    localStorage.setItem(REASONING_KEY, mode);
  } catch {
    // Persisting is best-effort.
  }
}

/** The next mode when cycling the reasoning-display toggle. */
export function nextReasoningMode(mode: ReasoningMode): ReasoningMode {
  return mode === "normal" ? "expanded" : mode === "expanded" ? "hidden" : "normal";
}
