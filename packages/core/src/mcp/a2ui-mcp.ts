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
