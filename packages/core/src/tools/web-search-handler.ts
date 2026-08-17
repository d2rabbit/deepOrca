import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type OpenAI from "openai";
import type { CreateOpenAIClient, ToolExecutionContext, ToolExecutionResult } from "./executor";
import { getUserSettingsPath } from "../settings";

const MAX_OUTPUT_CHARS = 30000;
const MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
const WEB_SEARCH_TOOL_ACTIVITY_PREFIX = "WebSearch:";
const DEFAULT_WEB_SEARCH_API_URL = "https://deepcode.vegamo.cn/api/plugin/web-search";

/**
 * Resolve the configured web-search script to an absolute, traversal-free
 * executable path (security scan fix). Relative paths are anchored at the
 * project root; anything still not absolute or containing `..` is rejected.
 */
function resolveScriptPath(scriptPath: string, projectRoot: string): string | null {
  const candidate = isAbsolute(scriptPath) ? scriptPath : resolvePath(projectRoot, scriptPath);
  if (!isAbsolute(candidate)) {
    return null;
  }
  if (candidate.split(/[\\/]/).includes("..")) {
    return null;
  }
  return candidate;
}

type SearchLanguage = "en" | "zh";

type SearchDecision = {
  dominantLanguage: SearchLanguage;
  reason: string;
};

type SearchPreparation = {
  resolvedQuery: string;
  decision: SearchDecision;
  translated: boolean;
};

type LLMClientContext = {
  client: OpenAI;
  model: string;
  thinkingEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  env?: Record<string, string>;
  machineId?: string;
};

export async function handleWebSearchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return {
      ok: false,
      name: "WebSearch",
      error: 'Missing required "query" string.',
    };
  }

  const llmContext = context.createOpenAIClient?.();
  const scriptPath = llmContext?.webSearchTool?.trim();
  if (scriptPath) {
    return executeConfiguredWebSearch(query, scriptPath, context, llmContext?.env ?? {});
  }

  if (!hasUsableClient(llmContext)) {
    return {
      ok: false,
      name: "WebSearch",
      error: `WebSearch default mode requires a valid LLM configuration in ${getUserSettingsPath()} or the project settings.json.`,
    };
  }

  return executeDefaultWebSearch(query, llmContext, context);
}

function hasUsableClient(value: ReturnType<CreateOpenAIClient> | undefined): value is LLMClientContext {
  return Boolean(value?.client);
}

async function executeConfiguredWebSearch(
  query: string,
  scriptPath: string,
  context: ToolExecutionContext,
  configuredEnv: Record<string, string>
): Promise<ToolExecutionResult> {
  const execution = await runWebSearchScript(scriptPath, query, context, configuredEnv);
  const output = execution.stdout.slice(0, MAX_OUTPUT_CHARS);
  const truncated = execution.stdout.length > MAX_OUTPUT_CHARS;

  if (execution.error) {
    return {
      ok: false,
      name: "WebSearch",
      error: execution.error,
      output: output || undefined,
      metadata: {
        exitCode: execution.exitCode,
        signal: execution.signal,
        stderr: execution.stderr || undefined,
        truncated,
      },
    };
  }

  if (execution.exitCode !== 0 || execution.signal !== null) {
    return {
      ok: false,
      name: "WebSearch",
      error: buildCommandError(execution.exitCode, execution.signal),
      output: output || undefined,
      metadata: {
        exitCode: execution.exitCode,
        signal: execution.signal,
        stderr: execution.stderr || undefined,
        truncated,
      },
    };
  }

  return {
    ok: true,
    name: "WebSearch",
    output: output || undefined,
    metadata: {
      exitCode: execution.exitCode,
      signal: execution.signal,
      truncated,
      stderr: execution.stderr || undefined,
    },
  };
}

async function executeDefaultWebSearch(
  query: string,
  llmContext: LLMClientContext,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  try {
    const prepared = await prepareSearchQuery(query, llmContext);
    const output = await runDefaultWebSearchRequest(prepared.resolvedQuery, llmContext.machineId, context);

    return {
      ok: true,
      name: "WebSearch",
      output,
      metadata: {
        originalQuery: query,
        resolvedQuery: prepared.resolvedQuery,
        translated: prepared.translated,
        dominantLanguage: prepared.decision.dominantLanguage,
        languageReason: prepared.decision.reason,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "WebSearch",
      error: `WebSearch default mode failed: ${message}`,
    };
  }
}

async function runWebSearchScript(
  scriptPath: string,
  query: string,
  context: ToolExecutionContext,
  configuredEnv: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal: string | null; error?: string }> {
  return new Promise((resolve) => {
    // SECURITY (scan fix, medium): the script path and env entries come from
    // settings. Resolve the script against the project root, require an
    // absolute traversal-free path, and pass only string-valued env entries
    // to the child process (spawn stays argv-form).
    const resolvedScript = resolveScriptPath(scriptPath, context.projectRoot);
    if (!resolvedScript) {
      resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        signal: null,
        error: `Invalid webSearchTool script path: ${scriptPath}`,
      });
      return;
    }
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(configuredEnv)) {
      if (typeof value === "string") {
        childEnv[key] = value;
      }
    }
    const child = spawn(resolvedScript, [query], {
      cwd: context.projectRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    if (typeof pid === "number") {
      context.onProcessStart?.(pid, formatWebSearchActivityLabel(query));
    }

    let stdout = "";
    let stderr = "";
    let error: string | undefined;

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout = appendChunk(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on("error", (spawnError) => {
      error = spawnError.message;
    });

    child.on("close", (code, signal) => {
      if (typeof pid === "number") {
        context.onProcessExit?.(pid);
      }
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : null,
        signal: signal ?? null,
        error,
      });
    });
  });
}

