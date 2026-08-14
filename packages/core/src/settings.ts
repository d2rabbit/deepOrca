import { randomUUID } from "node:crypto";
import { defaultsToThinkingMode, DEEPSEEK_V4_MODELS, NON_MULTIMODAL_MODELS } from "./common/model-capabilities";
import { getProjectConfigRoot, getUserConfigRoot } from "./common/app-dirs";
import * as fs from "fs";
import * as path from "path";

export type DeepcodingEnv = Record<string, string | undefined> & {
  MODEL?: string;
  BASE_URL?: string;
  API_KEY?: string;
  TEMPERATURE?: string;
  THINKING_ENABLED?: string;
  REASONING_EFFORT?: string;
  DEBUG_LOG_ENABLED?: string;
  TELEMETRY_ENABLED?: string;
  STREAM_IDLE_TIMEOUT_MS?: string;
};

export type ReasoningEffort = "high" | "max";

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type PermissionScope =
  | "read-in-cwd"
  | "read-out-cwd"
  | "write-in-cwd"
  | "write-out-cwd"
  | "delete-in-cwd"
  | "delete-out-cwd"
  | "query-git-log"
  | "mutate-git-log"
  | "network"
  | "mcp";

export type PermissionDefaultMode = "allowAll" | "askAll";

export type PermissionSettings = {
  allow?: PermissionScope[];
  deny?: PermissionScope[];
  ask?: PermissionScope[];
  defaultMode?: PermissionDefaultMode;
};

export type EnabledSkillsSettings = Record<string, boolean>;

export type StatusLineProviderConfig =
  | {
      type: "command";
      id?: string;
      command: string;
      cwd?: string;
      timeoutMs?: number;
      color?: string;
      newLine?: boolean;
      maxLength?: number;
    }
  | {
      type: "module";
      id?: string;
      path: string;
      timeoutMs?: number;
      color?: string;
      newLine?: boolean;
      maxLength?: number;
    };

export type StatusLineSettings = {
  enabled?: boolean;
  refreshMs?: number;
  separator?: string;
  providers?: StatusLineProviderConfig[];
};

export type ResolvedStatusLineSettings = {
  enabled: boolean;
  refreshMs: number;
  separator: string;
  providers: StatusLineProviderConfig[];
};

/** Memory integration settings (TencentDB-Agent-Memory Gateway). */
export type MemorySettings = {
  /** Enable cross-session memory (default: false — opt-in). */
  enabled?: boolean;
  /** User ID for multi-user isolation (default: machine hostname). */
  userId?: string;
  /** Gateway port (default: 8420). */
  port?: number;
  /** Bearer token for Gateway auth (optional). */
  apiKey?: string;
  /**
   * Embedding provider for vector recall:
   * - `"none"` (default): no embedding, vector search disabled (BM25/FTS only).
   * - `"local-onnx"`: Granite 97M R2 local embedding via @deeporca/embedding.
   *   Enables hybrid vector+keyword recall. The model is vendored at build time;
   *   setting this to "local-onnx" starts the model in the background.
   *   Set back to "none" to stop the model and revert to keyword-only recall.
   */
  embedding?: "none" | "local-onnx";
};

export type DeepcodingSettings = {
  env?: DeepcodingEnv;
  model?: string;
  temperature?: number;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  debugLogEnabled?: boolean;
  telemetryEnabled?: boolean;
  notify?: string;
  webSearchTool?: string;
  mcpServers?: Record<string, McpServerConfig>;
  permissions?: PermissionSettings;
  enabledSkills?: EnabledSkillsSettings;
  statusline?: StatusLineSettings;
  memory?: MemorySettings;
  /** Multi-endpoint configuration (new). When absent, a single default DeepSeek
   * endpoint is synthesized from env.API_KEY + env.BASE_URL (backward compat). */
  endpoints?: EndpointConfig[];
  /** Which endpoint the primary (main conversation) model uses. */
  primaryEndpointId?: string;
  /** Secondary model name (code review, indexing, subagent). Default: flash. */
  secondaryModel?: string;
  /** Which endpoint the secondary model uses. Falls back to primary if unset. */
  secondaryEndpointId?: string;
  /** Vision model for the built-in vision MCP plugin. Empty = disabled. */
  visionModel?: string;
  /** Which endpoint the vision model uses. Falls back to primary if unset. */
  visionEndpointId?: string;
  /** Skill/tool routing config (embedding-based context reduction). */
  routing?: RoutingSettings;
  /**
   * Max silence allowed between two reads of an LLM stream before the request
   * is considered stalled and aborted (idle watchdog). Milliseconds.
   * Default: 300000 (5 minutes) — long enough for extended thinking pauses.
   */
  streamIdleTimeoutMs?: number;
};

/**
 * Routing settings — controls embedding-based skill/tool recall.
 * All fields optional; merged with DEFAULT_ROUTING_CONFIG at runtime.
 */
export type RoutingSettings = {
  /** Master switch (default true). */
  enabled?: boolean;
  /** G1: skill shortlist size (default 8). */
  skillTopK?: number;
  /** G1: skip routing when candidate count ≤ this (default 12). */
  skillMinPool?: number;
  /** G2: MCP tool gating switch (default true). */
  mcpToolGating?: boolean;
  /** G2: token budget threshold for full injection (default 2000). */
  mcpTokenBudget?: number;
  /** G2: server names that always pass through (never gated). */
  pinnedServers?: string[];
};

