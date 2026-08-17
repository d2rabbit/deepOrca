import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { formatWebSearchHits, normalizeWebSearchProvider, searchWeb } from "./web-search-providers";

const MAX_OUTPUT_CHARS = 30000;
const MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
const WEB_SEARCH_TOOL_ACTIVITY_PREFIX = "WebSearch:";

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

  // Built-in first-party search (tools/web-search-providers.ts): the query —
  // and only the query — goes to the configured search engine (keyless
  // DuckDuckGo Lite by default, Brave/Tavily opt-in). The historical default
  // that proxied queries plus a machine identifier through the upstream
  // project's endpoint is gone.
  const provider = normalizeWebSearchProvider(llmContext?.webSearchProvider);
  const activityId = `web-search-${randomUUID()}`;
  context.onProcessStart?.(activityId, formatWebSearchActivityLabel(query));
  try {
    const result = await searchWeb(query, { provider });
    // B7 lesson (deep review 2026-08-15): cap what a misbehaving/compromised
    // provider can push into session history and the next LLM request.
    const formatted = formatWebSearchHits(result.hits);
    const capped =
      formatted.length > MAX_OUTPUT_CHARS
        ? `${formatted.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated: ${formatted.length} chars total]`
        : formatted;
    return {
      ok: true,
      name: "WebSearch",
      output: capped,
      metadata: {
        provider: result.provider,
        resultCount: result.hits.length,
        truncated: formatted.length > MAX_OUTPUT_CHARS,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "WebSearch",
      error: `WebSearch (${provider}) failed: ${message}`,
    };
  } finally {
    context.onProcessExit?.(activityId);
  }
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
