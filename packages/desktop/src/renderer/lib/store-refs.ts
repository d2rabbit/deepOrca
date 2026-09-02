/**
 * Store-reference parsing (shared by the message bubble AND the composer):
 * quote bridges insert `@…/.deeporca/deepwiki|reviews/…` absolute paths into
 * prompt text; this module recognizes those tokens so both surfaces render
 * them as dedicated chips instead of raw path text.
 *
 * Pure + UI-free — unit-tests cold. The regex is stateless per call: callers
 * go through `splitStoreRefSegments` / `extractStoreReferences`, never the
 * regex directly (matchAll on a /g regex has per-call semantics, but keeping
 * it private removes the footgun entirely).
 */

export type StoreRefKind = "wiki" | "review";

export interface StoreRefToken {
  kind: StoreRefKind;
  /** Full matched @path token. */
  raw: string;
  /** Match offsets in the source text (end includes the leading @). */
  start: number;
  end: number;
  /** Page title (wiki) or report timestamp (review) for the chip label. */
  label: string;
}

export type StoreRefSegment = { kind: "text"; text: string } | { kind: "ref"; ref: StoreRefToken };

/**
 * Separator-agnostic: Windows quote bridges insert backslash paths
 * (`D:\proj\.deeporca\reviews\…`), POSIX ones forward slashes — both are
 * store references and both deserve the chip treatment (before this the
 * forward-slash-only pattern matched nothing on Windows at all).
 */
const STORE_REF_RE = /@(\S*?[\\/]\.deeporca[\\/](?:deepwiki|reviews)[\\/][^\s@]+(?:\.md|\.json)?)/g;

function refKind(raw: string): StoreRefKind {
  return /[/\\]\.deeporca[/\\]deepwiki[/\\]/.test(raw) ? "wiki" : "review";
}

function refLabel(raw: string, kind: StoreRefKind): string {
  // Separator-agnostic basename, leading @ stripped (Windows paths are
  // backslash-spelled — split("/") alone returned the whole raw token).
  const file = raw.replace(/^@/, "").split(/[\\/]/).pop() ?? raw;
  if (kind === "wiki") {
    return file.replace(/\.md$/, "") || "wiki";
  }
  const mm = file.match(/review-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
  return mm ? `${mm[1]}/${mm[2]}/${mm[3]} ${mm[4]}:${mm[5]}` : file;
}

/** Split text into plain-text and reference segments, in order. */
export function splitStoreRefSegments(text: string): StoreRefSegment[] {
  const segments: StoreRefSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(STORE_REF_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length; // FULL match (m[0] includes the leading @)
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    const kind = refKind(m[1]);
    segments.push({ kind: "ref", ref: { kind, raw: m[0], start, end, label: refLabel(m[0], kind) } });
    last = end;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** All references in a text, plus whether any exist. */
export function extractStoreReferences(text: string): { hasRefs: boolean; refs: StoreRefToken[] } {
  const refs = splitStoreRefSegments(text)
    .filter((s): s is Extract<StoreRefSegment, { kind: "ref" }> => s.kind === "ref")
    .map((s) => s.ref);
  return { hasRefs: refs.length > 0, refs };
}

const STORE_REF_TOKEN_RE = /^@(\S*?[\\/]\.deeporca[\\/](?:deepwiki|reviews)[\\/][^\s@]+(?:\.md|\.json)?)$/;

/** True when the @token is an ALREADY-COMPLETE store reference — the composer
 *  suppresses the file-mention menu for it (suggesting files over a finished
 *  wiki/report reference just produces "no matching files" noise). */
export function isCompleteStoreRef(token: string): boolean {
  return STORE_REF_TOKEN_RE.test(token);
}
