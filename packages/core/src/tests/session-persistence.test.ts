import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { GitFileHistory } from "../common/file-history";
import { clearSessionState } from "../common/state";
import { SessionManager, type SessionMessage } from "../session";
import {
  setHomeDir,
  hasGit,
  configDirName,
  createFileHistoryCommit,
  getFileHistoryGitDir,
  readFileHistoryManifest,
  runFileHistoryGit,
  createSessionManager,
  createNotifyingSessionManager,
  createMockedClientSessionManager,
  createPermissionSessionManager,
  createMockedClientSessionManagerWithClient,
  createChatResponse,
  createToolCallResponse,
  buildTestMessage,
  createTempDir,
  createNotifyRecorderScript,
  waitForNotifyRecords,
  flushPromises,
  registerSessionTestCleanup,
} from "./session-test-utils";

// Session persistence tests: file history, checkpoints, restore, permissions.
registerSessionTestCleanup();

test("createSession stores /init and sends the active .deepcode project AGENTS path to the LLM", async () => {
  const workspace = createTempDir("deepcode-init-deepcode-workspace-");
  const home = createTempDir("deepcode-init-deepcode-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.mkdirSync(path.join(workspace, ".deepcode"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".deepcode", "AGENTS.md"), "deepcode project instructions", "utf8");
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessage = messages.find((message) => message.role === "user");
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
  }>;
  const openAIUserMessage = openAIMessages.find((message) => message.role === "user");
  const systemContents = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "");

  assert.equal(userMessage?.content, "/init");
  assert.match(openAIUserMessage?.content ?? "", /Update \.\/\.deepcode\/AGENTS\.md/);
  assert.doesNotMatch(openAIUserMessage?.content ?? "", /Update \.\/AGENTS\.md/);
  assert.ok(systemContents.includes("deepcode project instructions"));
  assert.ok(!systemContents.includes("root project instructions"));
});

test("createSession appends default system prompts in prefix-cache-friendly order", async () => {
  const workspace = createTempDir("deepcode-system-order-workspace-");
  const home = createTempDir("deepcode-system-order-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "hello" });
  const systemContents = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "");

  assert.equal(systemContents.length >= 5, true);
  // Prefix-cache order (most stable first), per createSession:
  //   [0] base system prompt + tool docs
  //   [1] AGENTS.md standing instructions
  //   [2] default skill docs
  //   [3] built-in plugin docs
  //   [4] stable workspace environment
  assert.match(systemContents[0] ?? "", /# Available Tools/);
  assert.doesNotMatch(systemContents[0] ?? "", /# Local Workspace Environment/);
  assert.equal(systemContents[1], "root project instructions");
  assert.match(systemContents[2] ?? "", /<karpathy-guidelines-skill>/);
  assert.match(systemContents[2] ?? "", /# Karpathy Guidelines/);
  assert.doesNotMatch(systemContents[2] ?? "", /path="templates\/skills\//);
  assert.match(systemContents[3] ?? "", /<builtin-plugin/);
  assert.match(systemContents[4] ?? "", /# Local Workspace Environment/);
  const environmentJsonMatch = (systemContents[4] ?? "").match(/```json\n([\s\S]+?)\n```/);
  assert.ok(environmentJsonMatch);
  const environmentInfo = JSON.parse(environmentJsonMatch[1] ?? "{}") as { "root path"?: string };
  assert.equal(environmentInfo["root path"], workspace);

  // The date/model line is deliberately NOT part of the cached system prefix — it
  // ships per turn via getCurrentTurnTail so the DeepSeek prefix cache survives
  // day rollovers and model switches. Guard every system message, not just one.
  for (const content of systemContents) {
    assert.doesNotMatch(content, /当前LLM模型为test-model/);
  }
});

test("createSession skips disabled default skills", async () => {
  const workspace = createTempDir("deepcode-disabled-default-skill-workspace-");
  const home = createTempDir("deepcode-disabled-default-skill-home-");
  setHomeDir(home);

  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({
      model: "test-model",
      enabledSkills: { "karpathy-guidelines": false },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const sessionId = await manager.createSession({ text: "hello" });
  const systemContents = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "");

  // With karpathy-guidelines disabled: [0]=tools, [1]=builtin-plugin, [2]=runtime context
  assert.equal(systemContents.length, 3);
  assert.match(systemContents[0] ?? "", /# Available Tools/);
  assert.doesNotMatch(systemContents.join("\n"), /<karpathy-guidelines-skill>/);
  assert.match(systemContents[1] ?? "", /<builtin-plugin/);
  assert.match(systemContents[2] ?? "", /# Local Workspace Environment/);
});

test("createSession includes agent instructions in the skill matching system prompt", async () => {
  const workspace = createTempDir("deepcode-skill-match-create-workspace-");
  const home = createTempDir("deepcode-skill-match-create-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.mkdirSync(path.join(workspace, ".deepcode"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".deepcode", "AGENTS.md"), "prefer project-specific skill matching", "utf8");
  const skillDir = path.join(workspace, ".deepcode", "skills", "project-aware");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: project-aware\ndescription: Match project-specific instructions\n---\n# Project Aware\n",
    "utf8"
  );

  const requests: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (request: any) => {
          requests.push(request);
          return { choices: [{ message: { content: '{"skillNames":[]}' } }] };
        },
      },
    },
  };
  const manager = createMockedClientSessionManagerWithClient(workspace, client);
  (manager as any).activateSession = async () => {};

  await manager.createSession({ text: "pick the right workflow" });

  const messages = (requests[0]?.messages ?? []) as Array<{ role?: string; content?: string }>;
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /<agent-instructions>/);
  assert.match(messages[0]?.content ?? "", /prefer project-specific skill matching/);
  assert.match(messages[0]?.content ?? "", /<\/agent-instructions>/);
  assert.match(messages[0]?.content ?? "", /The candidate skills are as follows/);
  assert.equal(messages[1]?.role, "user");
});

test("replySession includes current agent instructions in the skill matching system prompt", async () => {
  const workspace = createTempDir("deepcode-skill-match-reply-workspace-");
  const home = createTempDir("deepcode-skill-match-reply-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  const requests: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (request: any) => {
          requests.push(request);
          return { choices: [{ message: { content: '{"skillNames":[]}' } }] };
        },
      },
    },
  };
  const manager = createMockedClientSessionManagerWithClient(workspace, client);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "" });
  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "use reply-time agent instructions", "utf8");
  const skillDir = path.join(workspace, ".agents", "skills", "reply-aware");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: reply-aware\ndescription: Match reply-time instructions\n---\n# Reply Aware\n",
    "utf8"
  );

  await manager.replySession(sessionId, { text: "pick the reply workflow" });

  const messages = (requests[0]?.messages ?? []) as Array<{ role?: string; content?: string }>;
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /<agent-instructions>/);
  assert.match(messages[0]?.content ?? "", /use reply-time agent instructions/);
  assert.match(messages[0]?.content ?? "", /<\/agent-instructions>/);
  assert.match(messages[0]?.content ?? "", /The candidate skills are as follows/);
  assert.equal(messages[1]?.role, "user");
});

