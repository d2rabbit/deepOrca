/**
 * Activity-Frames MCP server — multi-source behavioral memory.
 *
 * Combines screen-capture activity data (optional, via nocta-recorder)
 * with session/git/shell/file collectors into a unified behavioral profile.
 * Uses InMemoryTransport (same pattern as a2ui-mcp.ts).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";
import type { ZodRawShape } from "zod/v3";
import { ActivityDb, findDefaultDb } from "./db";
import { buildDay, buildRecent } from "./frames";
import { appLedger, coverage } from "./sessionize";
import { localDayString, localDayWindowUtc, hoursAgoWindowUtc } from "./time";
import { collectProfile, formatContextBlock, formatProfileJson } from "./collectors/aggregator";
import { collectSessionProfile } from "./collectors/session-collector";
import { collectGitProfile } from "./collectors/git-collector";
import { collectShellProfile } from "./collectors/shell-collector";
import { collectFileProfile } from "./collectors/file-collector";

export const ACTIVITY_FRAMES_MCP_SERVER_NAME = "activity-frames";

type RegisterToolLoose = (
  name: string,
  config: { description?: string; inputSchema?: ZodRawShape },
  cb: (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>
) => unknown;

const SERVER_INFO = { name: "deeporca-activity-frames", version: "0.1.0" };

/**
 * Build the Activity-Frames MCP server. Registers up to 10 tools:
 * - Screen capture tools (get_context, get_activity, get_day_summary, get_steps,
 *   get_patterns, get_communications) — optional, requires nocta-recorder DB.
 * - Multi-source behavioral tools (get_hotspots, get_workflows) — always available,
 *   mines session/git/shell/file data.
 *
 * @param dbPath — Optional path to the screen-capture SQLite DB.
 * @param projectRoot — Optional project root for multi-source collectors.
 */
