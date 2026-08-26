import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getFreshInputTokens,
  getLastPromptTokens,
  getProjectCode,
  LlmStreamIdleTimeoutError,
  SessionManager,
  type ModelUsage,
  type SessionMessage,
  withStreamIdleTimeout,
} from "../session";
import { classifyLlmError } from "../common/llm-error";
import {
  APIUserAbortError,
  buildTestMessage,
  configDirName,
  createChatResponse,
  createChatStreamResponse,
  createMockedClientSessionManager,
  createMockedClientSessionManagerWithClient,
  createQueuedChatClient,
  createSessionAndMessages,
  createSessionManager,
  createSkillMatchingResponse,
  createTempDir,
  escapeRegExp,
  isSkillMatchingRequest,
  mcpStatusFor,
  registerSessionTestCleanup,
  setHomeDir,
} from "./session-test-utils";

// Core session tests: message building, usage accounting, streaming, misc.
registerSessionTestCleanup();

test("getProjectCode shortens long project roots for Windows-compatible storage paths", () => {
  const shortRoot = "short-project";
  assert.equal(getProjectCode(shortRoot), shortRoot.replace(/[\\/]/g, "-").replace(/:/g, ""));

  const longRoot = path.join(
    os.tmpdir(),
    "deepcode-project-code-workspace-with-a-long-name-that-would-create-long-git-internal-paths"
  );
  const projectCode = getProjectCode(longRoot);

  assert.ok(projectCode.length <= 64);
  assert.match(projectCode, /^[A-Za-z0-9._-]+$/);
  assert.notEqual(projectCode, longRoot.replace(/[\\/]/g, "-").replace(/:/g, ""));
});

test("SessionManager preserves structured system content when building OpenAI messages", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const messages: SessionMessage[] = [
    {
      id: "system-image",
      sessionId: "session-1",
      role: "system",
      content: "The read tool has loaded `pixel.png`.",
      contentParams: [
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        },
      ],
      messageParams: null,
      compacted: false,
      visible: false,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    },
  ];

  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
    role: string;
    content: unknown;
  }>;

  assert.equal(openAIMessages.length, 1);
  assert.equal(openAIMessages[0]?.role, "system");
  assert.deepEqual(openAIMessages[0]?.content, [
    { type: "text", text: "The read tool has loaded `pixel.png`." },
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc123" },
    },
  ]);
});

test("SessionManager appends failed background log tail as XML", () => {
  const workspace = createTempDir("deepcode-background-log-workspace-");
  const home = createTempDir("deepcode-background-log-home-");
  setHomeDir(home);
  const outputPath = path.join(workspace, "background.log");
  fs.writeFileSync(outputPath, ["before", "failure <line> & one", "failure line two"].join("\n"), "utf8");
  let systemMessage: SessionMessage | null = null;
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: (message) => {
      systemMessage = message;
    },
  });

  (manager as any).addBackgroundProcessCompletionMessage("session-background-fail", {
    command: "npm test",
    outputPath,
    ok: false,
    exitCode: 1,
    signal: null,
    startedAtMs: 0,
    completedAtMs: 1200,
  });

  assert.ok(systemMessage);
  const message = systemMessage as SessionMessage;
  assert.equal(message.role, "system");
  const content = message.content ?? "";
  assert.match(content, /Background command "npm test" failed with exit code 1/);
  assert.match(content, new RegExp(`<background_task_failure_log path="${escapeRegExp(outputPath)}">`));
  assert.match(content, /failure <line> & one[\s\S]*failure line two/);
  assert.doesNotMatch(content, /failure &lt;line&gt; &amp; one/);
  assert.doesNotMatch(content, /<output_path>/);
  assert.doesNotMatch(content, /<tail>/);
});

test("SessionManager filters image content for non-multimodal models", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "deepseek-chat",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "deepseek-chat" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const messages: SessionMessage[] = [
    {
      id: "system-image",
      sessionId: "session-1",
      role: "system",
      content: "The read tool has loaded `pixel.png`.",
      contentParams: [
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        },
      ],
      messageParams: null,
      compacted: false,
      visible: false,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    },
  ];

  const openAIMessages = (manager as any).buildOpenAIMessages(messages, false, "deepseek-chat") as Array<{
    role: string;
    content: unknown;
  }>;

  assert.equal(openAIMessages.length, 1);
  assert.deepEqual(openAIMessages[0]?.content, [{ type: "text", text: "The read tool has loaded `pixel.png`." }]);
});

test("SessionManager preserves empty reasoning content on assistant tool calls", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const message = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: "{}" },
      },
    ],
    ""
  ) as SessionMessage;

  assert.deepEqual(message.messageParams, {
    tool_calls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: "{}" },
      },
    ],
    reasoning_content: "",
  });

  const openAIMessages = (manager as any).buildOpenAIMessages([message], true, "test-model") as Array<{
    reasoning_content?: string;
  }>;

  assert.equal(openAIMessages[0]?.reasoning_content, "");
});

test("SessionManager repairs legacy thinking tool calls missing reasoning content", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const messages: SessionMessage[] = [
    {
      id: "assistant-tool",
      sessionId: "session-1",
      role: "assistant",
      content: "",
      contentParams: null,
      messageParams: {
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read", arguments: "{}" },
          },
        ],
      },
      compacted: false,
      visible: false,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    },
  ];

  const thinkingMessages = (manager as any).buildOpenAIMessages(messages, true, "test-model") as Array<{
    reasoning_content?: string;
  }>;
  const nonThinkingMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
    reasoning_content?: string;
  }>;

  assert.equal(thinkingMessages[0]?.reasoning_content, "");
  assert.equal(Object.prototype.hasOwnProperty.call(nonThinkingMessages[0] ?? {}, "reasoning_content"), false);
});