async function prepareSearchQuery(query: string, llmContext: LLMClientContext): Promise<SearchPreparation> {
  const decision = await decideSearchLanguage(query, llmContext);
  const containsChinese = containsChineseChar(query);

  if (decision.dominantLanguage === "en" && containsChinese) {
    const translatedQuery = await translateQuery(query, "English", llmContext);
    if (translatedQuery) {
      return {
        resolvedQuery: translatedQuery,
        decision,
        translated: true,
      };
    }
  }

  if (decision.dominantLanguage === "zh" && !containsChinese) {
    const translatedQuery = await translateQuery(query, "Chinese", llmContext);
    if (translatedQuery) {
      return {
        resolvedQuery: translatedQuery,
        decision,
        translated: true,
      };
    }
  }

  return {
    resolvedQuery: query,
    decision,
    translated: false,
  };
}

function containsChineseChar(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

async function decideSearchLanguage(query: string, llmContext: LLMClientContext): Promise<SearchDecision> {
  const prompt = `Decide whether the topic below has more useful online material in English or Chinese.

Topic:
\`\`\`text
${query}
\`\`\`

Return strict JSON:
{"dominant_language":"en"|"zh","reason":"one short sentence"}
Do not include markdown or any extra text.`;

  const result = parseJsonResponse(await chat(llmContext, prompt));
  const dominantLanguage = result.dominant_language;

  if (dominantLanguage !== "en" && dominantLanguage !== "zh") {
    throw new Error(`Unexpected dominant language: ${String(dominantLanguage)}`);
  }

  return {
    dominantLanguage,
    reason: typeof result.reason === "string" ? result.reason : "",
  };
}

async function translateQuery(
  query: string,
  targetLanguage: "English" | "Chinese",
  llmContext: LLMClientContext
): Promise<string> {
  const prompt = `Translate the query text below into ${targetLanguage}.

Requirements:
- Preserve product names, library names, API names, versions, and abbreviations when appropriate.
- Return only the translated query, without quotes or explanation.

Query:
\`\`\`text
${query}
\`\`\``;

  return stripCodeFence(await chat(llmContext, prompt))
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

async function chat(llmContext: LLMClientContext, prompt: string): Promise<string> {
  const response = await llmContext.client.chat.completions.create({
    model: llmContext.model,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices?.[0]?.message?.content as unknown;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return (content as Array<{ text?: string }>)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function parseJsonResponse(text: string): Record<string, unknown> {
  const cleaned = stripCodeFence(text).trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error(`Failed to parse JSON response: ${cleaned || "<empty>"}`);
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:[\w-]+)?\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

async function runDefaultWebSearchRequest(
  query: string,
  machineId: string | undefined,
  context: ToolExecutionContext
): Promise<string> {
  if (!machineId) {
    throw new Error("Missing vscode.env.machineId for the default WebSearch request.");
  }

  const activityId = `web-search-${randomUUID()}`;
  context.onProcessStart?.(activityId, formatWebSearchActivityLabel(query));
  try {
    const response = await fetch(DEFAULT_WEB_SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Token: machineId,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`WebSearch API request failed with status ${response.status}${body ? `: ${body}` : ""}`);
    }

    const payload = (await response.json()) as {
      success?: unknown;
      result?: unknown;
    };

    if (typeof payload.result === "string" && payload.result.trim()) {
      const result = payload.result.trim();
      // Cap remote-API results (deep review 2026-08-15, B7): the configured-
      // script path already truncates via MAX_OUTPUT_CHARS; this default path
      // didn't, letting a compromised endpoint push an unbounded blob into
      // session history and the next LLM request.
      if (result.length > MAX_OUTPUT_CHARS) {
        return `${result.slice(0, MAX_OUTPUT_CHARS)}\n[truncated: ${result.length} chars total]`;
      }
      return result;
    }
  } finally {
    context.onProcessExit?.(activityId);
  }

  throw new Error("The web search response was empty.");
}

function appendChunk(existing: string, chunk: string | Buffer): string {
  if (existing.length >= MAX_CAPTURE_CHARS) {
    return existing;
  }
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = MAX_CAPTURE_CHARS - existing.length;
  return `${existing}${text.slice(0, remaining)}`;
}

function formatWebSearchActivityLabel(query: string): string {
  // Display-only surface: strip control characters before the label reaches
  // the process-activity tracker (taint hardening; the spawn argument itself
  // stays untouched — argv-form, validated script path).
  const displaySafe = query.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  const normalizedQuery = displaySafe.replace(/\s+/g, " ").trim();
  const maxQueryLength = 180;
  const clippedQuery =
    normalizedQuery.length > maxQueryLength ? `${normalizedQuery.slice(0, maxQueryLength - 3)}...` : normalizedQuery;
  return `${WEB_SEARCH_TOOL_ACTIVITY_PREFIX} ${clippedQuery}`;
}

function buildCommandError(exitCode: number | null, signal: string | null): string {
  if (signal) {
    return `WebSearch command terminated by signal ${signal}.`;
  }
  if (exitCode !== null) {
    return `WebSearch command failed with exit code ${exitCode}.`;
  }
  return "WebSearch command failed.";
}
