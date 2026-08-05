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

/** Get a single surface by ID (returns null if not found). */
export function getSurface(surfaceId: string): A2uiSurfaceState | null {
  const surface = surfaces.get(surfaceId);
  if (!surface) return null;
  return {
    surfaceId: surface.surfaceId,
    title: surface.title,
    components: Array.from(surface.components.values()),
    dataModel: surface.dataModel,
  };
}

/**
 * Extract the surfaceId from the first message in a JSON payload.
 * Used to scope update subscriptions to the relevant surface only.
 */
export function extractSurfaceId(messagesJson: string): string | null {
  try {
    const messages = JSON.parse(messagesJson);
    if (!Array.isArray(messages)) return null;
    for (const msg of messages) {
      if (msg && typeof msg.surfaceId === "string") return msg.surfaceId;
    }
    return null;
  } catch {
    return null;
  }
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
    // Mode: "replace" (default) wipes all existing components first.
    // Mode: "merge" patches by id — same id replaces, new id adds,
    // `{ id, _delete: true }` removes. Inspired by OpenUI merge.ts.
    const mode = msg.mode === "merge" ? "merge" : "replace";
    if (mode === "replace") {
      surface.components = new Map();
    }
    for (const comp of components) {
      if (!comp || typeof comp.id !== "string") continue;
      const c = comp as A2uiComponent & { _delete?: boolean };
      if (c._delete) {
        surface.components.delete(c.id);
      } else {
        surface.components.set(c.id, c);
      }
    }
    // GC: in merge mode, remove components whose parentId is no longer
    // reachable from any root component (parentId undefined or pointing to
    // a non-existent parent). This prevents orphaned subtrees after deletes.
    if (mode === "merge") {
      gcUnreachableComponents(surface);
    }
  }
}

/**
 * Garbage-collect components unreachable from root components.
 *
 * A root is a component with NO parentId. A component whose parentId points to
 * a non-existent component is an ORPHAN, not a root — it (and its subtree)
 * must be removed. Earlier code treated orphans as roots, so deleting a parent
 * left its children promoted to the top level (deleted dialogs/cards lingered).
 *
 * Cycle-safe: the `reachable` set guarantees each node is enqueued at most once,
 * so a parental cycle cannot loop forever.
 */
function gcUnreachableComponents(surface: InternalSurface): void {
  const reachable = new Set<string>();
  const queue: string[] = [];

  // Seed: ONLY true roots (no parentId). Orphans (parentId set but missing)
  // are deliberately NOT seeded — they will be unreachable and pruned.
  for (const [id, comp] of surface.components) {
    if (!comp.parentId) {
      reachable.add(id);
      queue.push(id);
    }
  }

  // BFS: mark children as reachable. The reachable check before enqueue makes
  // this safe against parental cycles (a node is enqueued only once).
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const [childId, comp] of surface.components) {
      if (comp.parentId === id && !reachable.has(childId)) {
        reachable.add(childId);
        queue.push(childId);
      }
    }
  }

  // Remove unreachable (orphans + their descendants + cycle-only nodes).
  for (const id of surface.components.keys()) {
    if (!reachable.has(id)) {
      surface.components.delete(id);
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
