/**
 * Act-tag producer for the OpenUI canvas (DesignWorkspace prototype stage).
 *
 * Stamps `data-act` on interactive elements rendered by OpenuiRenderer so that
 *   - the design workspace's selection popover can show its `执行 {action}`
 *     chip (PrototypePanel reads `data-act` off the selected element), and
 *   - act-tag hover labels can be styled by CSS elsewhere (ui-css).
 *
 * OpenUI Lang sources already carry `data-sem`/`data-semantic-id` when the
 * author annotated a node semantically; those elements keep their identity and
 * are never touched here. This module only fills the gap for unlabeled
 * buttons/forms/anchors, deriving the action label from visible text.
 */

/** Longest slug accepted in a `data-act` value (keeps hover tags readable). */
const SLUG_MAX_LENGTH = 24;

/**
 * Turn an element's visible text into a compact slug: trim, collapse
 * whitespace, replace any run of characters that are NOT unicode letters /
 * digits / CJK with a single "-", lowercase latin, cap length, strip
 * leading/trailing dashes. Empty/meaningless text → "".
 */
export function slugifyActLabel(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";
  // CJK ranges are spelled out for readability even though \p{L} covers them —
  // the intent ("keep CJK, latin, digits; dash everything else") reads clearer.
  let slug = collapsed.replace(/[^\p{L}\p{N}\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/gu, "-");
  slug = slug.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  if (slug.length > SLUG_MAX_LENGTH) {
    slug = slug.slice(0, SLUG_MAX_LENGTH);
    // A hard slice can orphan the high half of an astral letter (\p{L} spans
    // surrogate pairs); drop it rather than emit a lone surrogate.
    const tail = slug.charCodeAt(slug.length - 1)!;
    if (tail >= 0xd800 && tail <= 0xdbff) slug = slug.slice(0, -1);
  }
  return slug.replace(/^-+|-+$/g, "");
}

/**
 * Idempotent annotation pass over a rendered canvas subtree. Safe to run
 * repeatedly (and on mutation bursts): elements already carrying `data-act`,
 * `data-sem` or `data-semantic-id` are skipped, never overwritten. Elements
 * whose text produces an empty slug (icon-only buttons, decorative anchors)
 * are left untagged.
 */
export function annotateActTags(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>("button:not([data-act]):not([data-sem])")) {
    const slug = slugifyActLabel(el.textContent ?? "");
    if (slug) el.setAttribute("data-act", `act:${slug}`);
  }
  for (const el of root.querySelectorAll<HTMLElement>("form:not([data-act])")) {
    el.setAttribute("data-act", "form:submit");
  }
  for (const el of root.querySelectorAll<HTMLElement>("a[href]:not([data-act])")) {
    const slug = slugifyActLabel(el.textContent ?? "");
    if (slug) el.setAttribute("data-act", `nav:goto:${slug}`);
  }
}