test("replySession stores /init and sends the active root project AGENTS path to the LLM", async () => {
  const workspace = createTempDir("deepcode-init-root-workspace-");
  const home = createTempDir("deepcode-init-root-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.writeFileSync(path.join(workspace, "AGENTS.md"), "root project instructions", "utf8");

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  await manager.replySession(sessionId, { text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessages = messages.filter((message) => message.role === "user");
  const replyMessage = userMessages[userMessages.length - 1];
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
  }>;
  const openAIUserMessages = openAIMessages.filter((message) => message.role === "user");
  const openAIReplyMessage = openAIUserMessages[openAIUserMessages.length - 1];

  assert.equal(replyMessage?.content, "/init");
  assert.match(openAIReplyMessage?.content ?? "", /Update \.\/AGENTS\.md/);
});

test("createSession stores /init and sends generate prompt when no project AGENTS file is effective", async () => {
  const workspace = createTempDir("deepcode-init-generate-workspace-");
  const home = createTempDir("deepcode-init-generate-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  fs.mkdirSync(path.join(home, ".deepcode"), { recursive: true });
  fs.writeFileSync(path.join(home, ".deepcode", "AGENTS.md"), "user instructions", "utf8");

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "/init" });
  const messages = manager.listSessionMessages(sessionId);
  const userMessage = messages.find((message) => message.role === "user");
  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
    role: string;
    content: string;
  }>;
  const openAIUserMessage = openAIMessages.find((message) => message.role === "user");

  assert.equal(userMessage?.content, "/init");
  assert.match(openAIUserMessage?.content ?? "", /Generate a file named \.\/AGENTS\.md/);
  assert.doesNotMatch(openAIUserMessage?.content ?? "", /Update \.\/AGENTS\.md/);
});

test(
  "SessionManager notifies successful completion with session context",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempDir("deepcode-notify-success-workspace-");
    const home = createTempDir("deepcode-notify-success-home-");
    setHomeDir(home);

    const notifyOutput = path.join(workspace, "notify.jsonl");
    const notifyScript = createNotifyRecorderScript(workspace);
    const manager = createNotifyingSessionManager(
      workspace,
      [createChatResponse("final answer", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })],
      notifyScript,
      notifyOutput
    );

    await manager.createSession({ text: "notify success" });

    const records = await waitForNotifyRecords(notifyOutput, 1);
    assert.equal(records[0]?.STATUS, "completed");
    assert.equal(records[0]?.FAIL_REASON, null);
    assert.equal(records[0]?.BODY, "final answer");
    assert.equal(records[0]?.TITLE, "notify success");
    assert.match(String(records[0]?.DURATION), /^\d+$/);
  }
);

