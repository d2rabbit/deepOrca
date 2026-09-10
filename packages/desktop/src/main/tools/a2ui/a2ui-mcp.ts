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
import { validateOpenuiCode } from "./openui-validate";
import { looksLikeArchDoc, OPENUI_PRESERVE_CONTRACT } from "@deeporca/core";
import { BASIC_CATALOG_ID, convertLegacyComponents } from "../../../shared/a2ui-legacy";
import {
  appendDesignSuiteVersion,
  createDesignSuite,
  deriveTitle,
  isSafeDesignId,
  isSuiteNormalizedArtifact,
  readDesignSuite,
  readDesignSuiteKind,
  readDesignSuiteVersion,
  saveDesignArtifact,
} from "../design-store.js";
import type {
  DesignArtifactRef,
  DesignQualityResult,
  DesignSuiteContent,
  DesignSuiteKind,
  DesignSuiteStatus,
  PrototypeSuiteContent,
  PrototypeVerificationResult,
  UiSuiteContent,
} from "../design-store.js";

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
      // TYPED-IR PROTECTION (root-cause fix 2026-08-31): the archify era
      // writes typed-IR (carries `schema_version`/`diagram_type`) into this
      // same directory with the WRITE TOOL — a prefix-only sweep deleted
      // freshly authored, validated architecture maps right after their task
      // ended, and the deliver gate then saw an empty dir (real machine:
      // this repo twice + GVGL). Typed-IR is never ours to sweep; everything
      // else (stale A2UI surfaces, junk placeholders, unparsable leftovers)
      // keeps the original sweep semantics.
      let isTypedIr = false;
      try {
        const parsed = JSON.parse(fs.readFileSync(nodePath.join(dir, f), "utf8")) as {
          schema_version?: unknown;
          diagram_type?: unknown;
        };
        isTypedIr = parsed.schema_version !== undefined || parsed.diagram_type !== undefined;
      } catch {
        // unparsable junk — sweep it (original behavior)
      }
      if (isTypedIr) continue;
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
      // Defense in depth: surface ids become file names — an id that slipped
      // past the tool boundary (e.g. restored from disk) must never reach
      // path.join with traversal segments.
      if (!isSafeDesignId(id)) continue;
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
        // The id becomes a file name at flush time — a hand-crafted/traversal
        // id on disk must never re-enter the surfaces map (nor knownSurfaceIds).
        if (!isSafeDesignId(data.surfaceId)) continue;
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

const artifactRefSchema = z.object({
  suiteId: z.string(),
  versionId: z.string(),
});

const suiteLineageSchema = {
  suiteId: z.string().optional().describe("Existing suite id. Omit to create a new suite."),
  versionId: z.string().optional().describe("Immutable suite version to use as the update base."),
  note: z.string().optional().describe("Optional note recorded on the appended suite version."),
  sourcePrototype: artifactRefSchema.optional().describe("Prototype suite/version used as the UI design source."),
  designSystemId: z.string().optional().describe("Design system template id used for this UI design."),
};

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourcePrototypeArg(args: Record<string, unknown>): { suiteId: string; versionId: string } | undefined {
  const value = args.sourcePrototype;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const suiteId = stringArg(record, "suiteId");
  const versionId = stringArg(record, "versionId");
  return suiteId && versionId ? { suiteId, versionId } : undefined;
}

function usesSuitePersistence(args: Record<string, unknown>): boolean {
  return ["suiteId", "versionId", "note", "sourcePrototype", "designSystemId"].some((key) => args[key] !== undefined);
}

function suiteError(message: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// save_suite_result persists model-supplied payloads verbatim — clamp them at
// the tool boundary so one runaway LLM blob cannot bloat the suite store.
const SUITE_PAYLOAD_MAX_CHARS = 512 * 1024;
const SUITE_PAYLOAD_MAX_DEPTH = 12;

function jsonDepth(value: unknown, depth = 0): number {
  // Recursion is bounded one level past the budget: anything reaching
  // MAX_DEPTH + 1 returns >= MAX_DEPTH + 1, so "> MAX_DEPTH" rejects 13+ while
  // a structure nested exactly MAX_DEPTH deep still passes.
  if (value === null || typeof value !== "object" || depth >= SUITE_PAYLOAD_MAX_DEPTH + 1) return depth;
  let max = depth + 1;
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    max = Math.max(max, jsonDepth(item, depth + 1));
    if (max >= SUITE_PAYLOAD_MAX_DEPTH + 1) break;
  }
  return max;
}

