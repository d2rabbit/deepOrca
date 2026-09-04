// SessionManager layer — see session-manager-base.ts for the split rationale.
// Diagnostics layer (specs/lsp-diagnostics P1): owns the post-edit diagnostics
// check that runs when a task turn ends, now TWO parallel legs —
//   Serena leg   → get_diagnostics_for_file (syntax/symbol level, 40+ langs)
//   LSP bridge   → get_diagnostics          (type level, real language servers)
// — merged, deduplicated and size-capped before injection so the agent can
// self-correct next turn without the diagnostics flooding the prompt.
//
// specs/cmb-adoption CMB-1: every leg carries an explicit status. A leg that
// was EXPECTED (source connected + trigger conditions met) but failed records
// `unavailable` + a reason, and the injected message must say so — "no errors"
// from a check that never ran is NOT the same as "clean" (band-internal
// honesty; the silent-catch variant recreated the exact defect the 08-17
// prestudy criticized in CodeBrain).

import { LSP_BRIDGE_MCP_SERVER_NAME } from "./common/lsp-bridge-mcp";
import { SERENA_MCP_SERVER_NAME } from "./common/serena-mcp";
import { assertDiagnosticsEnvelopeOk, extractErrorDiagnostics } from "./session-mcp-hints";
import { SessionManagerMcp } from "./session-manager-mcp";
import { resolveCurrentSettings, resolveLspDiagnosticsSettings } from "./settings";

/** One file's error lines from one leg (already "L{n}: msg" shaped). */
export type DiagnosticsLegStatus = "ok" | "unavailable";

export type DiagnosticsLegResult = {
  file: string;
  source?: "serena" | "lsp";
  /** CMB-1: ok = the check actually ran; unavailable = it was expected but failed. */
  status: DiagnosticsLegStatus;
  /** Short failure summary for the degradation line (≤ ~120 chars). */
  unavailableReason?: string;
  errors: string[];
};

/** Total prompt budget for one diagnostics injection (design §2.2: ≤ ~2KB). */
const MAX_MESSAGE_CHARS = 2048;

/** Cap for a leg's failure reason inside the degradation line. */
const REASON_MAX_CHARS = 240;

function legLabel(source?: "serena" | "lsp"): string {
  return source === "lsp" ? "LSP bridge" : "Serena";
}

/** Clip an error into a short band-safe reason string. */
export function summarizeLegFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, REASON_MAX_CHARS);
}

/**
 * Merge the legs per file: dedupe identical lines (both legs often see the
 * same syntax error), keep insertion order (Serena first), and cap the whole
 * message at MAX_MESSAGE_CHARS with an explicit truncation marker so a noisy
 * file can never flood the prompt. The degradation line is exempt from the
 * cap — truncation only eats the error body.
 *
 * Truth table (specs/cmb-adoption design §2.1):
 *   no legs                       → null (nothing was expected)
 *   all legs ok + zero errors     → null (true clean)
 *   unavailable legs + zero errors→ degradation-only message (the case the
 *                                   silent catch used to swallow)
 *   unavailable legs + errors     → degradation line first, error body after
 *   all legs ok + errors          → classic error message (unchanged shape)
 */
export function buildDiagnosticsSystemMessage(
  legs: DiagnosticsLegResult[],
  maxChars = MAX_MESSAGE_CHARS
): string | null {
  const byFile = new Map<string, string[]>();
  const unavailable = new Map<string, string>(); // `${label}（${reason}）`, insertion-ordered
  let totalErrors = 0;
  for (const leg of legs) {
    if (leg.status === "unavailable") {
      unavailable.set(`${legLabel(leg.source)}（${leg.unavailableReason ?? "原因未知"}）`, "");
      continue;
    }
    if (leg.errors.length === 0) continue;
    const lines = byFile.get(leg.file) ?? [];
    for (const line of leg.errors) {
      if (lines.includes(line)) continue;
      lines.push(line);
      totalErrors += 1;
    }
    byFile.set(leg.file, lines);
  }

  // Cap the degradation line itself: with many files × distinct reasons the
  // joined reasons could exceed the whole message budget — keep the first
  // two and summarize the rest (band honesty with a budget, per Part III).
  const reasons = [...unavailable.keys()];
  const reasonText =
    reasons.length > 2 ? `${reasons.slice(0, 2).join("；")}；等 ${reasons.length} 项` : reasons.join("；");
  const degradation =
    unavailable.size > 0
      ? `⚠️ 部分诊断检查不可用：${reasonText}；"无错误"不等于"检查通过"，本轮结论按部分检查理解。`
      : null;

  if (totalErrors === 0) return degradation; // null when every expected leg ran clean

  let body = "";
  for (const [file, lines] of byFile) {
    body += `\n${file}\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }
  let message = `⚠️ 编辑后诊断检查发现 ${totalErrors} 个错误：${body}`;
  // Clamped to >= 0: a negative budget makes slice() count from the END,
  // which would silently un-truncate the body (review finding P1).
  const budget = Math.max(0, degradation ? maxChars - (degradation.length + 1) : maxChars);
  if (message.length > budget) {
    message = `${message.slice(0, budget)}\n…（诊断过多已截断）`;
  }
  return degradation ? `${degradation}\n${message}` : message;
}

export abstract class SessionManagerDiagnostics extends SessionManagerMcp {
  /**
   * After a task turn ends, check diagnostics for mutated files — Serena
   * (syntax/symbol) and, when the bridge is connected AND its trigger is
   * "auto", the LSP bridge (type level). Fire-and-forget; error-level
   * findings are merged, deduplicated and injected as ONE system message so
   * the agent can self-correct in the next turn. A leg that was expected but
   * failed is recorded as `unavailable` and surfaces in the message (CMB-1)
   * instead of degrading to silence. With trigger "manual" (default) the
   * bridge stays out of the turn-end path — the agent can still call
   * `get_diagnostics` explicitly; the tool face is registered whenever the
   * bridge is connected.
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
        if (serenaConnected) {
          try {
            const result = await this.executeMcpTool(SERENA_MCP_SERVER_NAME, "get_diagnostics_for_file", {
              file_path: filePath,
            });
            // The manager NEVER throws tool-level failures — it returns an
            // envelope {ok:false, error}. Route that into the unavailable leg
            // (CMB-1) instead of letting it parse as a fake-clean zero list.
            assertDiagnosticsEnvelopeOk(result);
            legs.push({ file: filePath, source: "serena", status: "ok", errors: extractErrorDiagnostics(result) });
          } catch (error) {
            // Still best-effort for the turn — but the failure is now banded
            // as `unavailable` instead of vanishing (CMB-1).
            legs.push({
              file: filePath,
              source: "serena",
              status: "unavailable",
              unavailableReason: summarizeLegFailure(error),
              errors: [],
            });
          }
        }
        if (lspAutoCheck) {
          try {
            const result = await this.executeMcpTool(LSP_BRIDGE_MCP_SERVER_NAME, "get_diagnostics", { filePath });
            assertDiagnosticsEnvelopeOk(result);
            legs.push({ file: filePath, source: "lsp", status: "ok", errors: extractErrorDiagnostics(result) });
          } catch (error) {
            // Missing language server / budget / timeout / deps (CMB-5) all
            // land here as an explicit degradation, never as fake-clean.
            legs.push({
              file: filePath,
              source: "lsp",
              status: "unavailable",
              unavailableReason: summarizeLegFailure(error),
              errors: [],
            });
          }
        }
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
