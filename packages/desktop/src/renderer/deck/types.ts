// Shared types for the Deck experimental layout.

/** Every overlay/drawer the dock and shortcuts can open. */
export type OverlayKind =
  | "tape"
  | "control-center"
  | "notifications"
  | "theme"
  | "settings"
  | "files"
  | "changes"
  | "processes"
  | "assets"
  | "review"
  | "sources"
  | "ledger"
  | "tree"
  | "plugins"
  | "checkpoints"
  | "editor"
  | "shortcuts"
  | "floor"
  | "diff"
  | "draft";

/** One line in the status-observation stream (control center). */
export type DeckEvent = {
  ts: string;
  text: string;
};

/**
 * Modules whose full-body view （完全体） can load into a stage tab (E8) —
 * the overlay stays the thumbnail, the tab gets the wide canvas.
 */
export type ModuleTabKind = "tree" | "sources" | "review";

export const MODULE_TAB_KINDS: ReadonlySet<ModuleTabKind> = new Set(["tree", "sources", "review"]);

export function isModuleTabKind(kind: string): kind is ModuleTabKind {
  return MODULE_TAB_KINDS.has(kind as ModuleTabKind);
}
