/**
 * dembrandt browser provider — serves the design-token extraction engine from
 * the Electron-built-in Chromium instead of any download (user decision
 * 2026-08-17: "使用内置的Chromium").
 *
 * Lifecycle: lazily started on first request and kept alive for the app run —
 * browser startup is seconds and extractions may repeat within a design
 * session. The offscreen Chromium lives in an ISOLATED child process
 * (dembrandt-provider-child.ts) that owns the only remote-debugging-enabled
 * instance; it prints its random CDP endpoint on stdout. See that file for
 * why the debugging port must never be attached to the main app process.
 * Closed on quit.
 */

import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The ESM main bundle has no __dirname global (build.mjs injects only a
// `require` shim) — derive it the same way main/index.ts does.
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Child entry bundle produced by build.mjs next to main.js. */
const PROVIDER_ENTRY = join(__dirname, "dembrandt-provider.cjs");
const PROVIDER_READY_LINE = /^DEMBRANDT_CDP_READY (http:\/\/127\.0\.0\.1:\d+)$/;
const READY_TIMEOUT_MS = 15000;

let providerChild: ChildProcess | null = null;
let providerUrl: string | null = null;
let providerStarting: Promise<string> | null = null;

function isChildAlive(child: ChildProcess | null): child is ChildProcess {
  return Boolean(child && child.exitCode === null && !child.killed);
}

function shutdownProvider(): void {
  if (isChildAlive(providerChild)) {
    try {
      // Closing stdin signals the parent pipe contract first; kill covers a
      // wedged child so quit never waits on the renderer teardown.
      providerChild.stdin?.end();
      providerChild.kill();
    } catch {
      // best effort
    }
  }
  providerChild = null;
  providerUrl = null;
}

function spawnProvider(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const finish = (err: Error | null, url?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        shutdownProvider();
        reject(err);
        return;
      }
      resolve(url as string);
    };
    const timer = setTimeout(() => {
      finish(new Error("dembrandt browser provider did not become ready in time"));
    }, READY_TIMEOUT_MS);

    const child = spawn(process.execPath, [PROVIDER_ENTRY], {
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
    });
    providerChild = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (const line of buffer.split("\n")) {
        const match = line.trim().match(PROVIDER_READY_LINE);
        if (match) {
          providerUrl = match[1];
          finish(null, match[1]);
          return;
        }
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    });
    child.on("error", (error) => finish(error));
    child.on("exit", () => {
      if (!settled) {
        finish(
          new Error(
            existsSync(PROVIDER_ENTRY)
              ? "dembrandt provider exited before becoming ready"
              : `missing provider bundle: ${PROVIDER_ENTRY}`
          )
        );
      }
      if (providerChild === child) {
        providerChild = null;
        providerUrl = null;
      }
    });
  });
}

/**
 * Start (or return) the CDP endpoint of the isolated Electron-Chromium
 * provider child. Throws with an actionable message when the child cannot
 * come up — callers surface it, they never fall back to a network download.
 */
export async function ensureDembrandtBrowserProvider(): Promise<string> {
  if (providerUrl && isChildAlive(providerChild)) {
    return providerUrl;
  }
  if (providerStarting) {
    return providerStarting;
  }
  // One-shot quit hook, registered at first use so a dev checkout that never
  // touches dembrandt pays nothing (previous code accumulated one listener
  // per successful start).
  app.once("will-quit", shutdownProvider);
  providerStarting = spawnProvider();
  try {
    return await providerStarting;
  } finally {
    providerStarting = null;
  }
}

/**
 * Synchronous read of the live CDP endpoint, or null when the provider child
 * is not up. Core's dembrandt spawn spec calls this through
 * configureDembrandtCdpEndpointGetter at config-build time (synchronous), so
 * the endpoint is only present once ensureDembrandtBrowserProvider() has
 * resolved at least once. The provider itself is started lazily — see boot.
 */
export function getDembrandtCdpEndpoint(): string | null {
  return providerUrl && isChildAlive(providerChild) ? providerUrl : null;
}

/** Tear down the provider (tests and graceful shutdown paths). */
export async function closeDembrandtBrowserProvider(): Promise<void> {
  shutdownProvider();
}
