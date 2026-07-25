// Electron main process for the Deep Code Desktop client.
// Boots a BrowserWindow, wires the SessionBridge to IPC, and forwards engine
// events to the renderer.

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import {
  setShellIfWindows,
  configureCodegraphVendorRoot,
  hasCodegraphProject,
  runCodegraphResetWithOutput,
} from "@vegamo/deepcode-core";
import type { ModelConfigSelection, UserPromptContent } from "@vegamo/deepcode-core";
import { IpcEvent, IpcRequest } from "../shared/ipc.js";
import type { CodegraphIndexEntry, EditableSettings, ReviewOptions, UndoRestoreMode } from "../shared/ipc.js";
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

function getBridge(): SessionBridge {
  if (!bridge) {
    bridge = new SessionBridge(app.getPath("home"), emit);
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
  handle(IpcRequest.GitCommitDiff, (hash: string) => getBridge().gitCommitDiff(hash));

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
  handle(IpcRequest.ReviewRun, (options: ReviewOptions): Promise<{ ok: boolean; error?: string }> => {
    const args = ["review", "--format", "json"];
    if (options.mode === "branch" && options.from) {
      args.push("--from", options.from);
      if (options.to) args.push("--to", options.to);
    } else if (options.mode === "commit" && options.commit) {
      args.push("--commit", options.commit);
    }
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
