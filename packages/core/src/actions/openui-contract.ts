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
