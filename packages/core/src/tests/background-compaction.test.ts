// feat/background-compaction — idle-time compaction concurrency management.
// Pins three layers: (1) the CAS prefix guard (compactionRangeIntact), (2)
// compactSession's apply being compare-and-swap against the live transcript
// (appends during the summary survive; rewrites discard the round), and (3)
// the trigger/join plumbing (quiescent + threshold gating, silence, budget
// abort). The foreground trigger arithmetic itself is pinned by
// compaction.test.ts / compaction-ladder.test.ts and is deliberately not
// re-tested here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "../session";
import { compactionRangeIntact, meterStampValue } from "../common/compaction";
import {
  buildTestMessage,
  createSkillMatchingResponse,
  createTempDir,
  isSkillMatchingRequest,
  registerSessionTestCleanup,
  setHomeDir,
} from "./session-test-utils";

registerSessionTestCleanup();

type InternalHarness = {
  appendSessionMessage: (sessionId: string, message: unknown) => void;
  listSessionMessages: (
    sessionId: string
  ) => Array<Record<string, unknown> & { id: string; compacted?: boolean; meta?: { isSummary?: boolean } }>;
  saveSessionMessages: (sessionId: string, messages: unknown[]) => void;
  updateSessionEntry: (sessionId: string, updater: (entry: Record<string, unknown>) => Record<string, unknown>) => void;
  maybeStartBackgroundCompaction: (sessionId: string) => void;
  startBackgroundCompactionIfEligible: (sessionId: string, meter: number) => void;
  joinBackgroundCompaction: (sessionId: string) => Promise<boolean>;
  backgroundCompactions: Map<string, { promise: Promise<{ applied: boolean }>; controller: AbortController }>;
  backgroundCompactionEpochs: Map<string, number>;
  backgroundCompactionJoinTimeoutMs: number;
};

function buildManager(
  homePrefix: string,
  client: unknown,
  options: {
    onAssistantMessage?: (message: { content?: unknown }) => void;
    resolvedSettings?: Record<string, unknown>;
  } = {}
): { manager: SessionManager; internal: InternalHarness } {
  const onAssistantMessage = options.onAssistantMessage ?? (() => {});
  setHomeDir(createTempDir(homePrefix));
  const workspace = createTempDir(`${homePrefix}workspace-`);
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model", ...options.resolvedSettings }) as never,
    renderMarkdown: (text) => text,
    onAssistantMessage: onAssistantMessage as never,
  });
  return { manager, internal: manager as unknown as InternalHarness };
}

function isCompactionRequestBody(request: unknown): boolean {
  const body = request as { temperature?: unknown; response_format?: unknown; messages?: unknown };
  // compactSession sends exactly one user message, a numeric temperature, and
  // neither tools nor response_format. Skill matching ALSO sends a numeric
  // temperature (0.1) but carries response_format + a system message — the
  // discriminator must exclude it or e2e counts go wrong.
  return (
    typeof body.temperature === "number" &&
    body.response_format === undefined &&
    Array.isArray(body.messages) &&
    body.messages.length === 1
  );
}

