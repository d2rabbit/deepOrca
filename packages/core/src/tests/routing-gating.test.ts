import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import { RoutingFacade } from "../routing/routing-facade";
import { setRoutingEventSink, type RoutingEvent } from "../routing";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
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
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = originalUserProfile;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
  setRoutingEventSink(null);
});

function writeSkill(root: string, name: string, description: string): void {
  const dir = path.join(root, ".deepcode", "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/SKILL.md", `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, "utf8");
}

/** Counting chat client: records json_object calls split into skill-matching vs SAD decomposition. */
function createCountingClient(responses: unknown[]) {
  const calls: Array<{ kind: "matching" | "sad" | "other"; prompt: string }> = [];
  return {
    calls,
    client: {
      chat: {
        completions: {
          create: async (request: any) => {
            if (request?.response_format?.type === "json_object") {
              const sys = String(request.messages?.[0]?.content ?? "");
              const kind = sys.includes("task decomposition assistant")
                ? "sad"
                : sys.includes("available skills match")
                  ? "matching"
                  : "other";
              calls.push({ kind, prompt: String(request.messages?.[1]?.content ?? "") });
            } else {
              calls.push({ kind: "other", prompt: "" });
            }
            const response = responses.shift();
            assert.ok(response, "expected a queued chat response");
            return response;
          },
        },
      },
    },
  };
}

function createManager(workspace: string, client: unknown) {
  return new SessionManager({
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
}

test("single-intent prompt pays exactly one flash classification call — no SAD", async () => {
  const workspace = createTempDir("routing-gate-single-");
  const home = createTempDir("routing-gate-single-home-");
  process.env.HOME = home;
  writeSkill(workspace, "demo-skill", "Demo skill for gating test");

  const { client, calls } = createCountingClient([
    { choices: [{ message: { content: JSON.stringify({ skillNames: ["demo-skill"], multiIntent: false }) } }] },
    { choices: [{ message: { content: "done" } }] },
  ]);
  const manager = createManager(workspace, client);
  // Router bundle present with a null-returning shortlist (G1 skip) and a
  // composeRoute that must NOT be reached for single-intent turns.
  let composeCalls = 0;
  (manager as any).getRouters = async () => ({
    skillRouter: {
      shortlist: async () => null,
      composeRoute: async () => {
        composeCalls += 1;
        return null;
      },
    },
    toolRouter: null,
  });

  await manager.createSession({ text: "use the demo skill please" });

  assert.equal(calls.filter((c) => c.kind === "matching").length, 1, "exactly one classification call");
  assert.equal(calls.filter((c) => c.kind === "sad").length, 0, "no SAD decomposition call");
  assert.equal(composeCalls, 0, "composeRoute must not run for single-intent");
});

test("multi-intent prompt triggers compositional routing once and merges composed skills", async () => {
  const workspace = createTempDir("routing-gate-multi-");
  const home = createTempDir("routing-gate-multi-home-");
  process.env.HOME = home;
  writeSkill(workspace, "slides-skill", "Generate slides");
  writeSkill(workspace, "test-skill", "Run tests");

  const { client, calls } = createCountingClient([
    { choices: [{ message: { content: JSON.stringify({ skillNames: ["slides-skill"], multiIntent: true }) } }] },
    { choices: [{ message: { content: "done" } }] },
  ]);
  const manager = createManager(workspace, client);
  let composeCalls = 0;
  (manager as any).getRouters = async () => ({
    skillRouter: {
      shortlist: async () => null,
      composeRoute: async () => {
        composeCalls += 1;
        return {
          steps: [
            { step: 1, description: "make slides", skill: { name: "slides-skill" } },
            { step: 2, description: "run tests", skill: { name: "test-skill" } },
          ],
          dependencies: [[0, 1]],
          decomposed: true,
        };
      },
    },
    toolRouter: null,
  });

  const sessionId = await manager.createSession({ text: "generate slides and run the tests" });
  const messages = manager.listSessionMessages(sessionId);

  assert.equal(composeCalls, 1, "composeRoute exactly once");
  assert.equal(calls.filter((c) => c.kind === "matching").length, 1, "single classification call");
  // Union of G1 result + composed skills, both actually loaded.
  const loaded = messages.filter((m) => m.role === "system" && m.meta?.skill).map((m) => m.meta!.skill!.name);
  assert.ok(loaded.includes("slides-skill"), `slides-skill loaded (got ${loaded})`);
  assert.ok(loaded.includes("test-skill"), `test-skill loaded (got ${loaded})`);
});

test("composed skills outside the candidate set are rejected (anti-hallucination)", async () => {
  const workspace = createTempDir("routing-gate-ghost-");
  const home = createTempDir("routing-gate-ghost-home-");
  process.env.HOME = home;
  writeSkill(workspace, "real-skill", "A real skill");

  const { client } = createCountingClient([
    { choices: [{ message: { content: JSON.stringify({ skillNames: [], multiIntent: true }) } }] },
    { choices: [{ message: { content: "done" } }] },
  ]);
  const manager = createManager(workspace, client);
  (manager as any).getRouters = async () => ({
    skillRouter: {
      shortlist: async () => null,
      composeRoute: async () => ({
        steps: [{ step: 1, description: "x", skill: { name: "ghost-skill" } }],
        dependencies: [],
        decomposed: true,
      }),
    },
    toolRouter: null,
  });

  const sessionId = await manager.createSession({ text: "do two things" });
  const loaded = manager
    .listSessionMessages(sessionId)
    .filter((m) => m.role === "system" && m.meta?.skill)
    .map((m) => m.meta!.skill!.name);
  assert.deepEqual(loaded, [], "ghost skill must not be injected");
});

test("G2 routed tool set is frozen per session (byte-stable, one decision)", async () => {
  const workspace = createTempDir("routing-freeze-");
  const home = createTempDir("routing-freeze-home-");
  process.env.HOME = home;

  const { client } = createCountingClient([{ choices: [{ message: { content: "ok" } }] }]);
  const manager = createManager(workspace, client);
  const sessionId = await manager.createSession({ text: "hello" });

  const toolDefs = [
    { type: "function", function: { name: "mcp__alpha__do", description: "alpha tool" } },
    { type: "function", function: { name: "mcp__beta__do", description: "beta tool" } },
  ] as any[];
  (manager as any).mcpToolDefinitions = toolDefs;

  const events: RoutingEvent[] = [];
  setRoutingEventSink((event) => events.push(event));

  let selectCalls = 0;
  const spyToolRouter = {
    select: async () => {
      selectCalls += 1;
      return [{ name: "mcp__alpha__do", description: "alpha tool", serverName: "alpha" }];
    },
  };
  (manager as any).getRouters = async () => ({
    skillRouter: null,
    toolRouter: spyToolRouter,
    facade: new RoutingFacade({ toolRouter: spyToolRouter as any }),
  });

  const first = await (manager as any).getRoutedMcpTools(sessionId);
  const second = await (manager as any).getRoutedMcpTools(sessionId);
  const third = await (manager as any).getRoutedMcpTools(sessionId);

  assert.equal(selectCalls, 1, "routing decided exactly once per session");
  assert.deepEqual(first, [toolDefs[0]], "only alpha tools injected");
  assert.equal(second, first, "frozen array identity (byte-stable)");
  assert.equal(third, first, "still frozen");
  assert.equal(events.filter((e) => e.stage === "G2" && e.outcome === "hit").length, 1, "exactly one G2 hit event");
});
