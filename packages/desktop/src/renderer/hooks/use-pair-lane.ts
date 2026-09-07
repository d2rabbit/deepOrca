import { useCallback, useMemo, useState } from "react";

import type { BufferStreamEvents, PairPhase, PairRunResult, PairStage } from "../components/editor/cm6-buffer-stream";
import type { DiffGroup } from "../components/editor/cm6-diff";

/** One recorded apply (checkpoint strip node, visual draft D10). */
export type PairCheckpoint = {
  atIso: string;
  label: string;
  /** Post-apply buffer snapshot — click-to-rollback restores it (D10). */
  content: string;
  /** File the run applied to — rollback only fires on the same file
   *  (re-audit #4: a global list cross-wrote snapshots into other tabs). */
  file: string;
};

/** Floating EXPLAIN card state (2026-09-06 user ask): 「解释」 never rewrites
 *  the buffer — the agent's prose answer lands in a floating window instead. */
export type PairExplainState = {
  busy: boolean;
  content: string | null;
  error: string | null;
} | null;

export type PairLaneState = {
  phase: PairPhase;
  stage: PairStage;
  stats: { added: number; removed: number };
  error: string | null;
  /** a2ui clarify payload awaiting resubmission (visual draft D12). */
  clarify: string | null;
  /** Last prose-only answer (no code fence) — shown in the pair bar. */
  lastResult: PairRunResult | null;
  checkpoints: PairCheckpoint[];
  /** Live instruction text (per active file; batch B keeps one draft). */
  instruction: string;
  explain: PairExplainState;
  /** Review diff groups (2026-09-06 多 hunk): same/change runs between the
   *  original selection and the AI replacement; null outside review. */
  hunks: DiffGroup[] | null;
};

const INITIAL: PairLaneState = {
  phase: "idle",
  stage: { step: -1, written: 0, total: 0 },
  stats: { added: 0, removed: 0 },
  error: null,
  clarify: null,
  lastResult: null,
  checkpoints: [],
  instruction: "",
  explain: null,
  hunks: null,
};

/** Checkpoint-strip bound — each node snapshots the whole document. */
const MAX_CHECKPOINTS = 20;

/**
 * Pair-lane state (specs/editor-copilot B2): the React projection of the
 * BufferStream event flow plus the pair-bar inputs. `events` is handed to
 * the BufferStream constructor once per workspace mount — the hook itself
 * never touches the editor view.
 */
export function usePairLane(): {
  state: PairLaneState;
  events: BufferStreamEvents;
  setInstruction: (text: string) => void;
  dismissClarify: () => void;
  dismissError: () => void;
  clearResult: () => void;
  beginExplain: () => void;
  settleExplain: (result: { content?: string; error?: string }) => void;
  dismissExplain: () => void;
} {
  const [state, setState] = useState<PairLaneState>(INITIAL);

  const events = useMemo<BufferStreamEvents>(() => {
    // Monotonic checkpoint counter (the list itself is capped at
    // MAX_CHECKPOINTS, so labels must not derive from its length).
    let checkpointSeq = 0;
    return {
      onPhase: (phase, detail) => {
        setState((s) => {
          const next: PairLaneState = { ...s, phase };
          if (phase === "streaming") {
            next.error = null;
            next.clarify = null;
            next.lastResult = null;
            next.hunks = null;
          }
          if (phase === "idle" && detail === undefined) {
            // Settled without detail (apply/discard/rollback) — a stale error
            // banner must not outlive its run (re-audit #26).
            next.error = null;
          }
          if (detail?.error !== undefined) next.error = detail.error;
          if (detail?.clarify !== undefined) next.clarify = detail.clarify;
          if (detail?.result !== undefined) next.lastResult = detail.result;
          return next;
        });
      },
      onStage: (stage) => {
        setState((s) => ({ ...s, stage }));
      },
      onCheckpoint: (atIso, content, file) => {
        checkpointSeq += 1;
        setState((s) => ({
          ...s,
          // Keep the strip bounded — every node carries a full-document
          // snapshot; the oldest rolls off instead of growing forever.
          checkpoints: [
            ...s.checkpoints.slice(-(MAX_CHECKPOINTS - 1)),
            { atIso, label: `v${checkpointSeq}`, content, file },
          ],
        }));
      },
      onStats: (stats) => {
        setState((s) => (s.stats === stats ? s : { ...s, stats }));
      },
      onHunks: (groups) => {
        setState((s) => ({ ...s, hunks: groups }));
      },
    };
  }, []);

  const setInstruction = useCallback((text: string): void => {
    setState((s) => (s.instruction === text ? s : { ...s, instruction: text }));
  }, []);

  const dismissClarify = useCallback((): void => {
    setState((s) => ({ ...s, clarify: null }));
  }, []);

  const dismissError = useCallback((): void => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  const clearResult = useCallback((): void => {
    setState((s) => ({ ...s, lastResult: null }));
  }, []);

  const beginExplain = useCallback((): void => {
    setState((s) => ({ ...s, explain: { busy: true, content: null, error: null } }));
  }, []);

  const settleExplain = useCallback((result: { content?: string; error?: string }): void => {
    setState((s) => {
      if (!s.explain?.busy) return s; // dismissed mid-flight — drop the answer
      return {
        ...s,
        explain: {
          busy: false,
          content: result.content ?? null,
          error: result.error ?? null,
        },
      };
    });
  }, []);

  const dismissExplain = useCallback((): void => {
    setState((s) => (s.explain ? { ...s, explain: null } : s));
  }, []);

  return {
    state,
    events,
    setInstruction,
    dismissClarify,
    dismissError,
    clearResult,
    beginExplain,
    settleExplain,
    dismissExplain,
  };
}