test("SessionManager replays normal assistant messages with reasoning content in thinking mode", () => {
  const manager = new SessionManager({
    projectRoot: process.cwd(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const messages: SessionMessage[] = [
    {
      id: "assistant-final",
      sessionId: "session-1",
      role: "assistant",
      content: "Final answer",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    },
  ];

  const thinkingMessages = (manager as any).buildOpenAIMessages(messages, true, "test-model") as Array<{
    reasoning_content?: string;
  }>;
  const nonThinkingMessages = (manager as any).buildOpenAIMessages(messages, false, "test-model") as Array<{
    reasoning_content?: string;
  }>;

  assert.equal(thinkingMessages[0]?.reasoning_content, "");
  assert.equal(Object.prototype.hasOwnProperty.call(nonThinkingMessages[0] ?? {}, "reasoning_content"), false);
});

test("SessionManager normalizes legacy sessions without activeTokens to zero", () => {
  const workspace = createTempDir("deepcode-legacy-active-tokens-workspace-");
  const home = createTempDir("deepcode-legacy-active-tokens-home-");
  setHomeDir(home);

  const projectCode = getProjectCode(workspace);
  const projectDir = path.join(home, ".deepcode", "projects", projectCode);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      originalPath: workspace,
      entries: [
        {
          id: "legacy-session",
          status: "completed",
          usage: { total_tokens: 123 },
          createTime: "2026-01-01T00:00:00.000Z",
          updateTime: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8"
  );

  const manager = createSessionManager(workspace);

  assert.equal(manager.getSession("legacy-session")?.activeTokens, 0);
  assert.equal(manager.getSession("legacy-session")?.usagePerModel, null);
});

test("SessionManager keeps both updates when two sessions are updated inside one debounce window", async () => {
  const workspace = createTempDir("deepcode-index-debounce-workspace-");
  const home = createTempDir("deepcode-index-debounce-home-");
  setHomeDir(home);

  const projectCode = getProjectCode(workspace);
  const projectDir = path.join(home, ".deepcode", "projects", projectCode);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify({
      version: 1,
      originalPath: workspace,
      entries: [
        {
          id: "session-a",
          status: "completed",
          summary: "old a",
          createTime: "2026-01-01T00:00:00.000Z",
          updateTime: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "session-b",
          status: "completed",
          summary: "old b",
          createTime: "2026-01-01T00:00:00.000Z",
          updateTime: "2026-01-01T00:00:00.000Z",
        },
      ],
    }),
    "utf8"
  );

  const manager = createSessionManager(workspace);

  // Index writes are debounced, so both renames land inside a single window.
  // The second update must build on the first — if the read path went to the
  // (still stale) file, session-a's rename would be silently dropped.
  manager.renameSession("session-a", "new a");
  manager.renameSession("session-b", "new b");

  assert.equal(manager.getSession("session-a")?.summary, "new a");
  assert.equal(manager.getSession("session-b")?.summary, "new b");

  // Both must also survive the debounced flush: a fresh manager sees only the file.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const reloaded = createSessionManager(workspace);
  assert.equal(reloaded.getSession("session-a")?.summary, "new a");
  assert.equal(reloaded.getSession("session-b")?.summary, "new b");
});

test("SessionManager keeps usagePerModel null until response usage is available", async () => {
  const workspace = createTempDir("deepcode-null-usage-per-model-workspace-");
  const home = createTempDir("deepcode-null-usage-per-model-home-");
  setHomeDir(home);

  const manager = createMockedClientSessionManager(workspace, [{ choices: [{ message: { content: "no usage" } }] }]);

  const sessionId = await manager.createSession({ text: "" });

  assert.equal(manager.getSession(sessionId)?.usage, null);
  assert.equal(manager.getSession(sessionId)?.usagePerModel, null);
});

test("buildOpenAIMessages inserts interrupted results for missing tool messages", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-missing-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
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
  const userMessage = buildTestMessage("user-after-tool-call", "session-1", "user", "continue");

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, userMessage],
    false,
    "test-model"
  ) as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.equal(openAIMessages.length, 3);
  assert.equal(openAIMessages[0]?.role, "assistant");
  assert.equal(openAIMessages[1]?.role, "tool");
  assert.equal(openAIMessages[1]?.tool_call_id, "call-1");
  assert.match(openAIMessages[1]?.content ?? "", /Previous tool call did not complete/);
  assert.equal(openAIMessages[2]?.role, "user");
});

test("buildOpenAIMessages keeps only the first non-interrupted tool result for a tool call", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-duplicate-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const successToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "2026-05-07 星期四\n" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;
  const interruptedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({
      ok: false,
      name: "bash",
      error: "Previous tool call did not complete.",
      metadata: { interrupted: true },
    }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, successToolMessage, interruptedToolMessage],
    false,
    "test-model"
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;
  const toolMessages = openAIMessages.filter((message) => message.role === "tool");

  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0]?.tool_call_id, "call-1");
  assert.match(toolMessages[0]?.content ?? "", /2026-05-07/);
  assert.doesNotMatch(toolMessages[0]?.content ?? "", /Previous tool call did not complete/);
});

