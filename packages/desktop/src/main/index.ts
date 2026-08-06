// Electron main process for the DeepOrca Desktop client.
// Boots a BrowserWindow, wires the SessionBridge to IPC, and forwards engine
// events to the renderer.

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  setShellIfWindows,
  configureCodegraphVendorRoot,
  hasCodegraphProject,
  runCodegraphResetWithOutput,
  resolveCurrentSettings,
  resolveModernNode,
  getUserConfigRoot,
  getProjectCode,
  configureCrgVendorRoot,
  configureCrgVersionRoot,
  hasCrgProject,
  resolveUvBinary,
  runCrgResetWithOutput,
  runCrgVisualize,
  configureSerenaUvResolver,
  configureSerenaVendorRoot,
  configureSkillSpectorUvResolver,
  configureSkillSpectorVendorRoot,
  configureSkillSpectorLogger,
  type MemoryProvider,
} from "@deeporca/core";
import type { ModelConfigSelection, UserPromptContent } from "@deeporca/core";
import { IpcEvent, IpcRequest } from "../shared/ipc.js";
import type {
  CodegraphIndexEntry,
  CrgIndexEntry,
  EditableSettings,
  UndoRestoreMode,
  WikiPageEntry,
} from "../shared/ipc.js";
import { SessionBridge } from "./session-bridge.js";
import { applyAppIcon } from "./app-icon.js";
import { PluginManager, type PluginEventCallback } from "./plugin-manager.js";
import { scanFiles } from "./file-scanner.js";
import { listWorkspaceSessions } from "./workspace-registry.js";
import { archiveSession, unarchiveSession } from "./archive-store.js";
import { handleEditorReadFile, handleEditorWriteFile, handleEditorListFiles } from "./editor-handlers.js";

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
const RENDERER_URL = (() => {
  const htmlPath = join(__dirname, "renderer", "index.html");
  return `file://${htmlPath.replace(/\\/g, "/")}`;
})();