test(
  "SessionManager notifies failed completion with failure context",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempDir("deepcode-notify-failure-workspace-");
    const home = createTempDir("deepcode-notify-failure-home-");
    setHomeDir(home);

    const notifyOutput = path.join(workspace, "notify.jsonl");
    const notifyScript = createNotifyRecorderScript(workspace);
    const manager = createNotifyingSessionManager(
      workspace,
      [
        createChatResponse("first answer", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
        new Error("second request failed"),
      ],
      notifyScript,
      notifyOutput
    );

    const sessionId = await manager.createSession({ text: "notify failure" });
    await waitForNotifyRecords(notifyOutput, 1);
    await manager.replySession(sessionId, { text: "second prompt" });

    const records = await waitForNotifyRecords(notifyOutput, 2);
    const failedRecord = records[1];
    assert.equal(failedRecord?.STATUS, "failed");
    assert.equal(failedRecord?.FAIL_REASON, "second request failed");
    assert.equal(failedRecord?.BODY, "first answer");
    assert.notEqual(failedRecord?.BODY, "stale-body");
    assert.equal(failedRecord?.TITLE, "notify failure");
  }
);

test("replySession continues without appending /continue as a user message", async () => {
  const workspace = createTempDir("deepcode-continue-workspace-");
  const home = createTempDir("deepcode-continue-home-");
  setHomeDir(home);

  const fetchCalls: Array<{ input: string | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ input, init });
    return {
      ok: true,
      text: async () => "",
    } as Response;
  }) as typeof fetch;

  const manager = createSessionManager(workspace);
  const activatedSessionIds: string[] = [];
  (manager as any).activateSession = async (sessionId: string) => {
    activatedSessionIds.push(sessionId);
  };

  const sessionId = await manager.createSession({ text: "first prompt" });
  await flushPromises();
  const messagesBefore = manager.listSessionMessages(sessionId);
  fetchCalls.length = 0;
  activatedSessionIds.length = 0;

  await manager.replySession(sessionId, { text: "/continue" });
  await flushPromises();

  const messagesAfter = manager.listSessionMessages(sessionId);
  const userMessages = messagesAfter.filter((message) => message.role === "user");

  assert.equal(activatedSessionIds.length, 1);
  assert.equal(activatedSessionIds[0], sessionId);
  assert.equal(messagesAfter.length, messagesBefore.length);
  assert.equal(
    userMessages.some((message) => message.content === "/continue"),
    false
  );
  assert.equal(fetchCalls.length, 0);
});

test("replySession records the current file-history branch head as checkpointHash", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-checkpoint-hash-workspace-");
  const home = createTempDir("deepcode-checkpoint-hash-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const checkpointHash = createFileHistoryCommit(home, workspace, sessionId, { "note.txt": "checkpoint\n" });

  await manager.replySession(sessionId, { text: "second prompt" });

  const userMessages = manager.listSessionMessages(sessionId).filter((message) => message.role === "user");
  assert.equal(userMessages[userMessages.length - 1]?.checkpointHash, checkpointHash);
});

test("createSession initializes file-history repo and session branch", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-file-history-init-workspace-");
  const home = createTempDir("deepcode-file-history-init-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  const gitDir = getFileHistoryGitDir(home, workspace);

  assert.ok(fs.existsSync(gitDir));
  assert.ok(userMessage?.checkpointHash);
  assert.equal(
    runFileHistoryGit(gitDir, workspace, ["rev-parse", "--verify", `refs/heads/${sessionId}^{commit}`]).trim(),
    userMessage.checkpointHash
  );
});

test("createSession initializes an empty file-history manifest without scanning existing files", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-file-history-empty-init-workspace-");
  const home = createTempDir("deepcode-file-history-empty-init-home-");
  setHomeDir(home);
  fs.writeFileSync(path.join(workspace, "unrelated.txt"), "keep me\n", "utf8");
  fs.mkdirSync(path.join(workspace, "nested"));
  fs.writeFileSync(path.join(workspace, "nested", "another.txt"), "also keep me\n", "utf8");

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);

  const manifest = readFileHistoryManifest(home, workspace, userMessage.checkpointHash);
  assert.deepEqual(manifest.files, {});
});