test("buildOpenAIMessages prefers a later real tool result over an earlier interrupted placeholder", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-prefer-real-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const interruptedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({
      ok: false,
      name: "bash",
      error: "Previous tool call did not complete.",
      metadata: { interrupted: true },
    }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;
  const successToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "real result" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, interruptedToolMessage, successToolMessage],
    false,
    "test-model"
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;
  const toolMessages = openAIMessages.filter((message) => message.role === "tool");

  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0]?.tool_call_id, "call-1");
  assert.match(toolMessages[0]?.content ?? "", /real result/);
});

test("buildOpenAIMessages ignores orphan tool messages", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-orphan-tool");
  const userMessage = buildTestMessage("user-1", "session-1", "user", "hello");
  const orphanToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-orphan",
    JSON.stringify({ ok: true, name: "bash", output: "orphan" }),
    { name: "bash", arguments: '{"command":"echo orphan"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [userMessage, orphanToolMessage],
    false,
    "test-model"
  ) as Array<{
    role: string;
  }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["user"]
  );
});

test("buildOpenAIMessages moves a later paired tool message behind its assistant", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-later-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const userMessage = buildTestMessage("user-between", "session-1", "user", "continue");
  const toolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "paired later" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, userMessage, toolMessage],
    false,
    "test-model"
  ) as Array<{ role: string; content: string }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool", "user"]
  );
  assert.match(openAIMessages[1]?.content ?? "", /paired later/);
});

test("buildOpenAIMessages preserves a complete multi-tool happy path", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-multi-tool-happy");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: '{"file_path":"/tmp/a.txt"}' },
      },
      {
        id: "call-2",
        type: "function",
        function: { name: "bash", arguments: '{"command":"pwd"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const firstToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "read", content: "file content" }),
    { name: "read", arguments: '{"file_path":"/tmp/a.txt"}' }
  ) as SessionMessage;
  const secondToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-2",
    JSON.stringify({ ok: true, name: "bash", output: "/tmp\n" }),
    { name: "bash", arguments: '{"command":"pwd"}' }
  ) as SessionMessage;
  const userMessage = buildTestMessage("user-after-complete-tools", "session-1", "user", "thanks");

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, firstToolMessage, secondToolMessage, userMessage],
    false,
    "test-model"
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool", "tool", "user"]
  );
  assert.deepEqual(
    openAIMessages.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    ["call-1", "call-2"]
  );
  assert.equal(
    openAIMessages.some((message) => message.content.includes("Previous tool call did not complete.")),
    false
  );
});

test("buildOpenAIMessages preserves a real failed tool result", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-real-failed-tool");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"false"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const failedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: false, name: "bash", error: "Command failed", metadata: { exitCode: 1 } }),
    { name: "bash", arguments: '{"command":"false"}' }
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, failedToolMessage],
    false,
    "test-model"
  ) as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool"]
  );
  assert.equal(openAIMessages[1]?.tool_call_id, "call-1");
  assert.match(openAIMessages[1]?.content ?? "", /Command failed/);
  assert.doesNotMatch(openAIMessages[1]?.content ?? "", /Previous tool call did not complete/);
});

test("UpdatePlan tool params only show explanation when provided", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-update-plan-params");
  const plan = "## Task List\n\n- [ ] Inspect project";

  const withExplanation = (manager as any).buildToolMessage(
    "session-1",
    "call-plan-1",
    JSON.stringify({ ok: true, name: "UpdatePlan", output: "Plan updated." }),
    { name: "UpdatePlan", arguments: JSON.stringify({ plan, explanation: "Start planning" }) }
  ) as SessionMessage;
  const withoutExplanation = (manager as any).buildToolMessage(
    "session-1",
    "call-plan-2",
    JSON.stringify({ ok: true, name: "UpdatePlan", output: "Plan updated." }),
    { name: "UpdatePlan", arguments: JSON.stringify({ plan }) }
  ) as SessionMessage;

  assert.equal(withExplanation.meta?.paramsMd, "Start planning");
  assert.equal(withoutExplanation.meta?.paramsMd, "");
});

test("Write tool params prefer file_path even when content appears first", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-write-params");
  const filePath = path.join(process.cwd(), "index.html");

  const toolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-write-1",
    JSON.stringify({ ok: true, name: "write", output: "Created file." }),
    {
      name: "write",
      arguments: JSON.stringify({
        content: "// === entry ===\nconsole.log('demo');\n",
        file_path: filePath,
      }),
    }
  ) as SessionMessage;

  assert.equal(toolMessage.meta?.paramsMd, filePath);
});

test("LLM tool calls without ids receive generated 32 character ids", async () => {
  const workspace = createTempDir("deepcode-tool-call-id-workspace-");
  const home = createTempDir("deepcode-tool-call-id-home-");
  setHomeDir(home);

  const filePath = path.join(workspace, "note.txt");
  fs.writeFileSync(filePath, "hello\n", "utf8");
  const plan = "## Task List\n\n- [ ] Inspect current behavior";
  const manager = createMockedClientSessionManager(workspace, [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "",
                type: "function",
                function: {
                  name: "UpdatePlan",
                  arguments: JSON.stringify({ plan, explanation: "Initial plan" }),
                },
              },
              {
                type: "function",
                function: {
                  name: "read",
                  arguments: JSON.stringify({ file_path: filePath }),
                },
              },
            ],
          },
        },
      ],
    },
    createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);

  const sessionId = await manager.createSession({ text: "inspect note" });
  const assistantMessage = manager
    .listSessionMessages(sessionId)
    .find((message) => message.role === "assistant" && (message.messageParams as any)?.tool_calls);
  const toolCalls = (assistantMessage?.messageParams as { tool_calls?: Array<{ id?: unknown }> } | null)?.tool_calls;

  assert.equal(toolCalls?.length, 2);
  assert.match(String(toolCalls?.[0]?.id), /^[0-9a-f]{32}$/);
  assert.match(String(toolCalls?.[1]?.id), /^[0-9a-f]{32}$/);
  assert.notEqual(toolCalls?.[0]?.id, toolCalls?.[1]?.id);

  const toolMessages = manager.listSessionMessages(sessionId).filter((message) => message.role === "tool");
  assert.deepEqual(
    toolMessages.map((message) => (message.messageParams as { tool_call_id?: unknown } | null)?.tool_call_id),
    toolCalls?.map((toolCall) => toolCall.id)
  );

  const readToolMessage = toolMessages.find((message) => JSON.parse(message.content ?? "{}").name === "read");
  assert.equal((readToolMessage?.meta?.function as { name?: string } | undefined)?.name, "read");
  assert.equal(readToolMessage?.meta?.paramsMd, "note.txt");
});

