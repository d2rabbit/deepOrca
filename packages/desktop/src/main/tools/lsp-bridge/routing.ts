/**
 * LSP bridge language routing (specs/lsp-diagnostics P0-2) — pure functions,
 * unit-tested in src/tests/lsp-bridge.test.ts. First phase: the TypeScript
 * family only; unknown extensions yield EMPTY diagnostics (ok, no error) per
 * design §2.3 — never a failure.
 */

export type LspServerKind = "typescript-language-server";

import { resolve } from "node:path";

/** Exact pin — supply-chain policy for anything that executes (AGENTS.md). */
export const TYPESCRIPT_LANGUAGE_SERVER_PIN = "typescript-language-server@6.0.0";

const TS_FAMILY = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);

export function resolveServerKindForFile(filePath: string): LspServerKind | null {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  if (TS_FAMILY.has(ext)) return "typescript-language-server";
  return null;
}

export function resolveLanguageIdForFile(filePath: string): string {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  if (ext === "tsx" || ext === "jsx") return "typescriptreact";
  return "typescript";
}

/** Absolute workspace path → file:// URI (LSP wants forward slashes). */
export function pathToUri(absPath: string): string {
  const forward = absPath.replace(/\\/g, "/");
  const encoded = encodeURI(forward).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return forward.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

/** file:// URI → absolute workspace path (inverse of pathToUri). */
export function uriToPath(uri: string): string {
  let rest = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  if (rest.startsWith("/")) {
    // file:///C:/... keeps the leading slash — strip one only for unix-style
    rest = rest.slice(1) === ":" ? rest : rest;
    if (/^\/[A-Za-z]:/.test(uri.slice("file://".length))) rest = rest.slice(1);
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
