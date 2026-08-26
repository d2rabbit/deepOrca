import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { getProjectCode, SessionManager } from "../session";
import {
  setHomeDir,
  createSessionAndMessages,
  createSessionManager,
  countLoadedSkillMessages,
  createMockedClientSessionManager,
  createMockedClientSessionManagerWithClient,
  isSkillMatchingRequest,
  createSkillMatchingResponse,
  createChatResponse,
  createTempDir,
  mcpStatusFor,
  waitForMcpStatus,
  registerSessionTestCleanup,
  PLAN_MODE_ON_STATUS_MESSAGE,
  PLAN_MODE_OFF_STATUS_MESSAGE,
} from "./session-test-utils";

// Skills / plugins / plan-mode / MCP lifecycle tests.
registerSessionTestCleanup();

test("SessionManager marks skills loaded from existing session messages", async () => {
  const workspace = createTempDir("deepcode-loaded-skills-workspace-");
  const home = createTempDir("deepcode-loaded-skills-home-");
  setHomeDir(home);

  const skillDir = path.join(home, ".agents", "skills", "lessweb-starter");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: lessweb-starter\ndescription: Create Lessweb projects\n---\n# Lessweb Starter\n",
    "utf8"
  );

  const projectCode = getProjectCode(workspace);
  const projectDir = path.join(home, ".deepcode", "projects", projectCode);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "loaded-session.jsonl"),
    `${JSON.stringify({
      id: "skill-message",
      sessionId: "loaded-session",
      role: "system",
      content: "Use the skill document below",
      contentParams: null,
      messageParams: null,
      compacted: false,
      visible: true,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
      meta: {
        skill: {
          name: "lessweb-starter",
          path: "~/.agents/skills/lessweb-starter/SKILL.md",
          description: "Create Lessweb projects",
          isLoaded: true,
        },
      },
    })}\n`,
    "utf8"
  );

  const manager = createSessionManager(workspace);
  const loadedSkill = (await manager.listSkills("loaded-session")).find((skill) => skill.name === "lessweb-starter");

  assert.equal(loadedSkill?.isLoaded, true);
});

test("SessionManager lists skills from Deep Code and .agents roots by priority", async () => {
  const workspace = createTempDir("deepcode-project-skills-workspace-");
  const home = createTempDir("deepcode-project-skills-home-");
  setHomeDir(home);

  const userSkillDir = path.join(home, ".agents", "skills", "shared");
  fs.mkdirSync(userSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(userSkillDir, "SKILL.md"),
    "---\nname: shared\ndescription: User-level skill\n---\n# Shared\n",
    "utf8"
  );

  const userNativeSkillDir = path.join(home, ".deepcode", "skills", "native-user");
  fs.mkdirSync(userNativeSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(userNativeSkillDir, "SKILL.md"),
    "---\nname: native-user\ndescription: User .deepcode skill\n---\n# Native User\n",
    "utf8"
  );

  const userNativeSharedSkillDir = path.join(home, ".deepcode", "skills", "shared");
  fs.mkdirSync(userNativeSharedSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(userNativeSharedSkillDir, "SKILL.md"),
    "---\nname: shared\ndescription: User .deepcode skill\n---\n# Shared\n",
    "utf8"
  );

  const projectAgentsSkillDir = path.join(workspace, ".agents", "skills", "shared");
  fs.mkdirSync(projectAgentsSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectAgentsSkillDir, "SKILL.md"),
    "---\nname: shared\ndescription: Project .agents skill\n---\n# Shared\n",
    "utf8"
  );

  const projectNativeSkillDir = path.join(workspace, ".deepcode", "skills", "shared");
  fs.mkdirSync(projectNativeSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectNativeSkillDir, "SKILL.md"),
    "---\nname: shared\ndescription: Project .deepcode skill\n---\n# Shared\n",
    "utf8"
  );

  const manager = createSessionManager(workspace);
  const skills = await manager.listSkills();
  const nativeUserSkill = skills.find((skill) => skill.name === "native-user");
  const sharedSkill = skills.find((skill) => skill.name === "shared");

  assert.equal(nativeUserSkill?.path, "~/.deepcode/skills/native-user/SKILL.md");
  assert.equal(nativeUserSkill?.description, "User .deepcode skill");
  assert.equal(sharedSkill?.path, "./.deepcode/skills/shared/SKILL.md");
  assert.equal(sharedSkill?.description, "Project .deepcode skill");
});

