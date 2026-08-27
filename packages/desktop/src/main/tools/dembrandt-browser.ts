/**
 * dembrandt browser provider — serves the design-token extraction engine from
 * the Electron-built-in Chromium instead of any download (user decision
 * 2026-08-17: "使用内置的Chromium").
 *
 * How it works: Electron's own Chromium is the renderer of a hidden, offscreen
 * BrowserWindow started with remote debugging enabled; playwright-core's
 * `chromium.connectOverCDP()` drives it over the DevTools websocket. All
 * dembrandt surfaces (CLI, MCP server, PDF renderer) are patched at vendor
 * time to take a CDP endpoint from DEMBRANDT_CDP_ENDPOINT before falling back
 * to a plain launch — so the MCP server and PDF path, which upstream never
 * gave CDP support, work the same way.
 *
 * Lifecycle: lazily started on first request and kept alive for the app run —
 * browser startup is seconds and extractions may repeat within a design
 * session. It is closed on quit. A listener-side guard rejects connecting
 * when the endpoint is not loopback.
 */

import { BrowserWindow, app } from "electron";
import { get as httpGet } from "node:http";

/** Loopback port for the provider. Fixed by design: the window is app-owned,
 * and a collision is surfaced with a clear error rather than hunted. */
const DEMBRANDT_CDP_PORT = 9333;

let providerWindow: BrowserWindow | null = null;
let providerUrl: string | null = null;
let providerStarting: Promise<string> | null = null;
let switchPrimed = false;

/**
 * Append the remote-debugging switch BEFORE app ready — Chromium only honors
 * command-line switches at process startup, so appending after ready silently
 * never starts the CDP server and the readiness probe times out (F4 smoke
 * finding, 2026-08-18). Idempotent and side-effect free apart from the flag;
 * the BrowserWindow itself is created later by ensureDembrandtBrowserProvider
 * (BrowserWindow creation requires app ready).
 */
export function primeDembrandtCommandLine(): void {
  if (switchPrimed) return;
  switchPrimed = true;
  app.commandLine.appendSwitch("remote-debugging-port", String(DEMBRANDT_CDP_PORT));
}

/** Probe the CDP http endpoint until Chromium reports /json/version.
 *  12s deadline: cold machines can take >8s to spin up the offscreen window +
 *  debug server; the previous 8s cut real startups short (incident log
 *  2026-08-27 alongside the port-collision fix upstream of this module). */
function waitForCdpReady(endpoint: string, deadlineMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + deadlineMs;
    const probe = (): void => {
      if (Date.now() > deadline) {
        reject(new Error("dembrandt browser provider did not become ready in time"));
        return;
      }
      const req = httpGet(`${endpoint}/json/version`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
          return;
        }
        res.resume();
        setTimeout(probe, 200);
      });
      req.on("error", () => setTimeout(probe, 200));
      req.setTimeout(1500, () => req.destroy());
    };
    probe();
  });
}

/**
 * Start (or return) the CDP endpoint of the hidden Electron-Chromium provider.
 * Throws with an actionable message when Electron's Chromium refuses remote
 * debugging (e.g. a sandboxed enterprise policy) — callers surface it, they
 * never fall back to a network download.
 */
export async function ensureDembrandtBrowserProvider(): Promise<string> {
  if (providerUrl && providerWindow && !providerWindow.isDestroyed()) {
    return providerUrl;
  }
  if (providerStarting) {
    return providerStarting;
  }
  providerStarting = (async (): Promise<string> => {
    // The switch itself must have been primed at boot (see
    // primeDembrandtCommandLine); this call is a no-op by then and only covers
    // standalone/test invocations that skipped the boot-time prime.
    primeDembrandtCommandLine();
    const win = new BrowserWindow({
      show: false,
      width: 1366,
      height: 900,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    providerWindow = win;
    win.on("closed", () => {
      providerWindow = null;
      providerUrl = null;
    });
    // A real (but trivial) page keeps the renderer alive; about:blank also works,
    // but data: URLs keep remote-debugging-server startup deterministic in CI.
    await win.loadURL("about:blank");
    const endpoint = `http://127.0.0.1:${DEMBRANDT_CDP_PORT}`;
    await waitForCdpReady(endpoint, 12000);
    providerUrl = endpoint;
    app.on("will-quit", () => {
      try {
        providerWindow?.destroy();
      } catch {
        // best effort
      }
      providerWindow = null;
      providerUrl = null;
    });
    return endpoint;
  })();
  try {
    return await providerStarting;
  } finally {
    providerStarting = null;
  }
}

/**
 * Synchronous read of the live CDP endpoint, or null when the provider window
 * is not up. Core's dembrandt spawn spec calls this through
 * configureDembrandtCdpEndpointGetter at config-build time (synchronous), so
 * the endpoint is only present once ensureDembrandtBrowserProvider() has
 * resolved at least once. The provider itself is started lazily — see boot.
 */
export function getDembrandtCdpEndpoint(): string | null {
  return providerUrl && providerWindow && !providerWindow.isDestroyed() ? providerUrl : null;
}

/** Tear down the provider (tests and graceful shutdown paths). */
export async function closeDembrandtBrowserProvider(): Promise<void> {
  const win = providerWindow;
  providerWindow = null;
  providerUrl = null;
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
}
