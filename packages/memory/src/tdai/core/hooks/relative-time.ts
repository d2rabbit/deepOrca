/**
 * Render-time relative-time resolution (specs/cmb-adoption CMB-7, batch B).
 *
 * MemBrain's budget_pack resolves inline relative dates at PACK time "to avoid
 * LLM date arithmetic errors" — the arithmetic happens in code, the consuming
 * LLM never has to work out what "上周" means. Same move here, adapted to this
 * repo's rules:
 *
 *   - extraction stays faithful (L1 rule 4 keeps "上周" verbatim in content);
 *   - rendering ANNOTATES in place — the original phrase is never rewritten,
 *     only followed by `（→ 2026-08-25 ~ 2026-08-31）` so recall stays
 *     source-faithful while the reader gets the resolved absolute window;
 *   - when a known relative phrase exists but the record carries no anchor
 *     timestamp, the line is marked `（源未锚定）` — honest over invented.
 *
 * The anchor is the record's own timestamp (the moment the memory was
 * learned), matching the 获知时间 semantics CMB-7 separates from event time.
 *
 * Calendar semantics: "今天/昨天/上周" are LOCAL-calendar phrases, so day /
 * week / month boundaries resolve in the machine's local timezone (the recall
 * runs in-process on the user's own machine, making local time the recording
 * timezone). English phrases match on word boundaries so "the last weekly
 * report" is not annotated.
 */

type Resolver = {
  /** Matches the relative phrase — CJK literals, or English with \b guards. */
  pattern: RegExp;
  /** Absolute window for the phrase, given the learned-at anchor (local day). */
  resolve: (anchor: Date) => { start: Date; end: Date } | { day: Date };
};

function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const out = localMidnight(d);
  out.setDate(out.getDate() + days);
  return out;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfIsoWeek(d: Date): Date {
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -back);
}

function previousMonthRange(anchor: Date): { start: Date; end: Date } {
  const start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth(), 0);
  return { start, end };
}

const RESOLVERS: Resolver[] = [
  {
    pattern: /今天|\btoday\b/gi,
    resolve: (a) => ({ day: localMidnight(a) }),
  },
  {
    pattern: /昨天|\byesterday\b/gi,
    resolve: (a) => ({ day: addDays(a, -1) }),
  },
  {
    pattern: /前天/g,
    resolve: (a) => ({ day: addDays(a, -2) }),
  },
  {
    pattern: /上上周/g,
    resolve: (a) => {
      const monday = startOfIsoWeek(a);
      return { start: addDays(monday, -14), end: addDays(monday, -8) };
    },
  },
  {
    pattern: /上周|\blast week\b/gi,
    resolve: (a) => {
      const monday = startOfIsoWeek(a);
      return { start: addDays(monday, -7), end: addDays(monday, -1) };
    },
  },
  {
    pattern: /上个月|\blast month\b/gi,
    resolve: previousMonthRange,
  },
  {
    pattern: /最近|\brecently\b/gi,
    resolve: (a) => ({ start: addDays(a, -6), end: localMidnight(a) }),
  },
];

/** True when any known relative phrase appears in the content. */
function hasRelativePhrase(content: string): boolean {
  return RESOLVERS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(content);
  });
}

function parseAnchor(anchorIso?: string): Date | null {
  if (!anchorIso) return null;
  const d = new Date(anchorIso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Annotate every known relative phrase in `content` with its absolute window
 * computed against `anchorIso` (the learned-at timestamp), in the local
 * calendar. Idempotent: a phrase already followed by our `（→` marker is left
 * alone. When the content has a known phrase but no usable anchor, the
 * ORIGINAL is returned with a single trailing `（源未锚定）` marker (and no
 * invention).
 */
export function resolveRelativeTimes(content: string, anchorIso?: string): string {
  const anchor = parseAnchor(anchorIso);
  if (!anchor) {
    return hasRelativePhrase(content) ? `${content}（源未锚定）` : content;
  }

  let out = content;
  let touched = false;
  for (const { pattern, resolve } of RESOLVERS) {
    out = out.replace(pattern, (match, offset: number, whole: string) => {
      if (whole.startsWith("（→", offset + match.length)) return match; // already annotated
      touched = true;
      const window = resolve(anchor);
      const annotation =
        "day" in window ? `（→ ${fmtDate(window.day)}）` : `（→ ${fmtDate(window.start)} ~ ${fmtDate(window.end)}）`;
      return `${match}${annotation}`;
    });
  }
  return touched ? out : content;
}
