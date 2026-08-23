/**
 * A2UI processor façade (specs/a2ui-integration R2) — the app-wide singleton
 * over the OFFICIAL v0.9 protocol engine (`@a2ui/web_core/v0_9`
 * MessageProcessor + `@a2ui/react/v0_9` basicCatalog). Replaces the 220-line
 * homegrown processor: schema validation, adjacency-list GC, dynamic-value
 * binding, checks and client functions all come from the official engine now.
 *
 * Kept façade API (call sites unchanged): processA2uiMessages(json),
 * extractSurfaceId(json), clearSurfaces(), plus surface-model accessors for
 * the A2uiSurface component. Legacy pre-v0.9 batches (homegrown dialect) are
 * tolerated via the shared converter — see src/shared/a2ui-legacy.ts.
 *
 * NOTE: no CSS imports in this module — it is loaded by node-based tests;
 * the official stylesheet is imported by the A2uiSurface component only.
 */

import { MessageProcessor } from "@a2ui/web_core/v0_9";
import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { basicCatalog } from "@a2ui/react/v0_9";
import { convertLegacyBatch, isLegacyBatch } from "../../shared/a2ui-legacy";

/** The surface-model flavor the official React renderer consumes. */
import type { SurfaceModel } from "@a2ui/web_core/v0_9";

/** The surface-model flavor the official React renderer consumes. */
export type ReactSurfaceModel = SurfaceModel<ReactComponentImplementation>;

/** Forwarder shape mirroring the legacy onAction callback contract. */
export type A2uiActionForwarder = (surfaceId: string, actionName: string, context: Record<string, unknown>) => void;

const actionForwarders = new Set<A2uiActionForwarder>();

/**
 * The single processor for the whole renderer. The global action handler
 * fans official A2uiClientActions out to registered forwarders (the
 * conversation renderer forwards them over IPC to the a2ui_action MCP tool).
 */
export const a2uiProcessor = new MessageProcessor(
  [basicCatalog],
  (action) => {
    const context: Record<string, unknown> = { ...action.context };
    if (action.sourceComponentId) context.sourceComponentId = action.sourceComponentId;
    for (const forward of actionForwarders) forward(action.surfaceId, action.name, context);
  },
  { version: "v0.9.1" }
);

/** Register a global action forwarder; returns an unregister function. */
export function onA2uiAction(forward: A2uiActionForwarder): () => void {
  actionForwarders.add(forward);
  return () => actionForwarders.delete(forward);
}

/** Surface validation/processing errors surface in the console, never crash. */
a2uiProcessor.onSurfaceCreated((surface) => {
  void surface.onError.subscribe((err) => {
    console.warn(`[a2ui] surface "${surface.id}" error:`, err);
  });
});

function parseMessages(messagesJson: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(messagesJson);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    return null;
  } catch {
    return null;
  }
}

/**
 * Process one A2UI message batch (JSON text). Official v0.9 batches pass
 * straight through; legacy pre-v0.9 batches are converted first (tolerance
 * for persisted artifacts and straggler producers from before the R2 revamp).
 */
export function processA2uiMessages(messagesJson: string): void {
  const parsed = parseMessages(messagesJson);
  if (!parsed) return;
  const messages = isLegacyBatch(parsed) ? convertLegacyBatch(parsed) : parsed;
  if (messages.length > 0) {
    a2uiProcessor.processMessages(messages as never);
  }
}

/** First surfaceId referenced anywhere in the batch (v0.9 or legacy shape). */
export function extractSurfaceId(messagesJson: string): string | null {
  const parsed = parseMessages(messagesJson);
  if (!parsed) return null;
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    for (const key of ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]) {
      const payload = m[key] as { surfaceId?: unknown } | undefined;
      if (payload && typeof payload.surfaceId === "string") return payload.surfaceId;
    }
    if (typeof m.surfaceId === "string") return m.surfaceId;
  }
  return null;
}

/** Live surface models in creation order (official SurfaceModel instances). */
export function getSurfaceModels(): ReactSurfaceModel[] {
  return [...a2uiProcessor.model.surfacesMap.values()];
}

export function getSurfaceModel(surfaceId: string): ReactSurfaceModel | null {
  return a2uiProcessor.model.surfacesMap.get(surfaceId) ?? null;
}

/** Delete every live surface (used by the preview-reset hook). */
export function clearSurfaces(): void {
  const ids = [...a2uiProcessor.model.surfacesMap.keys()];
  if (ids.length > 0) {
    a2uiProcessor.processMessages(ids.map((surfaceId) => ({ version: "v0.9", deleteSurface: { surfaceId } })));
  }
}