export type ResolvedDeepcodingSettings = {
  env: Record<string, string>;
  apiKey?: string;
  baseURL: string;
  model: string;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  mcpServers?: Record<string, McpServerConfig>;
  permissions: Required<PermissionSettings>;
  enabledSkills: EnabledSkillsSettings;
  statusline: ResolvedStatusLineSettings;
  memory: Required<MemorySettings>;
  /** Resolved endpoint list (synthesized from env if not configured). */
  endpoints: EndpointConfig[];
  /** Endpoint id used by the primary model. */
  primaryEndpointId: string;
  /** Secondary model name (default deepseek-v4-flash). */
  secondaryModel: string;
  /** Endpoint id used by the secondary model. */
  secondaryEndpointId: string;
  /** Resolved secondary endpoint config (baseURL + apiKey). */
  secondaryBaseURL: string;
  secondaryApiKey?: string;
  /** Vision model for built-in vision MCP plugin. Empty = disabled. */
  visionModel: string;
  /** Endpoint id used by the vision model. */
  visionEndpointId: string;
  /** Resolved vision endpoint config (baseURL + apiKey). */
  visionBaseURL: string;
  visionApiKey?: string;
  /** LLM stream idle watchdog timeout in ms (default 300000). */
  streamIdleTimeoutMs: number;
};

export type ModelConfigSelection = {
  model: string;
  /** Endpoint the selected model lives on. When set, primaryEndpointId is
   *  updated atomically with model so requests route to the right provider.
   *  Optional for backward compat with callers that only know the model. */
  endpointId?: string;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
};

export type SettingsProcessEnv = Record<string, string | undefined>;

function resolveReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === "high" || value === "max" ? value : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "enabled", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "disabled", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseTemperature(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw < 0 || raw > 2) {
    return undefined;
  }
  return raw;
}

function parsePositiveInteger(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(raw) || raw <= 0) {
    return undefined;
  }
  return raw;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const VALID_PERMISSION_SCOPES = new Set<PermissionScope>([
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
]);

function normalizePermissionList(value: unknown): PermissionScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: PermissionScope[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !VALID_PERMISSION_SCOPES.has(item as PermissionScope)) {
      continue;
    }
    const scope = item as PermissionScope;
    if (!result.includes(scope)) {
      result.push(scope);
    }
  }
  return result;
}

function mergePermissionLists(...lists: Array<PermissionScope[] | undefined>): PermissionScope[] {
  const result: PermissionScope[] = [];
  for (const list of lists) {
    for (const scope of list ?? []) {
      if (!result.includes(scope)) {
        result.push(scope);
      }
    }
  }
  return result;
}

function normalizePermissionDefaultMode(value: unknown): PermissionDefaultMode | undefined {
  return value === "allowAll" || value === "askAll" ? value : undefined;
}

function normalizePermissions(settings: PermissionSettings | null | undefined): Required<PermissionSettings> {
  return {
    allow: normalizePermissionList(settings?.allow),
    deny: normalizePermissionList(settings?.deny),
    ask: normalizePermissionList(settings?.ask),
    defaultMode: normalizePermissionDefaultMode(settings?.defaultMode) ?? "allowAll",
  };
}

function mergePermissions(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): Required<PermissionSettings> {
  const userPermissions = normalizePermissions(userSettings?.permissions);
  const projectPermissions = normalizePermissions(projectSettings?.permissions);
  // Choose the effective default mode BEFORE applying the fail-closed guard:
  // project > user > allowAll (first-run). The guard then upgrades it to
  // askAll if the underlying settings file was corrupt/unreadable, so a parse
  // error can never silently downgrade a restrictive policy to allowAll.
  const effectiveDefault: PermissionDefaultMode = projectSettings?.permissions
    ? projectPermissions.defaultMode
    : userSettings?.permissions
      ? userPermissions.defaultMode
      : "allowAll";
  return {
    allow: mergePermissionLists(userPermissions.allow, projectPermissions.allow),
    deny: mergePermissionLists(userPermissions.deny, projectPermissions.deny),
    ask: mergePermissionLists(userPermissions.ask, projectPermissions.ask),
    defaultMode: failClosedPermissionDefault(effectiveDefault),
  };
}

function normalizeEnabledSkills(value: unknown): EnabledSkillsSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: EnabledSkillsSettings = {};
  for (const [name, enabled] of Object.entries(value)) {
    if (!name || typeof enabled !== "boolean") {
      continue;
    }
    result[name] = enabled;
  }
  return result;
}

function mergeEnabledSkills(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): EnabledSkillsSettings {
  return {
    ...normalizeEnabledSkills(userSettings?.enabledSkills),
    ...normalizeEnabledSkills(projectSettings?.enabledSkills),
  };
}

const DEFAULT_STATUSLINE_REFRESH_MS = 2000;
const MIN_STATUSLINE_REFRESH_MS = 500;
const DEFAULT_STATUSLINE_SEPARATOR = " · ";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Multi-endpoint normalization & merge ──────────────────────────────────

