// specs/model-vendor-profiles P3.3 执行层 — createChatCompletionStream 的
// 静默重试：提交边界（首个可见增量）前的瞬态失败 → 丢弃物理请求原样重发
// 一次；已提交 → 不重试（保持已提交尝试，错误走上层恢复通道）。
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createChatResponse,
  createMockedClientSessionManagerWithClient,
  createQueuedChatClient,
  registerSessionTestCleanup,
  setHomeDir,
} from "./session-test-utils";

registerSessionTestCleanup();

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

/** 未提交即失败的流：只发一个无内容 role delta，然后网络级瞬态错误。 */
function streamThatDiesBeforeCommit(): unknown {
  let yielded = false;
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (!yielded) {
          yielded = true;
          return { done: false, value: { choices: [{ delta: { role: "assistant" } }] } };
        }
        throw new Error("socket hang up");
      },
    }),
  };
}

/** 已提交后失败的流：先发可见 content 增量，然后瞬态错误。 */
function streamThatDiesAfterCommit(): unknown {
  let step = 0;
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        step += 1;
        if (step === 1) {
          return { done: false, value: { choices: [{ delta: { role: "assistant", content: "partial" } }] } };
        }
        throw new Error("socket hang up");
      },
    }),
  };
}

test("silent retry: a transient mid-stream failure before the commit boundary re-issues the request invisibly", async () => {
  const workspace = createTempDir("deeporca-silent-retry-ws-");
  const home = createTempDir("deeporca-silent-retry-home-");
  setHomeDir(home);

  const responses = [
    streamThatDiesBeforeCommit(),
    createChatResponse("recovered", {
      prompt_tokens: 10,
      completion_tokens: 1,
      total_tokens: 11,
    }),
  ];
  const manager = createMockedClientSessionManagerWithClient(workspace, createQueuedChatClient(responses));
  const sessionId = await manager.createSession({ text: "hello" });

  const session = manager.getSession(sessionId);
  assert.equal(session?.status, "completed");
  // 静默重试消费了第二个响应（对调用方透明地完成了同一次请求）。
  assert.equal(responses.length, 0);
  const assistant = manager
    .listSessionMessages(sessionId)
    .filter((message) => message.role === "assistant")
    .at(-1);
  assert.equal(typeof assistant?.content === "string" ? assistant.content : "", "recovered");
});

test("no silent retry after the commit boundary: the visible attempt is kept and the error surfaces", async () => {
  const workspace = createTempDir("deeporca-committed-ws-");
  const home = createTempDir("deeporca-committed-home-");
  setHomeDir(home);

  // 第二个响应排队但**不该被消费**——已提交的失败不允许静默换请求
  //（createQueuedChatClient 的 shift() 原地变更本数组，可作探针）。
  const responses = [
    streamThatDiesAfterCommit(),
    createChatResponse("replacement", {
      prompt_tokens: 10,
      completion_tokens: 1,
      total_tokens: 11,
    }),
  ];
  const manager = createMockedClientSessionManagerWithClient(workspace, createQueuedChatClient(responses));
  const sessionId = await manager.createSession({ text: "hello" });

  const session = manager.getSession(sessionId);
  assert.equal(session?.status, "failed");
  assert.equal(responses.length, 1, "committed failure must not silently consume the next response");
});
