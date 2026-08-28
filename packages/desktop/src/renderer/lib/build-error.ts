// Build-error second-stage translation.
//
// Main-process build stages (wiki-cli, codegraph, arch-scan) keep raw CLI
// errors verbatim — the original text is what debugging needs. The localized
// FIX HINT rides along as a machine-readable `[hint:...]` token instead of
// hardcoded prose, because main has no i18n runtime and (for the most common
// failure) the LLM itself is unreachable — an LLM translation pass would
// compound the outage. The renderer parses the tokens here and re-renders the
// hints at display time. Hint copy ships in exactly TWO languages (zh + en
// canonical texts in messages.ts; product call to keep maintenance light) —
// the other locale files reference the canonical text verbatim instead of
// carrying their own translations.

import type { Translate } from "../i18n";

/** Hint kinds main is allowed to embed — extend here and in messages.ts together. */
export type BuildHintKind = "wiki-network" | "wiki-timeout" | "wiki-empty";

export type BuildHint = {
  kind: BuildHintKind;
  /** Model id present in the token (`model=<id>`), when known. Never a secret. */
  model?: string;
};

const HINT_TOKEN = /\s*\[hint:(wiki-network|wiki-timeout|wiki-empty)(?:\s+model=([^\]\s]+))?\]/g;

/** Split a raw build error into its verbatim text and any embedded hints. */
export function splitBuildError(raw: string): { text: string; hints: BuildHint[] } {
  const hints: BuildHint[] = [];
  const text = raw.replace(HINT_TOKEN, (_match, kind: BuildHintKind, model?: string) => {
    hints.push(model ? { kind, model } : { kind });
    return "";
  });
  return { text: text.replace(/\s{2,}/g, " ").trim(), hints };
}

/**
 * Render a build error for display: verbatim text (optionally clipped with an
 * ellipsis — hints never count against the clip budget) followed by the
 * localized fix hints on one line (A2UI Text and title spans don't rely on
 * newline rendering). Unmarked errors pass through unchanged.
 */
export function formatBuildError(raw: string, t: Translate, limit?: number): string {
  const { text, hints } = splitBuildError(raw);
  if (hints.length === 0) {
    return limit !== undefined && raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
  }
  const clipped = limit !== undefined && text.length > limit ? `${text.slice(0, limit)}…` : text;
  const rendered = hints.map((h) => translateHint(h, t)).join(" ");
  return clipped ? `${clipped} — ${rendered}` : rendered;
}

function translateHint(hint: BuildHint, t: Translate): string {
  switch (hint.kind) {
    case "wiki-network": {
      let text = t("buildHint.wikiNetwork");
      if (hint.model) text += ` ${t("buildHint.modelUsed", { model: hint.model })}`;
      return text;
    }
    case "wiki-timeout":
      return t("buildHint.wikiTimeout");
    case "wiki-empty":
      return t("buildHint.wikiEmpty");
  }
}
