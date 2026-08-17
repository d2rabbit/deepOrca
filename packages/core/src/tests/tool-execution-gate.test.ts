import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolExecutionGate, type ToolExecutionGateDecision } from "../common/tool-execution-gate";

type Plan = { label: string };

const ctx = { sessionId: "s1", toolCalls: [{ id: "c1" }] };

function decision(verdict: "allow" | "ask" | "deny", label: string, source: string): ToolExecutionGateDecision<Plan> {
  return { verdict, payload: { label }, source };
}

test("empty gate abstains (decide returns null)", () => {
  const gate = new ToolExecutionGate<Plan>();
  assert.equal(gate.decide(ctx), null);
});

test("verdict precedence: deny beats ask beats allow", () => {
  const gate = new ToolExecutionGate<Plan>();
  gate.register("allow-1", () => decision("allow", "a", "allow-1"));
  assert.deepEqual(gate.decide(ctx)?.payload, { label: "a" });

  gate.register("ask-1", () => decision("ask", "b", "ask-1"));
  const asked = gate.decide(ctx);
  assert.equal(asked?.verdict, "ask");
  assert.deepEqual(asked?.payload, { label: "b" });

  gate.register("deny-1", () => decision("deny", "c", "deny-1"));
  const denied = gate.decide(ctx);
  assert.equal(denied?.verdict, "deny");
  assert.deepEqual(denied?.payload, { label: "c" });
});

test("abstaining listeners (null) are skipped", () => {
  const gate = new ToolExecutionGate<Plan>();
  gate.register("abstain", () => null);
  gate.register("allow-1", () => decision("allow", "a", "allow-1"));
  gate.register("abstain-2", () => null);
  const result = gate.decide(ctx);
  assert.equal(result?.verdict, "allow");
  assert.equal(result?.source, "allow-1");
});

test("deny without payload falls back to the first decisive payload (permission plan never lost)", () => {
  const gate = new ToolExecutionGate<Plan>();
  gate.register("permissions", () => decision("allow", "permission-plan", "permissions"));
  gate.register("guard", () => ({ verdict: "deny", source: "guard" }));
  const result = gate.decide(ctx);
  assert.equal(result?.verdict, "deny");
  assert.equal(result?.source, "guard");
  assert.deepEqual(result?.payload, { label: "permission-plan" }, "payload inherited from permission listener");
});

test("unregister stops the listener and is idempotent", () => {
  const gate = new ToolExecutionGate<Plan>();
  const unregister = gate.register("deny-1", () => decision("deny", "d", "deny-1"));
  assert.equal(gate.decide(ctx)?.verdict, "deny");
  unregister();
  unregister();
  assert.equal(gate.decide(ctx), null);
});