export function buildActivityFramesServer(dbPath?: string, projectRoot?: string): McpServer {
  const server = new McpServer(SERVER_INFO);
  const registerTool = server.registerTool.bind(server) as unknown as RegisterToolLoose;

  /**
   * Open a DB connection for a single tool call. Returns null if no DB exists.
   * The DB is opened read-only and closed after each call.
   */
  function withDb<T>(fn: (db: ActivityDb) => T): T | null {
    const path = dbPath ?? findDefaultDb();
    if (!path) return null;
    const db = new ActivityDb(path);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  /** Format a tool result as text content. */
  function textResult(text: string): CallToolResult {
    return { content: [{ type: "text", text }] };
  }

  /** Format a tool result as error (no DB available). */
  function noDbResult(): CallToolResult {
    return {
      content: [
        {
          type: "text",
          text: "Activity DB not found. Start the nocta-recorder to begin capturing activity, or set the DB path.",
        },
      ],
      isError: true,
    };
  }

  // NOTE: get_context is registered below as a multi-source tool when projectRoot
  // is available, or as a screen-only fallback otherwise.

  // Tool: get_activity — structured activity frames
  registerTool(
    "get_activity",
    {
      description:
        "Get structured activity frames for a time window. Returns an ActivityDocument JSON " +
        "with coverage stats and per-frame details (app, site, duration, pages, input).",
      inputSchema: {
        day: z.string().optional().describe("Specific day (YYYY-MM-DD). If set, overrides hours."),
        hours: z.number().optional().describe("Hours of activity (default: 2). Used if day is not set."),
        min_minutes: z
          .number()
          .optional()
          .describe("Minimum frame duration in minutes (default: 0.5). Shorter frames are omitted."),
      },
    },
    async (args) => {
      const day = args.day as string | undefined;
      const hours = Number(args.hours ?? 2);
      const minMinutes = Number(args.min_minutes ?? 0.5);

      const result = withDb((db) => {
        const doc = day ? buildDay(db, day, { minMinutes }) : buildRecent(db, hours, { minMinutes });
        return JSON.stringify(doc, null, 2);
      });
      return result !== null ? textResult(result) : noDbResult();
    }
  );

  // Tool: get_day_summary — coverage + per-app usage
  registerTool(
    "get_day_summary",
    {
      description:
        "Get a day-level summary: total coverage percentage, active minutes, per-app usage " +
        "(minutes, sessions, top windows). Great for 'what did I do today?' queries.",
      inputSchema: {
        day: z.string().optional().describe("Day in YYYY-MM-DD format (default: today)"),
      },
    },
    async (args) => {
      const dayStr = (args.day as string) ?? localDayString();
      const result = withDb((db) => {
        const [start, end] = localDayWindowUtc(dayStr);
        const cov = coverage(db, start, end);
        const apps = appLedger(db, start, end);
        return JSON.stringify(
          {
            day: dayStr,
            coverage: {
              activeMinutes: cov.activeMinutes,
              spanMinutes: cov.spanMinutes,
              coveragePct: cov.coveragePct,
              frameCount: cov.frameCount,
              distinctApps: cov.distinctApps,
              gaps: cov.gaps,
            },
            apps,
          },
          null,
          2
        );
      });
      return result !== null ? textResult(result) : noDbResult();
    }
  );

  // Tool: get_steps — expand a frame into a click-by-click replay script (stub)
  registerTool(
    "get_steps",
    {
      description:
        "Expand a specific activity frame into a step-by-step replay script. " +
        "Requires a frame ID from get_activity. (Beta — click resolution depends on accessibility data.)",
      inputSchema: {
        frame: z.string().describe("Frame ID (e.g. 'f-0002') from get_activity"),
        day: z.string().optional().describe("Day in YYYY-MM-DD (helps locate the frame)"),
        hours: z.number().optional().describe("Hours to search (default: 3)"),
      },
    },
    async (args) => {
      const frameId = String(args.frame ?? "");
      const result = withDb((db) => {
        // Phase 3: implement full click resolution.
        // For now, return the frame's summary.
        const hours = Number(args.hours ?? 3);
        const doc = buildRecent(db, hours);
        const frame = doc.frames.find((f) => f.index === frameId);
        if (!frame) {
          return JSON.stringify({
            error: `Frame ${frameId} not found in the last ${hours} hours.`,
            available: doc.frames.map((f) => ({ id: f.index, app: f.app, start: f.start })),
            hint: "Try increasing the hours parameter or specify a day.",
          });
        }
        return JSON.stringify({
          task: `${frame.app} — ${frame.start} to ${frame.end} (${frame.durationMin} min)`,
          frame,
          note: "Step-by-step click resolution is in development. Use get_activity for full frame details.",
        });
      });
      return result !== null ? textResult(result) : noDbResult();
    }
  );

  // Tool: get_patterns — detect repetitive workflows (stub)
  registerTool(
    "get_patterns",
    {
      description:
        "Detect repetitive activity patterns over the past N days. Returns repeated clicks, " +
        "URL patterns, and action sequences that might be automatable.",
      inputSchema: {
        days: z.number().optional().describe("Number of days to analyze (default: 7)"),
      },
    },
    async (args) => {
      const days = Number(args.days ?? 7);
      const result = withDb((db) => {
        // Phase 3: implement full pattern detection.
        // For now, summarize app usage over the window.
        const [start, end] = hoursAgoWindowUtc(days * 24);
        const apps = appLedger(db, start, end);
        return JSON.stringify({
          days,
          note: "Full pattern detection is in development. Showing app usage summary.",
          topApps: apps.slice(0, 10),
        });
      });
      return result !== null ? textResult(result) : noDbResult();
    }
  );

  // Tool: get_communications — detect email/messaging surfaces (stub)
  registerTool(
    "get_communications",
    {
      description:
        "Detect communication surfaces (email, messaging, notifications) from recent activity. " +
        "Useful for 'who did I communicate with?' queries.",
      inputSchema: {
        hours: z.number().optional().describe("Hours to search (default: 24)"),
        kind: z
          .enum(["email", "messaging", "messages", "notifications"])
          .optional()
          .describe("Filter by communication type"),
      },
    },
    async (args) => {
      const hours = Number(args.hours ?? 24);
      const result = withDb((db) => {
        // Phase 3: implement full communication detection.
        // For now, find frames from known communication apps.
        const doc = buildRecent(db, hours, { minMinutes: 0.1 });
        const commKinds: Record<string, string> = {
          mail: "email",
          gmail: "email",
          outlook: "email",
          slack: "messaging",
          discord: "messaging",
          telegram: "messaging",
          whatsapp: "messaging",
          messages: "messaging",
          teams: "messaging",
        };
        const comms = doc.frames
          .filter((f) => {
            const appLower = f.app.toLowerCase();
            const siteLower = (f.site ?? "").toLowerCase();
            return Object.keys(commKinds).some((k) => appLower.includes(k) || siteLower.includes(k));
          })
          .map((f) => ({
            app: f.app,
            site: f.site,
            start: f.start,
            duration: f.durationMin,
            kind:
              commKinds[
                Object.keys(commKinds).find(
                  (k) => f.app.toLowerCase().includes(k) || (f.site ?? "").toLowerCase().includes(k)
                ) ?? ""
              ] ?? "unknown",
          }));
        return JSON.stringify(
          {
            hours,
            note: "Full communication surface detection is in development.",
            communications: comms,
          },
          null,
          2
        );
      });
      return result !== null ? textResult(result) : noDbResult();
    }
  );

  // ── Multi-source behavioral tools (always available, no DB needed) ────────

  // Tool: get_context (multi-source) — unified behavioral context block
  // Overrides the screen-capture-only version when projectRoot is available.
  if (projectRoot) {
    registerTool(
      "get_context",
      {
        description:
          "Get a multi-source behavioral context block summarizing the user's work patterns. " +
          "Combines session history, git activity, shell commands, and file access into a compact summary. " +
          "Does NOT require screen capture — works cross-platform from DeepOrca's own activity logs.",
        inputSchema: {
          source: z
            .enum(["multi", "screen", "auto"])
            .optional()
            .describe(
              "Data source: 'multi' = session/git/shell/file (default), 'screen' = screen capture only, 'auto' = both merged"
            ),
        },
      },
      async (args) => {
        const source = String(args.source ?? "multi");
        if (source === "screen") {
          const hours = 2;
          const result = withDb((db) => {
            const doc = buildRecent(db, hours, { minMinutes: 0.5 });
            return formatScreenContextBlock(doc, hours);
          });
          return result !== null ? textResult(result) : noDbResult();
        }
        // Multi-source or auto.
        const profile = collectProfile(projectRoot);
        let block = formatContextBlock(profile);
        // If auto and screen DB exists, append screen data.
        if (source === "auto") {
          const screenBlock = withDb((db) => {
            const doc = buildRecent(db, 2, { minMinutes: 0.5 });
            return formatScreenContextBlock(doc, 2);
          });
          if (screenBlock) {
            block += "\n\n" + screenBlock;
          }
        }
        return textResult(block);
      }
    );
  } else {
    // No projectRoot — register screen-only get_context as fallback.
    registerTool(
      "get_context",
      {
        description:
          "Get a compact plaintext summary of recent screen activity. " + "Requires the nocta-recorder capture DB.",
        inputSchema: {
          hours: z.number().optional().describe("Hours of activity to include (default: 2)"),
        },
      },
      async (args) => {
        const hours = Number(args.hours ?? 2);
        const result = withDb((db) => {
          const doc = buildRecent(db, hours, { minMinutes: 0.5 });
          return formatScreenContextBlock(doc, hours);
        });
        return result !== null ? textResult(result) : noDbResult();
      }
    );
  }

  // Tool: get_hotspots — file/command/search hotspots from all sources
  registerTool(
    "get_hotspots",
    {
      description:
        "Get behavioral hotspots: most-edited files (from sessions + git), most-used tools, " +
        "and most-run commands. Helps the agent anticipate what the user will work on next.",
      inputSchema: {
        source: z
          .enum(["session", "git", "shell", "file", "all"])
          .optional()
          .describe("Which source to query (default: all)"),
      },
    },
    async (args) => {
      const source = String(args.source ?? "all");
      const result: Record<string, unknown> = {};

      if ((source === "session" || source === "all") && projectRoot) {
        const sp = collectSessionProfile(projectRoot);
        result.session = {
          topTools: sp.topTools.slice(0, 10),
          fileHotspots: sp.fileHotspots.slice(0, 10),
          commonFirstActions: sp.commonFirstActions,
        };
      }
      if (source === "git" || source === "all") {
        const gp = collectGitProfile(projectRoot ?? process.cwd());
        result.git = {
          fileHotspots: gp.fileHotspots.slice(0, 10),
          topMessagePatterns: gp.topMessagePatterns,
        };
      }
      if (source === "shell" || source === "all") {
        const shp = collectShellProfile();
        result.shell = {
          topCommands: shp.topCommands.slice(0, 15),
          commandBigrams: shp.commandBigrams,
        };
      }
      if (source === "file" || source === "all") {
        const fp = collectFileProfile(projectRoot ?? process.cwd());
        result.file = {
          recentFiles: fp.recentFiles.slice(0, 15),
          dirHotspots: fp.dirHotspots.slice(0, 10),
          languages: fp.languages,
        };
      }

      return textResult(JSON.stringify(result, null, 2));
    }
  );

  // Tool: get_workflows — detected repetitive workflow patterns
  registerTool(
    "get_workflows",
    {
      description:
        "Detect repetitive workflow patterns across sessions and shell history. " +
        "Returns tool-call sequences (e.g. 'read → edit → bash') and command bigrams " +
        "(e.g. 'npm test → git commit') that recur frequently. Useful for automating routines.",
      inputSchema: {},
    },
    async () => {
      const result: Record<string, unknown> = {};

      if (projectRoot) {
        const sp = collectSessionProfile(projectRoot);
        result.sessionWorkflows = sp.workflowPatterns;
        result.commonFirstActions = sp.commonFirstActions;
      }

      const shp = collectShellProfile();
      result.shellPatterns = shp.commandBigrams;

      if (projectRoot) {
        const gp = collectGitProfile(projectRoot);
        result.gitActivity = {
          totalCommits: gp.totalCommits,
          peakHours: Object.entries(gp.activity.hourlyCommits)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([h, c]) => `${h}:00 (${c} commits)`),
        };
      }

      return textResult(JSON.stringify(result, null, 2));
    }
  );

  // Tool: get_profile — full multi-source behavioral profile (JSON)
  registerTool(
    "get_profile",
    {
      description:
        "Get the full multi-source behavioral profile as JSON. Combines session history, " +
        "git activity, shell commands, and file access patterns into one comprehensive document. " +
        "Use this for deep behavioral analysis.",
      inputSchema: {},
    },
    async () => {
      if (!projectRoot) {
        return textResult("Project root not set. Behavioral profile unavailable.");
      }
      const profile = collectProfile(projectRoot);
      return textResult(formatProfileJson(profile));
    }
  );

  return server;
}

// ── Context block formatter ──────────────────────────────────────────────────

import type { ActivityDocument } from "./types";

/**
 * Format an ActivityDocument as a compact plaintext context block.
 */
function formatScreenContextBlock(doc: ActivityDocument, hours: number): string {
  if (doc.frames.length === 0) {
    return `No activity recorded in the last ${hours} hour(s).`;
  }

  const lines: string[] = [];
  lines.push(`Activity — last ${hours}h (${doc.coverage.coveragePct}% coverage, ${doc.frames.length} frames):`);

  for (const f of doc.frames) {
    const site = f.site ? ` [${f.site}]` : "";
    const pages =
      f.pages.length > 0
        ? ` — ${f.pages
            .slice(0, 3)
            .map((p) => `${p.kind}: ${p.entity}`)
            .join(", ")}`
        : "";
    const input = f.input ? ` {${f.input.clicks} clicks, ${f.input.keystrokes} keys}` : "";
    lines.push(`  ${f.start}-${f.end} (${f.durationMin}m) ${f.app}${site}${pages}${input}`);
  }

  return lines.join("\n");
}