test("SessionManager lists built-in plugin skills at lowest priority", async () => {
  const workspace = createTempDir("deepcode-plugin-skills-workspace-");
  const home = createTempDir("deepcode-plugin-skills-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  const skills = await manager.listSkills();
  const skillWriter = skills.find((skill) => skill.name === "skill-writer");
  const selfRefer = skills.find((skill) => skill.name === "deeporca-self-refer");

  // Formerly `bundled:<skill>/SKILL.md`. The built-in skills now ship inside
  // plugin packages (templates/plugins/<pkg>/skills/), so the display path is
  // `plugin:<pkg>/<skill>/SKILL.md`.
  assert.equal(skillWriter?.path, "plugin:meta-skills/skill-writer/SKILL.md");
  assert.equal(selfRefer?.path, "plugin:meta-skills/deeporca-self-refer/SKILL.md");
  assert.match(skillWriter?.description ?? "", /Guide users through creating/);
});

test("SessionManager lets project skills override built-in plugin skills", async () => {
  const workspace = createTempDir("deepcode-bundled-override-workspace-");
  const home = createTempDir("deepcode-bundled-override-home-");
  setHomeDir(home);

  const projectSkillDir = path.join(workspace, ".deepcode", "skills", "skill-writer");
  fs.mkdirSync(projectSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectSkillDir, "SKILL.md"),
    "---\nname: skill-writer\ndescription: Project override skill writer\n---\n# Project Skill Writer\n",
    "utf8"
  );

  const manager = createSessionManager(workspace);
  const skillWriter = (await manager.listSkills()).find((skill) => skill.name === "skill-writer");

  assert.equal(skillWriter?.path, "./.deepcode/skills/skill-writer/SKILL.md");
  assert.equal(skillWriter?.description, "Project override skill writer");
});

