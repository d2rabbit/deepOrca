// Standalone non-streaming completion (specs/model-fleet-adaptation D3):
// flag-aware dispatch for out-of-session LLM surfaces. OFF = the injected
// client serves the request (today's behavior); ON = the experimental
// channel streams synthetic chunks reduced into one message, against a
// local SSE HTTP server (real fetch/undici path).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { writeSettings } from "../settings";
import { runStandaloneChatCompletion } from "../common/ai-sdk-transport";
import { registerSessionTestCleanup, setHomeDir } from "./session-test-utils";

registerSessionTestCleanup();
setHomeDir(fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-standalone-")));

function sseServer(): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ choices: [{ delta: { content: "hi from sdk" } }] });
    send({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: '{"x":1}' } },
            ],
          },
        },
      ],
    });
    send({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    send({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    res.end("data: [DONE]\n\n");
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolvePromise({
        url: `http://127.0.0.1:${port}/v1`,
        hits: () => hits,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

const REQUEST = { model: "deepseek-v4-pro", messages: [{ role: "user", content: "hi" }] };

test("flag OFF (default): the injected legacy client serves the request", async () => {
  let calls = 0;
  const client = {
    apiKey: "k",
    baseURL: "https://api.example.test/v1",
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          calls += 1;
          return {
            choices: [{ message: { content: "legacy reply" } }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          };
        },
      },
    },
  };
  const { message, usage } = await runStandaloneChatCompletion({
    client,
    request: REQUEST,
    projectRoot: process.cwd(),
  });
  assert.equal(calls, 1);
  assert.equal(message.content, "legacy reply");
  assert.equal((usage as { prompt_tokens: number } | null)?.prompt_tokens, 2);
});

test("flag ON: the experimental channel serves the request, reduced to one message", async () => {
  writeSettings({ experimentalSdkTransport: true });
  const server = await sseServer();
  try {
    let legacyCalls = 0;
    const client = {
      apiKey: "k",
      baseURL: server.url,
      chat: {
        completions: {
          create: async () => {
            legacyCalls += 1;
            return { choices: [{ message: { content: "should not happen" } }] };
          },
        },
      },
    };
    const { message, usage } = await runStandaloneChatCompletion({
      client,
      request: REQUEST,
      projectRoot: process.cwd(),
    });
    assert.equal(legacyCalls, 0, "legacy client NEVER called");
    assert.ok(server.hits() >= 1, "local SSE server served the experimental channel");
    assert.equal(message.content, "hi from sdk");
    assert.deepEqual(message.tool_calls, [
      { id: "call_1", type: "function", function: { name: "bash", arguments: '{"x":1}' } },
    ]);
    assert.equal((usage as { prompt_tokens: number } | null)?.prompt_tokens, 3);
  } finally {
    await server.close();
    writeSettings({});
  }
});
