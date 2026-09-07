// CM6 ↔ LSP integration (specs/editor-copilot D3, design §4).
//
// The renderer owns the protocol via the official `@codemirror/lsp-client`;
// its Transport contract (send/subscribe/unsubscribe of bare JSON strings)
// is adapted onto the main-process bare-frame relay (tools/lsp-relay.ts):
//   send        → api.lspRelaySend(sessionId, frame)
//   subscribe   → api.onLspRelayMessage filtered by sessionId
// Sessions are keyed `${root}::${languageId}` (audit C-a root fix) — a
// workspace switch detaches the old root's client instead of reusing it.
// Fail-open by design: a missing server or a failed attach leaves the
// editor fully usable with Lezer syntax highlighting only.

import { LSPClient, languageServerExtensions, languageServerSupport, type Transport } from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";

import { api } from "../../api";
import type { LspRelayAttachResult } from "../../../shared/ipc";
import { lspPathToUri } from "../../../shared/lsp-uri";

import { languageIdForFile } from "./language-map";

/** A live (client, sessionId) pair for one (root, languageId). */
type Session = {
  root: string;
  client: LSPClient;
  sessionId: string;
  languageId: string;
  handlers: Set<(value: string) => void>;
  off: () => void;
};

const sessionKey = (root: string, languageId: string): string => `${root}::${languageId}`;
const sessions = new Map<string, Session>();

/**
 * Mirror of main-side lsp-relay specForLanguageId: the relay maps
 * javascript/jsx-tsx onto the typescript server spec, so renderer sessions
 * must fold onto the SAME (root, canonical) key — two LSPClients on one
 * server would double-initialize and race request ids (H3).
 */
const CANONICAL_FOLD: Record<string, string> = {
  javascript: "typescript",
  javascriptreact: "typescript",
  typescriptreact: "typescript",
};
function canonicalLanguageId(languageId: string): string {
  return CANONICAL_FOLD[languageId] ?? languageId;
}

/** In-flight attach promises — concurrent ensureSession calls for the same
 *  key share ONE attach instead of double-spawning servers (M2). */
const inflight = new Map<string, Promise<Session | null>>();

/**
 * Build a legal LSP file URI: absolutize a workspace-relative path against
 * the root, then delegate to the canonical shared encoder (2026-09-06
 * convergence — same implementation the relay and the bridge now use).
 */
export function buildFileUri(root: string, file: string): string {
  let abs = file;
  // UNC (\\server-style) and drive-letter paths are absolute; POSIX leads /.
  if (!/^[a-zA-Z]:[\\/]/.test(file) && !file.startsWith("/") && !file.startsWith("\\\\")) {
    const base = root.replace(/[\\/]+$/, "");
    abs = base ? `${base}/${file}` : `/${file}`;
  }
  return lspPathToUri(abs);
}

/** Drop every cached alias of a relay session (root fix: the relay reaps
 *  idle sessions after 120s and forgets crashed servers SILENTLY — the old
 *  cache kept `connected === true` forever because only disconnect() flips
 *  it, so every later hover/completion timed out on a dead sessionId until
 *  the workspace remounted. A rejected send (`ok:false` = relay no longer
 *  knows the session) is the reliable dead-session signal; dropping here
 *  makes the next ensureSession re-attach and self-heal.) */
function dropSessionByRelayId(sessionId: string): void {
  for (const [key, session] of [...sessions]) {
    if (session.sessionId !== sessionId) continue;
    sessions.delete(key);
    session.client.disconnect();
    session.off();
  }
}

/**
 * The relay's `send` returns ok:false for FOUR distinct causes (see
 * tools/lsp-relay.ts) and only ONE of them means the cached session is dead:
 *   - `unknown or closed session <id>` — the session was idle-reaped, the
 *     server crashed or was detached → the cache must be dropped so the next
 *     ensureSession re-attaches (self-heal);
 *   - `method not allowed: <m>` / `malformed frame rejected by relay` /
 *     `frame uri escapes session root: <uri>` — the session is ALIVE; the
 *     relay merely refused this one frame. Dropping the cache here tore down
 *     a perfectly healthy client on every refused frame (e.g. the relay's
 *     whitelist rejecting a stray method) and pinned the editor to
 *     reconnect-thrash. Exported pure for the regression tests.
 */
export function shouldDropRelaySession(relayError: string): boolean {
  return relayError.startsWith("unknown or closed session ");
}

/** Fail-quiet throttle for the refuse-but-alive causes: one console.debug per
 *  distinct error head ("method not allowed", "malformed frame rejected by
 *  relay", "frame uri escapes session root") — never per keystroke, and the
 *  set stays bounded because the head never carries the variable tail. */
const transportRejectionHeads = new Set<string>();
function debugTransportRejectionOnce(relayError: string): void {
  const head = relayError.split(":")[0] ?? relayError;
  if (transportRejectionHeads.has(head)) return;
  transportRejectionHeads.add(head);
  console.debug(`[cm6-lsp] relay refused a frame (${head}) — session kept:`, relayError);
}