function makeClient(onCompactionCall: () => void): {
  chat: { completions: { create: (request: unknown) => Promise<unknown> } };
} {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          if (isCompactionRequestBody(request)) {
            onCompactionCall();
          }
          return {
            choices: [{ message: { content: "summary text" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
}

/** Queued main-loop responses + a counting interceptor for compaction calls
 * (same discriminator as makeClient). */
function makeQueuedClient(
  mainResponses: unknown[],
  onCompactionCall: () => void = () => {}
): { chat: { completions: { create: (request: unknown) => Promise<unknown> } } } {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          if (isCompactionRequestBody(request)) {
            onCompactionCall();
            return {
              choices: [{ message: { content: "summary text" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          }
          const response = mainResponses.shift();
          assert.ok(response, "expected a queued chat response");
          return response;
        },
      },
    },
  };
}

test("compactionRangeIntact: appends extend the tail and stay valid; head rewrites invalidate", () => {
  const withId = (id: string) => ({ id, role: "user", content: "m" });
  const plan = ["a", "b", "c", "d"].map(withId);
  assert.equal(compactionRangeIntact([...plan, withId("e")], plan, 3), true, "appended tail stays valid");
  assert.equal(compactionRangeIntact([...plan], plan, 3), true, "identical view stays valid");
  assert.equal(compactionRangeIntact(plan.slice(0, 3), plan, 3), true, "truncation AT endIndex keeps the range intact");
  assert.equal(compactionRangeIntact(plan.slice(0, 2), plan, 3), false, "truncation below endIndex invalid");
  assert.equal(compactionRangeIntact([], plan, 3), false, "emptied view invalid");
  assert.equal(
    compactionRangeIntact([withId("a"), withId("X"), withId("c"), withId("d")], plan, 3),
    false,
    "rewritten head message invalid"
  );
});

test("meterStampValue: an in-flight background apply zeroes the stale post-response stamp", () => {
  // The interleaving this pins: the during-turn background round applies
  // BETWEEN the pre-send meter stamp and the post-response bookkeeping (the
  // realistic case — a summary takes seconds, tool batches often outlast it).
  // The post-response stamp must then keep the apply's reset (0) instead of
  // resurrecting the pre-compaction measurement.
  assert.equal(meterStampValue(135_146, 3, 3), 135_146, "no intervening apply keeps the measured payload");
  assert.equal(meterStampValue(135_146, 3, 4), 0, "intervening apply resets — next iteration re-measures");
});

test("compactSession apply is CAS: messages appended during the summary round-trip survive", async () => {
  let sessionId = "";
  const client = makeClient(() => {
    // Simulate a concurrent turn-tail append landing while the idle-time
    // summary request is in flight (the exact lost-update window the old
    // snapshot-based save used to wipe).
    internal.appendSessionMessage(sessionId, buildTestMessage("concurrent-append", sessionId, "user", "late arrival"));
  });
  const { manager, internal } = buildManager("deepcode-bgcompact-cas-home-", client);
  sessionId = await manager.createSession({ text: "" });
  for (let i = 0; i < 12; i += 1) {
    internal.appendSessionMessage(sessionId, buildTestMessage(`u${i}`, sessionId, "user", "content"));
  }

  const outcome = await manager.compactSession(sessionId);
  assert.equal(outcome.applied, true, "unchanged prefix must let the round apply");

  const messages = internal.listSessionMessages(sessionId);
  assert.ok(
    messages.some((m) => m.id === "concurrent-append"),
    "late append survives the apply's save"
  );
  const summary = messages.find((m) => m.meta?.isSummary);
  assert.ok(summary, "summary message written");
  assert.ok(
    messages.findIndex((m) => m.id === "concurrent-append") > messages.indexOf(summary),
    "late append stays after the inserted summary"
  );
  assert.equal(messages.find((m) => m.id === "u0")?.compacted, true, "range head tombstoned");
  assert.notEqual(messages.find((m) => m.id === "u11")?.compacted, true, "recent tail untouched");
  assert.equal(manager.getSession(sessionId)?.activeTokens, 0, "token meter reset");
});

test("compactSession discards the round when the transcript was rewritten mid-summary (undo/restore)", async () => {
  let sessionId = "";
  const client = makeClient(() => {
    // Simulate an undo/restore landing during the summary round-trip: the
    // transcript gets rewritten to an early prefix via a full save.
    const current = internal.listSessionMessages(sessionId);
    internal.saveSessionMessages(sessionId, current.slice(0, 3));
  });
  const { manager, internal } = buildManager("deepcode-bgcompact-rewrite-home-", client);
  sessionId = await manager.createSession({ text: "" });
  for (let i = 0; i < 12; i += 1) {
    internal.appendSessionMessage(sessionId, buildTestMessage(`u${i}`, sessionId, "user", "content"));
  }

  const outcome = await manager.compactSession(sessionId);
  assert.equal(outcome.applied, false, "rewritten head must discard the round");

  const messages = internal.listSessionMessages(sessionId);
  assert.equal(
    messages.some((m) => m.meta?.isSummary),
    false,
    "no summary spliced into rewritten history"
  );
  assert.equal(messages.filter((m) => m.compacted).length, 0, "no tombstones written");
  assert.equal(messages.length, 3, "restored view untouched");
});

test("compactSession bumps the meter epoch on the Stage-A-only exit too", async () => {
  // Regression (review round 2026-09-27): the Stage-A-only early return resets
  // the meter but used to skip the epoch bump — a BACKGROUND round exiting
  // there during the tool window left the activation loop's stale pre-send
  // stamp armed, which then resurrected the pre-trim count and pushed the next
  // loop-top into a doomed inline compaction. Every applied exit must bump.
  const client = makeClient(() => {
    throw new Error("stage A must skip the LLM summary entirely");
  });
  const { manager, internal } = buildManager("deepcode-bgcompact-stagea-epoch-home-", client);
  const sessionId = await manager.createSession({ text: "" });
  const harness = manager as unknown as {
    buildAssistantMessage: (sessionId: string, content: string, toolCalls: unknown[]) => unknown;
    appendSessionMessage: (sessionId: string, message: unknown) => void;
  };
  // One oversized tool result cluster in the compactable middle + a tail user
  // closer (same fixture shape as compaction.test.ts's Stage-A cases).
  const toolCall = { id: "call-big", type: "function", function: { name: "bash", arguments: "{}" } };
  harness.appendSessionMessage(sessionId, harness.buildAssistantMessage(sessionId, "running", [toolCall]));
  harness.appendSessionMessage(
    sessionId,
    Object.assign(buildTestMessage(`tool-big`, sessionId, "tool", "z".repeat(8192 + 4096)), {
      messageParams: { tool_call_id: "call-big" },
    })
  );
  harness.appendSessionMessage(sessionId, buildTestMessage("user-tail", sessionId, "user", "continue"));

  const before = internal.backgroundCompactionEpochs.get(sessionId) ?? 0;
  const outcome = await manager.compactSession(sessionId);
  assert.equal(outcome.applied, true, "stage-A-only trim applies");
  assert.equal(
    internal.backgroundCompactionEpochs.get(sessionId),
    before + 1,
    "Stage-A-only exit bumps the epoch — the meter-epoch guard stays exact"
  );
});

test("maybeStartBackgroundCompaction fires only quiescent+over-threshold, stays silent, cleans up", async () => {
  let compactionCalls = 0;
  const notices: string[] = [];
  const client = makeClient(() => {
    compactionCalls += 1;
  });
  const { manager, internal } = buildManager("deepcode-bgcompact-trigger-home-", client, {
    onAssistantMessage: (message) => {
      if (typeof message.content === "string" && message.content.includes("compacting")) {
        notices.push(message.content);
      }
    },
  });
  const sessionId = await manager.createSession({ text: "" });
  const setStatus = (status: string, activeTokens: number) =>
    internal.updateSessionEntry(sessionId, (entry) => ({ ...entry, status, activeTokens }));

  setStatus("processing", 10_000_000);
  internal.maybeStartBackgroundCompaction(sessionId);
  assert.equal(internal.backgroundCompactions.size, 0, "a running session must not start one");

  setStatus("completed", 0);
  internal.maybeStartBackgroundCompaction(sessionId);
  assert.equal(internal.backgroundCompactions.size, 0, "below-trigger context must not start one");

  setStatus("completed", 10_000_000);
  internal.maybeStartBackgroundCompaction(sessionId);
  assert.equal(internal.backgroundCompactions.size, 1, "quiescent + over-trigger starts the background round");
  const record = internal.backgroundCompactions.get(sessionId);
  assert.ok(record);
  const outcome = await record.promise;
  assert.equal(outcome.applied, true);
  assert.equal(internal.backgroundCompactions.size, 0, "map entry cleaned after settle");
  assert.ok(compactionCalls >= 1, "summary round-trip actually ran");
  assert.equal(notices.length, 0, "background path emits no compacting notice");
});

test("joinBackgroundCompaction waits within budget, aborts past it, and reports whether a record existed", async () => {
  const client = makeClient(() => {});
  const { internal } = buildManager("deepcode-bgcompact-join-home-", client);

  // No record → false, no waiting (the pre-flight recount's cheap guard).
  assert.equal(await internal.joinBackgroundCompaction("sess-none"), false, "empty map reports no record");

  // Fast path: the record settles within the budget → no abort.
  {
    let settle: (value: { applied: boolean }) => void = () => {};
    const promise = new Promise<{ applied: boolean }>((resolve) => {
      settle = resolve;
    });
    const controller = new AbortController();
    internal.backgroundCompactions.set("sess-fast", { promise, controller });
    settle({ applied: true });
    assert.equal(await internal.joinBackgroundCompaction("sess-fast"), true, "record found → true");
    assert.equal(controller.signal.aborted, false, "settled record must not be aborted");
    internal.backgroundCompactions.delete("sess-fast");
  }

  // Timeout path: the record never settles on its own → join aborts it once
  // the (tightened) budget expires.
  {
    let aborted = false;
    let release: (value: { applied: boolean }) => void = () => {};
    const promise = new Promise<{ applied: boolean }>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => {
      aborted = true;
      release({ applied: false });
    });
    internal.backgroundCompactions.set("sess-slow", { promise, controller });
    internal.backgroundCompactionJoinTimeoutMs = 20;
    assert.equal(await internal.joinBackgroundCompaction("sess-slow"), true, "record found → true");
    assert.equal(aborted, true, "past the budget the in-flight summary is aborted");
  }
});

test("startBackgroundCompactionIfEligible bypasses the quiescent gate and honors the measured payload", async () => {
  let compactionCalls = 0;
  const client = makeClient(() => {
    compactionCalls += 1;
  });
  const { manager, internal } = buildManager("deepcode-bgcompact-inturn-home-", client, {
    resolvedSettings: { compactTokenThreshold: 100_000 },
  });
  const sessionId = await manager.createSession({ text: "" });
  internal.updateSessionEntry(sessionId, (entry) => ({ ...entry, status: "processing", activeTokens: 10_000_000 }));

  // The quiescent wrapper still refuses a running session…
  internal.maybeStartBackgroundCompaction(sessionId);
  assert.equal(internal.backgroundCompactions.size, 0, "quiescent wrapper stays status-gated");
  // …but the during-turn call (activation loop's tool-execution window) fires
  // on the freshly measured payload.
  internal.startBackgroundCompactionIfEligible(sessionId, 10_000_000);
  assert.equal(internal.backgroundCompactions.size, 1, "during-turn call fires on a processing session");
  await internal.backgroundCompactions.get(sessionId)!.promise;
  assert.ok(compactionCalls >= 1, "summary round-trip ran");

  internal.startBackgroundCompactionIfEligible(sessionId, 1_000);
  assert.equal(internal.backgroundCompactions.size, 0, "below-trigger measured payload does not fire");
});

test("during-turn trigger + join-first: tool window compacts silently with no inline stall", async () => {
  const notices: string[] = [];
  let compactionCalls = 0;
  // Turn 1's response carries a BATCH of tool calls for an unknown tool — the
  // executor resolves each to an "Unknown tool" error result without running
  // anything real (unknown tools declare no permission scopes), which gives
  // the exact during-turn window: the background summary is in flight while
  // the tool results are being produced.
  const toolCallResponse = {
    choices: [
      {
        message: {
          content: "running",
          tool_calls: Array.from({ length: 30 }, (_, i) => ({
            id: `call-x-${i}`,
            type: "function",
            function: { name: "no_such_tool", arguments: "{}" },
          })),
        },
      },
    ],
  };
  const finalResponse = { choices: [{ message: { content: "done" } }] };
  const client = makeQueuedClient([toolCallResponse, finalResponse], () => {
    compactionCalls += 1;
  });
  const { manager, internal } = buildManager("deepcode-bgcompact-turnwindow-home-", client, {
    resolvedSettings: { compactTokenThreshold: 100_000 },
    onAssistantMessage: (message) => {
      if (typeof message.content === "string" && message.content.includes("compacting")) {
        notices.push(message.content);
      }
    },
  });

  const sessionId = await manager.createSession({ text: `context filler ${"x".repeat(440_000)}` });

  const session = manager.getSession(sessionId)!;
  assert.equal(session.status, "completed", "turn ran to completion against the queued responses");
  assert.equal(compactionCalls, 1, "exactly one summary — join-first suppressed the inline duplicate");
  // Turn 1's pre-flight inline attempt legitimately emits ONE notice: nothing
  // is in flight yet and the range cannot close (no assistant reply exists),
  // so it fails at zero cost — pre-existing foreground fallback behavior. A
  // SECOND notice would mean iteration 2's loop-top/pre-flight failed to see
  // the applied background round (join-first or meter-epoch regression).
  assert.equal(notices.length, 1, "only the first-turn fallback notice — iteration 2 joined instead of stalling");
  const messages = internal.listSessionMessages(sessionId);
  assert.ok(
    messages.some((m) => m.meta?.isSummary),
    "summary written"
  );
  const toolResult = messages.find((m) => m.role === "tool");
  assert.ok(toolResult, "tool result appended during the summary window (CAS-preserved)");
  const pendingAssistant = messages.find(
    (m) =>
      m.role === "assistant" && Array.isArray((m.messageParams as { tool_calls?: unknown[] } | undefined)?.tool_calls)
  );
  assert.ok(pendingAssistant, "assistant carrying the tool call present");
  assert.notEqual(pendingAssistant.compacted, true, "pending-call assistant kept verbatim — pairing intact");
  assert.ok(session.usagePerModel?.["deepseek-v4-flash"], "compaction bucket present");
});
