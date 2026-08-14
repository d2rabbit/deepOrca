// Electron main process for the DeepOrca Desktop client.
// Boots a BrowserWindow, wires the SessionBridge to IPC, and forwards engine
// events to the renderer.

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { statSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  setShellIfWindows,
  resolveCurrentSettings,
  resolveModernNode,
  getUserConfigRoot,
  getProjectCode,
  configureCrgVersionRoot,
  hasCrgProject,
  resolveUvBinary,
  configureUvVendorRoot,
  runCrgResetWithOutput,
  runCrgVisualize,
  configureSerenaController,
  configureSkillSpectorController,
  configureCrgController,
  configureRoutingModelDir,
  configureRoutingLogger,
  closeEmbeddingService,
  type MemoryProvider,
  configureActionSpawner,
  configureReviewController,
  configureCodegraphController,
  configureWikiController,
  configureVisionServerBuilder,
  configureA2uiServerBuilder,
  configureActivityFramesServerBuilder,
  configureGitmcpConfigBuilder,
  buildGitmcpMcpServerConfig,
} from "@deeporca/core";
import type { ModelConfigSelection, UserPromptContent } from "@deeporca/core";
import { IpcEvent, IpcRequest } from "../shared/ipc.js";
import type {
  CodegraphIndexEntry,
  CrgIndexEntry,
  DesignArtifact,
  DesignArtifactMeta,
  EditableSettings,
  KnowledgeSourceStatus,
  KnowledgeStatusResponse,
  MemoryPipelineStats,
  UndoRestoreMode,
  WikiPageEntry,
} from "../shared/ipc.js";
import { SessionBridge } from "./session-bridge.js";
import { applyAppIcon } from "./app-icon.js";
import { PluginManager, type PluginEventCallback } from "./plugin-manager.js";
import { scanFiles } from "./file-scanner.js";
import { listWorkspaceSessions } from "./workspace-registry.js";
import { archiveSession, unarchiveSession } from "./archive-store.js";
import { ElectronNodeSpawner, registerActionIpc } from "./action-ipc.js";
import { SdkCodegraphController } from "./tools/codegraph-sdk.js";
import { OcrCliController } from "./tools/ocr-cli.js";
import { WikiCliController } from "./tools/wiki-cli.js";
import { buildVisionServer } from "./tools/vision-mcp.js";
import { SerenaCliController } from "./tools/serena-cli.js";
import { SkillSpectorCliController } from "./tools/skill-spector-cli.js";
import { CrgCliController } from "./tools/crg-cli.js";
import {
  listDesignArtifacts,
  readDesignArtifact,
  deleteDesignArtifact,
  saveFormState,
  readFormState,
  type DesignPipeline,
} from "./tools/design-store.js";
import { a2uiServerBuilder } from "./tools/a2ui/index.js";
import { buildActivityFramesServer } from "./tools/activity-frames/index.js";
import { handleEditorReadFile, handleEditorWriteFile, handleEditorListFiles } from "./editor-handlers.js";
import { createRendererPolicy, createElectronEventAdapter, type RendererPolicy } from "./ipc-security.js";
import { safeWikiPath } from "./safe-path.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Long-running helper processes (ocr review / openwiki agent) spawned on behalf
// of the renderer. Tracked so they are terminated when the app shuts down
// instead of lingering after the window closes.
const activeHelperProcesses = new Set<ChildProcess>();

function trackHelperProcess(cp: ChildProcess): void {
  activeHelperProcesses.add(cp);
  cp.once("close", () => activeHelperProcesses.delete(cp));
  cp.once("error", () => activeHelperProcesses.delete(cp));
}

function killHelperProcesses(): void {
  for (const cp of activeHelperProcesses) {
    try {
      cp.kill();
    } catch {
      // Best-effort — process may have already exited.
    }
  }
  activeHelperProcesses.clear();
}

// ── Renderer origin allowlist ──────────────────────────────────────────────
// The privileged preload (file writes, settings, Git, MCP, prompt execution,
// destructive index ops) must only be callable from our own packaged renderer.
// In development the renderer may also be served from a localhost dev server.
//
// The policy is pure (lives in ./ipc-security.ts) so it can be unit-tested
// without booting Electron. The production renderer URL is computed via
// `pathToFileURL` and matched exactly — no `file://` prefix, no `localhost`
// string prefix. Dev origins must be configured with an explicit host+port.
const RENDERER_HTML_PATH = join(__dirname, "renderer", "index.html");
const DEV_RENDERER_ORIGIN = process.env.DEEPORCA_DEV_RENDERER_ORIGIN ?? null;

const rendererPolicy: RendererPolicy = createRendererPolicy({
  mainWindowId: () => mainWindow?.webContents.id ?? null,
  rendererHtmlPath: RENDERER_HTML_PATH,
  devRendererOrigin: DEV_RENDERER_ORIGIN,
});
const { toSenderInfo } = createElectronEventAdapter();

/** True when an IPC invocation originated from the privileged main renderer. */
function isFromMainRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  return rendererPolicy.isMainRenderer(toSenderInfo(event));
}

/**
 * True when an IPC invocation originated from one of the tracked prototype
 * (popout) windows — those load the minimal prototype preload and may only
 * call the three channels that surface explicitly forwards to them
 * (WindowClose, A2uiAction, A2uiRequestPayload). Identified by webContents id,
 * not by URL: prototype windows load the same renderer HTML as the main
 * window, so a URL check would be ambiguous.
 */
function isFromPrototypeRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  const senderId = event.sender?.id;
  if (senderId === undefined) return false;
  for (const win of prototypeWindows.values()) {
    if (!win.isDestroyed() && win.webContents.id === senderId) {
      // Subframes inside a prototype window are not trusted either.
      const mainFrame = event.sender.mainFrame;
      return Boolean(mainFrame && event.senderFrame && mainFrame === event.senderFrame);
    }
  }
  return false;
}

/** Reject invocations from any frame other than the privileged main renderer.
 *  Used to harden destructive IPC channels. */
function assertMainRenderer(event: Electron.IpcMainInvokeEvent, channel: string): void {
  if (!isFromMainRenderer(event)) {
    throw new Error(`${channel}: invoked from unauthorized sender (${event.senderFrame?.url ?? "?"})`);
  }
}

/** Reject invocations from anything other than the main renderer or a tracked
 *  prototype window. Used for the three channels the prototype preload exposes. */
function assertMainOrPrototypeRenderer(event: Electron.IpcMainInvokeEvent, channel: string): void {
  if (isFromMainRenderer(event) || isFromPrototypeRenderer(event)) return;
  throw new Error(`${channel}: invoked from unauthorized sender (${event.senderFrame?.url ?? "?"})`);
}

// Product/brand name — drives the macOS menu-bar app name and Windows taskbar grouping.
app.setName("DeepOrca");

// V8 performance tuning — must be set before app.whenReady().
// max-semi-space-size: 16MB→64MB reduces minor GC frequency during token
//   streaming and JSON parsing (4x fewer scavenge pauses).
// max-old-space-size: raised to 4GB to prevent OOM on long agentic sessions
//   that accumulate full conversation history in memory.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096 --max-semi-space-size=64");

// CodeGraph: SDK controller handles init/reindex/sync in-process.
// MCP tools still use npm-shim.js subprocess (see augmentMcpServersWithBuiltins).

// Vendored openwiki CLI entry. Used by WikiCliController (tools/wiki-cli.ts).
const OPENWIKI_VENDOR_ENTRY = join(__dirname, "..", "vendor", "openwiki", "dist", "cli.js");