test("SessionManager resolves built-in plugin skill prompts", async () => {
  const workspace = createTempDir("deepcode-plugin-prompt-workspace-");
  const home = createTempDir("deepcode-plugin-prompt-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  // buildSkillPrompt is async since G3 (shard recall may consult the router
  // bundle) — small plugin skills take the fail-open full-content path.
  const prompt = await (manager as any).buildSkillPrompt({
    name: "skill-writer",
    path: "plugin:meta-skills/skill-writer/SKILL.md",
    description: "Write skills",
  });

  assert.match(prompt, /<skill-writer-skill/);
  assert.match(prompt, /# Skill Writer/);
});

test("SessionManager persists Plan Mode and appends prompts only on mode transitions", async () => {
  const workspace = createTempDir("deepcode-plan-matched-workspace-");
  const home = createTempDir("deepcode-plan-matched-home-");
  setHomeDir(home);

  const manager = createMockedClientSessionManager(workspace, [
    createChatResponse("planned", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    createChatResponse("still planning", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
    createChatResponse("implementing", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
  ]);
  const sessionId = await manager.createSession({ text: "Plan this change", planMode: true });
  let messages = manager.listSessionMessages(sessionId);
  assert.equal(manager.getSession(sessionId)?.planMode, true);
  assert.equal(messages.filter((message) => message.content === PLAN_MODE_ON_STATUS_MESSAGE).length, 1);
  assert.equal(
    messages.some((message) => message.content?.includes("# Plan Mode (Conversational)")),
    true
  );
  assert.equal(messages.find((message) => message.role === "user")?.meta?.userPrompt?.planMode, true);

  await manager.replySession(sessionId, { text: "Refine it", planMode: true });
  messages = manager.listSessionMessages(sessionId);
  assert.equal(messages.filter((message) => message.content === PLAN_MODE_ON_STATUS_MESSAGE).length, 1);

  await manager.replySession(sessionId, { text: "Implement it", planMode: false });
  messages = manager.listSessionMessages(sessionId);
  assert.equal(manager.getSession(sessionId)?.planMode, false);
  assert.equal(messages.filter((message) => message.content === PLAN_MODE_OFF_STATUS_MESSAGE).length, 1);
});

test("SessionManager excludes the former bundled plan skill and defaults legacy sessions to Default mode", async () => {
  const workspace = createTempDir("deepcode-plan-legacy-workspace-");
  const home = createTempDir("deepcode-plan-legacy-home-");
  setHomeDir(home);

  const manager = createSessionManager(workspace);
  assert.equal(
    (await manager.listSkills()).some((skill) => skill.name === "plan"),
    false
  );

  const sessionId = await manager.createSession({ text: "Default mode" });
  // Simulate a legacy session persisted before `planMode` existed, then force it
  // to disk: the normalization under test happens when the file is read back, so
  // a fresh manager (not the one holding it in memory) is what must see `false`.
  const index = (manager as any).loadSessionsIndex();
  delete index.entries.find((entry: { id: string }) => entry.id === sessionId).planMode;
  (manager as any).saveSessionsIndex(index);
  (manager as any).flushSessionsIndex();
  const reloaded = createSessionManager(workspace);
  assert.equal(reloaded.getSession(sessionId)?.planMode, false);

  const autoMatchManager = createMockedClientSessionManagerWithClient(workspace, {
    chat: {
      completions: {
        create: async (request: any) =>
          isSkillMatchingRequest(request)
            ? createSkillMatchingResponse(["plan"])
            : createChatResponse("default reply", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
      },
    },
  });
  const autoMatchSessionId = await autoMatchManager.createSession({ text: "Plan this feature" });
  const autoMatchMessages = autoMatchManager.listSessionMessages(autoMatchSessionId);
  assert.equal(
    autoMatchMessages.some((message) => message.meta?.skill?.name === "plan"),
    false
  );
});

test("SessionManager excludes disabled skills by resolved skill name", async () => {
  const workspace = createTempDir("deepcode-disabled-skills-workspace-");
  const home = createTempDir("deepcode-disabled-skills-home-");
  setHomeDir(home);

  const writeSkill = (root: string, dirName: string, skillName: string): void => {
    const skillDir = path.join(root, dirName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: ${skillName} description\n---\n# ${skillName}\n`,
      "utf8"
    );
  };

  for (const root of [
    path.join(workspace, ".deepcode", "skills"),
    path.join(workspace, ".agents", "skills"),
    path.join(home, ".deepcode", "skills"),
    path.join(home, ".agents", "skills"),
  ]) {
    writeSkill(root, "skill-writer", "skill-writer");
  }
  writeSkill(path.join(workspace, ".deepcode", "skills"), "frontmatter-disabled", "renamed-disabled");
  writeSkill(path.join(workspace, ".deepcode", "skills"), "enabled-skill", "enabled-skill");

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
      enabledSkills: {
        "skill-writer": false,
        "renamed-disabled": false,
        "deeporca-self-refer": false,
        "skill-digester": false,
        plan: false,
        "enabled-skill": true,
      },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  const skills = await manager.listSkills();
  const skillNames = skills.map((skill) => skill.name);

  // Disabled skills must be excluded regardless of which built-in plugin skills
  // ship alongside (formerly prefixed `bundled:`, now `plugin:<pkg>/…`).
  const projectOwned = skills.filter((skill) => !skill.path.startsWith("plugin:"));
  assert.deepEqual(
    projectOwned.map((skill) => skill.name),
    ["enabled-skill"]
  );
  for (const disabledName of ["skill-writer", "renamed-disabled", "deeporca-self-refer", "skill-digester"]) {
    assert.equal(skillNames.includes(disabledName), false);
  }
  assert.equal(projectOwned[0]?.path, "./.deepcode/skills/enabled-skill/SKILL.md");
});

test("SessionManager keeps implicit opt-out skills available for manual invocation", async () => {
  const workspace = createTempDir("deepcode-manual-only-skill-workspace-");
  const home = createTempDir("deepcode-manual-only-skill-home-");
  setHomeDir(home);

  const skillDir = path.join(workspace, ".agents", "skills", "manual-only");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: manual-only\ndescription: Manual-only skill\nmetadata:\n  allow-implicit-invocation: false\n---\n# Manual Only\n",
    "utf8"
  );

  const manager = createSessionManager(workspace);
  const skill = (await manager.listSkills()).find((candidate) => candidate.name === "manual-only");
  assert.ok(skill);
  assert.equal(skill.allowImplicitInvocation, false);

  const sessionId = await manager.createSession({ text: "", skills: [skill] });
  const skillMessages = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "system" && message.meta?.skill?.name === "manual-only");

  assert.equal(skillMessages.length, 1);
  assert.match(skillMessages[0]?.content ?? "", /<manual-only-skill/);
  assert.doesNotMatch(skillMessages[0]?.content ?? "", /allow-implicit-invocation/);
});

test("SessionManager excludes implicit opt-out skills from automatic matching candidates", async () => {
  const workspace = createTempDir("deepcode-implicit-opt-out-workspace-");
  const home = createTempDir("deepcode-implicit-opt-out-home-");
  setHomeDir(home);
  globalThis.fetch = (async () => ({ ok: true, text: async () => "" }) as Response) as typeof fetch;

  const writeSkill = (name: string, metadata = ""): void => {
    // Test fixture containment (security scan): names are literals in this
    // test — inline-validate a plain single segment that resolves under the
    // temp workspace root.
    if (name.split(/[\\/]/).length !== 1 || name.includes("..") || path.isAbsolute(name)) {
      throw new Error(`unsafe skill fixture name: ${name}`);
    }
    const skillDir = path.join(path.resolve(workspace), ".deepcode", "skills", name);
    const relToWorkspace = path.relative(path.resolve(workspace), skillDir);
    if (relToWorkspace === "" || relToWorkspace.startsWith("..") || path.isAbsolute(relToWorkspace)) {
      throw new Error("skill fixture directory escaped the workspace root");
    }
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} description${metadata}\n---\n# ${name}\n`,
      "utf8"
    );
  };
  writeSkill("auto-skill");
  writeSkill("manual-only", "\nmetadata:\n  allow-implicit-invocation: false");

  const requests: any[] = [];
  const client = {
    chat: {
      completions: {
        create: async (request: any) => {
          requests.push(request);
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse(["manual-only", "auto-skill"]);
          }
          return createChatResponse("done", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
        },
      },
    },
  };
  const manager = createMockedClientSessionManagerWithClient(workspace, client);
  (manager as any).activateSession = async () => {};

  const sessionId = await manager.createSession({ text: "choose an automatic skill" });
  const matchingPrompt = String(requests[0]?.messages?.[0]?.content ?? "");

  assert.match(matchingPrompt, /"name": "auto-skill"/);
  assert.doesNotMatch(matchingPrompt, /"name": "manual-only"/);
  assert.equal(countLoadedSkillMessages(manager.listSessionMessages(sessionId), "auto-skill"), 1);
  assert.equal(countLoadedSkillMessages(manager.listSessionMessages(sessionId), "manual-only"), 0);
});

test("SessionManager dispose disconnects MCP servers", async () => {
  const workspace = createTempDir("deepcode-mcp-dispose-workspace-");
  const serverPath = path.join(workspace, "mcp-server.cjs");
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
  if (!("id" in request)) {
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0" } },
    });
    return;
  }
  if (request.method === "tools/list") {
    if (request.params && request.params.cursor === "page-2") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: [
        { name: "count", inputSchema: { type: "object", properties: {} } }
      ] } });
      return;
    }
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [
      { name: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }
    ], nextCursor: "page-2" } });
    return;
  }
  if (request.method === "tools/call") {
    send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: request.params.name + ":" + (request.params.arguments.text || "") }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace);
  const initPromise = manager.initMcpServers({ smoke: { command: process.execPath, args: [serverPath] } });

  assert.deepEqual(manager.getMcpStatus(), [
    {
      name: "smoke",
      status: "starting",
      connected: false,
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    },
  ]);

  await initPromise;

  // Select by name: initMcpServers also attaches the always-on in-process servers
  // (activity-frames), so `smoke` is not the only entry. Still deep-compared in
  // full, so every field of the configured server stays asserted.
  assert.deepEqual(mcpStatusFor(manager, "smoke"), {
    name: "smoke",
    status: "ready",
    connected: true,
    toolCount: 2,
    tools: ["mcp__smoke__echo", "mcp__smoke__count"],
    promptCount: 0,
    prompts: [],
    resourceCount: 0,
    resources: [],
  });
  const mcpManager = (manager as any).mcpManager;
  const smokeToolNames = mcpManager
    .getMcpToolDefinitions()
    .map((definition: { function: { name: string } }) => definition.function.name)
    .filter((name: string) => name.startsWith("mcp__smoke__"))
    .sort();
  assert.deepEqual(smokeToolNames, ["mcp__smoke__count", "mcp__smoke__echo"]);
  assert.deepEqual(await mcpManager.executeMcpTool("mcp__smoke__echo", { text: "ok" }), {
    ok: true,
    name: "mcp__smoke__echo",
    output: "echo:ok",
  });

  manager.dispose();

  assert.deepEqual(manager.getMcpStatus(), []);
});

