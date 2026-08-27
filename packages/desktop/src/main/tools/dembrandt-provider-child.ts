/**
 * dembrandt provider child process — the ONLY Chromium in this app that runs
 * with remote debugging enabled (2026-08-27 security refactor).
 *
 * Why a separate process: Electron's `--remote-debugging-port` switch exposes
 * a CDP server listing EVERY WebContents of its own process. Attaching it to
 * the main app meant any local user-level process could `Runtime.evaluate`
 * inside the privileged main window. Here the switch lives in an isolated
 * child whose single page is a sandboxed about:blank — worst case for an
 * attacker who finds the port is full control of nothing.
 *
 * Protocol with the parent (dembrandt-browser.ts):
 *   - spawned as  <electron-exec> dembrandt-provider.cjs
 *   - child picks --remote-debugging-port=0 (random port; no fixed-port
 *     collision) plus a private --user-data-dir so DevToolsActivePort is not
 *     contended with the main instance's userData
 *   - once /json/version answers on that port, prints exactly one line:
 *       DEMBRANDT_CDP_READY http://127.0.0.1:<port>
 *   - dies when the parent does (stdin EOF from the pipe = parent gone).
 */

import { app, BrowserWindow } from "electron";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const READY_TIMEOUT_MS = 12000;

function appendPreReadySwitches(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), "deeporca-dembrandt-cdp-"));
  // Both switches must land before app ready — Chromium parses them at
  // process startup only (the same F4 constraint the old in-process flow had,
  // now satisfied entirely inside this child).
  app.commandLine.appendSwitch("user-data-dir", userDataDir);
  app.commandLine.appendSwitch("remote-debugging-port", "0");
  return userDataDir;
}

async function waitForDevToolsActivePort(userDataDir: string): Promise<number> {
  const markerPath = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) {
      try {
        // Line 1 = the chosen port; line 2 = browser ws path (unused here).
        const port = Number.parseInt(readFileSync(markerPath, "utf8").split("\n")[0], 10);
        if (Number.isFinite(port) && port > 0) return port;
      } catch {
        // File may appear before content is flushed — retry until deadline.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chromium did not write DevToolsActivePort within ${READY_TIMEOUT_MS}ms`);
}

function watchParentLifecycle(): void {
  // Parent created us with stdio[0] piped; OS closes it if the parent dies
  // unexpectedly. Graceful shutdown goes through will-quit + kill below.
  process.stdin.on("end", () => {
    try {
      app.quit();
    } catch {
      process.exit(0);
    }
  });
  process.stdin.resume();
}

async function run(): Promise<void> {
  const userDataDir = appendPreReadySwitches();
  await app.whenReady();
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
  win.on("closed", () => app.quit());
  await win.loadURL("about:blank");

  const port = await waitForDevToolsActivePort(userDataDir);
  process.stdout.write(`DEMBRANDT_CDP_READY http://127.0.0.1:${port}\n`);
  watchParentLifecycle();
  app.on("will-quit", () => {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      // best effort
    }
    // Chromium profile dirs are large; every app run must not leave one behind.
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best effort — locked files on Windows may survive until OS cleanup
    }
  });
}

run().catch((error: unknown) => {
  console.error("[dembrandt-provider-child] failed:", error);
  // Non-zero exit tells the parent this spawn is unusable; it surfaces a
  // clear provisioning error instead of hanging on readiness.
  process.exit(1);
});
