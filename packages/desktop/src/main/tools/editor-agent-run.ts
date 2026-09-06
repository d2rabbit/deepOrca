/**
 * Editor-agent run IPC (specs/editor-agent S2 + editor-copilot 链路 C/D):
 * the sessionless background entity behind 「结对」 and 「解释」 — streamed
 * deltas over EditorAgentProgress, task-hub editor-domain records, local
 * token accounting from the usage ledger.
 *
 * Extracted from main/index.ts (file-length hard limit) — same pattern as
 * review-report-surface.ts: everything main-index-local (bridge lookup, the
 * targeted main-window emit) is injected via deps; this module never
 * imports back into index.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

import { getUserConfigRoot, getProjectCode } from "@deeporca/core";

import { IpcEvent, IpcRequest } from "../../shared/ipc.js";
import type { SessionBridge } from "../session-bridge.js";
import { safePathWithinRoot } from "../safe-path.js";
import { appendEditorRun } from "./editor-runs-store.js";
import { usageLedgerPathForIndex } from "./tokens-summary.js";

export interface EditorAgentRunDeps {
  handlePrivileged: <T>(channel: string, fn: (...args: never[]) => T | Promise<T>) => void;
  /** The ACTIVE workspace's bridge (root pinning + runEditorAgent). */
  getBridge: () => SessionBridge;
  /** Targeted emit to the main window (progress must not reach popouts). */
  emitToMain: (channel: string, payload?: unknown) => void;
}

/**
 * Token accounting for sessionless runs (2026-09-06 user ask): the project
 * usage ledger is append-only per LLM request, so diffing the file across a
 * run window yields the run's consumption. Scoped to `source:"background"`
 * — the editor agent runs as a background task, and counting chat turns /
 * compaction happening in the same window would inflate the run's record.
 * (Concurrent OTHER background tasks still share this scope; per-task
 * attribution would need a task id on the ledger records.)
 */
function ledgerDeltaSince(ledgerPath: string, sinceSize: number): { prompt: number; completion: number } | undefined {
  try {
    if (!existsSync(ledgerPath)) return undefined;
    const size = statSync(ledgerPath).size;
    if (size <= sinceSize) return undefined;
    const fh = openSync(ledgerPath, "r");
    try {
      const buf = Buffer.alloc(size - sinceSize);
      readSync(fh, buf, 0, buf.length, sinceSize);
      let prompt = 0;
      let completion = 0;
      for (const line of buf.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line) as { prompt?: number; completion?: number; source?: string };
          if (record.source !== "background") continue;
          prompt += record.prompt ?? 0;
          completion += record.completion ?? 0;
        } catch {
          // Partial trailing line (write raced us) — skip it.
        }
      }
      return prompt || completion ? { prompt, completion } : undefined;
    } finally {
      closeSync(fh);
    }
  } catch {
    return undefined; // fail-open: the run record simply stays tokenless
  }
}

export function registerEditorAgentRunIpc(deps: EditorAgentRunDeps): void {
  // Editor digital entity (specs/editor-agent S2): run the editor-agent
  // background entity on the ACTIVE workspace's manager — sessionless, zero
  // residue; the final text returns for the editor panel to render.
  deps.handlePrivileged(
    IpcRequest.EditorAgentRun,
    async (input?: {
      filePath?: string;
      startLine?: number;
      endLine?: number;
      selection?: string;
      instruction?: string;
      lang?: string;
      extraContext?: string;
      runId?: string;
    }) => {
      if (!input?.filePath || !input.instruction?.trim() || !input.selection?.trim()) {
        return { ok: false as const, error: "filePath, selection and instruction are required" };
      }
      // Root-pinning: the run record (and the prompt) must reference a file
      // inside the project — an arbitrary path from the semi-trusted
      // renderer would otherwise reach unregistered locations through the
      // editor-agent pipeline.
      const runRoot = deps.getBridge().projectRoot;
      if (!safePathWithinRoot(runRoot, input.filePath)) {
        return { ok: false as const, error: "filePath escapes the project root" };
      }
      // Chunk-stream bridge (specs/editor-copilot C2): same pattern as the
      // action progress channel — every delta/iteration emits, the finally
      // guarantees a terminal event so the renderer never hangs on "running".
      // The renderer mints the id when it owns a progress subscription (pair
      // runs filter events by it); explain runs keep the server-side UUID.
      const runId = typeof input.runId === "string" && input.runId ? input.runId.slice(0, 64) : crypto.randomUUID();
      const startedAt = new Date().toISOString();
      const startedAtMs = Date.now();
      // Token snapshot: everything appended to the ledger after this point is
      // THIS run's consumption (2026-09-06 user ask).
      const ledgerPath = usageLedgerPathForIndex(
        join(getUserConfigRoot(), "projects", getProjectCode(runRoot), "sessions-index.json")
      );
      const ledgerSizeBefore = existsSync(ledgerPath) ? statSync(ledgerPath).size : 0;
      try {
        const result = await deps.getBridge().runEditorAgent({
          filePath: input.filePath,
          startLine: Number(input.startLine) || 1,
          endLine: Number(input.endLine) || Number(input.startLine) || 1,
          selection: input.selection,
          instruction: input.instruction.trim(),
          lang: typeof input.lang === "string" ? input.lang : undefined,
          extraContext: typeof input.extraContext === "string" ? input.extraContext.slice(0, 4000) : undefined,
          onDelta: (text) => deps.emitToMain(IpcEvent.EditorAgentProgress, { runId, phase: "delta", text }),
          onIteration: (message) =>
            deps.emitToMain(IpcEvent.EditorAgentProgress, { runId, phase: "iteration", message }),
        });
        const durationMs = Date.now() - startedAtMs;
        deps.emitToMain(IpcEvent.EditorAgentProgress, {
          runId,
          phase: "done",
          iterations: result.iterations,
        });
        // 链路 D: the run lands in the task hub's editor domain (JSONL) with
        // its behavior + token accounting (2026-09-06 user ask: the task tree
        // records what the editor agent did and what it cost).
        appendEditorRun(runRoot, {
          runId,
          file: input.filePath,
          instruction: input.instruction.trim().slice(0, 120),
          status: "done",
          startedAt,
          endedAt: new Date().toISOString(),
          iterations: result.iterations,
          durationMs,
          tokens: ledgerDeltaSince(ledgerPath, ledgerSizeBefore),
        });
        return { ok: true as const, content: result.content ?? "", iterations: result.iterations };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.emitToMain(IpcEvent.EditorAgentProgress, { runId, phase: "error", error: message });
        appendEditorRun(runRoot, {
          runId,
          file: input.filePath,
          instruction: input.instruction.trim().slice(0, 120),
          status: "error",
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          tokens: ledgerDeltaSince(ledgerPath, ledgerSizeBefore),
        });
        return { ok: false as const, error: message };
      }
    }
  );
}
