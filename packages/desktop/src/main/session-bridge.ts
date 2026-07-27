// Wraps a DeepOrca core `SessionManager` for a single project root and forwards
// its callbacks to the renderer via the provided `emit` function.

import {
  buildCodegraphMcpServerConfig,
  buildGitmcpMaintenanceCommand,
  buildGitmcpPlaceholderConfig,
  CODEGRAPH_MCP_SERVER_NAME,
  createOpenAIClient,
  getEnvVar,
  getProjectSettingsPath,
  getUserSettingsPath,
  gitmcpServerNameForSlug,
  gitmcpSlugFromServerName,
  gitmcpSqliteAvailable,
  GitmcpStore,
  indexRepository,
  isGitmcpServerName,
  parseRepoSlug,
  readGitmcpRepoMeta,
  readProjectSettings,
  readSettings,
  removeGitmcpRepoIndex,
  resolveCurrentSettings,
  SessionManager,
  setCodegraphDisabled,
  writeModelConfigSelection,
  writeProjectSettings,
  writeSettings,
} from "@deeporca/core";
import type {
  DeepcodingSettings,
  GitmcpRepoMeta,
  McpServerConfig,
  ModelConfigSelection,
  PermissionDefaultMode,
  PermissionScope,
  PermissionSettings,
  SessionEntry,
  SessionMessage,
  SessionProcessEntry,
  UserPromptContent,
} from "@deeporca/core";
import { existsSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { IpcEvent } from "../shared/ipc.js";
import type {
  AgentChangeFile,
  DiffPayload,
  EditableSettings,
  GitCommitFileEntry,
  GitLogEntry,
  GitmcpAddResult,
  GitmcpRepoEntry,
  PermissionDecision,
  PluginMcpServer,
  SerializableProcess,
  SerializableSessionEntry,
  SettingsSummary,
} from "../shared/ipc.js";
import { purgeArchivedId } from "./archive-store.js";
import { readDisabledMcp, setMcpDisabled } from "./mcp-store.js";
import * as gitService from "./git-service.js";

type Emit = (channel: string, payload?: unknown) => void;

const PERMISSION_SCOPES: PermissionScope[] = [
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
];

function parseArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseEnvLines(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key) {
      env[key] = trimmed.slice(eq + 1).trim();
    }
  }
  return env;
}

function stringifyEnv(env: Record<string, string> | undefined): string {
  return env
    ? Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")
    : "";
}

function buildPermissionDecisions(
  perms: PermissionSettings | undefined
): Partial<Record<PermissionScope, PermissionDecision>> {
  const result: Partial<Record<PermissionScope, PermissionDecision>> = {};
  for (const scope of perms?.allow ?? []) {
    result[scope] = "allow";
  }
  for (const scope of perms?.ask ?? []) {
    result[scope] = "ask";
  }
  for (const scope of perms?.deny ?? []) {
    result[scope] = "deny";
  }
  return result;
}

function buildPermissionSettings(
  defaultMode: PermissionDefaultMode,
  decisions: Partial<Record<PermissionScope, PermissionDecision>>
): PermissionSettings {
  const allow: PermissionScope[] = [];
  const ask: PermissionScope[] = [];
  const deny: PermissionScope[] = [];
  for (const scope of PERMISSION_SCOPES) {
    const decision = decisions[scope];
    if (decision === "allow") {
      allow.push(scope);
    } else if (decision === "ask") {
      ask.push(scope);
    } else if (decision === "deny") {
      deny.push(scope);
    }
  }
  return { defaultMode, allow, ask, deny };
}

/**
 * Flatten a `SessionEntry` into the JSON-safe shape the renderer expects.
 *
 * `entry.processes` arrives in one of three shapes depending on which code
 * path produced the entry:
 *   1. `Map<string, SessionProcessEntry>` — the canonical in-memory form
 *      from `SessionManager` (used by listSessions/getSession).
 *   2. `Record<string, SessionProcessEntry>` — the on-disk form, since
 *      `saveSessionsIndex` serialises the Map via `Object.fromEntries`.
 *      The cross-workspace `listWorkspaceSessions` in workspace-registry
 *      parses the JSON directly and skips the manager's
 *      `deserializeProcesses`, so it sees the record form.
 *   3. `SerializableProcess[]` — already-flattened; occurs if the caller
 *      round-tripped through toSerializableEntry previously.
 *
 * Without the normalisation below, case (2) crashes with
 * `entry.processes.entries is not a function` because a plain object has
 * no `.entries()` method.
 */
