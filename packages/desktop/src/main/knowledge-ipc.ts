/**
 * Knowledge-surface IPC (split out of main/index.ts 2026-08-29 — the
 * composition root had grown past the 2500-line hard limit; this module is
 * the cohesive knowledge block: status, symbols/graph, wiki pages, archify
 * artifacts + render gate + sandboxed preview window, git preflight's
 * root-pinning helper).
 */

import { BrowserWindow, shell } from "electron";
import { createRequire as nodeCreateRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readdirSync, statSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { IpcRequest, type KnowledgeStatusResponse, type KnowledgeSourceStatus } from "../shared/ipc.js";
import { listWorkspaceSessions } from "./workspace-registry.js";
import type { SessionBridge } from "./session-bridge.js";
import { safeArchmapPath } from "./safe-path.js";
import { isWikiVariantFile } from "@deeporca/core";
import {
  ArchifyCli,
  listArchifyArtifacts,
  archifyTypeOf,
  verifyReceipt,
  refreshViewerPatches,
  type ArchifyType,
} from "./tools/archify-cli.js";
import { configureArchifyPaths, configureArchRenderer, type ArchifyPaths } from "@deeporca/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Arch preview windows (user ask 2026-08-30: 子窗口追踪): one per artifact,
 *  single instance per path; all torn down when the main window closes. */
const archWindows = new Map<string, BrowserWindow>();
export function closeAllArchPreviewWindows(): void {
  for (const w of archWindows.values()) {
    if (!w.isDestroyed()) w.close();
  }
  archWindows.clear();
}
const moduleRequire = nodeCreateRequire(import.meta.url);

/** Minimal structural shape of main/index.ts's IpcHelpers (no reverse import). */
type KnowledgeIpcHelpers = {
  handle: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
};

/** main/index.ts owns the SessionBridge singleton — injected at registration
 *  (no reverse import into the composition root). */
let bridge: () => SessionBridge;

// Archify: vendored skill package. Two host injections follow:
// embeds them in its prompt — core must not derive vendor paths itself) and
// the deterministic DELIVER gate the arch build stage runs after the LLM task.
const ARCHIFY_VENDOR_DIR = join(__dirname, "..", "vendor", "archify");
const archifyBin = join(ARCHIFY_VENDOR_DIR, "bin", "archify.mjs");
const archifyPaths: ArchifyPaths = {
  skillDoc: join(ARCHIFY_VENDOR_DIR, "SKILL.md"),
  schemasDir: join(ARCHIFY_VENDOR_DIR, "schemas"),
  examplesDir: join(ARCHIFY_VENDOR_DIR, "examples"),
  bin: archifyBin,
};
configureArchifyPaths(existsSync(archifyBin) ? archifyPaths : null);
const archifyCli = new ArchifyCli({
  bin: archifyBin,
  // Electron-as-Node: archify is pure ESM JavaScript (zero runtime deps), so
  // the app's own binary satisfies it — no system-Node dependency.
  nodeRunner: process.execPath,
  electronRunAsNode: true,
});
// Seam configured ONLY when the bin exists (review round 6): an unconditional
// registration made index-build's "renderer not configured — skipping gate"
// branch unreachable; a missing vendor must degrade, not hard-fail the stage.
if (existsSync(archifyBin)) {
  configureArchRenderer(async (root: string) => archifyCli.deliverAllPending(root));
}

/**
 * Pin renderer-supplied workspace roots to registered workspaces (P2
 * hardening, 2026-08-27): the renderer is semi-trusted, and a compromised one
 * previously could pass ANY absolute root to knowledge/taskTree channels —
 * directory enumeration, symbol-graph reads from arbitrary projects,
 * task-tree writes under ~/.ssh/<root>/. Same threat model as the archmap
 * pin; an omitted root always means the ACTIVE workspace. Returns null when
 * the supplied root is not a registered workspace.
 */
export function resolveRegisteredRoot(rootArg?: string): string | null {
  const root = typeof rootArg === "string" && rootArg ? rootArg : bridge().projectRoot;
  const known = new Set<string>([bridge().projectRoot]);
  try {
    for (const w of listWorkspaceSessions(bridge().projectRoot).workspaces) known.add(w.root);
  } catch {
    // Registry unreadable: fall back to current-root-only pinning.
  }
  return known.has(root) ? root : null;
}

export function registerKnowledgeIpc(
  helpers: KnowledgeIpcHelpers,
  getBridge: () => SessionBridge,
  getMainWindow?: () => BrowserWindow | null
): void {
  bridge = getBridge;
  const { handle, handlePrivileged } = helpers;
  handle(IpcRequest.KnowledgeStatus, async (rootArg?: string): Promise<KnowledgeStatusResponse> => {
    const pinned = resolveRegisteredRoot(rootArg);
    // Unregistered root → degrade to disabled statuses (never enumerate it).
    const emptySource = () => ({ state: "disabled" as const, detail: "unregistered workspace" });
    if (!pinned) {
      return { codegraph: emptySource(), openwiki: emptySource(), agents: emptySource(), archmaps: emptySource() };
    }
    const root = pinned;
    const freshness = bridge().getKnowledgeFreshness?.() ?? {};
    const isStale = (syncTime?: string): boolean =>
      !!(freshness.lastMutation && (!syncTime || freshness.lastMutation > syncTime));

    const countDirFiles = (dir: string, filter?: (name: string) => boolean): number => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        return entries.filter((e) => e.isFile() && (!filter || filter(e.name))).length;
      } catch {
        return 0;
      }
    };

    // Newest mtime under a directory (recursive walk of all subdirs) — ISO string.
    const newestMtime = (dir: string, filter?: (name: string) => boolean): string | undefined => {
      let best = 0;
      const scan = (d: string): void => {
        try {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, e.name);
            if (e.isDirectory()) {
              scan(full);
            } else if (e.isFile() && (!filter || filter(e.name))) {
              const m = statSync(full).mtimeMs;
              if (m > best) best = m;
            }
          }
        } catch {
          // unreadable dir — skip
        }
      };
      scan(dir);
      return best > 0 ? new Date(best).toISOString() : undefined;
    };

    // CodeGraph — real node count, not directory presence (audit 2026-08-28:
    // a bare `.codegraph/` dir, a missing db, or a 0-node index all lit the
    // "indexed" dot while the symbols tab stayed empty). lastSync falls back
    // to the database file's mtime: the in-memory freshness stamps only exist
    // for the ACTIVE workspace's manager and vanish on restart, so without
    // this every non-active (or freshly-relaunched) row read 未同步 forever
    // even right after a successful build.
    const cgDir = join(root, ".codegraph");
    const cgDbMtime = (() => {
      try {
        return statSync(join(cgDir, "codegraph.db")).mtime.toISOString();
      } catch {
        return undefined;
      }
    })();
    const cgNodeCount = (() => {
      // Same lazy node:sqlite read-only pattern as the symbol list/graph
      // handlers; degrades to 0 (→ "empty") under older runtimes.
      const dbPath = join(cgDir, "codegraph.db");
      if (!existsSync(dbPath)) return 0;
      try {
        const { DatabaseSync } = moduleRequire("node:sqlite") as {
          DatabaseSync: new (path: string, opts: { readOnly: boolean }) => DatabaseSyncType;
        };
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const row = db
            .prepare("SELECT COUNT(*) AS n FROM nodes WHERE kind NOT IN ('import','unknown','file')")
            .get() as { n: number };
          return row.n;
        } finally {
          db.close();
        }
      } catch {
        return 0;
      }
    })();
    const cgSync = freshness.codegraphSync ?? cgDbMtime;
    const codegraph: KnowledgeSourceStatus =
      cgNodeCount > 0
        ? {
            state: isStale(cgSync) ? "stale" : "indexed",
            lastSync: cgSync,
            detail: ".codegraph/",
            count: cgNodeCount,
            unit: "符号",
          }
        : { state: "empty", detail: existsSync(cgDir) ? "空索引" : "未构建" };

    // Base pages only: the removed bilingual stage's legacy `*.zh.md` /
    // `*.en.md` siblings stay on disk but must not count as pages.
    const isCountedWikiPage = (n: string): boolean => n.endsWith(".md") && !isWikiVariantFile(n);

    // OpenWiki — page count under the canonical deepwiki/ store (the
    // openwiki/ dir is the CLI's run-local stage, never the read surface).
    const wikiDir = join(root, "deepwiki");
    let wikiPages = 0;
    if (existsSync(wikiDir)) {
      wikiPages = countDirFiles(wikiDir, isCountedWikiPage);
      for (const sub of ["modules", "workflows"]) {
        wikiPages += countDirFiles(join(wikiDir, sub), isCountedWikiPage);
      }
      // A bare index.md skeleton (failed-init leftover, <100B real-world)
      // must not read as "1 页 · indexed" — content weight decides (512B
      // line, same as wiki-cli's post-run guard). Healthy landing pages run
      // 3KB+ (non-git probe 2026-08-28).
      try {
        if (statSync(join(wikiDir, "index.md")).size <= 512) wikiPages = Math.max(0, wikiPages - 1);
      } catch {
        // No index.md — nothing to discount.
      }
    }
    const wikiSync = freshness.wikiSync ?? (existsSync(wikiDir) ? newestMtime(wikiDir, isCountedWikiPage) : undefined);
    const openwiki: KnowledgeSourceStatus = existsSync(wikiDir)
      ? {
          state: wikiPages === 0 ? "empty" : isStale(wikiSync) ? "stale" : "indexed",
          count: wikiPages,
          unit: "页",
          lastSync: wikiSync,
        }
      : { state: "empty", detail: "未构建" };

    // AGENTS.md — presence + line count.
    const agentsPath = join(root, "AGENTS.md");
    let agentLines = 0;
    if (existsSync(agentsPath)) {
      try {
        agentLines = readFileSync(agentsPath, "utf8").split("\n").length;
      } catch {
        agentLines = 0;
      }
    }
    const agents: KnowledgeSourceStatus = existsSync(agentsPath)
      ? { state: "indexed", count: agentLines, unit: "行" }
      : { state: "empty", detail: "无 AGENTS.md" };

    // Architecture maps (T4) — artifacts persisted under
    // .deeporca/prototypes/. Archify era (2026-08-29: 摒弃自有 mermaid 方案): artifacts are typed-IR
    // `arch-*.<type>.json` pairs with their delivered `.html` siblings. The
    // >256B content-weight line lives in listArchifyArtifacts (same hollow-
    // leftover discipline as the wiki skeleton guard).
    const archArtifacts = listArchifyArtifacts(root);
    // Viewer-patch sweep (2026-08-30): refresh the desktop patches (passport
    // follows the node, presentation stage locked on) in already-delivered
    // maps so opening the panel fixes them in place — no arch rebuild
    // required (no-op once current; never touches unverified HTML, that
    // stays the receipt-mismatch re-render path).
    refreshViewerPatches(root);
    const archFiles: KnowledgeStatusResponse["archmaps"]["files"] = archArtifacts.map((a) => ({
      name: a.name,
      path: a.jsonPath,
      mtime: a.mtime,
      type: a.type,
      htmlPath: a.htmlDelivered ? a.htmlPath : undefined,
    }));
    const archmaps: KnowledgeStatusResponse["archmaps"] =
      archFiles.length > 0
        ? { state: "indexed", count: archFiles.length, unit: "张", files: archFiles }
        : { state: "empty", detail: "未生成", files: [] };

    return { codegraph, openwiki, agents, archmaps };
  });

  // Architecture-map preview: `.md` artifacts are Mermaid documents handed to
  // the renderer as markdown (diagrams hydrate in the preview); legacy `.json`
  // artifacts are the persisted A2UI surface drawn by the real A2UI renderer.
  /** Containment pin shared by the archify render/open handlers (audit
   *  2026-08-25 lineage): the target must sit under
   *  `<registeredWorkspace>/.deeporca/prototypes/` with an arch-* basename —
   *  lexical + realpath containment, never a bare renderer-supplied path. */
  const archPathWithinRegisteredRoot = (
    targetPath: string
  ): { ok: true; absPath: string } | { ok: false; error: string } => {
    const knownRoots = new Set<string>([bridge().projectRoot]);
    try {
      for (const w of listWorkspaceSessions(bridge().projectRoot).workspaces) knownRoots.add(w.root);
    } catch {
      // registry unreadable — active root only (review round 7: this was the
      // one unprotected registry read; a corrupt registry threw to the renderer)
    }
    const marker = join(".deeporca", "prototypes");
    const idx = targetPath.lastIndexOf(marker);
    const candidateRoot = idx > 0 ? targetPath.slice(0, idx - 1) : "";
    if (!candidateRoot || !knownRoots.has(candidateRoot)) {
      return { ok: false, error: "Invalid architecture-map path (unregistered workspace)." };
    }
    // Symlink refusal (review round 7): lstatSync — statSync FOLLOWED the link
    // so the old check never fired — and only the CANDIDATE's root (an
    // unrelated workspace's symlink must not poison this read).
    try {
      if (lstatSync(join(candidateRoot, marker)).isSymbolicLink()) {
        return { ok: false, error: "refusing: .deeporca/prototypes is a symlink" };
      }
    } catch {
      // absent — fine
    }
    const check = safeArchmapPath(join(candidateRoot, marker), targetPath);
    if (!check.ok) {
      return { ok: false, error: `Invalid architecture-map path (${check.reason}).` };
    }
    return { ok: true, absPath: check.absPath };
  };

  // Typed-IR JSON read for the in-pane dynamic map (sub-level artifacts are
  // drawn by OUR renderer, symbol-graph style — the user decision 2026-08-29:
  // 一级直接展开内嵌, 子级类似索引关系图动态绘制). Same containment pin.
  handlePrivileged(
    IpcRequest.KnowledgeArchReadJson,
    (jsonPath: string): { ok: boolean; json?: string; error?: string } => {
      const pin = archPathWithinRegisteredRoot(jsonPath);
      if (!pin.ok) return { ok: false, error: pin.error };
      if (archifyTypeOf(basename(pin.absPath)) === "unknown")
        return { ok: false, error: "not a typed archify artifact" };
      try {
        // Size cap (review round 7): a multi-MB model-written JSON would hang
        // the renderer's parse — treat >4MB as not-a-map.
        if (statSync(pin.absPath).size > 4 * 1024 * 1024) {
          return { ok: false, error: "artifact exceeds 4MB — refusing to load into the map pane" };
        }
        return { ok: true, json: readFileSync(pin.absPath, "utf-8") };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Deterministic render gate, callable from the Knowledge panel (refresh a
  // typed-IR artifact whose HTML is missing): validate + render + atomic
  // commit via the vendored archify CLI. Failures carry archify diagnostics.
  handlePrivileged(
    IpcRequest.KnowledgeArchRender,
    async (jsonPath: string): Promise<{ ok: boolean; htmlPath?: string; error?: string }> => {
      const pin = archPathWithinRegisteredRoot(jsonPath);
      if (!pin.ok) return { ok: false, error: pin.error };
      const type = archifyTypeOf(basename(pin.absPath));
      if (type === "unknown") return { ok: false, error: "not a typed archify artifact (arch-*.<type>.json)" };
      const htmlPath = pin.absPath.replace(/\.json$/, ".html");
      // Receipt-verified fast path (review round 7): HTML the HOST delivered
      // (sha matches the sidecar) embeds without a re-render; any other HTML
      // — including model-authored — is deterministically overwritten.
      if (existsSync(htmlPath) && verifyReceipt(htmlPath)) return { ok: true, htmlPath };
      const res = await archifyCli.deliver(type as ArchifyType, pin.absPath, htmlPath);
      return res.ok ? { ok: true, htmlPath } : { ok: false, error: res.error };
    }
  );

  // Open a delivered archify HTML in a sandboxed preview window. The artifact
  // is a self-contained interactive page (archify's validated render), so the
  // window needs no preload and no node access — only navigation hardening.
  // Window tracking (user ask 2026-08-30: 子窗口与主体的追踪): one window per
  // artifact (re-open focuses the existing one), tracked in a registry so
  // the main window's close tears them all down — no orphans after the app
  // window goes away.

  handlePrivileged(
    IpcRequest.KnowledgeOpenArchHtml,
    (htmlPath: string, theme?: "light" | "dark"): { ok: boolean; error?: string } => {
      const pin = archPathWithinRegisteredRoot(htmlPath);
      if (!pin.ok) return { ok: false, error: pin.error };
      if (!existsSync(pin.absPath)) {
        return { ok: false, error: "HTML not delivered yet — render the artifact first." };
      }
      // Receipt gate (red-team 2026-08-30): the iframe path refuses unverified
      // HTML — this open-window path must not become the bypass. Only a
      // host-delivered render (receipt pins path + content) may open here.
      if (!verifyReceipt(pin.absPath)) {
        return {
          ok: false,
          error: "not a host-delivered render (receipt missing or mismatched) — run the render gate first.",
        };
      }
      // Single instance per artifact: focus + restore the existing window.
      const existing = archWindows.get(pin.absPath);
      if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return { ok: true };
      }
      // FOLLOW the main window (user ask 2026-08-30: 子窗口追随主体): parent
      // gives z-order tracking + minimize-together; the move listener below
      // keeps the window at a fixed offset from the main window as it moves.
      const mainWin = getMainWindow?.() ?? null;
      // Spawn NEXT TO the main window (user ask: 一打开就在主体旁边，不是随机
      // 默认位置): cascade offset 40px so multiple children don't perfectly
      // overlap; clamped to the screen's visible area.
      let x: number | undefined;
      let y: number | undefined;
      if (mainWin && !mainWin.isDestroyed()) {
        const mb = mainWin.getBounds();
        x = Math.max(0, mb.x + Math.round((mb.width - 1280) / 2));
        y = Math.max(0, mb.y + Math.round((mb.height - 860) / 2));
      }
      const win = new BrowserWindow({
        width: 1280,
        height: 860,
        ...(x !== undefined && y !== undefined ? { x, y } : {}),
        title: basename(pin.absPath),
        autoHideMenuBar: true,
        ...(mainWin ? { parent: mainWin } : {}),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
          // Dedicated in-memory partition (review round 6): the artifact window
          // must not share cookies/storage with the app's main session.
          partition: "arch-preview",
        },
      });
      archWindows.set(pin.absPath, win);
      // Guarded delete (red-team D-3): a stale closed event from a previous
      // window for the same artifact must not evict the freshly registered one.
      win.on("closed", () => {
        if (archWindows.get(pin.absPath) === win) archWindows.delete(pin.absPath);
      });
      if (mainWin && !mainWin.isDestroyed()) {
        // Move-follow: keep the child at its initial offset from the main
        // window. The listener dies with the child (main closes → children
        // close first via the teardown, so no dangling listeners).
        const relX = win.getBounds().x - mainWin.getBounds().x;
        const relY = win.getBounds().y - mainWin.getBounds().y;
        const onMove = (): void => {
          if (win.isDestroyed()) return;
          const mb = mainWin.getBounds();
          win.setBounds({ ...win.getBounds(), x: mb.x + relX, y: mb.y + relY });
        };
        mainWin.on("move", onMove);
        win.on("closed", () => mainWin.removeListener("move", onMove));
      }
      // Model-authored HTML runs here — deny every permission request by
      // default (Electron's default is APPROVE; review round 6).
      win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(false);
        console.log(`[arch-preview] denied permission request: ${permission}`);
      });
      // A delivered artifact must never navigate anywhere else.
      win.webContents.on("will-navigate", (event, url) => {
        if (url === win.webContents.getURL()) return;
        event.preventDefault();
        if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
      });
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
        return { action: "deny" };
      });
      // TOCTOU: the file may vanish between existsSync and load — a floating
      // rejection would be an unhandled error (review round 6). The viewer's
      // color mode follows the app appearance via ?theme= (2026-08-30 主题跟
      // 随); the present-lock patch re-asserts the stage regardless of URL.
      const loadUrl =
        theme === "light" || theme === "dark" ? `${pathToFileURL(pin.absPath).href}?present=1&theme=${theme}` : null;
      const load = loadUrl ? win.loadURL(loadUrl) : win.loadFile(pin.absPath);
      load.catch((err) => {
        console.error(`[arch-preview] failed to load artifact:`, err);
        // The window may already be destroyed (user closed mid-load → the
        // load rejects with ERR_ABORTED) — closing a destroyed BrowserWindow
        // throws in the main process (red-team D-2).
        if (!win.isDestroyed()) win.close();
      });
      return { ok: true };
    }
  );
}
