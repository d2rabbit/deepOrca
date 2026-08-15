// Wraps a DeepOrca core `SessionManager` for a single project root and forwards
// its callbacks to the renderer via the provided `emit` function.

import { collectProfile, formatContextBlock } from "./tools/activity-frames/collectors/aggregator";
import {
  buildGitmcpMaintenanceCommand,
  buildGitmcpPlaceholderConfig,
  CODEGRAPH_MCP_SERVER_NAME,
  CRG_MCP_SERVER_NAME,
  SERENA_MCP_SERVER_NAME,
  setSerenaDisabled,
  SKILL_SPECTOR_MCP_SERVER_NAME,
  setSkillSpectorDisabled,
  A2UI_MCP_SERVER_NAME,
  setCrgDisabled,
  createOpenAIClient,
  getEnvVar,
  getProjectSettingsPath,
  getUserSettingsPath,
  gitmcpServerNameForSlug,
  gitmcpSlugFromServerName,
  isGitmcpServerName,
  normalizeEndpoints,
  parseRepoSlug,
  readProjectSettings,
  readSettings,
  resolveCurrentSettings,
  SessionManager,
  setCodegraphDisabled,
  setA2uiDisabled,
  configureFileUtilsWriteBoundary,
  writeModelConfigSelection,
  writeProjectSettings,
  writeSettings,
} from "@deeporca/core";
import type { MemoryProvider } from "@deeporca/core";
import { GitmcpStore, gitmcpSqliteAvailable, readGitmcpRepoMeta, removeGitmcpRepoIndex } from "./tools/gitmcp/store.js";
import { indexRepository } from "./tools/gitmcp/indexer.js";
import type { GitmcpRepoMeta } from "./tools/gitmcp/store.js";
import type {
  BuiltinPluginGroup,
  DeepcodingSettings,
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
import { existsSync, realpathSync } from "node:fs";
import { execFile, spawnSync } from "node:child_process";
import { IpcEvent } from "../shared/ipc.js";
import type { WorkspaceTrustLevel, WorkspaceTrustStatus } from "../shared/ipc.js";
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
import { buildBuiltinPluginGroups, buildPluginMcpList, stringifyEnv } from "./plugin-mcp-view.js";
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

/** Trust state for the UI: `explicit: false` means never asked (first open). */
export function readWorkspaceTrustStatus(root: string): WorkspaceTrustStatus {
  const explicitTrust = readProjectSettings(root)?.workspaceTrust;
  return {
    level: resolveCurrentSettings(root).workspaceTrust,
    explicit: explicitTrust === "trusted" || explicitTrust === "quarantine",
  };
}

/** Trust is inherently project-level — always writes the project file. */
export function writeWorkspaceTrust(level: WorkspaceTrustLevel, root: string): void {
  const raw = readProjectSettings(root) ?? {};
  writeProjectSettings({ ...raw, workspaceTrust: level }, root);
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
    endpoints: s.endpoints.map((e) => ({ id: e.id, name: e.name, baseURL: e.baseURL, models: e.models })),
    primaryEndpointId: s.primaryEndpointId,
    secondaryModel: s.secondaryModel,
    secondaryEndpointId: s.secondaryEndpointId,
    visionModel: s.visionModel,
    visionEndpointId: s.visionEndpointId,
    workspaceTrust: s.workspaceTrust,
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
    // Bottom-line write boundary for direct file-utils imports (P0 task 5,
    // specs/sandbox/design.md §4.1(c)): host injection, core stays dormant so
    // tests stay hermetic. Handler flows carry their per-call pathGrant, so an
    // authorized out-of-roots write is not affected.
    configureFileUtilsWriteBoundary([realpathSync(projectRoot)]);
    return new SessionManager({
      // Sandbox degradation must be visible (design constraint 6): the
      // audit log records it, this event surfaces it in the renderer.
      onSandboxStatusChanged: (status) => {
        this.emit(IpcEvent.SandboxStatusChanged, status);
      },
      projectRoot,
      createOpenAIClient: () => createOpenAIClient(projectRoot),
      getResolvedSettings: () => resolveCurrentSettings(projectRoot),
      // Behavioral-memory boot context (activity-frames pipeline B, opt-in via
      // settings.behaviorContext): desktop owns the collectors, core consumes
      // the compact block — same host-injection seam pattern as memory recall.
      buildBehaviorContext: () => {
        try {
          return formatContextBlock(collectProfile(projectRoot));
        } catch {
          return null; // fail-open
        }
      },
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
    // The memory provider is bound per-bridge (not per-manager) so it survives
    // manager recreation. createManager() already re-applies it via
    // rebindMemoryProvider(); the desktop main reconciles the actual
    // start/stop of the memory manager on project change.
    this.rebindMemoryProvider();
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
    this.rebindMemoryProvider();
    this.initMcp();
    if (active) {
      this.manager.setActiveSessionId(active);
    }
  }

  /** The memory provider, retained across manager recreations (reload/switch).
   *  Without this, saving any settings or switching projects detached the
   *  provider (the new manager had memoryProvider=null) while the global
   *  memoryManager still reported healthy — a silent regression. */
  private memoryProvider: MemoryProvider | null = null;

  /** Re-apply the retained provider to the current manager. Called after every
   *  manager recreation. */
  private rebindMemoryProvider(): void {
    this.manager.setMemoryProvider(this.memoryProvider);
  }

  /** Set the memory provider on this bridge AND the current manager. The bridge
   *  retains it so a later reload()/setProjectRoot() re-binds it on the new
   *  manager instead of dropping it. */
  setMemoryProvider(provider: MemoryProvider | null): void {
    this.memoryProvider = provider;
    this.manager.setMemoryProvider(provider);
  }

  /**
   * Call an MCP tool directly (outside the agent loop). Used by A2UI to
   * forward user interactions (a2ui_action) back to the agent.
   */
  async callMcpTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.manager.executeMcpTool(serverName, toolName, args);
  }

  dispose(): void {
    this.manager.dispose();
  }

  /**
   * (Re)initialize MCP servers honoring the desktop-only disable sidecar. The
   * built-in CodeGraph and CRG opt-outs are pushed into core (which
   * auto-registers them), and user-configured servers marked disabled are
   * filtered out before init.
   */
  private initMcp(): void {
    const disabled = readDisabledMcp(this.projectRoot);
    setCodegraphDisabled(this.projectRoot, disabled.includes(CODEGRAPH_MCP_SERVER_NAME));
    setCrgDisabled(this.projectRoot, disabled.includes(CRG_MCP_SERVER_NAME));
    setSerenaDisabled(this.projectRoot, disabled.includes(SERENA_MCP_SERVER_NAME));
    setSkillSpectorDisabled(this.projectRoot, disabled.includes(SKILL_SPECTOR_MCP_SERVER_NAME));
    // A2UI is toggleable in the plugin UI and has a core disable gate, but the
    // disable state was never propagated here — so disabling it and reloading
    // reconnected the server. Propagate it like the other built-ins.
    setA2uiDisabled(this.projectRoot, disabled.includes(A2UI_MCP_SERVER_NAME));
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

  /**
   * User-configured MCP servers minus any disabled by the desktop sidecar.
   * Public so {@link PluginManager} applies the same disable filter that
   * {@link initMcp} uses — without this, PluginManager.initialize() would
   * re-init previously-disabled servers via the raw (unfiltered) settings,
   * bypassing the user's disable choice.
   */
  getEffectiveMcpServers(): Record<string, McpServerConfig> | undefined {
    return this.effectiveMcpServers();
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

  pause(): { sessionId: string | null } {
    return { sessionId: this.manager.pauseActiveSession() };
  }

  async resume(sessionId: string): Promise<void> {
    await this.manager.resumeSession(sessionId);
  }

  enhancePrompt(text: string): Promise<string> {
    return this.manager.enhancePrompt(text);
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

  getWorkspaceTrust(): WorkspaceTrustStatus {
    return readWorkspaceTrustStatus(this.projectRoot);
  }

  setWorkspaceTrust(level: WorkspaceTrustLevel): void {
    writeWorkspaceTrust(level, this.projectRoot);
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
      // Read endpoints directly from the target settings file (raw, normalized),
      // never the env-resolved merged list. This prevents:
      //   1. env-provided API keys from leaking to the renderer / being baked
      //      into the file on save (violates the EditableSettings contract);
      //   2. user-level endpoints + keys being written into the project file;
      //   3. the synthesized default (carrying the env key) reaching the GUI.
      endpoints: normalizeEndpoints(raw.endpoints),
      primaryEndpointId: raw.primaryEndpointId ?? "",
      secondaryModel: raw.secondaryModel ?? "",
      secondaryEndpointId: raw.secondaryEndpointId ?? "",
      visionModel: raw.visionModel ?? "",
      visionEndpointId: raw.visionEndpointId ?? "",
      memory: {
        enabled: raw.memory?.enabled ?? false,
        port: raw.memory?.port ?? 8420,
        embedding: raw.memory?.embedding ?? "none",
      },
    };
  }

  updateSettings(patch: EditableSettings): { summary: SettingsSummary; editable: EditableSettings } {
    const target = patch.saveTarget;
    const raw = this.readTargetSettings(target);
    const next: DeepcodingSettings = { ...raw };

    const env: Record<string, string | undefined> = { ...(raw.env ?? {}) };

    // Multi-endpoint: normalize then write the endpoint list + role assignments.
    // normalizeEndpoints guards against malformed/empty-id/duplicate entries
    // coming from the GUI (e.g. two adds in the same millisecond).
    const endpoints = normalizeEndpoints(patch.endpoints);
    if (endpoints.length > 0) {
      next.endpoints = endpoints;
      // Only persist role ids that actually point at a kept endpoint.
      const ids = new Set(endpoints.map((e) => e.id));
      const primaryId = ids.has(patch.primaryEndpointId) ? patch.primaryEndpointId : endpoints[0]!.id;
      next.primaryEndpointId = primaryId;
      next.secondaryModel = patch.secondaryModel.trim(); // empty = inherit primary
      next.secondaryEndpointId = ids.has(patch.secondaryEndpointId) ? patch.secondaryEndpointId : primaryId;
      next.visionModel = patch.visionModel.trim(); // empty = disabled
      next.visionEndpointId = ids.has(patch.visionEndpointId) ? patch.visionEndpointId : primaryId;
      // Sync the primary endpoint's key + baseURL into env so createOpenAIClient
      // (which reads env.API_KEY / env.BASE_URL) picks up the primary config.
      // NOTE: if an env key is already provided externally (DEEPORCA_API_KEY),
      // resolveSettingsSources will still let env win — this env.API_KEY is a
      // file-level mirror for the legacy single-client code path.
      const primary = endpoints.find((e) => e.id === primaryId);
      if (primary) {
        env.API_KEY = primary.apiKey.trim() || undefined;
        env.BASE_URL = primary.baseURL.trim() || undefined;
      }
    } else {
      delete next.endpoints;
      delete next.primaryEndpointId;
    }

    // Also keep env.API_KEY in sync with the legacy single apiKey field (when
    // the panel edits it directly via the old field). The endpoints block above
    // takes precedence when present.
    const apiKey = patch.apiKey.trim();
    if (apiKey && !next.endpoints) {
      env.API_KEY = apiKey;
    } else if (!apiKey && !next.endpoints) {
      delete env.API_KEY;
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

    // Memory settings
    if (patch.memory) {
      next.memory = {
        enabled: patch.memory.enabled,
        port: patch.memory.port || 8420,
        embedding: patch.memory.embedding ?? "none",
      };
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

  /** Knowledge-source freshness timestamps, for the knowledge dashboard. */
  getKnowledgeFreshness() {
    return this.manager.getKnowledgeFreshness();
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
    return buildPluginMcpList(this.projectRoot, this.manager);
  }

  async pluginBuiltinGroups(): Promise<BuiltinPluginGroup[]> {
    return buildBuiltinPluginGroups(this.projectRoot, this.manager);
  }

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
