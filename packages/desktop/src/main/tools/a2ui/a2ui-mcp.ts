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
}

// Module-level surfaces are intentionally kept here because:
// 1. Only ONE A2UI server instance exists per process (InMemoryTransport)
// 2. Persistence functions need access from outside buildA2uiServer()
// 3. The server is rebuilt on session reload — persistSurfaces/restoreSurfaces
//    handle the state transfer across rebuilds.
// However, we clear it on rebuild to prevent cross-session leakage.
const surfaces = new Map<string, SurfaceState>();

// ── Persistence (save/load to .deeporca/prototypes/) ────────────────────────

/** Directory for persisted prototype surfaces. */
function getPrototypesDir(projectRoot: string): string {
  return nodePath.join(projectRoot, ".deeporca", "prototypes");
}

/** Save all active surfaces to disk. Called on session dispose. */
export function persistSurfaces(projectRoot: string): void {
  const dir = getPrototypesDir(projectRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Clear directory first to remove stale files from closed surfaces.
    const existing = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of existing) {
      try {
        fs.unlinkSync(nodePath.join(dir, f));
      } catch {
        // Best-effort.
      }
    }
    // Write current surfaces.
    for (const [id, state] of surfaces) {
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
        surfaces.set(data.surfaceId, {
          surfaceId: data.surfaceId,
          title: data.title,
          messages: data.messages,
          dataModel: data.dataModel,
          // Back-compat: older persisted files lack `components`. Recover it
          // by scanning the message history for the last updateComponents.
          components: data.components ?? extractComponentsFromMessages(data.messages),
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

// ── A2UI message builders ────────────────────────────────────────────────────

/** Build a `createSurface` A2UI message. */
function createSurfaceMessage(surfaceId: string, title: string): unknown {
  return {
    type: "createSurface",
    surfaceId,
    title,
    catalog: "basic",
  };
}

/** Build an `updateComponents` A2UI message from a flat component list (full replace). */
function updateComponentsMessage(surfaceId: string, components: unknown[]): unknown {
  return {
    type: "updateComponents",
    surfaceId,
    components,
  };
}

/**
 * Build a `patchComponents` A2UI message — delta-only merge patch.
 * Components with matching id replace existing ones; new ids are added;
 * `{ id, _delete: true }` removes a component. Unreachable components are
 * GC'd by the processor. This is inspired by OpenUI's mergeStatements.
 */
function patchComponentsMessage(surfaceId: string, components: unknown[]): unknown {
  return {
    type: "updateComponents",
    surfaceId,
    components,
    mode: "merge",
  };
}

/** Build an `updateDataModel` A2UI message. */
function updateDataModelMessage(surfaceId: string, dataModel: Record<string, unknown>): unknown {
  return {
    type: "updateDataModel",
    surfaceId,
    dataModel,
  };
}

/** Build a `deleteSurface` A2UI message. */
function deleteSurfaceMessage(surfaceId: string): unknown {
  return {
    type: "deleteSurface",
    surfaceId,
  };
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

/** Recover the latest components from a message history (back-compat for old persisted files). */
function extractComponentsFromMessages(messages: unknown[]): unknown[] {
  let components: unknown[] = [];
  for (const msg of messages) {
    if (msg && typeof msg === "object" && (msg as { type?: string }).type === "updateComponents") {
      const comps = (msg as { components?: unknown[] }).components;
      if (Array.isArray(comps)) components = comps;
    }
  }
  return components;
}

/** Build a self-contained snapshot of a surface (createSurface + components + dataModel). */
function snapshotMessages(state: SurfaceState): unknown[] {
  return [
    createSurfaceMessage(state.surfaceId, state.title),
    updateComponentsMessage(state.surfaceId, state.components),
    updateDataModelMessage(state.surfaceId, state.dataModel),
  ];
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

  // Tool: render_surface — create a new interactive Surface
  registerTool(
    "render_surface",
    {
      description:
        "Create a new A2UI Surface — an interactive, declarative UI that renders in the conversation. " +
        "Use this to build prototypes, dashboards, forms, or any UI that needs user interaction. " +
        "The Surface is a live object: the user can click buttons, fill forms, and you can " +
        "incrementally update it via `update_surface`.",
      inputSchema: {
        surfaceId: z.string().describe("Unique identifier for this Surface"),
        title: z.string().describe("Display title for the Surface"),
        components: z
          .array(z.record(z.unknown()))
          .describe(
            "A2UI component definitions (adjacency list). Each component has: id, type (Row/Column/Card/Text/Button/TextField/etc.), parentId, and properties."
          ),
        dataModel: z
          .record(z.unknown())
          .describe("Initial data model state (key-value pairs bound to components via JSON Pointer)"),
      },
    },
    async (args) => {
      const surfaceId = String(args.surfaceId ?? `surface-${Date.now()}`);
      const title = String(args.title ?? "A2UI Surface");
      const components = (args.components as unknown[]) ?? [];
      const dataModel = (args.dataModel as Record<string, unknown>) ?? {};

      const messages: unknown[] = [
        createSurfaceMessage(surfaceId, title),
        updateComponentsMessage(surfaceId, components),
        updateDataModelMessage(surfaceId, dataModel),
      ];

      surfaces.set(surfaceId, {
        surfaceId,
        title,
        messages,
        dataModel,
        components,
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
        "Pick a template (login-form, dashboard, list-detail, wizard, kanban, data-table) " +
        "and fill in params (field names, column names, items, etc.). The server generates " +
        "the complete component tree — you don't need to write A2UI JSON manually. " +
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

      const messages: unknown[] = [
        createSurfaceMessage(surfaceId, title),
        updateComponentsMessage(surfaceId, result.components),
        updateDataModelMessage(surfaceId, result.dataModel),
      ];

      surfaces.set(surfaceId, {
        surfaceId,
        title,
        messages,
        dataModel: result.dataModel,
        components: result.components,
      });

      return a2uiResult(
        messages,
        `Prototype "${title}" created from template "${template}" with ${result.components.length} components. Surface ID: ${surfaceId}. Ask the user to interact with it, or use update_surface to iterate.`
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

  // Tool: update_surface — incrementally patch an existing Surface
  registerTool(
    "update_surface",
    {
      description:
        "Update an existing A2UI Surface. Can add/remove/modify components or update the data model. " +
        "Use this to iterate on a prototype based on user feedback — the Surface updates live without " +
        "rebuilding from scratch.\n\n" +
        "Components are sent as a DELTA PATCH (not full replacement): components with matching id " +
        'replace existing ones, new ids are added, and `{ id: "...", _delete: true }` removes a component. ' +
        "Only send the components that changed — the renderer merges them into the existing surface.",
      inputSchema: {
        surfaceId: z.string().describe("ID of the Surface to update"),
        components: z
          .array(z.record(z.unknown()))
          .describe(
            "Delta patch of components. Same id = replace, new id = add, { id, _delete: true } = remove. " +
              "Only send changed/new components — not the full set."
          ),
        dataModelPatch: z.record(z.unknown()).describe("Partial data model update (merged into existing data model)"),
        title: z.string().optional().describe("Optional new title for the Surface"),
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
      let changedCount = 0;

      if (args.title) {
        state.title = String(args.title);
      }

      if (args.components) {
        const incoming = args.components as unknown[];
        // Merge into state.components by id (delta patch, not full replace).
        const componentMap = new Map((state.components as Array<{ id?: string }>).map((c) => [c.id ?? "", c]));
        for (const comp of incoming) {
          if (!comp || typeof (comp as { id?: unknown }).id !== "string") continue;
          const id = (comp as { id: string }).id;
          if ((comp as { _delete?: boolean })._delete) {
            componentMap.delete(id);
          } else {
            componentMap.set(id, comp);
          }
          changedCount++;
        }
        state.components = Array.from(componentMap.values());

        // Return a merge-mode patch message (delta-only, not full snapshot).
        // The processor will merge these by id and GC unreachable components.
        messages.push(patchComponentsMessage(surfaceId, incoming));
      }

      if (args.dataModelPatch) {
        const patch = args.dataModelPatch as Record<string, unknown>;
        state.dataModel = { ...state.dataModel, ...patch };
        // dataModel is already merged on the processor side, so send only
        // the patch keys (not the full dataModel).
        messages.push(updateDataModelMessage(surfaceId, patch));
      }

      state.messages = [...state.messages, ...messages];

      // Build the result payload. If this is the first update (no prior
      // components existed before this call), send a full snapshot so a
      // fresh renderer can hydrate. Otherwise, send only the delta messages.
      const hadComponentsBefore = changedCount > 0 && state.components.length > changedCount;
      const payload = hadComponentsBefore ? messages : snapshotMessages(state);
      const summary = `Surface "${state.title}" updated: ${changedCount} component(s) patched.`;
      return a2uiResult(payload, summary);
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

  // Tool: a2ui_action — receive user interaction (called by the host when user clicks/interacts)
  registerTool(
    "a2ui_action",
    {
      description:
        "Receive a user interaction from an A2UI Surface. " +
        "Called automatically when the user clicks a button, submits a form, or interacts with any " +
        "action-enabled component. The action name and context are provided by the component's " +
        "action configuration.",
      inputSchema: {
        surfaceId: z.string().describe("Surface the interaction originated from"),
        actionName: z.string().describe("Name of the action (from component's action config)"),
        context: z.record(z.unknown()).describe("Additional context data from the interaction"),
      },
    },
    async (args) => {
      const surfaceId = String(args.surfaceId ?? "");
      const actionName = String(args.actionName ?? "");
      const context = args.context ?? {};

      // Auto-handle navigation actions (navigate:<pageName>) — delegates to
      // the same logic as navigate_to tool to keep a single code path.
      if (actionName.startsWith("navigate:")) {
        const pageName = actionName.slice("navigate:".length);
        const state = surfaces.get(surfaceId);
        if (state) {
          state.dataModel = {
            ...state.dataModel,
            "nav.currentPage": pageName.charAt(0).toUpperCase() + pageName.slice(1),
            "nav.currentPageContent": `Content for ${pageName} — ask me to add components here.`,
            "nav.currentPageId": pageName,
          };
          state.messages = [...state.messages, updateDataModelMessage(surfaceId, state.dataModel)];
          return a2uiResult(snapshotMessages(state), `Navigated to page "${pageName}".`);
        }
      }

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

  // Tool: navigate_to — switch the current page in a multi-page prototype
  registerTool(
    "navigate_to",
    {
      description:
        "Switch the current page in a multi-page prototype Surface. Updates the " +
        "dataModel to show the new page's title and content placeholder. Use this " +
        "when the user clicks a navigation button with action 'navigate:<pageName>'.",
      inputSchema: {
        surfaceId: z.string().describe("ID of the multi-page Surface"),
        pageName: z.string().describe("Name of the page to navigate to"),
        pageTitle: z.string().optional().describe("Display title for the page (defaults to pageName)"),
        pageContent: z.string().optional().describe("Content text for the page (defaults to a placeholder)"),
      },
    },
    async (args) => {
      const surfaceId = String(args.surfaceId ?? "");
      const pageName = String(args.pageName ?? "");
      const pageTitle = String(args.pageTitle ?? pageName);
      const pageContent = String(args.pageContent ?? `Content for ${pageTitle} — ask me to add components here.`);

      const state = surfaces.get(surfaceId);
      if (!state) {
        return {
          content: [{ type: "text", text: `Surface "${surfaceId}" not found.` }],
          isError: true,
        };
      }

      // Update data model to switch page
      state.dataModel = {
        ...state.dataModel,
        "nav.currentPage": pageTitle,
        "nav.currentPageContent": pageContent,
        "nav.currentPageId": pageName,
      };

      state.messages = [...state.messages, updateDataModelMessage(surfaceId, state.dataModel)];

      return a2uiResult(snapshotMessages(state), `Navigated to page "${pageTitle}" (id: ${pageName}).`);
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
      if (projectRoot) {
        saveDesignArtifact(projectRoot, {
          title: deriveTitle(code),
          pipeline: "openui",
          content: code,
        });
      }
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
      if (projectRoot) {
        saveDesignArtifact(projectRoot, {
          title: deriveTitle(content),
          pipeline: "design",
          content,
        });
      }
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
          if (projectRoot) {
            saveDesignArtifact(projectRoot, {
              title: deriveTitle(merged),
              pipeline: "design",
              content: merged,
            });
          }
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
      if (projectRoot) {
        saveDesignArtifact(projectRoot, {
          title: deriveTitle(content),
          pipeline: "design",
          content,
        });
      }
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
