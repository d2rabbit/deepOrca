import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type OpenAI from "openai";
import type { ToolExecutionContext } from "../tools/executor";
import { handleWebSearchTool } from "../tools/web-search-handler";

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test(
  "WebSearch executes the configured script with the query as one argument",
  { skip: process.platform === "win32" },
  async () => {
    const workspace = createTempWorkspace();
    const scriptPath = path.join(workspace, "web-search.sh");
    fs.writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "printf 'query=%s\\n' \"$1\"",
        "printf 'cwd=%s\\n' \"$PWD\"",
        "printf 'webhook=%s\\n' \"$WEBHOOK\"",
      ].join("\n"),
      "utf8"
    );
    fs.chmodSync(scriptPath, 0o755);

    const starts: Array<{ id: string | number; command: string }> = [];
    const exits: Array<string | number> = [];
    const result = await handleWebSearchTool(
      { query: "latest node release" },
      createContext(workspace, {
        webSearchTool: scriptPath,
        env: { WEBHOOK: "configured" },
        onProcessStart: (id, command) => starts.push({ id, command }),
        onProcessExit: (id) => exits.push(id),
      })
    );
    const realWorkspace = fs.realpathSync(workspace);

    assert.equal(result.ok, true);
    assert.equal(result.output, `query=latest node release\ncwd=${realWorkspace}\nwebhook=configured\n`);
    assert.equal(starts.length, 1);
    assert.match(starts[0].command, /^WebSearch: latest node release$/);
    assert.deepEqual(exits, [starts[0].id]);
  }
);

test("WebSearch without a script uses the built-in first-party provider (query-only, no identifiers)", async () => {
  const workspace = createTempWorkspace();
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    return new Response(
      `<a rel="nofollow" href="https://nodejs.org/en/blog" class="result-link">Node.js Blog</a>` +
        `<td class="result-snippet">release notes</td>`,
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const starts: Array<string | number> = [];
    const exits: Array<string | number> = [];
    const result = await handleWebSearchTool(
      { query: "latest node release" },
      createContext(workspace, {
        webSearchProvider: "duckduckgo",
        onProcessStart: (id) => starts.push(id),
        onProcessExit: (id) => exits.push(id),
      })
    );

    assert.equal(result.ok, true);
    assert.match(result.output ?? "", /\[Node\.js Blog\]\(https:\/\/nodejs\.org\/en\/blog\)/);
    assert.equal(result.metadata?.provider, "duckduckgo");
    assert.equal(result.metadata?.resultCount, 1);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://lite.duckduckgo.com/lite/");
    const headers = fetchCalls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Token, undefined, "no machine identifier may leave the machine");
    // Activity tracking pairs start/exit.
    assert.equal(starts.length, 1);
    assert.deepEqual(exits, starts);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WebSearch script precedence: a configured script wins, built-in provider is never called", async () => {
  const workspace = createTempWorkspace();
  const scriptPath = path.join(workspace, "search.sh");
  fs.writeFileSync(scriptPath, "#!/bin/sh\necho 'script-result'\n", "utf8");
  fs.chmodSync(scriptPath, 0o755);

  const fetchCalls: Array<unknown> = [];
  globalThis.fetch = (async (...args: unknown[]) => {
    fetchCalls.push(args);
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await handleWebSearchTool(
      { query: "latest node release" },
      createContext(workspace, { webSearchTool: scriptPath, webSearchProvider: "duckduckgo" })
    );
    assert.equal(result.ok, true);
    assert.equal(result.output, "script-result\n");
    assert.equal(fetchCalls.length, 0, "provider must not be called when a script is configured");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createContext(
  projectRoot: string,
  options: {
    client?: OpenAI | null;
    webSearchTool?: string;
    webSearchProvider?: string;
    env?: Record<string, string>;
    onProcessStart?: (processId: string | number, command: string) => void;
    onProcessExit?: (processId: string | number) => void;
  } = {}
): ToolExecutionContext {
  return {
    sessionId: "web-search-test",
    projectRoot,
    toolCall: {
      id: "tool-call-id",
      type: "function",
      function: {
        name: "WebSearch",
        arguments: "{}",
      },
    },
    createOpenAIClient: () => ({
      client: options.client ?? null,
      model: "test-model",
      thinkingEnabled: false,
      webSearchTool: options.webSearchTool,
      webSearchProvider: options.webSearchProvider,
      env: options.env,
    }),
    onProcessStart: options.onProcessStart,
    onProcessExit: options.onProcessExit,
  };
}

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-web-search-"));
  tempDirs.push(dir);
  return dir;
}
