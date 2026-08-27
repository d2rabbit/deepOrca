// Workspace theme resolution (design §4.1, R24).
//
// The chain's namespace is the workspace theme: same theme = same chain, no
// matter what local path each machine uses. The theme must therefore be a
// machine-independent canonical string. Current `projectCode` is derived from
// the absolute path (packages/core/src/common/app-dirs.ts) and is NOT usable —
// different machines never agree on it. Priority:
//   1. git remote (caller passes remotes in priority order: origin first),
//      normalized protocol-independently → "git:host/path"
//   2. explicit theme name (non-git workspaces or user override) → "name:slug"
//   3. directory names are LOCAL DISPLAY ONLY and never participate in
//      cross-machine matching — resolveWorkspaceTheme returns null instead.

import { createHash } from "node:crypto";
import { utf8Bytes } from "../encode/bytes.js";

export interface ResolvedTheme {
  /** Canonical theme string, e.g. "git:github.com/zshipu/deeporca". */
  theme: string;
  /** "wt:" + first 16 hex chars of SHA-256(theme). */
  themeId: string;
  source: "git-remote" | "explicit-name";
}

/**
 * Normalize a git remote URL into the canonical "git:host/path" form.
 * Accepts ssh://, git://, https://, http:// and the scp-like git@host:path
 * shorthand; strips credentials, lowercases the host, strips a trailing .git.
 * Path case is preserved (hosts are case-insensitive, repo paths are not).
 * Returns null for anything that does not resolve to host + path.
 */
export function normalizeGitRemote(url: string): string | null {
  let rest = url.trim();
  if (rest.length === 0) {
    return null;
  }
  const schemeMatch = /^(?:git\+)?(ssh|git|https?|file):\/\//i.exec(rest);
  const scheme = schemeMatch?.[1].toLowerCase();
  if (schemeMatch) {
    rest = rest.slice(schemeMatch[0].length);
  } else {
    // scp-like shorthand: git@host:path (no scheme, exactly one colon before
    // the first slash).
    const scpMatch = /^([^@/]+@[^:/]+):(?![^/]*\/\/)(.+)$/.exec(rest);
    if (scpMatch) {
      rest = scpMatch[1] + "/" + scpMatch[2];
    }
  }
  // Drop credentials (user:pass@ or user@) before the first slash.
  const at = rest.indexOf("@");
  const slash = rest.indexOf("/");
  if (at !== -1 && (slash === -1 || at < slash)) {
    rest = rest.slice(at + 1);
  }
  // Split host[:port] from path.
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }
  let host = rest.slice(0, slashIndex).toLowerCase();
  // The default ssh port is implied in the scp-like form — keep both spellings equal.
  if (scheme === "ssh" && host.endsWith(":22")) {
    host = host.slice(0, -3);
  }
  let path = rest.slice(slashIndex + 1);
  if (host.length === 0) {
    return null;
  }
  path = path.replace(/\/+$/, "");
  path = path.replace(/\.git$/i, "");
  path = path.replace(/\/+$/, "");
  if (path.length === 0 || path.includes("//")) {
    return null;
  }
  return "git:" + host + "/" + path;
}

/**
 * Normalize a user-provided theme name: lowercase, whitespace runs to single
 * hyphens, no leading/trailing hyphen, 1–64 chars (CJK allowed and untouched).
 */
export function normalizeThemeName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0 || slug.length > 64) {
    return null;
  }
  return slug;
}

export interface ResolveThemeInput {
  /** Remote URLs in priority order (origin first, then upstream, …). */
  gitRemotes?: string[];
  /** Explicit theme name; used when no remote resolves or as user override. */
  explicitName?: string;
}

export function resolveWorkspaceTheme(input: ResolveThemeInput): ResolvedTheme | null {
  for (const remote of input.gitRemotes ?? []) {
    const theme = normalizeGitRemote(remote);
    if (theme) {
      return { theme, themeId: themeIdFromTheme(theme), source: "git-remote" };
    }
  }
  if (input.explicitName !== undefined) {
    const slug = normalizeThemeName(input.explicitName);
    if (slug) {
      const theme = "name:" + slug;
      return { theme, themeId: themeIdFromTheme(theme), source: "explicit-name" };
    }
  }
  return null;
}

export function themeIdFromTheme(theme: string): string {
  const digest = createHash("sha256").update(utf8Bytes(theme)).digest();
  return "wt:" + digest.subarray(0, 8).toString("hex");
}
