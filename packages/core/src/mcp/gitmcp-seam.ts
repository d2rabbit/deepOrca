/**
 * GitMCP Seam — the injection point for GitMCP server config resolution.
 *
 * Core defines this seam; Desktop injects the concrete config builder at boot.
 * The GitMCP server implementation (server.ts, store.ts, indexer.ts, tools.ts,
 * github.ts) lives in Desktop. Core's resolve.ts helpers stay because they
 * share sqlite-runtime + app-dirs + getExtensionRoot with CodeGraph.
 *
 * augmentMcpServersWithBuiltins uses this seam to rewrite `gitmcp:{owner}/{repo}`
 * placeholder configs into concrete spawn configs.
 */

import type { McpServerConfig } from "../settings";

export type GitmcpConfigBuilder = (slug: string) => McpServerConfig | null;

let builder: GitmcpConfigBuilder | null = null;

export function configureGitmcpConfigBuilder(b: GitmcpConfigBuilder | null): void {
  builder = b;
}

export function getGitmcpConfigBuilder(): GitmcpConfigBuilder | null {
  return builder;
}
