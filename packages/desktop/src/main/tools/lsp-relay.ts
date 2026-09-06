/**
 * LSP bare-frame relay (specs/editor-copilot D1, design §4.2).
 *
 * Renders the `@codemirror/lsp-client` transport contract onto main-process
 * language servers: the renderer owns the JSON-RPC protocol (initialize,
 * didOpen/didChange, publishDiagnostics…); this relay only moves frames —
 * spawn from the shared spec table, `Content-Length` framing via frames.ts,
 * stdin/stdout piped verbatim onto the LspMessage event. It deliberately
 * does NOT reuse lsp-bridge's LspClient: that class owns the protocol
 * (initialize handshake, private diagnostics map) and would collide with
 * the renderer-side client (double initialize, id races, swallowed
 * diagnostics — design §4.2 差距分析).
 *
 * Lifecycle (independent from the bridge's "never resident" budget pool):
 * sessions attach per (root, languageId) and idle-recycle after
 * LSP_RELAY_IDLE_MS without traffic; detach / app quit kills the tree
 * (process group on POSIX, taskkill /T /F on Windows).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve as resolvePath, sep } from "node:path";

import { candidatesForSpec, LSP_SERVER_SPECS, type LspSpawnCandidate } from "./lsp-bridge/server-specs";
import { createFrameParser, encodeFrame } from "./lsp-bridge/frames";
import { killLspTree, sanitizedLspEnv } from "./lsp-process";
import { lspPathToUri } from "../../shared/lsp-uri";

export type RelaySession = {
  sessionId: string;
  root: string;
  languageId: string;
};

type Session = RelaySession & {
  proc: ChildProcess | null;
  parser: { push(chunk: string): void };
  lastActiveAt: number;
};

const RELAY_IDLE_MS = 120_000;
const RELAY_SWEEP_MS = 30_000;
/** Cap on concurrent sessions (per main process) — a semi-trusted renderer
 *  must not spawn unbounded server trees / npx downloads across roots. */
const RELAY_MAX_SESSIONS = 8;

/**
 * JSON-RPC methods the renderer-side @codemirror/lsp-client is allowed to
 * send (H1). Everything else — workspace/executeCommand, workspace/
 * didChangeConfiguration, raw $/… extensions — is rejected at the relay so
 * a compromised renderer cannot drive the server beyond the protocol the
 * client owns. Mirrors the outbound set of @codemirror/lsp-client.
 */
const RELAY_ALLOWED_METHODS = new Set([
  "$/cancelRequest",
  "initialize",
  "initialized",
  "textDocument/didOpen",
  "textDocument/didChange",
  "textDocument/didClose",
  "textDocument/completion",
  "textDocument/hover",
  "textDocument/signatureHelp",
  "textDocument/definition",
  "textDocument/declaration",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/rename",
  "textDocument/formatting",
]);

/**
 * Root-pinning mirror of knowledge-ipc's resolveRegisteredRoot discipline:
 * only absolute paths inside the relay root are ever handed to a server.
 * Hardened (M6): after the lexical check, PHYSICAL containment is verified
 * with realpath (mirrors main/safe-path.ts steps 2–4) — a symlink/junction
 * inside the root that points outside must not let a server read beyond it.
 */
function withinRoot(root: string, filePath: string): string | null {
  if (!isAbsolute(filePath)) return null;
  const resolved = resolvePath(filePath);
  const base = resolvePath(root);
  if (resolved === base || !resolved.startsWith(base + sep)) return null;
  return containedResolved(base, resolved);
}

/** Lexical + realpath containment of an already-absolute path against the
 *  resolved root (shared by withinRoot and the URI frame walker). */
function containedResolved(rootPath: string, resolved: string): string | null {
  let realBase: string;
  try {
    realBase = realpathSync(rootPath);
  } catch {
    return null;
  }
  try {
    const realTarget = realpathSync(resolved);
    if (realTarget === realBase || realTarget.startsWith(realBase + sep)) return resolved;
    return null;
  } catch {
    // Target does not exist yet — verify the deepest existing ancestor stays
    // inside the root; the non-existent suffix is under our control.
  }
  let probe = resolved;
  while (probe !== realBase && !existsSync(probe)) probe = dirname(probe);
  try {
    const realAncestor = realpathSync(probe);
    if (realAncestor !== realBase && !realAncestor.startsWith(realBase + sep)) return null;
  } catch {
    return null;
  }
  return resolved;
}

