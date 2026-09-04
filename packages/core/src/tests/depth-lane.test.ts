/**
 * Depth lane integration tests (specs/depth-lane P1.7 + P2.1/P2.2).
 *
 * Drives createSession end-to-end with stubbed seams (aux-llm-contract
 * monkey-patching pattern): activateSession = S1, runSubagent = the
 * silent divergence / red-team paths, createChatCompletionStream = the
 * main-path divergence + fusion calls, runBackgroundLlmTask = the S1.5
 * evidence top-up.
 *
 * Covers: express bypass (no staged flow), the S1→S5 happy path with the
 * five-section report, the round cap (never loops forever, reports 未收敛 +
 * 已给证据), the red-team→S2 regeneration back-edge, K=1 serial degeneration,
 * the S1.5 evidence top-up, abort mid-lane, and the depthLaneEnabled=false
 * observation mode.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "depth-lane-"));
}

type SubagentCall = { skill: string; prompt: string; silent?: boolean };
type DepthLlmCall = { system: string; user: string };

type DepthHarness = {
  manager: SessionManager;
  /** Stubbed activateSession invocations (S1 runs). */
  activations: string[];
  /** Stubbed runSubagent invocations, in order. */
  subagentCalls: SubagentCall[];
  /** Main-path divergence + fusion calls (createChatCompletionStream). */
  depthLlmCalls: DepthLlmCall[];
  /** Stubbed runBackgroundLlmTask invocations. */
  backgroundCalls: Array<Record<string, unknown>>;
  /** Evidence the stubbed S1 appends (assistant text + tool results). */
  s1AssistantText: string;
  s1ToolResultCount: number;
  /** Return value of the stubbed evidence flash judgment. */
  evidenceJudgment: boolean | null;
  /** Canned subagent contents, shifted per runSubagent call. */
  subagentOutputs: string[];
  /** Canned main-path divergence JSON (or "THROW"). */
  mainPathOutput: string;
  /** Canned fusion JSON. */
  fusionOutput: string;
};

