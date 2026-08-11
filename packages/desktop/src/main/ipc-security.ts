/**
 * Renderer origin / identity policy for privileged IPC.
 *
 * The privileged preload exposes file writes, settings, Git, MCP, prompt
 * execution and destructive index operations through `window.deeporca`. Any
 * page that ends up inside the main window inherits that surface, so every
 * privileged IPC call must prove it comes from our own packaged renderer (or,
 * in development, the configured dev-server origin).
 *
 * The policy lives in its own module so it can be unit-tested without spinning
 * up the Electron app: `createRendererPolicy()` returns pure predicates over
 * `(senderId, senderFrameUrl, senderFrame)` tuples, while `assertMainRenderer`
 * and `isFromMainRenderer` adapt those predicates to Electron's
 * `IpcMainInvokeEvent` at the IPC boundary.
 *
 * Design rules (intentionally strict):
 *  - The sender must first be identified as the main window's `webContents`
 *    by id. A loose URL match on its own is never sufficient.
 *  - The sender frame must be the main frame of that webContents — subframes
 *    (e.g. embedded content) must not be able to call privileged channels even
 *    if their URL happens to match.
 *  - Production accepts ONLY the exact packaged renderer file URL — not any
 *    `file://` path. A stray local HTML document loaded into the privileged
 *    window must not pick up the preload surface.
 *  - Development accepts ONLY an explicit, configured dev-server origin (host
 *    + port), compared via `URL` parsing. `http://localhost` prefix matching
 *    is deliberately rejected because it also matches hosts such as
 *    `localhost.attacker.example` and any port.
 *  - `file:` URLs are compared via `pathToFileURL` so Windows drive letters,
 *    spaces and non-ASCII paths cannot drift between string forms.
 */

import { pathToFileURL } from "node:url";

/**
 * Minimal subset of Electron's `IpcMainInvokeEvent` that this module reasons
 * about. Declared locally (not imported from `electron`) so the policy is
 * pure and can be exercised from a unit test without loading Electron.
 */
export interface IpcSenderInfo {
  /** `webContents.id` of the sender. */
  readonly senderId: number;
  /** URL of the sending frame, or ""/undefined if Electron did not supply one. */
  readonly senderFrameUrl?: string;
  /**
   * Best-effort frame identity. Electron exposes `event.senderFrame` and
   * `event.sender.mainFrame`; the policy only needs to know whether the
   * sending frame is the main frame. Tests pass a boolean; the adapter maps
   * the real Electron objects to that boolean.
   */
  readonly isMainFrame: boolean;
}

/**
 * Identity of the privileged main window. The id is supplied lazily (the
 * window is created after this module loads), so the policy resolves it via a
 * callback rather than capturing a stale reference.
 */
export interface MainWindowIdProvider {
  /** Returns the main window's `webContents.id`, or `null` if it is gone. */
  (): number | null;
}

/** Configuration for the policy. */
export interface RendererPolicyConfig {
  /** Accessor for the current main window webContents id. */
  mainWindowId: MainWindowIdProvider;
  /** Absolute path to the packaged renderer `index.html`. */
  rendererHtmlPath: string;
  /**
   * Explicit dev-server origin allowed in development, e.g.
   * `http://localhost:5173`. When `null`/empty, no dev origin is accepted.
   */
  devRendererOrigin: string | null;
}

/** Compiled, immutable policy. Pure predicates — safe to test without Electron. */
export interface RendererPolicy {
  /** True iff `sender` is the privileged main renderer and may be trusted. */
  isMainRenderer(sender: IpcSenderInfo): boolean;
  /**
   * True iff `url` is a renderer URL the privileged window is allowed to
   * navigate to. Used by `will-navigate` guards. Unlike {@link isMainRenderer},
   * the file-URL comparison ignores `?query`/`#hash` so a prototype window
   * loading `renderer/index.html?view=prototype&token=…` is still allowed.
   * Query/hash never affect which document is loaded from disk, and the
   * renderer's own client-side routing keys off them.
   */
  isAllowedRendererNavigationUrl(url: string): boolean;
}

