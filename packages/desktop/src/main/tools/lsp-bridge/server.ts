/**
 * LSP diagnostics bridge — stdio MCP server (specs/lsp-diagnostics P0-2/P0-3,
 * P1 language expansion).
 *
 * Spawned by the Electron main process (one per trusted, opted-in root) via
 * the LspBridgeController seam. Speaks newline-delimited MCP JSON-RPC on
 * stdin/stdout; on `get_diagnostics` it lazily spawns the language server
 * for the file's language (see server-specs.ts), opens the file, collects
 * publishDiagnostics, caps + returns them.
 *
 * Lifecycle discipline (design §2.4): language servers are NEVER resident —
 * one pool slot per language, each with its own idle recycle (default 30s)
 * and request budget (default 20); teardown kills the whole process tree
 * (Windows taskkill /T /F, mirror of core/common/process-tree.ts — this
 * bundle is standalone).
 *
 * Diagnostics severity is emitted as a STRING ("1" = error) so core's
 * `extractErrorDiagnostics` consumes the payload unchanged (Serena shape).
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { LspClient, type LspDiagnostic } from "./lsp-client";
import { pathToUri, resolveWithinRoot } from "./routing";
import { LSP_SERVER_SPECS, languageIdForFile, resolveSpecForFile } from "./server-specs";

type BridgeConfig = { root: string; maxDiagnostics: number; idleTimeoutMs: number; requestBudget: number };

/** Wire shape of a returned diagnostic — severity is a STRING ("1" = error)
 *  so core's `extractErrorDiagnostics` parses it unchanged (Serena shape). */
type WireDiagnostic = {
  severity: string;
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

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

type PoolSlot = { client: LspClient | null; idleTimer: NodeJS.Timeout | null; requestsServed: number };

/** One pool slot per language; slots are independent (a python spawn never
 *  disturbs the warm typescript server and vice versa). */
class ServerPool {
  private slots = new Map<string, PoolSlot>();
  constructor(private readonly onLog: (line: string) => void) {}

  private slot(specId: string): PoolSlot {
    let slot = this.slots.get(specId);
    if (!slot) {
      slot = { client: null, idleTimer: null, requestsServed: 0 };
      this.slots.set(specId, slot);
    }
    return slot;
  }

  private resetIdleTimer(specId: string): void {
    const slot = this.slot(specId);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(
      () => {
        this.onLog(`${specId} idle recycle after ${config.idleTimeoutMs}ms`);
        slot.client?.kill();
        slot.client = null;
      },
      Math.max(1000, config.idleTimeoutMs)
    );
  }

  async getDiagnostics(
    filePath: string,
    waitMs = 8000
  ): Promise<{ ok: boolean; diagnostics?: WireDiagnostic[]; error?: string }> {
    const spec = resolveSpecForFile(filePath);
    if (!spec) {
      return { ok: true, diagnostics: [] }; // unsupported language — empty, not an error
    }
    const slot = this.slot(spec.id);
    if (slot.requestsServed >= config.requestBudget) {
      return { ok: false, error: `request budget exhausted for ${spec.id} (${config.requestBudget})` };
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
    if (!slot.client) {
      this.onLog(`spawning language server for ${spec.id}`);
      try {
        slot.client = await LspClient.start(spec, config.root, (dead) => {
          if (slot.client === dead) slot.client = null;
        });
      } catch (err) {
        // Probe-only policy: a missing language server degrades to a soft
        // error carrying the install hint — never blocks the turn.
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    slot.requestsServed += 1;
    this.resetIdleTimer(spec.id);
    const uri = pathToUri(abs);
    const languageId = languageIdForFile(spec, abs);
    const diagnostics = await slot.client.openAndWaitDiagnostics(uri, languageId, text, waitMs);
    slot.client.close(uri);
    const capped: WireDiagnostic[] = [...diagnostics]
      .sort((a, b) => a.severity - b.severity || a.range.start.line - b.range.start.line)
      .slice(0, config.maxDiagnostics)
      .map((d: LspDiagnostic) => ({ ...d, severity: String(d.severity) }));
    return { ok: true, diagnostics: capped };
  }

  shutdown(): void {
    for (const [, slot] of this.slots) {
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      slot.client?.kill();
      slot.client = null;
    }
  }
}

const pool = new ServerPool((line) => process.stderr.write(`[lsp-bridge] ${line}\n`));

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const LANGUAGES = LSP_SERVER_SPECS.map((s) => s.id).join(", ");

const TOOLS = [
  {
    name: "get_diagnostics",
    description: `类型级诊断（真实语言服务器）。Supported languages: ${LANGUAGES}. Returns diagnostics for one file inside the workspace; unsupported languages return empty results.`,
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
        serverInfo: { name: "lsp-bridge", version: "0.2.0" },
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