// Inject the desktop subprocess spawner into core's ActionRegistry (design M2).
configureActionSpawner(new ElectronNodeSpawner());
// CodeGraph: SDK import (replaces subprocess + vendor binary + node:sqlite
// resolution). The controller manages per-project CodeGraph instances and
// exposes an in-process MCPServer for connectInProcessServer.
configureCodegraphController(new SdkCodegraphController());
// OCR: CLI adapter (replaces configureOcrResolver + collectOcrReview spawn).
// Uses correct flags (--audience agent --format json) + correct JSON schema.
configureReviewController(new OcrCliController());
// Wiki: CLI controller (replaces configureWikiResolver — vendored openwiki CLI).
const wikiNode = resolveModernNode(22) ?? process.execPath;
configureWikiController(
  new WikiCliController({
    vendorEntry: OPENWIKI_VENDOR_ENTRY,
    nodeRunner: wikiNode,
    electronRunAsNode: wikiNode === process.execPath,
    getProjectRoot: () => getBridge().projectRoot,
    getLlmCreds: () => {
      const root = getBridge().projectRoot;
      if (!root) return {};
      try {
        const s = resolveCurrentSettings(root);
        return { apiKey: s.apiKey, baseURL: s.baseURL, model: "deepseek-v4-flash" };
      } catch {
        return {};
      }
    },
    getLanguage: () => {
      // Derive BCP-47 from app locale (e.g. "zh-CN", "en-US").
      // Falls back to undefined (OpenWiki defaults to English).
      try {
        return Intl?.DateTimeFormat()?.resolvedOptions()?.locale ?? undefined;
      } catch {
        return undefined;
      }
    },
  })
);

// Vision MCP: built-in in-process MCP server that gives text-only LLMs (like
// DeepSeek) the ability to understand images via a vision-capable proxy model.
// The builder is injected here; core connects it when a vision model is configured.
configureVisionServerBuilder(buildVisionServer);

// A2UI MCP: built-in in-process MCP server for interactive prototypes/designs.
// The builder + surface lifecycle are injected here; core connects via seam.
configureA2uiServerBuilder(a2uiServerBuilder);

// Activity-Frames MCP: built-in in-process MCP server for behavioral memory.
configureActivityFramesServerBuilder(buildActivityFramesServer);

// GitMCP: config builder for gitmcp:{owner}/{repo} placeholder resolution.
// resolve.ts (path resolution + sqlite runtime) stays in core; desktop injects
// the builder so session.ts can rewrite placeholders via seam.
configureGitmcpConfigBuilder(buildGitmcpMcpServerConfig);

// BrowserSkill: prepend vendor/browser-skill to PATH so the `bsk` CLI is discoverable
// by both the built-in bash tool and the web-access-strategy skill.
{
  const bskDir = join(__dirname, "..", "vendor", "browser-skill");
  const bskBinary = process.platform === "win32" ? "bsk.exe" : "bsk";
  if (existsSync(join(bskDir, bskBinary))) {
    process.env.PATH = `${bskDir}${delimiter}${process.env.PATH ?? ""}`;
    console.log("[boot] BrowserSkill: added vendor/browser-skill to PATH");
  }
}

// Point the CRG (code-review-graph) resolver at the vendored uv binary
// (packages/desktop/vendor/uv). When absent, the core resolver falls back
// to a system `uv`/`uvx` on PATH. CRG is a Python tool run via uv's
// isolated environment — no host Python required when uv is vendored.
configureUvVendorRoot(join(__dirname, "..", "vendor", "uv"));

// CRG version pin: read from vendor/crg/.vendored-crg-version (written by
// scripts/vendor-crg.js). Pins `uv tool run --from code-review-graph==<version>`.
configureCrgVersionRoot(join(__dirname, "..", "vendor", "crg"));

// CRG controller: prefer local wheel (offline), fall back to PyPI spec.
{
  const crgVendorDir = join(__dirname, "..", "vendor", "crg");
  let crgWheel = "code-review-graph==2.3.7";
  try {
    const version = readFileSync(join(crgVendorDir, ".vendored-crg-version"), "utf8").trim();
    const localWheel = join(crgVendorDir, `code_review_graph-${version}-py3-none-any.whl`);
    crgWheel = existsSync(localWheel) ? localWheel : `code-review-graph==${version}`;
  } catch {
    // Marker not found — use default PyPI spec.
  }
  configureCrgController(new CrgCliController({ uvBinary: resolveUvBinary() ?? "uvx", crgWheel }));
}

// Serena: controller-seam pattern (same as CodeGraph/CRG/OCR/Wiki).
// The adapter handles all spawn/config logic (uv command, SERENA_HOME, version pin).
// Core accesses it through getSerenaController().
configureSerenaController(
  new SerenaCliController({
    uvBinary: resolveUvBinary(),
    vendorRoot: join(__dirname, "..", "vendor", "serena"),
  })
);

// SkillSpector (AI skill/MCP security scanner) shares the same vendored uv and reads
// its pinned version from the vendored skillspector dir (written by
// SkillSpector: controller-seam pattern (same as Serena). The adapter handles
// all provisioning (wheel/git fallback, async background install, version pin).
const skillSpectorController = new SkillSpectorCliController({
  vendorRoot: join(__dirname, "..", "vendor", "skillspector"),
});
skillSpectorController.setLogger((message, detail) => {
  console.error("[skill-spector]", message, detail ?? "");
});
configureSkillSpectorController(skillSpectorController);

// Semantic skill/tool routing reads the vendored Granite embedding model from
// vendor/granite-embedding (written by scripts/vendor-granite.js, copied into
// Resources/app/vendor by electron-builder's extraResources). Injected for the
// same reason as CodeGraph above: only the host knows whether it is running from
// a repo checkout or a packaged app. Failures are logged rather than swallowed —
// routing fails open, so without a diagnostic a bad model path is
// indistinguishable from routing simply being disabled.
configureRoutingModelDir(join(__dirname, "..", "vendor", "granite-embedding"));
configureRoutingLogger((message, detail) => {
  console.error("[routing]", message, detail ?? "");
});

// Keep the vendored CodeGraph/OpenWiki checkouts fresh: in dev (unpackaged),
// kick off the vendor scripts in the background at boot so they fetch upstream
// and recompile when new commits landed — the next launch picks up the update.
// Packaged builds ship a frozen vendored copy and skip this.
function refreshVendoredToolsInBackground(): void {
  if (app.isPackaged) {
    return;
  }
  for (const name of ["openwiki", "uv", "skillspector", "browser-skill", "serena", "crg", "bento"]) {
    const script = join(__dirname, "..", "..", "..", "scripts", `vendor-${name}.js`);
    try {
      const child = spawn(process.execPath, [script], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: "ignore",
        detached: process.platform !== "win32",
      });
      child.once("error", () => {
        // Best-effort — the vendored copy stays as-is.
      });
      child.unref();
    } catch {
      // Best-effort — the vendored copy stays as-is.
    }
  }
}

// DeepOrca's bash tool relies on a POSIX shell; on Windows this resolves Git Bash.
process.env.NoDefaultCurrentDirectoryInExePath = "1";
try {
  setShellIfWindows();
} catch (error) {
  // Surfaced later in the UI as a failed bash call rather than crashing at boot.
  console.error("[desktop] shell setup:", error instanceof Error ? error.message : String(error));
}

let mainWindow: BrowserWindow | null = null;

// Dev-only platform override so `npm run desktop:startWin|startMac|startLx` can
// preview another OS's theme + interaction adaptation without a real machine.
// Honored only in an unpackaged (dev) build; production always reports the real OS.
function resolvePlatform(): string {
  if (!app.isPackaged) {
    const override = process.env.DEEPORCA_PLATFORM ?? process.env.DEEPCODE_PLATFORM;
    if (override === "win32" || override === "darwin" || override === "linux") {
      return override;
    }
  }
  return process.platform;
}
let bridge: SessionBridge | null = null;
let pluginManager: PluginManager | null = null;

// Tracked prototype (popout) windows. Module-scoped so the IPC sender policy
// can recognise calls coming from one of them (WindowClose, A2uiAction,
// A2uiRequestPayload are shared between the main renderer and prototype
// windows). Populated by registerA2uiPrototypeWindowIpc; entries removed on
// window close.
const prototypeWindows = new Map<string, BrowserWindow>();