test("buildOpenAIMessages repairs mixed missing duplicate and orphan tool messages", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-mixed-tool-badcase");
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "read", arguments: '{"file_path":"/tmp/missing.txt"}' },
      },
      {
        id: "call-2",
        type: "function",
        function: { name: "bash", arguments: '{"command":"pwd"}' },
      },
    ],
    ""
  ) as SessionMessage;
  const orphanToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-orphan",
    JSON.stringify({ ok: true, name: "bash", output: "orphan" }),
    { name: "bash", arguments: '{"command":"echo orphan"}' }
  ) as SessionMessage;
  const pairedToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-2",
    JSON.stringify({ ok: true, name: "bash", output: "/tmp\n" }),
    { name: "bash", arguments: '{"command":"pwd"}' }
  ) as SessionMessage;
  const duplicateToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-2",
    JSON.stringify({ ok: true, name: "bash", output: "duplicate" }),
    { name: "bash", arguments: '{"command":"pwd"}' }
  ) as SessionMessage;
  const userMessage = buildTestMessage("user-after-mixed-tools", "session-1", "user", "continue");

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [assistantMessage, orphanToolMessage, pairedToolMessage, duplicateToolMessage, userMessage],
    false,
    "test-model"
  ) as Array<{ role: string; content: string; tool_call_id?: string }>;
  const toolMessages = openAIMessages.filter((message) => message.role === "tool");

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool", "tool", "user"]
  );
  assert.deepEqual(
    toolMessages.map((message) => message.tool_call_id),
    ["call-1", "call-2"]
  );
  assert.match(toolMessages[0]?.content ?? "", /Previous tool call did not complete/);
  assert.match(toolMessages[1]?.content ?? "", /\/tmp/);
  assert.equal(
    openAIMessages.some((message) => message.content.includes("orphan")),
    false
  );
  assert.equal(
    openAIMessages.some((message) => message.content.includes("duplicate")),
    false
  );
});

test("buildOpenAIMessages ignores tool messages that appear before their assistant", () => {
  const manager = createSessionManager(process.cwd(), "machine-id-tool-before-assistant");
  const earlyToolMessage = (manager as any).buildToolMessage(
    "session-1",
    "call-1",
    JSON.stringify({ ok: true, name: "bash", output: "too early" }),
    { name: "bash", arguments: '{"command":"date"}' }
  ) as SessionMessage;
  const assistantMessage = (manager as any).buildAssistantMessage(
    "session-1",
    "",
    [
      {
        id: "call-1",
        type: "function",
        function: { name: "bash", arguments: '{"command":"date"}' },
      },
    ],
    ""
  ) as SessionMessage;

  const openAIMessages = (manager as any).buildOpenAIMessages(
    [earlyToolMessage, assistantMessage],
    false,
    "test-model"
  ) as Array<{
    role: string;
    content: string;
    tool_call_id?: string;
  }>;

  assert.deepEqual(
    openAIMessages.map((message) => message.role),
    ["assistant", "tool"]
  );
  assert.equal(openAIMessages[1]?.tool_call_id, "call-1");
  assert.match(openAIMessages[1]?.content ?? "", /Previous tool call did not complete/);
  assert.doesNotMatch(openAIMessages[1]?.content ?? "", /too early/);
});

test("SessionManager accumulates response usage while active tokens track the latest response", async () => {
  const workspace = createTempDir("deepcode-usage-workspace-");
  const home = createTempDir("deepcode-usage-home-");
  setHomeDir(home);

  const responses = [
    createChatResponse("first", {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 7 },
      completion_tokens_details: { reasoning_tokens: 3 },
      prompt_cache_hit_tokens: 7,
      prompt_cache_miss_tokens: 3,
    }),
    createChatResponse("second", {
      prompt_tokens: 20,
      completion_tokens: 7,
      total_tokens: 27,
      prompt_tokens_details: { cached_tokens: 11 },
      completion_tokens_details: { reasoning_tokens: 4 },
      prompt_cache_hit_tokens: 11,
      prompt_cache_miss_tokens: 9,
    }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);

  const sessionId = await manager.createSession({ text: "" });
  await manager.replySession(sessionId, { text: "" });

  const session = manager.getSession(sessionId);
  const usage = session?.usage as Record<string, any>;
  const usagePerModel = session?.usagePerModel?.["test-model"] as Record<string, any>;
  // activeTokens tracks the latest response's PROMPT side (context pressure), not total_tokens.
  assert.equal(session?.activeTokens, 20);
  assert.equal(usage.prompt_tokens, 30);
  assert.equal(usage.completion_tokens, 12);
  assert.equal(usage.total_tokens, 42);
  assert.equal(usage.prompt_tokens_details.cached_tokens, 18);
  assert.equal(usage.completion_tokens_details.reasoning_tokens, 7);
  assert.equal(usage.prompt_cache_hit_tokens, 18);
  assert.equal(usage.prompt_cache_miss_tokens, 12);
  assert.equal(usagePerModel.prompt_tokens, 30);
  assert.equal(usagePerModel.completion_tokens, 12);
  assert.equal(usagePerModel.total_tokens, 42);
  assert.equal(usagePerModel.prompt_tokens_details.cached_tokens, 18);
  assert.equal(usagePerModel.completion_tokens_details.reasoning_tokens, 7);
  assert.equal(usagePerModel.prompt_cache_hit_tokens, 18);
  assert.equal(usagePerModel.prompt_cache_miss_tokens, 12);
  assert.equal(usagePerModel.total_reqs, 2);
});