/** LSP file URI → local path (three-slash drive letters / UNC host form). */
function fileUriToPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    if (url.host) {
      // file://host/share/x → \\host\share\x (UNC)
      return `\\\\${url.host}${decodeURIComponent(url.pathname).replace(/\//g, "\\")}`;
    }
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function specForLanguageId(languageId: string) {
  const id = languageId.toLowerCase();
  return (
    LSP_SERVER_SPECS.find((spec) => spec.id === id) ??
    LSP_SERVER_SPECS.find((spec) =>
      spec.id === "typescript" ? ["typescript", "javascript", "typescriptreact", "javascriptreact"].includes(id) : false
    ) ??
    null
  );
}

/** POSIX: lead a new process group so teardown kills the whole tree. */
function launchCandidate(candidate: LspSpawnCandidate, root: string): ChildProcess {
  return candidate.launch({
    cwd: root,
    env: sanitizedLspEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

function killTree(proc: ChildProcess | null): void {
  killLspTree(proc);
}

export class LspRelay {
  private readonly sessions = new Map<string, Session>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly emit: (channel: "lsp-message", payload: { sessionId: string; frame: string }) => void) {
    process.on("exit", () => this.shutdown());
  }

  /** Attach (or reuse) a session for (root, languageId). Frames flow both
   *  ways; every server → client frame is emitted as an LspMessage event.
   *
   *  `allowNpxFallback` (settings gate, security audit): the pinned `npx -y`
   *  fallback downloads and executes npm code at RUNTIME — it bypasses the
   *  lockfile discipline every other dependency follows. Default true (the
   *  editor ships ts/py LSP through it); setting `lspRelayNpxFallback:false`
   *  restricts launches to servers already on PATH. */
  attach(root: string, languageId: string, opts?: { allowNpxFallback?: boolean }): RelaySession | { error: string } {
    const spec = specForLanguageId(languageId);
    if (!spec) return { error: `no language server spec for "${languageId}"` };
    for (const session of this.sessions.values()) {
      if (session.root === root && session.languageId === spec.id) {
        session.lastActiveAt = Date.now();
        return { sessionId: session.sessionId, root: session.root, languageId: session.languageId };
      }
    }
    if (this.sessions.size >= RELAY_MAX_SESSIONS) {
      return { error: `too many active LSP sessions (${RELAY_MAX_SESSIONS}) — detach idle ones first` };
    }

    const sessionId = `lsp-${spec.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const session: Session = {
      sessionId,
      root,
      languageId: spec.id,
      proc: null,
      parser: createFrameParser((body) => {
        this.emit("lsp-message", { sessionId, frame: body });
      }),
      lastActiveAt: Date.now(),
    };

    const allCandidates = candidatesForSpec(spec);
    const candidates =
      opts?.allowNpxFallback === false ? allCandidates.slice(0, spec.pathCandidates.length) : allCandidates;
    for (const candidate of candidates) {
      let proc: ChildProcess | null = null;
      try {
        proc = launchCandidate(candidate, root);
        if (!proc.stdout || !proc.stdin) {
          // Audit 8.1: a spawned-but-unusable process must not be abandoned
          // (the sessions map — and thus the sweeper — never sees it).
          killTree(proc);
          proc = null;
          continue;
        }
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", (chunk: string) => session.parser.push(chunk));
        proc.stderr?.setEncoding("utf8");
        proc.stderr?.on("data", () => {
          /* server stderr is noise; keep the channel but drop content */
        });
        // Audit 6.1: a broken pipe (server crash / external kill) must not
        // surface as an uncaught stream error in the main process — the
        // session detaches instead.
        proc.stdin.on("error", () => this.detach(sessionId));
        proc.on("exit", () => {
          const current = this.sessions.get(sessionId);
          if (current === session) this.sessions.delete(sessionId);
        });
        session.proc = proc;
        break;
      } catch {
        // Audit 8.1: the catch may fire AFTER a successful spawn (listener
        // wiring) — kill the half-attached process before the next candidate
        // so it cannot outlive every recovery path.
        killTree(proc);
        proc = null;
      }
    }
    if (!session.proc) {
      return {
        error: `failed to launch ${spec.id} server (tried ${candidatesForSpec(spec).length} candidates; ${spec.installHint})`,
      };
    }

    this.sessions.set(sessionId, session);
    this.ensureSweeper();
    return { sessionId, root, languageId: spec.id };
  }

  /** Renderer → server: write one frame body (already JSON text).
   *
   *  Audit 4.2 root fix: every `uri`-shaped string inside the frame must
   *  resolve INSIDE the session's root — a semi-trusted renderer otherwise
   *  reaches arbitrary paths through definition/references/workspace-symbol
   *  and reads them back via the response frames, bypassing the
   *  "unregistered root is never enumerated" invariant.
   *
   *  H1: the frame is also validated STRUCTURALLY — only the methods the
   *  renderer-side client owns are forwarded, and an `initialize` frame is
   *  rewritten so rootUri/rootPath/workspaceFolders come from the PINNED
   *  session root (renderer-supplied initializationOptions — tsserver.path,
   *  clangd.arguments, java.home … — are dropped). */
  send(sessionId: string, frame: string): { ok: true } | { ok: false; error: string } {
    const session = this.sessions.get(sessionId);
    if (!session?.proc?.stdin || session.proc.exitCode !== null) {
      return { ok: false, error: `unknown or closed session ${sessionId}` };
    }
    let outFrame = frame;
    try {
      const parsed = JSON.parse(frame) as { method?: unknown; params?: Record<string, unknown> } | null;
      if (parsed && typeof parsed === "object") {
        const method = parsed.method;
        if (typeof method !== "string" || !RELAY_ALLOWED_METHODS.has(method)) {
          return { ok: false, error: `method not allowed: ${String(method)}` };
        }
        if (method === "initialize") {
          const rootUri = relayPathToUri(session.root);
          outFrame = JSON.stringify({
            ...parsed,
            params: {
              ...(parsed.params ?? {}),
              rootUri,
              rootPath: session.root,
              workspaceFolders: [{ uri: rootUri, name: basename(session.root) || session.root }],
              initializationOptions: undefined, // drop semi-trusted server config
            },
          });
        }
      }
    } catch {
      // Fail-closed (audit): a frame we cannot parse cannot be checked
      // against the method whitelist or the URI containment — forwarding
      // the raw bytes would silently skip BOTH defenses. Reject instead.
      return { ok: false, error: "malformed frame rejected by relay" };
    }
    const violation = firstUriOutsideRoot(outFrame, session.root);
    if (violation) {
      return { ok: false, error: `frame uri escapes session root: ${violation}` };
    }
    session.lastActiveAt = Date.now();
    // Audit 6.1: write errors (EPIPE while the server dies) detach the
    // session instead of crashing the main process via an unhandled
    // stream 'error' event.
    session.proc.stdin.write(encodeFrame(outFrame), (err) => {
      if (err) this.detach(sessionId);
    });
    return { ok: true };
  }

  detach(sessionId: string): { ok: true } | { ok: false; error: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, error: `unknown session ${sessionId}` };
    this.sessions.delete(sessionId);
    killTree(session.proc);
    return { ok: true };
  }

  shutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const session of this.sessions.values()) killTree(session.proc);
    this.sessions.clear();
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (now - session.lastActiveAt > RELAY_IDLE_MS) {
          this.sessions.delete(id);
          killTree(session.proc);
        }
      }
      if (this.sessions.size === 0 && this.sweeper) {
        clearInterval(this.sweeper);
        this.sweeper = null;
      }
    }, RELAY_SWEEP_MS);
    this.sweeper.unref?.();
  }
}

/** Resolve which file URIs a session may touch — exported for the IPC layer
 *  to pre-validate didOpen payloads under the root-pinning invariant. */
export function relayPathWithinRoot(root: string, filePath: string): string | null {
  return withinRoot(root, filePath);
}

/** Walk a JSON-RPC frame for `uri` string members; return the first one
 *  that resolves outside `root` (audit 4.2), or null when all are inside. */
function firstUriOutsideRoot(frameText: string, root: string): string | null {
  let frame: unknown;
  try {
    frame = JSON.parse(frameText);
  } catch {
    return null; // malformed frames die at the server anyway
  }
  const rootPath = resolvePath(root);
  const offenders: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 16 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && (key === "uri" || key === "rootUri") && value.startsWith("file:")) {
        // M9: parse via URL so file://host/share (UNC) and file:///C:/… map
        // onto the same path space the root guard compares — the old regex
        // strip turned UNC URIs into relative-looking paths that could never
        // match a UNC root (silent total LSP outage on \\server\share
        // workspaces).
        const filePath = fileUriToPath(value);
        if (filePath === null || !containedResolved(rootPath, resolvePath(filePath))) {
          offenders.push(value);
        }
        continue;
      }
      visit(value, depth + 1);
    }
  };
  visit(frame, 0);
  return offenders[0] ?? null;
}

/** Path → LSP file URI — delegates to the canonical shared implementation
 *  (2026-09-06 convergence; kept exported for existing tests/callers). */
export function relayPathToUri(abs: string): string {
  return lspPathToUri(abs);
}

/** Discover whether a language server binary plausibly exists for a language
 *  (used by the settings gate's availability hint). */
export function relayServerAvailable(languageId: string): boolean {
  const spec = specForLanguageId(languageId);
  if (!spec) return false;
  return candidatesForSpec(spec).some((c) => {
    const bin = c.command;
    const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
    if (process.platform === "win32") {
      return dirs.some((d) => existsSync(join(d, `${bin}.cmd`)) || existsSync(join(d, `${bin}.exe`)));
    }
    return dirs.some((d) => existsSync(join(d, bin)));
  });
}
