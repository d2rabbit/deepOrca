// Read-only projections of MCP / built-in-plugin state for the renderer's plugin
// tabs. Split out of SessionBridge, which had grown to 66 methods across six
// unrelated domains.
//
// Follows the git-service precedent: plain module functions taking what they need
// rather than another stateful class. Only the two *read* projections moved —
// pluginSetMcpEnabled / pluginUpsertMcpServer / pluginRemoveMcpServer stay on the
// bridge because they also need its `emit`, `reload`, `resolveSaveTarget` and
// `readTargetSettings` internals, and injecting four private members would trade
// a long file for a wide coupling surface.

import {
  A2UI_MCP_SERVER_NAME,
  ACTIVITY_FRAMES_MCP_SERVER_NAME,
  CODEGRAPH_MCP_SERVER_NAME,
  CRG_MCP_SERVER_NAME,
  SERENA_MCP_SERVER_NAME,
  SKILL_SPECTOR_MCP_SERVER_NAME,
  getSkillSpectorController,
  getSerenaController,
  hasCodegraphProject,
  isGitmcpServerName,
  resolveCurrentSettings,
} from "@deeporca/core";

/**
 * CRG (code-review-graph) is retired from the MCP surface: queries go through
 * the in-process Node SQLite reader (CrgGraphQuery), no server is spawned,
 * and the plugin center must not list it — neither a legacy configured entry
 * (filtered below) nor a synthesized display row (removed 2026-08-23).
 */
function isRetiredMcpName(name: string): boolean {
  return name === CRG_MCP_SERVER_NAME;
}
import type { BuiltinPluginInfo, McpServerConfigEntry } from "@deeporca/core";
import type { BuiltinPluginGroup, McpServerStatus, PluginMcpServer, SkillInfo } from "../shared/ipc.js";
import { readDisabledMcp } from "./mcp-store.js";

/** The slice of PluginManager these projections need. */
export type PluginViewDeps = {
  getMcpStatus(): McpServerStatus[];
  listSkills(sessionId?: string): Promise<SkillInfo[]>;
  listBuiltinPlugins(): BuiltinPluginInfo[];
  listBuiltinPluginGroups(
    skills: SkillInfo[],
    entries: McpServerConfigEntry[],
    plugins: BuiltinPluginInfo[]
  ): BuiltinPluginGroup[];
};

/** Render an env record as the `KEY=value` lines the settings UI edits. */
export function stringifyEnv(env: Record<string, string> | undefined): string {
  return env
    ? Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")
    : "";
}

export function buildPluginMcpList(projectRoot: string, deps: PluginViewDeps): PluginMcpServer[] {
  const settings = resolveCurrentSettings(projectRoot);
  const configured = settings.mcpServers ?? {};
  const disabled = new Set(readDisabledMcp(projectRoot));
  const statuses = new Map(deps.getMcpStatus().map((s) => [s.name, s]));
  const list: PluginMcpServer[] = [];
  for (const [name, cfg] of Object.entries(configured)) {
    if (isRetiredMcpName(name)) continue;
    list.push({
      name,
      command: cfg.command,
      args: (cfg.args ?? []).join(" "),
      env: stringifyEnv(cfg.env),
      enabled: !disabled.has(name),
      // GitMCP repositories are managed from the GitMCP module: the MCP tab
      // may toggle them but never remove them (same contract as codegraph).
      builtin:
        name === CODEGRAPH_MCP_SERVER_NAME ||
        name === SERENA_MCP_SERVER_NAME ||
        name === SKILL_SPECTOR_MCP_SERVER_NAME ||
        name === ACTIVITY_FRAMES_MCP_SERVER_NAME ||
        name === A2UI_MCP_SERVER_NAME ||
        isGitmcpServerName(name),
      status: statuses.get(name),
    });
  }
  // Built-in CodeGraph: shown even when a project has not run `init` yet, so it
  // can be toggled. Now in-process (SDK-backed) — show as initialized or not.
  if (!Object.prototype.hasOwnProperty.call(configured, CODEGRAPH_MCP_SERVER_NAME)) {
    list.push({
      name: CODEGRAPH_MCP_SERVER_NAME,
      command: "(in-process SDK)",
      args: hasCodegraphProject(projectRoot) ? "initialized" : "not initialized",
      env: "",
      enabled: !disabled.has(CODEGRAPH_MCP_SERVER_NAME),
      builtin: true,
      status: statuses.get(CODEGRAPH_MCP_SERVER_NAME),
    });
  }
  // Built-in CRG display row removed (2026-08-23): CRG queries run through the
  // in-process CrgGraphQuery SQLite reader — no MCP server exists to list.
  // Built-in Serena MCP server: semantic code operations (find symbol,
  // references, rename, replace body). Shown when uv is available
  // (vendored or system). Covers 40+ languages via SolidLSP.
  if (!Object.prototype.hasOwnProperty.call(configured, SERENA_MCP_SERVER_NAME)) {
    const cfg = getSerenaController()?.buildMcpServerConfig(projectRoot) ?? null;
    if (cfg) {
      list.push({
        name: SERENA_MCP_SERVER_NAME,
        command: cfg.command,
        args: (cfg.args ?? []).join(" "),
        env: stringifyEnv(cfg.env),
        enabled: !disabled.has(SERENA_MCP_SERVER_NAME),
        builtin: true,
        status: statuses.get(SERENA_MCP_SERVER_NAME),
      });
    }
  }
  // Built-in SkillSpector MCP server: AI skill/MCP security scanner. Shown when uv
  // is available (vendored or system) — installed from git+SHA on first use (the PyPI
  // package is malware). Exposes `scan_skill`; defaults to pure-static (use_llm=false).
  if (!Object.prototype.hasOwnProperty.call(configured, SKILL_SPECTOR_MCP_SERVER_NAME)) {
    const cfg = getSkillSpectorController()?.buildMcpServerConfig(projectRoot) ?? null;
    if (cfg) {
      list.push({
        name: SKILL_SPECTOR_MCP_SERVER_NAME,
        command: cfg.command,
        args: (cfg.args ?? []).join(" "),
        env: stringifyEnv(cfg.env),
        enabled: !disabled.has(SKILL_SPECTOR_MCP_SERVER_NAME),
        builtin: true,
        status: statuses.get(SKILL_SPECTOR_MCP_SERVER_NAME),
      });
    }
  }
  return list;
}