test("replySession snapshots manual edits to tracked files before appending the user prompt", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-prompt-checkpoint-manual-edit-workspace-");
  const home = createTempDir("deepcode-prompt-checkpoint-manual-edit-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "hello_world.py");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "create hello world" });
  const gitDir = getFileHistoryGitDir(home, workspace);
  const fileHistory = new GitFileHistory(workspace, gitDir);

  fs.writeFileSync(filePath, 'print("Hello, World!")\n', "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "created hello world"));

  const manualEdit = 'if name == main:\n  print("Hello, World!")\n';
  fs.writeFileSync(filePath, manualEdit, "utf8");
  await manager.replySession(sessionId, { text: "I manually edited @hello_world.py, note it" });
  const manualEditUserMessage = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "user")
    .at(-1);
  assert.ok(manualEditUserMessage?.checkpointHash);

  fs.writeFileSync(filePath, 'if __name__ == "__main__":\n  print("Hello, World!")\n', "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "fixed hello world"));

  manager.restoreSessionCode(sessionId, manualEditUserMessage.id);

  assert.equal(fs.readFileSync(filePath, "utf8"), manualEdit);
});

test("replySession inserts hidden system notice for manually changed tracked files", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-manual-change-notice-home-");
  setHomeDir(home);

  const firstPath = path.join(workspace, "a.txt");
  const secondPath = path.join(workspace, "b.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(firstPath, "one\n", "utf8");
  fs.writeFileSync(secondPath, "two\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [secondPath, firstPath], "track files"));

  fs.writeFileSync(secondPath, "two changed\n", "utf8");
  fs.writeFileSync(firstPath, "one changed\n", "utf8");
  await manager.replySession(sessionId, { text: "check manual changes" });

  const messages = manager.listSessionMessages(sessionId);
  const userIndex = messages.findIndex(
    (message) => message.role === "user" && message.content === "check manual changes"
  );
  assert.ok(userIndex > 0);
  const notice = messages[userIndex - 1];
  assert.equal(notice?.role, "system");
  assert.equal(notice?.visible, false);
  assert.equal(notice?.content, `Note that the user manually modified these files:\n${firstPath}\n${secondPath}`);
});

test("replySession does not insert manual-change notice when tracked files are unchanged", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-no-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-no-manual-change-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "tracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "same\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));

  await manager.replySession(sessionId, { text: "second prompt" });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

test("replySession reports manual deletion of a tracked file", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-manual-delete-notice-workspace-");
  const home = createTempDir("deepcode-manual-delete-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "deleted.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "delete me\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));

  fs.unlinkSync(filePath);
  await manager.replySession(sessionId, { text: "check deletion" });

  const notice = manager
    .listSessionMessages(sessionId)
    .find(
      (message) =>
        message.role === "system" &&
        message.content === `Note that the user manually modified these files:\n${filePath}`
    );
  assert.ok(notice);
});

test("replySession ignores manually created untracked files", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-untracked-manual-file-workspace-");
  const home = createTempDir("deepcode-untracked-manual-file-home-");
  setHomeDir(home);

  const trackedPath = path.join(workspace, "tracked.txt");
  const untrackedPath = path.join(workspace, "untracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(trackedPath, "tracked\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [trackedPath], "track file"));

  fs.writeFileSync(untrackedPath, "new manual file\n", "utf8");
  await manager.replySession(sessionId, { text: "second prompt" });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

test("replySession does not insert manual-change notice for /continue", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-continue-no-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-continue-no-manual-change-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "tracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "before\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));

  fs.writeFileSync(filePath, "manual change\n", "utf8");
  await manager.replySession(sessionId, { text: "/continue" });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

test("replySession does not insert manual-change notice for permission-only replies", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-permission-no-manual-change-notice-workspace-");
  const home = createTempDir("deepcode-permission-no-manual-change-notice-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "tracked.txt");
  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  fs.writeFileSync(filePath, "before\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [filePath], "track file"));
  const assistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need permission",
    [
      {
        id: "call-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: filePath }) },
      },
    ],
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, assistant);

  fs.writeFileSync(filePath, "manual change\n", "utf8");
  await manager.replySession(sessionId, { permissions: [{ toolCallId: "call-read", permission: "allow" }] });

  const notices = manager
    .listSessionMessages(sessionId)
    .filter(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.startsWith("Note that the user manually modified these files:")
    );
  assert.equal(notices.length, 0);
});

test("Write tool advances file-history while preserving the user prompt checkpoint", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-write-checkpoint-workspace-");
  const home = createTempDir("deepcode-write-checkpoint-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "index.html");
  const manager = createMockedClientSessionManager(workspace, [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-write-index",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ file_path: filePath, content: "<h1>Hello</h1>\n" }),
                },
              },
            ],
          },
        },
      ],
    },
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);

  const sessionId = await manager.createSession({ text: "create an index page" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);
  assert.equal(fs.existsSync(filePath), true);

  manager.restoreSessionCode(sessionId, userMessage.id);

  assert.equal(fs.existsSync(filePath), false);
});

test("Write checkpoints restore tool-touched files outside the workspace and leave unrelated files alone", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-write-outside-workspace-");
  const outsideDir = createTempDir("deepcode-write-outside-target-");
  const home = createTempDir("deepcode-write-outside-home-");
  setHomeDir(home);

  const outsideFilePath = path.join(outsideDir, "outside.txt");
  const unrelatedWorkspaceFilePath = path.join(workspace, "unrelated.txt");
  // P0.5 (2026-08-15): allowAll no longer implicitly covers write-out-cwd —
  // out-of-workspace writes force an ask unless explicitly granted. This test
  // exercises the checkpoint machinery, so grant the scope explicitly (the
  // "always allow" path), which also pins the anti-regression semantics: an
  // explicit allow-list entry survives the forceAskDefaulted baseline.
  const manager = createPermissionSessionManager(
    workspace,
    [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-write-outside",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({ file_path: outsideFilePath, content: "outside\n" }),
                  },
                },
              ],
            },
          },
        ],
      },
      createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    ],
    { allow: ["write-out-cwd"], deny: [], ask: [], defaultMode: "allowAll" }
  );

  const sessionId = await manager.createSession({ text: "create an outside file" });
  const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");
  assert.ok(userMessage?.checkpointHash);
  assert.equal(fs.readFileSync(outsideFilePath, "utf8"), "outside\n");

  fs.writeFileSync(unrelatedWorkspaceFilePath, "keep\n", "utf8");
  manager.restoreSessionCode(sessionId, userMessage.id);

  assert.equal(fs.existsSync(outsideFilePath), false);
  assert.equal(fs.readFileSync(unrelatedWorkspaceFilePath, "utf8"), "keep\n");
});