test("SessionManager exposes MCP tools with API-safe names and preserves original dispatch names", async () => {
  const workspace = createTempDir("deepcode-mcp-safe-name-workspace-");
  const serverPath = path.join(workspace, "mcp-invalid-name-server.cjs");
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
  if (!("id" in request)) {
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0" } },
    });
    return;
  }
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [
      { name: "speak.text", description: "Speak text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
      { name: "speak/text", description: "Speak text using a slash name", inputSchema: { type: "object", properties: {} } }
    ] } });
    return;
  }
  if (request.method === "tools/call") {
    send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: request.params.name + ":" + (request.params.arguments.text || "") }] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace);
  await manager.initMcpServers({ "voice.box": { command: process.execPath, args: [serverPath] } });

  const status = mcpStatusFor(manager, "voice.box");
  assert.equal(status?.status, "ready");
  assert.deepEqual(status?.tools, ["mcp__voice_box__speak_text", "mcp__voice_box__speak_text_59a610ad"]);

  const mcpManager = (manager as any).mcpManager;
  const definitions = mcpManager.getMcpToolDefinitions();
  const speakText = definitions.find(
    (definition: { function: { name: string } }) => definition.function.name === "mcp__voice_box__speak_text"
  );
  assert.ok(speakText, "expected the API-safe tool name to be exposed");
  assert.match(speakText.function.name, /^[a-zA-Z0-9_-]+$/);
  assert.match(speakText.function.description, /MCP source: voice\.box: speak\.text/);
  assert.deepEqual(await mcpManager.executeMcpTool("mcp__voice_box__speak_text", { text: "ok" }), {
    ok: true,
    name: "mcp__voice_box__speak_text",
    output: "speak.text:ok",
  });

  manager.dispose();
});

