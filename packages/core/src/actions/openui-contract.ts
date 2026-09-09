/**
 * Shared OpenUI Lang interaction-contract sentences for the design pipeline.
 *
 * The same contract is restated in several prompts and tool descriptions:
 * prototype revise (core), design materialize/revise (core), and the desktop
 * a2ui-mcp render_openui/update_openui tool descriptions. Keeping one source
 * stops the wording from drifting — previously the two "preserve" copies were
 * verbatim duplicates while the design-side variants had already diverged.
 */

/** For revisions: what the model must keep from the existing program. */
export const OPENUI_PRESERVE_CONTRACT =
  "Preserve the $page state, ternary view switching, and Action([@Set...]) navigation — " +
  "the result must stay ONE interactive application, not stacked screens.";

/** For creation: the single-interactive-app requirement with concrete syntax. */
export const OPENUI_CREATE_CONTRACT =
  'It must be ONE directly interactive application, never stacked screens: declare `$page = "<first-page>"`, ' +
  'render each page\'s view behind a ternary (`$page == "orders" ? ordersView : null`), and navigate via ' +
  'buttons carrying `Action([@Set($page, "target")])` under a persistent shell.';

/**
 * Prototype quality bar distilled from the pm-designer-openui quality contract
 * (interactive / high-fidelity / editable). One shared sentence set so the
 * prompt cannot drift from the skill — previously materialize restated both
 * contracts inline and had already diverged.
 */
export const OPENUI_QUALITY_CONTRACT =
  "Quality bar: the prototype must feel ALIVE — every implied control (tabs/modals/forms/filters/" +
  "switches/row actions) works via $state + Action, no dead buttons, every page reachable in one click, " +
  "empty/confirm/loading feedback wired; HIGH FIDELITY — real product copy in the document's language, " +
  "believable internally-consistent demo data, at most one primary CTA per screen, no lorem ipsum; " +
  "EDITABLE — semantic identifiers and demo data factored into named statements.";

/** Target platforms for device-variant prototypes (user ask 2026-09-09: 三端
 *  必须是平台化适配,不是同一程序挤宽度). */
export type OpenuiDevice = "desktop" | "mobile" | "tablet";

export const OPENUI_DEVICES: readonly OpenuiDevice[] = ["desktop", "mobile", "tablet"];

/**
 * Per-platform shell contracts — each device gets a STRUCTURALLY different
 * application (navigation model, column layout, density), never the same
 * program squeezed to a width. Shared with the skill's 平台适配契约 section.
 */
export const OPENUI_DEVICE_CONTRACTS: Record<OpenuiDevice, string> = {
  desktop:
    "PLATFORM CONTRACT — desktop (≥1200px): persistent LEFT SIDEBAR navigation (menu items with labels, active state) " +
    "plus a slim top bar (page title + primary global action); content uses the wide canvas — multi-column card grids, " +
    "side-by-side panels, dense data TABLES with row actions. Never a single centered column.",
  mobile:
    "PLATFORM CONTRACT — mobile (375px): BOTTOM TAB BAR navigation pinned at the bottom of every page " +
    "(3-5 tabs, icon-style short labels, active state), content is ONE stacked column sized for one hand; " +
    "the primary CTA sits at the bottom within thumb reach; forms are full-width stacked fields; replace wide tables " +
    "with CARD LISTS (one card per row). Never reuse the desktop sidebar or a wide table.",
  tablet:
    "PLATFORM CONTRACT — tablet (768px): SPLIT VIEW — a narrow left rail (navigation or master list) beside a " +
    "detail pane; two-column layouts where desktop uses three and mobile uses one; comfortable touch targets. " +
    "Neither a stretched phone column nor a shrunken desktop grid.",
};

/** Parse/normalize a caller-supplied device list against the known set. */
export function normalizeOpenuiDevices(devices?: readonly string[]): OpenuiDevice[] {
  if (!devices || devices.length === 0) return ["desktop"];
  const known = new Set<string>(OPENUI_DEVICES);
  const picked = devices.map((d) => d.trim()).filter((d): d is OpenuiDevice => known.has(d));
  return picked.length > 0 ? [...new Set(picked)] : ["desktop"];
}