test("missing git executable does not block sessions or Write tool calls", async () => {
  const workspace = createTempDir("deepcode-no-git-write-workspace-");
  const home = createTempDir("deepcode-no-git-write-home-");
  setHomeDir(home);

  const originalPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const filePath = path.join(workspace, "index.html");
    const manager = createMockedClientSessionManager(workspace, [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-write-no-git",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({ file_path: filePath, content: "<h1>No Git</h1>\n" }),
                  },
                },
              ],
            },
          },
        ],
      },
      createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    ]);

    const sessionId = await manager.createSession({ text: "create an index page" });
    const userMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "user");

    assert.equal(fs.readFileSync(filePath, "utf8"), "<h1>No Git</h1>\n");
    assert.equal(userMessage?.checkpointHash, undefined);
    assert.equal(manager.getSession(sessionId)?.status, "completed");
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
});

test("restoreSessionConversation truncates messages before the selected user prompt", async () => {
  const workspace = createTempDir("deepcode-undo-conversation-workspace-");
  const home = createTempDir("deepcode-undo-conversation-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const firstAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "first answer",
    null,
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, firstAssistant);
  await manager.replySession(sessionId, { text: "second prompt" });
  const secondUserMessage = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "user")
    .at(-1);
  assert.ok(secondUserMessage);
  const secondAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "second answer",
    null,
    null
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, secondAssistant);

  manager.restoreSessionConversation(sessionId, secondUserMessage.id);

  const contents = manager.listSessionMessages(sessionId).map((message) => message.content);
  assert.ok(contents.includes("first prompt"));
  assert.ok(contents.includes("first answer"));
  assert.ok(!contents.includes("second prompt"));
  assert.ok(!contents.includes("second answer"));
  assert.equal(manager.getSession(sessionId)?.assistantReply, "first answer");
});

test("restoreSessionCode restores project files from the recorded Git checkpoint", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-undo-code-workspace-");
  const home = createTempDir("deepcode-undo-code-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  const sessionId = "session-code-restore";
  const checkpointHash = createFileHistoryCommit(home, workspace, sessionId, { "tracked.txt": "before\n" });
  const fileHistory = new GitFileHistory(workspace, getFileHistoryGitDir(home, workspace));
  assert.ok(fileHistory.recordCheckpoint(sessionId, [path.join(workspace, "new.txt")], "pre-create new.txt"));
  createFileHistoryCommit(home, workspace, sessionId, { "tracked.txt": "after\n", "new.txt": "remove me\n" });
  fs.writeFileSync(path.join(workspace, "tracked.txt"), "after\n", "utf8");
  fs.writeFileSync(path.join(workspace, "new.txt"), "remove me\n", "utf8");

  (manager as any).appendSessionMessage(sessionId, {
    ...buildTestMessage("user-with-checkpoint", sessionId, "user", "restore here"),
    checkpointHash,
  });

  manager.restoreSessionCode(sessionId, "user-with-checkpoint");

  assert.equal(fs.readFileSync(path.join(workspace, "tracked.txt"), "utf8"), "before\n");
  assert.equal(fs.existsSync(path.join(workspace, "new.txt")), false);
});

test("restoreSessionCode preserves files that predate their first tracked mutation", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-undo-preexisting-files-workspace-");
  const home = createTempDir("deepcode-undo-preexisting-files-home-");
  setHomeDir(home);

  const readmePath = path.join(workspace, "README.md");
  const readmeEnPath = path.join(workspace, "README-en.md");
  const readmeZhPath = path.join(workspace, "README-zh_CN.md");
  fs.writeFileSync(readmePath, "这是一个hello world演示项目\n", "utf8");
  fs.writeFileSync(readmeEnPath, "This is a hello world demo project.\n", "utf8");
  fs.writeFileSync(readmeZhPath, "", "utf8");

  const manager = createSessionManager(workspace);
  const sessionId = "session-undo-preexisting-files";
  const gitDir = getFileHistoryGitDir(home, workspace);
  const fileHistory = new GitFileHistory(workspace, gitDir);
  fileHistory.ensureSession(sessionId);

  const targetCheckpoint = fileHistory.recordCheckpoint(
    sessionId,
    [readmePath, readmeEnPath],
    "checkpoint before syncing all readmes"
  );
  assert.ok(targetCheckpoint);

  assert.ok(fileHistory.recordCheckpoint(sessionId, [readmeZhPath], "pre-sync zh readme"));
  fs.writeFileSync(readmePath, "Synced readme\n", "utf8");
  fs.writeFileSync(readmeEnPath, "Synced readme\n", "utf8");
  fs.writeFileSync(readmeZhPath, "Synced readme\n", "utf8");
  assert.ok(fileHistory.recordCheckpoint(sessionId, [readmePath, readmeEnPath, readmeZhPath], "synced readmes"));

  (manager as any).appendSessionMessage(sessionId, {
    ...buildTestMessage("user-with-readme-checkpoint", sessionId, "user", "sync README*.md"),
    checkpointHash: targetCheckpoint,
  });

  manager.restoreSessionCode(sessionId, "user-with-readme-checkpoint");

  assert.equal(fs.readFileSync(readmePath, "utf8"), "这是一个hello world演示项目\n");
  assert.equal(fs.readFileSync(readmeEnPath, "utf8"), "This is a hello world demo project.\n");
  assert.equal(fs.readFileSync(readmeZhPath, "utf8"), "");
});

