/**
 * models.dev catalog access layer (specs/model-fleet-adaptation §七 X3.2 —
 * user decision 2026-09-17: the catalog is the data backbone for ALL new
 * models; native registry entries stay reserved for deepseek/stepfun).
 *
 * What this module is NOT (R12 hard boundary): it never feeds family
 * PROTOCOL semantics — thinking protocol, reasoning replay mode, reasoning
 * field names stay hand-curated in model-capabilities.ts per vendor docs.
 * It only supplies DATA for models the registry does not know:
 *   1. UNKNOWN-family fail-open enhancement (context window → compaction
 *      threshold; multimodal default) — consumed by the registry facades.
 *   2. Settings-picker suggestions keyed by endpoint host (X3.3, main only).
 *   3. Cost multipliers for local token accounting (X3.4, main only).
 *
 * Zero-dependency, synchronous, fail-open: no imports at all (the host
 * injects the JSON text at boot — vendor path red line), malformed or
 * missing data degrades to null/[] and behavior equals today's.
 */

/** Data-only view over one models.dev model entry (fields we consume). */
export type CatalogReasoningOption =
  | { type: "toggle" }
  | { type: "effort"; values: readonly string[] }
  | { type: "budget_tokens"; min?: number; max?: number };

export type CatalogModelEntry = {
  id: string;
  name?: string;
  reasoning: boolean;
  toolCall: boolean;
  /** Images accepted as input. */
  multimodal: boolean;
  contextTokens?: number;
  outputTokens?: number;
  /** USD per million tokens. */
  costInputPerMTok?: number;
  costOutputPerMTok?: number;
  costCacheReadPerMTok?: number;
  providerId?: string;
  // ── P0.1 extension (specs/model-vendor-profiles): vendor-claimable fields
  // previously present in the snapshot but never parsed. All optional + fail-open.
  /** Provider-declared AI SDK package (`@ai-sdk/openai-compatible` …). */
  npm?: string;
  /** Provider API base URL (first-party host derivation / diagnostics). */
  api?: string;
  /** models.dev `interleaved.field` — the wire key reasoning streams in. */
  interleavedField?: string;
  /** Structured reasoning control declaration (toggle / effort ladder / budget). */
  reasoningOptions?: readonly CatalogReasoningOption[];
  /** Whether the endpoint accepts a `temperature` field. */
  temperature?: boolean;
  /** Structured (JSON schema) output support. */
  structuredOutput?: boolean;
  /** models.dev `family` — the sub-family key (kimi-k2 vs kimi-k3, glm vs glm-flash …). */
  family?: string;
};

/** Suggestion record for the settings model picker (X3.3). */
export type CatalogModelSuggestion = CatalogModelEntry;

type RawModel = Record<string, unknown>;
type RawProvider = Record<string, unknown>;

let catalogJson: string | null = null;
/** Parsed lazily; null when unset or malformed (fail-open). */
let parsedProviders: Map<string, RawProvider> | null = null;
/** Exact model-id index across all providers (first provider wins). */
let modelIndex: Map<string, { providerId: string; raw: RawModel }> | null = null;
/** Memoized entry conversions (catalogLookupModel). */
let entryCache: Map<string, CatalogModelEntry | null> | null = null;

/**
 * Host injection seam (desktop main wires this at boot from the vendored
 * models.dev snapshot; dev checkout or packaged extraResources path).
 * Pass null to clear (tests).
 */
export function configureModelCatalog(json: string | null): void {
  if (json === catalogJson) return;
  catalogJson = json && json.trim().length > 0 ? json : null;
  parsedProviders = null;
  modelIndex = null;
  entryCache = null;
}

/** Slim per-model hint — the fields the capability facades enrich with. */
export type CatalogHint = {
  contextTokens?: number;
  multimodal?: boolean;
};

/**
 * Slim-hint injection seam for processes that cannot carry the full snapshot
 * (the renderer bundle): the main process ships catalog entries for the
 * user's actually-configured models inside SettingsSummary, and the renderer
 * configures them here. Lookup order in {@link catalogHintFor}: the full
 * catalog wins (main), then the slim hints (renderer). Empty map clears.
 */
let slimHints: Map<string, CatalogHint> | null = null;