export function toSerializableEntry(entry: SessionEntry): SerializableSessionEntry {
  const processes = flattenProcesses(entry.processes);
  return { ...entry, processes };
}

function flattenProcesses(
  input: SessionEntry["processes"] | SerializableProcess[] | Record<string, unknown> | null | undefined
): SerializableProcess[] {
  if (input == null) return [];
  if (input instanceof Map) {
    return Array.from(input.entries()).map(([pid, info]) => ({
      pid: String(pid),
      ...(info as SessionProcessEntry),
    }));
  }
  if (Array.isArray(input)) {
    return input.filter(isSerializableProcess);
  }
  if (typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).map(([pid, info]) => ({
      pid,
      ...(info as SessionProcessEntry),
    }));
  }
  return [];
}

function isSerializableProcess(value: unknown): value is SerializableProcess {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.pid === "string" && typeof v.startTime === "string" && typeof v.command === "string";
}

export function toSettingsSummary(root: string): SettingsSummary {
  const s = resolveCurrentSettings(root);
  return {
    model: s.model,
    baseURL: s.baseURL,
    thinkingEnabled: s.thinkingEnabled,
    reasoningEffort: s.reasoningEffort,
    hasApiKey: Boolean(s.apiKey),
    statusSeparator: s.statusline?.separator ?? " ",
  };
}

export class SessionBridge {
  private manager: SessionManager;

  constructor(
    public projectRoot: string,
    private readonly emit: Emit
  ) {
    this.manager = this.createManager(projectRoot);
    this.initMcp();
  }