test("restoreSessionCode restores deleted tracked files and leaves unrelated files alone", async (t) => {
  if (!hasGit()) {
    t.skip("git is not available");
    return;
  }

  const workspace = createTempDir("deepcode-undo-deleted-files-workspace-");
  const home = createTempDir("deepcode-undo-deleted-files-home-");
  setHomeDir(home);

  const trackedPath = path.join(workspace, "tracked.txt");
  const unrelatedPath = path.join(workspace, "unrelated.txt");
  fs.writeFileSync(trackedPath, "before delete\n", "utf8");
  fs.writeFileSync(unrelatedPath, "do not touch\n", "utf8");

  const manager = createSessionManager(workspace);
  const sessionId = "session-undo-deleted-files";
  const gitDir = getFileHistoryGitDir(home, workspace);
  const fileHistory = new GitFileHistory(workspace, gitDir);
  fileHistory.ensureSession(sessionId);
  const targetCheckpoint = fileHistory.recordCheckpoint(sessionId, [trackedPath], "before delete");
  assert.ok(targetCheckpoint);

  fs.unlinkSync(trackedPath);
  assert.ok(fileHistory.recordCheckpoint(sessionId, [trackedPath], "after delete"));

  (manager as any).appendSessionMessage(sessionId, {
    ...buildTestMessage("user-before-delete", sessionId, "user", "restore deleted file"),
    checkpointHash: targetCheckpoint,
  });

  manager.restoreSessionCode(sessionId, "user-before-delete");

  assert.equal(fs.readFileSync(trackedPath, "utf8"), "before delete\n");
  assert.equal(fs.readFileSync(unrelatedPath, "utf8"), "do not touch\n");
});

test("replySession /continue runs trailing pending tool calls before requesting another response", async () => {
  const workspace = createTempDir("deepcode-continue-tool-workspace-");
  const home = createTempDir("deepcode-continue-tool-home-");
  setHomeDir(home);

  const responses = [
    createChatResponse("continued after tool", {
      prompt_tokens: 9,
      completion_tokens: 2,
      total_tokens: 11,
    }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const pendingAssistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need to read a file",
    [
      {
        id: "call-pending-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: path.join(workspace, "note.txt") }) },
      },
    ],
    null
  ) as SessionMessage;
  fs.writeFileSync(path.join(workspace, "note.txt"), "hello from pending tool\n", "utf8");
  (manager as any).appendSessionMessage(sessionId, pendingAssistant);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, { text: "/continue" });

  const messages = manager.listSessionMessages(sessionId);
  const toolMessage = messages.find((message) => {
    const params = message.messageParams as { tool_call_id?: string } | null;
    return message.role === "tool" && params?.tool_call_id === "call-pending-read";
  });
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const userMessages = messages.filter((message) => message.role === "user");

  assert.ok(toolMessage);
  assert.match(toolMessage.content ?? "", /hello from pending tool/);
  assert.equal(assistantMessages[assistantMessages.length - 1]?.content, "continued after tool");
  assert.equal(
    userMessages.some((message) => message.content === "/continue"),
    false
  );
});

