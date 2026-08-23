/**
 * Pipeline detection for preview surfaces — pure function, no React.
 *
 * Decides which preview panel (A2UI interaction surface, PM-Design OpenUI
 * prototype, UI-Design .dd document) a tool-result message belongs to.
 * Detection keys off the tool result's parsed metadata (`a2ui` / `openui` /
 * `design` keys, set by the respective MCP tools); the tool-name text match
 * is only a cheap pre-filter — a match without the metadata key yields null,
 * so a tool name mentioned in ordinary text can never trigger the panel.
 */

export type PrototypeArtifact = {
  mode: "a2ui" | "openui" | "design";
  /** Serialized payload exactly as the preview panel expects it. */
  payload: string;
  /** A2UI only: update_surface results don't force the preview tab open. */
  isUpdate?: boolean;
};

type ToolResultRecord = {
  metadata?: {
    a2ui?: unknown;
    openui?: unknown;
    design?: unknown;
  };
};

function parseToolResult(content: string): ToolResultRecord | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ToolResultRecord;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function detectPrototypeArtifact(toolContent: string): PrototypeArtifact | null {
  // Cheap pre-filter: skip JSON parsing for tool results that mention none of
  // the render/update tool names.
  if (
    !/render_openui|update_openui|render_design|update_design|render_prototype|render_surface|update_surface/.test(
      toolContent
    )
  ) {
    return null;
  }
  const parsed = parseToolResult(toolContent);
  const meta = parsed?.metadata ?? {};

  if (meta.design != null) {
    return { mode: "design", payload: asString(meta.design, String(meta.design)) };
  }
  if (meta.openui != null) {
    // update_openui sends the complete updated program (full replacement).
    return { mode: "openui", payload: asString(meta.openui, String(meta.openui)) };
  }
  if (meta.a2ui != null) {
    const payload = typeof meta.a2ui === "string" ? meta.a2ui : JSON.stringify(meta.a2ui);
    // Architecture-map surfaces (arch-scan, surfaceId "arch-*") belong to the
    // Index & Knowledge module — they render in the knowledge tab's 架构图
    // pane. The design preview popup is for the design module only, so an
    // arch surface must never auto-open it.
    const surfaceId = parseSurfaceId(payload);
    if (surfaceId?.startsWith("arch-")) {
      return null;
    }
    const isUpdate = /update_surface/.test(toolContent) && !/render_prototype|render_surface/.test(toolContent);
    return { mode: "a2ui", payload, isUpdate };
  }
  return null;
}

/** Extract the surfaceId from an A2UI message batch (v0.9 wrapped payloads
 * or the legacy flat dialect — every message references exactly one). */
function parseSurfaceId(payload: string): string | null {
  try {
    const messages: unknown = JSON.parse(payload);
    if (!Array.isArray(messages)) return null;
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      for (const key of ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]) {
        const inner = m[key] as { surfaceId?: unknown } | undefined;
        if (inner && typeof inner.surfaceId === "string" && inner.surfaceId) return inner.surfaceId;
      }
      if (typeof m.surfaceId === "string" && m.surfaceId) return m.surfaceId;
    }
    return null;
  } catch {
    return null;
  }
}
