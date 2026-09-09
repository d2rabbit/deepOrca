/**
 * KB MCP Seam — the injection point for the built-in knowledge-base MCP
 * server. Core defines this seam; Desktop injects the concrete `buildKbServer`
 * implementation at boot (same pattern as vision-seam / a2ui-seam).
 *
 * Purpose (user ask 2026-09-09: 知识库不能是孤岛): the generated knowledge —
 * deepwiki pages and archify architecture maps — used to be reachable only
 * from the desktop dashboard and the design renderer's Query tools. This
 * server exposes them to EVERY agent session (coding agent, editor agent,
 * design agent) through the generic MCP tool surface.
 *
 * The implementation reads the local stores only — no settings gate, empty
 * results when a project has no knowledge base yet.
 */

export const KB_MCP_SERVER_NAME = "kb";

/** A server builder returns an object compatible with connectInProcessServer. */
export interface KbServerLike {
  connect(transport: unknown): Promise<void>;
}

export type KbServerBuilder = (projectRoot: string) => KbServerLike;

let builder: KbServerBuilder | null = null;

export function configureKbServerBuilder(b: KbServerBuilder | null): void {
  builder = b;
}

export function getKbServerBuilder(): KbServerBuilder | null {
  return builder;
}
