/**
 * Shared SVG attribute presets for the icon library.
 *
 * Every icon in `ui/icons/` spreads one of these onto its `<svg>` root so the
 * whole library stays consistent: fixed render size + viewBox, `fill="none"`,
 * hidden from the accessibility tree, and stroke colors inherited from
 * `currentColor` at the usage site (active/hover states come free).
 *
 * Presets by category (see the sibling modules):
 *  - `S` — default 18px rail/UI glyph on a 20×20 canvas (rail.tsx, common.tsx)
 *  - `W` — 22px welcome-card glyph on a 20×20 canvas (welcome.tsx)
 *  - `T` — 13px tool glyph on a 16×16 canvas (tools.tsx)
 *  - `C` — 12px inline chat glyph on a 16×16 canvas (common.tsx)
 */
export const S = {
  width: 18,
  height: 18,
  viewBox: "0 0 20 20",
  fill: "none",
  "aria-hidden": true,
  focusable: false,
} as const;
export const W = {
  width: 22,
  height: 22,
  viewBox: "0 0 20 20",
  fill: "none",
  "aria-hidden": true,
  focusable: false,
} as const;
export const T = {
  width: 13,
  height: 13,
  viewBox: "0 0 16 16",
  fill: "none",
  "aria-hidden": true,
  focusable: false,
} as const;
export const C = {
  width: 12,
  height: 12,
  viewBox: "0 0 16 16",
  fill: "none",
  "aria-hidden": true,
  focusable: false,
} as const;
