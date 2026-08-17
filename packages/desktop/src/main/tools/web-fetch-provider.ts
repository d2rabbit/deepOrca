/**
 * WebFetch browser provider — the rendered engine for the built-in WebFetch
 * tool, served from Electron's own Chromium (headless-equivalent: a hidden,
 * offscreen BrowserWindow that is never shown; same pattern as
 * dembrandt-browser.ts and app-icon.ts, without the CDP detour — the
 * webContents API drives navigation and extraction directly).
 *
 * Privacy contract (web-fetch-handler.ts / web-search-providers.ts line):
 * only the target URL is requested, with Electron's default User-Agent
 * (which names the app) — no per-machine identifier, no telemetry, no
 * proxy. The SSRF gate runs in core BEFORE any URL reaches this provider,
 * and again on every redirect hop (will-redirect guard below).
 *
 * Lifecycle: one window is created lazily on the first fetch and kept alive
 * for the app run (window creation is the expensive part; fetches repeat).
 * Navigations are serialized through a promise queue — a BrowserWindow has
 * exactly one webContents, so concurrent fetches would race.
 */

import { BrowserWindow, app } from "electron";
import type { WebFetchPage } from "@deeporca/core";
import { validatePublicHttpUrl, DEFAULT_TIMEOUT_MS, MAX_LINKS, MAX_OUTPUT_CHARS } from "@deeporca/core";

/** Settle delay after did-finish-load so script-built DOM lands before extraction. */
const SETTLE_DELAY_MS = 400;

let providerWindow: BrowserWindow | null = null;
let providerStarting: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Extraction runs in the page's main world — plain DOM, no Node APIs. */
const EXTRACT_SCRIPT = `
(() => {
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!/^https?:/i.test(href)) continue;
    const title = (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    if (!title) continue;
    links.push({ title, url: href });
    if (links.length >= ${MAX_LINKS}) break;
  }
  const text = (document.body && document.body.innerText ? document.body.innerText : '').slice(0, ${MAX_OUTPUT_CHARS});
  return {
    title: document.title || '',
    text,
    links,
    truncated: (document.body && document.body.innerText ? document.body.innerText.length : 0) > ${MAX_OUTPUT_CHARS},
  };
})()
`;

async function ensureProviderWindow(): Promise<BrowserWindow> {
  if (providerWindow && !providerWindow.isDestroyed()) {
    return providerWindow;
  }
  if (providerStarting) {
    await providerStarting;
    return providerWindow!;
  }
  providerStarting = (async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Without this the hidden window's timers/JS get throttled and
        // script-heavy pages never finish rendering.
        backgroundThrottling: false,
      },
    });
    win.webContents.setAudioMuted(true);
    await win.loadURL("about:blank");
    win.on("closed", () => {
      providerWindow = null;
    });
    app.on("will-quit", () => {
      try {
        if (providerWindow && !providerWindow.isDestroyed()) {
          providerWindow.destroy();
        }
      } catch {
        // best effort
      }
      providerWindow = null;
    });
    providerWindow = win;
  })();
  try {
    await providerStarting;
  } finally {
    providerStarting = null;
  }
  return providerWindow!;
}

/** One navigation at a time — the window has a single webContents. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/** Load a page in the provider window and extract its rendered content. */
async function loadAndExtract(url: string, timeoutMs: number): Promise<WebFetchPage> {
  const win = await ensureProviderWindow();
  const wc = win.webContents;

  const result = await new Promise<{ kind: "ok" } | { kind: "fail"; code: number; desc: string }>((resolve) => {
    let settled = false;
    const onFinish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ kind: "ok" });
    };
    // did-fail-load also fires for SUBFRAMES (dead iframes/trackers are
    // common); only a main-frame failure rejects the fetch.
    const onFail = (_e: unknown, code: number, desc: string, _validatedUrl: string, isMainFrame: boolean): void => {
      if (settled || isMainFrame === false) return;
      settled = true;
      cleanup();
      resolve({ kind: "fail", code, desc });
    };
    // SSRF: Chromium follows HTTP redirects inside loadURL — validate every
    // redirect target and cancel the navigation when it leaves public space
    // (the core-side gate only saw the pre-redirect URL).
    const onRedirect = (event: Electron.Event, redirectUrl: string): void => {
      const check = validatePublicHttpUrl(redirectUrl);
      if (!check.ok) {
        event.preventDefault();
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ kind: "fail", code: -4, desc: `redirect to non-public target refused: ${check.error}` });
      }
    };
    const cleanup = (): void => {
      wc.off("did-finish-load", onFinish);
      wc.off("did-fail-load", onFail);
      wc.off("will-redirect", onRedirect);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      // Stop the in-flight load so the window is reusable for the next fetch.
      try {
        wc.stop();
      } catch {
        // best effort
      }
      resolve({ kind: "fail", code: -3, desc: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    wc.once("did-finish-load", onFinish);
    wc.once("did-fail-load", onFail);
    wc.on("will-redirect", onRedirect);
    // loadURL rejects on load failure and on wc.stop() (timeout path) — both
    // are already surfaced via did-fail-load/the timer; swallow the promise.
    wc.loadURL(url, { userAgent: wc.getUserAgent() }).catch(() => {});
  });

  if (result.kind === "fail") {
    throw new Error(`page load failed (${result.code}): ${result.desc}`);
  }

  // Settle: give script-built DOM a beat before extraction.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));

  const extracted = (await wc.executeJavaScript(EXTRACT_SCRIPT, true)) as {
    title: string;
    text: string;
    links: { title: string; url: string }[];
    truncated: boolean;
  };
  return {
    url: wc.getURL() || url,
    title: extracted.title,
    text: extracted.text,
    links: extracted.links,
    engine: "rendered",
    truncated: extracted.truncated,
  };
}

/**
 * Fetcher wired into SessionManager as `fetchWebPage` — the preferred
 * (rendered) engine of the built-in WebFetch tool.
 */
export function fetchRenderedPage(url: string, options?: { timeoutMs?: number }): Promise<WebFetchPage> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return enqueue(() => loadAndExtract(url, timeoutMs));
}

/** Tear down the provider (tests and graceful shutdown paths). */
export async function closeWebFetchProvider(): Promise<void> {
  const win = providerWindow;
  providerWindow = null;
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
}
