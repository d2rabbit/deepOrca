// Session-layer misc helpers, three small clusters:
// 1. MCP tool-description augmentation (augmentMcpToolDescriptions + hint tables)
// 2. Platform-conditional skill gating (isSkillForCurrentPlatform + prefixes)
// 3. Serena error diagnostics parsing (extractErrorDiagnostics)
import { CODEGRAPH_MCP_SERVER_NAME } from "./common/codegraph";
import { SERENA_MCP_SERVER_NAME } from "./common/serena-mcp";
import { type ToolDefinition } from "./prompt";

/**
 * Platform-conditional skill loading: skills with platform-specific prefixes
 * are only loaded on matching OS. Cross-platform skills load everywhere.
 *
 * Platform-specific prefixes:
 * - darwin: apple-, swift-, uikit-, swiftui-
 * - linux: deepin-, dde-, dtk-
 * - win32: (none currently)
 *
 * Cross-platform (no filtering): all other prefixes including
 * bento-, deeporca-, web-, openwiki-, skill-, a2ui-, codegraph-
 */
const DARWIN_PREFIXES = ["apple-", "swift-", "uikit-", "swiftui-"];

const LINUX_PREFIXES = ["deepin-", "dde-", "dtk-"];

/**
 * Extract error-level diagnostics from a diagnostics tool result. Accepts TWO
 * shapes (CMB-1/CMB-5 wiring — the manager envelope is what callers actually
 * receive; the raw CallToolResult path stays for compatibility):
 *   1. manager envelope: { ok, name, output?, error? } — parses `output` JSON
 *      (Serena array form or the bridge's {ok, diagnostics} form).
 *   2. raw CallToolResult: { content: [{ type: "text", text }] }.
 * We only care about severity "error" (not "warning" or "hint") to avoid noise.
 */
export function extractErrorDiagnostics(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];

  const texts: string[] = [];
  const shape = result as { content?: unknown; output?: unknown };
  if (typeof shape.output === "string" && shape.output) {
    texts.push(shape.output);
  }
  if (Array.isArray(shape.content)) {
    for (const block of shape.content) {
      if (typeof block === "object" && block !== null) {
        const text = (block as { text?: unknown }).text;
        if (typeof text === "string" && text) texts.push(text);
      }
    }
  }
  if (texts.length === 0) return [];

  const errors: string[] = [];
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text);
      const diags = Array.isArray(parsed) ? parsed : (parsed.diagnostics ?? []);
      for (const d of diags) {
        if (typeof d !== "object" || d === null) continue;
        const severity = String((d as { severity?: unknown }).severity ?? "").toLowerCase();
        if (severity === "error" || severity === "1") {
          const msg = (d as { message?: unknown }).message ?? "Unknown error";
          const line =
            (d as { range?: { start?: { line?: unknown } } }).range?.start?.line ?? (d as { line?: unknown }).line;
          errors.push(line !== undefined ? `L${line}: ${String(msg)}` : String(msg));
        }
      }
    } catch {
      // Not JSON — skip.
    }
  }
  return errors;
}

/**
 * Throw when a diagnostics tool call failed at the MCP level (manager envelope
 * `ok:false`). Callers route this into their catch block so the leg is
 * recorded `unavailable` with the reason instead of degrading to a fake-clean
 * empty list (CMB-1; the LSP bridge's deps-missing / budget / spawn failures
 * all arrive here via isError:true, with the human-readable error — including
 * the remediation hint — embedded in the output JSON).
 */
export function assertDiagnosticsEnvelopeOk(result: unknown): void {
  if (!result || typeof result !== "object") return;
  const env = result as { ok?: unknown; error?: unknown; output?: unknown };
  if (env.ok !== false && !(typeof env.error === "string" && env.error)) return;

  let message = typeof env.error === "string" && env.error ? env.error : "";
  if (!message && typeof env.output === "string") {
    try {
      const inner = JSON.parse(env.output) as { error?: unknown };
      if (typeof inner.error === "string" && inner.error) message = inner.error;
    } catch {
      // output is not JSON — fall through to the generic message
    }
  }
  throw new Error(message || "diagnostics tool call failed");
}

/** Serena tools that overlap with CodeGraph — add differentiating hints for G2 routing. */
const SERENA_TOOL_HINTS: Record<string, string> = {
  find_symbol: "（实时 LSP，适合精准单符号查询）",
  find_referencing_symbols: "（实时 LSP 引用，反映最新代码）",
  replace_symbol_body: "（LSP 语义级编辑，比文本替换更安全）",
  rename_symbol: "（跨文件原子重命名，内置工具无法做到）",
  get_diagnostics_for_file: "（实时 LSP 诊断，全栈唯一错误检查来源）",
};

/** CodeGraph tools — add differentiating hints for G2 routing. */
const CODEGRAPH_TOOL_HINTS: Record<string, string> = {
  codegraph_search: "（全代码图谱，适合批量/模糊搜索）",
  codegraph_impact: "（全代码图谱影响面分析，Serena 无法替代）",
  codegraph_callers: "（图谱级调用方分析，支持深度遍历）",
  codegraph_callees: "（图谱级被调用方分析）",
  codegraph_explore: "（图谱探索，语义+结构双路径）",
};

/**
 * Augment MCP tool descriptions with differentiating hints so G2 semantic
 * routing can better disambiguate overlapping Serena vs CodeGraph tools.
 */
export function augmentMcpToolDescriptions(defs: ToolDefinition[]): ToolDefinition[] {
  return defs.map((def) => {
    const name = def.function?.name ?? "";
    // MCP tools are namespaced as mcp__<server>__<tool>.
    const parts = name.split("__");
    if (parts.length < 3) return def;
    const server = parts[1]!;
    const tool = parts.slice(2).join("__");

    let hint: string | undefined;
    if (server === SERENA_MCP_SERVER_NAME) {
      hint = SERENA_TOOL_HINTS[tool];
    } else if (server === CODEGRAPH_MCP_SERVER_NAME) {
      hint = CODEGRAPH_TOOL_HINTS[tool];
    }
    if (!hint) return def;

    const desc = def.function?.description;
    if (!desc || desc.includes(hint)) return def;
    return {
      ...def,
      function: { ...def.function, description: `${desc} ${hint}` },
    };
  });
}

export function isSkillForCurrentPlatform(skillName: string): boolean {
  const name = skillName.toLowerCase();
  // Check macOS-only skills
  if (DARWIN_PREFIXES.some((p) => name.startsWith(p))) {
    return process.platform === "darwin";
  }
  // Check Linux-only skills
  if (LINUX_PREFIXES.some((p) => name.startsWith(p))) {
    return process.platform === "linux";
  }
  // All other skills are cross-platform
  return true;
}
