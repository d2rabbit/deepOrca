import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { RoutingFacade } from "../routing/routing-facade";
import { SessionManager } from "../session";
import { setRoutingEventSink, type RoutingEvent } from "../routing";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  setRoutingEventSink(null);
});

const TOOLS = [
  { name: "mcp__alpha__a", description: "alpha", serverName: "alpha" },
  { name: "mcp__beta__b", description: "beta", serverName: "beta" },
];

function request(sessionId: string) {
  return { sessionId, context: { userMessage: "hello" }, tools: TOOLS };
}

test("facade decides once per session and reuses the frozen decision", async () => {
  let selectCalls = 0;
  const facade = new RoutingFacade({
    toolRouter: {
      select: async () => {
        selectCalls += 1;
        return [TOOLS[0]!];
      },
    },
  });

  const first = await facade.decideToolRoute(request("s1"));
  const second = await facade.decideToolRoute(request("s1"));

  assert.equal(selectCalls, 1, "select invoked exactly once");
  assert.equal(first.frozen, false);
  assert.equal(second.frozen, true, "second call reuses the frozen decision");
  assert.deepEqual(second.selected, [TOOLS[0]]);
  assert.deepEqual(first.serverNames, ["alpha"], "server names derived for lazy-connect");
});

test("facade invalidation (per session and all) forces a fresh decision", async () => {
  let selectCalls = 0;
  const facade = new RoutingFacade({
    toolRouter: {
      select: async () => {
        selectCalls += 1;
        return [TOOLS[0]!];
      },
    },
  });
  await facade.decideToolRoute(request("s1"));
  facade.invalidate("s1");
  await facade.decideToolRoute(request("s1"));
  assert.equal(selectCalls, 2, "per-session invalidation re-decides");

  await facade.decideToolRoute(request("s2"));
  facade.invalidateAll();
  assert.equal(facade.frozenCount, 0, "invalidateAll clears every frozen route");
});

test("facade fails open: no tool router → full set, no throw", async () => {
  const facade = new RoutingFacade({ toolRouter: null });
  const decision = await facade.decideToolRoute(request("s1"));
  assert.equal(decision.selected, TOOLS, "identity-stable full set");
  assert.deepEqual(decision.serverNames, ["alpha", "beta"]);
});

test("facade emits a G2 telemetry event on decision", async () => {
  const events: RoutingEvent[] = [];
  setRoutingEventSink((event) => events.push(event));
  const facade = new RoutingFacade({
    toolRouter: { select: async () => [TOOLS[0]!] },
  });
  await facade.decideToolRoute(request("s1"));
  const g2 = events.find((e) => e.stage === "G2");
  assert.ok(g2, "G2 event emitted");
  assert.equal(g2!.outcome, "hit");
  assert.equal(g2!.counts?.tools, 2);
});

test("lazy-connect: a declared-but-down server in the route gets reconnected", async () => {
  const workspace = createTempDir("facade-lazy-");
  const home = createTempDir("facade-lazy-home-");
  process.env.HOME = home;

  const responses: unknown[] = [{ choices: [{ message: { content: "ok" } }] }];
  const client = {
    chat: { completions: { create: async () => responses.shift() } },
  };
  const manager = new SessionManager({
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
  });
  const sessionId = await manager.createSession({ text: "hello" });

  // Declare "alpha" but report it as down; reconnect is spied.
  (manager as any).declaredMcpServers = new Set(["alpha"]);
  const reconnected: string[] = [];
  (manager as any).mcpManager = {
    getStatus: () => [{ name: "alpha", status: "failed", connected: false }],
    reconnect: async (name: string) => {
      reconnected.push(name);
    },
    getMcpToolDefinitions: () => [],
  };
  (manager as any).refreshMcpToolDefinitions = () => {};

  const events: RoutingEvent[] = [];
  setRoutingEventSink((event) => events.push(event));

  await (manager as any).ensureMcpServersConnected(["alpha", "undeclared-server"]);

  assert.deepEqual(reconnected, ["alpha"], "only the declared-down server is reconnected");
  const serverEvent = events.find((e) => e.stage === "server");
  assert.ok(serverEvent, "server stage event emitted");
  assert.match(serverEvent!.detail ?? "", /alpha/);
});