/**
 * Resolve built-in plugin groups: related skills, MCP servers, and plugin
 * descriptors bundled into display cards. Display-only — never affects
 * loading or execution. Built-in MCP entries are included so a group shows
 * its full toolset even before the user adds a server.
 */
export async function buildBuiltinPluginGroups(
  projectRoot: string,
  deps: PluginViewDeps
): Promise<BuiltinPluginGroup[]> {
  const skills = await deps.listSkills(undefined);
  const plugins = deps.listBuiltinPlugins();

  // Reconstruct McpServerConfigEntry[] from the same sources as pluginMcpList,
  // so built-in servers (codegraph, CRG, gitmcp:*) appear in their groups.
  const settings = resolveCurrentSettings(projectRoot);
  const configured = settings.mcpServers ?? {};
  const disabled = new Set(readDisabledMcp(projectRoot));
  const statuses = new Map(deps.getMcpStatus().map((s) => [s.name, s]));
  const isBuiltin = (name: string): boolean =>
    name === CODEGRAPH_MCP_SERVER_NAME ||
    name === SERENA_MCP_SERVER_NAME ||
    name === SKILL_SPECTOR_MCP_SERVER_NAME ||
    name === ACTIVITY_FRAMES_MCP_SERVER_NAME ||
    name === A2UI_MCP_SERVER_NAME ||
    isGitmcpServerName(name);
  const entries: McpServerConfigEntry[] = Object.entries(configured)
    .filter(([name]) => !isRetiredMcpName(name))
    .map(([name, cfg]) => ({
      name,
      config: cfg,
      builtin: isBuiltin(name),
      enabled: !disabled.has(name),
      status: statuses.get(name)?.status,
    }));
  // Built-in servers not yet configured by the user (codegraph, CRG, dart)
  // are synthesized from their builders so the group card lists them regardless.
  // Each carries enabled/status so the group detail can show a toggle + state dot.
  if (!Object.prototype.hasOwnProperty.call(configured, CODEGRAPH_MCP_SERVER_NAME)) {
    entries.push({
      name: CODEGRAPH_MCP_SERVER_NAME,
      config: { command: "(in-process SDK)", args: [] },
      builtin: true,
      enabled: !disabled.has(CODEGRAPH_MCP_SERVER_NAME),
      status: statuses.get(CODEGRAPH_MCP_SERVER_NAME)?.status,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(configured, SERENA_MCP_SERVER_NAME)) {
    const cfg = getSerenaController()?.buildMcpServerConfig(projectRoot) ?? null;
    if (cfg)
      entries.push({
        name: SERENA_MCP_SERVER_NAME,
        config: cfg,
        builtin: true,
        enabled: !disabled.has(SERENA_MCP_SERVER_NAME),
        status: statuses.get(SERENA_MCP_SERVER_NAME)?.status,
      });
  }
  if (!Object.prototype.hasOwnProperty.call(configured, SKILL_SPECTOR_MCP_SERVER_NAME)) {
    const cfg = getSkillSpectorController()?.buildMcpServerConfig(projectRoot) ?? null;
    if (cfg)
      entries.push({
        name: SKILL_SPECTOR_MCP_SERVER_NAME,
        config: cfg,
        builtin: true,
        enabled: !disabled.has(SKILL_SPECTOR_MCP_SERVER_NAME),
        status: statuses.get(SKILL_SPECTOR_MCP_SERVER_NAME)?.status,
      });
  }
  // Activity-Frames is an in-process MCP server (no command/args). Synthesize a
  // display-only entry so it appears in the "documentation" group card.
  if (!Object.prototype.hasOwnProperty.call(configured, ACTIVITY_FRAMES_MCP_SERVER_NAME)) {
    entries.push({
      name: ACTIVITY_FRAMES_MCP_SERVER_NAME,
      config: { command: "(in-process)", args: [] },
      builtin: true,
      enabled: !disabled.has(ACTIVITY_FRAMES_MCP_SERVER_NAME),
      status: statuses.get(ACTIVITY_FRAMES_MCP_SERVER_NAME)?.status,
    });
  }
  // A2UI is an in-process MCP server (no command/args). Synthesize a
  // display-only entry so it appears in the "design" group card.
  if (!Object.prototype.hasOwnProperty.call(configured, A2UI_MCP_SERVER_NAME)) {
    entries.push({
      name: A2UI_MCP_SERVER_NAME,
      config: { command: "(in-process)", args: [] },
      builtin: true,
      enabled: !disabled.has(A2UI_MCP_SERVER_NAME),
      status: statuses.get(A2UI_MCP_SERVER_NAME)?.status,
    });
  }

  // Only consider built-in skills for grouping; user skills stay in the
  // Skills tab. Built-in skills have either a "bundled:" or "plugin:" path prefix.
  const builtinSkills = skills.filter((s) => s.path.startsWith("bundled:") || s.pluginOwned);
  return deps.listBuiltinPluginGroups(builtinSkills, entries, plugins);
}

/** Toggle a server's enable state and re-initialize MCP so it takes effect. */
