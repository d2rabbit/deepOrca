// Shared helpers for the session test suite (split out of session.test.ts to
// respect the file-length limit; NOT a *.test.ts so the runner ignores it).
import { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GitFileHistory } from "../common/file-history";
import { clearSessionState } from "../common/state";
import { setSerenaDisabled } from "../common/serena-mcp";
import { setSkillSpectorDisabled } from "../common/skill-spector";
import { setCodegraphDisabled } from "../common/codegraph";
import { setCrgDisabled } from "../common/crg";
import { setA2uiDisabled } from "../mcp/a2ui-seam";
import { getProjectCode, SessionManager, type SessionMessage } from "../session";

const originalFetch = globalThis.fetch;

const originalConsoleWarn = console.warn;

const originalHome = process.env.HOME;

const originalUserProfile = process.env.USERPROFILE;

const tempDirs: string[] = [];

export const PLAN_MODE_ON_STATUS_MESSAGE = "  └ Plan mode on — read-only planning. Awaiting <proposed_plan>.";

export const PLAN_MODE_OFF_STATUS_MESSAGE = "  └ Plan mode off.";

/** Set homedir in a cross-platform way (HOME on Unix, USERPROFILE on Windows). */
export function setHomeDir(dir: string): void {
  process.env.HOME = dir;
  if (process.platform === "win32") {
    process.env.USERPROFILE = dir;
  }
}

/** Register per-file cleanup (globals + temp dirs). Call once at each test file's top level. */
export function registerSessionTestCleanup(): void {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalConsoleWarn;
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

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
}

/**
 * Helper: creates a session and writes a few messages to it so we can test
 * that deleteSession removes both the index entry and the messages file.
 */
export function createSessionAndMessages(manager: SessionManager, sessionId: string, summary: string): string {
  const now = new Date().toISOString();
  const index = (manager as any).loadSessionsIndex();
  index.entries.push({
    id: sessionId,
    summary,
    assistantReply: null,
    assistantThinking: null,
    assistantRefusal: null,
    toolCalls: null,
    status: "completed",
    failReason: null,
    usage: null,
    usagePerModel: null,
    activeTokens: 0,
    createTime: now,
    updateTime: now,
    processes: null,
  });
  (manager as any).saveSessionsIndex(index);

  // Write a couple of message lines to the messages file
  const projectDir = (manager as any).getProjectStorage().projectDir;
  const messagePath = path.join(projectDir, `${sessionId}.jsonl`);
  const msg = JSON.stringify({
    id: "msg-1",
    sessionId,
    role: "user",
    content: summary,
    visible: true,
    createTime: now,
    updateTime: now,
  });
  fs.writeFileSync(messagePath, `${msg}\n`, "utf8");

  return sessionId;
}

export function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Mirrors app-dirs resolution: legacy .deepcode wins when present, else .deeporca.
export function configDirName(base: string): string {
  return fs.existsSync(path.join(base, ".deepcode")) ? ".deepcode" : ".deeporca";
}

