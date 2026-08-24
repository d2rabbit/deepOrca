/**
 * A2UI MCP Server — provides AI-native interactive Surface rendering.
 *
 * This server runs in-process via InMemoryTransport (no subprocess needed).
 * It exposes three tools that let the agent create, update, and close
 * declarative A2UI Surfaces. The Surface JSON is returned as an
 * EmbeddedResource with MIME `application/a2ui+json`, which the renderer
 * picks up and feeds to the MessageProcessor.
 *
 * The agent calls `render_surface` to create a new Surface (e.g. a prototype),
 * `update_surface` to incrementally patch it (add/move/remove components or
 * update the data model), and `close_surface` when done.
 *
 * User interactions (button clicks, form submissions) flow back as
 * `a2ui_action` tool calls through the same MCP server.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";
import type { ZodRawShape } from "zod/v3";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { generatePrototype, listTemplates } from "./a2ui-templates";
import { BASIC_CATALOG_ID, convertLegacyComponents } from "../../../shared/a2ui-legacy";
import { saveDesignArtifact, deriveTitle } from "../design-store.js";

export const A2UI_MCP_SERVER_NAME = "a2ui";

// ── Disable flag (host-managed, per project root) ────────────────────────────

const disabledA2uiRoots = new Set<string>();

/** Enable or disable the built-in A2UI MCP server for a project root. */
export function setA2uiDisabled(projectRoot: string, disabled: boolean): void {
  const key = nodePath.resolve(projectRoot);
  if (disabled) {
    disabledA2uiRoots.add(key);
  } else {
    disabledA2uiRoots.delete(key);
  }
}

/** True when the built-in A2UI MCP server has been disabled for a project root. */
export function isA2uiDisabled(projectRoot: string): boolean {
  return disabledA2uiRoots.has(nodePath.resolve(projectRoot));
}

// ── Surface state (in-memory, per server instance) ───────────────────────────

interface SurfaceState {
  surfaceId: string;
  title: string;
  messages: unknown[];
  dataModel: Record<string, unknown>;
  /** Current component set (the latest `updateComponents` payload). */
  components: unknown[];
  /** Monotonic stamp of the last mutation (see surfaceVersionStamp). */
  stamp: number;
}

// Module-level surfaces are intentionally kept here because:
// 1. Only ONE A2UI server instance exists per process (InMemoryTransport)
// 2. Persistence functions need access from outside buildA2uiServer()
// 3. The server is rebuilt on session reload — persistSurfaces/restoreSurfaces
//    handle the state transfer across rebuilds.
// However, we clear it on rebuild to prevent cross-session leakage.
const surfaces = new Map<string, SurfaceState>();

// Surface ids THIS PROCESS has managed (created, restored, or closed).
// The dispose-time full flush may only sweep files it knows about — an
// unknown file (e.g. an arch map persisted by an earlier process) must
// NEVER be deleted by a flush. Without this, a boot race where dispose()
// runs before the async restore populated the surfaces Map sweeps the whole
// prototypes dir and rewrites nothing, destroying persisted artifacts
// (observed: arch-root.json deleted within seconds of every app start).
const knownSurfaceIds = new Set<string>();

// Monotonic mutation counter: every surface create/update/restore bumps it.
// A background task snapshots surfaceVersionStamp() before running and passes
// it back as persistSurfaces(…, sinceStamp) so its flush writes exactly the
// surfaces IT produced — never leftovers from an earlier task in the same
// process (e.g. a build of a different workspace root).
let surfaceStampCounter = 0;

function nextSurfaceStamp(): number {
  surfaceStampCounter += 1;
  return surfaceStampCounter;
}

/** Current surface-mutation stamp (monotonic; snapshot for scoped flushes). */
export function surfaceVersionStamp(): number {
  return surfaceStampCounter;
}

// ── Persistence (save/load to .deeporca/prototypes/) ────────────────────────

/** Directory for persisted prototype surfaces. */
function getPrototypesDir(projectRoot: string): string {
  return nodePath.join(projectRoot, ".deeporca", "prototypes");
}

/** Save active surfaces to disk. Called on session dispose (full flush) and
 * by background tasks (prefix- and stamp-scoped — see surfaceVersionStamp). */
