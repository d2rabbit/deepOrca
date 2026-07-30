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

export const A2UI_MCP_SERVER_NAME = "a2ui";

// ── Disable flag (host-managed, per project root) ────────────────────────────

import path from "node:path";

const disabledA2uiRoots = new Set<string>();

/** Enable or disable the built-in A2UI MCP server for a project root. */
export function setA2uiDisabled(projectRoot: string, disabled: boolean): void {
  const key = path.resolve(projectRoot);
  if (disabled) {
    disabledA2uiRoots.add(key);
  } else {
    disabledA2uiRoots.delete(key);
  }
}

/** True when the built-in A2UI MCP server has been disabled for a project root. */
export function isA2uiDisabled(projectRoot: string): boolean {
  return disabledA2uiRoots.has(path.resolve(projectRoot));
}

// ── Surface state (in-memory, per server instance) ───────────────────────────

interface SurfaceState {
  surfaceId: string;
  title: string;
  messages: unknown[];
  dataModel: Record<string, unknown>;
}

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
    for (const [id, state] of surfaces) {
      const filePath = nodePath.join(dir, `${id}.json`);
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          { surfaceId: id, title: state.title, messages: state.messages, dataModel: state.dataModel },
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
        };
        surfaces.set(data.surfaceId, {
          surfaceId: data.surfaceId,
          title: data.title,
          messages: data.messages,
          dataModel: data.dataModel,
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

/** Build an `updateComponents` A2UI message from a flat component list. */
function updateComponentsMessage(surfaceId: string, components: unknown[]): unknown {
  return {
    type: "updateComponents",
    surfaceId,
    components,
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
function a2uiResult(messages: unknown[], text: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
      {
        type: "resource",
        resource: {
          uri: `a2ui://surface/${Date.now()}`,
          mimeType: "application/a2ui+json",
          text: JSON.stringify(messages),
        },
      },
    ],
  };
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
export function buildA2uiServer(): McpServer {
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

      surfaces.set(surfaceId, {
        surfaceId,
        title,
        messages: [createSurfaceMessage(surfaceId, title)],
        dataModel,
      });

      // Add component + data messages
      const messages: unknown[] = [
        createSurfaceMessage(surfaceId, title),
        updateComponentsMessage(surfaceId, components),
        updateDataModelMessage(surfaceId, dataModel),
      ];

      surfaces.get(surfaceId)!.messages = messages;

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
        "rebuilding from scratch.",
      inputSchema: {
        surfaceId: z.string().describe("ID of the Surface to update"),
        components: z
          .array(z.record(z.unknown()))
          .describe("Updated component definitions (replaces existing components for this surface)"),
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

      if (args.title) {
        state.title = String(args.title);
      }

      if (args.components) {
        const components = args.components as unknown[];
        messages.push(updateComponentsMessage(surfaceId, components));
      }

      if (args.dataModelPatch) {
        const patch = args.dataModelPatch as Record<string, unknown>;
        state.dataModel = { ...state.dataModel, ...patch };
        messages.push(updateDataModelMessage(surfaceId, state.dataModel));
      }

      state.messages = [...state.messages, ...messages];

      const summary = `Surface "${state.title}" updated: ${messages.length} message(s).`;
      return a2uiResult(messages, summary);
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

      // Auto-handle navigation actions (navigate:<pageName>)
      if (actionName.startsWith("navigate:")) {
        const pageName = actionName.slice("navigate:".length);
        const state = surfaces.get(surfaceId);
        if (state) {
          const pages = (state.dataModel["nav.pages"] as string[]) ?? [];
          const pageTitle = pageName;
          state.dataModel = {
            ...state.dataModel,
            "nav.currentPage": pageTitle.charAt(0).toUpperCase() + pageTitle.slice(1),
            "nav.currentPageContent": `Content for ${pageTitle} — ask me to add components here.`,
            "nav.currentPageId": pageName,
          };
          const messages = [updateDataModelMessage(surfaceId, state.dataModel)];
          state.messages = [...state.messages, ...messages];
          return a2uiResult(messages, `Navigated to page "${pageTitle}".`);
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

      const messages = [updateDataModelMessage(surfaceId, state.dataModel)];
      state.messages = [...state.messages, ...messages];

      return a2uiResult(messages, `Navigated to page "${pageTitle}" (id: ${pageName}).`);
    }
  );

  return server;
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
