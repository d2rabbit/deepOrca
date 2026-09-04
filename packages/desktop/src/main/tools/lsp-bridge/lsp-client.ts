/**
 * Minimal stdio LSP client (specs/lsp-diagnostics P0-2/P0-3): spawn-on-demand
 * language server, initialize handshake, didOpen, collect publishDiagnostics,
 * idle recycle via killProcessTree-style teardown. Deliberately NOT resident —
 * the memory discipline (design §2.4) forbids keeping tsserver alive.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createFrameParser, encodeFrame } from "./frames";
import { TYPESCRIPT_LANGUAGE_SERVER_PIN, type LspServerKind } from "./routing";

export type LspDiagnostic = {
  severity: number;
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

const REQUEST_TIMEOUT_MS = 8000;

export class LspClient {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private diagnostics = new Map<string, LspDiagnostic[]>();
  private writeQueue: string[] = [];

  private constructor(
    public readonly kind: LspServerKind,
    private readonly root: string,
    private readonly onExit: (client: LspClient) => void
  ) {
    // Minimal env for the language server — no credentials, no app secrets
    // (design §2.7: the LS is untrusted computation).
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
    this.child = spawn("npx", ["-y", TYPESCRIPT_LANGUAGE_SERVER_PIN, "--stdio"], {
      cwd: root,
      env,
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parser = createFrameParser((body) => this.handleMessage(body));
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => {
      for (const message of parser.push(chunk)) void message;
    });
    this.child.stderr?.on("data", () => {});
    this.child.on("exit", () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("language server exited"));
      }
      this.pending.clear();
      this.onExit(this);
    });
  }

  static spawn(kind: LspServerKind, root: string, onExit: (client: LspClient) => void): LspClient {
    return new LspClient(kind, root, onExit);
  }

  private write(message: object | string): void {
    const frame = encodeFrame(message);
    this.writeQueue.push(frame);
    // The child's stdin drains fast; queue only guards backpressure.
    while (this.writeQueue.length > 0) {
      const next = this.writeQueue.shift();
      if (next !== undefined && this.child.stdin?.writable) {
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

  async initialize(): Promise<void> {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: `file://${this.root.replace(/\\/g, "/")}`,
      capabilities: {},
      initializationOptions: {},
    });
    this.notify("initialized", {});
  }

  async openAndWaitDiagnostics(
    uri: string,
    languageId: string,
    text: string,
    waitMs: number
  ): Promise<LspDiagnostic[]> {
    const generation = this.diagnostics.get(uri);
    void generation;
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

  /** Teardown: Windows kills the whole tree; POSIX kills the process group. */
  kill(): void {
    const pid = this.child.pid;
    if (!pid) return;
    if (process.platform === "win32") {
      // Mirror of core/common/process-tree.ts (taskkill /T /F) — the bridge
      // bundle is standalone CJS and must not import core.
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { shell: false, stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        this.child.kill("SIGKILL");
      }
    }
  }
}
