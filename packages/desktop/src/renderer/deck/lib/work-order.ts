// Work-order policy layer (E7): the engine-red-line features — autonomy,
// per-step gates, striking — reimplemented Deck-side as a policy layer ABOVE
// the engine loop. Core is untouched; classic behavior is untouched.
//
//   autonomy = which permission-ask batches the Deck auto-approves (the
//              /continue protocol is reused, so funnel accounting stays real)
//   gates    = step-transition observation + the brake API (pausePrompt at
//              the next loop checkpoint, resume on confirm)
//   strike   = session-local annotation; struck steps keep their looks but
//              lose their gate
//
// Everything persists in localStorage: autonomy app-wide, gates/strikes per
// session keyed by step text (UpdatePlan checklist lines).

import type { PlanStep } from "../components/step-board";

export type AutonomyLevel = 0 | 1 | 2; // 0 全自动 · 1 关键确认 · 2 每步确认
export type StepGate = "auto" | "confirm-done" | "confirm-before";

const AUTONOMY_KEY = "deeporca.deck.autonomy";
const ORDER_KEY = "deeporca.deck.order";

const HIGH_RISK = new Set(["delete-in-cwd", "delete-out-cwd", "mutate-git-log"]);
/** Level 1 (关键确认): reads and git queries flow; writes/network/mcp ask. */
const KEY_AUTO = new Set(["read-in-cwd", "read-out-cwd", "query-git-log"]);

/**
 * Does this autonomy level auto-approve a batch carrying exactly these
 * scopes? Whole-batch semantics: any scope outside the level's allowance →
 * the card shows (matches the demo's "只有高危才拦你" reading).
 */
export function shouldAutoApprove(level: AutonomyLevel, scopes: string[]): boolean {
  if (scopes.length === 0) return false;
  if (level === 0) return !scopes.some((scope) => HIGH_RISK.has(scope));
  if (level === 1) return scopes.every((scope) => KEY_AUTO.has(scope));
  return false;
}

export function resolveAutonomy(): AutonomyLevel {
  try {
    const raw = localStorage.getItem(AUTONOMY_KEY);
    if (raw === "0" || raw === "1" || raw === "2") return Number(raw) as AutonomyLevel;
    return 1;
  } catch {
    return 1;
  }
}

export function persistAutonomy(level: AutonomyLevel): void {
  try {
    localStorage.setItem(AUTONOMY_KEY, String(level));
  } catch {
    // Best-effort.
  }
}

export function cycleAutonomy(level: AutonomyLevel): AutonomyLevel {
  return ((level + 1) % 3) as AutonomyLevel;
}

// ── per-session gates & strikes ─────────────────────────────────────────────

type SessionOrder = { gates: Record<string, StepGate>; struck: string[] };
type OrderStore = Record<string, SessionOrder>;

function loadOrder(): OrderStore {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (raw) return JSON.parse(raw) as OrderStore;
  } catch {
    // Fall through to empty.
  }
  return {};
}

function saveOrder(store: OrderStore): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(store));
  } catch {
    // Best-effort.
  }
}

function sessionOrder(sessionId: string | null): SessionOrder {
  if (!sessionId) return { gates: {}, struck: [] };
  return loadOrder()[sessionId] ?? { gates: {}, struck: [] };
}

export function gatesFor(sessionId: string | null): Record<string, StepGate> {
  return sessionOrder(sessionId).gates;
}

export function struckFor(sessionId: string | null): string[] {
  return sessionOrder(sessionId).struck;
}

export function setGate(sessionId: string | null, step: string, gate: StepGate): void {
  if (!sessionId) return;
  const store = loadOrder();
  const order = store[sessionId] ?? { gates: {}, struck: [] };
  if (gate === "auto") delete order.gates[step];
  else order.gates[step] = gate;
  store[sessionId] = order;
  saveOrder(store);
}

export function toggleStruck(sessionId: string | null, step: string): void {
  if (!sessionId) return;
  const store = loadOrder();
  const order = store[sessionId] ?? { gates: {}, struck: [] };
  order.struck = order.struck.includes(step) ? order.struck.filter((s) => s !== step) : [...order.struck, step];
  store[sessionId] = order;
  saveOrder(store);
}

export function cycleGate(gate: StepGate | undefined): StepGate {
  const order: StepGate[] = ["auto", "confirm-before", "confirm-done"];
  const next = order[(order.indexOf(gate ?? "auto") + 1) % order.length];
  return next;
}

// ── gate-transition detection (pure) ────────────────────────────────────────

export type GatePhase = "before" | "done";

export type GateHold = {
  step: string;
  phase: GatePhase;
};

/**
 * Compare consecutive step-board states and return the first gate that must
 * hold, if any:
 *   - confirm-before fires when a gated step BECOMES the current one
 *     (the first not-done step)
 *   - confirm-done fires when a gated step flips to done
 * Struck steps never hold. `fired` is the dedupe set of `${phase}:${step}`.
 */
export function computeGateHold(
  prev: PlanStep[],
  next: PlanStep[],
  gates: Record<string, StepGate>,
  struck: string[],
  fired: ReadonlySet<string>
): GateHold | null {
  const isStruck = (text: string) => struck.includes(text);
  const prevDone = new Set(prev.filter((s) => s.done).map((s) => s.text));

  for (const step of next) {
    if (isStruck(step.text)) continue;
    const gate = gates[step.text];
    if (!gate) continue;
    if (gate === "confirm-done" && !prevDone.has(step.text) && step.done && !fired.has(`done:${step.text}`)) {
      return { step: step.text, phase: "done" };
    }
    if (gate === "confirm-before" && !step.done && !fired.has(`before:${step.text}`)) {
      const prevCurrent = prev.find((s) => !s.done)?.text;
      const nextCurrent = next.find((s) => !s.done)?.text;
      // Fire only on the transition INTO this step being current.
      if (nextCurrent === step.text && prevCurrent !== step.text) {
        return { step: step.text, phase: "before" };
      }
    }
  }
  return null;
}