test("SessionManager dispose kills live processes without timeout controls", (t) => {
  if (process.platform === "win32") {
    t.skip("process group kill assertion is non-Windows specific");
    return;
  }

  const workspace = createTempDir("deepcode-dispose-process-workspace-");
  const home = createTempDir("deepcode-dispose-process-home-");
  setHomeDir(home);
  const manager = createSessionManager(workspace);
  const sessionId = createSessionAndMessages(manager, "session-dispose-process", "Dispose process session");
  const originalKill = process.kill;
  const killed: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];

  try {
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      killed.push({ pid, signal });
      return true;
    }) as typeof process.kill;

    (manager as any).addSessionProcess(sessionId, 1234, "python3 -m http.server 8080");
    manager.dispose();
  } finally {
    process.kill = originalKill;
  }

  assert.deepEqual(killed, [{ pid: -1234, signal: "SIGKILL" }]);
});

test("SessionManager deleteSession ignores persisted processes that are not live", (t) => {
  if (process.platform === "win32") {
    t.skip("process group kill assertion is non-Windows specific");
    return;
  }

  const workspace = createTempDir("deepcode-delete-stale-process-workspace-");
  const home = createTempDir("deepcode-delete-stale-process-home-");
  setHomeDir(home);
  const manager = createSessionManager(workspace);
  const sessionId = createSessionAndMessages(manager, "session-delete-stale-process", "Delete stale process session");
  (manager as any).updateSessionEntry(sessionId, (entry: any) => ({
    ...entry,
    processes: new Map([["1234", { startTime: new Date().toISOString(), command: "stale process" }]]),
  }));
  const originalKill = process.kill;
  const killed: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];

  try {
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      killed.push({ pid, signal });
      return true;
    }) as typeof process.kill;

    assert.equal(manager.deleteSession(sessionId), true);
  } finally {
    process.kill = originalKill;
  }

  assert.deepEqual(killed, []);
});