// In-process memory manager (TdaiCore). Held at module scope so the startup
// (whenReady), settings-save, project-switch, and shutdown (before-quit) paths
// can all reach it without going through an IPC handler closure.
let memoryManager: {
  init(): Promise<void>;
  destroy(): Promise<void>;
  isAvailable(): boolean;
  searchMemories(query: string, limit?: number): Promise<{ text: string; total: number } | null>;
  getStats(): Promise<MemoryPipelineStats | null>;
  clearProjectMemory(): Promise<void>;
} | null = null;
let memoryStarting = false;

function emit(channel: string, payload?: unknown): void {
  // Broadcast to every BrowserWindow so popout prototype windows also receive
  // A2UI surface updates (and any other emit-channel event). Each window's
  // renderer is responsible for scoping updates by surfaceId.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

// The initial project root: the most recently active known workspace. Home is
// only a last-resort fallback for a truly fresh install — it must never surface
// as a workspace in the session tree (workspace-registry filters it out).
function resolveInitialRoot(): string {
  try {
    const { workspaces } = listWorkspaceSessions("");
    for (const w of workspaces) {
      try {
        if (statSync(w.root).isDirectory()) {
          return w.root;
        }
      } catch {
        // Stale root (moved/deleted) — try the next workspace.
      }
    }
  } catch {
    // Fall through to home.
  }
  // Use os.homedir() (not app.getPath) so the fallback matches the
  // workspace-registry filter exactly — otherwise home can leak into the tree.
  return homedir();
}

function getBridge(): SessionBridge {
  if (!bridge) {
    bridge = new SessionBridge(resolveInitialRoot(), emit);
  }
  return bridge;
}

function getPluginManager(): PluginManager {
  if (!pluginManager) {
    const b = getBridge();
    pluginManager = new PluginManager(
      () => b.getSessionManager(),
      () => {
        // MCP servers must go through the same disable-filter (readDisabledMcp
        // sidecar) that SessionBridge.initMcp uses, otherwise a disabled server
        // gets re-initialized here and bypasses the user's disable choice.
        return {
          mcpServers: b.getEffectiveMcpServers(),
          enabledSkills: b.getRawSettings().enabledSkills,
        };
      }
    );
    const onEvent: PluginEventCallback = (event) => {
      emit(IpcEvent.PluginEvent, event);
    };
    pluginManager.setOnEvent(onEvent);
    void pluginManager.initialize();
  }
  return pluginManager;
}

function createWindow(): void {
  const isWin = resolvePlatform() === "win32";
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: isWin ? "#1d1d1d" : "#e7ecf2",
    title: "DeepOrca",
    autoHideMenuBar: true,
    // frame:false 已隐藏原生标题栏和红绿灯(macOS)/标题栏(Windows)。
    // 不再设置 titleBarStyle — 它会导致 macOS 原生 traffic lights 仍然显示。
    frame: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Disable spellcheck — this is a coding tool, not a word processor.
      // Hunspell dictionary loading and per-keystroke analysis waste CPU/memory.
      spellcheck: false,
    },
  });

  void mainWindow.loadFile(join(__dirname, "renderer/index.html"));

  // Rasterize + apply the orca brand icon (window/taskbar/dock). Best-effort.
  void applyAppIcon(mainWindow);

  // ── Security: prevent the privileged window from navigating away from the
  // packaged renderer. The preload exposes file/settings/Git/MCP capabilities
  // through window.deeporca; if a document we rendered (e.g. model markdown
  // containing a link) could navigate this window to another page — local or
  // remote — that page would inherit the full privileged bridge. Block all
  // top-level navigation to anything other than our own renderer file (or the
  // configured dev origin in development).
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (rendererPolicy.isAllowedRendererNavigationUrl(url)) {
      return;
    }
    event.preventDefault();
    // External http(s) links open in the user's browser, not in our window.
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
  });
  // window.open / target=_blank: never allow a child privileged window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── In-process memory lifecycle (module-scoped) ─────────────────────────────
// These run on app startup, settings save, project switch, and shutdown — not
// just from IPC handlers — so they live at module scope.

async function startMemory(): Promise<{ ok: boolean; error?: string }> {
  if (memoryManager?.isAvailable()) return { ok: true };
  if (memoryStarting) return { ok: true };
  memoryStarting = true;

  try {
    const settings = resolveCurrentSettings(getBridge().projectRoot);
    if (!settings.apiKey) {
      return { ok: false, error: "LLM API key is required for memory extraction." };
    }

    // Dynamically import @deeporca/memory (avoids hard dep if not installed).
    const { MemoryManager } = await import("@deeporca/memory");
    // Vendored Granite model path (HF mirror layout) for embedding provider "local-onnx".
    const graniteModelDir = join(__dirname, "..", "vendor", "granite-embedding");
    // Project-scoped data dir: each project gets its own memory store so a
    // secret/fact learned in project A cannot be recalled while working in
    // project B. Earlier code used a single global dir (~/.deeporca/memory)
    // for every project — a cross-project data-leak vector.
    const dataDir = join(getUserConfigRoot(), "memory", getProjectCode(getBridge().projectRoot));
    const mgr = new MemoryManager({
      baseUrl: settings.baseURL,
      apiKey: settings.apiKey,
      model: settings.secondaryModel || "deepseek-v4-flash",
      dataDir,
      workspaceDir: getBridge().projectRoot,
      // Embedding provider: "local-onnx" enables Granite vector recall (hybrid
      // vector+keyword). "none" (default) keeps keyword-only (BM25/FTS). The
      // model starts in the background via startWarmup() — non-blocking.
      embedding: settings.memory?.embedding === "local-onnx" ? { provider: "local-onnx" } : { provider: "none" },
      // Vendored Granite model path (HF mirror layout).
      graniteModelDir: settings.memory?.embedding === "local-onnx" ? graniteModelDir : undefined,
    });
    await mgr.init();
    memoryManager = mgr;
    getBridge().setMemoryProvider(mgr as unknown as MemoryProvider);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    memoryStarting = false;
  }
}

async function stopMemory(): Promise<void> {
  if (memoryManager) {
    await memoryManager.destroy();
    memoryManager = null;
  }
  getBridge().setMemoryProvider(null);
}

/**
 * Idempotently reconcile the in-process memory pipeline with the resolved
 * `settings.memory.enabled` value. Called on app startup and after every
 * settings save — the renderer's checkbox only edits the draft, so without
 * this, enabling memory and saving did nothing (the manager stayed null and
 * memory was silently off forever).
 *
 * Also handles project switches: startMemory() derives a project-scoped
 * dataDir, so when the project root changes the caller stops the old manager
 * first (see SetProjectRoot) and reconcile starts a fresh one.
 */
async function reconcileMemory(): Promise<{ ok: boolean; error?: string }> {
  const settings = resolveCurrentSettings(getBridge().projectRoot);
  const wantEnabled = !!settings.memory?.enabled;
  const isRunning = !!memoryManager?.isAvailable();
  if (wantEnabled === isRunning) {
    // Already in the desired state. But still (re)bind the provider on the
    // current SessionManager — reload()/setProjectRoot() recreate the manager
    // and lose the provider binding even when the manager object is unchanged.
    if (wantEnabled && memoryManager) {
      getBridge().setMemoryProvider(memoryManager as unknown as MemoryProvider);
    }
    return { ok: true };
  }
  return wantEnabled ? startMemory() : stopMemory().then(() => ({ ok: true }));
}

