// Unified overlay stack (E3): every floating surface the Deck can show lives
// in one ordered stack — 抽屉 < 面板浮层 < 命令层/车间墙 < 模态. Esc closes
// the topmost layer, ⌘⇧Esc clears the stack.
//
// Tiering: only the command layer and the workshop wall float above
// everything (TIER_TOP). The drawer-kind surfaces (files/changes/processes/
// notifications/editor) will dock to the screen edges in a later pass; while
// every surface renders as a centered modal they stack with the panels by
// recency, so a newly opened drawer is never hidden under an older panel.
// TIER_DRAWER is reserved for that docking work, TIER_MODAL for trust/conflict
// dialogs.

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

const TOPS: ReadonlySet<LayerKind> = new Set(["command", "floor"]);

export function layerTier(kind: LayerKind): number {
  return TOPS.has(kind) ? TIER_TOP : TIER_PANEL;
}

/**
 * Toggle semantics: activating the top layer closes it; activating anything
 * else re-raises it to the top of its tier (and dedupes any older instance).
 */
export function pushLayer(stack: OverlayLayer[], kind: LayerKind, seq: number): OverlayLayer[] {
  if (stack.length > 0 && stack[stack.length - 1].kind === kind) {
    return stack.slice(0, -1);
  }
  const rest = stack.filter((layer) => layer.kind !== kind);
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