/** Reason the payload must be rejected, or null when it fits the budget. */
function suitePayloadError(value: unknown): string | null {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return "payload is not JSON-serializable";
  }
  if (encoded !== undefined && encoded.length > SUITE_PAYLOAD_MAX_CHARS) {
    return `payload is too large (limit ${SUITE_PAYLOAD_MAX_CHARS} characters)`;
  }
  if (jsonDepth(value) > SUITE_PAYLOAD_MAX_DEPTH) {
    return `payload nesting exceeds depth ${SUITE_PAYLOAD_MAX_DEPTH}`;
  }
  return null;
}

function artifactResult(
  ref: DesignArtifactRef,
  message: string,
  metadata: Record<string, unknown> = {}
): CallToolResult {
  const structuredContent = { artifactRef: ref };
  return {
    content: [{ type: "text", text: `${message}\nArtifactRef: ${JSON.stringify(ref)}` }],
    structuredContent,
    metadata: { ...metadata, artifactRef: ref, structuredContent },
  } as CallToolResult;
}

function readSuiteBase(
  root: string | undefined,
  suiteId: string,
  versionId: string | undefined,
  kind: DesignSuiteKind
): { content: DesignSuiteContent; title: string } | { error: string } {
  if (!root) return { error: "suite persistence requires a project root" };
  const suite = readDesignSuite(root, suiteId);
  if (!suite) return { error: `suite "${suiteId}" not found` };
  if (suite.kind !== kind) return { error: `suite "${suiteId}" is ${suite.kind}, expected ${kind}` };
  // Same contract as save_suite_result: appending against a non-head version
  // must not silently roll the suite head back — the caller has to re-read
  // the latest version and retry against it.
  if (versionId && versionId !== suite.currentVersionId) {
    return {
      error:
        `suite head has moved: the latest version of "${suiteId}" is "${suite.currentVersionId}", ` +
        `not "${versionId}". Re-read the latest version and retry against it.`,
    };
  }
  const version = versionId ? readDesignSuiteVersion(root, suiteId, versionId) : suite.currentVersion;
  if (!version) return { error: `version "${versionId}" not found in suite "${suiteId}"` };
  return { content: version.content, title: suite.title };
}

/** Ref carries the appended/created version; error carries a tool-facing
 *  reason (head-moved, kind mismatch, …) so callers can surface it verbatim
 *  instead of a generic "could not append". */
type SuitePersistOutcome = { ref: DesignArtifactRef } | { error: string };

