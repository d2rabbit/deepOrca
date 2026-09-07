/**
 * Hash deep links for the design workspaces (mockup v2.1 demo states) —
 * pure + DOM-free so tests can import it without the renderer API bootstrap.
 * Forms: `#design` / `#design/pages|tokens|quality`,
 *       `#prototype` / `#prototype/spec|proto|report`.
 */
export type DesignWorkspaceTabKind = "prototype" | "design";

export type DesignWorkspaceTabSegment = "pages" | "tokens" | "quality" | "spec" | "proto" | "report";

export function parseDesignHash(
  hash: string
): { kind: DesignWorkspaceTabKind; tab?: DesignWorkspaceTabSegment } | null {
  const match = hash.trim().match(/^#\/?(design|prototype)(?:\/(pages|tokens|quality|spec|proto|report))?$/);
  if (!match) return null;
  return { kind: match[1] as DesignWorkspaceTabKind, tab: match[2] as DesignWorkspaceTabSegment | undefined };
}
