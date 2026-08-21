/**
 * Sandboxed file tools for the memory LLM runner (Phase 1,
 * specs/memory-remediation).
 *
 * Ported from upstream TDAI `adapters/standalone/llm-runner.ts`
 * `createSandboxedTools`, translated from Vercel AI SDK `tool()` to plain
 * OpenAI function-calling so DeepOrca keeps its no-AI-SDK dependency rule.
 * L2 scene extraction and L3 persona generation prompt the model to maintain
 * `scene_blocks/*.md` and `persona.md` through these tools; without them
 * (pre-Phase-1) every L2/L3 cycle burned a secondary-model call whose only
 * possible output — plain text — was discarded.
 *
 * Sandbox: every path resolves relative to the caller-provided workspaceDir
 * (scene_blocks/ or the memory dataDir). Containment follows upstream
 * storage-tools' `resolveStorageKey` semantics, slightly hardened: reject
 * absolute paths (POSIX, Windows drive, UNC-after-normalization) and ANY
 * `..` segment, then re-verify the joined path still sits under the root.
 * Symlink planting inside the managed dataDir is out of scope here — the
 * directory is product-managed and the scene extractor independently
 * lstat-checks files before consuming them.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

interface Logger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const TAG = "[memory] [runner-tools]";

/** An OpenAI chat-completions `tools[]` entry (function calling). */
export interface FileToolDefinition {
  type: "function";
  function: {
    name: "read" | "write" | "edit";
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** An OpenAI chat-completions `message.tool_calls[]` entry. */
export interface RawToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

/**
 * Resolve `relativePath` inside `workspaceDir`, or null when the path
 * escapes the sandbox (absolute path, `..` segment, or — after joining —
 * lands outside the root).
 */
export function resolveSandboxedPath(workspaceDir: string, relativePath: string): string | null {
  if (typeof relativePath !== "string" || relativePath.length === 0) return null;
  // Normalize separators: LLM output mixes / and \; on win32 a backslash is
  // a path separator and must never survive as a literal filename character.
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  // Absolute POSIX path, Windows drive path, or UNC (\\server → //server).
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return null;

  const root = path.resolve(workspaceDir);
  const resolved = path.resolve(root, normalized);
  // Second containment check on the joined result (defence in depth).
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/** Tool schemas for read/write/edit — names and argument shapes match
 * upstream `createSandboxedTools` so the L2/L3 prompts work unchanged. */
export function buildFileToolDefinitions(): FileToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "read",
        description: "Read the contents of a file at the given relative path.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path to read." },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write",
        description: "Write content to a file at the given relative path. Creates or overwrites.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path to write." },
            content: { type: "string", description: "Content to write." },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit",
        description: "Apply one or more text replacements to a file. Each edit replaces an exact substring.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path." },
            edits: {
              type: "array",
              description: "Array of replacements to apply sequentially.",
              items: {
                type: "object",
                properties: {
                  oldText: { type: "string", description: "Exact string to find." },
                  newText: { type: "string", description: "Replacement string." },
                },
                required: ["oldText", "newText"],
              },
            },
          },
          required: ["path", "edits"],
        },
      },
    },
  ];
}

/** Hard cap for the read tool — a multi-MB file (e.g. a stray binary) would
 * otherwise blow up the tool message and the API round-trip. */
const READ_MAX_CHARS = 256 * 1024;

/**
 * Execute one model-requested tool call. Never throws — every failure is
 * returned as a JSON `{ error }` string so the tool loop can feed it back to
 * the model (which may then correct its arguments).
 *
 * `allowedFiles` (optional allowlist of workspace-relative paths, compared
 * case-insensitively) tightens the sandbox for callers whose workspace holds
 * more than their own outputs — L3 persona generation runs against the whole
 * memory dataDir (persona.md lives at its root), and an unrestricted write
 * there could clobber vectors.db or forge L0 lines (persistent prompt
 * injection into future extractions).
 */
export async function executeFileTool(
  name: string,
  rawArgs: string,
  workspaceDir: string,
  logger?: Logger,
  allowedFiles?: string[]
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: `Tool "${name}" arguments are not valid JSON.` });
  }

  const relPath = typeof args.path === "string" ? args.path : "";
  const resolved = resolveSandboxedPath(workspaceDir, relPath);
  if (!resolved) {
    return JSON.stringify({ error: `Path "${relPath}" escapes workspace boundary.` });
  }
  if (allowedFiles && !allowedFiles.includes(relPath.replace(/\\/g, "/").toLowerCase())) {
    return JSON.stringify({ error: `Path "${relPath}" is not in the allowed file list for this task.` });
  }

  try {
    switch (name) {
      case "read": {
        let content = await fs.readFile(resolved, "utf-8");
        if (content.length > READ_MAX_CHARS) {
          content = `${content.slice(0, READ_MAX_CHARS)}\n…（已截断：文件超过 256KB 读取上限）`;
        }
        logger?.debug?.(`${TAG} read: "${relPath}" → ${content.length} chars`);
        return content;
      }
      case "write": {
        if (typeof args.content !== "string") {
          return JSON.stringify({ error: 'write requires a string "content" argument.' });
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, args.content, "utf-8");
        logger?.debug?.(`${TAG} write: "${relPath}" → ${args.content.length} chars`);
        return JSON.stringify({ success: true });
      }
      case "edit": {
        const edits = Array.isArray(args.edits) ? (args.edits as Array<{ oldText?: string; newText?: string }>) : [];
        if (edits.length === 0) {
          return JSON.stringify({ error: "edits array cannot be empty." });
        }
        let content = await fs.readFile(resolved, "utf-8");
        for (const edit of edits) {
          if (!edit.oldText) return JSON.stringify({ error: "oldText cannot be empty." });
          if (!content.includes(edit.oldText)) {
            return JSON.stringify({
              error: `oldText not found in file "${relPath}": ${edit.oldText.slice(0, 80)}`,
            });
          }
          // Function form: `$&`/`` $` ``/`$'`/`$$` in newText must insert
          // verbatim, not expand as a String.replace pattern.
          content = content.replace(edit.oldText, () => edit.newText ?? "");
        }
        await fs.writeFile(resolved, content, "utf-8");
        logger?.debug?.(`${TAG} edit: "${relPath}" → ${edits.length} replacement(s), ${content.length} chars`);
        return JSON.stringify({ success: true });
      }
      default:
        return JSON.stringify({ error: `Unknown tool "${name}".` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn?.(`${TAG} ${name} failed: ${msg}`);
    return JSON.stringify({ error: msg });
  }
}