test("SessionManager refreshes cached MCP tool definitions after server crash", async () => {
  const workspace = createTempDir("deepcode-mcp-crash-cache-workspace-");
  const serverPath = path.join(workspace, "mcp-server-crash.cjs");
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
  if (!("id" in request)) {
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0" } },
    });
    return;
  }
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [
      { name: "echo", inputSchema: { type: "object", properties: {} } }
    ] } });
    return;
  }
  if (request.method === "prompts/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { prompts: [] } });
    return;
  }
  if (request.method === "resources/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { resources: [] } });
    setTimeout(() => process.exit(9), 10);
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
    "utf8"
  );

  const manager = createSessionManager(workspace);
  await manager.initMcpServers({ crashy: { command: process.execPath, args: [serverPath] } });

  // Count only this server's tools — the always-on in-process servers contribute
  // their own definitions to the same cache.
  const crashyToolCount = () =>
    ((manager as any).mcpToolDefinitions as { function: { name: string } }[]).filter((definition) =>
      definition.function.name.startsWith("mcp__crashy__")
    ).length;

  assert.equal(mcpStatusFor(manager, "crashy")?.status, "ready");
  assert.equal(crashyToolCount(), 1);

  await waitForMcpStatus(manager, "failed", "crashy");

  assert.equal(crashyToolCount(), 0);

  manager.dispose();
});

test("SessionManager reports configured MCP servers as starting before initialization", () => {
  const workspace = createTempDir("deepcode-mcp-configured-workspace-");
  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({
      model: "test-model",
      mcpServers: {
        playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
      },
    }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  assert.deepEqual(manager.getMcpStatus(), [
    {
      name: "playwright",
      status: "starting",
      connected: false,
      toolCount: 0,
      tools: [],
      promptCount: 0,
      prompts: [],
      resourceCount: 0,
      resources: [],
    },
  ]);
});

test("SessionManager reports MCP startup stderr on failure", async () => {
  const workspace = createTempDir("deepcode-mcp-failure-workspace-");
  const serverPath = path.join(workspace, "mcp-server-fail.cjs");
  fs.writeFileSync(serverPath, 'process.stderr.write("mcp startup boom"); process.exit(7);', "utf8");

  const manager = createSessionManager(workspace);
  await manager.initMcpServers({ broken: { command: process.execPath, args: [serverPath] } });

  const [status] = manager.getMcpStatus();
  assert.equal(status?.name, "broken");
  assert.equal(status?.status, "failed");
  assert.equal(status?.connected, false);
  assert.match(status?.error ?? "", /mcp startup boom/);
});

test(
  "SessionManager adds -y when launching MCP servers through npx",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempDir("deepcode-mcp-npx-workspace-");
    const argsPath = path.join(workspace, "args.json");
    const fakeNpxPath = path.join(workspace, "npx");
    fs.writeFileSync(
      fakeNpxPath,
      `#!/usr/bin/env node
const fs = require("fs");
const readline = require("readline");
fs.writeFileSync(process.env.ARGS_PATH, JSON.stringify(process.argv.slice(2)));
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (!("id" in request)) {
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1.0" } },
    });
    return;
  }
  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [] } });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: { content: [] } });
});
`,
      "utf8"
    );
    fs.chmodSync(fakeNpxPath, 0o755);

    const manager = createSessionManager(workspace);
    await manager.initMcpServers({
      npxed: { command: fakeNpxPath, args: ["@playwright/mcp@latest"], env: { ARGS_PATH: argsPath } },
    });

    assert.deepEqual(JSON.parse(fs.readFileSync(argsPath, "utf8")) as string[], ["-y", "@playwright/mcp@latest"]);
    manager.dispose();
  }
);