/**
 * Normalize an untrusted `endpoints` value from a settings file into a clean
 * {@link EndpointConfig} array. Rejects non-arrays, non-object or
 * field-missing entries, and drops duplicate ids (keeping the first).
 *
 * Mirrors the existing pattern of `normalizeEnabledSkills` /
 * `normalizePermissionList`: validate untrusted JSON before use so a
 * syntactically-valid-but-malformed file cannot crash `resolveCurrentSettings`.
 */
export function normalizeEndpoints(value: unknown): EndpointConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: EndpointConfig[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const baseURL = typeof entry.baseURL === "string" ? entry.baseURL.trim() : "";
    // id/name/baseURL are required; skip entries missing any of them.
    if (!id || !name || !baseURL) {
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const apiKey = typeof entry.apiKey === "string" ? entry.apiKey : "";
    // Parse models array — each model has {id, thinking?, vision?}
    const models: ModelRegistration[] = [];
    if (Array.isArray(entry.models)) {
      const modelSeen = new Set<string>();
      for (const m of entry.models) {
        if (!isPlainObject(m)) continue;
        const mid = typeof m.id === "string" ? m.id.trim() : "";
        if (!mid || modelSeen.has(mid)) continue;
        modelSeen.add(mid);
        models.push({
          id: mid,
          thinking: typeof m.thinking === "boolean" ? m.thinking : undefined,
          vision: typeof m.vision === "boolean" ? m.vision : undefined,
        });
      }
    }
    result.push({ id, name, baseURL, apiKey, models: models.length > 0 ? models : undefined });
  }
  return result;
}

/**
 * Merge user-level and project-level endpoints, with project overriding user
 * for matching ids (mirrors `mergeStatusLine`'s provider de-dup). Returns the
 * combined list; primary/secondary lookups later use `find()`, so order does
 * not affect resolution.
 */
function mergeEndpoints(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): EndpointConfig[] {
  const userEps = normalizeEndpoints(userSettings?.endpoints);
  const projectEps = normalizeEndpoints(projectSettings?.endpoints);
  const projectIds = new Set(projectEps.map((e) => e.id));
  return [...userEps.filter((e) => !projectIds.has(e.id)), ...projectEps];
}

function normalizeStatusLineProvider(value: unknown): StatusLineProviderConfig | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const type = value["type"];
  const idRaw = trimString(value["id"]);
  const id = idRaw || undefined;
  const timeoutRaw = value["timeoutMs"];
  const timeoutMs =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.floor(timeoutRaw)
      : undefined;
  const colorRaw = trimString(value["color"]);
  const color = colorRaw || undefined;
  const maxLengthRaw = value["maxLength"];
  const maxLength =
    typeof maxLengthRaw === "number" && Number.isFinite(maxLengthRaw) && maxLengthRaw > 0
      ? Math.floor(maxLengthRaw)
      : undefined;
  const newLine = value["newLine"] === true ? true : undefined;

  if (type === "command") {
    const command = trimString(value["command"]);
    if (!command) {
      return null;
    }
    const cwdRaw = trimString(value["cwd"]);
    return {
      type: "command",
      id,
      command,
      cwd: cwdRaw || undefined,
      timeoutMs,
      color,
      newLine,
      maxLength,
    };
  }
  if (type === "module") {
    const modulePath = trimString(value["path"]);
    if (!modulePath) {
      return null;
    }
    return {
      type: "module",
      id,
      path: modulePath,
      timeoutMs,
      color,
      newLine,
      maxLength,
    };
  }
  return null;
}

function normalizeStatusLine(value: unknown): StatusLineSettings | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const result: StatusLineSettings = {};
  const enabled = parseBoolean(value["enabled"]);
  if (enabled !== undefined) {
    result.enabled = enabled;
  }
  const refreshRaw = value["refreshMs"];
  if (typeof refreshRaw === "number" && Number.isFinite(refreshRaw) && refreshRaw >= MIN_STATUSLINE_REFRESH_MS) {
    result.refreshMs = Math.floor(refreshRaw);
  }
  const separator = value["separator"];
  if (typeof separator === "string") {
    result.separator = separator;
  }
  const providers = value["providers"];
  if (Array.isArray(providers)) {
    const normalized: StatusLineProviderConfig[] = [];
    for (const entry of providers) {
      const provider = normalizeStatusLineProvider(entry);
      if (provider) {
        normalized.push(provider);
      }
    }
    result.providers = normalized;
  }
  return result;
}

function mergeMemory(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): Required<MemorySettings> {
  const user = userSettings?.memory;
  const project = projectSettings?.memory;
  return {
    enabled: project?.enabled ?? user?.enabled ?? false,
    userId: project?.userId ?? user?.userId ?? "",
    port: project?.port ?? user?.port ?? 8420,
    apiKey: project?.apiKey ?? user?.apiKey ?? "",
    embedding: project?.embedding ?? user?.embedding ?? "none",
  };
}

function mergeStatusLine(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined
): ResolvedStatusLineSettings {
  const userConfig = normalizeStatusLine(userSettings?.statusline) ?? {};
  const projectConfig = normalizeStatusLine(projectSettings?.statusline) ?? {};
  const userProviders = userConfig.providers ?? [];
  const projectProviders = projectConfig.providers ?? [];
  const projectIds = new Set(projectProviders.map((p) => p.id));
  const providers = [...userProviders.filter((p) => !projectIds.has(p.id)), ...projectProviders];
  const enabled = projectConfig.enabled ?? userConfig.enabled ?? providers.length > 0;
  const refreshMs = projectConfig.refreshMs ?? userConfig.refreshMs ?? DEFAULT_STATUSLINE_REFRESH_MS;
  const separator = projectConfig.separator ?? userConfig.separator ?? DEFAULT_STATUSLINE_SEPARATOR;
  return {
    enabled,
    refreshMs,
    separator,
    providers,
  };
}