/** True when an IPC invocation originated from the privileged main renderer. */
function isFromMainRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  // Development allows a localhost dev server as the renderer origin.
  const senderUrl = event.senderFrame?.url ?? "";
  if (senderUrl.startsWith("http://localhost") || senderUrl.startsWith("http://127.0.0.1")) {
    return true;
  }
  // Packaged: the sender must be the main window's webContents loading our
  // own renderer file, and its URL must match the packaged renderer origin.
  if (mainWindow && event.sender.id === mainWindow.webContents.id) {
    return senderUrl === RENDERER_URL || senderUrl.startsWith("file://");
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

// Product/brand name — drives the macOS menu-bar app name and Windows taskbar grouping.
app.setName("DeepOrca");

// V8 performance tuning — must be set before app.whenReady().
// max-semi-space-size: 16MB→64MB reduces minor GC frequency during token
//   streaming and JSON parsing (4x fewer scavenge pauses).
// max-old-space-size: raised to 4GB to prevent OOM on long agentic sessions
//   that accumulate full conversation history in memory.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=4096 --max-semi-space-size=64");

// Point the CodeGraph resolver at the copy we vendor next to the built app
// (packages/desktop/vendor/codegraph). When absent (not yet vendored), the core
// resolver transparently falls back to `npx @colbymchenry/codegraph`.
configureCodegraphVendorRoot(join(__dirname, "..", "vendor", "codegraph"));

// Point the CRG (code-review-graph) resolver at the vendored uv binary
// (packages/desktop/vendor/uv). When absent, the core resolver falls back
// to a system `uv`/`uvx` on PATH. CRG is a Python tool run via uv's
// isolated environment — no host Python required when uv is vendored.
configureCrgVendorRoot(join(__dirname, "..", "vendor", "uv"));

// CRG version pin: read from vendor/crg/.vendored-crg-version (written by
// scripts/vendor-crg.js). Pins `uv tool run --from code-review-graph==<version>`.
configureCrgVersionRoot(join(__dirname, "..", "vendor", "crg"));

// Share the same vendored uv binary with Serena's MCP resolver. Serena is also
// Python-based and runs through `uvx --python 3.13 serena-agent` — the same
// vendored uv that CRG uses handles the isolated Python provisioning.
configureSerenaUvResolver(() => resolveUvBinary());

// Serena version pin: read from vendor/serena/.vendored-serena-version (written by
// scripts/vendor-serena.js). Pins `uv tool run --from serena-agent==<version>`.
configureSerenaVendorRoot(join(__dirname, "..", "vendor", "serena"));

// SkillSpector (AI skill/MCP security scanner) shares the same vendored uv and reads
// its pinned version from the vendored skillspector dir (written by
// scripts/vendor-skillspector.js at build time). Installs wheel from GitHub Releases.
configureSkillSpectorUvResolver(() => resolveUvBinary());
configureSkillSpectorVendorRoot(join(__dirname, "..", "vendor", "skillspector"));
// Surface background SkillSpector install failures (e.g. no network / blocked
// proxy) instead of letting them vanish silently — otherwise the MCP server
// just never appears with no clue why.
configureSkillSpectorLogger((message, detail) => {
  console.error("[skill-spector]", message, detail ?? "");
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

// In-process memory manager (TdaiCore). Held at module scope so the startup
// (whenReady), settings-save, project-switch, and shutdown (before-quit) paths
// can all reach it without going through an IPC handler closure.
let memoryManager: { init(): Promise<void>; destroy(): Promise<void>; isAvailable(): boolean } | null = null;
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
  // containing a link) could navigate this window to a remote page, that page
  // would inherit the full privileged bridge. Block all top-level navigation
  // to anything other than our own renderer file.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url === RENDERER_URL || url.startsWith("file://")) {
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

function registerIpc(): void {
  // Uniform error normalization: log main-side failures with their channel and
  // rethrow a clean Error so the renderer receives a readable message instead
  // of an opaque serialized rejection.
  const handle = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...(args as never[]));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ipc] ${channel} failed:`, message);
        throw new Error(`${channel}: ${message}`);
      }
    });
  };
  // Privileged variant: asserts the call originates from the main renderer
  // before running. Use for any channel that mutates the filesystem, settings,
  // Git state, MCP config, or runs destructive index operations. The handler
  // signature matches `handle` (no event param) — sender validation happens
  // uniformly inside the wrapper.
  const handlePrivileged = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
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
  handle(IpcRequest.WindowClose, () => {
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
  handle(IpcRequest.SessionSetActive, (id: string | null) => getBridge().setActiveSession(id));
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
  handle(IpcRequest.PromptEnhance, async (text: string) => {
    try {
      const enhanced = await getBridge().enhancePrompt(text);
      return { ok: true, text: enhanced };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  handle(IpcRequest.PermissionDeny, (reason?: string) => getBridge().denyPermission(reason));
  handle(IpcRequest.AdjustBashTimeout, (deltaMs: number) => getBridge().adjustBashTimeout(deltaMs));

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
  handle(IpcRequest.McpReconnect, (name: string) => getPluginManager().reconnectMcp(name));

  handle(IpcRequest.UndoList, (sessionId: string) => getBridge().listUndoTargets(sessionId));
  handlePrivileged(IpcRequest.UndoRestore, (sessionId: string, messageId: string, mode: UndoRestoreMode) => {
    try {
      getBridge().restoreUndo(sessionId, messageId, mode);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ── Plugin IPC handlers ───────────────────────────────────────────────────
  handle(IpcRequest.PluginSearchSkills, (query: string, sessionId?: string) =>
    getPluginManager().searchSkills(query, sessionId)
  );
  handle(IpcRequest.PluginRefreshSkills, (sessionId?: string) => getPluginManager().refreshSkills(sessionId));
  handle(IpcRequest.PluginReadSkillDoc, (path: string, locale?: string) =>
    getPluginManager().readSkillDoc(path, locale)
  );
  handle(
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

  // ── File scanner (for @file mentions) ────────────────────────────────────
  handle(IpcRequest.ScanFiles, (query: string) => {
    return scanFiles(getBridge().projectRoot, query);
  });

  // ── Workspace-grouped sessions + archive ──────────────────────────────────
  handle(IpcRequest.WorkspaceListSessions, () => listWorkspaceSessions(getBridge().projectRoot));
  handlePrivileged(IpcRequest.SessionArchive, (id: string) => {
    archiveSession(id);
  });
  handlePrivileged(IpcRequest.SessionUnarchive, (id: string) => {
    unarchiveSession(id);
  });

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

  // ── CodeGraph index library ───────────────────────────────────────────────
  handle(IpcRequest.CodegraphList, (): CodegraphIndexEntry[] => {
    const currentRoot = getBridge().projectRoot;
    // Only show the current workspace, not all historical workspaces.
    // This prevents a confusing list of unrelated directories.
    if (!currentRoot) return [];
    return [
      {
        root: currentRoot,
        label: currentRoot.split("/").pop() || currentRoot,
        initialized: hasCodegraphProject(currentRoot),
      },
    ];
  });
  handlePrivileged(IpcRequest.CodegraphReindex, async (_rootFromRenderer: string) => {
    // Derive the workspace root server-side. Earlier code trusted a renderer-
    // supplied root and recursively removed .codegraph under it — a compromised
    // renderer could target any accessible directory.
    const root = getBridge().projectRoot;
    const exitCode = await runCodegraphResetWithOutput(root, (chunk, stream) => {
      emit(IpcEvent.CodegraphProgress, { root, chunk, stream, done: false });
    });
    emit(IpcEvent.CodegraphProgress, { root, chunk: "", stream: "stdout", done: true, exitCode });
    return {
      ok: exitCode === 0,
      action: "reset" as const,
      error: exitCode !== 0 ? `exit code ${exitCode}` : undefined,
    };
  });

  // ── Code Review (ocr CLI) ──────────────────────────────────────────────────
  // Open Code Review ships as an npm package (@alibaba-group/open-code-review)
  // whose bin/ocr.js launcher resolves a prebuilt platform binary from an
  // optionalDependency (@alibaba-group/ocr-<os>-<arch>). We run that launcher
  // through Electron's bundled Node (ELECTRON_RUN_AS_NODE) so no global install
  // or external runtime is needed. Returns null when the bundled dep is absent —
  // the tool is reported unavailable rather than reaching for an external npx.
  const resolveOcrCommand = (): {
    command: string;
    prefixArgs: string[];
    env?: Record<string, string>;
  } | null => {
    try {
      // bin/ocr.js is CommonJS; require.resolve gives its absolute path from
      // wherever node_modules is hoisted (app dir in dev, Resources/app in packaged).
      const entry = require.resolve("@alibaba-group/open-code-review/bin/ocr.js");
      // OCR_NO_UPDATE suppresses the launcher's built-in updater (bin/ocr.js spawns
      // update.js, which calls `npm i -g` on the host) — we ship a pinned version,
      // so auto-updating must never reach for an external npm.
      return {
        command: process.execPath,
        prefixArgs: [entry],
        env: { ELECTRON_RUN_AS_NODE: "1", OCR_NO_UPDATE: "1" },
      };
    } catch {
      // Package not installed.
    }
    return null;
  };

  handle(IpcRequest.ReviewCheckAvailable, (): Promise<{ available: boolean; version?: string }> => {
    return new Promise((resolve) => {
      const resolved = resolveOcrCommand();
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
          // A bundled install counts as available even when --version probing fails.
          resolve({ available: true });
        }
      });
    });
  });
  // Review scope is fixed: uncommitted workspace changes (vs HEAD) in the current
  // project — no branch/commit selection, the UI states the scope directly.
  handle(IpcRequest.ReviewRun, (): Promise<{ ok: boolean; error?: string }> => {
    const args = ["review", "--format", "json"];
    return new Promise((resolve) => {
      const resolved = resolveOcrCommand();
      if (!resolved) {
        emit(IpcEvent.ReviewProgress, { chunk: "", stream: "stdout", done: true, exitCode: 1 });
        resolve({ ok: false, error: "Open Code Review is not bundled with this build." });
        return;
      }
      try {
        const { command, prefixArgs, env: exeEnv } = resolved;
        const cp = spawn(command, [...prefixArgs, ...args], {
          cwd: getBridge().projectRoot,
          env: { ...(process.env as Record<string, string>), ...exeEnv },
        });
        trackHelperProcess(cp);
        cp.stdout?.on("data", (d: Buffer) => {
          emit(IpcEvent.ReviewProgress, { chunk: d.toString(), stream: "stdout", done: false });
        });
        cp.stderr?.on("data", (d: Buffer) => {
          emit(IpcEvent.ReviewProgress, { chunk: d.toString(), stream: "stderr", done: false });
        });
        cp.on("error", (err) => {
          emit(IpcEvent.ReviewProgress, { chunk: "", stream: "stdout", done: true, exitCode: 1 });
          resolve({ ok: false, error: err.message });
        });
        cp.on("close", (code) => {
          emit(IpcEvent.ReviewProgress, { chunk: "", stream: "stdout", done: true, exitCode: code ?? 0 });
          resolve({ ok: code === 0, error: code !== 0 ? `exit code ${code}` : undefined });
        });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  });

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

  // TypeScript entry point. The Gateway handles all memory operations:
  // recall, capture, search — DeepOrca communicates via HTTP.
  //
  // NOTE: The IPC handlers below (MemoryCheckAvailable / MemorySetEnabled) are
  // fully wired through main → preload → shared IPC, but the renderer currently
  // has NO call site for memoryCheckAvailable / memorySetEnabled. Additionally,
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

  // ── A2UI (Surface user interaction → agent) ──────────────────────────────
  // When the user clicks a button on an A2UI Surface, the renderer calls
  // this handler. We forward it as an MCP tool call (a2ui_action) to the
  // A2UI MCP server, which the agent receives as a tool result.
  handle(
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

  // ── A2UI standalone prototype window ──────────────────────────────────────
  // Opens a separate Electron BrowserWindow with the prototype Surface at
  // full screen — useful for PM presentations or focused prototype testing.
  const prototypeWindows = new Map<string, BrowserWindow>();
  // Pending payloads keyed by window token, consumed via A2uiRequestPayload
  // (pull handshake) so the renderer fetches its payload on mount instead of
  // depending on a did-finish-load push that can fire before React subscribes.
  const prototypePayloads = new Map<string, { a2uiJson: string; title: string }>();
  handle(IpcRequest.A2uiOpenWindow, async (a2uiJson: string, title: string): Promise<void> => {
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
    // never navigate to a remote page.
    protoWin.webContents.on("will-navigate", (event, url) => {
      if (url === RENDERER_URL || url.startsWith("file://")) return;
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
  handle(IpcRequest.A2uiRequestPayload, (token: string): { a2uiJson: string; title: string } | null => {
    return prototypePayloads.get(token) ?? null;
  });

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
  const OPENWIKI_VENDOR_ENTRY = join(__dirname, "..", "vendor", "openwiki", "dist", "cli.js");

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

  handle(IpcRequest.WikiInit, () => runWikiAgent(["--init"]));
  handle(IpcRequest.WikiUpdate, () => runWikiAgent(["--update"]));

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

  handle(IpcRequest.WikiReadPage, async (path: string): Promise<string> => {
    // Prevent path traversal
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(getBridge().projectRoot, "openwiki", safe);
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return "";
    }
  });

  // ── MCP management (plugin module) ────────────────────────────────────────
  handle(IpcRequest.PluginMcpList, () => getBridge().pluginMcpList());
  handlePrivileged(IpcRequest.PluginSetMcpEnabled, (name: string, enabled: boolean) =>
    getBridge().pluginSetMcpEnabled(name, enabled)
  );

  // ── GitMCP module ──────────────────────────────────────────────────────
  handle(IpcRequest.GitmcpList, () => getBridge().gitmcpList());
  handlePrivileged(IpcRequest.GitmcpAdd, (input: string) => getBridge().gitmcpAdd(input));
  handlePrivileged(IpcRequest.GitmcpRemove, (slug: string) => getBridge().gitmcpRemove(slug));
  handlePrivileged(IpcRequest.GitmcpReindex, (slug: string) => getBridge().gitmcpReindex(slug));

  // ── Editor module ───────────────────────────────────────────────────────
  handle(IpcRequest.EditorReadFile, (filePath: string) => handleEditorReadFile(getBridge().projectRoot, filePath));
  handlePrivileged(IpcRequest.EditorWriteFile, (filePath: string, content: string) =>
    handleEditorWriteFile(getBridge().projectRoot, filePath, content)
  );
  handle(IpcRequest.EditorListFiles, (dirPath: string) => handleEditorListFiles(getBridge().projectRoot, dirPath));

  // ── Agent changes ─────────────────────────────────────────────────────────
  handle(IpcRequest.AgentChangesList, (sessionId: string) => getBridge().agentChangesList(sessionId));
  handle(IpcRequest.AgentChangesDiff, (sessionId: string, file: string) =>
    getBridge().agentChangesDiff(sessionId, file)
  );

  // ── Session export ──────────────────────────────────────────────────────────
  handle(IpcRequest.SessionExport, async (sessionId: string) => {
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
    bridge?.dispose();
    bridge = null;
    clearTimeout(watchdog);
    app.quit();
  })();
});
