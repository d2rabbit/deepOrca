/**
 * LSP bridge routing helpers (specs/lsp-diagnostics P0-2/P1) — language →
 * server mapping lives in server-specs.ts; this module keeps the workspace
 * path/URI helpers shared by the bridge. Pure functions, unit-tested in
 * src/tests/lsp-bridge.test.ts.
 */

import { resolve } from "node:path";

/** Absolute workspace path → file:// URI (LSP wants forward slashes). */
export function pathToUri(absPath: string): string {
  const forward = absPath.replace(/\\/g, "/");
  const encoded = encodeURI(forward).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return forward.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

/** file:// URI → absolute workspace path (native separators). */
export function uriToPath(uri: string): string {
  let rest = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  if (/^\/[A-Za-z]:/.test(rest)) {
    // file:///C:/... — drop the leading slash of the drive form.
    rest = rest.slice(1);
  }
  return decodeURI(rest).replace(/\//g, "\\");
}

/** Ensure a request stays inside the trusted workspace root (IPC root-pinning
 *  invariant — an escaping path degrades to empty, never enumerated). */
export function resolveWithinRoot(root: string, filePath: string): string | null {
  const resolved = resolve(root, filePath);
  const rootWithSep = root.endsWith("\\") || root.endsWith("/") ? root : root + "\\";
  if (resolved === root) return null;
  if (!resolved.startsWith(rootWithSep) && !resolved.startsWith(root + "/")) return null;
  return resolved;
}