export function configureCatalogHints(hints: Record<string, CatalogHint> | undefined | null): void {
  if (!hints || Object.keys(hints).length === 0) {
    slimHints = null;
    return;
  }
  slimHints = new Map(Object.entries(hints));
}

/** Merged hint lookup: full catalog first, slim hints as the renderer fallback. */
function catalogHintFor(model: string): CatalogHint | null {
  const full = catalogLookupModel(model);
  if (full) return full;
  return slimHints?.get(model) ?? null;
}

/** Whether a catalog snapshot is loaded and parseable. */
export function hasModelCatalog(): boolean {
  return parseProviders() !== null;
}

function parseProviders(): Map<string, RawProvider> | null {
  if (parsedProviders !== null) return parsedProviders;
  if (!catalogJson) return null;
  try {
    const raw = JSON.parse(catalogJson) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const providers = new Map<string, RawProvider>();
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        providers.set(id, value as RawProvider);
      }
    }
    // Sanity floor: a proxied error page would parse to far fewer providers.
    if (providers.size < 20) return null;
    parsedProviders = providers;
    return providers;
  } catch {
    return null;
  }
}

function buildModelIndex(): Map<string, { providerId: string; raw: RawModel }> | null {
  if (modelIndex !== null) return modelIndex;
  const providers = parseProviders();
  if (!providers) return null;
  // specs/model-vendor-profiles 四期修正：同一 model id 常被多个 provider
  // 声明（聚合商/自托管），且声明互相矛盾（如 glm-5.3 首条目是 bothub、
  // deepseek-v4-pro 首条目的 effort 阶梯缺 low）。**厂商第一方条目优先**：
  // 碰撞时第一方胜出，聚合商只在无第一方声明时兜底（维持 first-wins 语义）。
  const index = new Map<string, { providerId: string; raw: RawModel }>();
  for (const [providerId, provider] of providers) {
    const models = provider.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
      if (!model || typeof model !== "object" || Array.isArray(model)) continue;
      const existing = index.get(modelId);
      if (!existing) {
        index.set(modelId, { providerId, raw: model as RawModel });
        continue;
      }
      // 碰撞：第一方 provider 挤掉聚合商条目（同 id 时以第一方为准）。
      if (isFirstPartyProvider(providerId) && !isFirstPartyProvider(existing.providerId)) {
        index.set(modelId, { providerId, raw: model as RawModel });
      }
    }
  }
  modelIndex = index;
  return index;
}

/** 厂商第一方 provider id（models.dev 命名实测；仅用于目录去重的优先级）。 */
const FIRST_PARTY_PROVIDER_IDS = new Set([
  "deepseek",
  "moonshotai",
  "moonshotai-cn",
  "minimax",
  "minimax-cn",
  "minimax-coding-plan",
  "alibaba",
  "alibaba-cn",
  "alibaba-token-plan",
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "zhipuai",
  "zhipuai-coding-plan",
  "zai",
  "zai-coding-plan",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-sgp",
  "stepfun",
  "stepfun-step-plan",
]);

