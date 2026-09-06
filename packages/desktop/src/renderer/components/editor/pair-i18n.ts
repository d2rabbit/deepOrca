// Shared pair-surface i18n key maps (2026-09-06): the phase → label and
// plan-step → label tables were copy-pasted identically across LanePanel /
// EditorStatusBar / PairBar (three names for the same two lists). One
// definition per concept, type-checked against the locale catalogs.
import type { MessageKey } from "../../i18n/messages";

/** Pair phase → status-bar/lane label key. */
export const PAIR_PHASE_KEYS: Record<"idle" | "streaming" | "review" | "applied", MessageKey> = {
  idle: "editor.pair.status.idle",
  streaming: "editor.pair.status.streaming",
  review: "editor.pair.status.review",
  applied: "editor.pair.status.applied",
};

/** Plan steps (0 理解 / 1 方案 / 2 写入 / 3 验证) in execution order. */
export const PAIR_PLAN_STEP_KEYS: readonly MessageKey[] = [
  "editor.pair.step.read",
  "editor.pair.step.plan",
  "editor.pair.step.write",
  "editor.pair.step.verify",
];
