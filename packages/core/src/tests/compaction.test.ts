import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import {
  estimateConversationTokens,
  STAGE_A_SKIP_HEADROOM,
  TOOL_RESULT_TRUNCATION_KEEP_CHARS,
  TOOL_RESULT_TRUNCATION_THRESHOLD_CHARS,
  truncateToolResultForCompaction,
  validateCompactionPairing,
  type CompactionMessage,
} from "../common/compaction";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }
});

function msg(role: string, content: string, messageParams?: unknown): CompactionMessage {
  return { role, content, messageParams: messageParams ?? null };
}

test("truncateToolResultForCompaction keeps small results verbatim", () => {
  assert.equal(truncateToolResultForCompaction("short output"), null);
  assert.equal(truncateToolResultForCompaction("x".repeat(TOOL_RESULT_TRUNCATION_THRESHOLD_CHARS)), null);
});

test("truncateToolResultForCompaction shrinks oversized results to head+tail with marker", () => {
  const big = `HEAD${"y".repeat(TOOL_RESULT_TRUNCATION_THRESHOLD_CHARS)}TAIL`;
  const truncated = truncateToolResultForCompaction(big);
  assert.ok(truncated);
  assert.ok(truncated.includes("tool output truncated for compaction"));
  assert.ok(truncated.includes(`original ${big.length} chars`));
  assert.ok(truncated.includes("HEAD"));
  assert.ok(truncated.endsWith("TAIL"));
  assert.ok(truncated.length < big.length / 3);
  const keep = TOOL_RESULT_TRUNCATION_KEEP_CHARS;
  assert.ok(truncated.length < keep * 2 + 300);
});

test("estimateConversationTokens weighs CJK denser than ASCII", () => {
  const ascii = estimateConversationTokens([msg("user", "a".repeat(400))]);
  const cjk = estimateConversationTokens([msg("user", "中".repeat(400))]);
  assert.ok(ascii < 400 / 4 + 100, `ascii estimate sane: ${ascii}`);
  assert.ok(cjk > ascii * 3, `cjk estimate denser: ${cjk} vs ${ascii}`);
});

test("validateCompactionPairing accepts an intact range and rejects an orphaned tool result", () => {
  const call = { id: "call-1" };
  const intact = [
    msg("system", "sys"),
    msg("user", "hi"),
    msg("assistant", "running", { tool_calls: [call] }),
    msg("tool", "result", { tool_call_id: "call-1" }),
    msg("user", "next"),
  ];
  // Range covers the assistant+tool pair → valid.
  assert.equal(validateCompactionPairing(intact, 1, 4), true);
  // Range starts AFTER the assistant → tool result is orphaned → invalid.
  assert.equal(validateCompactionPairing(intact, 3, 4), false);
  // Range with no tool messages → trivially valid.
  assert.equal(validateCompactionPairing(intact, 1, 2), true);
});

test("compactSession stage A truncates oversized tool results and skips the LLM summary", async () => {
  setHomeDir(createTempDir("deepcode-compact-stage-a-home-"));
  const workspace = createTempDir("deepcode-compact-stage-a-workspace-");
  let llmCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async (request: unknown) => {
          // Only count compaction requests — createSession also fires a
          // skill-matching call through the same client.
          if (typeof (request as { temperature?: unknown }).temperature === "number") {
            llmCalls += 1;
          }
          return {
            choices: [{ message: { content: "summary" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          };
        },
      },
    },
  };
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const sessionId = await manager.createSession({ text: "" });
  const internal = manager as unknown as {
    buildAssistantMessage: (sessionId: string, content: string, toolCalls: unknown[]) => unknown;
    appendSessionMessage: (sessionId: string, message: unknown) => void;
    listSessionMessages: (sessionId: string) => Array<{ role: string; content: string; messageParams: unknown }>;
  };
  // 10 oversized tool results in the compactable region — stage A trims them,
  // the projection lands far under the threshold, so no LLM summary call.
  const toolCall = { id: "call-big", type: "function", function: { name: "bash", arguments: "{}" } };
  const assistant = internal.buildAssistantMessage(sessionId, "running", [toolCall]);
  internal.appendSessionMessage(sessionId, assistant);
  for (let i = 0; i < 10; i += 1) {
    internal.appendSessionMessage(sessionId, {
      id: `tool-big-${i}`,
      sessionId,
      role: "tool",
      content: "z".repeat(TOOL_RESULT_TRUNCATION_THRESHOLD_CHARS + 4096),
      contentParams: null,
      messageParams: { tool_call_id: "call-big" },
      compacted: false,
      visible: true,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    });
  }
  internal.appendSessionMessage(sessionId, {
    id: "user-tail",
    sessionId,
    role: "user",
    content: "continue",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
  });

  await manager.compactSession(sessionId);

  const messages = internal.listSessionMessages(sessionId);
  const trimmedTools = messages.filter(
    (message) => message.role === "tool" && message.content.includes("tool output truncated for compaction")
  );
  assert.equal(trimmedTools.length, 10, "all oversized tool results truncated");
  assert.equal(
    messages.some((message) => message.role === "system" && message.content.includes("Here is a summary")),
    false,
    "LLM summary skipped when stage A suffices"
  );
  assert.equal(llmCalls, 0, "no LLM call for compaction");
  assert.equal(manager.getSession(sessionId)?.activeTokens, 0, "token meter reset");

  // The skip headroom constant must stay conservative (see compaction.ts).
  assert.ok(STAGE_A_SKIP_HEADROOM <= 0.7);
});