  private createManager(projectRoot: string): SessionManager {
    return new SessionManager({
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(projectRoot),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message: SessionMessage) => {
        this.emit(IpcEvent.AssistantMessage, message);
      },
      onSessionEntryUpdated: (entry) => {
        this.emit(IpcEvent.SessionEntryUpdated, toSerializableEntry(entry));
      },
      onLlmStreamProgress: (progress) => {
        this.emit(IpcEvent.LlmStreamProgress, progress);
      },
      onMcpStatusChanged: () => {
        this.emit(IpcEvent.McpStatusChanged);
      },
      onProcessStdout: (pid, chunk) => {
        this.emit(IpcEvent.ProcessStdout, { pid, chunk: typeof chunk === "string" ? chunk : String(chunk) });
      },
    });
  }

  /** Swap to a new project root, disposing the previous SessionManager. */
  setProjectRoot(root: string): void {
    if (root === this.projectRoot) {
      return;
    }
    this.manager.dispose();
    this.projectRoot = root;
    this.manager = this.createManager(root);
    this.initMcp();
  }

  /**
   * Recreate the SessionManager for the current root so freshly written settings
   * (notably MCP servers, whose init is one-shot) take effect. The active session
   * id is preserved; sessions themselves are re-read from disk.
   */
  private reload(): void {
    const active = this.manager.getActiveSessionId();
    this.manager.dispose();
    this.manager = this.createManager(this.projectRoot);
    this.initMcp();
    if (active) {
      this.manager.setActiveSessionId(active);
    }
  }

  dispose(): void {
    this.manager.dispose();
  }

  /**
   * (Re)initialize MCP servers honoring the desktop-only disable sidecar. The
   * built-in CodeGraph opt-out is pushed into core (which auto-registers it), and
   * user-configured servers marked disabled are filtered out before init.
   */
  private initMcp(): void {
    setCodegraphDisabled(this.projectRoot, readDisabledMcp(this.projectRoot).includes(CODEGRAPH_MCP_SERVER_NAME));
    void this.manager.initMcpServers(this.effectiveMcpServers());
  }

  /** User-configured MCP servers minus any disabled by the desktop sidecar. */
  private effectiveMcpServers(): Record<string, McpServerConfig> | undefined {
    const all = resolveCurrentSettings(this.projectRoot).mcpServers;
    if (!all) {
      return all;
    }
    const disabled = new Set(readDisabledMcp(this.projectRoot));
    const filtered: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(all)) {
      if (!disabled.has(name)) {
        filtered[name] = cfg;
      }
    }
    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  // ── Plugin integration ──────────────────────────────────────────────────────

  /**
   * Return the underlying SessionManager instance so PluginManager can call
   * low-level methods without duplicating them here.
   */
  getSessionManager(): SessionManager {
    return this.manager;
  }

  /** Return the raw resolved settings (for PluginManager bootstrapping). */
  getRawSettings(): DeepcodingSettings {
    return resolveCurrentSettings(this.projectRoot);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────
  listSessions(): SerializableSessionEntry[] {
    return this.manager.listSessions().map(toSerializableEntry);
  }

  getSession(id: string): SerializableSessionEntry | null {
    const entry = this.manager.getSession(id);
    return entry ? toSerializableEntry(entry) : null;
  }

  listMessages(id: string): SessionMessage[] {
    return this.manager.listSessionMessages(id).filter((m) => m.visible);
  }

  setActiveSession(id: string | null): void {
    this.manager.setActiveSessionId(id);
  }

  getActiveSession(): string | null {
    return this.manager.getActiveSessionId();
  }

  deleteSession(id: string): boolean {
    const deleted = this.manager.deleteSession(id);
    if (deleted) {
      purgeArchivedId(id);
    }
    return deleted;
  }

  renameSession(id: string, summary: string): boolean {
    return this.manager.renameSession(id, summary);
  }

  // ── Turn lifecycle ──────────────────────────────────────────────────────────
  async sendPrompt(prompt: UserPromptContent): Promise<void> {
    await this.manager.handleUserPrompt(prompt);
  }

  interrupt(): void {
    this.manager.interruptActiveSession();
  }

  adjustBashTimeout(deltaMs: number): { timeoutMs: number } | null {
    const result = this.manager.adjustActiveBashTimeout(deltaMs);
    return result ? { timeoutMs: result.timeoutMs } : null;
  }

  denyPermission(reason?: string): void {
    const id = this.manager.getActiveSessionId();
    if (id) {
      this.manager.denySessionPermission(id, reason);
    }
  }

  // ── Skills / settings / model ─────────────────────────────────────────────
  async listSkills(sessionId?: string) {
    return this.manager.listSkills(sessionId ?? this.manager.getActiveSessionId() ?? undefined);
  }

  getSettings(): SettingsSummary {
    return toSettingsSummary(this.projectRoot);
  }

  private resolveSaveTarget(): "user" | "project" {
    return existsSync(getProjectSettingsPath(this.projectRoot)) ? "project" : "user";
  }

  private readTargetSettings(target: "user" | "project"): DeepcodingSettings {
    return (target === "project" ? readProjectSettings(this.projectRoot) : readSettings()) ?? {};
  }

  getEditableSettings(): EditableSettings {
    const target = this.resolveSaveTarget();
    const raw = this.readTargetSettings(target);
    const env = raw.env ?? {};
    const resolved = resolveCurrentSettings(this.projectRoot);
    return {
      saveTarget: target,
      saveTargetPath: target === "project" ? getProjectSettingsPath(this.projectRoot) : getUserSettingsPath(),
      hasEnvApiKey: Boolean(getEnvVar("API_KEY")),
      apiKey: env.API_KEY ?? "",
      baseURL: env.BASE_URL ?? "",
      model: raw.model ?? "",
      temperature: raw.temperature != null ? String(raw.temperature) : "",
      thinkingEnabled: raw.thinkingEnabled ?? resolved.thinkingEnabled,
      reasoningEffort: raw.reasoningEffort ?? resolved.reasoningEffort,
      telemetryEnabled: raw.telemetryEnabled ?? true,
      debugLogEnabled: raw.debugLogEnabled ?? false,
      permissionDefaultMode: raw.permissions?.defaultMode ?? "allowAll",
      permissions: buildPermissionDecisions(raw.permissions),
      mcpServers: Object.entries(raw.mcpServers ?? {}).map(([name, cfg]) => ({
        name,
        command: cfg.command,
        args: (cfg.args ?? []).join(" "),
        env: stringifyEnv(cfg.env),
      })),
    };
  }

  updateSettings(patch: EditableSettings): { summary: SettingsSummary; editable: EditableSettings } {
    const target = patch.saveTarget;
    const raw = this.readTargetSettings(target);
    const next: DeepcodingSettings = { ...raw };

    const env: Record<string, string | undefined> = { ...(raw.env ?? {}) };
    const apiKey = patch.apiKey.trim();
    if (apiKey) {
      env.API_KEY = apiKey;
    } else {
      delete env.API_KEY;
    }
    const baseURL = patch.baseURL.trim();
    if (baseURL) {
      env.BASE_URL = baseURL;
    } else {
      delete env.BASE_URL;
    }
    if (Object.keys(env).length > 0) {
      next.env = env;
    } else {
      delete next.env;
    }

    const model = patch.model.trim();
    if (model) {
      next.model = model;
    } else {
      delete next.model;
    }

    const temperature = Number(patch.temperature);
    if (patch.temperature.trim() && Number.isFinite(temperature)) {
      next.temperature = temperature;
    } else {
      delete next.temperature;
    }

    next.thinkingEnabled = patch.thinkingEnabled;
    if (patch.thinkingEnabled) {
      next.reasoningEffort = patch.reasoningEffort;
    } else {
      delete next.reasoningEffort;
    }

    next.telemetryEnabled = patch.telemetryEnabled;
    next.debugLogEnabled = patch.debugLogEnabled;
    next.permissions = buildPermissionSettings(patch.permissionDefaultMode, patch.permissions);

    const servers: Record<string, McpServerConfig> = {};
    for (const server of patch.mcpServers) {
      const name = server.name.trim();
      const command = server.command.trim();
      if (!name || !command) {
        continue;
      }
      const config: McpServerConfig = { command };
      const args = parseArgs(server.args);
      if (args.length > 0) {
        config.args = args;
      }
      const parsedEnv = parseEnvLines(server.env);
      if (Object.keys(parsedEnv).length > 0) {
        config.env = parsedEnv;
      }
      servers[name] = config;
    }
    if (Object.keys(servers).length > 0) {
      next.mcpServers = servers;
    } else {
      delete next.mcpServers;
    }

    if (target === "project") {
      writeProjectSettings(next, this.projectRoot);
    } else {
      writeSettings(next);
    }

    this.reload();
    this.emit(IpcEvent.McpStatusChanged);
    return { summary: toSettingsSummary(this.projectRoot), editable: this.getEditableSettings() };
  }

  setModel(selection: ModelConfigSelection): SettingsSummary {
    const current = resolveCurrentSettings(this.projectRoot);
    const { changed } = writeModelConfigSelection(selection, current, this.projectRoot);
    if (changed) {
      const content = `/model\n└ Set model to ${selection.model} (${selection.thinkingEnabled ? selection.reasoningEffort : "no thinking"})`;
      const active = this.manager.getActiveSessionId();
      if (active) {
        this.manager.addSessionSystemMessage(active, content, true, { isModelChange: true });
      }
    }
    return toSettingsSummary(this.projectRoot);
  }

  // ── MCP ─────────────────────────────────────────────────────────────────────
  mcpStatus() {
    return this.manager.getMcpStatus();
  }

  async mcpReconnect(name: string): Promise<void> {
    const latest = resolveCurrentSettings(this.projectRoot);
    const config: McpServerConfig | undefined = latest.mcpServers?.[name];
    await this.manager.reconnectMcpServer(name, config);
  }

  // ── Undo ─────────────────────────────────────────────────────────────────────
  listUndoTargets(sessionId: string) {
    return this.manager.listUndoTargets(sessionId);
  }

  restoreUndo(sessionId: string, messageId: string, mode: "conversation" | "code-and-conversation"): void {
    if (mode === "code-and-conversation") {
      this.manager.restoreSessionCode(sessionId, messageId);
    }
    this.manager.restoreSessionConversation(sessionId, messageId);
  }

  // ── Agent changes (write/edit files touched during a session) ───────────────
  /**
   * Distinct absolute file paths mutated by the agent's `write`/`edit` tools in
   * a session, newest first. Parsed from each tool result's JSON `metadata`.
   */
  agentChangesList(sessionId: string): AgentChangeFile[] {
    const messages = this.manager.listSessionMessages(sessionId);
    const seen = new Set<string>();
    const files: AgentChangeFile[] = [];
    for (const message of messages) {
      if (message.role !== "tool" || typeof message.content !== "string") {
        continue;
      }
      let parsed: { name?: unknown; ok?: unknown; metadata?: unknown };
      try {
        parsed = JSON.parse(message.content) as typeof parsed;
      } catch {
        continue;
      }
      const name = typeof parsed.name === "string" ? parsed.name.toLowerCase() : "";
      if (name !== "write" && name !== "edit") {
        continue;
      }
      const metadata = parsed.metadata;
      const filePath =
        metadata && typeof metadata === "object" && "file_path" in metadata
          ? (metadata as { file_path?: unknown }).file_path
          : undefined;
      if (typeof filePath === "string" && filePath.trim() && !seen.has(filePath)) {
        seen.add(filePath);
        files.unshift({ path: filePath });
      }
    }
    return files;
  }

  /**
   * Working-tree diff for one agent-touched file (the current on-disk change is
   * the agent's product). Falls back to an informational message off-repo.
   */
  async agentChangesDiff(_sessionId: string, file: string): Promise<DiffPayload> {
    return gitService.diff(this.projectRoot, file, false);
  }

  // ── Git source control ──────────────────────────────────────────────────────
  gitStatus() {
    return gitService.status(this.projectRoot);
  }

  gitStage(file: string) {
    return gitService.stage(this.projectRoot, file);
  }

  gitUnstage(file: string) {
    return gitService.unstage(this.projectRoot, file);
  }

  gitDiscard(file: string) {
    return gitService.discard(this.projectRoot, file);
  }

  gitCommit(message: string) {
    return gitService.commit(this.projectRoot, message);
  }

  gitCurrentBranch() {
    return gitService.currentBranch(this.projectRoot);
  }

  gitListBranches() {
    return gitService.listBranches(this.projectRoot);
  }

  gitCheckout(branch: string) {
    return gitService.checkout(this.projectRoot, branch);
  }

  gitStashCheckout(branch: string) {
    return gitService.stashCheckout(this.projectRoot, branch);
  }

  gitDiff(file: string, staged: boolean) {
    return gitService.diff(this.projectRoot, file, staged);
  }

  gitLog(limit?: number): Promise<GitLogEntry[]> {
    return gitService.log(this.projectRoot, limit);
  }

  gitCommitDiff(hash: string, file?: string): Promise<DiffPayload> {
    return gitService.commitDiff(this.projectRoot, hash, file);
  }

  gitCommitFiles(hash: string): Promise<GitCommitFileEntry[]> {
    return gitService.commitFiles(this.projectRoot, hash);
  }

  // ── MCP management (plugin module) ──────────────────────────────────────────
  /**
   * All MCP servers for the plugin module: user-configured entries plus the
   * built-in CodeGraph server (always present, never removable). Each carries its
   * enable state (from the disable sidecar) and current runtime status.
   */
  pluginMcpList(): PluginMcpServer[] {
    const settings = resolveCurrentSettings(this.projectRoot);
    const configured = settings.mcpServers ?? {};
    const disabled = new Set(readDisabledMcp(this.projectRoot));
    const statuses = new Map(this.manager.getMcpStatus().map((s) => [s.name, s]));
    const list: PluginMcpServer[] = [];
    for (const [name, cfg] of Object.entries(configured)) {
      list.push({
        name,
        command: cfg.command,
        args: (cfg.args ?? []).join(" "),
        env: stringifyEnv(cfg.env),
        enabled: !disabled.has(name),
        // GitMCP repositories are managed from the GitMCP module: the MCP tab
        // may toggle them but never remove them (same contract as codegraph).
        builtin: name === CODEGRAPH_MCP_SERVER_NAME || isGitmcpServerName(name),
        status: statuses.get(name),
      });
    }
    // Built-in CodeGraph: shown even when a project has not run `init` yet, so it
    // can be toggled. A user-provided `codegraph` entry (handled above) wins.
    if (!Object.prototype.hasOwnProperty.call(configured, CODEGRAPH_MCP_SERVER_NAME)) {
      const cfg = buildCodegraphMcpServerConfig(this.projectRoot);
      list.push({
        name: CODEGRAPH_MCP_SERVER_NAME,
        command: cfg.command,
        args: (cfg.args ?? []).join(" "),
        env: stringifyEnv(cfg.env),
        enabled: !disabled.has(CODEGRAPH_MCP_SERVER_NAME),
        builtin: true,
        status: statuses.get(CODEGRAPH_MCP_SERVER_NAME),
      });
    }
    return list;
  }

  /** Toggle a server's enable state and re-initialize MCP so it takes effect. */
  pluginSetMcpEnabled(name: string, enabled: boolean): void {
    setMcpDisabled(this.projectRoot, name, !enabled);
    this.reload();
    this.emit(IpcEvent.McpStatusChanged);
  }

  /**
   * Persist a user MCP server to the resolved settings target (project if present,
   * else user) and reload so it launches immediately. Mirrors updateSettings — the
   * previous runtime-only upsert never wrote settings, so added servers vanished on
   * the next reload and never appeared in pluginMcpList (which reads settings).
   */
  pluginUpsertMcpServer(name: string, command: string, args?: string[], env?: Record<string, string>): void {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName || !trimmedCommand) {
      return;
    }
    const target = this.resolveSaveTarget();
    const raw = this.readTargetSettings(target);
    const servers: Record<string, McpServerConfig> = { ...(raw.mcpServers ?? {}) };
    const config: McpServerConfig = { command: trimmedCommand };
    if (args && args.length > 0) {
      config.args = args;
    }
    if (env && Object.keys(env).length > 0) {
      config.env = env;
    }
    servers[trimmedName] = config;
    const next: DeepcodingSettings = { ...raw, mcpServers: servers };
    if (target === "project") {
      writeProjectSettings(next, this.projectRoot);
    } else {
      writeSettings(next);
    }
    this.reload();
    this.emit(IpcEvent.McpStatusChanged);
  }

  /** Remove a user MCP server from the settings target and reload. */
  pluginRemoveMcpServer(name: string): void {
    const target = this.resolveSaveTarget();
    const raw = this.readTargetSettings(target);
    const servers: Record<string, McpServerConfig> = { ...(raw.mcpServers ?? {}) };
    if (!(name in servers)) {
      return;
    }
    delete servers[name];
    const next: DeepcodingSettings = { ...raw };
    if (Object.keys(servers).length > 0) {
      next.mcpServers = servers;
    } else {
      delete next.mcpServers;
    }
    if (target === "project") {
      writeProjectSettings(next, this.projectRoot);
    } else {
      writeSettings(next);
    }
    this.reload();
    this.emit(IpcEvent.McpStatusChanged);
  }

  // ── GitMCP module ──────────────────────────────────────────────────────────

  /**
   * Read the shared index metadata, falling back to the `--meta` maintenance
   * subcommand in a sqlite-capable runtime when this process (the Electron
   * main process) cannot load `node:sqlite` itself.
   */
  private readGitmcpMeta(): GitmcpRepoMeta[] {
    if (gitmcpSqliteAvailable()) {
      return readGitmcpRepoMeta();
    }
    const cmd = buildGitmcpMaintenanceCommand(["--meta"]);
    if (!cmd) {
      return [];
    }
    const res = spawnSync(cmd.command, cmd.args ?? [], {
      env: { ...process.env, ...cmd.env },
      encoding: "utf8",
      timeout: 15_000,
    });
    try {
      return JSON.parse(res.stdout.trim() || "[]") as GitmcpRepoMeta[];
    } catch {
      return [];
    }
  }

  /** Remove a repository's index data, in-process or via `--remove-index`. */
  private removeGitmcpIndex(slug: string): void {
    if (gitmcpSqliteAvailable()) {
      removeGitmcpRepoIndex(slug);
      return;
    }
    const cmd = buildGitmcpMaintenanceCommand(["--remove-index", slug]);
    if (cmd) {
      spawnSync(cmd.command, cmd.args ?? [], { env: { ...process.env, ...cmd.env }, timeout: 15_000 });
    }
  }

  /**
   * GitMCP repositories = the `gitmcp:` prefixed entries in the resolved
   * mcpServers, merged with the disable sidecar, runtime status and the local
   * index metadata (`<config root>/gitmcp/index.db`).
   */
  gitmcpList(): GitmcpRepoEntry[] {
    const configured = resolveCurrentSettings(this.projectRoot).mcpServers ?? {};
    const disabled = new Set(readDisabledMcp(this.projectRoot));
    const statuses = new Map(this.manager.getMcpStatus().map((s) => [s.name, s]));
    const metaBySlug = new Map(this.readGitmcpMeta().map((m) => [m.slug, m]));
    const entries: GitmcpRepoEntry[] = [];
    for (const name of Object.keys(configured)) {
      if (!isGitmcpServerName(name)) {
        continue;
      }
      const slug = gitmcpSlugFromServerName(name);
      const meta = metaBySlug.get(slug);
      const entry: GitmcpRepoEntry = {
        slug,
        serverName: name,
        enabled: !disabled.has(name),
        indexed: (meta?.chunkCount ?? 0) > 0,
        chunkCount: meta?.chunkCount ?? 0,
      };
      const status = statuses.get(name);
      if (status) {
        entry.status = status;
      }
      if (meta?.fetchedAt != null) {
        entry.fetchedAt = meta.fetchedAt;
      }
      entries.push(entry);
    }
    return entries.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Register a repository and activate its MCP server. The entry is written to
   * the *user-level* settings (unlike pluginUpsertMcpServer's project-first
   * target) because the index database is shared across projects anyway.
   */
  gitmcpAdd(input: string): GitmcpAddResult {
    const slug = parseRepoSlug(input);
    if (!slug) {
      return { ok: false, error: "invalid" };
    }
    const serverName = gitmcpServerNameForSlug(slug);
    const configured = resolveCurrentSettings(this.projectRoot).mcpServers ?? {};
    if (Object.keys(configured).some((name) => name.toLowerCase() === serverName.toLowerCase())) {
      return { ok: false, error: "exists" };
    }
    const raw = readSettings() ?? {};
    const servers: Record<string, McpServerConfig> = { ...(raw.mcpServers ?? {}) };
    servers[serverName] = buildGitmcpPlaceholderConfig(slug);
    writeSettings({ ...raw, mcpServers: servers });
    this.reload();
    this.emit(IpcEvent.McpStatusChanged);
    return { ok: true, slug };
  }

  /**
   * Remove a repository entirely: its MCP entry (user-level, plus project-level
   * in case one was configured there by hand) and its local index data.
   */
  gitmcpRemove(slug: string): void {
    const serverName = gitmcpServerNameForSlug(slug);
    const removeFrom = (raw: DeepcodingSettings, write: (next: DeepcodingSettings) => void): void => {
      const servers: Record<string, McpServerConfig> = { ...(raw.mcpServers ?? {}) };
      if (!(serverName in servers)) {
        return;
      }
      delete servers[serverName];
      const next: DeepcodingSettings = { ...raw };
      if (Object.keys(servers).length > 0) {
        next.mcpServers = servers;
      } else {
        delete next.mcpServers;
      }
      write(next);
    };
    removeFrom(readSettings() ?? {}, (next) => writeSettings(next));
    if (existsSync(getProjectSettingsPath(this.projectRoot))) {
      removeFrom(readProjectSettings(this.projectRoot) ?? {}, (next) => writeProjectSettings(next, this.projectRoot));
    }
    this.removeGitmcpIndex(slug);
    this.reload();
    this.emit(IpcEvent.McpStatusChanged);
  }

  /**
   * Re-fetch the repository documentation and rebuild its index — in-process
   * when this runtime has `node:sqlite`, otherwise via the `--reindex`
   * maintenance subcommand in the same sqlite-capable runtime that backs the
   * MCP server (the Electron main process lacks `node:sqlite`).
   */
  async gitmcpReindex(slug: string): Promise<{ ok: boolean; error?: string }> {
    if (gitmcpSqliteAvailable()) {
      const store = new GitmcpStore();
      try {
        await indexRepository(slug, store);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        store.close();
      }
    }
    const cmd = buildGitmcpMaintenanceCommand(["--reindex", slug]);
    if (!cmd) {
      return { ok: false, error: "No sqlite-capable Node runtime found for the GitMCP index" };
    }
    return await new Promise((resolve) => {
      execFile(
        cmd.command,
        cmd.args ?? [],
        { env: { ...process.env, ...cmd.env }, encoding: "utf8", timeout: 120_000 },
        (error, stdout) => {
          const lastLine = stdout.trim().split("\n").pop() ?? "";
          try {
            resolve(JSON.parse(lastLine) as { ok: boolean; error?: string });
          } catch {
            resolve({ ok: false, error: error ? error.message : "reindex produced no result" });
          }
        }
      );
    });
  }

  // ── Orca Built-in Plugins ─────────────────────────────────────────────────

  /** List all built-in plugins (non-removable, always available). */
  pluginBuiltinList() {
    return this.manager.listBuiltinPlugins();
  }

  /** Read a built-in plugin's PLUGIN.md instruction document by name. */
  pluginBuiltinReadDoc(name: string, locale?: string): string {
    return this.manager.readBuiltinPluginDoc(name, locale);
  }
}
