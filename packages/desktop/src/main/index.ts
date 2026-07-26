// Electron main process for the Deep Code Desktop client.
// Boots a BrowserWindow, wires the SessionBridge to IPC, and forwards engine
// events to the renderer.

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import {
  setShellIfWindows,
  configureCodegraphVendorRoot,
  hasCodegraphProject,
  runCodegraphResetWithOutput,
  resolveCurrentSettings,
  resolveModernNode,
} from "@vegamo/deepcode-core";
import type { ModelConfigSelection, UserPromptContent } from "@vegamo/deepcode-core";
import { IpcEvent, IpcRequest } from "../shared/ipc.js";
import type { CodegraphIndexEntry, EditableSettings, UndoRestoreMode, WikiPageEntry } from "../shared/ipc.js";
import { SessionBridge } from "./session-bridge.js";
import { applyAppIcon } from "./app-icon.js";
import { PluginManager, type PluginEventCallback } from "./plugin-manager.js";
import { scanFiles } from "./file-scanner.js";
import { listWorkspaceSessions } from "./workspace-registry.js";
import { archiveSession, unarchiveSession } from "./archive-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Product/brand name — drives the macOS menu-bar app name and Windows taskbar grouping.
app.setName("DeepOrca");

// Point the CodeGraph resolver at the copy we vendor next to the built app
// (packages/desktop/vendor/codegraph). When absent (not yet vendored), the core
// resolver transparently falls back to `npx @colbymchenry/codegraph`.
configureCodegraphVendorRoot(join(__dirname, "..", "vendor", "codegraph"));

// Keep the vendored CodeGraph/OpenWiki checkouts fresh: in dev (unpackaged),
// kick off the vendor scripts in the background at boot so they fetch upstream
// and recompile when new commits landed — the next launch picks up the update.
// Packaged builds ship a frozen vendored copy and skip this.
function refreshVendoredToolsInBackground(): void {
  if (app.isPackaged) {
    return;
  }
  for (const name of ["codegraph", "openwiki"]) {
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

// Deep Code's bash tool relies on a POSIX shell; on Windows this resolves Git Bash.
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
    const override = process.env.DEEPCODE_PLATFORM;
    if (override === "win32" || override === "darwin" || override === "linux") {
      return override;
    }
  }
  return process.platform;
}
let bridge: SessionBridge | null = null;
let pluginManager: PluginManager | null = null;

