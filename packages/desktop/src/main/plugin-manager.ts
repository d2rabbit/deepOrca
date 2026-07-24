// Unified Plugin Manager – composes MCP (Model Context Protocol) server management
// and Skill discovery/loading into a single extensible module. Both MCP servers and
// Skill directories are treated as "plugins" with a common lifecycle.
//
// Architecture:
//   PluginManager
//     ├── McpPluginSource    ← wraps core McpManager (MCP servers)
//     └── SkillPluginSource  ← wraps core SessionManager.listSkills (Skill dirs)
//     └── emit()             ← forwards status changes to the renderer
//
// This module lives in the *main* process (Node.js) and communicates with the
// renderer via IPC (see ../shared/ipc.ts).

import type { McpServerConfig, McpServerStatus, SessionManager, SkillInfo } from "@vegamo/deepcode-core";

// ── Plugin status events ──────────────────────────────────────────────────────

export type PluginEvent =
  | { type: "mcp:status-changed"; payload: McpServerStatus[] }
  | { type: "mcp:server-error"; payload: { name: string; error: string } }
  | { type: "skills:changed"; payload: SkillInfo[] }
  | { type: "plugin:error"; payload: { source: string; error: string } };

export type PluginEventCallback = (event: PluginEvent) => void;

// ── Plugin Manager ────────────────────────────────────────────────────────────

export class PluginManager {
  private mcpServerConfigs: Record<string, McpServerConfig> = {};
  private skillsCache: SkillInfo[] = [];
  private onEvent: PluginEventCallback | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly getSessionManager: () => SessionManager | null,
    private readonly getSettings: () => {
      mcpServers?: Record<string, McpServerConfig>;
      enabledSkills?: Record<string, boolean>;
    }
  ) {}

  /** Register a callback for plugin lifecycle events. */
  setOnEvent(cb: PluginEventCallback): void {
    this.onEvent = cb;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Initialize MCP servers from current settings. Call after settings change. */
  async initialize(): Promise<void> {
    const settings = this.getSettings();
    const sm = this.getSessionManager();
    if (sm) {
      await sm.initMcpServers(settings.mcpServers);
    }
    this.mcpServerConfigs = { ...(settings.mcpServers ?? {}) };
    this.skillsCache = await this.refreshSkills();
    this.startPolling();
    this.emitMcpStatus();
    this.emitSkillsChanged();
  }

  /** Full dispose – disconnect MCP, stop polling. */
  dispose(): void {
    this.stopPolling();
    const sm = this.getSessionManager();
    if (sm) {
      sm.dispose();
    }
    this.mcpServerConfigs = {};
    this.skillsCache = [];
  }

  // ── MCP operations ─────────────────────────────────────────────────────────

  /** Return cached MCP server statuses. */
  getMcpStatus(): McpServerStatus[] {
    const sm = this.getSessionManager();
    return sm?.getMcpStatus() ?? [];
  }

  /** Trigger a reconnect for a given MCP server. */
  async reconnectMcp(name: string): Promise<void> {
    const sm = this.getSessionManager();
    if (!sm) return;
    const config = this.mcpServerConfigs[name];
    try {
      await sm.reconnectMcpServer(name, config);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.emit({ type: "mcp:server-error", payload: { name, error: msg } });
    }
    this.emitMcpStatus();
  }

  /** Add or update an MCP server config and reconnect. */
  async upsertMcpServer(name: string, config: McpServerConfig): Promise<void> {
    this.mcpServerConfigs[name] = config;
    await this.reconnectMcp(name);
  }

  /** Remove an MCP server config. */
  async removeMcpServer(name: string): Promise<void> {
    delete this.mcpServerConfigs[name];
    // The SessionManager will clean up on next initMcpServers call.
    // For immediate effect, we call dispose + re-init.
    const sm = this.getSessionManager();
    if (sm) {
      sm.dispose();
      await sm.initMcpServers(this.mcpServerConfigs);
    }
    this.emitMcpStatus();
  }

  // ── Skill operations ───────────────────────────────────────────────────────

  /** Return cached skills, optionally filtered by session. */
  listSkills(_sessionId?: string): SkillInfo[] {
    return this.skillsCache;
  }

  /** Force-refresh skills from disk. */
  async refreshSkills(sessionId?: string): Promise<SkillInfo[]> {
    const sm = this.getSessionManager();
    if (!sm) {
      this.skillsCache = [];
      return this.skillsCache;
    }
    this.skillsCache = await sm.listSkills(sessionId);
    this.emitSkillsChanged();
    return this.skillsCache;
  }

  /** Read a skill's raw SKILL.md markdown by its display path (for the plugin detail pane). */
  readSkillDoc(path: string, locale?: string): string {
    const sm = this.getSessionManager();
    if (!sm) return "";
    try {
      return sm.readSkillDocument(path, locale);
    } catch {
      return "";
    }
  }

  /** Search skills by keyword (name or description, case-insensitive).
      Uses cached skills; call refreshSkills() first for up-to-date results. */
  searchSkills(query: string, _sessionId?: string): SkillInfo[] {
    const source = this.skillsCache;
    if (!query.trim()) return source;
    const lower = query.toLowerCase();
    return source.filter((s) => s.name.toLowerCase().includes(lower) || s.description.toLowerCase().includes(lower));
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private emitMcpStatus(): void {
    this.emit({
      type: "mcp:status-changed",
      payload: this.getMcpStatus(),
    });
  }

  private emitSkillsChanged(): void {
    this.emit({
      type: "skills:changed",
      payload: this.skillsCache,
    });
  }

  private emit(event: PluginEvent): void {
    this.onEvent?.(event);
  }

  /** Poll MCP status every 5 s to pick up latent changes (e.g. crash). */
  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.emitMcpStatus();
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