test("SessionManager stores usage per model across model changes", async () => {
  const workspace = createTempDir("deepcode-usage-per-model-workspace-");
  const home = createTempDir("deepcode-usage-per-model-home-");
  setHomeDir(home);

  let currentModel = "deepseek-v4-pro";
  const responses = [
    createChatResponse("pro response", {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    }),
    createChatResponse("flash response", {
      prompt_tokens: 20,
      completion_tokens: 7,
      total_tokens: 27,
      prompt_cache_hit_tokens: 6,
    }),
  ];
  const client = {
    chat: {
      completions: {
        create: async (request: any) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
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
      client: client as any,
      model: currentModel,
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: currentModel }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const sessionId = await manager.createSession({ text: "" });
  currentModel = "deepseek-v4-flash";
  await manager.replySession(sessionId, { text: "" });

  const session = manager.getSession(sessionId);
  assert.deepEqual(Object.keys(session?.usagePerModel ?? {}).sort(), ["deepseek-v4-flash", "deepseek-v4-pro"]);
  assert.equal(session?.usagePerModel?.["deepseek-v4-pro"]?.prompt_tokens, 10);
  assert.equal(session?.usagePerModel?.["deepseek-v4-pro"]?.completion_tokens, 5);
  assert.equal(session?.usagePerModel?.["deepseek-v4-pro"]?.total_reqs, 1);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.prompt_tokens, 20);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.completion_tokens, 7);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.prompt_cache_hit_tokens, 6);
  assert.equal(session?.usagePerModel?.["deepseek-v4-flash"]?.total_reqs, 1);
  assert.equal(session?.usage?.prompt_tokens, 30);
  assert.equal(session?.usage?.completion_tokens, 12);
  assert.equal(session?.usage?.total_tokens, 42);
});

test("SessionManager resets active tokens to latest post-compaction response usage", async () => {
  const workspace = createTempDir("deepcode-compact-usage-workspace-");
  const home = createTempDir("deepcode-compact-usage-home-");
  setHomeDir(home);

  const responses = [
    createChatResponse("large", {
      prompt_tokens: 139_990,
      completion_tokens: 10,
      total_tokens: 140_000,
    }),
    createChatResponse("summary", {
      prompt_tokens: 100,
      completion_tokens: 23,
      total_tokens: 123,
    }),
    createChatResponse("after compact", {
      prompt_tokens: 5,
      completion_tokens: 2,
      total_tokens: 7,
    }),
  ];
  const manager = createMockedClientSessionManager(workspace, responses);

  const sessionId = await manager.createSession({ text: "" });
  assert.equal(manager.getSession(sessionId)?.activeTokens, 139_990);

  await manager.replySession(sessionId, { text: "" });

  const session = manager.getSession(sessionId);
  const usage = session?.usage as Record<string, any>;
  // Compaction runs on the family lightweight model ("deepseek-v4-flash"), so
  // usagePerModel splits between the session model and the compaction model.
  const usagePerModel = session?.usagePerModel?.["test-model"] as Record<string, any>;
  const compactUsage = session?.usagePerModel?.["deepseek-v4-flash"] as Record<string, any>;
  assert.equal(session?.activeTokens, 5);
  // Total usage across all models.
  assert.equal(usage.prompt_tokens, 140_095);
  assert.equal(usage.completion_tokens, 35);
  assert.equal(usage.total_tokens, 140_130);
  // test-model: response 1 (139990+10) + response 3 (5+2)
  assert.equal(usagePerModel.prompt_tokens, 139_995);
  assert.equal(usagePerModel.completion_tokens, 12);
  assert.equal(usagePerModel.total_tokens, 140_007);
  assert.equal(usagePerModel.total_reqs, 2);
  // deepseek-v4-flash: compaction response 2 (100+23)
  assert.equal(compactUsage.prompt_tokens, 100);
  assert.equal(compactUsage.completion_tokens, 23);
  assert.equal(compactUsage.total_tokens, 123);
  assert.equal(compactUsage.total_reqs, 1);
});

