/**
 * Canonical LSP file-URI helpers (2026-09-06 convergence): THREE divergent
 * copies existed — lsp-bridge/routing.pathToUri (main), lsp-relay.relayPathToUri
 * (main) and the renderer's buildFileUri — with subtle UNC/encoding drift
 * between them. This module is the ONE implementation (dependency-free, no
 * node imports — both the main bundles and the browser renderer can inline
 * it, same discipline as ipc.ts).
 *
 * Shapes:
 *  - POSIX  /a/b/x.ts        → file:///a/b/x.ts
 *  - Win    C:/a/b.ts        → file:///C:/a/b.ts   (three slashes — a drive
 *                                letter must NEVER parse as a URI host)
 *  - UNC    //srv/share/x.ts → file://srv/share/x.ts (host form)
 *  - Everything the URI grammar forbids (spaces, `#`, `?`, ALL non-ASCII)
 *    percent-encoded; a LITERAL `%` (not already starting a %XX escape) is
 *    escaped so pre-escaped text survives the round-trip.
 */

export function lspPathToUri(abs: string): string {
  const normalized = abs.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("//")
    ? `file:${normalized}`
    : normalized.startsWith("/")
      ? `file://${normalized}`
      : `file:///${normalized}`;
  return encodeURI(prefixed)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F")
    .replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
}
