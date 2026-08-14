import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import { Agent, fetch as undiciFetch } from "undici";
import { getUserConfigRoot } from "./app-dirs";
import { resolveCurrentSettings } from "../settings";
import { randomUUID as cryptoRandomUUID } from "node:crypto";

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
  reasoningEffort: "high" | "max";
  debugLogEnabled: boolean;
  telemetryEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  env: Record<string, string>;
  machineId?: string;
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
      telemetryEnabled: settings.telemetryEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId(),
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
      telemetryEnabled: settings.telemetryEnabled,
      notify: settings.notify,
      webSearchTool: settings.webSearchTool,
      env: settings.env,
      machineId: getMachineId(),
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
    telemetryEnabled: settings.telemetryEnabled,
    notify: settings.notify,
    webSearchTool: settings.webSearchTool,
    env: settings.env,
    machineId: getMachineId(),
  };
}

function getMachineId(): string | undefined {
  try {
    const idPath = path.join(getUserConfigRoot(), "machine-id");
    if (fs.existsSync(idPath)) {
      const raw = fs.readFileSync(idPath, "utf8").trim();
      if (raw) {
        return raw;
      }
    }
    // Privacy (deep review 2026-08-15, C3): the id is sent as a telemetry
    // header — random only, NO hostname (it used to leak the machine name to
    // the telemetry/web-search endpoints on every prompt).
    const generated = `dc-${cryptoRandomUUID()}`;
    fs.mkdirSync(path.dirname(idPath), { recursive: true, mode: 0o600 });
    fs.writeFileSync(idPath, generated, { encoding: "utf8", mode: 0o600 });
    return generated;
  } catch {
    return undefined;
  }
}

// ── Secondary model client ──────────────────────────────────────────────────
// Used by code review, index building, subagent triggers — anything that should
// run on the cheaper/faster model (default deepseek-v4-flash) instead of the
// primary conversation model. Has its own OpenAI client cache keyed by the
// secondary endpoint's apiKey::baseURL so it doesn't collide with the primary.
//
// NOTE: This client is exported and fully implemented, but as of this commit no
// production code path calls createSecondaryClient(). The settings fields
// (secondaryModel / secondaryEndpointId) are parsed and surfaced in the UI, but
// code review / indexing / subagent tasks still use the primary client. This is
// reserved infrastructure for a future wiring change — do not assume configuring
// a secondary model in the UI changes request routing today.

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
  const model = settings.secondaryModel;

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