test("SessionManager streams chat completions and counts reasoning progress", async () => {
  const workspace = createTempDir("deepcode-stream-workspace-");
  const home = createTempDir("deepcode-stream-home-");
  setHomeDir(home);

  const progressEvents: Array<{
    phase: string;
    estimatedTokens: number;
    formattedTokens: string;
  }> = [];
  const client = {
    chat: {
      completions: {
        create: async (request: Record<string, unknown>) => {
          assert.equal(request.stream, true);
          assert.deepEqual(request.stream_options, { include_usage: true });
          assert.equal(request.temperature, 0.25);
          return createChatStreamResponse([
            { choices: [{ delta: { reasoning_content: "思考" } }] },
            { choices: [{ delta: { content: "hello" } }] },
            {
              choices: [],
              usage: {
                prompt_tokens: 2,
                completion_tokens: 3,
                total_tokens: 5,
              },
            },
          ]);
        },
      },
    },
  };

  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      temperature: 0.25,
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
    onLlmStreamProgress: (progress) => {
      progressEvents.push({
        phase: progress.phase,
        estimatedTokens: progress.estimatedTokens,
        formattedTokens: progress.formattedTokens,
      });
    },
  });

  const sessionId = await manager.createSession({ text: "" });
  const assistantMessage = manager.listSessionMessages(sessionId).find((message) => message.role === "assistant");

  assert.equal(assistantMessage?.content, "hello");
  assert.equal((assistantMessage?.messageParams as any)?.reasoning_content, "思考");
  assert.equal(manager.getSession(sessionId)?.activeTokens, 2);
  assert.deepEqual(
    progressEvents.map((event) => event.phase),
    ["start", "update", "update", "end"]
  );
  assert.equal(progressEvents[1]?.estimatedTokens, 1);
  assert.equal(progressEvents[2]?.formattedTokens, "3");
});

test("SessionManager persists session and user message before skill matching is cancelled", async () => {
  const workspace = createTempDir("deepcode-skill-abort-workspace-");
  const home = createTempDir("deepcode-skill-abort-home-");
  setHomeDir(home);

  const skillDir = path.join(home, ".agents", "skills", "demo");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n# Demo\n", "utf8");

  // eslint-disable-next-line prefer-const -- must be declared before client which references it
  let manager: SessionManager;
  const client = {
    chat: {
      completions: {
        create: async (request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
          assert.equal(request.temperature, 0.1);
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            // See the APIUserAbortError test below: the abort may already have
            // landed before the request is issued, so check `aborted` first —
            // otherwise this promise never settles and hangs the run.
            if (!signal) {
              reject(new Error("expected an abort signal to be forwarded to the OpenAI client"));
              return;
            }
            if (signal.aborted) {
              reject(new APIUserAbortError());
              return;
            }
            signal.addEventListener("abort", () => reject(new APIUserAbortError()), { once: true });
            queueMicrotask(() => manager.interruptActiveSession());
          });
        },
      },
    },
  };

  manager = createMockedClientSessionManagerWithClient(workspace, client);

  await manager.handleUserPrompt({ text: "please use demo" });

  // Session and user message are persisted before skill matching triggers an abort.
  assert.equal(manager.listSessions().length, 1);
  const [session] = manager.listSessions();
  assert.equal(session?.status, "pending");
  const messages = manager.listSessionMessages(session!.id);
  const userMessage = messages.find((m) => m.role === "user");
  assert.equal(userMessage?.content, "please use demo");
});

test("SessionManager treats OpenAI APIUserAbortError as interrupted", async () => {
  const workspace = createTempDir("deepcode-api-abort-workspace-");
  const home = createTempDir("deepcode-api-abort-home-");
  setHomeDir(home);

  let manager: SessionManager;
  const client = {
    chat: {
      completions: {
        create: async (_request: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            const signal = options?.signal;
            // The request is issued after an await, so the abort can already have
            // landed by the time we get here. The real SDK rejects immediately on
            // an already-aborted signal — mirror that. A listener-only mock would
            // never settle and hang the entire test run instead of failing.
            if (!signal) {
              reject(new Error("expected an abort signal to be forwarded to the OpenAI client"));
              return;
            }
            if (signal.aborted) {
              reject(new APIUserAbortError());
              return;
            }
            signal.addEventListener("abort", () => reject(new APIUserAbortError()), { once: true });
          });
        },
      },
    },
  };

  // eslint-disable-next-line prefer-const -- declared before client, assigned after
  manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
    onSessionEntryUpdated: (entry) => {
      if (entry.status === "processing") {
        queueMicrotask(() => manager.interruptActiveSession());
      }
    },
  });

  await manager.handleUserPrompt({ text: "" });

  const activeSessionId = manager.getActiveSessionId();
  assert.ok(activeSessionId);
  const session = manager.getSession(activeSessionId);
  assert.equal(session?.status, "interrupted");
  assert.equal(session?.failReason, "interrupted");
});

test("SessionManager marks MCP server as failed on single failed attempt (no auto-retry)", async () => {
  const workspace = createTempDir("deepcode-mcp-fail-noworkspace-");
  const serverPath = path.join(workspace, "mcp-server-fail.cjs");
  fs.writeFileSync(serverPath, "process.exit(7);", "utf8");

  const manager = createSessionManager(workspace);
  await manager.initMcpServers({ broken: { command: process.execPath, args: [serverPath] } });

  const status = mcpStatusFor(manager, "broken");
  assert.equal(status?.status, "failed");
  // The SDK's StdioClientTransport drops the child exit code (stdio.js maps
  // `close` to onclose() without it), so the failure surfaces as a transport
  // error rather than the old "exited with code 7". A server that writes to
  // stderr before dying still has that appended — covered by the
  // "reports MCP startup stderr on failure" test.
  assert.match(status?.error ?? "", /Connection closed/);

  manager.dispose();
});

