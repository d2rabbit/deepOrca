// Work-order runtime orchestration (E7): one hook binding the policy layer
// to the engine — auto-approving permission batches the autonomy level lets
// flow (via the same /continue protocol the card uses, so the §6 funnel
// still records a real granted approval), and holding gated step transitions
// with the brake (pausePrompt at the next loop checkpoint) until the user
// confirms. The engine loop itself is never touched.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AskPermissionRequest } from "../../../shared/ipc";
import { api } from "../../api";
import { buildResult } from "../../lib/permissions";
import type { PlanStep } from "../components/step-board";
import {
  computeGateHold,
  cycleGate,
  gatesFor,
  persistAutonomy,
  resolveAutonomy,
  setGate as persistGate,
  shouldAutoApprove,
  struckFor,
  toggleStruck as persistStrike,
  cycleAutonomy,
  type AutonomyLevel,
  type GateHold,
  type StepGate,
} from "../lib/work-order";
import type { DeckEngine } from "./use-deck-engine";

export type WorkOrder = {
  autonomy: AutonomyLevel;
  setAutonomy(level: AutonomyLevel): void;
  cycleAutonomyDial(): void;
  gates: Record<string, StepGate>;
  struck: string[];
  /** Cycle one step's gate (auto → before → done) and persist per session. */
  cycleStepGate(step: string): void;
  toggleStrike(step: string): void;
  /** The gate currently holding the engine (confirm card open), if any. */
  hold: GateHold | null;
  /** Confirm the hold: resume the engine and clear the card. */
  confirmHold(): void;
  /** Dismiss the card but keep the engine frozen (Space resumes anytime). */
  keepFrozen(): void;
};

export function useWorkOrder(
  engine: DeckEngine,
  steps: PlanStep[],
  onEvent: (text: string, kind?: "ok" | "warn" | "bad" | "info") => void
): WorkOrder {
  const [autonomy, setAutonomyState] = useState<AutonomyLevel>(resolveAutonomy);
  const [gates, setGates] = useState<Record<string, StepGate>>(() => gatesFor(engine.activeId));
  const [struck, setStruck] = useState<string[]>(() => struckFor(engine.activeId));
  const [hold, setHold] = useState<GateHold | null>(null);
  const firedRef = useRef<Set<string>>(new Set());
  // Auto-approve guard: one shot per exact batch (toolCallIds joined).
  const lastApprovedRef = useRef<string>("");
  const prevStepsRef = useRef<PlanStep[]>(steps);

  // Re-hydrate per-session gates/strikes when the work order switches.
  useEffect(() => {
    setGates(gatesFor(engine.activeId));
    setStruck(struckFor(engine.activeId));
    firedRef.current = new Set();
    prevStepsRef.current = steps;
    setHold(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.activeId]);

  // ── autonomy: auto-approve qualifying batches ─────────────────────────────
  const askPermissions = engine.askPermissions;
  useEffect(() => {
    const requests: AskPermissionRequest[] = askPermissions ?? [];
    if (requests.length === 0 || hold) return;
    const scopes = [...new Set(requests.flatMap((req) => req.scopes))];
    if (!shouldAutoApprove(autonomy, scopes)) return;
    const batchKey = requests
      .map((req) => req.toolCallId)
      .sort()
      .join(",");
    if (batchKey === lastApprovedRef.current) return;
    lastApprovedRef.current = batchKey;
    const result = buildResult(
      requests,
      Object.fromEntries(requests.map((req) => [req.toolCallId, "allow" as const])),
      []
    );
    onEvent(`autonomy ${autonomy === 0 ? "full-auto" : "key"} → auto-approved: ${scopes.join(", ")}`, "ok");
    void engine.approve(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askPermissions, autonomy, hold]);

  // ── gates: hold step transitions with the brake ───────────────────────────
  useEffect(() => {
    const prev = prevStepsRef.current;
    prevStepsRef.current = steps;
    if (!engine.busy || hold) return;
    const next = computeGateHold(prev, steps, gates, struck, firedRef.current);
    if (!next) return;
    firedRef.current.add(`${next.phase}:${next.step}`);
    setHold(next);
    onEvent(`gate: ${next.step} (${next.phase}) → brake`, "warn");
    void engine.brake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, engine.busy, gates, struck]);

  const setAutonomy = useCallback((level: AutonomyLevel) => {
    setAutonomyState(level);
    persistAutonomy(level);
  }, []);

  const cycleAutonomyDial = useCallback(() => {
    setAutonomyState((prev) => {
      const next = cycleAutonomy(prev);
      persistAutonomy(next);
      return next;
    });
  }, []);

  const cycleStepGate = useCallback(
    (step: string) => {
      const next = cycleGate(gates[step]);
      persistGate(engine.activeId, step, next);
      setGates(gatesFor(engine.activeId));
    },
    [engine.activeId, gates]
  );

  const toggleStrike = useCallback(
    (step: string) => {
      persistStrike(engine.activeId, step);
      setStruck(struckFor(engine.activeId));
    },
    [engine.activeId]
  );

  const confirmHold = useCallback(() => {
    setHold(null);
    // The pause may not have landed in the session entry yet (it takes
    // effect at the next loop checkpoint) — resume directly rather than
    // routing through brake(), which would misread "processing" as "pause
    // again".
    if (engine.status === "paused" || engine.status === "interrupted") {
      void engine.brake();
    } else if (engine.activeId) {
      void api.resumePrompt(engine.activeId).catch(() => {});
    }
  }, [engine]);

  const keepFrozen = useCallback(() => {
    setHold(null);
  }, []);

  return useMemo(
    () => ({
      autonomy,
      setAutonomy,
      cycleAutonomyDial,
      gates,
      struck,
      cycleStepGate,
      toggleStrike,
      hold,
      confirmHold,
      keepFrozen,
    }),
    [
      autonomy,
      setAutonomy,
      cycleAutonomyDial,
      gates,
      struck,
      cycleStepGate,
      toggleStrike,
      hold,
      confirmHold,
      keepFrozen,
    ]
  );
}