test("replySession rebuilds snippet state from persisted read history before editing", async () => {
  const workspace = createTempDir("deepcode-rebuild-snippet-workspace-");
  const home = createTempDir("deepcode-rebuild-snippet-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "note.txt");
  fs.writeFileSync(filePath, "alpha\nbeta\n", "utf8");

  const responses = [
    createToolCallResponse(
      [
        {
          id: "call-edit",
          type: "function",
          function: {
            name: "edit",
            arguments: JSON.stringify({
              snippet_id: "full_file_5",
              file_path: filePath,
              old_string: "beta",
              new_string: "gamma",
            }),
          },
        },
      ],
      { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    ),
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const readToolMessage = (manager as any).buildToolMessage(
    sessionId,
    "call-read",
    JSON.stringify({
      ok: true,
      name: "read",
      output: "     1\talpha\n     2\tbeta\n",
      metadata: {
        snippet: {
          id: "full_file_5",
          filePath,
          startLine: 1,
          endLine: 3,
        },
      },
    }),
    { name: "read", arguments: JSON.stringify({ file_path: filePath }) }
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, readToolMessage);

  clearSessionState(sessionId);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, { text: "change beta" });

  assert.equal(fs.readFileSync(filePath, "utf8"), "alpha\ngamma\n");
  const editToolMessage = manager.listSessionMessages(sessionId).find((message) => {
    const params = message.messageParams as { tool_call_id?: string } | null;
    return message.role === "tool" && params?.tool_call_id === "call-edit";
  });
  assert.ok(editToolMessage);
  assert.match(editToolMessage.content ?? "", /"ok":true|"ok": true/);
  assert.doesNotMatch(editToolMessage.content ?? "", /Unknown snippet_id/);
});

test("activateSession pauses for permission when a tool call requires ask", async () => {
  const workspace = createTempDir("deepcode-permission-ask-workspace-");
  const home = createTempDir("deepcode-permission-ask-home-");
  setHomeDir(home);

  const manager = createPermissionSessionManager(
    workspace,
    [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-bash",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: JSON.stringify({
                      command: "rg TODO src",
                      description: "Search TODO markers",
                      sideEffects: ["read-in-cwd"],
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ],
    {
      allow: [],
      deny: [],
      ask: [],
      defaultMode: "askAll",
    }
  );

  const sessionId = await manager.createSession({ text: "search todos" });
  const session = manager.getSession(sessionId);
  const assistant = manager
    .listSessionMessages(sessionId)
    .find((message) => message.role === "assistant" && (message.messageParams as any)?.tool_calls);

  assert.equal(session?.status, "ask_permission");
  assert.equal(session?.askPermissions?.[0]?.toolCallId, "call-bash");
  assert.deepEqual(session?.askPermissions?.[0]?.scopes, ["read-in-cwd"]);
  assert.deepEqual(assistant?.meta?.permissions, [{ toolCallId: "call-bash", permission: "ask" }]);
  assert.equal(
    manager.listSessionMessages(sessionId).some((message) => message.role === "tool"),
    false
  );
});

test("activateSession temporarily asks before allowed writes in Plan Mode", async () => {
  const workspace = createTempDir("deepcode-plan-permission-workspace-");
  const home = createTempDir("deepcode-plan-permission-home-");
  setHomeDir(home);

  const manager = createPermissionSessionManager(
    workspace,
    [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-write",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({ file_path: path.join(workspace, "plan.txt"), content: "planned" }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ],
    {
      allow: ["write-in-cwd"],
      deny: [],
      ask: [],
      defaultMode: "allowAll",
    }
  );

  const sessionId = await manager.createSession({ text: "Plan this change", planMode: true });
  const session = manager.getSession(sessionId);
  const assistant = manager
    .listSessionMessages(sessionId)
    .find((message) => message.role === "assistant" && (message.messageParams as any)?.tool_calls);

  assert.equal(session?.status, "ask_permission");
  assert.deepEqual(session?.askPermissions?.[0]?.scopes, ["write-in-cwd"]);
  assert.deepEqual(assistant?.meta?.permissions, [{ toolCallId: "call-write", permission: "ask" }]);
});

test("SessionManager preserves permission_denied status when sessions are reloaded", async () => {
  const workspace = createTempDir("deepcode-permission-denied-workspace-");
  const home = createTempDir("deepcode-permission-denied-home-");
  setHomeDir(home);

  const permissions = {
    allow: [],
    deny: [],
    ask: [],
    defaultMode: "askAll" as const,
  };
  const manager = createPermissionSessionManager(
    workspace,
    [
      {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-bash",
                  type: "function",
                  function: {
                    name: "bash",
                    arguments: JSON.stringify({
                      command: "rg TODO src",
                      description: "Search TODO markers",
                      sideEffects: ["read-in-cwd"],
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    ],
    permissions
  );

  const sessionId = await manager.createSession({ text: "search todos" });
  manager.denySessionPermission(sessionId);

  const reloadedManager = createPermissionSessionManager(workspace, [], permissions);
  const reloadedSession = reloadedManager.getSession(sessionId);

  assert.equal(reloadedSession?.status, "permission_denied");
  assert.equal(reloadedSession?.failReason, "Permission denied by user");
});

test("replySession applies permission replies, runs pending tools, and stores always allow scopes", async () => {
  const workspace = createTempDir("deepcode-permission-allow-workspace-");
  const home = createTempDir("deepcode-permission-allow-home-");
  setHomeDir(home);
  fs.writeFileSync(path.join(workspace, "note.txt"), "allowed content\n", "utf8");

  const manager = createPermissionSessionManager(
    workspace,
    [createChatResponse("continued", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })],
    {
      allow: [],
      deny: [],
      ask: ["read-in-cwd"],
      defaultMode: "allowAll",
    }
  );
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};
  const sessionId = await manager.createSession({ text: "first prompt" });
  const assistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need to read",
    [
      {
        id: "call-read",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ file_path: path.join(workspace, "note.txt") }) },
      },
    ],
    null
  ) as SessionMessage;
  assistant.meta = { ...(assistant.meta ?? {}), permissions: [{ toolCallId: "call-read", permission: "ask" }] };
  (manager as any).appendSessionMessage(sessionId, assistant);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, {
    text: "/continue",
    permissions: [{ toolCallId: "call-read", permission: "allow" }],
    alwaysAllows: ["read-in-cwd"],
  });

  const toolMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "tool");
  const settings = JSON.parse(fs.readFileSync(path.join(workspace, configDirName(workspace), "settings.json"), "utf8"));

  assert.match(toolMessage?.content ?? "", /allowed content/);
  assert.deepEqual(settings.permissions.allow, ["read-in-cwd"]);
  assert.equal(manager.getSession(sessionId)?.status, "completed");
});

