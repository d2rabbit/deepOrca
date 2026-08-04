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
};

export type ModelConfigSelection = {
  model: string;
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
  return {
    allow: mergePermissionLists(userPermissions.allow, projectPermissions.allow),
    deny: mergePermissionLists(userPermissions.deny, projectPermissions.deny),
    ask: mergePermissionLists(userPermissions.ask, projectPermissions.ask),
    defaultMode: projectSettings?.permissions
      ? projectPermissions.defaultMode
      : userSettings?.permissions
        ? userPermissions.defaultMode
        : "allowAll",
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

  const thinkingEnabled =
    parseBoolean(systemEnv.THINKING_ENABLED) ??
    parseBoolean(projectSettings?.thinkingEnabled) ??
    parseBoolean(projectEnv.THINKING_ENABLED) ??
    parseBoolean(userSettings?.thinkingEnabled) ??
    parseBoolean(userEnv.THINKING_ENABLED) ??
    // Check endpoint model registration first, then fall back to hardcoded table.
    (() => {
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

  // ── Multi-endpoint resolution ────────────────────────────────────────────
  // Merge endpoints from user + project settings (project overrides user by id,
  // mirroring mergeStatusLine). If none configured, synthesize a default
  // "deepseek" endpoint from env.API_KEY + env.BASE_URL (backward compat with
  // single-endpoint setups). The synthesized endpoint carries the env key so
  // runtime resolution works, but is NOT surfaced by getEditableSettings (which
  // reads the raw file), preventing env secrets from leaking to the GUI.
  const resolvedApiKey = trimString(env.API_KEY) || undefined;
  const resolvedBaseURL = trimString(env.BASE_URL) || defaults.baseURL;

  const endpoints: EndpointConfig[] =
    mergedEndpoints.length > 0
      ? mergedEndpoints
      : // Backward compat: no endpoints configured → synthesize a single default
        // from the legacy env.API_KEY / env.BASE_URL values.
        [{ id: "deepseek", name: "DeepSeek", baseURL: resolvedBaseURL, apiKey: resolvedApiKey ?? "" }];

  const primaryEndpointId =
    trimString(projectSettings?.primaryEndpointId) || trimString(userSettings?.primaryEndpointId) || endpoints[0]!.id;

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

  // Primary endpoint's apiKey/baseURL. Environment variable (the final merged
  // env, system > project > user) has the highest priority for the api key, so
  // CI/credential rotation can override a key stored in settings. This matches
  // the documented "system environment precedence" contract.
  const primaryEndpoint = endpoints.find((e) => e.id === primaryEndpointId);
  const primaryApiKey = resolvedApiKey ?? primaryEndpoint?.apiKey ?? "";
  const primaryBaseURL = primaryEndpoint?.baseURL || resolvedBaseURL;

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

  next.thinkingEnabled = selected.thinkingEnabled;
  if (selected.thinkingEnabled) {
    next.reasoningEffort = selected.reasoningEffort;
  }

  return { settings: next, changed: true };
}

// ---------------------------------------------------------------------------
// Default constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "deepseek-v4-pro";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_SECONDARY_MODEL = "deepseek-v4-flash";

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

export function readSettingsFile(settingsPath: string): DeepcodingSettings | null {
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const raw = fs.readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as DeepcodingSettings;
  } catch {
    return null;
  }
}

export function readSettings(): DeepcodingSettings | null {
  return readSettingsFile(getUserSettingsPath());
}

export function readProjectSettings(projectRoot: string = process.cwd()): DeepcodingSettings | null {
  return readSettingsFile(getProjectSettingsPath(projectRoot));
}

function writeSettingsFile(settingsPath: string, settings: DeepcodingSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