export function persistSurfaces(projectRoot: string, idPrefix?: string, sinceStamp?: number): void {
  const dir = getPrototypesDir(projectRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Clear directory first to remove stale files from closed surfaces. With
    // an idPrefix (background-task flush) only same-prefixed files/surfaces
    // are touched — the user's design prototypes in the same dir survive.
    // Full flushes sweep only ids THIS process has managed (knownSurfaceIds):
    // a file we never saw (persisted by an earlier process, restore still in
    // flight) must survive — see the note on knownSurfaceIds.
    const fileId = (f: string): string => f.replace(/\.json$/, "");
    const existing = fs.readdirSync(dir).filter((f) => {
      if (!f.endsWith(".json")) return false;
      if (idPrefix) return f.startsWith(idPrefix);
      return knownSurfaceIds.has(fileId(f));
    });
    for (const f of existing) {
      try {
        fs.unlinkSync(nodePath.join(dir, f));
      } catch {
        // Best-effort.
      }
    }
    // Write current surfaces. With sinceStamp, only surfaces mutated after
    // that stamp are written (what THIS background task produced); same-
    // prefixed files this run does not rewrite were just swept as stale.
    for (const [id, state] of surfaces) {
      if (idPrefix && !id.startsWith(idPrefix)) continue;
      if (sinceStamp !== undefined && state.stamp <= sinceStamp) continue;
      const filePath = nodePath.join(dir, `${id}.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            surfaceId: id,
            title: state.title,
            messages: state.messages,
            dataModel: state.dataModel,
            components: state.components,
          },
          null,
          2
        ),
        "utf8"
      );
    }
  } catch {
    // Best-effort — persistence failures must not break the session.
  }
}

/** Load persisted surfaces from disk. Called on session init. */
export function restoreSurfaces(projectRoot: string): void {
  const dir = getPrototypesDir(projectRoot);
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(nodePath.join(dir, file), "utf8");
        const data = JSON.parse(raw) as {
          surfaceId: string;
          title: string;
          messages: unknown[];
          dataModel: Record<string, unknown>;
          components?: unknown[];
        };
        knownSurfaceIds.add(data.surfaceId);
        surfaces.set(data.surfaceId, {
          surfaceId: data.surfaceId,
          title: data.title,
          messages: data.messages,
          dataModel: data.dataModel,
          // Back-compat: older persisted files lack `components`. Recover it
          // by scanning the message history for the last updateComponents.
          components: data.components ?? extractComponentsFromMessages(data.messages),
          stamp: nextSurfaceStamp(),
        });
      } catch {
        // Skip malformed files.
      }
    }
  } catch {
    // Best-effort.
  }
}

/** Clear all surfaces (memory + disk). Called on explicit close. */
export function clearAllSurfaces(projectRoot: string): void {
  surfaces.clear();
  const dir = getPrototypesDir(projectRoot);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort.
  }
}

// ── A2UI v0.9 message builders ───────────────────────────────────────────────

/** Official v0.9 createSurface (catalogId is required by the protocol). */
function createSurfaceMessage(surfaceId: string): unknown {
  return { version: "v0.9", createSurface: { surfaceId, catalogId: BASIC_CATALOG_ID } };
}

/** Official v0.9 updateComponents (flat list; replacing a children list
 * drops the removed ids from the tree — the client GCs unreachable ones). */
function updateComponentsMessage(surfaceId: string, components: unknown[]): unknown {
  return { version: "v0.9", updateComponents: { surfaceId, components } };
}

/** Official v0.9 updateDataModel (JSON-Pointer set; "/" = whole model). */
function updateDataModelMessage(surfaceId: string, value: Record<string, unknown>): unknown {
  return { version: "v0.9", updateDataModel: { surfaceId, path: "/", value } };
}

/** Official v0.9 deleteSurface. */
function deleteSurfaceMessage(surfaceId: string): unknown {
  return { version: "v0.9", deleteSurface: { surfaceId } };
}

/**
 * Normalize an incoming component array to official v0.9 shape. Accepts BOTH
 * dialects: legacy pre-R2 trees (lowercase `type` + `parentId` back
 * references) are converted by the shared converter, and v0.9 components get
 * a schema-shape repair pass (normalizeV09Shapes) — models frequently emit
 * near-miss shapes (sibling Tabs, Card with children; observed on the real
 * arch-scan run 2026-08-24), and repairing at the MCP boundary keeps every
 * downstream renderer (official processor) validation-clean.
 */
export function normalizeComponents(raw: unknown): Array<Record<string, unknown>> {
  const list = (Array.isArray(raw) ? raw : []).filter((c) => c && typeof c === "object");
  const legacy = list.some((c) => "type" in (c as object) || "parentId" in (c as object));
  const components = (
    legacy ? convertLegacyComponents(list as never) : (list as Array<Record<string, unknown>>)
  ).filter((c) => typeof (c as { id?: unknown }).id === "string");
  return ensureRootComponent(normalizeV09Shapes(components));
}

/**
 * Repair near-miss v0.9 component shapes in place (all observed LLM slips):
 * 1. Card with `children` → single `child` + synthesized inner Column.
 * 2. Card with no child → placeholder Text child (schema requires one).
 * 3. Row/Column/List with single `child` → `children: [child]`.
 * 4. Sibling Tabs each carrying {title, child} → ONE container Tabs with a
 *    `tabs: [{title, child}]` array (the official shape is a single
 *    component holding the whole tab bar).
 */
function normalizeV09Shapes(components: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const inserts: Array<Record<string, unknown>> = [];

  for (const c of components) {
    const kind = String(c.component ?? "");
    if (kind === "Card") {
      if (Array.isArray(c.children)) {
        const kids = c.children as string[];
        const inner: Record<string, unknown> = { id: `${c.id}-inner`, component: "Column", children: kids };
        inserts.push(inner);
        delete c.children;
        c.child = inner.id;
      } else if (typeof c.child !== "string") {
        const ph: Record<string, unknown> = { id: `${c.id}-empty`, component: "Text", text: "" };
        inserts.push(ph);
        c.child = ph.id;
      }
    } else if (kind === "Row" || kind === "Column" || kind === "List") {
      if (typeof c.child === "string" && !Array.isArray(c.children)) {
        c.children = [c.child];
        delete c.child;
      }
    }
  }

  // Sibling Tabs merge: Tabs components that carry a `title` (the per-tab
  // near-miss shape) sharing a container's children list collapse into ONE.
  const perTabTabs = components.filter(
    (c) => String(c.component) === "Tabs" && typeof c.title === "string" && typeof c.child === "string"
  );
  if (perTabTabs.length > 0) {
    const tabIds = new Set(perTabTabs.map((c) => String(c.id)));
    const entries = perTabTabs.map((c) => ({ title: c.title, child: c.child }));
    const first = perTabTabs[0] as Record<string, unknown>;
    const firstId = String(first.id);
    // Rewrite every children list: first tab id stays (becomes the merged
    // container), the rest drop.
    for (const c of components) {
      if (!Array.isArray(c.children)) continue;
      const kids = c.children as string[];
      if (!kids.some((k) => tabIds.has(k))) continue;
      const out: string[] = [];
      let seenFirst = false;
      for (const k of kids) {
        if (tabIds.has(k)) {
          if (!seenFirst) {
            out.push(k);
            seenFirst = true;
          }
        } else {
          out.push(k);
        }
      }
      c.children = out;
      // A Card holding a single tab child keeps pointing at the merged one.
      if (String(c.component) === "Card" && typeof c.child === "string" && tabIds.has(String(c.child))) {
        c.child = firstId;
      }
    }
    // The first tab becomes the container; the rest are removed below.
    delete first.title;
    delete first.child;
    first.tabs = entries;
    for (let i = components.length - 1; i >= 0; i--) {
      const c = components[i] as Record<string, unknown>;
      if (String(c.component) === "Tabs" && tabIds.has(String(c.id)) && String(c.id) !== firstId) {
        components.splice(i, 1);
      }
    }
  }

  return [...components, ...inserts];
}

/**
 * The v0.9 protocol derives the tree root by convention: one component MUST
 * have id "root". Wrap unreferenced top-level components in a Column root
 * when the producer forgot (harmless no-op when "root" exists).
 */
function ensureRootComponent(components: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (components.length === 0 || components.some((c) => c.id === "root")) return components;
  const referenced = new Set<string>();
  for (const c of components) {
    const children = c.children;
    if (Array.isArray(children)) {
      for (const id of children) referenced.add(String(id));
    } else if (children && typeof children === "object" && "componentId" in (children as object)) {
      referenced.add(String((children as { componentId: unknown }).componentId));
    }
    if (typeof c.child === "string") referenced.add(c.child);
  }
  const topLevel = components.filter((c) => !referenced.has(String(c.id))).map((c) => String(c.id));
  if (topLevel.length === 0) return components;
  return [{ id: "root", component: "Column", children: topLevel }, ...components];
}

// ── Tool result with EmbeddedResource ────────────────────────────────────────

/** Wrap A2UI messages as a CallToolResult with embedded resource. */
function a2uiResult(messages: unknown[], text: string, surfaceId?: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
      {
        type: "resource",
        resource: {
          uri: `a2ui://surface/${surfaceId ?? "unknown"}-${Date.now()}`,
          mimeType: "application/a2ui+json",
          text: JSON.stringify(messages),
        },
      },
    ],
  };
}