function persistSuiteContent(
  root: string | undefined,
  args: Record<string, unknown>,
  kind: DesignSuiteKind,
  title: string,
  build: (base: DesignSuiteContent | undefined) => DesignSuiteContent,
  status: DesignSuiteStatus
): SuitePersistOutcome {
  if (!root) return { error: "suite persistence requires a project root" };
  const suiteId = stringArg(args, "suiteId");
  const versionId = stringArg(args, "versionId");
  if (versionId && !suiteId) return { error: "versionId requires suiteId" };
  const note = stringArg(args, "note");
  if (!suiteId) {
    const content = build(undefined);
    // Post-switch creations are authored against the official openuiLibrary
    // prompt — stamp it so the renderer never has to guess from component
    // names (shared-name-only suites misroute under the text heuristic).
    const created =
      kind === "prototype"
        ? createDesignSuite(root, {
            title,
            kind,
            content: content as PrototypeSuiteContent,
            ...(note ? { note } : {}),
            status,
            authoringLibrary: "official",
          })
        : createDesignSuite(root, {
            title,
            kind,
            content: content as UiSuiteContent,
            ...(note ? { note } : {}),
            status,
            authoringLibrary: "official",
          });
    return created
      ? { ref: { suiteId: created.id, versionId: created.currentVersionId, kind } }
      : { error: "could not create the design suite" };
  }
  const base = readSuiteBase(root, suiteId, versionId, kind);
  if ("error" in base) return { error: base.error };
  const updated = appendDesignSuiteVersion(root, {
    suiteId,
    content: build(base.content),
    ...(note ? { note } : {}),
    status,
  });
  return updated
    ? { ref: { suiteId: updated.id, versionId: updated.currentVersionId, kind } }
    : { error: "could not append the design suite" };
}

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
      // The surface id becomes a file name under .deeporca/prototypes at flush
      // time — reject traversal/unsafe ids at the boundary instead of letting
      // them reach path.join.
      if (!isSafeDesignId(surfaceId)) {
        return {
          content: [
            {
              type: "text",
              text: "Error: surfaceId must be a safe identifier (letters, digits, '.', '_', '-'; no '/', '\\\\' or '..').",
            },
          ],
          isError: true,
        };
      }
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
      // Same file-name boundary as render_surface.
      if (!isSafeDesignId(surfaceId)) {
        return {
          content: [
            {
              type: "text",
              text: "Error: surfaceId must be a safe identifier (letters, digits, '.', '_', '-'; no '/', '\\\\' or '..').",
            },
          ],
          isError: true,
        };
      }
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
        "Called by the prototype.spec action, which validates the spec-writer output and " +
        "persists it here (prototype module step 1); prototype.materialize " +
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
        ...suiteLineageSchema,
      },
    },
    async (args) => {
      const document = String(args.document ?? "");
      if (!document.trim()) {
        return { content: [{ type: "text", text: "Error: empty requirements document." }], isError: true };
      }
      const requirement =
        typeof args.requirement === "string" && args.requirement.trim() ? args.requirement : undefined;
      if (usesSuitePersistence(args)) {
        if (stringArg(args, "versionId") && !stringArg(args, "suiteId")) {
          return suiteError("versionId requires suiteId");
        }
        const persisted = persistSuiteContent(
          projectRoot,
          args,
          "prototype",
          deriveTitle(document),
          (base) => ({
            ...((base ?? {}) as PrototypeSuiteContent),
            ...(requirement ? { requirement } : {}),
            spec: document,
            openui: undefined,
            // spec 重写后旧架构文档随之失效,与 openui 同等重置(否则新版本
            // 会带着与当前 PRD 不符的"已批准架构")。
            arch: undefined,
            // 三端平台变体全部派生自旧 PRD,同等失效(评审:平台变体生命周期
            // 与 openui 本体一致)。
            openuiVariants: undefined,
            verification: { status: "pending", checks: [] },
          }),
          "draft"
        );
        if ("error" in persisted) return suiteError(persisted.error);
        return artifactResult(
          persisted.ref,
          "Requirements document saved as a prototype suite version. OpenUI and verification were reset.",
          { spec: document }
        );
      }
      const saveError = saveArtifactWithLineage(projectRoot, "spec", "render", {
        title: deriveTitle(document),
        content: document,
        requirement,
      });
      if (saveError) return suiteError(saveError);
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

  // Tool: validate_openui — parse an OpenUI Lang program against the OFFICIAL
  // component schema with the local lang-core parser (no network, no OpenUI
  // service). Returns a structured JSON verdict so the caller can drive a
  // repair round before anything is persisted (user ask 2026-09-09 自递归
  // 验证循环); the schema artifact is drift-checked against the renderer's
  // library by the desktop build.
  registerTool(
    "validate_openui",
    {
      description:
        "Validate an OpenUI Lang program against the official component schema (local parser). " +
        "Returns JSON: { valid, incomplete, statementCount, errors[{code,component,path,message}], deadButtons[], " +
        "unresolved[], orphaned[] }. Run this before render_openui/update_openui and fix every finding.",
      inputSchema: {
        code: z.string().describe("Complete OpenUI Lang program"),
      },
    },
    async (args) => {
      const code = stringArg(args, "code");
      if (!code || !code.trim()) {
        return suiteError("code is required");
      }
      const verdict = validateOpenuiCode(code);
      return {
        content: [{ type: "text", text: JSON.stringify(verdict) }],
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
        "OpenUI Lang is a compact, line-oriented language that is ~3x more token-efficient than JSON. " +
        "Use this for PM-Designer prototypes.\n\n" +
        "Official component library (root = Stack): layout Stack/Card/CardHeader/Tabs/Accordion/Modal/Separator; " +
        "content TextContent/MarkDownRenderer/Tag/Callout/CodeBlock/Image/ImageGallery/Carousel/Steps/ListBlock/SectionBlock; " +
        "data Table/Col and charts (LineChart/BarChart/AreaChart/PieChart/RadarChart/...); " +
        "forms Form/FormControl/Input/TextArea/Select/DatePicker/Slider/RadioGroup/CheckBoxGroup/SwitchGroup/Buttons.\n" +
        "Syntax: `identifier = ComponentName(positional args)`, children are arrays, forward references allowed. " +
        'State: `$page = "home"` + ternary views + `Action([@Set($page, "target")])` navigation — ONE interactive app, never stacked screens.\n' +
        "Example:\n" +
        "```\n" +
        '$page = "home"\n' +
        'root = Stack([nav, $page == "home" ? homeView : loginView])\n' +
        'nav = Stack([Button("登录", Action([@Set($page, "login")]))], "row")\n' +
        'homeView = TextContent("概览", "large-heavy")\n' +
        'loginView = TextContent("登录页", "large-heavy")\n' +
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
        device: z
          .enum(["desktop", "mobile", "tablet"])
          .optional()
          .describe(
            "Platform variant target (user ask 2026-09-09: 三端是平台化适配). desktop (default) writes the base " +
              "openui program; mobile/tablet write structurally distinct platform variants (openuiVariants)."
          ),
        ...suiteLineageSchema,
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
      const requirement =
        typeof args.requirement === "string" && args.requirement.trim() ? args.requirement : undefined;
      const device =
        args.device === "mobile" || args.device === "tablet" || args.device === "desktop" ? args.device : undefined;
      if (usesSuitePersistence(args)) {
        if (stringArg(args, "versionId") && !stringArg(args, "suiteId")) {
          return suiteError("versionId requires suiteId");
        }
        const sourcePrototype = sourcePrototypeArg(args);
        const designSystemId = stringArg(args, "designSystemId");
        // Appending to an existing suite keeps the suite's kind: a bare
        // suiteId+versionId append (no designSystemId/sourcePrototype) would
        // otherwise compute kind "prototype" from the args heuristic and fail
        // against a ui suite (update_openui already derives it this way).
        const suiteId = stringArg(args, "suiteId");
        // Re-review L6: meta-only probe — a full readDesignSuite here loaded
        // every version file just to learn the kind.
        const existingKind = suiteId && projectRoot ? readDesignSuiteKind(projectRoot, suiteId) : null;
        const kind: DesignSuiteKind = existingKind ?? (sourcePrototype || designSystemId ? "ui" : "prototype");
        const persisted = persistSuiteContent(
          projectRoot,
          args,
          kind,
          deriveTitle(code),
          (base) =>
            kind === "ui"
              ? {
                  ...((base ?? {}) as UiSuiteContent),
                  ...(requirement ? { requirement } : {}),
                  openui: code,
                  ...(sourcePrototype ? { sourcePrototype } : {}),
                  ...(designSystemId ? { designSystemId } : {}),
                  quality: { lintFindings: [], runtimeChecks: [] },
                }
              : {
                  ...((base ?? {}) as PrototypeSuiteContent),
                  ...(requirement ? { requirement } : {}),
                  // 平台分流(user ask 2026-09-09):desktop 写本体;mobile/tablet
                  // 写 openuiVariants[device],本体保持桌面版不动。
                  ...(device === "mobile" || device === "tablet"
                    ? {
                        openuiVariants: {
                          ...((base as PrototypeSuiteContent | null)?.openuiVariants ?? {}),
                          [device]: code,
                        },
                      }
                    : { openui: code }),
                  verification: { status: "pending", checks: [] },
                },
          "ready"
        );
        if ("error" in persisted) return suiteError(persisted.error);
        return artifactResult(persisted.ref, `OpenUI rendered (${code.split("\n").length} statements).`, {
          openui: code,
        });
      }
      const renderError = saveArtifactWithLineage(projectRoot, "openui", "render", {
        title: deriveTitle(code),
        content: code,
        requirement,
      });
      if (renderError) return suiteError(renderError);
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

  // Tool: render_leafer — persist a Leafer JSON scene tree as a UI-Design
  // suite version (specs/leafer-ui-engine). The leafer counterpart of
  // render_openui's suite path: called ONLY by the design.* actions after the
  // core-side structural gate (LEAFER contract + repairLeaferProgram); the
  // boundary still re-parses cheaply. Suite persistence only — a UI suite
  // version stores the document in content.leafer and never mixes it with
  // content.openui (field-level single-stack invariant, guard-tested).
  registerTool(
    "render_leafer",
    {
      description:
        "Persist a Leafer scene-tree JSON document as a UI-Design suite version (pipeline leafer). " +
        'The document is the complete `{tag: "Leafer", width, height, fill, children}` scene tree produced ' +
        "by the deep-design skill and validated by the design action. Suite persistence only — " +
        "pass designSystemId (new suite) or suiteId+versionId (append); content.leafer never mixes with content.openui.",
      inputSchema: {
        leafer: z.string().describe("Complete Leafer scene-tree JSON document (a single JSON object)"),
        requirement: z
          .string()
          .optional()
          .describe("The user's original requirement text (persisted as requirement.md; pass when known)."),
        ...suiteLineageSchema,
      },
    },
    async (args) => {
      const leafer = stringArg(args, "leafer");
      if (!leafer) return suiteError("leafer JSON is required");
      // Boundary re-validation: the core repair gate already ran, but this tool
      // is model-reachable directly, so the cheap root-shape parse must hold at
      // the write boundary too.
      try {
        const parsed: unknown = JSON.parse(leafer);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        const root = parsed as { tag?: unknown; children?: unknown };
        if (root.tag !== "Leafer") throw new Error('root.tag must be "Leafer"');
        if (!Array.isArray(root.children)) throw new Error("root.children must be an array");
      } catch (error) {
        return suiteError(`leafer: invalid scene document (${error instanceof Error ? error.message : String(error)})`);
      }
      if (!usesSuitePersistence(args)) {
        return suiteError("render_leafer persists suite versions — pass designSystemId or suiteId/versionId lineage");
      }
      const requirement =
        typeof args.requirement === "string" && args.requirement.trim() ? args.requirement : undefined;
      const sourcePrototype = sourcePrototypeArg(args);
      const designSystemId = stringArg(args, "designSystemId");
      const persisted = persistSuiteContent(
        projectRoot,
        args,
        "ui",
        deriveTitle(requirement ?? "UI Design"),
        (base) => ({
          ...((base ?? {}) as UiSuiteContent),
          ...(requirement ? { requirement } : {}),
          leafer,
          openui: undefined,
          ...(sourcePrototype ? { sourcePrototype } : {}),
          ...(designSystemId ? { designSystemId } : {}),
          quality: { lintFindings: [], runtimeChecks: [] },
        }),
        "ready"
      );
      if ("error" in persisted) return suiteError(persisted.error);
      return artifactResult(persisted.ref, `Leafer design saved (${leafer.length} chars).`, { leafer });
    }
  );

  // Tool: update_openui — replace an existing OpenUI Lang prototype with updated code
  registerTool(
    "update_openui",
    {
      description:
        "Replace an existing OpenUI Lang prototype with updated code. " +
        "Send the complete updated program (full replacement). " +
        "To iterate efficiently, copy the previous code and modify only the parts that need changing. " +
        OPENUI_PRESERVE_CONTRACT,
      inputSchema: {
        code: z.string().describe("Complete updated OpenUI Lang program (full replacement, not delta)."),
        device: z
          .enum(["desktop", "mobile", "tablet"])
          .optional()
          .describe(
            "Platform variant target: desktop (default) updates the base openui program; " +
              "mobile/tablet update their openuiVariants entry."
          ),
        ...suiteLineageSchema,
      },
    },
    async (args) => {
      const code = String(args.code ?? "");
      if (!code.trim()) return suiteError("empty OpenUI Lang code");
      if (usesSuitePersistence(args)) {
        const suiteId = stringArg(args, "suiteId");
        if (!suiteId) return suiteError("update_openui suite mode requires suiteId");
        const device =
          args.device === "mobile" || args.device === "tablet" || args.device === "desktop" ? args.device : undefined;
        const targetKind: DesignSuiteKind =
          (projectRoot && suiteId ? readDesignSuiteKind(projectRoot, suiteId) : null) ?? "prototype";
        const sourcePrototype = sourcePrototypeArg(args);
        const designSystemId = stringArg(args, "designSystemId");
        const persisted = persistSuiteContent(
          projectRoot,
          args,
          targetKind,
          deriveTitle(code),
          (base) =>
            targetKind === "ui"
              ? {
                  ...((base ?? {}) as UiSuiteContent),
                  openui: code,
                  ...(sourcePrototype ? { sourcePrototype } : {}),
                  ...(designSystemId ? { designSystemId } : {}),
                  quality: { lintFindings: [], runtimeChecks: [] },
                }
              : {
                  ...((base ?? {}) as PrototypeSuiteContent),
                  // 平台分流(与 render_openui 同规):desktop 改本体;
                  // mobile/tablet 改自己的变体,本体与其它端不动。
                  ...(device === "mobile" || device === "tablet"
                    ? {
                        openuiVariants: {
                          ...((base as PrototypeSuiteContent | null)?.openuiVariants ?? {}),
                          [device]: code,
                        },
                      }
                    : { openui: code }),
                  // 原型重写后旧架构文档随之失效(与 render_spec 同规)。
                  ...(device === "mobile" || device === "tablet" ? {} : { arch: undefined }),
                  verification: { status: "pending", checks: [] },
                },
          "ready"
        );
        if ("error" in persisted) return suiteError(persisted.error);
        return artifactResult(persisted.ref, `OpenUI updated (${code.split("\n").length} statements).`, {
          openui: code,
        });
      }
      // Iterate on the same artifact (versions[] accumulate; render_openui
      // starts a fresh lineage for a brand-new prototype).
      const updateError = saveArtifactWithLineage(projectRoot, "openui", "update", {
        title: deriveTitle(code),
        content: code,
      });
      if (updateError) return suiteError(updateError);
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

  registerTool(
    "read_suite_version",
    {
      description: "Read one immutable design-suite version for action orchestration.",
      inputSchema: {
        suiteId: z.string().describe("Suite id"),
        versionId: z.string().optional().describe("Version id; omit for the current version"),
      },
    },
    async (args) => {
      if (!projectRoot) return suiteError("suite reads require a project root");
      const suiteId = stringArg(args, "suiteId");
      if (!suiteId) return suiteError("suiteId is required");
      const suite = readDesignSuite(projectRoot, suiteId);
      if (!suite) return suiteError(`suite "${suiteId}" not found`);
      const versionId = stringArg(args, "versionId");
      const version = versionId ? readDesignSuiteVersion(projectRoot, suiteId, versionId) : suite.currentVersion;
      if (!version) return suiteError(`version "${versionId}" not found in suite "${suiteId}"`);
      const ref: DesignArtifactRef = { suiteId, versionId: version.versionId, kind: suite.kind };
      const payload = { artifactRef: ref, title: suite.title, status: version.status, content: version.content };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
        metadata: { structuredContent: payload, artifactRef: ref },
      } as CallToolResult;
    }
  );

  registerTool(
    "save_suite_result",
    {
      description:
        "Append deterministic prototype verification or UI quality/tokens/components to a selected suite version.",
      inputSchema: {
        suiteId: z.string().describe("Suite id"),
        versionId: z.string().describe("Immutable version used as the update base"),
        note: z.string().optional().describe("Version note"),
        verification: z.unknown().optional().describe("Prototype verification result"),
        quality: z.unknown().optional().describe("UI quality result"),
        tokens: z.unknown().optional().describe("UI design tokens"),
        components: z.unknown().optional().describe("UI component inventory"),
        clearReview: z.boolean().optional().describe("Remove UI quality.review and keep deterministic quality fields"),
      },
    },
    async (args) => {
      if (!projectRoot) return suiteError("suite writes require a project root");
      const suiteId = stringArg(args, "suiteId");
      const versionId = stringArg(args, "versionId");
      if (!suiteId || !versionId) return suiteError("suiteId and versionId are required");
      const suite = readDesignSuite(projectRoot, suiteId);
      const version = readDesignSuiteVersion(projectRoot, suiteId, versionId);
      if (!suite || !version) return suiteError("suite or version not found");
      // Contract fix: appending against a non-head version must not silently
      // roll the suite head back — the caller has to re-read the latest
      // version and retry against it.
      if (suite.currentVersionId !== versionId) {
        return suiteError(
          `suite head has moved: the latest version of "${suiteId}" is "${suite.currentVersionId}", ` +
            `not "${versionId}". Re-read the latest version and retry against it.`
        );
      }
      // Clamp the model-supplied payloads before they are persisted verbatim.
      for (const key of ["verification", "quality", "tokens", "components"] as const) {
        if (args[key] === undefined) continue;
        const reason = suitePayloadError(args[key]);
        if (reason) return suiteError(`${key}: ${reason}`);
      }
      const note = stringArg(args, "note");
      let content: DesignSuiteContent;
      let status: DesignSuiteStatus;
      if (suite.kind === "prototype") {
        if (!args.verification || typeof args.verification !== "object") {
          return suiteError("prototype suites require a verification result");
        }
        const verification = args.verification as PrototypeVerificationResult;
        content = { ...(version.content as PrototypeSuiteContent), verification };
        status =
          verification.status === "passed"
            ? "verified"
            : version.content && (version.content as PrototypeSuiteContent).openui
              ? "ready"
              : "draft";
      } else {
        const base = version.content as UiSuiteContent;
        let quality = base.quality;
        if (args.quality && typeof args.quality === "object") quality = args.quality as DesignQualityResult;
        if (args.clearReview === true) {
          const previous = quality ?? { lintFindings: [], runtimeChecks: [] };
          quality = { lintFindings: previous.lintFindings, runtimeChecks: previous.runtimeChecks };
        }
        content = {
          ...base,
          ...(args.tokens !== undefined ? { tokens: args.tokens } : {}),
          ...(args.components !== undefined ? { components: args.components } : {}),
          ...(quality ? { quality } : {}),
        };
        status = quality?.review?.status === "passed" ? "verified" : "ready";
      }
      const updated = appendDesignSuiteVersion(projectRoot, {
        suiteId,
        content,
        ...(note ? { note } : {}),
        status,
      });
      if (!updated) return suiteError("could not append suite result");
      const ref: DesignArtifactRef = { suiteId, versionId: updated.currentVersionId, kind: suite.kind };
      return artifactResult(ref, `Suite ${suite.kind} result saved.`);
    }
  );

  registerTool(
    "save_suite_arch",
    {
      description:
        "Persist the technical architecture document (standardized markdown) for a prototype suite version. " +
        "Enforced here: the suite's verification must already have passed, and the document must carry at " +
        "least one Mermaid diagram (user ask 2026-09-08 技术架构模块).",
      inputSchema: {
        suiteId: z.string().describe("Suite id"),
        versionId: z.string().describe("Immutable version used as the update base"),
        document: z.string().describe("Complete technical architecture markdown document"),
        note: z.string().optional().describe("Version note"),
      },
    },
    async (args) => {
      if (!projectRoot) return suiteError("suite writes require a project root");
      const suiteId = stringArg(args, "suiteId");
      const versionId = stringArg(args, "versionId");
      const document = stringArg(args, "document");
      if (!suiteId || !versionId || !document) {
        return suiteError("suiteId, versionId and document are required");
      }
      const suite = readDesignSuite(projectRoot, suiteId);
      const version = readDesignSuiteVersion(projectRoot, suiteId, versionId);
      if (!suite || !version) return suiteError("suite or version not found");
      if (suite.kind !== "prototype") return suiteError("suite is not a prototype suite");
      const base = version.content as PrototypeSuiteContent;
      // Same verification gate as the prototype.arch action — this tool is
      // model-reachable directly, so the gate must hold at the write boundary,
      // not only in the action layer.
      if (base.verification?.status !== "passed") {
        return suiteError("verification must pass before the technical architecture document can be saved");
      }
      const note = stringArg(args, "note");
      // Same model-supplied-payload clamp as save_suite_result.
      const documentReason = suitePayloadError(document);
      if (documentReason) return suiteError(`document: ${documentReason}`);
      // Same standardized-format contract as the action (heading + Mermaid).
      if (!looksLikeArchDoc(document)) {
        return suiteError("document: architecture document must be markdown with at least one mermaid diagram");
      }
      // Same head-moved contract as save_suite_result: never roll the head back.
      if (suite.currentVersionId !== versionId) {
        return suiteError(
          `suite head has moved: the latest version of "${suiteId}" is "${suite.currentVersionId}", ` +
            `not "${versionId}". Re-read the latest version and retry against it.`
        );
      }
      const content: PrototypeSuiteContent = { ...base, arch: document };
      const updated = appendDesignSuiteVersion(projectRoot, {
        suiteId,
        content,
        ...(note ? { note } : {}),
        // Appending the arch doc must not downgrade an already-verified suite.
        status: base.verification?.status === "passed" ? "verified" : "ready",
      });
      if (!updated) return suiteError("could not append suite arch");
      const ref: DesignArtifactRef = { suiteId, versionId: updated.currentVersionId, kind: suite.kind };
      return artifactResult(ref, "Technical architecture document saved.");
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
        requirement: z.string().optional().describe("Original UI requirement for suite provenance."),
        ...suiteLineageSchema,
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
      lastDesignDoc = content;
      const renderError = saveArtifactWithLineage(projectRoot, "design", "render", {
        title: deriveTitle(content),
        content,
      });
      if (renderError) return suiteError(renderError);
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
        ...suiteLineageSchema,
      },
    },
    async (args) => {
      const baseDesign = lastDesignDoc;

      let nextContent: string | null = null;
      let deltaCount = 0;
      if (Array.isArray(args.sections) && args.sections.length > 0 && baseDesign) {
        nextContent = mergeDesignSections(baseDesign, args.sections as Array<{ id: string; html: string }>);
        deltaCount = args.sections.length;
      }
      if (!nextContent) {
        const full = String(args.content ?? "");
        if (!full.trim()) {
          return suiteError("provide valid `sections` for the selected version or `content` as a full replacement");
        }
        nextContent = full;
        deltaCount = 0;
      }

      lastDesignDoc = nextContent;
      const sectionCount = (nextContent.match(/<!--\s*dd:section\s/g) || []).length;

      const updateError = saveArtifactWithLineage(projectRoot, "design", "update", {
        title: deriveTitle(nextContent),
        content: nextContent,
      });
      if (updateError) return suiteError(updateError);
      const message = deltaCount
        ? `DeepDesign updated via section delta (${deltaCount} patched, ${sectionCount} total sections).`
        : `DeepDesign updated (${sectionCount} section(s)).`;
      return { content: [{ type: "text", text: message }], metadata: { design: nextContent } } as CallToolResult;
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

/**
 * Save with lineage: create (render) or version (update), remembering the id.
 * Returns null on success; a caller-facing error string otherwise. The tool
 * layer MUST surface it — a legacy update whose lineage target was normalized
 * into a v2 suite used to throw-to-null and still report "updated" while
 * nothing was written.
 */
function saveArtifactWithLineage(
  root: string | undefined,
  kind: "openui" | "design" | "spec",
  mode: "render" | "update",
  input: { title: string; content: string; requirement?: string }
): string | null {
  if (!root) return null; // hostless context — unchanged fail-quiet semantics
  const latest = latestArtifactIds.get(root) ?? {};
  const id = mode === "update" ? latest[kind] : undefined;
  if (id && isSuiteNormalizedArtifact(root, id)) {
    return (
      `previous ${kind} artifact "${id}" was normalized into a v2 design suite — ` +
      "persist this revision by re-issuing the call with its suiteId (or render anew)"
    );
  }
  const meta = saveDesignArtifact(root, {
    ...(id ? { id } : {}),
    title: input.title,
    pipeline: kind,
    content: input.content,
    ...(input.requirement ? { requirement: input.requirement } : {}),
  });
  if (!meta) return `could not persist the ${kind} artifact (write failed)`;
  latestArtifactIds.set(root, { ...latest, [kind]: meta.id });
  return null;
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
