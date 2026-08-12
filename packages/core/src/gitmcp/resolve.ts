import * as fs from "fs";
import * as path from "path";
import type { McpServerConfig } from "../settings";
import { getExtensionRoot } from "../prompt";
import { resolveSqliteRuntimeForEntry } from "../common/sqlite-runtime";

/**
 * GitMCP — local documentation MCP for external GitHub repositories.
 *
 * Each registered repository gets its own MCP server entry named
 * `gitmcp:{owner}/{repo}` whose process (see `./server.ts`) is bound to that
 * single repository via argv. The repository list is *the* set of `gitmcp:`
 * prefixed entries in `settings.mcpServers` — there is no separate registry.
 *
 * Settings store a portable placeholder config (`{ command: "gitmcp", args: [slug] }`)
 * so no machine-specific absolute paths leak into settings files. At session
 * startup `SessionManager.augmentMcpServersWithBuiltins()` rewrites placeholders
 * into a real spawn config produced by {@link buildGitmcpMcpServerConfig}, which
 * resolves a sqlite-capable Node runtime the same way CodeGraph does.
 */

/** Prefix that marks an MCP server entry as a GitMCP-managed repository. */
export const GITMCP_SERVER_PREFIX = "gitmcp:";

/**
 * Portable placeholder command persisted in settings. Never executed directly:
 * it is rewritten to a concrete runtime + server entry at session startup.
 */
export const GITMCP_PLACEHOLDER_COMMAND = "gitmcp";

/** True when an MCP server name denotes a GitMCP-managed repository. */
export function isGitmcpServerName(name: string): boolean {
  return name.startsWith(GITMCP_SERVER_PREFIX);
}

/** `"owner/repo"` → `"gitmcp:owner/repo"`. */
export function gitmcpServerNameForSlug(slug: string): string {
  return `${GITMCP_SERVER_PREFIX}${slug}`;
}

/** `"gitmcp:owner/repo"` → `"owner/repo"`. */
export function gitmcpSlugFromServerName(name: string): string {
  return isGitmcpServerName(name) ? name.slice(GITMCP_SERVER_PREFIX.length) : name;
}

/** Characters GitHub allows in owner and repository names. */
const SLUG_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Normalize a user-supplied repository reference to an `"owner/repo"` slug.
 * Accepted forms:
 *   - `owner/repo`
 *   - `https://github.com/owner/repo[.git][/extra/path]` (protocol optional)
 *   - `git@github.com:owner/repo[.git]`
 * Returns `null` when the input cannot be understood as a GitHub repository.
 */
export function parseRepoSlug(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  let rest = raw;
  let fromUrl = false;
  const scp = /^git@github\.com:(.+)$/i.exec(rest);
  if (scp) {
    rest = scp[1];
    fromUrl = true;
  } else {
    const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(rest);
    if (url) {
      rest = url[1];
      fromUrl = true;
    }
  }

  const segments = rest.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }
  // URLs may carry extra path segments (`/tree/main/...`) which we ignore;
  // a bare `owner/repo` input must be exactly two segments.
  if (segments.length > 2 && !fromUrl) {
    return null;
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!owner || !repo || !SLUG_SEGMENT.test(owner) || !SLUG_SEGMENT.test(repo)) {
    return null;
  }
  return `${owner}/${repo}`;
}

/** The placeholder config written to settings when a repository is added. */
export function buildGitmcpPlaceholderConfig(slug: string): McpServerConfig {
  return { command: GITMCP_PLACEHOLDER_COMMAND, args: [slug] };
}

/** True when a settings entry still holds the portable placeholder config. */
export function isGitmcpPlaceholderConfig(config: McpServerConfig): boolean {
  return config.command === GITMCP_PLACEHOLDER_COMMAND;
}

/**
 * Locate the compiled gitmcp server entry relative to the package root:
 * `dist/gitmcp/server.js` (core tsc output — tests, desktop via node_modules)
 * or `gitmcp/server.js` (CLI esbuild bundle, where the root *is* `dist/`).
 */
export function resolveGitmcpServerEntry(): string | null {
  const root = getExtensionRoot();
  for (const rel of [path.join("dist", "gitmcp", "server.js"), path.join("gitmcp", "server.js")]) {
    const candidate = path.join(root, rel);
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Candidate missing — try the next layout.
    }
  }
  return null;
}

/**
 * Build the concrete spawn config for a repository's gitmcp server: a
 * sqlite-capable Node runtime (same three-tier resolution as CodeGraph)
 * running the compiled server entry with the slug as its only argument.
 * Returns `null` when the entry or a sqlite-capable runtime is missing —
 * callers keep the placeholder (server errors out visibly) or warn upfront.
 */
export function buildGitmcpMcpServerConfig(slug: string): McpServerConfig | null {
  const entry = resolveGitmcpServerEntry();
  if (!entry) {
    return null;
  }
  const runtime = resolveSqliteRuntimeForEntry(entry);
  if (!runtime) {
    return null;
  }
  const config: McpServerConfig = { command: runtime.command, args: [...runtime.prefixArgs, slug] };
  if (runtime.env) {
    config.env = runtime.env;
  }
  return config;
}

/**
 * Spawn config for the server entry's maintenance subcommands (`--meta`,
 * `--reindex <slug>`, `--remove-index <slug>`), for hosts that lack
 * `node:sqlite` themselves (e.g. the Electron main process). Returns `null`
 * when the entry or a sqlite-capable runtime is missing.
 */
export function buildGitmcpMaintenanceCommand(args: string[]): McpServerConfig | null {
  const entry = resolveGitmcpServerEntry();
  if (!entry) {
    return null;
  }
  const runtime = resolveSqliteRuntimeForEntry(entry);
  if (!runtime) {
    return null;
  }
  const config: McpServerConfig = { command: runtime.command, args: [...runtime.prefixArgs, ...args] };
  if (runtime.env) {
    config.env = runtime.env;
  }
  return config;
}