export function createFileHistoryCommit(
  home: string,
  workspace: string,
  sessionId: string,
  files: Record<string, string>
): string {
  const projectCode = getProjectCode(workspace);
  const gitDir = path.join(home, configDirName(home), "projects", projectCode, "file-history", ".git");
  const fileHistory = new GitFileHistory(workspace, gitDir);
  fileHistory.ensureSession(sessionId);

  const workspaceRoot = path.resolve(workspace);
  const filePaths: string[] = [];
  for (const [relativePath, content] of Object.entries(files)) {
    // Fixture paths are workspace-relative by contract — resolve against the
    // workspace root and refuse anything that escapes it (absolute paths,
    // ".." segments).
    const filePath = path.resolve(workspaceRoot, relativePath);
    if (filePath !== workspaceRoot && !filePath.startsWith(workspaceRoot + path.sep)) {
      throw new Error(`createFileHistoryCommit: fixture path escapes the workspace: ${relativePath}`);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    filePaths.push(filePath);
  }
  const commitHash = fileHistory.recordCheckpoint(sessionId, filePaths, "checkpoint");
  assert.ok(commitHash);
  return commitHash;
}

export function getFileHistoryGitDir(home: string, workspace: string): string {
  const projectCode = getProjectCode(workspace);
  return path.join(home, configDirName(home), "projects", projectCode, "file-history", ".git");
}

export function readFileHistoryManifest(home: string, workspace: string, checkpointHash: string): any {
  const gitDir = getFileHistoryGitDir(home, workspace);
  return JSON.parse(
    runFileHistoryGit(gitDir, workspace, ["cat-file", "blob", `${checkpointHash}:.deeporca-file-history.json`])
  );
}

export function runFileHistoryGit(
  gitDir: string,
  workspace: string,
  args: string[],
  input = "",
  env: NodeJS.ProcessEnv = process.env
): string {
  return execFileSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.eol=lf", `--git-dir=${gitDir}`, `--work-tree=${workspace}`, ...args],
    {
      encoding: "utf8",
      input,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

export function createSessionManager(projectRoot: string): SessionManager {
  return new SessionManager({
    projectRoot,
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
}

export function countLoadedSkillMessages(messages: SessionMessage[], skillName: string): number {
  return messages.filter((message) => message.role === "system" && message.meta?.skill?.name === skillName).length;
}

export function createNotifyingSessionManager(
  projectRoot: string,
  responses: unknown[],
  notifyPath: string,
  notifyOutput: string
): SessionManager {
  const client = {
    chat: {
      completions: {
        create: async (request: any) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          if (response instanceof Error) {
            throw response;
          }
          return response;
        },
      },
    },
  };

  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
      notify: notifyPath,
      env: {
        NOTIFY_OUTPUT: notifyOutput,
        STATUS: "stale-status",
        FAIL_REASON: "stale-failure",
        BODY: "stale-body",
        TITLE: "stale-title",
      },
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

export function createMockedClientSessionManager(projectRoot: string, responses: unknown[]): SessionManager {
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

  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

export function createPermissionSessionManager(
  projectRoot: string,
  responses: unknown[],
  permissions: {
    allow: any[];
    deny: any[];
    ask: any[];
    defaultMode: "allowAll" | "askAll";
  }
): SessionManager {
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

  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model", permissions }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

export function createMockedClientSessionManagerWithClient(projectRoot: string, client: unknown): SessionManager {
  return new SessionManager({
    projectRoot,
    createOpenAIClient: () => ({
      client: client as any,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
}

export class APIUserAbortError extends Error {}

export function isSkillMatchingRequest(request: any): boolean {
  return request?.response_format?.type === "json_object";
}

export function createSkillMatchingResponse(skillNames: string[] = []): unknown {
  return { choices: [{ message: { content: JSON.stringify({ skillNames }) } }] };
}

export function createChatResponse(content: string, usage: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { content } }],
    usage,
  };
}

export function createToolCallResponse(toolCalls: unknown[], usage: Record<string, unknown>): unknown {
  return {
    choices: [{ message: { content: "", tool_calls: toolCalls } }],
    usage,
  };
}

export function buildTestMessage(
  id: string,
  sessionId: string,
  role: SessionMessage["role"],
  content: string
): SessionMessage {
  return {
    id,
    sessionId,
    role,
    content,
    contentParams: null,
    messageParams: null,
    compacted: false,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
  };
}

export async function* createChatStreamResponse(
  chunks: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

export function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  // Opt every throwaway workspace out of the built-in MCP servers. Serena and
  // SkillSpector are injected for *every* project when uv is present (see
  // augmentMcpServersWithBuiltins), so without this a test that configures one
  // stub server actually gets two or three, shifting getMcpStatus() indices and
  // paying a 30s startup timeout each — ~180s of the suite's runtime. Disabling
  // here (the single place every test obtains a directory) also makes results
  // identical on machines with and without uv installed, rather than depending
  // on the host. Same reasoning as the process-wide HOME isolation in
  // run-tests.mjs: do it once, centrally, so individual tests cannot get it wrong.
  setSerenaDisabled(dir, true);
  setSkillSpectorDisabled(dir, true);
  setCodegraphDisabled(dir, true);
  setCrgDisabled(dir, true);
  setA2uiDisabled(dir, true);
  return dir;
}

/**
 * MCP status for one configured server, by name.
 *
 * SessionManager always attaches in-process MCP servers (activity-frames, and
 * a2ui unless disabled) to every project, so getMcpStatus() is not just the
 * servers a test configured and index 0 is not necessarily the test's own server.
 * activity-frames has no opt-out by design, so tests select by name instead of
 * position.
 */
export function mcpStatusFor(manager: SessionManager, serverName: string) {
  return manager.getMcpStatus().find((entry) => entry.name === serverName);
}

export function createNotifyRecorderScript(dir: string): string {
  const scriptPath = path.join(dir, "notify-recorder.cjs");
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("fs");
const keys = ["DURATION", "STATUS", "FAIL_REASON", "BODY", "TITLE"];
const record = {};
for (const key of keys) {
  record[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : null;
}
fs.appendFileSync(process.env.NOTIFY_OUTPUT, JSON.stringify(record) + "\\n", "utf8");
`,
    "utf8"
  );
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

export async function waitForNotifyRecords(
  outputPath: string,
  expectedCount: number
): Promise<Array<Record<string, unknown>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(outputPath)) {
      const records = fs
        .readFileSync(outputPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      if (records.length >= expectedCount) {
        return records;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`expected ${expectedCount} notify records in ${outputPath}`);
}

export async function waitForMcpStatus(
  manager: SessionManager,
  expectedStatus: string,
  serverName?: string
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const entry = serverName ? mcpStatusFor(manager, serverName) : manager.getMcpStatus()[0];
    if (entry?.status === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`expected MCP status ${expectedStatus}${serverName ? ` for ${serverName}` : ""}`);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Mock chat client for recovery-path tests: unlike createMockedClientSessionManager,
 * queued Error instances are THROWN (not returned as a response body), so they
 * exercise the activateSession error handling (classify → compact/retry → fail).
 */
export function createQueuedChatClient(responses: unknown[]): unknown {
  return {
    chat: {
      completions: {
        create: async (request: any) => {
          if (isSkillMatchingRequest(request)) {
            return createSkillMatchingResponse();
          }
          const response = responses.shift();
          assert.ok(response, "expected a queued chat response");
          if (response instanceof Error) {
            throw response;
          }
          return response;
        },
      },
    },
  };
}
