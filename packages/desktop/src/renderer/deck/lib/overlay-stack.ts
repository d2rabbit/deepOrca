// Unified overlay stack (E3, E6.1): every floating surface the Deck can show
// lives in one ordered stack — 抽屉 < 面板浮层 < 命令层/车间墙 < 模态.
// Esc closes the topmost layer, ⌘⇧Esc clears the stack.
//
// Tiering: drawers (files/changes/notifications/processes) dock to the screen
// EDGES below the floating scrims (E6.1) — they coexist with centered panels
// instead of being covered by them. Only the command layer and the workshop
// wall float above everything (TIER_TOP). Opening a drawer closes the other
// drawers (one docked surface at a time, as in the design demo).
// TIER_MODAL is reserved for trust/conflict dialogs.

import type { OverlayKind } from "../types";

/** Everything that can live on the stack, including the ⌘K command layer. */
export type LayerKind = OverlayKind | "command";

export type OverlayLayer = {
  kind: LayerKind;
  seq: number;
};

export const TIER_DRAWER = 0;
export const TIER_PANEL = 1;
export const TIER_TOP = 2;
export const TIER_MODAL = 3;

/** Edge-docked drawers — rendered by DrawerShell, not the centered overlay. */
const DRAWERS: ReadonlySet<LayerKind> = new Set(["notifications", "files", "changes", "processes"]);
const TOPS: ReadonlySet<LayerKind> = new Set(["command", "floor"]);

export function isDrawerKind(kind: LayerKind): boolean {
  return DRAWERS.has(kind);
}

/** Which screen edge the drawer docks to. */
export function drawerSide(kind: LayerKind): "left" | "right" {
  return kind === "processes" || kind === "notifications" ? "right" : "left";
}

export function layerTier(kind: LayerKind): number {
  if (TOPS.has(kind)) return TIER_TOP;
  if (DRAWERS.has(kind)) return TIER_DRAWER;
  return TIER_PANEL;
}

/**
 * Toggle semantics: activating a layer already on the stack closes it
 * (⌘E twice = open then dock away, regardless of stacking order);
 * otherwise it is inserted at the top of its tier (deduped). Drawers are
 * mutually exclusive — docking one undocks the others.
 */
export function pushLayer(stack: OverlayLayer[], kind: LayerKind, seq: number): OverlayLayer[] {
  if (stack.some((layer) => layer.kind === kind)) {
    return stack.filter((layer) => layer.kind !== kind);
  }
  let rest = stack;
  if (DRAWERS.has(kind)) {
    rest = rest.filter((layer) => !DRAWERS.has(layer.kind));
  }
  const tier = layerTier(kind);
  let at = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (layerTier(rest[i].kind) > tier) {
      at = i;
      break;
    }
  }
  return [...rest.slice(0, at), { kind, seq }, ...rest.slice(at)];
}

export function popLayer(stack: OverlayLayer[]): OverlayLayer[] {
  return stack.slice(0, -1);
}
