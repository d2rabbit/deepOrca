/**
 * Desktop implementation of the LspBridgeController seam (specs/lsp-diagnostics
 * P0-5): spawns the bundled `lsp-bridge-server.cjs` via Electron-as-Node for a
 * trusted root — and ONLY when the user enabled `lspDiagnostics` in settings
 * (default off; fail-open to Serena-only otherwise). The language server itself
 * runs under a sanitized env inside the bridge (see lsp-client.ts).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCurrentSettings,
  resolveLspDiagnosticsSettings,
  type LspBridgeController,
  type McpServerConfig,
} from "@deeporca/core";

type Options = {
  /** Bundled bridge entry — `dist/lsp-bridge-server.cjs` next to main.js. */
  serverEntry: string;
};

export class BundledLspBridgeController implements LspBridgeController {
  constructor(private readonly opts: Options) {}

  isAvailable(): boolean {
    return existsSync(this.opts.serverEntry);
  }

  buildMcpServerConfig(root: string): McpServerConfig | null {
    if (!this.isAvailable()) return null;
    // Enabled gate lives HERE (not core) so a settings flip takes effect on
    // the next settings reload without a core change.
    const lsp = resolveLspDiagnosticsSettings(resolveCurrentSettings(root));
    if (!lsp.enabled) return null;
    return {
      command: process.execPath,
      args: [this.opts.serverEntry, root],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_NO_ATTACH_CONSOLE: "1",
        LSP_MAX_DIAGNOSTICS: String(lsp.maxDiagnostics),
        LSP_IDLE_TIMEOUT_MS: String(lsp.idleTimeoutMs),
        LSP_REQUEST_BUDGET: String(lsp.perTurnMaxRequests),
      },
    };
  }
}

/** The default entry path relative to the compiled main bundle. */
export function defaultServerEntry(mainDirname: string): string {
  return join(mainDirname, "lsp-bridge-server.cjs");
}
