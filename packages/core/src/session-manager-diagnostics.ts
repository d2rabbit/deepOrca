// SessionManager layer — see session-manager-base.ts for the split rationale.
// Diagnostics layer (specs/lsp-diagnostics P1): owns the post-edit diagnostics
// check that runs when a task turn ends, now TWO parallel legs —
//   Serena leg   → get_diagnostics_for_file (syntax/symbol level, 40+ langs)
//   LSP bridge   → get_diagnostics          (type level, real language servers)
// — merged, deduplicated and size-capped before injection so the agent can
// self-correct next turn without the diagnostics flooding the prompt.

import { LSP_BRIDGE_MCP_SERVER_NAME } from "./common/lsp-bridge-mcp";
import { SERENA_MCP_SERVER_NAME } from "./common/serena-mcp";
import { extractErrorDiagnostics } from "./session-mcp-hints";
import { SessionManagerMcp } from "./session-manager-mcp";
import { resolveCurrentSettings, resolveLspDiagnosticsSettings } from "./settings";

/** One file's merged error lines from one leg (already "L{n}: msg" shaped). */
export type DiagnosticsLegResult = { file: string; source?: "serena" | "lsp"; errors: string[] };

/** Total prompt budget for one diagnostics injection (design §2.2: ≤ ~2KB). */
const MAX_MESSAGE_CHARS = 2048;

/**
 * Merge the two legs per file: dedupe identical lines (both legs often see
 * the same syntax error), keep insertion order (Serena first), and cap the
 * whole message at MAX_MESSAGE_CHARS with an explicit truncation marker so
 * a noisy file can never flood the prompt. Returns null when both legs are
 * clean — no system message is injected for a clean check.
 */
export function buildDiagnosticsSystemMessage(
  legs: DiagnosticsLegResult[],
  maxChars = MAX_MESSAGE_CHARS
): string | null {
  const byFile = new Map<string, string[]>();
  let totalErrors = 0;
  for (const leg of legs) {
    if (leg.errors.length === 0) continue;
    const lines = byFile.get(leg.file) ?? [];
    for (const line of leg.errors) {
      if (lines.includes(line)) continue;
      lines.push(line);
      totalErrors += 1;
    }
    byFile.set(leg.file, lines);
  }
  if (totalErrors === 0) return null;

  let body = "";
  for (const [file, lines] of byFile) {
    body += `\n${file}\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }
  let message = `⚠️ 编辑后诊断检查发现 ${totalErrors} 个错误：${body}`;
  if (message.length > maxChars) {
    message = `${message.slice(0, maxChars)}\n…（诊断过多已截断）`;
  }
  return message;
}

export abstract class SessionManagerDiagnostics extends SessionManagerMcp {
  /**
   * After a task turn ends, check diagnostics for mutated files — Serena
   * (syntax/symbol) and, when the bridge is connected AND its trigger is
   * "auto", the LSP bridge (type level). Fire-and-forget; error-level
   * findings are merged, deduplicated and injected as ONE system message so
   * the agent can self-correct in the next turn. With trigger "manual"
   * (default) the bridge stays out of the turn-end path — the agent can
   * still call `get_diagnostics` explicitly; the tool face is registered
   * whenever the bridge is connected.
   */
  protected maybeRunDiagnosticsCheck(sessionId: string): void {
    const dirtyFiles = this.diagnosticsDirtyFiles.get(sessionId);
    if (!dirtyFiles || dirtyFiles.size === 0) return;
    this.diagnosticsDirtyFiles.delete(sessionId);
    const files = [...dirtyFiles];

    const status = this.mcpManager.getStatus();
    const serenaConnected = status.some((s) => s.name === SERENA_MCP_SERVER_NAME && s.connected);
    const lspConnected = status.some((s) => s.name === LSP_BRIDGE_MCP_SERVER_NAME && s.connected);
    const lsp = resolveLspDiagnosticsSettings(resolveCurrentSettings(this.projectRoot));
    const lspAutoCheck = lsp.enabled && lspConnected && lsp.trigger === "auto";

    void (async () => {
      const legs: DiagnosticsLegResult[] = [];
      for (const filePath of files) {
        const errors: string[] = [];
        if (serenaConnected) {
          try {
            const result = await this.executeMcpTool(SERENA_MCP_SERVER_NAME, "get_diagnostics_for_file", {
              file_path: filePath,
            });
            errors.push(...extractErrorDiagnostics(result));
          } catch {
            // Best-effort — a Serena hiccup must not block the turn.
          }
        }
        if (lspAutoCheck) {
          try {
            const result = await this.executeMcpTool(LSP_BRIDGE_MCP_SERVER_NAME, "get_diagnostics", { filePath });
            errors.push(...extractErrorDiagnostics(result));
          } catch {
            // Same: the bridge failing (missing language server, budget,
            // timeout) degrades to silence — fail-open per design §2.2.
          }
        }
        legs.push({ file: filePath, errors });
      }
      const message = buildDiagnosticsSystemMessage(legs);
      if (!message) return;
      const now = new Date().toISOString();
      this.appendSessionMessage(sessionId, {
        id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        role: "system",
        content: message,
        contentParams: null,
        messageParams: null,
        compacted: false,
        visible: true,
        createTime: now,
        updateTime: now,
      });
    })();
  }
}
