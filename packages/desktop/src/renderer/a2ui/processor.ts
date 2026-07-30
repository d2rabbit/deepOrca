/**
 * A2UI MessageProcessor singleton.
 *
 * Wraps @a2ui/web_core's A2uiMessageProcessor — the framework-agnostic core
 * that processes streaming A2UI JSON messages (createSurface/updateComponents/
 * updateDataModel/deleteSurface) into a renderable component tree state.
 *
 * The renderer components consume the processor's surface state via
 * `getSurfaces()` to build React component trees.
 */

import { A2uiMessageProcessor } from "@a2ui/web_core";

/** Global singleton — one processor for the entire app lifetime. */
let processorInstance: A2uiMessageProcessor | null = null;

/** Get the singleton MessageProcessor instance. */
export function getProcessor(): A2uiMessageProcessor {
  if (!processorInstance) {
    processorInstance = new A2uiMessageProcessor();
  }
  return processorInstance;
}

/** Clear all surfaces (used on session switch to free memory). */
export function clearSurfaces(): void {
  if (processorInstance) {
    processorInstance.clearSurfaces();
  }
}

/**
 * Process A2UI messages from a tool result. The messages array is the
 * JSON payload from the MCP server's EmbeddedResource (MIME
 * `application/a2ui+json`).
 */
export function processA2uiMessages(messagesJson: string): void {
  const processor = getProcessor();
  try {
    const messages = JSON.parse(messagesJson);
    if (Array.isArray(messages)) {
      processor.processMessages(messages);
    }
  } catch {
    // Malformed A2UI JSON — silently ignore (the text fallback in the
    // tool result still shows the agent's summary message).
  }
}

// ── Types for the renderer ───────────────────────────────────────────────────

/** A component node in the A2UI adjacency list. */
export interface A2uiComponent {
  id: string;
  type: string;
  parentId?: string;
  properties?: Record<string, unknown>;
  childrenIds?: string[];
}

/** A surface with its rendered component tree. */
export interface A2uiSurfaceState {
  surfaceId: string;
  title: string;
  components: A2uiComponent[];
  dataModel: Record<string, unknown>;
}
