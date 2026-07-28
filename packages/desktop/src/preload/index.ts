// Preload: exposes a typed, minimal API surface on `window.deeporca`.
// Runs with contextIsolation so the renderer never touches Node/Electron directly.

import { contextBridge, ipcRenderer } from "electron";
import { IpcEvent, IpcRequest } from "../shared/ipc";
import type { DesktopApi } from "../shared/ipc";

function subscribe(channel: string, cb: (payload: never) => void): () => void {
  const listener = (_event: unknown, payload: unknown): void => cb(payload as never);
  ipcRenderer.on(channel, listener as never);
  return () => ipcRenderer.removeListener(channel, listener as never);
}

const api: DesktopApi = {
  ready: () => ipcRenderer.invoke(IpcRequest.Ready),
  pickFolder: () => ipcRenderer.invoke(IpcRequest.PickFolder),
  setProjectRoot: (root) => ipcRenderer.invoke(IpcRequest.SetProjectRoot, root),
  getProjectRoot: () => ipcRenderer.invoke(IpcRequest.GetProjectRoot),

  minimizeWindow: () => ipcRenderer.invoke(IpcRequest.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IpcRequest.WindowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IpcRequest.WindowClose),

  listSessions: () => ipcRenderer.invoke(IpcRequest.SessionList),
  getSession: (id) => ipcRenderer.invoke(IpcRequest.SessionGet, id),
  listMessages: (id) => ipcRenderer.invoke(IpcRequest.SessionMessages, id),
  setActiveSession: (id) => ipcRenderer.invoke(IpcRequest.SessionSetActive, id),
  getActiveSession: () => ipcRenderer.invoke(IpcRequest.SessionGetActive),
  deleteSession: (id) => ipcRenderer.invoke(IpcRequest.SessionDelete, id),
  renameSession: (id, summary) => ipcRenderer.invoke(IpcRequest.SessionRename, id, summary),

  sendPrompt: (prompt) => ipcRenderer.invoke(IpcRequest.PromptSend, prompt),
  interrupt: () => ipcRenderer.invoke(IpcRequest.PromptInterrupt),
  pausePrompt: () => ipcRenderer.invoke(IpcRequest.PromptPause),
  resumePrompt: (sessionId) => ipcRenderer.invoke(IpcRequest.PromptResume, sessionId),
  enhancePrompt: (text) => ipcRenderer.invoke(IpcRequest.PromptEnhance, text),
  denyPermission: (reason) => ipcRenderer.invoke(IpcRequest.PermissionDeny, reason),
  adjustBashTimeout: (deltaMs) => ipcRenderer.invoke(IpcRequest.AdjustBashTimeout, deltaMs),

  listSkills: (sessionId) => ipcRenderer.invoke(IpcRequest.SkillsList, sessionId),
  getSettings: () => ipcRenderer.invoke(IpcRequest.SettingsGet),
  getEditableSettings: () => ipcRenderer.invoke(IpcRequest.SettingsGetEditable),
  updateSettings: (patch) => ipcRenderer.invoke(IpcRequest.SettingsUpdate, patch),
  setModel: (selection) => ipcRenderer.invoke(IpcRequest.ModelSet, selection),

  mcpStatus: () => ipcRenderer.invoke(IpcRequest.McpStatus),
  mcpReconnect: (name) => ipcRenderer.invoke(IpcRequest.McpReconnect, name),

  listUndoTargets: (sessionId) => ipcRenderer.invoke(IpcRequest.UndoList, sessionId),
  restoreUndo: (sessionId, messageId, mode) => ipcRenderer.invoke(IpcRequest.UndoRestore, sessionId, messageId, mode),

  onAssistantMessage: (cb) => subscribe(IpcEvent.AssistantMessage, cb as (p: never) => void),
  onSessionEntryUpdated: (cb) => subscribe(IpcEvent.SessionEntryUpdated, cb as (p: never) => void),
  onLlmStreamProgress: (cb) => subscribe(IpcEvent.LlmStreamProgress, cb as (p: never) => void),
  // ── Plugin API ────────────────────────────────────────────────────────────
  pluginSearchSkills: (query, sessionId) => ipcRenderer.invoke(IpcRequest.PluginSearchSkills, query, sessionId),
  pluginRefreshSkills: (sessionId) => ipcRenderer.invoke(IpcRequest.PluginRefreshSkills, sessionId),
  pluginReadSkillDoc: (path, locale) => ipcRenderer.invoke(IpcRequest.PluginReadSkillDoc, path, locale),
  pluginUpsertMcpServer: (name, command, args, env) =>
    ipcRenderer.invoke(IpcRequest.PluginUpsertMcpServer, name, command, args, env),
  pluginRemoveMcpServer: (name) => ipcRenderer.invoke(IpcRequest.PluginRemoveMcpServer, name),
  pluginBuiltinList: () => ipcRenderer.invoke(IpcRequest.PluginBuiltinList),
  pluginBuiltinReadDoc: (name, locale) => ipcRenderer.invoke(IpcRequest.PluginBuiltinReadDoc, name, locale),

  // ── Events ────────────────────────────────────────────────────────────────
  onMcpStatusChanged: (cb) => subscribe(IpcEvent.McpStatusChanged, cb as (p: never) => void),
  onProcessStdout: (cb) => subscribe(IpcEvent.ProcessStdout, cb as (p: never) => void),
  onProjectRootChanged: (cb) => subscribe(IpcEvent.ProjectRootChanged, cb as (p: never) => void),
  onPluginEvent: (cb) => subscribe(IpcEvent.PluginEvent, cb as (p: never) => void),

  // ── File scanning ───────────────────────────────────────────────────────
  scanFiles: (query) => ipcRenderer.invoke(IpcRequest.ScanFiles, query),

  // ── Workspace-grouped sessions + archive ────────────────────────────────
  listWorkspaceSessions: () => ipcRenderer.invoke(IpcRequest.WorkspaceListSessions),
  archiveSession: (id) => ipcRenderer.invoke(IpcRequest.SessionArchive, id),
  unarchiveSession: (id) => ipcRenderer.invoke(IpcRequest.SessionUnarchive, id),

  // ── Git source control ──────────────────────────────────────────────────
  gitStatus: () => ipcRenderer.invoke(IpcRequest.GitStatus),
  gitStage: (file) => ipcRenderer.invoke(IpcRequest.GitStage, file),
  gitUnstage: (file) => ipcRenderer.invoke(IpcRequest.GitUnstage, file),
  gitDiscard: (file) => ipcRenderer.invoke(IpcRequest.GitDiscard, file),
  gitCommit: (message) => ipcRenderer.invoke(IpcRequest.GitCommit, message),
  gitCurrentBranch: () => ipcRenderer.invoke(IpcRequest.GitCurrentBranch),
  gitListBranches: () => ipcRenderer.invoke(IpcRequest.GitListBranches),
  gitCheckout: (branch) => ipcRenderer.invoke(IpcRequest.GitCheckout, branch),
  gitStashCheckout: (branch) => ipcRenderer.invoke(IpcRequest.GitStashCheckout, branch),
  gitDiff: (file, staged) => ipcRenderer.invoke(IpcRequest.GitDiff, file, staged),
  gitLog: (limit) => ipcRenderer.invoke(IpcRequest.GitLog, limit),
  gitCommitDiff: (hash, file) => ipcRenderer.invoke(IpcRequest.GitCommitDiff, hash, file),
  gitCommitFiles: (hash) => ipcRenderer.invoke(IpcRequest.GitCommitFiles, hash),

  // ── CodeGraph index library ──────────────────────────────────
  codegraphList: () => ipcRenderer.invoke(IpcRequest.CodegraphList),
  codegraphReindex: (root) => ipcRenderer.invoke(IpcRequest.CodegraphReindex, root),
  onCodegraphProgress: (cb) => subscribe(IpcEvent.CodegraphProgress, cb as (p: never) => void),

  // ── Code Review (ocr) ─────────────────────────────────────────
  reviewCheckAvailable: () => ipcRenderer.invoke(IpcRequest.ReviewCheckAvailable),
  reviewRun: () => ipcRenderer.invoke(IpcRequest.ReviewRun),
  onReviewProgress: (cb) => subscribe(IpcEvent.ReviewProgress, cb as (p: never) => void),

  // ── code-review-graph (CRG — analysis-layer) ──────────────────
  crgCheckAvailable: () => ipcRenderer.invoke(IpcRequest.CrgCheckAvailable),
  crgList: () => ipcRenderer.invoke(IpcRequest.CrgList),
  crgReindex: (root) => ipcRenderer.invoke(IpcRequest.CrgReindex, root),
  onCrgProgress: (cb) => subscribe(IpcEvent.CrgProgress, cb as (p: never) => void),

  // ── Wiki knowledge graph (openwiki) ─────────────────────────────
  wikiCheckAvailable: () => ipcRenderer.invoke(IpcRequest.WikiCheckAvailable),
  wikiInit: () => ipcRenderer.invoke(IpcRequest.WikiInit),
  wikiUpdate: () => ipcRenderer.invoke(IpcRequest.WikiUpdate),
  wikiListPages: () => ipcRenderer.invoke(IpcRequest.WikiListPages),
  wikiReadPage: (path) => ipcRenderer.invoke(IpcRequest.WikiReadPage, path),
  onWikiProgress: (cb) => subscribe(IpcEvent.WikiProgress, cb as (p: never) => void),

  // ── MCP management (plugin module) ─────────────────────────────
  pluginMcpList: () => ipcRenderer.invoke(IpcRequest.PluginMcpList),
  pluginSetMcpEnabled: (name, enabled) => ipcRenderer.invoke(IpcRequest.PluginSetMcpEnabled, name, enabled),

  // ── GitMCP module ────────────────────────────────
  gitmcpList: () => ipcRenderer.invoke(IpcRequest.GitmcpList),
  gitmcpAdd: (input) => ipcRenderer.invoke(IpcRequest.GitmcpAdd, input),
  gitmcpRemove: (slug) => ipcRenderer.invoke(IpcRequest.GitmcpRemove, slug),
  gitmcpReindex: (slug) => ipcRenderer.invoke(IpcRequest.GitmcpReindex, slug),

  // ── Editor module ─────────────────────────────────────────────────────
  editorReadFile: (filePath) => ipcRenderer.invoke(IpcRequest.EditorReadFile, filePath),
  editorWriteFile: (filePath, content) => ipcRenderer.invoke(IpcRequest.EditorWriteFile, filePath, content),
  editorListFiles: (dirPath) => ipcRenderer.invoke(IpcRequest.EditorListFiles, dirPath),

  // ── Agent changes ───────────────────────────────────────────────────────
  agentChangesList: (sessionId) => ipcRenderer.invoke(IpcRequest.AgentChangesList, sessionId),
  agentChangesDiff: (sessionId, file) => ipcRenderer.invoke(IpcRequest.AgentChangesDiff, sessionId, file),

  // ── Session export ────────────────────────────────────────────────────────
  exportSession: (sessionId) => ipcRenderer.invoke(IpcRequest.SessionExport, sessionId),
};

contextBridge.exposeInMainWorld("deeporca", api);