function normalizeEnv(env: DeepcodingSettings["env"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!env) {
    return result;
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

export function collectDeepcodeEnv(processEnv: SettingsProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  // Legacy DEEPCODE_* variables are collected first so DEEPORCA_* takes precedence.
  for (const prefix of ["DEEPCODE_", "DEEPORCA_"]) {
    for (const [key, value] of Object.entries(processEnv)) {
      if (!key.startsWith(prefix) || typeof value !== "string") {
        continue;
      }
      const strippedKey = key.slice(prefix.length);
      if (strippedKey) {
        result[strippedKey] = value;
      }
    }
  }
  return result;
}

function extractMcpEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("MCP_")) {
      continue;
    }
    const strippedKey = key.slice("MCP_".length);
    if (strippedKey) {
      result[strippedKey] = value;
    }
  }
  return result;
}

function mergeMcpServers(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined,
  userEnv: Record<string, string>,
  projectEnv: Record<string, string>,
  systemEnv: Record<string, string>
): Record<string, McpServerConfig> | undefined {
  const userServers = userSettings?.mcpServers ?? {};
  const projectServers = projectSettings?.mcpServers ?? {};
  const serverNames = new Set([...Object.keys(userServers), ...Object.keys(projectServers)]);
  if (serverNames.size === 0) {
    return undefined;
  }

  const userMcpEnv = extractMcpEnv(userEnv);
  const projectMcpEnv = extractMcpEnv(projectEnv);
  const systemMcpEnv = extractMcpEnv(systemEnv);
  const merged: Record<string, McpServerConfig> = {};

  for (const name of serverNames) {
    const userConfig = userServers[name];
    const projectConfig = projectServers[name];
    const command = projectConfig?.command ?? userConfig?.command;
    if (!command) {
      continue;
    }

    const env = {
      ...userEnv,
      ...(userConfig?.env ?? {}),
      ...userMcpEnv,
      ...projectEnv,
      ...(projectConfig?.env ?? {}),
      ...projectMcpEnv,
      ...systemEnv,
      ...systemMcpEnv,
    };
    const config: McpServerConfig = {
      command,
      args: projectConfig?.args ?? userConfig?.args,
    };
    const cwd = projectConfig?.cwd ?? userConfig?.cwd;
    if (cwd) {
      config.cwd = cwd;
    }
    if (Object.keys(env).length > 0) {
      config.env = env;
    }
    merged[name] = config;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function resolveSettingsSources(
  userSettings: DeepcodingSettings | null | undefined,
  projectSettings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string },
  processEnv: SettingsProcessEnv = process.env
): ResolvedDeepcodingSettings {
  const userEnv = normalizeEnv(userSettings?.env);
  const projectEnv = normalizeEnv(projectSettings?.env);
  const systemEnv = collectDeepcodeEnv(processEnv);
  const env = {
    ...userEnv,
    ...projectEnv,
    ...systemEnv,
  };

  const model =
    trimString(systemEnv.MODEL) ||
    trimString(projectSettings?.model) ||
    trimString(projectEnv.MODEL) ||
    trimString(userSettings?.model) ||
    trimString(userEnv.MODEL) ||
    defaults.model;

  // Merge endpoints early — needed for thinkingEnabled fallback below.
  const mergedEndpoints = mergeEndpoints(userSettings, projectSettings);

  // Resolve primaryEndpointId early so the capability fallback below can honour
  // the configured primary endpoint instead of scanning every endpoint by bare
  // model id (which returns the wrong provider's declaration when the same model
  // id is registered on multiple endpoints).
  const resolvedEndpointsForPrimary =
    mergedEndpoints.length > 0 ? mergedEndpoints : [{ id: "deepseek", name: "DeepSeek", baseURL: "", apiKey: "" }];
  const primaryEndpointId =
    trimString(projectSettings?.primaryEndpointId) ||
    trimString(userSettings?.primaryEndpointId) ||
    resolvedEndpointsForPrimary[0]!.id;

  const thinkingEnabled =
    parseBoolean(systemEnv.THINKING_ENABLED) ??
    parseBoolean(projectSettings?.thinkingEnabled) ??
    parseBoolean(projectEnv.THINKING_ENABLED) ??
    parseBoolean(userSettings?.thinkingEnabled) ??
    parseBoolean(userEnv.THINKING_ENABLED) ??
    // Check the PRIMARY endpoint's model registration first, then fall back to
    // any endpoint, then to the hardcoded table.
    (() => {
      const primaryReg = mergedEndpoints.find((e) => e.id === primaryEndpointId)?.models?.find((m) => m.id === model);
      if (primaryReg) return primaryReg.thinking ?? false;
      for (const ep of mergedEndpoints) {
        const reg = ep.models?.find((m) => m.id === model);
        if (reg) return reg.thinking ?? false;
      }
      return defaultsToThinkingMode(model);
    })();

  const reasoningEffort =
    resolveReasoningEffort(systemEnv.REASONING_EFFORT) ??
    resolveReasoningEffort(projectSettings?.reasoningEffort) ??
    resolveReasoningEffort(projectEnv.REASONING_EFFORT) ??
    resolveReasoningEffort(userSettings?.reasoningEffort) ??
    resolveReasoningEffort(userEnv.REASONING_EFFORT) ??
    "max";

  const temperature =
    parseTemperature(systemEnv.TEMPERATURE) ??
    parseTemperature(projectSettings?.temperature) ??
    parseTemperature(projectEnv.TEMPERATURE) ??
    parseTemperature(userSettings?.temperature) ??
    parseTemperature(userEnv.TEMPERATURE);

  const debugLogEnabled =
    parseBoolean(systemEnv.DEBUG_LOG_ENABLED) ??
    parseBoolean(projectSettings?.debugLogEnabled) ??
    parseBoolean(projectEnv.DEBUG_LOG_ENABLED) ??
    parseBoolean(userSettings?.debugLogEnabled) ??
    parseBoolean(userEnv.DEBUG_LOG_ENABLED) ??
    false;

  const telemetryEnabled =
    parseBoolean(systemEnv.TELEMETRY_ENABLED) ??
    parseBoolean(projectSettings?.telemetryEnabled) ??
    parseBoolean(projectEnv.TELEMETRY_ENABLED) ??
    parseBoolean(userSettings?.telemetryEnabled) ??
    parseBoolean(userEnv.TELEMETRY_ENABLED) ??
    true;

  const notify =
    trimString(systemEnv.NOTIFY) || trimString(projectSettings?.notify) || trimString(userSettings?.notify) || "";
  const webSearchTool =
    trimString(systemEnv.WEB_SEARCH_TOOL) ||
    trimString(projectSettings?.webSearchTool) ||
    trimString(userSettings?.webSearchTool) ||
    "";

  const streamIdleTimeoutMs =
    parsePositiveInteger(systemEnv.STREAM_IDLE_TIMEOUT_MS) ??
    parsePositiveInteger(projectSettings?.streamIdleTimeoutMs) ??
    parsePositiveInteger(projectEnv.STREAM_IDLE_TIMEOUT_MS) ??
    parsePositiveInteger(userSettings?.streamIdleTimeoutMs) ??
    parsePositiveInteger(userEnv.STREAM_IDLE_TIMEOUT_MS) ??
    DEFAULT_STREAM_IDLE_TIMEOUT_MS;

  // ── Multi-endpoint resolution ────────────────────────────────────────────
  // Merge endpoints from user + project settings (project overrides user by id,
  // mirroring mergeStatusLine). If none configured, synthesize a default
  // "deepseek" endpoint from env.API_KEY + env.BASE_URL (backward compat with
  // single-endpoint setups). The synthesized endpoint carries the env key so
  // runtime resolution works, but is NOT surfaced by getEditableSettings (which
  // reads the raw file), preventing env secrets from leaking to the GUI.
  const resolvedApiKey = trimString(env.API_KEY) || undefined;
  // Track whether BASE_URL was explicitly supplied via env, separately from the
  // default fallback. The default is used only to synthesize a legacy endpoint
  // when no endpoints are configured — it must NOT override a configured
  // endpoint's baseURL (env precedence applies only to explicitly-set values).
  const explicitEnvBaseURL = trimString(env.BASE_URL) || undefined;
  const resolvedBaseURL = explicitEnvBaseURL ?? defaults.baseURL;

  const endpoints: EndpointConfig[] =
    mergedEndpoints.length > 0
      ? mergedEndpoints
      : // Backward compat: no endpoints configured → synthesize a single default
        // from the legacy env.API_KEY / env.BASE_URL values.
        [{ id: "deepseek", name: "DeepSeek", baseURL: resolvedBaseURL, apiKey: resolvedApiKey ?? "" }];

  // primaryEndpointId was resolved above (before the thinkingEnabled fallback)
  // so the capability lookup can honour it.

  const secondaryModel =
    trimString(projectSettings?.secondaryModel) || trimString(userSettings?.secondaryModel) || DEFAULT_SECONDARY_MODEL;

  const secondaryEndpointId =
    trimString(projectSettings?.secondaryEndpointId) ||
    trimString(userSettings?.secondaryEndpointId) ||
    primaryEndpointId;

  // Resolve the secondary endpoint's actual baseURL/apiKey.
  const secondaryEndpoint = endpoints.find((e) => e.id === secondaryEndpointId) ?? endpoints[0]!;
  const secondaryBaseURL = secondaryEndpoint?.baseURL ?? resolvedBaseURL;
  const secondaryApiKey = secondaryEndpoint?.apiKey || undefined;

  // Vision model (built-in vision MCP plugin). Empty = disabled.
  const visionModel = trimString(projectSettings?.visionModel) || trimString(userSettings?.visionModel) || "";
  const visionEndpointId =
    trimString(projectSettings?.visionEndpointId) || trimString(userSettings?.visionEndpointId) || primaryEndpointId;
  const visionEndpoint = endpoints.find((e) => e.id === visionEndpointId) ?? endpoints[0];
  const visionBaseURL = visionEndpoint?.baseURL ?? resolvedBaseURL;
  const visionApiKey = visionModel ? visionEndpoint?.apiKey || undefined : undefined;

  // Primary endpoint's apiKey/baseURL. Environment variables (the final merged
  // env, system > project > user) have the highest priority for BOTH apiKey and
  // baseURL, so CI/credential rotation can override either value stored in
  // settings. This matches the documented "system environment precedence"
  // contract. (Earlier code gave env API_KEY precedence via `??` but used env
  // BASE_URL only as a `||` fallback, so a configured endpoint baseURL silently
  // ignored DEEPORCA_BASE_URL while DEEPORCA_API_KEY still won — sending the
  // env credential to the wrong service.)
  const primaryEndpoint = endpoints.find((e) => e.id === primaryEndpointId);
  const primaryApiKey = resolvedApiKey ?? primaryEndpoint?.apiKey ?? "";
  const primaryBaseURL = explicitEnvBaseURL ?? primaryEndpoint?.baseURL ?? resolvedBaseURL;

  return {
    env,
    apiKey: primaryApiKey,
    baseURL: primaryBaseURL,
    model,
    temperature,
    thinkingEnabled,
    reasoningEffort,
    debugLogEnabled,
    telemetryEnabled,
    notify: notify || undefined,
    webSearchTool: webSearchTool || undefined,
    mcpServers: mergeMcpServers(userSettings, projectSettings, userEnv, projectEnv, systemEnv),
    permissions: mergePermissions(userSettings, projectSettings),
    enabledSkills: mergeEnabledSkills(userSettings, projectSettings),
    statusline: mergeStatusLine(userSettings, projectSettings),
    memory: mergeMemory(userSettings, projectSettings),
    endpoints,
    primaryEndpointId,
    secondaryModel,
    secondaryEndpointId,
    secondaryBaseURL,
    secondaryApiKey,
    visionModel,
    visionEndpointId,
    visionBaseURL,
    visionApiKey,
    streamIdleTimeoutMs,
  };
}

export function resolveSettings(
  settings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string },
  processEnv: SettingsProcessEnv = process.env
): ResolvedDeepcodingSettings {
  return resolveSettingsSources(settings, null, defaults, processEnv);
}