function createDepthHarness(complexityGate: Record<string, unknown>): DepthHarness {
  const activations: string[] = [];
  const subagentCalls: SubagentCall[] = [];
  const depthLlmCalls: DepthLlmCall[] = [];
  const backgroundCalls: Array<Record<string, unknown>> = [];
  const harness: DepthHarness = {
    stageEvents: [] as string[],
    manager: null as unknown as SessionManager,
    activations,
    subagentCalls,
    depthLlmCalls,
    backgroundCalls,
    s1AssistantText: "First-pass analysis: the parser module has three call sites.",
    s1ToolResultCount: 2,
    evidenceJudgment: true,
    subagentOutputs: [],
    mainPathOutput: JSON.stringify({
      path: "main path: incremental refactor",
      confidence: 80,
      keyAssumptions: ["call sites are stable"],
      risks: ["merge conflicts"],
    }),
    fusionOutput: JSON.stringify({
      judgment: "Adopt the incremental refactor with guards.",
      confidence: 82,
      disagreements: ["rollback window length"],
      keyAssumptions: ["call sites are stable"],
      risks: ["merge conflicts"],
      nextSteps: ["land parser change", "run full test suite"],
    }),
  };

  const manager = new SessionManager({
    projectRoot: tempRoot(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({
      model: "test-model",
      routing: { enabled: false },
      complexityGate,
    }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
    // X.3: capture the stage-progress relay for sequence assertions.
    onDepthLaneProgress: (event) => {
      harness.stageEvents.push(`${event.stage}${event.round ? `#${event.round}` : ""}`);
    },
  });
  harness.manager = manager;
  const stub = manager as unknown as Record<string, unknown>;

  // S1: the main activation loop — stamp completed and seed the evidence trail.
  stub.activateSession = async (sessionId: string) => {
    activations.push(sessionId);
    manager.updateSessionEntry(sessionId, (entry) => ({ ...entry, status: "completed" }));
    const now = new Date().toISOString();
    if (harness.s1AssistantText) {
      manager.appendSessionMessage(sessionId, {
        id: `s1-${activations.length}`,
        sessionId,
        role: "assistant",
        content: harness.s1AssistantText,
        contentParams: null,
        messageParams: null,
        compacted: false,
        visible: true,
        createTime: now,
        updateTime: now,
      });
    }
    for (let i = 0; i < harness.s1ToolResultCount; i += 1) {
      manager.appendSessionMessage(sessionId, {
        id: `s1-tool-${activations.length}-${i}`,
        sessionId,
        role: "tool",
        content: JSON.stringify({ ok: true, name: "read", output: "file contents" }),
        contentParams: null,
        messageParams: { tool_call_id: `t${i}` },
        compacted: false,
        visible: true,
        createTime: now,
        updateTime: now,
      });
    }
  };

  // Evidence flash fallback (judgeViaLlm seam).
  stub.judgeViaLlm = async () => harness.evidenceJudgment;

  // S1.5 top-up loop.
  stub.runBackgroundLlmTask = async (opts: Record<string, unknown>) => {
    backgroundCalls.push(opts);
    return { content: "found: the parser is consumed by two plugins", iterations: 3 };
  };

  // Silent subagents: divergence path #2 and the red-team attacker.
  stub.runSubagent = async (opts: SubagentCall) => {
    subagentCalls.push(opts);
    return { sessionId: `sub-${subagentCalls.length}`, content: harness.subagentOutputs.shift() ?? "{}" };
  };

  // Main-path divergence + fusion (callDepthLlmJson). NOTE: createSession
  // also fires the ordinary skill-matching flash call (bundled skills exist) —
  // it must NOT count as depth orchestration, so only calls carrying the
  // staged flow's system preamble are recorded.
  stub.createBackgroundLlm = () => ({ client: {}, model: "m", baseURL: "https://x", debugLogEnabled: false });
  stub.createChatCompletionStream = async (_client: unknown, request: Record<string, unknown>) => {
    const messages = request.messages as Array<{ role: string; content: string }>;
    const system = messages[0]?.content ?? "";
    const user = messages[1]?.content ?? "";
    if (system.includes("deep-deliberation")) {
      depthLlmCalls.push({ system, user });
    }
    if (/orchestrator fusing/i.test(user)) {
      return { choices: [{ message: { content: harness.fusionOutput } }] };
    }
    if (/independent reasoning path/i.test(user)) {
      if (harness.mainPathOutput === "THROW") throw new Error("transport boom");
      return { choices: [{ message: { content: harness.mainPathOutput } }] };
    }
    return { choices: [{ message: { content: "{}" } }] };
  };

  return harness;
}

/** A prompt whose L1 keyword rules route deep (no flash call needed). */
const DEEP_PROMPT = "给出迁移方案并权衡各选项的风险";
const EXPRESS_PROMPT = "解释一下这段代码的作用";

function lastAssistantContent(manager: SessionManager, sessionId: string): string {
  const messages = manager.listSessionMessages(sessionId);
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  return typeof last?.content === "string" ? last.content : "";
}

describe("depth lane staged flow", () => {
  test("express task bypasses the staged flow entirely (status-quo single loop)", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true });
    const sessionId = await h.manager.createSession({ text: EXPRESS_PROMPT });
    assert.equal(h.manager.getSession(sessionId)?.lane, "express");
    assert.equal(h.activations.length, 1, "normal activation ran");
    assert.equal(h.subagentCalls.length, 0, "no divergence subagents");
    assert.equal(h.depthLlmCalls.length, 0, "no depth orchestration calls");
    assert.ok(!lastAssistantContent(h.manager, sessionId).includes("深度决策报告"));
  });

  test("S1→S5 happy path: converged first round produces the five-section report", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true });
    // Main path confidence 80; conservative subagent 85 → spread 5 < 15 → converged.
    h.subagentOutputs.push(
      JSON.stringify({
        path: "conservative path: feature-flag the migration",
        confidence: 85,
        keyAssumptions: ["flags are cheap"],
        risks: ["flag debt"],
      }),
      JSON.stringify({
        brokenPaths: [],
        ignoredConstraints: [],
        irreversibleRisks: [],
        verdict: "survivors",
      })
    );
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });

    assert.equal(h.manager.getSession(sessionId)?.lane, "deep");
    assert.equal(h.activations.length, 1, "S1 ran once");
    assert.equal(h.subagentCalls.length, 2, "one divergence subagent + one red-team");
    assert.ok(
      h.subagentCalls.every((call) => call.silent === true),
      "subagents are silent (zero residue)"
    );
    assert.equal(h.depthLlmCalls.length, 2, "main-path divergence + fusion");
    // Budgets: K=2 → exactly K−1 divergence subagents.
    const divergenceCalls = h.subagentCalls.filter((c) => /independent reasoning path/i.test(c.prompt));
    assert.equal(divergenceCalls.length, 1);
    const redTeamCalls = h.subagentCalls.filter((c) => /red-team adversary/i.test(c.prompt));
    assert.equal(redTeamCalls.length, 1);

    const report = lastAssistantContent(h.manager, sessionId);
    assert.ok(report.includes("<proposed_plan>"), "reuses the proposed_plan block contract");
    assert.ok(report.includes("深度决策报告"), "report title");
    assert.ok(report.includes("结论（先读这里）"), "conclusion-first section on top");
    assert.ok(report.indexOf("结论（先读这里）") < report.indexOf("置信度"), "conclusion precedes confidence");
    assert.ok(report.includes("置信度"));
    assert.ok(report.includes("分歧点"));
    assert.ok(report.includes("关键假设"));
    assert.ok(report.includes("风险与红线"));
    assert.ok(report.includes("可执行下一步"));
    assert.ok(report.includes("Adopt the incremental refactor"), "fused judgment surfaced");
    assert.ok(!report.includes("未收敛"), "converged round reports no warning");
    assert.equal(h.manager.getSession(sessionId)?.status, "completed");

    // X.3: the stage relay fires the full sequence with round stamps on S2-S4.
    assert.deepEqual(h.stageEvents, ["s1", "s1.5", "s2#1", "s3#1", "s4#1", "s5#1", "done"]);
  });
  test("convergence loop respects the round cap and reports 未收敛 + 已给证据", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true, maxRounds: 3 });
    // Main 90 vs conservative 20 → spread 70 every round → never converges.
    h.mainPathOutput = JSON.stringify({ path: "aggressive path", confidence: 90, keyAssumptions: [], risks: [] });
    for (let i = 0; i < 9; i += 1) {
      h.subagentOutputs.push(
        JSON.stringify({
          path: "conservative path",
          confidence: 20,
          keyAssumptions: [],
          risks: [],
          brokenPaths: [],
          ignoredConstraints: [],
          irreversibleRisks: [],
          verdict: "survivors",
        })
      );
    }
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });

    const divergenceCalls = h.subagentCalls.filter((c) => /independent reasoning path/i.test(c.prompt));
    const redTeamCalls = h.subagentCalls.filter((c) => /red-team adversary/i.test(c.prompt));
    const fusionCalls = h.depthLlmCalls.filter((c) => /orchestrator fusing/i.test(c.user));
    assert.equal(divergenceCalls.length, 3, "exactly maxRounds divergence rounds — hard cap");
    assert.equal(redTeamCalls.length, 3);
    assert.equal(fusionCalls.length, 3);

    const report = lastAssistantContent(h.manager, sessionId);
    assert.ok(report.includes("未收敛"), "non-convergence is stated");
    assert.ok(report.includes("已给证据"), "evidence-given caveat is stated");
    assert.equal(h.manager.getSession(sessionId)?.status, "completed", "loop terminated, not hung");
  });

  test("red-team feedback flips S2 regeneration exactly once when round 2 converges (P2.2)", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true, maxRounds: 3 });
    // Round 1: main 90 vs conservative 25 → diverged. Round 2: main 60 vs 65 → converged.
    let mainPathRound = 0;
    (h.manager as unknown as Record<string, unknown>).createChatCompletionStream = async (
      _client: unknown,
      request: Record<string, unknown>
    ) => {
      const messages = request.messages as Array<{ role: string; content: string }>;
      const system = messages[0]?.content ?? "";
      const user = messages[1]?.content ?? "";
      if (system.includes("deep-deliberation")) {
        h.depthLlmCalls.push({ system, user });
      }
      if (/orchestrator fusing/i.test(user)) {
        return { choices: [{ message: { content: h.fusionOutput } }] };
      }
      if (!system.includes("deep-deliberation")) {
        return { choices: [{ message: { content: "{}" } }] }; // skill matching
      }
      mainPathRound += 1;
      const confidence = mainPathRound === 1 ? 90 : 60;
      return {
        choices: [
          { message: { content: JSON.stringify({ path: "main path", confidence, keyAssumptions: [], risks: [] }) } },
        ],
      };
    };
    h.subagentOutputs.push(
      JSON.stringify({ path: "conservative", confidence: 25, keyAssumptions: [], risks: [] }), // round 1 divergence
      JSON.stringify({
        brokenPaths: ["aggressive rollout ignores the freeze window"],
        ignoredConstraints: [],
        irreversibleRisks: [],
        verdict: "survivors",
      }), // round 1 red-team
      JSON.stringify({ path: "conservative", confidence: 65, keyAssumptions: [], risks: [] }) // round 2 divergence
    );
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });

    const divergenceCalls = h.subagentCalls.filter((c) => /independent reasoning path/i.test(c.prompt));
    assert.equal(divergenceCalls.length, 2, "regenerated exactly once");
    assert.ok(
      divergenceCalls[1]!.prompt.includes("Previous-round red-team findings"),
      "the S2 regen carries the adversarial feedback"
    );
    assert.ok(divergenceCalls[1]!.prompt.includes("freeze window"), "the broken path is named in the feedback");
    const report = lastAssistantContent(h.manager, sessionId);
    assert.ok(!report.includes("未收敛"), "round 2 converged");
  });

  test("K=1 serial degeneration: no red-team, single path fused", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true, maxPaths: 1 });
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });
    assert.equal(h.subagentCalls.length, 0, "K=1 → zero subagents");
    assert.equal(h.depthLlmCalls.filter((c) => /independent reasoning path/i.test(c.user)).length, 1);
    assert.equal(h.depthLlmCalls.filter((c) => /orchestrator fusing/i.test(c.user)).length, 1);
    assert.ok(lastAssistantContent(h.manager, sessionId).includes("深度决策报告"));
  });

  test("S1.5 evidence gate: insufficient evidence triggers one bounded top-up", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true });
    h.s1ToolResultCount = 0; // deterministic count 0 < 2
    h.s1AssistantText = "";
    h.evidenceJudgment = false; // flash fallback also says insufficient
    h.subagentOutputs.push(
      JSON.stringify({ path: "conservative", confidence: 85, keyAssumptions: [], risks: [] }),
      JSON.stringify({ brokenPaths: [], ignoredConstraints: [], irreversibleRisks: [], verdict: "survivors" })
    );
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });

    assert.equal(h.backgroundCalls.length, 1, "exactly one supplementary retrieval loop");
    assert.equal(h.backgroundCalls[0]?.profile, "review", "read-only profile");
    const divergence = h.subagentCalls.find((c) => /independent reasoning path/i.test(c.prompt));
    assert.ok(divergence?.prompt.includes("consumed by two plugins"), "top-up findings feed the divergence prompts");
    assert.ok(lastAssistantContent(h.manager, sessionId).includes("深度决策报告"));
  });

  test("abort mid-lane stops cleanly: no report, no fusion, createSession resolves", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true });
    const controller = new AbortController();
    // The divergence subagent aborts the owning controller mid-stage.
    (h.manager as unknown as Record<string, unknown>).runSubagent = async (opts: SubagentCall) => {
      h.subagentCalls.push(opts);
      controller.abort();
      return {
        sessionId: "sub",
        content: JSON.stringify({ path: "x", confidence: 50, keyAssumptions: [], risks: [] }),
      };
    };
    h.subagentOutputs.push(JSON.stringify({ path: "conservative", confidence: 50, keyAssumptions: [], risks: [] }));

    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT }, controller);
    assert.ok(h.subagentCalls.length >= 1, "the abort fired inside S2");
    assert.equal(h.depthLlmCalls.filter((c) => /orchestrator fusing/i.test(c.user)).length, 0, "no fusion after abort");
    assert.ok(!lastAssistantContent(h.manager, sessionId).includes("深度决策报告"), "no report after abort");
  });

  test("depthLaneEnabled=false (P0 observation): deep lane recorded, status-quo loop, zero orchestration", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: false });
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });
    assert.equal(h.manager.getSession(sessionId)?.lane, "deep", "lane recorded for observation");
    assert.equal(h.activations.length, 1, "normal activation");
    assert.equal(h.subagentCalls.length, 0);
    assert.equal(h.depthLlmCalls.length, 0);
    assert.ok(!lastAssistantContent(h.manager, sessionId).includes("深度决策报告"));
  });

  test("S1 pausing for the user skips S2–S5 gracefully", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true });
    (h.manager as unknown as Record<string, unknown>).activateSession = async (sessionId: string) => {
      h.activations.push(sessionId);
      // Simulate the loop pausing on AskUserQuestion.
      h.manager.updateSessionEntry(sessionId, (entry) => ({ ...entry, status: "waiting_for_user" }));
    };
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });
    assert.equal(h.subagentCalls.length, 0, "no staging after a paused first round");
    assert.ok(!lastAssistantContent(h.manager, sessionId).includes("深度决策报告"));
  });

  test("orchestration failure fails open to the S1 answer", async () => {
    const h = createDepthHarness({ enabled: true, depthLaneEnabled: true });
    h.mainPathOutput = "THROW"; // main-path divergence transport failure
    h.subagentOutputs.push(
      JSON.stringify({ path: "conservative", confidence: 85, keyAssumptions: [], risks: [] }),
      JSON.stringify({ brokenPaths: [], ignoredConstraints: [], irreversibleRisks: [], verdict: "survivors" })
    );
    const sessionId = await h.manager.createSession({ text: DEEP_PROMPT });
    // Fusion still runs over the surviving subagent path; but if everything
    // fails the flow must degrade to a note + completed, never a lost turn.
    const status = h.manager.getSession(sessionId)?.status;
    assert.ok(status === "completed" || status === "waiting_for_user");
  });
});