/** Adapter: LSPClient transport ↔ relay IPC (sessionId-scoped, fail-quiet). */
function relayTransport(sessionId: string, handlers: Set<(value: string) => void>): Transport {
  return {
    send(message: string): void {
      // Audit 6.2: a detached session must not surface as an unhandled
      // rejection on every keystroke — swallow transport-level errors and
      // let the client observe the silence (fail-open contract). A resolved
      // `{ok:false}` is only a dead-session signal for the "unknown or
      // closed session" cause; the relay's other rejections (whitelist,
      // malformed frame, uri escape) leave the session ALIVE — dropping the
      // cache there disconnected a healthy client on every refused frame.
      void api.lspRelaySend(sessionId, message).then(
        (res) => {
          if (res.ok) return;
          if (shouldDropRelaySession(res.error)) {
            dropSessionByRelayId(sessionId);
            return;
          }
          debugTransportRejectionOnce(res.error);
        },
        () => undefined
      );
    },
    subscribe(handler: (value: string) => void): void {
      handlers.add(handler);
    },
    unsubscribe(handler: (value: string) => void): void {
      handlers.delete(handler);
    },
  };
}

/** Lazily attach (or reuse) the session for one (root, languageId). */
async function ensureSession(root: string, languageId: string): Promise<Session | null> {
  const key = sessionKey(root, canonicalLanguageId(languageId));
  const cached = sessions.get(key);
  if (cached && cached.client.connected) return cached;

  // M2: a concurrent attach for the same key is already on the wire — share
  // it instead of creating a second session (double server, leaked IPC
  // listeners). The promise resolves to a session (or null) on completion.
  const pending = inflight.get(key);
  if (pending) return pending;
  // Re-arming after the pending check keeps the old key alive while its
  // attach is in flight; the detach below only touches SETTLED sessions.
  if (cached) detachSession(key, cached);

  // C-a: a different root under the same language has its own key; an old
  // root's session for this language (if any) is detached so its server
  // cannot outlive its workspace. (Canonical id — the fold applies here too.)
  for (const [k, other] of sessions) {
    if (k !== key && k.endsWith(`::${canonicalLanguageId(languageId)}`)) detachSession(k, other);
  }

  const p = (async (): Promise<Session | null> => {
    const attach: LspRelayAttachResult = await api.lspRelayAttach(root, canonicalLanguageId(languageId));
    if (!attach.ok) {
      // Missing server / unregistered root — degrade silently (design §4.3).
      return null;
    }

    // Belt-and-braces: the relay may still canonicalize under another name
    // than our local fold — never double-connect the same server.
    const canonicalKey = sessionKey(root, attach.languageId);
    const folded = sessions.get(canonicalKey);
    if (folded && folded.client.connected) return folded;

    const handlers = new Set<(value: string) => void>();
    const off = api.onLspRelayMessage((event) => {
      if (event.sessionId !== attach.sessionId) return;
      for (const handler of handlers) handler(event.frame);
    });

    const client = new LSPClient({
      rootUri: buildFileUri(root, root),
      timeout: 8000,
      // Full capability surface: diagnostics / hover / completion / signature /
      // definition / rename / format / references (announce 帖 capability list).
      extensions: languageServerExtensions(),
    });
    client.connect(relayTransport(attach.sessionId, handlers));
    // Initialization failure resolves null capabilities — degrade open.
    await client.initializing.catch(() => null);

    const session: Session = {
      root,
      client,
      sessionId: attach.sessionId,
      languageId: canonicalKey === key ? canonicalLanguageId(languageId) : attach.languageId,
      handlers,
      off,
    };
    sessions.set(canonicalKey, session);
    // Also alias under the caller's key so a direct lookup finds it.
    if (canonicalKey !== key) sessions.set(key, session);
    return session;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

function detachSession(key: string, session: Session): void {
  sessions.delete(key);
  session.client.disconnect();
  session.off();
  void api.lspRelayDetach(session.sessionId).catch(() => undefined);
}

function detachAll(): void {
  for (const [key, session] of sessions) detachSession(key, session);
  sessions.clear();
}

/** Build the LSP extension set for one document. Returns [] when the
 *  language has no server spec or the attach failed (fail-open). */
export async function cm6LspExtensions(root: string, file: string): Promise<Extension[]> {
  const languageId = languageIdForFile(file);
  // Deliberately narrower than the main-side LSP_SERVER_SPECS (10 entries):
  // only the lightweight servers the editor relay ships by default are
  // enabled — the heavier ones (rust-analyzer, clangd, jdtls …) stay off
  // until a settings gate lands. Extend this list when a spec gets the
  // `relay: true` flag.
  const supported = ["typescript", "javascript", "python", "swift", "kotlin"];
  if (!supported.includes(languageId)) return [];
  const session = await ensureSession(root, languageId);
  if (!session) return [];
  return [languageServerSupport(session.client, buildFileUri(root, file), languageId)];
}

/** Drop every session (workspace close / unmount — audit C-a wiring). */
export function cm6LspShutdown(): void {
  detachAll();
}