function emit(channel: string, payload?: unknown): void {
  mainWindow?.webContents.send(channel, payload);
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
  return app.getPath("home");
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
        // De-typed access to resolveCurrentSettings via the bridge's own method
        const settings = b.getRawSettings();
        return {
          mcpServers: settings.mcpServers,
          enabledSkills: settings.enabledSkills,
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
    },
  });

  void mainWindow.loadFile(join(__dirname, "renderer/index.html"));

  // Rasterize + apply the orca brand icon (window/taskbar/dock). Best-effort.
  void applyAppIcon(mainWindow);

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  const handle = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as never[])));
  };

  handle(IpcRequest.Ready, () => ({
    projectRoot: getBridge().projectRoot,
    platform: resolvePlatform(),
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

  handle(IpcRequest.SetProjectRoot, (root: string) => {
    getBridge().setProjectRoot(root);
    emit(IpcEvent.ProjectRootChanged, getBridge().projectRoot);
    return { projectRoot: getBridge().projectRoot };
  });

  handle(IpcRequest.SessionList, () => getBridge().listSessions());
  handle(IpcRequest.SessionGet, (id: string) => getBridge().getSession(id));
  handle(IpcRequest.SessionMessages, (id: string) => getBridge().listMessages(id));
  handle(IpcRequest.SessionSetActive, (id: string | null) => getBridge().setActiveSession(id));
  handle(IpcRequest.SessionGetActive, () => getBridge().getActiveSession());
  handle(IpcRequest.SessionDelete, (id: string) => getBridge().deleteSession(id));
  handle(IpcRequest.SessionRename, (id: string, summary: string) => getBridge().renameSession(id, summary));

  handle(IpcRequest.PromptSend, async (prompt: UserPromptContent) => {
    try {
      await getBridge().sendPrompt(prompt);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  handle(IpcRequest.PromptInterrupt, () => getBridge().interrupt());
  handle(IpcRequest.PermissionDeny, (reason?: string) => getBridge().denyPermission(reason));
  handle(IpcRequest.AdjustBashTimeout, (deltaMs: number) => getBridge().adjustBashTimeout(deltaMs));

  handle(IpcRequest.SkillsList, (sessionId?: string) => getPluginManager().listSkills(sessionId));
  handle(IpcRequest.SettingsGet, () => getBridge().getSettings());
  handle(IpcRequest.SettingsGetEditable, () => getBridge().getEditableSettings());
  handle(IpcRequest.SettingsUpdate, (patch: EditableSettings) => getBridge().updateSettings(patch));
  handle(IpcRequest.ModelSet, (selection: ModelConfigSelection) => getBridge().setModel(selection));

  handle(IpcRequest.McpStatus, () => getPluginManager().getMcpStatus());
  handle(IpcRequest.McpReconnect, (name: string) => getPluginManager().reconnectMcp(name));

  handle(IpcRequest.UndoList, (sessionId: string) => getBridge().listUndoTargets(sessionId));
  handle(IpcRequest.UndoRestore, (sessionId: string, messageId: string, mode: UndoRestoreMode) => {
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
  handle(IpcRequest.PluginRemoveMcpServer, (name: string) => getBridge().pluginRemoveMcpServer(name));
  handle(IpcRequest.PluginBuiltinList, () => getBridge().pluginBuiltinList());
  handle(IpcRequest.PluginBuiltinReadDoc, (name: string, locale?: string) =>
    getBridge().pluginBuiltinReadDoc(name, locale)
  );

  // ── File scanner (for @file mentions) ────────────────────────────────────
  handle(IpcRequest.ScanFiles, (query: string) => {
    return scanFiles(getBridge().projectRoot, query);
  });

  // ── Workspace-grouped sessions + archive ──────────────────────────────────
  handle(IpcRequest.WorkspaceListSessions, () => listWorkspaceSessions(getBridge().projectRoot));
  handle(IpcRequest.SessionArchive, (id: string) => {
    archiveSession(id);
  });
  handle(IpcRequest.SessionUnarchive, (id: string) => {
    unarchiveSession(id);
  });

  // ── Git source control ────────────────────────────────────────────────────
  handle(IpcRequest.GitStatus, () => getBridge().gitStatus());
  handle(IpcRequest.GitStage, (file: string) => getBridge().gitStage(file));
  handle(IpcRequest.GitUnstage, (file: string) => getBridge().gitUnstage(file));
  handle(IpcRequest.GitDiscard, (file: string) => getBridge().gitDiscard(file));
  handle(IpcRequest.GitCommit, (message: string) => getBridge().gitCommit(message));
  handle(IpcRequest.GitCurrentBranch, () => getBridge().gitCurrentBranch());
  handle(IpcRequest.GitListBranches, () => getBridge().gitListBranches());
  handle(IpcRequest.GitCheckout, (branch: string) => getBridge().gitCheckout(branch));
  handle(IpcRequest.GitDiff, (file: string, staged: boolean) => getBridge().gitDiff(file, staged));
  handle(IpcRequest.GitLog, (limit?: number) => getBridge().gitLog(limit));
  handle(IpcRequest.GitCommitDiff, (hash: string, file?: string) => getBridge().gitCommitDiff(hash, file));
  handle(IpcRequest.GitCommitFiles, (hash: string) => getBridge().gitCommitFiles(hash));

  // ── CodeGraph index library ───────────────────────────────────────────────
  handle(IpcRequest.CodegraphList, (): CodegraphIndexEntry[] => {
    const { workspaces } = listWorkspaceSessions(getBridge().projectRoot);
    return workspaces.map((w) => ({
      root: w.root,
      label: w.label,
      initialized: hasCodegraphProject(w.root),
    }));
  });
  handle(IpcRequest.CodegraphReindex, async (root: string) => {
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
  handle(IpcRequest.ReviewCheckAvailable, (): Promise<{ available: boolean; version?: string }> => {
    return new Promise((resolve) => {
      execFile("ocr", ["--version"], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve({ available: false });
        } else {
          resolve({ available: true, version: stdout.trim().split("\n")[0] });
        }
      });
    });
  });
  // Review scope is fixed: uncommitted workspace changes (vs HEAD) in the current
  // project — no branch/commit selection, the UI states the scope directly.
  handle(IpcRequest.ReviewRun, (): Promise<{ ok: boolean; error?: string }> => {
    const args = ["review", "--format", "json"];
    return new Promise((resolve) => {
      try {
        const cp = spawn("ocr", args, { cwd: getBridge().projectRoot, shell: true });
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

  // ── Wiki knowledge graph (openwiki — vendored Node CLI) ────────────────────
  // OpenWiki is a TypeScript CLI (langchain-ai/openwiki). We vendor it at build
  // time (scripts/vendor-openwiki.js → packages/desktop/vendor/openwiki) and run
  // it as a built-in command through a system Node 22+ (OpenWiki's engines floor;
  // its deps rely on require(esm), which Electron 33's bundled Node 20 lacks).
  // Fallback: `npx -y openwiki`.
  // Dedicated wiki agent model strategy: flash-first, pro-fallback.
  const WIKI_MODEL_FLASH = "deepseek-v4-flash";
  const WIKI_MODEL_PRO = "deepseek-v4-pro";
  const OPENWIKI_VENDOR_ENTRY = join(__dirname, "..", "vendor", "openwiki", "dist", "cli.js");

  /** Resolve how to invoke openwiki: vendored entry through a system Node 22+, or npx fallback. */
  const resolveOpenwikiCommand = (): { command: string; prefixArgs: string[]; env?: Record<string, string> } => {
    try {
      if (statSync(OPENWIKI_VENDOR_ENTRY).isFile()) {
        const node = resolveModernNode(22);
        if (node) {
          return { command: node, prefixArgs: [OPENWIKI_VENDOR_ENTRY] };
        }
      }
    } catch {
      // Vendored entry not present — fall through to npx.
    }
    return { command: "npx", prefixArgs: ["-y", "openwiki"] };
  };

  handle(IpcRequest.WikiCheckAvailable, (): Promise<{ available: boolean; version?: string }> => {
    return new Promise((resolve) => {
      const { command, prefixArgs, env } = resolveOpenwikiCommand();
      const vendored = command !== "npx";
      const execEnv = env ? { ...(process.env as Record<string, string>), ...env } : undefined;
      execFile(command, [...prefixArgs, "--version"], { timeout: 10000, env: execEnv }, (err, stdout) => {
        if (!err) {
          resolve({ available: true, version: stdout.trim().split("\n")[0] });
        } else {
          // A vendored build counts as available even when --version probing fails.
          resolve({ available: vendored });
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
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (settings.apiKey) env.OPENAI_API_KEY = settings.apiKey;
    if (settings.baseURL) env.OPENAI_BASE_URL = settings.baseURL;

    const spawnWith = (model: string): Promise<{ ok: boolean; error?: string }> => {
      return new Promise((resolve) => {
        try {
          const { command, prefixArgs, env: exeEnv } = resolveOpenwikiCommand();
          const cp = spawn(command, [...prefixArgs, ...args, "--model", model], {
            cwd: getBridge().projectRoot,
            env: { ...env, ...exeEnv, OPENWIKI_MODEL: model },
          });
          cp.stdout?.on("data", (d: Buffer) => {
            emit(IpcEvent.WikiProgress, { chunk: d.toString(), stream: "stdout", done: false });
          });
          cp.stderr?.on("data", (d: Buffer) => {
            emit(IpcEvent.WikiProgress, { chunk: d.toString(), stream: "stderr", done: false });
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
        chunk: `[wiki-agent] model: ${WIKI_MODEL_FLASH}\n`,
        stream: "stdout",
        done: false,
      });
      const flashResult = await spawnWith(WIKI_MODEL_FLASH);
      if (flashResult.ok) {
        emit(IpcEvent.WikiProgress, { chunk: "", stream: "stdout", done: true, exitCode: 0 });
        return flashResult;
      }
      // Phase 2: flash failed, fall back to pro
      emit(IpcEvent.WikiProgress, {
        chunk: `[wiki-agent] flash unavailable, falling back to ${WIKI_MODEL_PRO}\n`,
        stream: "stderr",
        done: false,
      });
      const proResult = await spawnWith(WIKI_MODEL_PRO);
      emit(IpcEvent.WikiProgress, { chunk: "", stream: "stdout", done: true, exitCode: proResult.ok ? 0 : 1 });
      return proResult;
    })();
  };

  handle(IpcRequest.WikiInit, () => runWikiAgent(["--init"]));
  handle(IpcRequest.WikiUpdate, () => runWikiAgent(["--update"]));

  handle(IpcRequest.WikiListPages, async (): Promise<WikiPageEntry[]> => {
    const { readdir } = await import("node:fs/promises");
    const { join: pathJoin } = await import("node:path");
    const wikiDir = pathJoin(getBridge().projectRoot, "openwiki");
    try {
      const entries: WikiPageEntry[] = [];
      const walk = async (dir: string, prefix: string): Promise<void> => {
        const items = await readdir(dir, { withFileTypes: true });
        for (const item of items) {
          const rel = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.isDirectory()) {
            await walk(pathJoin(dir, item.name), rel);
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
    const { readFile } = await import("node:fs/promises");
    const { join: pathJoin, normalize } = await import("node:path");
    // Prevent path traversal
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
    const filePath = pathJoin(getBridge().projectRoot, "openwiki", safe);
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return "";
    }
  });

  // ── MCP management (plugin module) ────────────────────────────────────────
  handle(IpcRequest.PluginMcpList, () => getBridge().pluginMcpList());
  handle(IpcRequest.PluginSetMcpEnabled, (name: string, enabled: boolean) =>
    getBridge().pluginSetMcpEnabled(name, enabled)
  );

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
  registerIpc();
  createWindow();
  refreshVendoredToolsInBackground();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  bridge?.dispose();
  bridge = null;
  pluginManager?.dispose();
  pluginManager = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});