test("SessionManager reconnect succeeds on previously failed server", async () => {
  const workspace = createTempDir("deepcode-mcp-reconn-ok-workspace-");
  const serverPath = path.join(workspace, "mcp-server-ok.cjs");
  fs.writeFileSync(
    serverPath,
    `
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (!("id" in request)) return;
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0" } },
    });
    return;
  }
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace);
  await manager.initMcpServers({ fixable: { command: process.execPath, args: [serverPath] } });

  const status = mcpStatusFor(manager, "fixable");
  assert.equal(status?.status, "ready");
  assert.equal(status?.toolCount, 1);

  manager.dispose();
});

test("SessionManager adjusts the active Bash timeout control and session metadata", async () => {
  const workspace = createTempDir("deepcode-bash-timeout-session-");
  const home = createTempDir("deepcode-bash-timeout-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  const sessionId = await manager.createSession({ text: "hello" });

  (manager as any).addSessionProcess(sessionId, 123, "sleep 10");

  let timeoutInfo = {
    timeoutMs: 10 * 60 * 1000,
    startedAtMs: 1000,
    deadlineAtMs: 1000 + 10 * 60 * 1000,
    timedOut: false,
  };
  (manager as any).setSessionProcessTimeoutControl(sessionId, 123, {
    getInfo: () => timeoutInfo,
    setTimeoutMs: (timeoutMs: number) => {
      timeoutInfo = {
        ...timeoutInfo,
        timeoutMs,
        deadlineAtMs: timeoutInfo.startedAtMs + timeoutMs,
      };
      return timeoutInfo;
    },
  });

  const adjustment = manager.adjustActiveBashTimeout(5 * 60 * 1000);
  const processInfo = manager.getSession(sessionId)?.processes?.get("123");

  assert.equal(adjustment?.processId, "123");
  assert.equal(adjustment?.timeoutMs, 15 * 60 * 1000);
  assert.equal(processInfo?.timeoutMs, 15 * 60 * 1000);
  assert.equal(processInfo?.deadlineAt, new Date(timeoutInfo.deadlineAtMs).toISOString());
});

test("SessionManager.deleteSession removes session entry from the index", () => {
  const workspace = createTempDir("deepcode-delete-workspace-");
  const home = createTempDir("deepcode-delete-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  // Create two sessions
  const session1 = createSessionAndMessages(manager, "session-delete-1", "First session");
  const session2 = createSessionAndMessages(manager, "session-delete-2", "Second session");

  assert.equal(manager.listSessions().length, 2);

  // Delete the first session
  const result = manager.deleteSession(session1);
  assert.equal(result, true);

  const remaining = manager.listSessions();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, session2);
});

test("SessionManager.deleteSession removes the messages file", () => {
  const workspace = createTempDir("deepcode-delete-msg-workspace-");
  const home = createTempDir("deepcode-delete-msg-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const sessionId = createSessionAndMessages(manager, "session-delete-msg", "Test session");
  const messagePath = path.join(home, configDirName(home), "projects", getProjectCode(workspace), `${sessionId}.jsonl`);

  // Verify messages file exists
  assert.ok(fs.existsSync(messagePath));

  manager.deleteSession(sessionId);

  // Verify messages file is removed
  assert.equal(fs.existsSync(messagePath), false);
});

test("SessionManager.deleteSession returns false when session does not exist", () => {
  const workspace = createTempDir("deepcode-delete-nonexist-workspace-");
  const home = createTempDir("deepcode-delete-nonexist-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);

  const result = manager.deleteSession("nonexistent-session-id");
  assert.equal(result, false);
  assert.equal(manager.listSessions().length, 0);
});

test("SessionManager.deleteSession does not affect other sessions", () => {
  const workspace = createTempDir("deepcode-delete-others-workspace-");
  const home = createTempDir("deepcode-delete-others-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  (manager as any).activateSession = async () => {};

  const session1 = createSessionAndMessages(manager, "session-keep-1", "Keep session 1");
  const session2 = createSessionAndMessages(manager, "session-keep-2", "Keep session 2");

  // Delete non-existent session
  const result = manager.deleteSession("non-existent");
  assert.equal(result, false);
  assert.equal(manager.listSessions().length, 2);

  // Delete one session
  assert.equal(manager.deleteSession(session1), true);
  assert.equal(manager.listSessions().length, 1);
  assert.equal(manager.listSessions()[0]?.id, session2);

  // The remaining session should still have its messages accessible
  const messages = manager.listSessionMessages(session2);
  assert.ok(messages.length > 0);
});

test("getLastPromptTokens and getFreshInputTokens apply mutually-exclusive cache accounting", () => {
  const deepseekUsage: ModelUsage = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    total_tokens: 1200,
    prompt_cache_hit_tokens: 750,
  };
  assert.equal(getLastPromptTokens(deepseekUsage), 1000);
  assert.equal(getFreshInputTokens(deepseekUsage), 250);

  // OpenAI-style nested cache accounting collapses to zero fresh input.
  const openAiUsage: ModelUsage = {
    prompt_tokens: 800,
    completion_tokens: 50,
    total_tokens: 850,
    prompt_tokens_details: { cached_tokens: 800 },
  };
  assert.equal(getFreshInputTokens(openAiUsage), 0);

  // A provider glitch (cache read larger than prompt) must clamp at zero.
  const glitchUsage: ModelUsage = {
    prompt_tokens: 100,
    completion_tokens: 1,
    total_tokens: 101,
    prompt_cache_hit_tokens: 400,
  };
  assert.equal(getFreshInputTokens(glitchUsage), 0);

  assert.equal(getLastPromptTokens(null), 0);
  assert.equal(getFreshInputTokens(null), 0);
});

test("withStreamIdleTimeout aborts silent streams and passes active ones through", async () => {
  const silent: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<never>>(() => {}),
    }),
  };
  await assert.rejects(
    async () => {
      for await (const _chunk of withStreamIdleTimeout(silent, 25)) {
        // never reached
      }
    },
    (error: unknown) => {
      assert.ok(error instanceof LlmStreamIdleTimeoutError);
      assert.equal(classifyLlmError(error), "TIMEOUT");
      return true;
    }
  );

  async function* slowStream(): AsyncGenerator<number> {
    yield 1;
    await new Promise((resolve) => setTimeout(resolve, 40));
    yield 2;
  }
  const collected: number[] = [];
  for await (const value of withStreamIdleTimeout(slowStream(), 5000)) {
    collected.push(value);
  }
  assert.deepEqual(collected, [1, 2]);
});

test("activateSession tracks context pressure as prompt-side tokens, not total tokens", async () => {
  const workspace = createTempDir("deepcode-prompt-tokens-workspace-");
  const home = createTempDir("deepcode-prompt-tokens-home-");
  setHomeDir(home);

  const responses: unknown[] = [
    createChatResponse("cached answer", {
      prompt_tokens: 9000,
      completion_tokens: 4000,
      total_tokens: 13000,
      prompt_cache_hit_tokens: 8500,
    }),
  ];
  const manager = createMockedClientSessionManagerWithClient(workspace, createQueuedChatClient(responses));
  const sessionId = await manager.createSession({ text: "hello" });

  const session = manager.getSession(sessionId);
  assert.equal(session?.status, "completed");
  assert.equal(session?.activeTokens, 9000);
  assert.equal(getFreshInputTokens(session?.usage ?? null), 500);
  assert.equal(responses.length, 0);
});

test("activateSession recovers from context overflow via compact-and-retry", async () => {
  const workspace = createTempDir("deepcode-overflow-recovery-workspace-");
  const home = createTempDir("deepcode-overflow-recovery-home-");
  setHomeDir(home);

  const overflowError = Object.assign(
    new Error("This model's maximum context length is 65536 tokens. However, you requested 131072 tokens."),
    { status: 400, code: "invalid_request_error" }
  );
  const responses: unknown[] = [
    createChatResponse("first answer", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
    overflowError,
    createChatResponse("compacted summary", { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 }),
    createChatResponse("recovered answer", { prompt_tokens: 120, completion_tokens: 6, total_tokens: 126 }),
  ];
  const manager = createMockedClientSessionManagerWithClient(workspace, createQueuedChatClient(responses));
  const sessionId = await manager.createSession({ text: "hello" });
  await manager.replySession(sessionId, { text: "tell me more" });

  const session = manager.getSession(sessionId);
  assert.equal(session?.status, "completed");
  assert.equal(session?.failReason, null);
  assert.equal(session?.assistantReply, "recovered answer");
  assert.equal(session?.activeTokens, 120);
  assert.ok(
    manager.listSessionMessages(sessionId).some((message) => message.meta?.isSummary === true),
    "compaction should have inserted a summary message"
  );
  assert.equal(responses.length, 0, "all queued responses should have been consumed");
});

test("activateSession retries exactly once when the stream stalls twice", async () => {
  const workspace = createTempDir("deepcode-overflow-once-workspace-");
  const home = createTempDir("deepcode-overflow-once-home-");
  setHomeDir(home);

  const overflowError = Object.assign(new Error("This model's maximum context length is 65536 tokens."), {
    status: 400,
  });
  const responses: unknown[] = [
    createChatResponse("first answer", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
    overflowError,
    createChatResponse("still too long summary", { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 }),
    overflowError,
  ];
  const manager = createMockedClientSessionManagerWithClient(workspace, createQueuedChatClient(responses));
  const sessionId = await manager.createSession({ text: "hello" });
  await manager.replySession(sessionId, { text: "tell me more" });

  const session = manager.getSession(sessionId);
  assert.equal(session?.status, "failed");
  assert.match(session?.failReason ?? "", /maximum context length/);
  assert.equal(responses.length, 0);
});

test("activateSession does not retry quota errors", async () => {
  const workspace = createTempDir("deepcode-quota-workspace-");
  const home = createTempDir("deepcode-quota-home-");
  setHomeDir(home);

  const quotaError = Object.assign(new Error("402 Insufficient Balance"), {
    status: 402,
    error: { message: "Insufficient Balance" },
  });
  const responses: unknown[] = [
    createChatResponse("first answer", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
    quotaError,
  ];
  const manager = createMockedClientSessionManagerWithClient(workspace, createQueuedChatClient(responses));
  const sessionId = await manager.createSession({ text: "hello" });
  await manager.replySession(sessionId, { text: "again" });

  const session = manager.getSession(sessionId);
  assert.equal(session?.status, "failed");
  assert.match(session?.failReason ?? "", /Insufficient Balance/);
  assert.equal(responses.length, 0, "no retry or compaction call should have been made");
});

test("activateSession retries once after a stalled stream times out", async () => {
  const workspace = createTempDir("deepcode-timeout-retry-workspace-");
  const home = createTempDir("deepcode-timeout-retry-home-");
  setHomeDir(home);

  const responses: unknown[] = [
    createChatResponse("first answer", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
    new Error("Request timed out."),
    createChatResponse("after retry", { prompt_tokens: 90, completion_tokens: 3, total_tokens: 93 }),
  ];
  const manager = createMockedClientSessionManagerWithClient(workspace, createQueuedChatClient(responses));
  const sessionId = await manager.createSession({ text: "hello" });
  await manager.replySession(sessionId, { text: "again" });

  const session = manager.getSession(sessionId);
  assert.equal(session?.status, "completed");
  assert.equal(session?.assistantReply, "after retry");
  assert.equal(session?.activeTokens, 90);
  assert.equal(responses.length, 0);
});