test("replySession turns denied permission replies into tool errors before appending user text", async () => {
  const workspace = createTempDir("deepcode-permission-deny-workspace-");
  const home = createTempDir("deepcode-permission-deny-home-");
  setHomeDir(home);

  const manager = createPermissionSessionManager(
    workspace,
    [createChatResponse("handled denial", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })],
    {
      allow: [],
      deny: [],
      ask: ["write-out-cwd"],
      defaultMode: "allowAll",
    }
  );
  const originalActivateSession = manager.activateSession.bind(manager);
  (manager as any).activateSession = async () => {};
  const sessionId = await manager.createSession({ text: "first prompt" });
  const assistant = (manager as any).buildAssistantMessage(
    sessionId,
    "Need to write",
    [
      {
        id: "call-write",
        type: "function",
        function: { name: "write", arguments: JSON.stringify({ file_path: "/tmp/outside.txt", content: "x" }) },
      },
    ],
    null
  ) as SessionMessage;
  assistant.meta = { ...(assistant.meta ?? {}), permissions: [{ toolCallId: "call-write", permission: "ask" }] };
  (manager as any).appendSessionMessage(sessionId, assistant);
  (manager as any).activateSession = originalActivateSession;

  await manager.replySession(sessionId, {
    text: "Do not write outside the workspace.",
    permissions: [{ toolCallId: "call-write", permission: "deny" }],
  });

  const messages = manager.listSessionMessages(sessionId);
  const assistantIndex = messages.findIndex((message) => message.id === assistant.id);
  const toolMessage = messages[assistantIndex + 1];
  const userMessage = messages[assistantIndex + 2];

  assert.equal(toolMessage?.role, "tool");
  assert.match(toolMessage?.content ?? "", /User denied the required permission/);
  assert.equal(userMessage?.role, "user");
  assert.equal(userMessage?.content, "Do not write outside the workspace.");
});

test("replySession preserves raw session messages when a previous tool call is pending", async () => {
  const workspace = createTempDir("deepcode-pending-tool-workspace-");
  const home = createTempDir("deepcode-pending-tool-home-");
  setHomeDir(home);

  globalThis.fetch = (async () =>
    ({
      ok: true,
      text: async () => "",
    }) as Response) as typeof fetch;

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const assistantMessage = (manager as any).buildAssistantMessage(
    sessionId,
    "I will run a tool.",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"sleep 100"}' },
      },
    ],
    ""
  ) as SessionMessage;
  (manager as any).appendSessionMessage(sessionId, assistantMessage);

  await manager.replySession(sessionId, { text: "second prompt" });

  const messages = manager.listSessionMessages(sessionId);
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessage.id);
  assert.notEqual(assistantIndex, -1);
  assert.equal(messages[assistantIndex + 1]?.role, "user");
  assert.equal(messages[assistantIndex + 1]?.content, "second prompt");
  assert.equal(
    messages.some((message) => String(message.content).includes("Previous tool call did not complete.")),
    false
  );
});

test("workspaceDir survives the sessions-index round trip after a reload", async () => {
  const workspace = createTempDir("deepcode-workspacedir-roundtrip-workspace-");
  const home = createTempDir("deepcode-workspacedir-roundtrip-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "first prompt" });
  const expected = manager.getSession(sessionId)?.workspaceDir;
  assert.ok(expected, "createSession did not set workspaceDir");

  // A fresh manager over the same workspace reloads the index from disk —
  // normalizeSessionEntry must whitelist workspaceDir or the first debounced
  // updateSessionEntry after a restart permanently erases it.
  const reloaded = createSessionManager(workspace);
  assert.equal(reloaded.getSession(sessionId)?.workspaceDir, expected);
});

test("normalizeSessionEntry tolerates a missing or non-string workspaceDir", () => {
  const workspace = createTempDir("deepcode-workspacedir-normalize-workspace-");
  const home = createTempDir("deepcode-workspacedir-normalize-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  const normalize = (manager as any).normalizeSessionEntry.bind(manager);

  assert.equal(normalize({ id: "s1" }).workspaceDir, undefined);
  assert.equal(normalize({ id: "s2", workspaceDir: 42 }).workspaceDir, undefined);
  assert.equal(normalize({ id: "s3", workspaceDir: ".deeporca/sessions/s3" }).workspaceDir, ".deeporca/sessions/s3");
});