/**
 * The channel registrars shared by every domain registrar below.
 *
 * Sender-authorization tiers (each layer adds a check; never relaxes one):
 *  - `handle`          : main renderer only. The default — every channel that
 *                        is not explicitly prototype-shared must prove it came
 *                        from the privileged main window's main frame. This
 *                        closes the "read-only channels leak data" hole: even
 *                        though e.g. SettingsGet does not mutate state, an
 *                        unauthorized page must not be able to read settings.
 *  - `handlePrivileged`: main renderer only + audit log. Use for channels that
 *                        mutate the filesystem, settings, Git state, MCP
 *                        config, run external processes, or perform destructive
 *                        index operations. The sender check is the same as
 *                        `handle`; the wrapper additionally logs the call so
 *                        high-risk actions are traceable.
 *  - `handleShared`    : main renderer OR a tracked prototype window. Reserved
 *                        for the three channels the prototype preload exposes
 *                        (WindowClose, A2uiAction, A2uiRequestPayload).
 *
 * Never add a new channel that calls raw `ipcMain.handle` — pick one of these
 * three so sender authorization stays uniform. The ipc-contract test enforces
 * that every IpcRequest is reachable through one of these tiers.
 */
type IpcHelpers = {
  handle: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  handleShared: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
};

function createIpcHelpers(): IpcHelpers {
  // Uniform error normalization: log main-side failures with their channel and
  // rethrow a clean Error so the renderer receives a readable message instead
  // of an opaque serialized rejection.
  const handle = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertMainRenderer(event, channel);
        return await fn(...(args as never[]));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ipc] ${channel} failed:`, message);
        throw new Error(`${channel}: ${message}`);
      }
    });
  };
  // Privileged variant: same main-renderer check as `handle`, plus an audit
  // log line for high-risk mutations (filesystem, settings, Git, MCP config,
  // external process spawn, destructive index ops).
  const handlePrivileged = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertMainRenderer(event, channel);
        console.log(`[ipc:privileged] ${channel} from main renderer`);
        return await fn(...(args as never[]));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ipc] ${channel} failed:`, message);
        throw new Error(`${channel}: ${message}`);
      }
    });
  };
  // Shared variant: the call may come from the main renderer OR a tracked
  // prototype window. Used only for the three channels the prototype preload
  // exposes (WindowClose, A2uiAction, A2uiRequestPayload).
  const handleShared = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertMainOrPrototypeRenderer(event, channel);
        return await fn(...(args as never[]));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ipc] ${channel} failed:`, message);
        throw new Error(`${channel}: ${message}`);
      }
    });
  };
  return { handle, handlePrivileged, handleShared };
}

function registerCoreIpc({ handle, handlePrivileged, handleShared }: IpcHelpers): void {
  handle(IpcRequest.Ready, () => ({
    projectRoot: getBridge().projectRoot,
    platform: resolvePlatform(),
    homeDir: homedir(),
  }));
  handle(IpcRequest.GetProjectRoot, () => getBridge().projectRoot);

  handle(IpcRequest.WindowMinimize, () => {
    mainWindow?.minimize();
  });
  handle(IpcRequest.WindowToggleMaximize, () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  // WindowClose is shared with prototype popout windows (their title-bar
  // close button calls the same channel via the prototype preload). Minimize
  // and maximize are main-renderer only — prototype windows don't expose them.
  handleShared(IpcRequest.WindowClose, () => {
    mainWindow?.close();
  });

  handle(IpcRequest.PickFolder, async () => {
    if (!mainWindow) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select project folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });

  handlePrivileged(IpcRequest.SetProjectRoot, async (root: string) => {
    // Memory uses a project-scoped dataDir, so switching projects must stop the
    // old manager (flushing its SQLite/checkpoint state) before the bridge
    // swaps roots. reconcileMemory() then starts a fresh manager for the new
    // project when memory is enabled.
    await stopMemory();
    getBridge().setProjectRoot(root);
    emit(IpcEvent.ProjectRootChanged, getBridge().projectRoot);
    void reconcileMemory();
    return { projectRoot: getBridge().projectRoot };
  });

  handle(IpcRequest.SessionList, () => getBridge().listSessions());
  handle(IpcRequest.SessionGet, (id: string) => getBridge().getSession(id));
  handle(IpcRequest.SessionMessages, (id: string) => getBridge().listMessages(id));
  handlePrivileged(IpcRequest.SessionSetActive, (id: string | null) => getBridge().setActiveSession(id));
  handle(IpcRequest.SessionGetActive, () => getBridge().getActiveSession());
  handlePrivileged(IpcRequest.SessionDelete, (id: string) => getBridge().deleteSession(id));
  handlePrivileged(IpcRequest.SessionRename, (id: string, summary: string) => getBridge().renameSession(id, summary));

  handlePrivileged(IpcRequest.PromptSend, async (prompt: UserPromptContent) => {
    try {
      await getBridge().sendPrompt(prompt);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  handlePrivileged(IpcRequest.PromptInterrupt, () => getBridge().interrupt());
  handlePrivileged(IpcRequest.PromptPause, () => getBridge().pause());
  handlePrivileged(IpcRequest.PromptResume, async (sessionId: string) => {
    try {
      await getBridge().resume(sessionId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  handlePrivileged(IpcRequest.PromptEnhance, async (text: string) => {
    try {
      const enhanced = await getBridge().enhancePrompt(text);
      return { ok: true, text: enhanced };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  // PermissionDeny and AdjustBashTimeout mutate live agent/permission state
  // (denyPermission is terminal and flushes session persistence).
  handlePrivileged(IpcRequest.PermissionDeny, (reason?: string) => getBridge().denyPermission(reason));
  handlePrivileged(IpcRequest.AdjustBashTimeout, (deltaMs: number) => getBridge().adjustBashTimeout(deltaMs));

  handle(IpcRequest.SkillsList, (sessionId?: string) => getPluginManager().listSkills(sessionId));
  handle(IpcRequest.SettingsGet, () => getBridge().getSettings());
  handle(IpcRequest.SettingsGetEditable, () => getBridge().getEditableSettings());
  handlePrivileged(IpcRequest.SettingsUpdate, (patch: EditableSettings) => {
    const result = getBridge().updateSettings(patch);
    // Reconcile memory (start/stop) after a settings save — the renderer's
    // checkbox only edits the draft, so the runtime state must be re-derived
    // from the now-persisted settings.memory.enabled value. Fire-and-forget:
    // the save itself has already succeeded synchronously.
    void reconcileMemory();
    return result;
  });
  handlePrivileged(IpcRequest.ModelSet, (selection: ModelConfigSelection) => getBridge().setModel(selection));

  handle(IpcRequest.McpStatus, () => getPluginManager().getMcpStatus());
  // McpReconnect spawns/restarts MCP server processes.
  handlePrivileged(IpcRequest.McpReconnect, (name: string) => getPluginManager().reconnectMcp(name));

  handle(IpcRequest.UndoList, (sessionId: string) => getBridge().listUndoTargets(sessionId));
  handlePrivileged(IpcRequest.UndoRestore, (sessionId: string, messageId: string, mode: UndoRestoreMode) => {
    try {
      getBridge().restoreUndo(sessionId, messageId, mode);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function registerPluginsIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── Plugin IPC handlers ───────────────────────────────────────────────────
  handle(IpcRequest.PluginSearchSkills, (query: string, sessionId?: string) =>
    getPluginManager().searchSkills(query, sessionId)
  );
  handle(IpcRequest.PluginRefreshSkills, (sessionId?: string) => getPluginManager().refreshSkills(sessionId));
  handle(IpcRequest.PluginReadSkillDoc, (path: string, locale?: string) =>
    getPluginManager().readSkillDoc(path, locale)
  );
  // PluginUpsertMcpServer persists MCP server config (name/command/args/env)
  // to settings and reloads the bridge, which spawns the configured MCP child
  // process. This is the highest-blast-radius channel in the app — a malicious
  // renderer could otherwise persist an arbitrary command as an MCP server and
  // have it executed by the main process. It MUST be privileged.
  handlePrivileged(
    IpcRequest.PluginUpsertMcpServer,
    (name: string, command: string, args?: string[], env?: Record<string, string>) =>
      getBridge().pluginUpsertMcpServer(name, command, args, env)
  );
  handlePrivileged(IpcRequest.PluginRemoveMcpServer, (name: string) => getBridge().pluginRemoveMcpServer(name));
  handle(IpcRequest.PluginBuiltinList, () => getBridge().pluginBuiltinList());
  handle(IpcRequest.PluginBuiltinReadDoc, (name: string, locale?: string) =>
    getBridge().pluginBuiltinReadDoc(name, locale)
  );
  handle(IpcRequest.PluginBuiltinGroups, () => getBridge().pluginBuiltinGroups());
}

function registerFileScannerIpc({ handle }: IpcHelpers): void {
  // ── File scanner (for @file mentions) ────────────────────────────────────
  handle(IpcRequest.ScanFiles, (query: string) => {
    return scanFiles(getBridge().projectRoot, query);
  });
}

function registerWorkspaceIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── Workspace-grouped sessions + archive ──────────────────────────────────
  handle(IpcRequest.WorkspaceListSessions, () => listWorkspaceSessions(getBridge().projectRoot));
  handlePrivileged(IpcRequest.SessionArchive, (id: string) => {
    archiveSession(id);
  });
  handlePrivileged(IpcRequest.SessionUnarchive, (id: string) => {
    unarchiveSession(id);
  });
}

function registerGitIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── Git source control ────────────────────────────────────────────────────
  handle(IpcRequest.GitStatus, () => getBridge().gitStatus());
  handlePrivileged(IpcRequest.GitStage, (file: string) => getBridge().gitStage(file));
  handlePrivileged(IpcRequest.GitUnstage, (file: string) => getBridge().gitUnstage(file));
  handlePrivileged(IpcRequest.GitDiscard, (file: string) => getBridge().gitDiscard(file));
  handlePrivileged(IpcRequest.GitCommit, (message: string) => getBridge().gitCommit(message));
  handle(IpcRequest.GitCurrentBranch, () => getBridge().gitCurrentBranch());
  handle(IpcRequest.GitListBranches, () => getBridge().gitListBranches());
  handlePrivileged(IpcRequest.GitCheckout, (branch: string) => getBridge().gitCheckout(branch));
  handlePrivileged(IpcRequest.GitStashCheckout, (branch: string) => getBridge().gitStashCheckout(branch));
  handle(IpcRequest.GitDiff, (file: string, staged: boolean) => getBridge().gitDiff(file, staged));
  handle(IpcRequest.GitLog, (limit?: number) => getBridge().gitLog(limit));
  handle(IpcRequest.GitCommitDiff, (hash: string, file?: string) => getBridge().gitCommitDiff(hash, file));
  handle(IpcRequest.GitCommitFiles, (hash: string) => getBridge().gitCommitFiles(hash));
}

function registerCodegraphIpc({ handle }: IpcHelpers): void {
  // ── CodeGraph index library ───────────────────────────────────────────────
  // Legacy IPC for the IndexLibraryPanel status dot. The build button now uses
  // api.actionRun("index.build-all"); this handler only serves the status check.
  handle(IpcRequest.CodegraphList, (): CodegraphIndexEntry[] => {
    const currentRoot = getBridge().projectRoot;
    if (!currentRoot) return [];
    const initialized = existsSync(join(currentRoot, ".codegraph"));
    return [
      {
        root: currentRoot,
        label: currentRoot.split("/").pop() || currentRoot,
        initialized,
      },
    ];
  });
  // codegraph:reindex now delegates to the action system (index.build-all or
  // codegraph.reindex action). The old privileged handler is removed.
}

// OCR resolution moved to OcrCliController — this file no longer needs
// resolveOcrCommand (the controller class handles it internally).

// OPENWIKI_VENDOR_ENTRY is defined at the top of this file (near boot config).

// Legacy registerCodeReviewIpc removed — CodeReviewPanel now uses review.full
// action via api.actionRun(). The OcrCliController handles all OCR spawning.

function registerCrgIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── code-review-graph (CRG — analysis-layer via uv/uvx) ────────────────────
  // CRG is a Python tool. We run it via `uv tool run` (uvx), which auto-provisions
  // an isolated Python 3.12 environment. The vendored uv binary (packages/desktop/
  // vendor/uv) is preferred; when absent, a system `uv`/`uvx` on PATH is used.

  handle(IpcRequest.CrgCheckAvailable, (): Promise<{ available: boolean; version?: string }> => {
    return new Promise((resolve) => {
      const uvBin = resolveUvBinary();
      if (!uvBin) {
        resolve({ available: false });
        return;
      }
      // Probe uv version first — if uv works, uvx can run CRG.
      execFile(uvBin, ["--version"], { timeout: 10000 }, (err, stdout) => {
        if (err) {
          resolve({ available: false });
          return;
        }
        resolve({ available: true, version: stdout.trim().split("\n")[0] });
      });
    });
  });

  handle(IpcRequest.CrgList, (): CrgIndexEntry[] => {
    const { workspaces } = listWorkspaceSessions(getBridge().projectRoot);
    return workspaces.map((w) => ({
      root: w.root,
      label: w.label,
      hasGraph: hasCrgProject(w.root),
    }));
  });

  handlePrivileged(IpcRequest.CrgReindex, async (_rootFromRenderer: string) => {
    // Derive the workspace root server-side. Earlier code trusted a renderer-
    // supplied root and recursively removed .code-review-graph under it.
    const root = getBridge().projectRoot;
    const exitCode = await runCrgResetWithOutput(root, (chunk: string, stream: "stdout" | "stderr") => {
      emit(IpcEvent.CrgProgress, { root, chunk, stream, done: false });
    });
    emit(IpcEvent.CrgProgress, { root, chunk: "", stream: "stdout", done: true, exitCode });
    return {
      ok: exitCode === 0,
      action: "reset" as const,
      error: exitCode !== 0 ? `exit code ${exitCode}` : undefined,
    };
  });

  handle(IpcRequest.CrgVisualize, async (): Promise<{ html: string | null; error?: string }> => {
    const root = getBridge().projectRoot;
    if (!root) return { html: null, error: "No project open" };
    const html = await runCrgVisualize(root);
    return { html, error: html ? undefined : "Visualization failed — is the graph built?" };
  });
}

function registerMemoryIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── Memory (in-process @deeporca/memory) ─────────────────────────────────
  // Memory runs as an in-process pipeline (TdaiCore), not an HTTP sidecar.
  // The MemoryManager is initialized from settings when memory is enabled.
  // (startMemory/stopMemory/reconcileMemory are module-scoped so the startup,
  // settings-save, project-switch, and shutdown paths can reach them.)

  handle(IpcRequest.MemoryCheckAvailable, async (): Promise<{ available: boolean; healthy: boolean }> => {
    return { available: !!memoryManager, healthy: memoryManager?.isAvailable() ?? false };
  });

  handlePrivileged(IpcRequest.MemorySetEnabled, async (enabled: boolean): Promise<{ ok: boolean; error?: string }> => {
    if (enabled) {
      return startMemory();
    }
    await stopMemory();
    return { ok: true };
  });

  handle(IpcRequest.MemorySearch, async (query: string, limit?: number): Promise<{ text: string; total: number }> => {
    if (!memoryManager) return { text: "", total: 0 };
    return (await memoryManager.searchMemories(query, limit ?? 5)) ?? { text: "", total: 0 };
  });

  handle(IpcRequest.MemoryStats, async (): Promise<MemoryPipelineStats | null> => {
    if (!memoryManager) return null;
    return memoryManager.getStats();
  });

  handlePrivileged(IpcRequest.MemoryClear, async (): Promise<{ ok: boolean; error?: string }> => {
    if (!memoryManager) return { ok: false, error: "Memory pipeline not running" };
    try {
      await memoryManager.clearProjectMemory();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Aggregate the status of every knowledge source for the dashboard. Each probe
 * is best-effort and independent — a failing source degrades to "empty" rather
 * than failing the whole response.
 */
function registerKnowledgeIpc({ handle }: IpcHelpers): void {
  handle(IpcRequest.KnowledgeStatus, async (): Promise<KnowledgeStatusResponse> => {
    const root = getBridge().projectRoot;
    const freshness = getBridge().getKnowledgeFreshness?.() ?? {};
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

    // CodeGraph — .codegraph/ presence + staleness.
    const cgDir = join(root, ".codegraph");
    const codegraph: KnowledgeSourceStatus = existsSync(cgDir)
      ? {
          state: isStale(freshness.codegraphSync) ? "stale" : "indexed",
          lastSync: freshness.codegraphSync,
          detail: ".codegraph/",
        }
      : { state: "empty", detail: "未构建" };

    // OpenWiki — page count under openwiki/ (recursive for modules/ + workflows/).
    const wikiDir = join(root, "openwiki");
    let wikiPages = 0;
    if (existsSync(wikiDir)) {
      wikiPages = countDirFiles(wikiDir, (n) => n.endsWith(".md"));
      for (const sub of ["modules", "workflows"]) {
        wikiPages += countDirFiles(join(wikiDir, sub), (n) => n.endsWith(".md"));
      }
    }
    const openwiki: KnowledgeSourceStatus = existsSync(wikiDir)
      ? {
          state: wikiPages === 0 ? "empty" : isStale(freshness.wikiSync) ? "stale" : "indexed",
          count: wikiPages,
          unit: "页",
          lastSync: freshness.wikiSync,
        }
      : { state: "empty", detail: "未构建" };

    // Serena — memory file count under .serena/memories/.
    const serenaMemDir = join(root, ".serena", "memories");
    const serenaCount = countDirFiles(serenaMemDir, (n) => n.endsWith(".md"));
    const serena: KnowledgeSourceStatus = existsSync(join(root, ".serena"))
      ? { state: serenaCount === 0 ? "empty" : "indexed", count: serenaCount, unit: "条", detail: ".serena/memories/" }
      : { state: "empty", detail: "未初始化" };

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

    // Memory — pipeline availability + L0-L3 stats.
    const memStats = memoryManager ? await memoryManager.getStats() : null;
    const memory: KnowledgeSourceStatus & { stats?: MemoryPipelineStats } = memoryManager?.isAvailable()
      ? {
          state: memStats && memStats.l0 > 0 ? "indexed" : "empty",
          count: memStats?.l1 ?? 0,
          unit: "天",
          detail: memStats?.l3 ? "L0-L3 全链路" : "L0-L2",
          stats: memStats ?? undefined,
        }
      : { state: "disabled", detail: "未启用" };

    return { codegraph, openwiki, serena, agents, memory };
  });
}

/** Designer artifact management — bridges the renderer to design-store. */
function registerDesignIpc({ handle }: IpcHelpers): void {
  handle(IpcRequest.DesignList, async () => {
    return listDesignArtifacts(getBridge().projectRoot);
  });

  handle(IpcRequest.DesignRead, async (id: string) => {
    return readDesignArtifact(getBridge().projectRoot, id);
  });

  handle(IpcRequest.DesignDelete, async (id: string) => {
    return deleteDesignArtifact(getBridge().projectRoot, id);
  });

  // Form-state persistence targets the LATEST artifact of the pipeline — the
  // live preview always shows the most recent prototype/document, so the
  // renderer never needs to know artifact ids.
  const latestArtifactId = (pipeline: DesignPipeline): string | null => {
    return listDesignArtifacts(getBridge().projectRoot).find((a) => a.pipeline === pipeline)?.id ?? null;
  };

  handle(IpcRequest.DesignSaveFormState, async (pipeline: DesignPipeline, state: Record<string, unknown>) => {
    const id = latestArtifactId(pipeline);
    return id ? saveFormState(getBridge().projectRoot, id, state) : false;
  });

  handle(IpcRequest.DesignReadFormState, async (pipeline: DesignPipeline) => {
    const id = latestArtifactId(pipeline);
    return id ? readFormState(getBridge().projectRoot, id) : null;
  });
}

function registerA2uiIpc({ handleShared }: IpcHelpers): void {
  // ── A2UI (Surface user interaction → agent) ──────────────────────────────
  // When the user clicks a button on an A2UI Surface, the renderer calls
  // this handler. We forward it as an MCP tool call (a2ui_action) to the
  // A2UI MCP server, which the agent receives as a tool result. Callable from
  // the main renderer OR a prototype popout window (both can host a Surface).
  handleShared(
    IpcRequest.A2uiAction,
    async (
      surfaceId: string,
      actionName: string,
      context: Record<string, unknown>
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const bridge = getBridge();
        // Call the A2UI MCP server's a2ui_action tool via the session manager.
        const result = (await bridge.callMcpTool("a2ui", "a2ui_action", { surfaceId, actionName, context })) as {
          ok: boolean;
          output?: string;
          metadata?: { a2ui?: string };
        };
        // If the action produced updated A2UI messages (e.g. navigate: page switch),
        // push them to the renderer so the Surface refreshes in real-time.
        if (result?.metadata?.a2ui) {
          emit(IpcEvent.A2uiSurfaceUpdate, { a2uiJson: result.metadata.a2ui, surfaceId });
        }
        return { ok: !!result?.ok, error: result?.ok ? undefined : "a2ui_action returned an error" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[a2ui-action]", message);
        // Earlier code swallowed the error and resolved the IPC promise as
        // success (void), so the renderer never learned the action failed and
        // the user got no feedback. Return a structured error instead.
        return { ok: false, error: message };
      }
    }
  );
}

function registerA2uiPrototypeWindowIpc({ handleShared, handlePrivileged }: IpcHelpers): void {
  // ── A2UI standalone prototype window ──────────────────────────────────────
  // Opens a separate Electron BrowserWindow with the prototype Surface at
  // full screen — useful for PM presentations or focused prototype testing.
  // `prototypeWindows` is module-scoped so the IPC sender policy can recognise
  // calls coming from a prototype window (the three handleShared channels).
  // Pending payloads keyed by window token, consumed via A2uiRequestPayload
  // (pull handshake) so the renderer fetches its payload on mount instead of
  // depending on a did-finish-load push that can fire before React subscribes.
  const prototypePayloads = new Map<string, { a2uiJson: string; title: string }>();
  // Opening a prototype window is a privileged main-renderer action (it spawns
  // a new BrowserWindow); it must NOT be callable from a prototype window or
  // any other sender.
  handlePrivileged(IpcRequest.A2uiOpenWindow, async (a2uiJson: string, title: string): Promise<void> => {
    const winId = `proto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Store the payload up front so the pull handshake can return it even if
    // the push (kept for back-compat) races the subscription.
    prototypePayloads.set(winId, { a2uiJson, title });
    const protoWin = new BrowserWindow({
      width: 1024,
      height: 720,
      title: title || "Prototype Preview",
      autoHideMenuBar: true,
      frame: false,
      webPreferences: {
        // Minimal preload: prototype surfaces only need the A2UI payload/update
        // + action + window-close surface. Using the full preload.cjs here would
        // expose file/settings/Git/MCP/prompt capabilities to the prototype page.
        preload: join(__dirname, "prototype.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    prototypeWindows.set(winId, protoWin);
    protoWin.on("closed", () => {
      prototypeWindows.delete(winId);
      prototypePayloads.delete(winId);
    });
    // Same navigation hardening as the main window: a prototype surface must
    // never navigate to a remote page. The renderer file URL with query params
    // (view=prototype&token=…) is allowed; everything else is blocked.
    protoWin.webContents.on("will-navigate", (event, url) => {
      if (rendererPolicy.isAllowedRendererNavigationUrl(url)) return;
      event.preventDefault();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
    });
    protoWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
    // Push (kept for back-compat). The renderer ALSO pulls via
    // A2uiRequestPayload on mount, which is the race-free path.
    const sendPayload = (): void => {
      protoWin.webContents.send(IpcEvent.A2uiWindowPayload, { a2uiJson, title });
    };
    protoWin.webContents.once("did-finish-load", sendPayload);
    // Load renderer with query params so it knows it's a prototype window AND
    // which token to pull its payload by.
    await protoWin.loadFile(join(__dirname, "renderer/index.html"), {
      query: { view: "prototype", token: winId },
    });
    if (!protoWin.isDestroyed()) {
      sendPayload();
    }
  });

  // Pull handshake: the prototype renderer requests its payload by token on
  // mount. Returns null if the token is unknown (e.g. already consumed/closed).
  // Callable from a prototype window (the normal path) or the main renderer.
  handleShared(IpcRequest.A2uiRequestPayload, (token: string): { a2uiJson: string; title: string } | null => {
    return prototypePayloads.get(token) ?? null;
  });
}

function registerWikiIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── Wiki knowledge graph (openwiki — vendored Node CLI) ────────────────────
  // OpenWiki is a TypeScript CLI (langchain-ai/openwiki). We vendor it at build
  // time (scripts/vendor-openwiki.js → packages/desktop/vendor/openwiki) and run
  // it as a built-in command through the bundled Node (Electron ≥43 ships Node
  // 24+, which satisfies OpenWiki's require(esm) engines floor). The tool is
  // reported unavailable when the vendored build is missing — never reaching for
  // an external runtime.
  // Dedicated wiki agent model strategy: flash-first, pro-fallback.
  const WIKI_MODEL_FLASH = "deepseek-v4-flash";
  const WIKI_MODEL_PRO = "deepseek-v4-pro";

  /**
   * Resolve how to invoke openwiki. Internal plugins must stay self-contained:
   * the vendored entry runs through the bundled Node (Electron ≥35 ships
   * Node 22.14+), never the host's external Node/npm. Returns null when the
   * vendored entry or a suitable runtime is missing — the UI then reports the
   * tool as unavailable rather than reaching for an external `npx`.
   */
  const resolveOpenwikiCommand = (): {
    command: string;
    prefixArgs: string[];
    env?: Record<string, string>;
  } | null => {
    try {
      if (statSync(OPENWIKI_VENDOR_ENTRY).isFile()) {
        const node = resolveModernNode(22);
        if (node) {
          // When the runtime is Electron itself, ELECTRON_RUN_AS_NODE makes its
          // bundled Node execute the entry like plain `node entry.js`.
          const env = node === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : undefined;
          return { command: node, prefixArgs: [OPENWIKI_VENDOR_ENTRY], env };
        }
      }
    } catch {
      // Vendored entry not present.
    }
    return null;
  };

  handle(IpcRequest.WikiCheckAvailable, (): Promise<{ available: boolean; version?: string }> => {
    return new Promise((resolve) => {
      const resolved = resolveOpenwikiCommand();
      if (!resolved) {
        resolve({ available: false });
        return;
      }
      const { command, prefixArgs, env } = resolved;
      const execEnv = env ? { ...(process.env as Record<string, string>), ...env } : undefined;
      execFile(command, [...prefixArgs, "--version"], { timeout: 10000, env: execEnv }, (err, stdout) => {
        if (!err) {
          resolve({ available: true, version: stdout.trim().split("\n")[0] });
        } else {
          // A vendored build counts as available even when --version probing fails.
          resolve({ available: true });
        }
      });
    });
  });

  /**
   * Spawn openwiki with the wiki agent's model strategy:
   * 1. Try flash model (fast/cheap) first
   * 2. If flash fails (model unavailable), fall back to pro
   * Passes the user's LLM credentials so openwiki uses the same endpoint.
   */
  const runWikiAgent = (args: string[]): Promise<{ ok: boolean; error?: string }> => {
    const settings = resolveCurrentSettings(getBridge().projectRoot);
    // Capture the workspace root once so every progress event carries it —
    // lets the panel filter out stale events from a previous workspace.
    const root = getBridge().projectRoot;
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (settings.apiKey) env.OPENAI_API_KEY = settings.apiKey;
    if (settings.baseURL) env.OPENAI_BASE_URL = settings.baseURL;

    const spawnWith = (model: string): Promise<{ ok: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const resolved = resolveOpenwikiCommand();
        if (!resolved) {
          resolve({ ok: false, error: "OpenWiki is not bundled with this build." });
          return;
        }
        try {
          const { command, prefixArgs, env: exeEnv } = resolved;
          const cp = spawn(command, [...prefixArgs, ...args, "--model", model], {
            cwd: root,
            env: { ...env, ...exeEnv, OPENWIKI_MODEL: model },
          });
          trackHelperProcess(cp);
          cp.stdout?.on("data", (d: Buffer) => {
            emit(IpcEvent.WikiProgress, { root, chunk: d.toString(), stream: "stdout", done: false });
          });
          cp.stderr?.on("data", (d: Buffer) => {
            emit(IpcEvent.WikiProgress, { root, chunk: d.toString(), stream: "stderr", done: false });
          });
          cp.on("error", (err) => {
            resolve({ ok: false, error: `Failed to start openwiki: ${err.message}` });
          });
          cp.on("close", (code) => {
            resolve({ ok: code === 0, error: code !== 0 ? `exit code ${code}` : undefined });
          });
        } catch (err) {
          resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
    };

    return (async () => {
      // Phase 1: try flash model
      emit(IpcEvent.WikiProgress, {
        root,
        chunk: `[wiki-agent] model: ${WIKI_MODEL_FLASH}\n`,
        stream: "stdout",
        done: false,
      });
      const flashResult = await spawnWith(WIKI_MODEL_FLASH);
      if (flashResult.ok) {
        emit(IpcEvent.WikiProgress, { root, chunk: "", stream: "stdout", done: true, exitCode: 0 });
        return flashResult;
      }
      // Phase 2: flash failed, fall back to pro
      emit(IpcEvent.WikiProgress, {
        root,
        chunk: `[wiki-agent] flash unavailable, falling back to ${WIKI_MODEL_PRO}\n`,
        stream: "stderr",
        done: false,
      });
      const proResult = await spawnWith(WIKI_MODEL_PRO);
      emit(IpcEvent.WikiProgress, { root, chunk: "", stream: "stdout", done: true, exitCode: proResult.ok ? 0 : 1 });
      return proResult;
    })();
  };

  // WikiInit/Update spawn the openwiki agent against the current project and
  // write to <project>/openwiki/.
  handlePrivileged(IpcRequest.WikiInit, () => runWikiAgent(["--init"]));
  handlePrivileged(IpcRequest.WikiUpdate, () => runWikiAgent(["--update"]));

  handle(IpcRequest.WikiListPages, async (): Promise<WikiPageEntry[]> => {
    const wikiDir = join(getBridge().projectRoot, "openwiki");
    try {
      const entries: WikiPageEntry[] = [];
      const walk = async (dir: string, prefix: string): Promise<void> => {
        const items = await readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const rel = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.isDirectory()) {
            await walk(join(dir, item.name), rel);
          } else if (item.name.endsWith(".md")) {
            const title = item.name.replace(/\.md$/, "").replace(/[-_]/g, " ");
            entries.push({ path: rel, title: title.charAt(0).toUpperCase() + title.slice(1) });
          }
        }
      };
      await walk(wikiDir, "");
      entries.sort((a, b) => a.path.localeCompare(b.path));
      return entries;
    } catch {
      return [];
    }
  });

  handle(IpcRequest.WikiReadPage, async (pagePath: string): Promise<string> => {
    // Containment: page must be a strictly-relative .md file under
    // <project>/openwiki, with no symlink/junction escape. The previous
    // string-only `normalize + regex strip ../` guard was defeated by absolute
    // paths, drive letters, UNC paths, and symlinks inside openwiki/. The
    // shared safeWikiPath uses the same lexical + realpath containment that
    // editor-handlers uses, and additionally restricts to .md files.
    const wikiRoot = join(getBridge().projectRoot, "openwiki");
    const check = safeWikiPath(wikiRoot, pagePath);
    if (!check.ok) {
      // Surface the rejection in the main log so an attack or a bug is
      // diagnosable. The IPC return stays the existing "" for back-compat.
      console.warn(`[wiki:readPage] rejected path (${check.reason}): ${pagePath}`);
      return "";
    }
    try {
      const fileStat = await stat(check.absPath);
      if (!fileStat.isFile()) {
        // A directory or special file masquerading as a .md page.
        console.warn(`[wiki:readPage] not a regular file: ${pagePath}`);
        return "";
      }
      // Cap read size (2 MB) so a pathological page can't exhaust memory.
      if (fileStat.size > 2 * 1024 * 1024) {
        console.warn(`[wiki:readPage] page too large (${fileStat.size} bytes): ${pagePath}`);
        return "";
      }
      return await readFile(check.absPath, "utf-8");
    } catch (err) {
      console.warn(`[wiki:readPage] read failed: ${err instanceof Error ? err.message : String(err)}`);
      return "";
    }
  });
}

function registerMcpManagementIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── MCP management (plugin module) ────────────────────────────────────────
  handle(IpcRequest.PluginMcpList, () => getBridge().pluginMcpList());
  handlePrivileged(IpcRequest.PluginSetMcpEnabled, (name: string, enabled: boolean) =>
    getBridge().pluginSetMcpEnabled(name, enabled)
  );
}

function registerGitmcpIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── GitMCP module ──────────────────────────────────────────────────────
  handle(IpcRequest.GitmcpList, () => getBridge().gitmcpList());
  handlePrivileged(IpcRequest.GitmcpAdd, (input: string) => getBridge().gitmcpAdd(input));
  handlePrivileged(IpcRequest.GitmcpRemove, (slug: string) => getBridge().gitmcpRemove(slug));
  handlePrivileged(IpcRequest.GitmcpReindex, (slug: string) => getBridge().gitmcpReindex(slug));
}

function registerEditorIpc({ handle, handlePrivileged }: IpcHelpers): void {
  // ── Editor module ───────────────────────────────────────────────────────
  handle(IpcRequest.EditorReadFile, (filePath: string) => handleEditorReadFile(getBridge().projectRoot, filePath));
  handlePrivileged(IpcRequest.EditorWriteFile, (filePath: string, content: string) =>
    handleEditorWriteFile(getBridge().projectRoot, filePath, content)
  );
  handle(IpcRequest.EditorListFiles, (dirPath: string) => handleEditorListFiles(getBridge().projectRoot, dirPath));
}