/** Expected production renderer URL, computed once via `pathToFileURL`. */
function computeProductionRendererUrl(rendererHtmlPath: string): string {
  return pathToFileURL(rendererHtmlPath).href;
}

/** Normalize an origin string for exact comparison (`https://Host:Port`). */
function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    // Only http(s) dev origins are accepted; ports are part of the authority.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // Strip trailing slash so "http://localhost:5173/" matches the bare origin.
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Build a renderer policy from explicit config. The returned object holds no
 * mutable state and is safe to share across tests.
 */
export function createRendererPolicy(config: RendererPolicyConfig): RendererPolicy {
  const productionUrl = computeProductionRendererUrl(config.rendererHtmlPath);
  const productionUrlNoFrag = stripQueryAndHash(productionUrl);
  const allowedDevOrigin = normalizeOrigin(config.devRendererOrigin);

  function isAllowedDevUrl(url: string): boolean {
    if (!allowedDevOrigin) return false;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    // Exact host (incl. port) match — no prefix matching, no path inspection.
    return `${parsed.protocol}//${parsed.host}` === allowedDevOrigin;
  }

  return {
    isMainRenderer(sender) {
      // Step 1: the sender must be the privileged main window's webContents.
      const expectedId = config.mainWindowId();
      if (expectedId === null || sender.senderId !== expectedId) {
        return false;
      }
      // Step 2: only the main frame of that webContents may call privileged IPC.
      if (!sender.isMainFrame) {
        return false;
      }
      // Step 3: the frame URL must match the production renderer file URL
      // exactly, or — in development — the configured dev origin.
      const url = sender.senderFrameUrl ?? "";
      if (!url) return false;
      if (url === productionUrl) return true;
      return isAllowedDevUrl(url);
    },
    isAllowedRendererNavigationUrl(url) {
      if (!url) return false;
      // Production renderer file URL, ignoring query/hash (the prototype
      // window legitimately appends ?view=prototype&token=…). The pathname
      // still has to match the renderer HTML exactly.
      if (stripQueryAndHash(url) === productionUrlNoFrag) return true;
      // Dev origin: any path under the configured dev origin is fine.
      return isAllowedDevUrl(url);
    },
  };
}

/** Drop `?query` and `#hash` from a URL string, preserving protocol+host+path. */
function stripQueryAndHash(url: string): string {
  const q = url.indexOf("?");
  const h = url.indexOf("#");
  let end = url.length;
  if (q !== -1) end = Math.min(end, q);
  if (h !== -1) end = Math.min(end, h);
  return url.slice(0, end);
}

/**
 * Adapter used by the IPC helpers. Maps an Electron `IpcMainInvokeEvent` to
 * the pure {@link IpcSenderInfo} the policy reasons over.
 *
 * Implemented as a callback so the Electron import stays in `main/index.ts`
 * and this module remains electron-free.
 */
export type IpcEventAdapter = (event: unknown) => IpcSenderInfo;

/**
 * Build the adapter for Electron's event shape. Exported for use by
 * `main/index.ts`; tests construct `IpcSenderInfo` directly instead.
 */
export function createElectronEventAdapter(): {
  toSenderInfo: IpcEventAdapter;
} {
  return {
    toSenderInfo(event) {
      // We intentionally reach into the Electron event via a narrow cast so
      // this module does not need to import `electron`. Callers always pass a
      // real `IpcMainInvokeEvent`.
      const e = event as {
        sender?: { id?: number; mainFrame?: unknown };
        senderFrame?: { url?: string } | null;
      };
      const sender = e.sender;
      const senderFrame = e.senderFrame;
      const senderId = typeof sender?.id === "number" ? sender.id : -1;
      const senderFrameUrl = senderFrame?.url ?? "";
      // A frame is "main" iff it is the sender webContents' main frame. We
      // compare by reference when both are present; if Electron failed to
      // supply either side we treat the frame as non-main (fail closed).
      const mainFrame = sender?.mainFrame;
      const isMainFrame = Boolean(mainFrame && senderFrame && mainFrame === senderFrame);
      return { senderId, senderFrameUrl, isMainFrame };
    },
  };
}
