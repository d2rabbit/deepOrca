/**
 * Tool-result artifact detection for the preview panel (specs/
 * moonviz-engine-replacement T2.2) — the moonviz successor of the retired
 * openui/detect-artifact. Tool-result JSON `metadata.{moonviz|a2ui|design|spec}`
 * routes the payload to the matching preview mode; `moonviz` carries the
 * canonical `.mbt.md` document (the renderer previews its exported HTML).
 */

export type PrototypeArtifact = {
  mode: "a2ui" | "moonviz" | "design" | "spec";
  payload: string;
  isUpdate?: boolean;
} | null;

export function detectPrototypeArtifact(content: string): PrototypeArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const metadata = (parsed as { metadata?: unknown }).metadata;
  if (typeof metadata !== "object" || metadata === null) return null;
  const meta = metadata as Record<string, unknown>;

  const moonviz = meta.moonviz;
  if (typeof moonviz === "string" && moonviz.includes("moonviz:artboard")) {
    return { mode: "moonviz", payload: moonviz };
  }
  const a2ui = meta.a2uiJson ?? meta.a2ui;
  if (typeof a2ui === "string" && a2ui.trim()) {
    return { mode: "a2ui", payload: a2ui };
  }
  const design = meta.design;
  if (typeof design === "string" && design.trim()) {
    return { mode: "design", payload: design };
  }
  const spec = meta.spec;
  if (typeof spec === "string" && spec.trim()) {
    return { mode: "spec", payload: spec };
  }
  return null;
}
