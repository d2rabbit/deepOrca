/**
 * LSP bare-frame relay IPC (specs/editor-copilot D2): the renderer-side
 * @codemirror/lsp-client owns the protocol; these channels only move frames.
 * Root-pinning follows resolveRegisteredRoot — an unregistered root never
 * reaches a language server.
 *
 * Extracted from main/index.ts (file-length hard limit) — deps injected the
 * review-report-surface.ts way; the relay singleton lives here and app
 * teardown calls {@link shutdownLspRelay}.
 */

import { IpcEvent, IpcRequest } from "../../shared/ipc.js";
import { resolveRegisteredRoot } from "../knowledge-ipc.js";
import { LspRelay } from "./lsp-relay.js";

export interface LspRelayIpcDeps {
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  /** Targeted emit to the main window (LSP frames carry document content —
   * they must never reach popout windows). */
  emitToMain: (channel: string, payload?: unknown) => void;
  /** Settings gate (security audit): `lspRelayNpxFallback:false` restricts
   *  launches to PATH-installed servers — no runtime `npx -y` pulls. */
  allowNpxFallback: () => boolean;
}

let emitFrame: ((payload: { sessionId: string; frame: string }) => void) | null = null;
let lspRelay: LspRelay | null = null;

function getLspRelay(): LspRelay {
  if (!lspRelay) {
    lspRelay = new LspRelay((_channel, payload) => emitFrame?.(payload));
  }
  return lspRelay;
}

export function registerLspRelayIpc(deps: LspRelayIpcDeps): void {
  emitFrame = (payload) => deps.emitToMain(IpcEvent.LspRelayMessage, payload);
  deps.handlePrivileged(IpcRequest.LspRelayAttach, (root: string, languageId: string) => {
    const pinned = resolveRegisteredRoot(typeof root === "string" && root ? root : undefined);
    if (!pinned) return { ok: false as const, error: "unregistered workspace" };
    if (typeof languageId !== "string" || !languageId.trim()) {
      return { ok: false as const, error: "languageId is required" };
    }
    return getLspRelay().attach(pinned, languageId.trim(), { allowNpxFallback: deps.allowNpxFallback() });
  });
  deps.handlePrivileged(IpcRequest.LspRelaySend, (sessionId: string, frame: string) => {
    if (typeof sessionId !== "string" || typeof frame !== "string") {
      return { ok: false as const, error: "sessionId and frame are required" };
    }
    return getLspRelay().send(sessionId, frame);
  });
  deps.handlePrivileged(IpcRequest.LspRelayDetach, (sessionId: string) => {
    if (typeof sessionId !== "string") return { ok: false as const, error: "sessionId is required" };
    const result = getLspRelay().detach(sessionId);
    // Audit 7.1: process termination is an auditable, privileged action —
    // symmetric with spawn.
    if (result.ok) console.info("[lsp-relay] session detached:", sessionId);
    return result;
  });
}

/** App teardown (main/index.ts quit path): stop servers and the sweeper. */
export function shutdownLspRelay(): void {
  lspRelay?.shutdown();
  lspRelay = null;
  emitFrame = null;
}