function registerAgentChangesIpc({ handle }: IpcHelpers): void {
  // ── Agent changes ─────────────────────────────────────────────────────────
  handle(IpcRequest.AgentChangesList, (sessionId: string) => getBridge().agentChangesList(sessionId));
  handle(IpcRequest.AgentChangesDiff, (sessionId: string, file: string) =>
    getBridge().agentChangesDiff(sessionId, file)
  );
}

function registerSessionExportIpc({ handlePrivileged }: IpcHelpers): void {
  // ── Session export ──────────────────────────────────────────────────────────
  // SessionExport opens a native save dialog and writes a file to disk.
  handlePrivileged(IpcRequest.SessionExport, async (sessionId: string) => {
    if (!mainWindow) return { ok: false, error: "no window" };
    const messages = await getBridge().listMessages(sessionId);
    if (!messages || messages.length === 0) return { ok: false, error: "empty session" };
    const entry = await getBridge().getSession(sessionId);
    const title = entry?.summary || sessionId.slice(0, 8);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export session as Markdown",
      defaultPath: `${title.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_").slice(0, 60)}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    // Build markdown content from messages
    const lines: string[] = [`# ${title}`, ""];
    for (const msg of messages) {
      if (!msg.visible || msg.role === "system") continue;
      const role = msg.role === "user" ? "**User**" : msg.role === "assistant" ? "**Assistant**" : "**Tool**";
      lines.push(`## ${role}`, "");
      if (msg.content) lines.push(msg.content, "");
    }
    try {
      await writeFile(result.filePath, lines.join("\n"), "utf-8");
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// Registration order is preserved exactly as it was inline: channels are
// registered once each, and some renderer flows depend on earlier domains
// being available first.
function registerIpc(): void {
  const helpers = createIpcHelpers();
  registerCoreIpc(helpers);
  registerPluginsIpc(helpers);
  registerFileScannerIpc(helpers);
  registerWorkspaceIpc(helpers);
  registerGitIpc(helpers);
  registerCodegraphIpc(helpers);
  // registerCodeReviewIpc removed — actions replace legacy review IPC.
  registerCrgIpc(helpers);
  registerMemoryIpc(helpers);
  registerKnowledgeIpc(helpers);
  registerDesignIpc(helpers);
  registerA2uiIpc(helpers);
  registerA2uiPrototypeWindowIpc(helpers);
  registerWikiIpc(helpers);
  registerMcpManagementIpc(helpers);
  registerGitmcpIpc(helpers);
  registerEditorIpc(helpers);
  registerAgentChangesIpc(helpers);
  registerSessionExportIpc(helpers);
  // defineAction IPC surface. Reads the SAME ActionRegistry SessionManager owns
  // (LLM + IPC + MCP share one instance — no dual state). action-ipc.ts stays
  // electron-free by receiving emit + getRegistry via deps.
  registerActionIpc(helpers, {
    emit,
    getRegistry: () => {
      const bridge = getBridge();
      return bridge?.getSessionManager().getActionRegistry() ?? null;
    },
  });
}

app.whenReady().then(() => {
  // Register IPC handlers first so the renderer can communicate as soon as
  // the window loads. createWindow follows immediately — the window appears
  // fast because the renderer HTML + JS start loading right away.
  registerIpc();
  createWindow();
  // Defer background vendoring until after the window is visible — it
  // fetches git repos and compiles, which is I/O-heavy and shouldn't
  // compete with first paint for CPU/disk bandwidth.
  setImmediate(refreshVendoredToolsInBackground);
  // Start the memory pipeline if settings.memory.enabled is set. Without this,
  // memory stayed off until the user toggled the checkbox (the renderer only
  // edits the draft; the runtime state must be derived from persisted settings).
  setImmediate(() => {
    void reconcileMemory();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  killHelperProcesses();
  bridge?.dispose();
  bridge = null;
  pluginManager?.dispose();
  pluginManager = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Controlled shutdown: drain the memory pipeline (flush L0/checkpoint state,
// close SQLite) before the process exits. The scheduler/checkpoint/SQLite
// cleanup only runs through MemoryManager.destroy(); without this gate the app
// could exit with pending writes or an open DB handle (especially on Windows
// where open handles block later launches).
let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting) return; // re-entrant after our forced quit
  event.preventDefault();
  isQuitting = true;
  killHelperProcesses();
  // Hard-exit watchdog: if the async cleanup below hangs (e.g. a wedged memory
  // pipeline or an unkillable helper), force-quit anyway. Without this, the
  // blocked quit leaves a zombie instance whose window never paints — the
  // next launch then appears "white screened" alongside the stuck one.
  const watchdog = setTimeout(() => {
    app.exit(0);
  }, 5000);
  watchdog.unref();
  (async () => {
    try {
      await stopMemory();
    } catch {
      // Best-effort — never block exit on cleanup failure.
    }
    try {
      // Release the shared embedding service: onnxruntime holds native handles
      // and worker threads that would otherwise keep the process alive (exactly
      // the "open handles block later launches" failure the watchdog guards).
      await closeEmbeddingService();
    } catch {
      // Best-effort — never block exit on cleanup failure.
    }
    bridge?.dispose();
    bridge = null;
    clearTimeout(watchdog);
    app.quit();
  })();
});