/**
 * Recover the latest components from a recorded message history. Reads both
 * the official v0.9 shape ({updateComponents:{components}}) and the legacy
 * flat dialect ({type:"updateComponents", components}) — pre-R2 files keep
 * the old shape and are converted lazily by the renderer façade.
 */
function extractComponentsFromMessages(messages: unknown[]): unknown[] {
  let components: unknown[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as { type?: string; updateComponents?: { components?: unknown[] }; components?: unknown[] };
    const comps = m.updateComponents?.components ?? (m.type === "updateComponents" ? m.components : undefined);
    if (Array.isArray(comps)) components = comps;
  }
  return components;
}

// ── MCP Server builder ───────────────────────────────────────────────────────

type RegisterToolLoose = (
  name: string,
  config: { description?: string; inputSchema?: ZodRawShape },
  cb: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>
) => unknown;

const SERVER_INFO = { name: "deeporca-a2ui", version: "0.1.0" };

/**
 * Build the A2UI MCP server. Registers three tools:
 * - `render_surface`: create a new Surface with initial components + data model
 * - `update_surface`: incrementally patch an existing Surface
 * - `close_surface`: destroy a Surface
 *
 * Also registers `a2ui_action` for bidirectional user interaction flow.
 */
export function buildA2uiServer(projectRoot?: string): McpServer {
  // Clear stale surfaces from previous session to prevent cross-session leaks.
  surfaces.clear();
  const server = new McpServer(SERVER_INFO);
  const registerTool = server.registerTool.bind(server) as unknown as RegisterToolLoose;

  // Tool: render_surface — create a new interactive Surface (A2UI v0.9)
  registerTool(
    "render_surface",
    {
      description:
        "Create a new A2UI Surface — an interactive, declarative UI rendered in the conversation. " +
        "Speaks the OFFICIAL A2UI v0.9 protocol. Component vocabulary (basicCatalog): " +
        "Layout Row/Column/List/Card/Tabs/Modal/Divider · Content Text/Image/Icon/Video/AudioPlayer · " +
        "Input Button/TextField/CheckBox/ChoicePicker/Slider/DateTimeInput.\n\n" +
        "Wire format rules:\n" +
        '1. Adjacency list: every component is `{id, component: "PascalName", ...props}` in a FLAT array. ' +
        'Containers reference children by id: `{id: "root", component: "Column", children: ["a", "b"]}`. ' +
        'Card/Tabs take a single `child` id. Exactly one component MUST have `id: "root"`.\n' +
        '2. Dynamic values: a property accepts a literal, or `{path: "/data/key"}` (JSON Pointer into the data model).\n' +
        '3. Text: `{component: "Text", text: {path: "/title"}, variant: "h1|h2|h3|h4|h5|body|caption"}`.\n' +
        "4. Button: needs a child Text for its label and an action object: " +
        '`{component: "Button", child: "btn-label", variant: "primary", action: {event: {name: "submit"}}}`.\n' +
        'Example: components=[{id:"root",component:"Column",children:["t","b"]},' +
        '{id:"t",component:"Text",text:{path:"/title"}},' +
        '{id:"b",component:"Button",child:"bl",action:{event:{name:"go"}}},' +
        '{id:"bl",component:"Text",text:"Go"}], dataModel={title:"Hello"}',
      inputSchema: {
        surfaceId: z.string().describe("Unique identifier for this Surface"),
        title: z.string().optional().describe("Display title (host metadata; not part of the v0.9 protocol)"),
        components: z
          .array(z.record(z.unknown()))
          .describe(
            "A2UI v0.9 component adjacency list (flat; forward children references; one component with id 'root'). " +
              "Legacy trees (lowercase type + parentId) are tolerated and converted, but prefer the official shape."
          ),
        dataModel: z
          .record(z.unknown())
          .describe("Initial data model (key-value state bound via {path: '/key'} references)"),
      },
    },
    async (args) => {
      const surfaceId = String(args.surfaceId ?? `surface-${Date.now()}`);
      const title = String(args.title ?? "A2UI Surface");
      const components = normalizeComponents(args.components);
      const dataModel = (args.dataModel as Record<string, unknown>) ?? {};
      if (components.length === 0) {
        return {
          content: [{ type: "text", text: "Error: `components` must be a non-empty A2UI v0.9 adjacency list." }],
          isError: true,
        };
      }

      const messages: unknown[] = [
        createSurfaceMessage(surfaceId),
        updateComponentsMessage(surfaceId, components),
        updateDataModelMessage(surfaceId, dataModel),
      ];
      knownSurfaceIds.add(surfaceId);
      surfaces.set(surfaceId, {
        surfaceId,
        title,
        messages,
        dataModel,
        components,
        stamp: nextSurfaceStamp(),
      });

      return a2uiResult(
        messages,
        `Surface "${title}" (id: ${surfaceId}) created with ${components.length} components.`
      );
    }
  );

  // Tool: render_prototype — generate a Surface from a template + params
  registerTool(
    "render_prototype",
    {
      description:
        "Generate an interactive prototype Surface from a pre-built template. " +
        "Pick a template (login-form, dashboard, list-detail, wizard, kanban, or data-table) " +
        "and fill in params (field names, column names, items, etc.). The server generates the " +
        "complete official A2UI v0.9 component tree — you don't need to write A2UI JSON manually. " +
        "Use `list_templates` to see available templates and their params.",
      inputSchema: {
        template: z
          .string()
          .describe("Template name: login-form, dashboard, list-detail, wizard, kanban, or data-table"),
        surfaceId: z.string().describe("Unique identifier for this prototype Surface"),
        title: z.string().describe("Display title for the prototype"),
        params: z
          .record(z.unknown())
          .describe(
            "Template parameters. See list_templates for each template's required params. " +
              "Example: { fields: ['Email', 'Password'] } for login-form."
          ),
      },
    },
    async (args) => {
      const template = String(args.template ?? "");
      const surfaceId = String(args.surfaceId ?? `proto-${Date.now()}`);
      const title = String(args.title ?? "Prototype");
      const params = (args.params as Record<string, unknown>) ?? {};

      const result = generatePrototype(template, params);
      if (!result) {
        const available = listTemplates()
          .map((t) => `${t.name}(${t.params.join(", ")})`)
          .join("; ");
        return {
          content: [
            {
              type: "text",
              text: `Unknown template "${template}". Available: ${available}`,
            },
          ],
          isError: true,
        };
      }

      // Templates emit their internal shape; normalizeComponents converts it
      // to the official v0.9 adjacency list (shared converter).
      const components = normalizeComponents(result.components);
      const messages: unknown[] = [
        createSurfaceMessage(surfaceId),
        updateComponentsMessage(surfaceId, components),
        updateDataModelMessage(surfaceId, result.dataModel),
      ];
      knownSurfaceIds.add(surfaceId);
      surfaces.set(surfaceId, {
        surfaceId,
        title,
        messages,
        dataModel: result.dataModel,
        components,
        stamp: nextSurfaceStamp(),
      });

      return a2uiResult(
        messages,
        `Prototype "${title}" created from template "${template}" with ${components.length} components. Surface ID: ${surfaceId}.`
      );
    }
  );

  // Tool: list_templates — show available prototype templates
  registerTool(
    "list_templates",
    {
      description:
        "List all available prototype templates with their names, descriptions, and required parameters. " +
        "Call this before render_prototype to see what templates are available.",
      inputSchema: {},
    },
    async () => {
      const templates = listTemplates();
      const text = templates.map((t) => `• ${t.name}: ${t.description}\n  params: ${t.params.join(", ")}`).join("\n\n");
      return {
        content: [{ type: "text", text: `Available templates:\n\n${text}` }],
      };
    }
  );

  // Tool: update_surface — full-snapshot update of an existing Surface (v0.9)
  registerTool(
    "update_surface",
    {
      description:
        "Update an existing A2UI Surface (official v0.9). Send the COMPLETE updated component " +
        "list (full snapshot, not a delta): components with the same id are replaced, and ids you " +
        "remove from a container's `children` list disappear from the tree (unreachable components " +
        "are garbage-collected client-side). Data model updates merge shallowly via `dataModelPatch`.\n\n" +
        "Iterating efficiently: copy the previous component list and modify only what changed — " +
        "the client re-renders just the diffs.",
      inputSchema: {
        surfaceId: z.string().describe("ID of the Surface to update"),
        components: z
          .array(z.record(z.unknown()))
          .optional()
          .describe("Complete updated v0.9 component adjacency list (full replacement of the tree)."),
        dataModelPatch: z
          .record(z.unknown())
          .describe("Shallow-merged data model update (bound components update reactively)."),
        title: z.string().optional().describe("Optional new display title (host metadata)."),
      },
    },
    async (args) => {
      const surfaceId = String(args.surfaceId ?? "");
      const state = surfaces.get(surfaceId);
      if (!state) {
        return {
          content: [{ type: "text", text: `Error: Surface "${surfaceId}" not found.` }],
          isError: true,
        };
      }

      const messages: unknown[] = [];
      if (args.title) {
        state.title = String(args.title);
      }

      if (Array.isArray(args.components)) {
        state.components = normalizeComponents(args.components);
        const msg = updateComponentsMessage(surfaceId, state.components);
        messages.push(msg);
        state.messages = [...state.messages, msg];
      }

      if (args.dataModelPatch && typeof args.dataModelPatch === "object") {
        const patch = args.dataModelPatch as Record<string, unknown>;
        state.dataModel = { ...state.dataModel, ...patch };
        const msg = updateDataModelMessage(surfaceId, state.dataModel);
        messages.push(msg);
        state.messages = [...state.messages, msg];
      }

      if (messages.length === 0) {
        return {
          content: [{ type: "text", text: "Error: provide `components` and/or `dataModelPatch`." }],
          isError: true,
        };
      }

      state.stamp = nextSurfaceStamp();
      // First update over a freshly created surface often follows immediately;
      // replay the full history so a renderer that only sees THIS result can
      // hydrate from scratch.
      const payload = state.messages;
      const summary = `Surface "${state.title}" updated: ${messages.length} message(s).`;
      return a2uiResult(payload, summary, surfaceId);
    }
  );

  // Tool: close_surface — destroy a Surface
  registerTool(
    "close_surface",
    {
      description: "Close and destroy an A2UI Surface. Use when the interaction is complete.",
      inputSchema: {
        surfaceId: z.string().describe("ID of the Surface to close"),
      },
    },
    async (args) => {
      const surfaceId = String(args.surfaceId ?? "");
      if (!surfaces.has(surfaceId)) {
        return {
          content: [{ type: "text", text: `Surface "${surfaceId}" not found (already closed?).` }],
        };
      }
      surfaces.delete(surfaceId);
      return a2uiResult([deleteSurfaceMessage(surfaceId)], `Surface "${surfaceId}" closed.`);
    }
  );

  // Tool: save_archmap — persist a Mermaid architecture-map document.
  // arch-scan's current output format: a markdown file whose ```mermaid fences
  // render as actual diagrams in the Knowledge panel (the legacy A2UI arch
  // surface read as a flat document). Persistence stays main-process-owned
  // (same model as persistSurfaces) so the background build task needs no
  // write-tool permission; the name is sanitized and pinned into the
  // prototypes directory.
  registerTool(
    "save_archmap",
    {
      description:
        "Save an architecture map as a Mermaid document under .deeporca/prototypes/arch-<name>.md. " +
        "The Knowledge panel renders each ```mermaid fenced block as an interactive diagram. " +
        "Document layout: '# <Title>' heading, one-sentence overview, then one '## <Perspective>' " +
        "section per perspective containing exactly one mermaid fence. " +
        "Call ONCE per scan with the COMPLETE document (full replacement).",
      inputSchema: {
        name: z
          .string()
          .describe(
            "Map slug, kebab-case (e.g. 'root' or 'deeporca'). Stored as arch-<name>.md; an explicit 'arch-' prefix is stripped."
          ),
        markdown: z
          .string()
          .describe(
            "Complete markdown document with ```mermaid fences. Full replacement of the previous file content."
          ),
      },
    },
    async (args) => {
      const rawName = String(args.name ?? "").trim();
      const slug = rawName
        .toLowerCase()
        .replace(/^arch-/, "")
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const markdown = String(args.markdown ?? "");
      if (!slug) {
        return {
          content: [{ type: "text", text: "Error: `name` must contain letters, digits or dashes." }],
          isError: true,
        };
      }
      if (!markdown.trim()) {
        return { content: [{ type: "text", text: "Error: `markdown` must be a non-empty document." }], isError: true };
      }
      try {
        const dir = getPrototypesDir(projectRoot ?? process.cwd());
        fs.mkdirSync(dir, { recursive: true });
        const file = nodePath.join(dir, `arch-${slug}.md`);
        fs.writeFileSync(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf-8");
        return {
          content: [{ type: "text", text: `Architecture map saved: ${file} (${markdown.split("\n").length} lines).` }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error saving architecture map: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool: a2ui_action — receive user interaction (official A2uiClientAction
  // shape: the renderer bridge forwards {surfaceId, name, context}).
  registerTool(
    "a2ui_action",
    {
      description:
        "Receive a user interaction from an A2UI Surface. Called automatically " +
        "by the host when the user activates a component's action " +
        "(`{event: {name}}` on Buttons, form submissions, etc.). The official " +
        "A2uiClientAction carries the action name and a resolved context " +
        "(bound data-model values, source component id).",
      inputSchema: {
        surfaceId: z.string().describe("Surface the interaction originated from"),
        actionName: z.string().describe("Action name (the Button action.event.name)"),
        context: z.record(z.unknown()).describe("Resolved action context from the client"),
      },
    },
    async (args) => {
      const surfaceId = String(args.surfaceId ?? "");
      const actionName = String(args.actionName ?? "");
      const context = args.context ?? {};
      return {
        content: [
          {
            type: "text",
            text: `Action "${actionName}" received from Surface "${surfaceId}". Context: ${JSON.stringify(context)}`,
          },
        ],
      };
    }
  );

  // Tool: render_spec — persist a requirements document (prototype module,
  // step 1). The document is markdown; metadata.spec lets the renderer open a
  // reading preview instead of an interactive one.
  registerTool(
    "render_spec",
    {
      description:
        "Persist a structured requirements document (需求文档) as a spec artifact. " +
        "Called by the spec-writer skill (prototype module step 1); prototype.materialize " +
        "(step 2) designs the prototype against this document.",
      inputSchema: {
        document: z
          .string()
          .describe(
            "The complete requirements document in markdown. Must contain the sections " +
              "背景与目标 / 用户与场景 / 功能需求 / 页面清单 / 验收标准 (页面清单 drives the prototype pages)."
          ),
        requirement: z
          .string()
          .optional()
          .describe("The user's original requirement text (persisted as requirement.md)."),
      },
    },
    async (args) => {
      const document = String(args.document ?? "");
      if (!document.trim()) {
        return { content: [{ type: "text", text: "Error: empty requirements document." }], isError: true };
      }
      const requirement =
        typeof args.requirement === "string" && args.requirement.trim() ? args.requirement : undefined;
      saveArtifactWithLineage(projectRoot, "spec", "render", {
        title: deriveTitle(document),
        content: document,
        requirement,
      });
      return {
        content: [
          {
            type: "text",
            text: "Requirements document saved as a spec artifact. It is now the contract for prototype generation.",
          },
        ],
        metadata: { spec: document },
      } as CallToolResult;
    }
  );

  // Tool: render_openui — render an OpenUI Lang program (PM-Designer mode)
  // Unlike the A2UI tools above, this returns the OpenUI Lang code as plain
  // text with metadata.openui, not as an A2UI embedded resource. The renderer
  // detects metadata.openui and switches to OpenUI Lang rendering mode.
  registerTool(
    "render_openui",
    {
      description:
        "Render an OpenUI Lang program as an interactive prototype. " +
        "OpenUI Lang is a compact, line-oriented language (e.g. `root = Column([title, form])`) " +
        "that is ~3x more token-efficient than JSON. Use this for PM-Designer prototypes.\n\n" +
        "Available components: Column, Row, Stack, Card, TextContent, Badge, Button, TextField, Metric, Divider, Spacer.\n" +
        "Syntax: `identifier = ComponentName(prop1, prop2, ...)` where props are positional or named.\n" +
        "Children are arrays: `[child1, child2]`. Forward references allowed.\n" +
        "Example:\n" +
        "```\n" +
        "root = Column([title, emailField, passwordField, submitBtn])\n" +
        'title = TextContent("Sign In", "title")\n' +
        'emailField = TextField("Email", "you@example.com", "text", "email")\n' +
        'passwordField = TextField("Password", "", "password", "password")\n' +
        'submitBtn = Button("Sign In", "submit:login", "primary")\n' +
        "```",
      inputSchema: {
        code: z
          .string()
          .describe(
            "The OpenUI Lang program. Each line is `identifier = ComponentName(...)`. " +
              "The `root` statement is the top-level component."
          ),
        requirement: z
          .string()
          .optional()
          .describe("The user's original requirement text (persisted as requirement.md; pass when known)."),
      },
    },
    async (args) => {
      const code = String(args.code ?? "");
      if (!code.trim()) {
        return {
          content: [{ type: "text", text: "Error: empty OpenUI Lang code." }],
          isError: true,
        };
      }
      // Persist as a design artifact (fire-and-forget, best-effort).
      const requirement =
        typeof args.requirement === "string" && args.requirement.trim() ? args.requirement : undefined;
      saveArtifactWithLineage(projectRoot, "openui", "render", {
        title: deriveTitle(code),
        content: code,
        requirement,
      });
      // Return as text content with metadata.openui. The desktop renderer
      // detects this and switches to OpenUI Lang rendering mode.
      return {
        content: [
          {
            type: "text",
            text: `OpenUI prototype rendered (${code.split("\n").length} statements). The preview panel should now show the prototype.`,
          },
        ],
        metadata: { openui: code },
      } as CallToolResult;
    }
  );

  // Tool: update_openui — replace an existing OpenUI Lang prototype with updated code
  registerTool(
    "update_openui",
    {
      description:
        "Replace an existing OpenUI Lang prototype with updated code. " +
        "Send the complete updated program (full replacement). " +
        "To iterate efficiently, copy the previous code and modify only the parts that need changing.",
      inputSchema: {
        code: z.string().describe("Complete updated OpenUI Lang program (full replacement, not delta)."),
      },
    },
    async (args) => {
      const code = String(args.code ?? "");
      // Iterate on the same artifact (versions[] accumulate; render_openui
      // starts a fresh lineage for a brand-new prototype).
      saveArtifactWithLineage(projectRoot, "openui", "update", { title: deriveTitle(code), content: code });
      return {
        content: [
          {
            type: "text",
            text: `OpenUI prototype updated (${code.split("\n").length} statements).`,
          },
        ],
        metadata: { openui: code },
      } as CallToolResult;
    }
  );

  // Register DeepDesign (.dd format) tools on the same server.
  registerDesignTools(registerTool, projectRoot);

  return server;
}

// ── DeepDesign (.dd format) tools ────────────────────────────────────────────
// These tools handle the OrcaDesign (.dd) format — a YAML front-matter + HTML
// body format for DeepDesign. The renderer compiles .dd → HTML for preview.

/**
 * Build MCP tools for DeepDesign (.dd format). Registered on the same a2ui
 * server since it's the in-process design server.
 */
export function registerDesignTools(registerTool: RegisterToolLoose, projectRoot?: string): void {
  // Tool: render_design — render a .dd document for preview
  registerTool(
    "render_design",
    {
      description:
        "Render an OrcaDesign (.dd) document for live preview in DeepOrca. " +
        "The .dd format is YAML front-matter (metadata + design tokens) + HTML body " +
        "with section markers. The renderer compiles it into a self-contained HTML " +
        "page with design tokens injected as CSS :root variables.\n\n" +
        "Use this for DeepDesign output (landing pages, dashboards, web designs). " +
        "For PM-Designer prototypes (interactive component-based), use render_openui instead.",
      inputSchema: {
        content: z
          .string()
          .describe(
            "The .dd document content. Starts with `---` YAML front-matter, then HTML body.\n" +
              "YAML must include: name, system (dark-tech/modern-minimal/editorial), tokens (CSS variables), sections (id+type list).\n" +
              "HTML body uses `<!-- dd:section xxx -->` markers around each <section>.\n" +
              "Available CSS classes: container, section, grid, grid-2/3/4, topnav, eyebrow, display, lead, btn/btn-primary/btn-ghost, card/card-icon/card-title/card-desc, ph-img, footer."
          ),
      },
    },
    async (args) => {
      const content = String(args.content ?? "");
      if (!content.trim()) {
        return {
          content: [{ type: "text", text: "Error: empty .dd content." }],
          isError: true,
        } as CallToolResult;
      }
      // Persist as a design artifact (fire-and-forget, best-effort) + store for delta.
      lastDesignDoc = content;
      saveArtifactWithLineage(projectRoot, "design", "render", { title: deriveTitle(content), content });
      const sectionCount = (content.match(/<!--\s*dd:section\s/g) || []).length;
      return {
        content: [
          {
            type: "text",
            text: `DeepDesign rendered (${sectionCount} section(s)). Preview panel should now show the design.`,
          },
        ],
        metadata: { design: content },
      } as CallToolResult;
    }
  );

  // Tool: update_design — update an existing .dd document
  registerTool(
    "update_design",
    {
      description:
        "Update an existing OrcaDesign (.dd) document. Two modes:\n" +
        "1. Section delta (preferred): send only the changed sections via `sections` — " +
        "the server merges them into the stored document. Much more token-efficient.\n" +
        "2. Full replacement: send the complete updated document via `content`.",
      inputSchema: {
        content: z
          .string()
          .optional()
          .describe("Full updated .dd document (full replacement mode). Omit when using sections."),
        sections: z
          .array(
            z.object({
              id: z.string().describe("Section id from the front-matter sections list"),
              html: z.string().describe("New HTML content for this section (without the dd:section markers)"),
            })
          )
          .optional()
          .describe("Section-level patches (delta mode). Only changed sections needed."),
      },
    },
    async (args) => {
      // Delta mode: merge section patches into the stored .dd.
      if (Array.isArray(args.sections) && args.sections.length > 0 && lastDesignDoc) {
        const merged = mergeDesignSections(lastDesignDoc, args.sections as Array<{ id: string; html: string }>);
        if (merged) {
          lastDesignDoc = merged;
          saveArtifactWithLineage(projectRoot, "design", "update", { title: deriveTitle(merged), content: merged });
          const sectionCount = (merged.match(/<!--\s*dd:section\s/g) || []).length;
          return {
            content: [
              {
                type: "text",
                text: `DeepDesign updated via section delta (${args.sections.length} patched, ${sectionCount} total sections).`,
              },
            ],
            metadata: { design: merged },
          } as CallToolResult;
        }
      }

      // Full replacement mode (or delta failed → fall back).
      const content = String(args.content ?? "");
      if (!content.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "Error: provide either `sections` (delta) or `content` (full replacement).",
            },
          ],
          isError: true,
        } as CallToolResult;
      }
      lastDesignDoc = content;
      saveArtifactWithLineage(projectRoot, "design", "update", { title: deriveTitle(content), content });
      const sectionCount = (content.match(/<!--\s*dd:section\s/g) || []).length;
      return {
        content: [
          {
            type: "text",
            text: `DeepDesign updated (${sectionCount} section(s)).`,
          },
        ],
        metadata: { design: content },
      } as CallToolResult;
    }
  );
}

// ── .dd section delta merge ──────────────────────────────────────────────────

/** The latest .dd document stored by render_design/update_design (server-side state). */
let lastDesignDoc: string | null = null;

/**
 * Artifact lineage per project root: `render_*` creates a new artifact and
 * remembers its id; `update_*` saves onto the SAME id so iterations
 * accumulate as versions[] of one artifact instead of spawning a new
 * artifact per turn. `render_*` after a finished design starts a fresh
 * lineage, which is the intended semantics.
 */
const latestArtifactIds = new Map<string, { openui?: string; design?: string; spec?: string }>();

/** Save with lineage: create (render) or version (update), remembering the id. */
function saveArtifactWithLineage(
  root: string | undefined,
  kind: "openui" | "design" | "spec",
  mode: "render" | "update",
  input: { title: string; content: string; requirement?: string }
): void {
  if (!root) return;
  const latest = latestArtifactIds.get(root) ?? {};
  const id = mode === "update" ? latest[kind] : undefined;
  const meta = saveDesignArtifact(root, {
    ...(id ? { id } : {}),
    title: input.title,
    pipeline: kind,
    content: input.content,
    ...(input.requirement ? { requirement: input.requirement } : {}),
  });
  if (meta) {
    latestArtifactIds.set(root, { ...latest, [kind]: meta.id });
  }
}

/**
 * Merge section patches into a stored .dd document. Replaces the HTML between
 * the `<!-- dd:section <id> -->` and `<!-- /dd:section -->` markers for each
 * matched section id. Returns the merged full document, or null if any
 * section id was not found.
 */
function mergeDesignSections(doc: string, patches: Array<{ id: string; html: string }>): string | null {
  let result = doc;
  for (const patch of patches) {
    const open = `<!-- dd:section ${patch.id} -->`;
    const close = `<!-- /dd:section -->`;
    const openIdx = result.indexOf(open);
    if (openIdx === -1) return null; // Unknown section id.
    const closeIdx = result.indexOf(close, openIdx);
    if (closeIdx === -1) return null; // Malformed document.
    const before = result.slice(0, openIdx + open.length);
    const after = result.slice(closeIdx);
    result = `${before}\n${patch.html}\n${after}`;
  }
  return result;
}

/**
 * Build the MCP server config for A2UI. Since A2UI runs in-process via
 * InMemoryTransport, this returns a special marker config that the session
 * manager recognizes as "in-process" rather than a stdio spawn config.
 */
export function buildA2uiMcpServerConfig(): { _inProcess: true; serverBuilder: () => McpServer } | null {
  return {
    _inProcess: true as const,
    serverBuilder: buildA2uiServer,
  };
}
