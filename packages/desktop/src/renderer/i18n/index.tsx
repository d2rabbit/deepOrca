// Minimal i18n runtime for the renderer: a React context that holds the active
// locale (persisted to localStorage, auto-detected on first run) and exposes a
// `t(key, params)` helper with `{name}` placeholder interpolation.

import { createContext, useCallback, useContext, useMemo, useState, type JSX, type ReactNode } from "react";
import { messages, type Locale, type MessageKey } from "./messages";

type TranslateParams = Record<string, string | number>;

export type Translate = (key: MessageKey, params?: TranslateParams) => string;

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const STORAGE_KEY = "deeporca.locale";

const SUPPORTED_LOCALES: Locale[] = ["en", "zh", "zh-TW", "zh-HK", "ja", "ko"];

/** Map a `navigator.language` tag to one of the supported locales. */
function mapNavigatorLocale(tag: string): Locale {
  const lower = tag.toLowerCase();
  if (lower.startsWith("zh")) {
    if (lower.includes("tw") || lower.includes("hant-tw")) {
      return "zh-TW";
    }
    if (lower.includes("hk") || lower.includes("mo") || lower.includes("hant")) {
      return "zh-HK";
    }
    return "zh";
  }
  if (lower.startsWith("ja")) {
    return "ja";
  }
  if (lower.startsWith("ko")) {
    return "ko";
  }
  return "en";
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // localStorage may be unavailable; fall through to navigator detection.
  }
  return typeof navigator !== "undefined" ? mapNavigatorLocale(navigator.language) : "en";
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, params) => {
      let text = messages[locale][key] ?? messages.en[key] ?? key;
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
        }
      }
      return text;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}

/**
 * Translate a dynamically-built key (e.g. `action.${id}.desc`) with a fallback
 * for when the catalog has no entry — `t()` returns the raw key when missing,
 * so callers pass the backend-provided value (action descriptions, category
 * tokens, …) as the fallback.
 */
export function tOr(t: Translate, key: string, fallback: string): string {
  const value = t(key as MessageKey);
  return value === key ? fallback : value;
}

export type { Locale, MessageKey };
