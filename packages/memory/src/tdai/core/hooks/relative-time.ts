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
 */

const DAY_MS = 86400000;

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseAnchor(anchorIso?: string): Date | null {
  if (!anchorIso) return null;
  const d = new Date(anchorIso);
  return Number.isFinite(d.getTime()) ? d : null;
}

type Resolver = {
  /** Matches the relative phrase (Chinese substring or English word). */
  pattern: RegExp;
  /** Absolute window for the phrase, given the learned-at anchor. */
  resolve: (anchor: Date) => { start: Date; end: Date } | { day: Date };
};

function startOfIsoWeek(d: Date): Date {
  const day = d.getUTCDay();
  const back = (day + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - back * DAY_MS);
}

function previousMonthRange(anchor: Date): { start: Date; end: Date } {
  const firstOfThis = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1);
  const start = new Date(firstOfThis); // first of previous month
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(firstOfThis - DAY_MS);
  return { start, end };
}

const RESOLVERS: Resolver[] = [
  {
    pattern: /今天|today/gi,
    resolve: (a) => ({ day: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) }),
  },
  {
    pattern: /昨天|yesterday/gi,
    resolve: (a) => ({ day: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) - DAY_MS) }),
  },
  {
    pattern: /前天/g,
    resolve: (a) => ({ day: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) - 2 * DAY_MS) }),
  },
  {
    pattern: /上上周/g,
    resolve: (a) => {
      const monday = startOfIsoWeek(a);
      return { start: new Date(monday.getTime() - 14 * DAY_MS), end: new Date(monday.getTime() - 8 * DAY_MS) };
    },
  },
  {
    pattern: /上周|last week/gi,
    resolve: (a) => {
      const monday = startOfIsoWeek(a);
      return { start: new Date(monday.getTime() - 7 * DAY_MS), end: new Date(monday.getTime() - DAY_MS) };
    },
  },
  {
    pattern: /上个月|last month/gi,
    resolve: previousMonthRange,
  },
  {
    pattern: /最近|recently/gi,
    resolve: (a) => ({
      start: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) - 6 * DAY_MS),
      end: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())),
    }),
  },
];

/** True when any known relative phrase appears in the content. */
function hasRelativePhrase(content: string): boolean {
  return RESOLVERS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(content);
  });
}

/**
 * Annotate every known relative phrase in `content` with its absolute window
 * computed against `anchorIso` (the learned-at timestamp). Idempotent: a
 * phrase already followed by our `（→` marker is left alone. When the content
 * has a known phrase but no usable anchor, the ORIGINAL is returned with a
 * single trailing `（源未锚定）` marker (and no invention).
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
