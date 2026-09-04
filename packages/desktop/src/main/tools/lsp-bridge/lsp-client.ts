/**
 * Minimal stdio LSP client (specs/lsp-diagnostics P0-2/P1): spawn-on-demand
 * language server, initialize handshake, didOpen, collect publishDiagnostics,
 * idle recycle via killProcessTree-style teardown. Deliberately NOT resident —
 * the memory discipline (design §2.4) forbids keeping language servers alive.
 * P1: spawn candidates come from the server-specs table (env override → PATH
 * probe → npm fallback); a candidate "works" iff its initialize handshake
 * completes, so a missing binary degrades to the next candidate.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createFrameParser, encodeFrame } from "./frames";
import { candidatesForSpec, type LspServerSpec, type LspSpawnCandidate } from "./server-specs";

export type LspDiagnostic = {
  severity: number;
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

const INITIALIZE_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 8000;

/** Sanitized env for the language server — no credentials, no app secrets
 *  (design §2.7: the LS is untrusted computation). */
function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "COMSPEC",
    "TEMP",
    "TMP",
    "LANG",
  ]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export class LspClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private writeQueue: string[] = [];

  private constructor(
    public readonly specId: string,
    private readonly root: string,
    private readonly onExit: (client: LspClient) => void
  ) {}

  /**
   * Try candidates in order; a candidate counts as working iff its initialize
   * handshake completes inside the timeout. Throws when none resolves — the
   * error message carries the per-spec install hint (design: probe, never
   * auto-install; the npm fallback is the only auto-fetch, via pinned npx).
   */
  static async start(spec: LspServerSpec, root: string, onExit: (client: LspClient) => void): Promise<LspClient> {
    const client = new LspClient(spec.id, root, onExit);
    const failures: string[] = [];
    for (const candidate of candidatesForSpec(spec)) {
      try {
        await client.bootCandidate(candidate);
        return client;
      } catch (err) {
        failures.push(`${candidate.command}: ${err instanceof Error ? err.message : String(err)}`);
        client.killCurrent();
      }
    }
    throw new Error(`no language server resolved for ${spec.id}; tried ${failures.join("; ")} — ${spec.installHint}`);
  }

  private attach(child: ChildProcess): void {
    this.child = child;
    const parser = createFrameParser((body) => this.handleMessage(body));
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      for (const message of parser.push(chunk)) void message;
    });
    child.stderr?.on("data", () => {});
    child.on("exit", () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("language server exited"));
      }
      this.pending.clear();
      this.onExit(this);
    });
  }

  /** Swap in a fresh child for `candidate` and run the initialize handshake. */
  private bootCandidate(candidate: LspSpawnCandidate): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error): void => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };
      let child: ChildProcess;
      try {
        // The launch thunk carries the LITERAL command + argv from the spec
        // table — no runtime input ever reaches the command line.
        child = candidate.launch({
          cwd: this.root,
          env: sanitizedEnv(),
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      child.on("error", (err) => fail(err));
      child.on("exit", () => fail(new Error(`${candidate.command} exited during initialize`)));
      this.attach(child);
      // initialize doubles as the liveness probe — a server that answers is
      // good to use; anything else falls through to the next candidate.
      this.request("initialize", {
        processId: process.pid,
        rootUri: `file://${this.root.replace(/\\/g, "/")}`,
        capabilities: {},
        initializationOptions: {},
      })
        .then(() => {
          if (settled) return;
          settled = true;
          this.notify("initialized", {});
          resolve();
        })
        .catch((err: Error) => fail(err));
      const timer = setTimeout(() => fail(new Error(`${candidate.command} initialize timeout`)), INITIALIZE_TIMEOUT_MS);
      timer.unref();
    });
  }

  private write(message: object | string): void {
    const frame = encodeFrame(message);
    this.writeQueue.push(frame);
    // The child's stdin drains fast; the queue only guards backpressure.
    while (this.writeQueue.length > 0) {
      const next = this.writeQueue.shift();
      if (next !== undefined && this.child?.stdin?.writable) {
        this.child.stdin.write(next);
      }
    }
  }

  private handleMessage(body: string): void {
    let parsed: {
      id?: number;
      method?: string;
      params?: { uri?: string; diagnostics?: LspDiagnostic[] };
      result?: unknown;
      error?: { message?: string };
    };
    try {
      parsed = JSON.parse(body);
    } catch {
      return;
    }
    if (parsed.method === "textDocument/publishDiagnostics" && parsed.params?.uri) {
      this.diagnostics.set(parsed.params.uri, parsed.params.diagnostics ?? []);
      return;
    }
    if (typeof parsed.id === "number" && this.pending.has(parsed.id)) {
      const entry = this.pending.get(parsed.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(parsed.id);
        if (parsed.error) entry.reject(new Error(parsed.error.message ?? "lsp request failed"));
        else entry.resolve(parsed.result);
      }
    }
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`lsp request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async openAndWaitDiagnostics(
    uri: string,
    languageId: string,
    text: string,
    waitMs: number
  ): Promise<LspDiagnostic[]> {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    // Push diagnostics: wait for the uri's entry to change after didOpen.
    const deadline = Date.now() + waitMs;
    let last = this.diagnostics.get(uri);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const current = this.diagnostics.get(uri);
      if (current && current !== last) return current;
      if (last === undefined && current) return current;
      last = current;
    }
    return this.diagnostics.get(uri) ?? [];
  }

  close(uri: string): void {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  private killCurrent(): void {
    const pid = this.child?.pid;
    if (!pid) return;
    if (process.platform === "win32") {
      // Mirror of core/common/process-tree.ts (taskkill /T /F) — the bridge
      // bundle is standalone CJS and must not import core.
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        this.child?.kill("SIGKILL");
      }
    }
  }

  /** Teardown: Windows kills the whole tree; POSIX kills the process group. */
  kill(): void {
    this.killCurrent();
  }
}