test("settings.compactTokenThreshold override triggers compaction before the family default", async () => {
  setHomeDir(createTempDir("deepcode-compact-override-home-"));
  const workspace = createTempDir("deepcode-compact-override-workspace-");
  // The reply's filler counts ~110K local tokens (P1: compaction triggers on
  // the locally counted pre-flight budget, not API-reported usage) — BETWEEN
  // the user override (100K) and the unknown-family default (200K):
  // compaction fires only when the user override is honored. Skill-matching
  // requests (response_format json_object) get a canned response without
  // consuming the queue, mirroring session.test's mocked-client helper.
  const responses = [
    { choices: [{ message: { content: "answer" } }] },
    { choices: [{ message: { content: "summary" } }] },
    { choices: [{ message: { content: "after" } }] },
  ];
  const client = {
    chat: {
      completions: {
        create: async (request: unknown) => {
          if ((request as { response_format?: { type?: string } })?.response_format?.type === "json_object") {
            return { choices: [{ message: { content: '{"skillNames":[]}' } }] };
          }
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          return response;
        },
      },
    },
  };
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model", compactTokenThreshold: 100_000 }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const sessionId = await manager.createSession({ text: "" });
  await manager.replySession(sessionId, { text: `filler ${"x".repeat(440_000)}` });

  const usagePerModel = manager.getSession(sessionId)?.usagePerModel as Record<string, unknown>;
  assert.ok(
    usagePerModel?.["deepseek-v4-flash"],
    "compaction ran (background lightweight bucket present) — override honored"
  );
});

test("compaction respects the family default when no override is set", async () => {
  setHomeDir(createTempDir("deepcode-compact-nodefault-home-"));
  const workspace = createTempDir("deepcode-compact-nodefault-workspace-");
  // Same ~110K-token filler, no override → below the 200K unknown-family
  // default → no compaction.
  const responses = [
    { choices: [{ message: { content: "answer" } }] },
    { choices: [{ message: { content: "after" } }] },
  ];
  const client = {
    chat: {
      completions: {
        create: async (request: unknown) => {
          if ((request as { response_format?: { type?: string } })?.response_format?.type === "json_object") {
            return { choices: [{ message: { content: '{"skillNames":[]}' } }] };
          }
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          return response;
        },
      },
    },
  };
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const sessionId = await manager.createSession({ text: "" });
  await manager.replySession(sessionId, { text: `filler ${"x".repeat(440_000)}` });

  const usagePerModel = manager.getSession(sessionId)?.usagePerModel as Record<string, unknown>;
  assert.equal(
    usagePerModel?.["deepseek-v4-flash"],
    undefined,
    "no compaction below the family default — registry behavior unchanged"
  );
});

