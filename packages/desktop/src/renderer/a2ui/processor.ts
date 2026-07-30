/**
 * A2UI Surface Processor — lightweight custom processor.
 *
 * Replaces @a2ui/web_core's A2uiMessageProcessor (which speaks the
 * standardized v0.8 protocol incompatible with our simplified format).
 *
 * Our MCP server emits messages in this format:
 *   { type: "createSurface", surfaceId, title }
 *   { type: "updateComponents", surfaceId, components: [{id, type, parentId, properties}] }
 *   { type: "updateDataModel", surfaceId, dataModel: {...} }
 *   { type: "deleteSurface", surfaceId }
 *
 * This processor consumes those messages directly — no zod schema validation,
 * no strict protocol enforcement. The renderer's A2uiSurface component was
 * already written to read this shape.
 */

/** A component node in the A2UI adjacency list. */
export interface A2uiComponent {
  id: string;
  type: string;
  parentId?: string;
  properties?: Record<string, unknown>;
}

/** A surface with its rendered component tree. */
export interface A2uiSurfaceState {
  surfaceId: string;
  title: string;
  components: A2uiComponent[];
  dataModel: Record<string, unknown>;
}

/** Per-surface state managed by the processor. */
interface InternalSurface {
  surfaceId: string;
  title: string;
  components: Map<string, A2uiComponent>;
  dataModel: Record<string, unknown>;
}

/** Global singleton processor. */
let surfaces = new Map<string, InternalSurface>();

/** Get all surfaces as renderable state. */
export function getSurfaces(): A2uiSurfaceState[] {
  const result: A2uiSurfaceState[] = [];
  for (const [, surface] of surfaces) {
    result.push({
      surfaceId: surface.surfaceId,
      title: surface.title,
      components: Array.from(surface.components.values()),
      dataModel: surface.dataModel,
    });
  }
  return result;
}

/** Clear all surfaces. */
export function clearSurfaces(): void {
  surfaces = new Map();
}

/**
 * Process A2UI messages from a tool result. The messages array is the
 * JSON payload from the MCP server (either embedded resource or metadata).
 */
export function processA2uiMessages(messagesJson: string): void {
  try {
    const messages = JSON.parse(messagesJson);
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      if (!msg || typeof msg.type !== "string") continue;
      switch (msg.type) {
        case "createSurface":
          handleCreateSurface(msg);
          break;
        case "updateComponents":
          handleUpdateComponents(msg);
          break;
        case "updateDataModel":
          handleUpdateDataModel(msg);
          break;
        case "deleteSurface":
          surfaces.delete(String(msg.surfaceId ?? ""));
          break;
        default:
          break;
      }
    }
  } catch {
    // Malformed JSON — silently ignore.
  }
}

function handleCreateSurface(msg: Record<string, unknown>): void {
  const surfaceId = String(msg.surfaceId ?? "");
  if (!surfaceId) return;
  surfaces.set(surfaceId, {
    surfaceId,
    title: String(msg.title ?? ""),
    components: new Map(),
    dataModel: {},
  });
}

function handleUpdateComponents(msg: Record<string, unknown>): void {
  const surfaceId = String(msg.surfaceId ?? "");
  const surface = surfaces.get(surfaceId);
  if (!surface) return;
  const components = msg.components;
  if (Array.isArray(components)) {
    // Replace all components for this surface.
    surface.components = new Map();
    for (const comp of components) {
      if (comp && typeof comp.id === "string") {
        surface.components.set(comp.id, comp as A2uiComponent);
      }
    }
  }
}

function handleUpdateDataModel(msg: Record<string, unknown>): void {
  const surfaceId = String(msg.surfaceId ?? "");
  const surface = surfaces.get(surfaceId);
  if (!surface) return;
  const dataModel = msg.dataModel;
  if (dataModel && typeof dataModel === "object" && !Array.isArray(dataModel)) {
    // Merge new keys into existing dataModel (supports partial updates).
    surface.dataModel = { ...surface.dataModel, ...(dataModel as Record<string, unknown>) };
  }
}
