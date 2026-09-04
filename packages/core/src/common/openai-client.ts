import OpenAI from "openai";
import { Agent, fetch as undiciFetch } from "undici";
import { resolveCurrentSettings } from "../settings";
import type { ReasoningEffort } from "../settings";

// Custom undici Agent with a 180-second keepAlive timeout.  The default
// global fetch (undici) only keeps connections alive for 4 seconds, which
// is too short for a CLI where the user may spend 10–30 seconds reading
// output between prompts.  By passing a dedicated Agent to undiciFetch we
// keep connections reusable for three minutes after the last request.
const keepAliveAgent = new Agent({ keepAliveTimeout: 180_000 });

// Module-level cache for the OpenAI client instance.  The client itself is
// a stateless fetch wrapper, so it is safe to share across calls as long as
// the apiKey + baseURL stay the same.  Model, thinking-mode and other
// settings are always read fresh from the project / user config files.
let cachedOpenAI: OpenAI | null = null;
let cachedOpenAIKey = "";

export function createOpenAIClient(projectRoot: string = process.cwd()): {
  client: OpenAI | null;
  model: string;
  baseURL: string;
  temperature?: number;
  thinkingEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  debugLogEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  webSearchProvider?: string;
  env: Record<string, string>;
} {
  const settings = resolveCurrentSettings(projectRoot);
  if (!settings.apiKey) {
    return {
      client: null,
      model: settings.model,
      baseURL: settings.baseURL,
      temperature: settings.temperature,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      webSearchProvider: settings.webSearchProvider,
      env: settings.env,
    };
  }

  const cacheKey = `${settings.apiKey}::${settings.baseURL}`;
  if (cachedOpenAI && cachedOpenAIKey === cacheKey) {
    return {
      client: cachedOpenAI,
      model: settings.model,
      baseURL: settings.baseURL,
      temperature: settings.temperature,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.reasoningEffort,
      debugLogEnabled: settings.debugLogEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      webSearchProvider: settings.webSearchProvider,
      env: settings.env,
    };
  }

  cachedOpenAI = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: (url: any, init: any) => undiciFetch(url, { ...init, dispatcher: keepAliveAgent }),
  });
  cachedOpenAIKey = cacheKey;

  // Fire-and-forget warmup: pre-establish TCP+TLS connection to the API
  // server while the user is composing their first prompt.  Bounded by a
  // short timeout so a slow / unreachable API never blocks process exit.
  void (async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    try {
      await cachedOpenAI.models.list({ signal: ac.signal }).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  })();

  return {
    client: cachedOpenAI,
    model: settings.model,
    baseURL: settings.baseURL,
    temperature: settings.temperature,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.reasoningEffort,
    debugLogEnabled: settings.debugLogEnabled,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    webSearchProvider: settings.webSearchProvider,
    env: settings.env,
  };
}

// ── Secondary model client ──────────────────────────────────────────────────
// Tier-2 fallback of the background-LLM chain (specs/model-fleet-adaptation
// §2.3): used when the session family has no lightweight model on the primary
// endpoint but the user configured an explicit secondary model. Own client
// cache keyed by the secondary endpoint's apiKey::baseURL so it doesn't
// collide with the primary.

let cachedSecondary: OpenAI | null = null;
let cachedSecondaryKey = "";

/**
 * Create (or return cached) a secondary-model client configured from the
 * `secondaryModel` + `secondaryEndpointId` settings. Returns null if no API
 * key is configured for the secondary endpoint.
 */
export function createSecondaryClient(projectRoot: string = process.cwd()): {
  client: OpenAI | null;
  model: string;
  baseURL: string;
} {
  const settings = resolveCurrentSettings(projectRoot);
  const apiKey = settings.secondaryApiKey;
  const baseURL = settings.secondaryBaseURL;
  // 继承主模型 (2026-08-30): empty secondary = the primary model.
  const model = settings.secondaryModel || settings.model;

  if (!apiKey) {
    return { client: null, model, baseURL };
  }

  const cacheKey = `${apiKey}::${baseURL}`;
  if (cachedSecondary && cachedSecondaryKey === cacheKey) {
    return { client: cachedSecondary, model, baseURL };
  }

  cachedSecondary = new OpenAI({
    apiKey,
    baseURL: baseURL || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: (url: any, init: any) => undiciFetch(url, { ...init, dispatcher: keepAliveAgent }),
  });
  cachedSecondaryKey = cacheKey;

  return { client: cachedSecondary, model, baseURL };
}

// ── Arbitrary endpoint client ───────────────────────────────────────────────
// Generic per-endpoint client used by background LLM tasks when the family's
// lightweight model is registered on a DIFFERENT configured endpoint than the
// session's primary (e.g. deepseek-v4-flash on opencode-zen while the session
// runs deepseek-v4-pro on opencode-go). Takes explicit credentials — no
// settings read — so it stays side-effect-free and safe to call directly.

const cachedEndpointClients = new Map<string, OpenAI>();

/** Create (or return cached) a client for an explicit endpoint config. */
export function createEndpointClient(apiKey: string | undefined, baseURL: string | undefined): OpenAI | null {
  if (!apiKey) return null;
  const cacheKey = `${apiKey}::${baseURL ?? ""}`;
  const cached = cachedEndpointClients.get(cacheKey);
  if (cached) return cached;
  const client = new OpenAI({
    apiKey,
    baseURL: baseURL || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: (url: any, init: any) => undiciFetch(url, { ...init, dispatcher: keepAliveAgent }),
  });
  cachedEndpointClients.set(cacheKey, client);
  return client;
}

// ── Vision model client ────────────────────────────────────────────────────
// Used by the built-in vision MCP plugin (vision_chat / vision_ocr tools) to
// proxy image-understanding requests through a vision-capable model (e.g.
// Qwen-VL, GPT-4o). The vision model is configured independently from the
// primary/secondary conversation models — it only serves vision MCP tool calls.

let cachedVision: OpenAI | null = null;
let cachedVisionKey = "";

/**
 * Create (or return cached) a vision-model client configured from the
 * `visionModel` + `visionEndpointId` settings. Returns null if visionModel is
 * empty or no API key is configured for the vision endpoint.
 */
export function createVisionClient(projectRoot: string = process.cwd()): {
  client: OpenAI | null;
  model: string;
  baseURL: string;
} {
  const settings = resolveCurrentSettings(projectRoot);
  const apiKey = settings.visionApiKey;
  const baseURL = settings.visionBaseURL;
  const model = settings.visionModel;

  if (!model || !apiKey) {
    return { client: null, model, baseURL };
  }

  const cacheKey = `${apiKey}::${baseURL}`;
  if (cachedVision && cachedVisionKey === cacheKey) {
    return { client: cachedVision, model, baseURL };
  }

  cachedVision = new OpenAI({
    apiKey,
    baseURL: baseURL || undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: (url: any, init: any) => undiciFetch(url, { ...init, dispatcher: keepAliveAgent }),
  });
  cachedVisionKey = cacheKey;

  return { client: cachedVision, model, baseURL };
}