test("compactSession reports applied:false when the pairing guard rejects the range", async () => {
  setHomeDir(createTempDir("deepcode-compact-guard-status-home-"));
  const workspace = createTempDir("deepcode-compact-guard-status-workspace-");
  const manager = new SessionManager({
    projectRoot: workspace,
    // A REAL client shape is required — compactSession's first early return
    // fires on a null client and would mask the pairing guard entirely.
    // create() throwing doubles as proof the guard turned back BEFORE any
    // LLM summary call.
    createOpenAIClient: () => ({
      client: {
        chat: {
          completions: {
            create: async () => {
              throw new Error("pairing guard must turn back before any summary call");
            },
          },
        },
      } as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
  const sessionId = await manager.createSession({ text: "" });
  const internal = manager as unknown as {
    appendSessionMessage: (sessionId: string, message: unknown) => void;
  };
  const msg = (over: Partial<Record<string, unknown>> & { id: string; role: string }) => ({
    sessionId,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    ...over,
  });
  // ORPHAN tool result (no matching assistant tool_call) sits INSIDE the
  // compactable middle — users before AND after it, so the range search puts
  // it between startIndex and endIndex and the pairing guard must refuse to
  // summarize across it → applied:false (wedge short-circuit's precondition,
  // full-domain audit round-2). A trailing-only orphan never reaches the
  // guard (endIndex lands before it) — fixture orientation is load-bearing.
  for (let i = 0; i < 8; i += 1) {
    internal.appendSessionMessage(sessionId, msg({ id: `u${i}`, role: "user", content: `m${i}` }));
  }
  internal.appendSessionMessage(
    sessionId,
    msg({ id: "orphan", role: "tool", content: "orphan result", messageParams: { tool_call_id: "no-such-call" } })
  );
  for (let i = 8; i < 12; i += 1) {
    internal.appendSessionMessage(sessionId, msg({ id: `u${i}`, role: "user", content: `m${i}` }));
  }
  const outcome = await manager.compactSession(sessionId);
  assert.equal(outcome.applied, false, "guard-rejected compaction must report applied:false");
});

test("compactSession reports applied:true when Stage A trimming alone suffices", async () => {
  setHomeDir(createTempDir("deepcode-compact-stagea-status-home-"));
  const workspace = createTempDir("deepcode-compact-stagea-status-workspace-");
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: {
        chat: {
          completions: {
            create: async () => {
              throw new Error("stage A must skip the LLM summary entirely");
            },
          },
        },
      } as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
  const sessionId = await manager.createSession({ text: "" });
  const internal = manager as unknown as {
    buildAssistantMessage: (sessionId: string, content: string, toolCalls: unknown[]) => unknown;
    appendSessionMessage: (sessionId: string, message: unknown) => void;
  };
  const toolCall = { id: "call-big", type: "function", function: { name: "bash", arguments: "{}" } };
  internal.appendSessionMessage(sessionId, internal.buildAssistantMessage(sessionId, "running", [toolCall]));
  for (let i = 0; i < 10; i += 1) {
    internal.appendSessionMessage(sessionId, {
      id: `tool-big-${i}`,
      sessionId,
      role: "tool",
      content: "z".repeat(TOOL_RESULT_TRUNCATION_THRESHOLD_CHARS + 4096),
      contentParams: null,
      messageParams: { tool_call_id: "call-big" },
      compacted: false,
      visible: true,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    });
  }
  // Tail user message: the compaction range's endIndex search needs a
  // non-tool closer after the tool cluster.
  internal.appendSessionMessage(sessionId, {
    id: "user-tail",
    sessionId,
    role: "user",
    content: "continue",
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
  });
  const outcome = await manager.compactSession(sessionId);
  assert.equal(outcome.applied, true, "Stage-A trim path must report applied:true");
});

test("recovery surfaces the actionable wedge message when compaction cannot apply (wiring)", async () => {
  setHomeDir(createTempDir("deepcode-compact-wedge-wiring-home-"));
  const workspace = createTempDir("deepcode-compact-wedge-wiring-workspace-");
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
  // R3 finding F1: the !applied short-circuit throw used to live INSIDE the
  // try — its own catch replaced the actionable message with the raw provider
  // overflow error. Pin the surfaced wording end-to-end.
  (manager as unknown as { compactSession: () => Promise<{ applied: boolean }> }).compactSession = async () => ({
    applied: false,
  });
  const recovery = (
    manager as unknown as {
      runActivationLoopWithAutoRecovery: (
        runLoop: () => Promise<void>,
        sessionId: string,
        ctrl: AbortController
      ) => Promise<void>;
    }
  ).runActivationLoopWithAutoRecovery.bind(manager);
  const sessionId = await manager.createSession({ text: "hi" });
  // isInterrupted = "no active controller" — register one so the recovery
  // path actually proceeds (a never-activated session short-circuits).
  (manager as unknown as { sessionControllers: Map<string, AbortController> }).sessionControllers.set(
    sessionId,
    new AbortController()
  );
  await assert.rejects(
    recovery(
      async () => {
        throw new Error("provider: maximum context length is 131072 tokens");
      },
      sessionId,
      new AbortController()
    ),
    (error: unknown) => {
      assert.match(error instanceof Error ? error.message : String(error), /could not apply[\s\S]*Summarize or prune/);
      return true;
    }
  );
});
