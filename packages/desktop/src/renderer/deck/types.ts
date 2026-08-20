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
  | "floor";

/** One line in the status-observation stream (control center). */
export type DeckEvent = {
  ts: string;
  text: string;
};