export function isFirstPartyProvider(providerId: string): boolean {
  return FIRST_PARTY_PROVIDER_IDS.has(providerId);
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

/** Parse models.dev `reasoning_options[]` (tolerantly — unknown types dropped). */
function toReasoningOptions(value: unknown): CatalogReasoningOption[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: CatalogReasoningOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "toggle") {
      out.push({ type: "toggle" });
    } else if (record.type === "effort" && Array.isArray(record.values)) {
      const values = record.values.filter((v): v is string => typeof v === "string");
      if (values.length > 0) out.push({ type: "effort", values });
    } else if (record.type === "budget_tokens") {
      const min = asFiniteNumber(record.min);
      const max = asFiniteNumber(record.max);
      out.push({ type: "budget_tokens", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
    }
  }
  return out.length > 0 ? out : undefined;
}

function toEntry(providerId: string, raw: RawModel, modelId: string): CatalogModelEntry | null {
  const limit = raw.limit && typeof raw.limit === "object" ? (raw.limit as Record<string, unknown>) : {};
  const cost = raw.cost && typeof raw.cost === "object" ? (raw.cost as Record<string, unknown>) : {};
  const modalities =
    raw.modalities && typeof raw.modalities === "object" ? (raw.modalities as Record<string, unknown>) : {};
  const input = Array.isArray(modalities.input) ? modalities.input : [];
  const interleaved =
    raw.interleaved && typeof raw.interleaved === "object" ? (raw.interleaved as Record<string, unknown>) : {};
  const reasoningOptions = toReasoningOptions(raw.reasoning_options);
  return {
    id: modelId,
    ...(typeof raw.name === "string" ? { name: raw.name } : {}),
    reasoning: asBoolean(raw.reasoning),
    toolCall: asBoolean(raw.tool_call),
    multimodal: asBoolean(raw.attachment) && input.includes("image"),
    ...(asFiniteNumber(limit.context) ? { contextTokens: limit.context as number } : {}),
    ...(asFiniteNumber(limit.output) ? { outputTokens: limit.output as number } : {}),
    ...(asFiniteNumber(cost.input) ? { costInputPerMTok: cost.input as number } : {}),
    ...(asFiniteNumber(cost.output) ? { costOutputPerMTok: cost.output as number } : {}),
    ...(asFiniteNumber(cost.cache_read) ? { costCacheReadPerMTok: cost.cache_read as number } : {}),
    providerId,
    ...(typeof raw.npm === "string" ? { npm: raw.npm } : {}),
    ...(typeof raw.api === "string" ? { api: raw.api } : {}),
    ...(typeof interleaved.field === "string" ? { interleavedField: interleaved.field } : {}),
    ...(reasoningOptions ? { reasoningOptions } : {}),
    ...(raw.temperature === true || raw.temperature === false ? { temperature: raw.temperature } : {}),
    ...(asBoolean(raw.structured_output) ? { structuredOutput: true } : {}),
    ...(typeof raw.family === "string" ? { family: raw.family } : {}),
  };
}

/**
 * Exact model-id lookup across the whole catalog (model ids are globally
 * unique-ish; first provider wins on collisions). Memoized; null when the
 * catalog is absent or the model is unknown (fail-open).
 */
export function catalogLookupModel(model: string): CatalogModelEntry | null {
  if (!model) return null;
  if (!entryCache) entryCache = new Map();
  if (entryCache.has(model)) return entryCache.get(model) ?? null;
  const index = buildModelIndex();
  let entry: CatalogModelEntry | null = null;
  const hit = index?.get(model);
  if (hit) {
    entry = toEntry(hit.providerId, hit.raw, model);
  }
  entryCache.set(model, entry);
  return entry;
}

/**
 * X3.2 consumer ① — UNKNOWN-family context-window enhancement. Only consulted
 * by the registry facades after their own resolution fell through to UNKNOWN
 * (native families always win; R12: resolution order unchanged).
 */
export function catalogContextWindowTokens(model: string): number | undefined {
  return catalogHintFor(model)?.contextTokens;
}

/** X3.2 consumer ① — UNKNOWN-family multimodal default enhancement. */
export function catalogSupportsMultimodal(model: string): boolean | undefined {
  return catalogHintFor(model)?.multimodal;
}

function hostOf(url: unknown): string {
  if (typeof url !== "string" || url.length === 0) return "";
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return "";
  }
}

/**
 * X3.3 consumer — settings-picker suggestions for an endpoint: match the
 * catalog provider whose `api` base host equals the endpoint baseURL host
 * (aggregators list many models — that is exactly the point), then return
 * its chat-capable models, reasoning models first (a coding harness cares
 * most about those). Fail-open: unknown host → [].
 */
export function catalogSuggestModels(baseURL: string, limit = 20): CatalogModelSuggestion[] {
  const providers = parseProviders();
  if (!providers) return [];
  const host = hostOf(baseURL);
  if (!host) return [];
  for (const [providerId, provider] of providers) {
    if (hostOf(provider.api) !== host) continue;
    const models = provider.models;
    if (!models || typeof models !== "object" || Array.isArray(models)) continue;
    const entries: CatalogModelEntry[] = [];
    for (const [modelId, model] of Object.entries(models as Record<string, unknown>)) {
      if (!model || typeof model !== "object" || Array.isArray(model)) continue;
      const entry = toEntry(providerId, model as RawModel, modelId);
      if (entry) entries.push(entry);
    }
    entries.sort((left, right) => Number(right.reasoning) - Number(left.reasoning) || left.id.localeCompare(right.id));
    return entries.slice(0, limit);
  }
  return [];
}
