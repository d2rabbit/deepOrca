import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import {
  buildPendingToolResumeSystemNote,
  buildPendingToolSynthesisContent,
  PENDING_TOOL_RESUME_MODE_DEFAULT,
  shouldSynthesizePendingToolCalls,
  TOOL_NOT_STARTED_MARKER,
  TOOL_OUTCOME_UNKNOWN_MARKER,
} from "../common/resume-synthesis";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

/** Set homedir in a cross-platform way (HOME on Unix, USERPROFILE on Windows). */
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

function buildManager(settings: Record<string, unknown> = {}): SessionManager {
  return new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model", ...settings }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

const PENDING_TOOL_CALL = {
  id: "call-synth-1",
  type: "function",
  function: { name: "bash", arguments: '{"command":"rm -rf tmp"}' },
};

/** Create a session and leave a trailing pending tool-call batch behind. */
async function createSessionWithPendingToolCall(manager: SessionManager, status: string): Promise<string> {
  const sessionId = await manager.createSession({ text: "do a thing" });
  const internal = manager as unknown as {
    buildAssistantMessage: (sessionId: string, content: string, toolCalls: unknown[]) => unknown;
    appendSessionMessage: (sessionId: string, message: unknown) => void;
    updateSessionEntry: (
      sessionId: string,
      updater: (entry: Record<string, unknown>) => Record<string, unknown>
    ) => unknown;
  };
  const assistantMessage = internal.buildAssistantMessage(sessionId, "Running tools", [PENDING_TOOL_CALL]);
  internal.appendSessionMessage(sessionId, assistantMessage);
  internal.updateSessionEntry(sessionId, (entry) => ({ ...entry, status }));
  return sessionId;
}

test("shouldSynthesizePendingToolCalls applies only to unexpectedly ended runs", () => {
  assert.equal(PENDING_TOOL_RESUME_MODE_DEFAULT, "synthesize");
  // Unexpectedly ended → synthesize.
  assert.equal(shouldSynthesizePendingToolCalls("interrupted", "synthesize"), true);
  assert.equal(shouldSynthesizePendingToolCalls("processing", "synthesize"), true);
  // Designed continuation points → always replay.
  assert.equal(shouldSynthesizePendingToolCalls("paused", "synthesize"), false);
  assert.equal(shouldSynthesizePendingToolCalls("waiting_for_user", "synthesize"), false);
  assert.equal(shouldSynthesizePendingToolCalls("ask_permission", "synthesize"), false);
  assert.equal(shouldSynthesizePendingToolCalls("completed", "synthesize"), false);
  assert.equal(shouldSynthesizePendingToolCalls(undefined, "synthesize"), false);
  // Legacy mode disables synthesis entirely.
  assert.equal(shouldSynthesizePendingToolCalls("interrupted", "replay"), false);
});

test("buildPendingToolSynthesisContent carries marker, tool name and idempotency guidance", () => {
  const notStarted = buildPendingToolSynthesisContent("not-started", "bash");
  assert.ok(notStarted.startsWith(`${TOOL_NOT_STARTED_MARKER}: bash`));
  assert.ok(notStarted.includes("NOT re-executed"));
  assert.ok(notStarted.includes("idempotent"));

  const unknown = buildPendingToolSynthesisContent("outcome-unknown", null);
  assert.ok(unknown.startsWith(TOOL_OUTCOME_UNKNOWN_MARKER));
  assert.ok(unknown.includes("outcome is UNKNOWN"));
  assert.ok(unknown.includes("verify the affected state"));
});

test("buildPendingToolResumeSystemNote is a single resume-note block", () => {
  const note = buildPendingToolResumeSystemNote(2);
  assert.ok(note.startsWith("<resume-note>2 pending tool call(s)"));
  assert.ok(note.endsWith("</resume-note>"));
});

test("resumeSession synthesizes TOOL_NOT_STARTED for interrupted sessions instead of replaying", async () => {
  setHomeDir(createTempDir("deepcode-resume-synth-home-"));
  const manager = buildManager();
  const sessionId = await createSessionWithPendingToolCall(manager, "interrupted");

  await manager.resumeSession(sessionId);

  const messages = (
    manager as unknown as {
      listSessionMessages: (
        sessionId: string
      ) => Array<{ role: string; content: string; messageParams: { tool_call_id?: string } | null }>;
    }
  ).listSessionMessages(sessionId);
  const synthesized = messages.filter(
    (message) => message.role === "tool" && message.messageParams?.tool_call_id === PENDING_TOOL_CALL.id
  );
  assert.equal(synthesized.length, 1);
  assert.ok(synthesized[0].content.includes(TOOL_NOT_STARTED_MARKER));
  assert.ok(synthesized[0].content.includes("bash"));
  const note = messages.find((message) => message.role === "system" && message.content.includes("<resume-note>"));
  assert.ok(note, "resume-note system message appended");
});

test("resumeSession synthesizes TOOL_OUTCOME_UNKNOWN for crash-stale processing sessions", async () => {
  setHomeDir(createTempDir("deepcode-resume-stale-home-"));
  const manager = buildManager();
  const sessionId = await createSessionWithPendingToolCall(manager, "processing");

  await manager.resumeSession(sessionId);

  const messages = (
    manager as unknown as {
      listSessionMessages: (
        sessionId: string
      ) => Array<{ role: string; content: string; messageParams: { tool_call_id?: string } | null }>;
    }
  ).listSessionMessages(sessionId);
  const synthesized = messages.filter(
    (message) => message.role === "tool" && message.messageParams?.tool_call_id === PENDING_TOOL_CALL.id
  );
  assert.equal(synthesized.length, 1);
  assert.ok(synthesized[0].content.includes(TOOL_OUTCOME_UNKNOWN_MARKER));
});

test("resumeSession still replays paused sessions (designed continuation)", async () => {
  setHomeDir(createTempDir("deepcode-resume-paused-home-"));
  const manager = buildManager();
  const sessionId = await createSessionWithPendingToolCall(manager, "paused");

  await manager.resumeSession(sessionId);

  const messages = (
    manager as unknown as { listSessionMessages: (sessionId: string) => Array<{ role: string; content: string }> }
  ).listSessionMessages(sessionId);
  assert.equal(
    messages.filter((message) => message.content.includes(TOOL_NOT_STARTED_MARKER)).length,
    0,
    "paused resume must not synthesize"
  );
});

test("resumePendingToolCalls=replay restores the legacy re-execution behavior", async () => {
  setHomeDir(createTempDir("deepcode-resume-replay-home-"));
  const manager = buildManager({ resumePendingToolCalls: "replay" });
  const sessionId = await createSessionWithPendingToolCall(manager, "interrupted");

  await manager.resumeSession(sessionId);

  const messages = (
    manager as unknown as { listSessionMessages: (sessionId: string) => Array<{ role: string; content: string }> }
  ).listSessionMessages(sessionId);
  assert.equal(
    messages.filter((message) => message.content.includes(TOOL_NOT_STARTED_MARKER)).length,
    0,
    "replay mode must not synthesize"
  );
});
