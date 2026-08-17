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
