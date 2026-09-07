/**
 * Deterministic per-system palettes for the nine bundled design systems
 * (mockup v2.1 ②「切换即确定性重染」). These drive the --ds-* presentation
 * layer on the canvas stage + component atom wall the moment the user picks a
 * theme — zero LLM, zero regeneration. The OpenUI canvas CONTENT keeps its
 * own baked colors; applying the full token set to it requires regeneration
 * (「从原型生成」), which the switch toast states honestly.
 */

export type SystemPalette = {
  accent: string;
  surface: string;
  text: string;
  radius: string;
};

export const DESIGN_SYSTEM_PALETTES: Record<string, SystemPalette> = {
  "modern-minimal": { accent: "#2563eb", surface: "#ffffff", text: "#111827", radius: "8px" },
  editorial: { accent: "#b91c1c", surface: "#faf7f2", text: "#1c1917", radius: "6px" },
  "dark-tech": { accent: "#22d3ee", surface: "#0b1220", text: "#e2e8f0", radius: "10px" },
  "brutalist-contrast": { accent: "#111827", surface: "#ffffff", text: "#111827", radius: "0px" },
  "swiss-international": { accent: "#dc2626", surface: "#ffffff", text: "#111827", radius: "4px" },
  "terminal-mono": { accent: "#4ade80", surface: "#0a0f0a", text: "#d1fae5", radius: "2px" },
  "glass-morphism": { accent: "#7c3aed", surface: "#f5f3ff", text: "#1e1b4b", radius: "16px" },
  "soft-neumorphic": { accent: "#6366f1", surface: "#eef0f6", text: "#334155", radius: "14px" },
  "warm-handcrafted": { accent: "#d97706", surface: "#fffbeb", text: "#431407", radius: "12px" },
};

export function paletteFor(designSystemId: string): SystemPalette | null {
  return DESIGN_SYSTEM_PALETTES[designSystemId] ?? null;
}
