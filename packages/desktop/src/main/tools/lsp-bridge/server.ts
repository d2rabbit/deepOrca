/**
 * LSP diagnostics bridge — stdio MCP server (specs/lsp-diagnostics P0-2/P0-3).
 *
 * Spawned by the Electron main process (one per trusted, opted-in root) via
 * the LspBridgeController seam. Speaks newline-delimited MCP JSON-RPC on
 * stdin/stdout; on `get_diagnostics` it lazily spawns the pinned language
 * server, opens the file, collects publishDiagnostics, caps + returns them.
 *
 * Lifecycle discipline (design §2.4): the language server is NEVER resident —
 * idle recycle (default 30s) and a per-process request budget (default 20)
 * stop memory bleed; teardown kills the whole process tree (Windows taskkill
 * /T /F, mirror of core/common/process-tree.ts — this bundle is standalone).
 *
 * Diagnostics result shape aligns with Serena's so core's
 * `extractErrorDiagnostics` consumes it unchanged (severity "1" = error).
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { LspClient, type LspDiagnostic } from "./lsp-client";
import {
  TYPESCRIPT_LANGUAGE_SERVER_PIN,
  pathToUri,
  resolveLanguageIdForFile,
  resolveServerKindForFile,
  resolveWithinRoot,
} from "./routing";

type BridgeConfig = { root: string; maxDiagnostics: number; idleTimeoutMs: number; requestBudget: number };

function readConfig(): BridgeConfig {
  const root = process.argv[2] ?? process.cwd();
  const num = (name: string, fallback: number): number => {
    const raw = process.env[name];
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    root,
    maxDiagnostics: num("LSP_MAX_DIAGNOSTICS", 10),
    idleTimeoutMs: num("LSP_IDLE_TIMEOUT_MS", 30000),
    requestBudget: num("LSP_REQUEST_BUDGET", 20),
  };
}

const config = readConfig();

/** One language server per kind, spawn-on-demand, idle-recycled. */
class ServerPool {
  private client: LspClient | null = null;
  private requestsServed = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly onLog: (line: string) => void) {}

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => {
        this.onLog(`idle recycle after ${config.idleTimeoutMs}ms`);
        this.client?.kill();
        this.client = null;
      },
      Math.max(1000, config.idleTimeoutMs)
    );
  }

  async getDiagnostics(
    filePath: string,
    waitMs = 8000
  ): Promise<{ ok: boolean; diagnostics?: LspDiagnostic[]; error?: string }> {
    if (resolveServerKindForFile(filePath) === null) {
      return { ok: true, diagnostics: [] }; // no language server for this kind — empty, not an error
    }
    if (this.requestsServed >= config.requestBudget) {
      return { ok: false, error: `request budget exhausted (${config.requestBudget})` };
    }
    const abs = resolveWithinRoot(config.root, filePath);
    if (!abs) {
      // Escaping path — degrade to empty; never enumerate outside the root.
      return { ok: true, diagnostics: [] };
    }
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (text.includes("\u0000")) {
      return { ok: true, diagnostics: [] }; // binary — skip
    }
    if (!this.client) {
      this.client = LspClient.spawn("typescript-language-server", config.root, (dead) => {
        if (this.client === dead) this.client = null;
      });
      this.onLog(`spawning ${TYPESCRIPT_LANGUAGE_SERVER_PIN}`);
      await this.client.initialize();
    }
    this.requestsServed += 1;
    this.resetIdleTimer();
    const uri = pathToUri(abs);
    const languageId = resolveLanguageIdForFile(abs);
    const diagnostics = await this.client.openAndWaitDiagnostics(uri, languageId, text, waitMs);
    this.client.close(uri);
    const capped = [...diagnostics]
      .sort((a, b) => a.severity - b.severity || a.range.start.line - b.range.start.line)
      .slice(0, config.maxDiagnostics);
    return { ok: true, diagnostics: capped };
  }

  shutdown(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.client?.kill();
    this.client = null;
  }
}

const pool = new ServerPool((line) => process.stderr.write(`[lsp-bridge] ${line}\n`));

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const TOOLS = [
  {
    name: "get_diagnostics",
    description:
      "类型级诊断：tsserver，需受信项目 + LSP 开启。Returns type-level diagnostics (tsserver) for one file inside the workspace.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string", description: "Workspace-relative or absolute file path" } },
      required: ["filePath"],
    },
  },
];

async function dispatchTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  if (name !== "get_diagnostics") {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: `unknown tool: ${name}` }) }],
    };
  }
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  const result = await pool.getDiagnostics(filePath);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

const readline = createInterface({ input: process.stdin, terminal: false });
readline.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method } = message;
  if (method === "initialize") {
    const params = message.params ?? {};
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: (params.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "lsp-bridge", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "shutdown") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "exit") {
    pool.shutdown();
    process.exit(0);
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    void dispatchTool(name, args)
      .then((result) => send({ jsonrpc: "2.0", id, result }))
      .catch((err: unknown) =>
        send({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
              },
            ],
          },
        })
      );
    return;
  }
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${String(method)}` } });
  }
});

process.on("SIGTERM", () => {
  pool.shutdown();
  process.exit(0);
});