export function modelConfigKey(config: Pick<ModelConfigSelection, "thinkingEnabled" | "reasoningEffort">): string {
  return config.thinkingEnabled ? `thinking:${config.reasoningEffort}` : "thinking:none";
}

export function applyModelConfigSelection(
  settings: DeepcodingSettings | null | undefined,
  current: ModelConfigSelection,
  selected: ModelConfigSelection
): { settings: DeepcodingSettings; changed: boolean } {
  const changed = selected.model !== current.model || modelConfigKey(selected) !== modelConfigKey(current);
  const next: DeepcodingSettings = { ...(settings ?? {}) };

  if (!changed) {
    return { settings: next, changed: false };
  }

  if (selected.model !== current.model || Object.prototype.hasOwnProperty.call(next, "model")) {
    next.model = selected.model;
  } else {
    delete next.model;
  }

  // 2.3: when the caller supplies the endpoint the selected model lives on,
  // persist primaryEndpointId atomically with the model so runtime routing
  // (resolveSettingsSources) sends requests to the right provider. Without this,
  // selecting provider-b/model-x while primaryEndpointId stays provider-a sends
  // model-x to provider-a's baseURL/credentials.
  if (selected.endpointId) {
    next.primaryEndpointId = selected.endpointId;
  }

  // 2.4: thinking override must reflect the newly selected model's actual
  // declared capability, not be carried over verbatim from the previous model.
  // If the renderer passed thinkingEnabled=true for a model that (per the
  // endpoint registration) does not support thinking, force it off and clear the
  // effort so activateSession() never sends thinking options to an unsupported
  // model. The capability is resolved against the selected endpoint's models.
  let effectiveThinking = selected.thinkingEnabled;
  let effectiveEffort = selected.thinkingEnabled ? selected.reasoningEffort : undefined;
  if (effectiveThinking && selected.endpointId) {
    const endpoints = mergeEndpoints(settings ?? null, null);
    const reg = endpoints.find((e) => e.id === selected.endpointId)?.models?.find((m) => m.id === selected.model);
    if (reg && reg.thinking === false) {
      effectiveThinking = false;
      effectiveEffort = undefined;
    }
  }

  next.thinkingEnabled = effectiveThinking;
  if (effectiveThinking && effectiveEffort) {
    next.reasoningEffort = effectiveEffort;
  }

  return { settings: next, changed: true };
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "deepseek-v4-pro";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_SECONDARY_MODEL = "deepseek-v4-flash";
/** Default LLM stream idle watchdog: 5 minutes of stream silence. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;

// ── Multi-endpoint support ──────────────────────────────────────────────────

/**
 * A model registered under a specific endpoint, with its declared capabilities.
 * Capabilities are user-configured per endpoint+model pair, because the same
 * model ID may have different capabilities when served through different gateways.
 */
export type ModelRegistration = {
  /** Model ID as the API expects it, e.g. "deepseek-v4-pro". */
  id: string;
  /** Whether this model supports thinking/reasoning output via this endpoint. */
  thinking?: boolean;
  /** Whether this model supports vision/multimodal input via this endpoint. */
  vision?: boolean;
};

/** A configured API endpoint (provider gateway + credentials). */
export type EndpointConfig = {
  /** Stable id used to reference this endpoint from primary/secondary roles. */
  id: string;
  /** Display name shown in the settings panel. */
  name: string;
  /** API base URL (without trailing slash). */
  baseURL: string;
  /** API key for this endpoint (stored in settings.json, never in env). */
  apiKey: string;
  /** Models registered under this endpoint with their capabilities. */
  models?: ModelRegistration[];
};

/** Built-in endpoint presets offered in the settings panel. */
export const ENDPOINT_PRESETS: ReadonlyArray<Pick<EndpointConfig, "id" | "name" | "baseURL">> = [
  { id: "deepseek", name: "DeepSeek", baseURL: "https://api.deepseek.com" },
  { id: "opencode-go", name: "OpenCodeGo", baseURL: "https://opencode.ai/zen/go" },
  { id: "opencode-zen", name: "OpenCodeZen", baseURL: "https://opencode.ai/zen" },
];

/**
 * Build the unique identifier for a model registered under an endpoint.
 * Format: `endpointId/modelId` (e.g. "deepseek/deepseek-v4-pro").
 * Same model ID under different endpoints produces different keys.
 */
export function buildModelKey(endpointId: string, modelId: string): string {
  return `${endpointId}/${modelId}`;
}

/**
 * Parse a model key back into `{ endpointId, modelId }`.
 * Returns `null` if the key is not in the expected `endpointId/modelId` format.
 */
export function parseModelKey(key: string): { endpointId: string; modelId: string } | null {
  const idx = key.indexOf("/");
  if (idx <= 0 || idx >= key.length - 1) return null;
  return { endpointId: key.slice(0, idx), modelId: key.slice(idx + 1) };
}

/**
 * Resolve the capability (thinking/vision) for a given model key from the
 * endpoint configuration. Falls back to the hardcoded capability tables when
 * the endpoint/models data is absent or the model is not registered.
 */
export function resolveModelCapability(
  endpoints: ReadonlyArray<Pick<EndpointConfig, "id" | "models">>,
  modelKey: string
): { thinking: boolean; vision: boolean } {
  const parsed = parseModelKey(modelKey);
  if (parsed) {
    const ep = endpoints.find((e) => e.id === parsed.endpointId);
    const reg = ep?.models?.find((m) => m.id === parsed.modelId);
    if (reg) {
      return {
        thinking: reg.thinking ?? false,
        vision: reg.vision ?? false,
      };
    }
  }
  // Fallback: use the raw modelId against hardcoded tables.
  const modelId = parsed?.modelId ?? modelKey;
  return {
    thinking: DEEPSEEK_V4_MODELS.has(modelId),
    vision: !NON_MULTIMODAL_MODELS.has(modelId.trim()),
  };
}

/**
 * Collect all registered model keys across all endpoints.
 * Returns `endpointId/modelId` strings for use in dropdown selectors.
 * Does NOT filter by apiKey — the caller (TopBar/SettingsPanel) decides
 * whether to show all endpoints or only configured ones.
 */
export function collectAllModelKeys(endpoints: ReadonlyArray<Pick<EndpointConfig, "id" | "models">>): string[] {
  const keys: string[] = [];
  for (const ep of endpoints) {
    for (const model of ep.models ?? []) {
      keys.push(buildModelKey(ep.id, model.id));
    }
  }
  return keys;
}

/**
 * Find the endpoint config for a given model key.
 */
export function findEndpointForModel(
  endpoints: ReadonlyArray<Pick<EndpointConfig, "id">>,
  modelKey: string
): Pick<EndpointConfig, "id"> | null {
  const parsed = parseModelKey(modelKey);
  if (!parsed) return null;
  return endpoints.find((e) => e.id === parsed.endpointId) ?? null;
}

// ---------------------------------------------------------------------------
// Settings file I/O
// ---------------------------------------------------------------------------

export function getUserSettingsPath(): string {
  return path.join(getUserConfigRoot(), "settings.json");
}

export function getProjectSettingsPath(projectRoot: string): string {
  return path.join(getProjectConfigRoot(projectRoot), "settings.json");
}

/**
 * Discriminated read result.
 *
 * `readSettingsFile` collapses every failure into `null`, which makes a
 * corrupt permission file indistinguishable from "no settings yet" — and the
 * permission normaliser then defaults to `allowAll`, silently turning a
 * parse error into a fail-open security hole. This type lets callers tell the
 * cases apart so they can fail closed and surface a diagnostic instead.
 */
export type SettingsReadResult =
  | { kind: "missing" }
  | { kind: "valid"; value: DeepcodingSettings }
  | { kind: "invalid"; error: string; raw?: string }
  | { kind: "io-error"; error: string };

/**
 * Read a settings file with a discriminated result that distinguishes
 * "file not present" from "file present but unparseable" from "I/O error".
 *
 * Callers that act on permissions should treat `invalid` and `io-error` as
 * fail-closed (do NOT default to `allowAll`) and surface the diagnostic.
 */
export function readSettingsFileWithStatus(settingsPath: string): SettingsReadResult {
  let exists = false;
  try {
    exists = fs.existsSync(settingsPath);
  } catch (err) {
    return { kind: "io-error", error: err instanceof Error ? err.message : String(err) };
  }
  if (!exists) {
    return { kind: "missing" };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch (err) {
    return { kind: "io-error", error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "invalid", error: "settings file is not a JSON object", raw };
    }
    return { kind: "valid", value: parsed as DeepcodingSettings };
  } catch (err) {
    return {
      kind: "invalid",
      error: err instanceof Error ? err.message : String(err),
      raw,
    };
  }
}

/**
 * Tracks whether the most recent settings read hit a non-fatal parse or I/O
 * error. Hosts can surface this as a diagnostic so a corrupt settings file
 * does not silently fall back to defaults.
 */
let lastSettingsReadError: { path: string; kind: "invalid" | "io-error"; error: string } | null = null;

/** Returns the most recent settings-read diagnostic, or null if the last read was clean/missing. */
export function getLastSettingsReadError(): { path: string; kind: "invalid" | "io-error"; error: string } | null {
  return lastSettingsReadError;
}

/** Reset the diagnostic (for tests). */
export function resetLastSettingsReadError(): void {
  lastSettingsReadError = null;
}

export function readSettingsFile(settingsPath: string): DeepcodingSettings | null {
  const result = readSettingsFileWithStatus(settingsPath);
  if (result.kind === "valid") {
    lastSettingsReadError = null;
    return result.value;
  }
  if (result.kind === "missing") {
    // Genuinely no settings file — the historical "default to allowAll"
    // behaviour is intentional here (first-run experience).
    lastSettingsReadError = null;
    return null;
  }
  // `invalid` or `io-error`: record the diagnostic. We deliberately return
  // null (not an empty object) so callers that only check `null` keep working,
  // BUT we also fail the permission policy closed by surfacing the error via
  // getLastSettingsReadError(). Callers that resolve permissions SHOULD check
  // that diagnostic and force defaultMode to "askAll" instead of inheriting
  // the historical "allowAll" default — a corrupt permission file must not
  // silently downgrade to "allow everything". See resolveSettingsGuard.
  lastSettingsReadError = { path: settingsPath, kind: result.kind, error: result.error };
  return null;
}

/**
 * Fail-closed guard for permission default mode.
 *
 * Returns `"askAll"` when the most recent settings read hit a parse or I/O
 * error (so a corrupt `settings.json` cannot silently downgrade the permission
 * policy to `allowAll`), otherwise returns the caller's preferred default
 * (`allowAll` for the first-run / unset case). Permission resolvers should
 * route their `defaultMode` through this instead of using the raw normalised
 * value.
 */
export function failClosedPermissionDefault(preferredDefault: PermissionDefaultMode): PermissionDefaultMode {
  return lastSettingsReadError ? "askAll" : preferredDefault;
}

export function readSettings(): DeepcodingSettings | null {
  return readSettingsFile(getUserSettingsPath());
}

export function readProjectSettings(projectRoot: string = process.cwd()): DeepcodingSettings | null {
  return readSettingsFile(getProjectSettingsPath(projectRoot));
}

function writeSettingsFile(settingsPath: string, settings: DeepcodingSettings): void {
  const dir = path.dirname(settingsPath);
  fs.mkdirSync(dir, { recursive: true });
  const content = `${JSON.stringify(settings, null, 2)}\n`;
  // Atomic write: write to a uniquely named temp file in the same directory,
  // then rename over the target. Avoids collisions and half-written settings.
  const tmp = `${settingsPath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
    // Re-apply the private mode because an existing temp file or unusual umask
    // must not leave credentials group/world-readable before the atomic rename.
    if (process.platform !== "win32") {
      fs.chmodSync(tmp, 0o600);
    }
    fs.renameSync(tmp, settingsPath);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Preserve the original write/rename error.
    }
    throw error;
  }
}

export function writeSettings(settings: DeepcodingSettings): void {
  const settingsPath = getUserSettingsPath();
  writeSettingsFile(settingsPath, settings);
}

export function writeProjectSettings(settings: DeepcodingSettings, projectRoot: string = process.cwd()): void {
  const settingsPath = getProjectSettingsPath(projectRoot);
  writeSettingsFile(settingsPath, settings);
}

export function writeModelConfigSelection(
  selection: ModelConfigSelection,
  current: ModelConfigSelection = resolveCurrentSettings(),
  projectRoot: string = process.cwd()
): { changed: boolean; settings: DeepcodingSettings } {
  const projectSettingsPath = getProjectSettingsPath(projectRoot);
  const shouldWriteProjectSettings = fs.existsSync(projectSettingsPath);
  const rawSettings = shouldWriteProjectSettings ? readProjectSettings(projectRoot) : readSettings();
  const result = applyModelConfigSelection(rawSettings, current, selection);
  if (result.changed) {
    if (shouldWriteProjectSettings) {
      writeProjectSettings(result.settings, projectRoot);
    } else {
      writeSettings(result.settings);
    }
  }
  return result;
}

export function resolveCurrentSettings(projectRoot: string = process.cwd()): ResolvedDeepcodingSettings {
  const userPath = path.resolve(getUserSettingsPath());
  const projectPath = path.resolve(getProjectSettingsPath(projectRoot));
  const sameFile = userPath === projectPath;
  return resolveSettingsSources(
    readSettings(),
    sameFile ? null : readProjectSettings(projectRoot),
    {
      model: DEFAULT_MODEL,
      baseURL: DEFAULT_BASE_URL,
    },
    process.env
  );
}
