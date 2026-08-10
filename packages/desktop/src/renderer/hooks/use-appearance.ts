import { useCallback, useEffect, useState } from "react";
import {
  applyLineVariant,
  baseTheme,
  defaultAppearance,
  getStoredLineVariant,
  getStoredReasoningMode,
  nextReasoningMode,
  setAppearance as persistAppearance,
  setLineVariant as persistLineVariant,
  setReasoningMode as persistReasoningMode,
  setTheme as persistTheme,
  resolveAppearance,
  resolveTheme,
  type Appearance,
  type LineVariant,
  type ReasoningMode,
  type Theme,
} from "../lib/appearance";

/**
 * Theme / appearance / reasoning-mode preferences.
 *
 * Extracted from App.tsx verbatim.
 *
 * `initFromPlatform` is imperative on purpose. Boot resolves the theme from the
 * platform inside the same async continuation that sets projectRoot/homeDir/
 * platform, so React batches all of it into one commit. Deriving the theme from
 * `platform` in an effect here instead would produce a second commit and a
 * one-frame flash of the "light"/"aqua" defaults.
 */
export type AppearanceState = {
  appearance: Appearance;
  theme: Theme;
  lineVariant: LineVariant;
  reasoningMode: ReasoningMode;
  /** Call from boot, in the same continuation as the other boot setters. */
  initFromPlatform: (platform: string) => void;
  handleToggleAppearance: () => void;
  handleToggleTheme: () => void;
  handleToggleLineVariant: () => void;
  handleSelectTheme: (next: Theme) => void;
  handleCycleReasoning: () => void;
};

export function useAppearance(platform: string): AppearanceState {
  const [appearance, setAppearanceState] = useState<Appearance>("light");
  const [theme, setThemeState] = useState<Theme>("aqua");
  const [lineVariant, setLineVariantState] = useState<LineVariant>(() => getStoredLineVariant());
  const [reasoningMode, setReasoningModeState] = useState<ReasoningMode>(() => getStoredReasoningMode());

  // Kept `[]`-stable: boot's effect dep array must not change identity, or the
  // whole boot chain re-runs (re-registering IPC listeners and reloading the
  // session the user is looking at).
  const initFromPlatform = useCallback((plat: string) => {
    const resolvedTheme = resolveTheme(plat);
    setAppearanceState(resolveAppearance(plat, resolvedTheme));
    setThemeState(resolvedTheme);
  }, []);

  const handleToggleAppearance = useCallback(() => {
    setAppearanceState((prev) => {
      const next: Appearance = prev === "dark" ? "light" : "dark";
      persistAppearance(next);
      return next;
    });
  }, []);

  const handleToggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "glass" ? baseTheme(platform) : "glass";
      persistTheme(next);
      // Auto-switch appearance to match the theme's native tone.
      const tone = defaultAppearance(platform, next);
      setAppearanceState(tone);
      persistAppearance(tone);
      return next;
    });
  }, [platform]);

  // Line theme flavour toggle: original stroke look ↔ punk (2077 tribute).
  const handleToggleLineVariant = useCallback(() => {
    setLineVariantState((prev) => {
      const next: LineVariant = prev === "punk" ? "stroke" : "punk";
      persistLineVariant(next);
      return next;
    });
  }, []);

  // The punk recolor only applies while the Line theme is active.
  useEffect(() => {
    applyLineVariant(theme === "line" ? lineVariant : "stroke");
  }, [theme, lineVariant]);

  // Theme selection from the settings panel (General tab). Applies immediately
  // (swaps the stylesheet link) and persists — no reload needed.
  const handleSelectTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      persistTheme(next);
      const tone = defaultAppearance(platform, next);
      setAppearanceState(tone);
      persistAppearance(tone);
    },
    [platform]
  );

  const handleCycleReasoning = useCallback(() => {
    setReasoningModeState((prev) => {
      const next = nextReasoningMode(prev);
      persistReasoningMode(next);
      return next;
    });
  }, []);

  return {
    appearance,
    theme,
    lineVariant,
    reasoningMode,
    initFromPlatform,
    handleToggleAppearance,
    handleToggleTheme,
    handleToggleLineVariant,
    handleSelectTheme,
    handleCycleReasoning,
  };
}
