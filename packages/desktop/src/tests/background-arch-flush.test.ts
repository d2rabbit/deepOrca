/**
 * Full-chain integration for the background arch-scan artifact path
 * (specs/index-knowledge-rework R3-4/R3-5, design-r2.md §三).
 *
 * Verifies the previously untested link between the sessionless background
 * LLM loop and the persisted architecture map: a tool call emitted by the
 * loop travels through the REAL in-process a2ui MCP server into the surface
 * map, and the task's completion flush writes exactly the arch-* surfaces it
 * produced into the TARGET root's .deeporca/prototypes/ — without flushing
 * another root's leftover arch surfaces, without touching non-arch design
 * surfaces, and with stale arch files from earlier runs swept.
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager, configureA2uiServerBuilder } from "@deeporca/core";
import { a2uiServerBuilder } from "../main/tools/a2ui/index";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

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

/** Native v0.9 component tree (forward children references, PascalCase). */
function renderSurfaceCallV09(toolCallId: string, surfaceId: string): Record<string, unknown> {
  return {
    id: toolCallId,
    type: "function",
    function: {
      name: "mcp__a2ui__render_surface",
      arguments: JSON.stringify({
        surfaceId,
        title: `Architecture ${surfaceId}`,
        components: [
          { id: "root", component: "Column", children: ["heading"] },
          { id: "heading", component: "Text", text: surfaceId, variant: "h4" },
        ],
        dataModel: {},
      }),
    },
  };
}

/** Legacy pre-R2 tree (lowercase type + parentId) — must still work. */
function renderSurfaceCallLegacy(toolCallId: string, surfaceId: string): Record<string, unknown> {
  return {
    id: toolCallId,
    type: "function",
    function: {
      name: "mcp__a2ui__render_surface",
      arguments: JSON.stringify({
        surfaceId,
        title: `Architecture ${surfaceId}`,
        components: [{ id: "root", type: "column", parentId: null, label: surfaceId }],
        dataModel: {},
      }),
    },
  };
}

function prototypesOf(root: string): string[] {
  const dir = path.join(root, ".deeporca", "prototypes");
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

test("background task flushes its own arch surfaces to the target root only", async () => {
  setHomeDir(createTempDir("deepcode-archflush-home-"));
  configureA2uiServerBuilder(a2uiServerBuilder);

  const workspace = createTempDir("deepcode-archflush-ws-");
  const rootA = createTempDir("deepcode-archflush-a-");
  const rootB = createTempDir("deepcode-archflush-b-");
  fs.writeFileSync(path.join(workspace, "note.txt"), "hello arch", "utf8");

  // One shared client; the script advances across both background tasks.
  let llmCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          llmCalls += 1;
          if (llmCalls === 1) {
            // Task 1 (root A): emit the arch-alpha surface, then finish.
            return { choices: [{ message: { content: "", tool_calls: [renderSurfaceCallV09("c1", "arch-alpha")] } }] };
          }
          if (llmCalls === 2) {
            return { choices: [{ message: { content: "task A done" } }] };
          }
          if (llmCalls === 3) {
            // Task 2 (root B): one arch surface + one USER design surface in
            // the same turn — the flush must keep the design surface out.
            return {
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      renderSurfaceCallLegacy("c2", "arch-beta"),
                      renderSurfaceCallLegacy("c3", "proto-user"),
                    ],
                  },
                },
              ],
            };
          }
          return { choices: [{ message: { content: "task B done" } }] };
        },
      },
    },
  };

  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({
      client: client as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
  // Connect the real in-process a2ui MCP server (the temp workspace has no
  // .codegraph/ and no host-injected serena/skillspector controllers, so the
  // a2ui server is the only one that comes up).
  await manager.initMcpServers();

  // Task 1 against root A — its arch surface must land in A's prototypes.
  const resultA = await manager.runBackgroundLlmTask({ skill: "a2ui-flush-probe", root: rootA });
  assert.ok(resultA.iterations >= 1);
  assert.deepEqual(prototypesOf(rootA), ["arch-alpha.json"]);

  // Seed a stale arch file into root B — the next flush must sweep it.
  const staleDir = path.join(rootB, ".deeporca", "prototypes");
  fs.mkdirSync(staleDir, { recursive: true });
  fs.writeFileSync(path.join(staleDir, "arch-stale.json"), "{}", "utf8");

  // Task 2 against root B — must write arch-beta, sweep arch-stale, keep the
  // non-arch proto-user surface OUT, and must NOT re-flush A's arch-alpha.
  const resultB = await manager.runBackgroundLlmTask({ skill: "a2ui-flush-probe", root: rootB });
  assert.ok(resultB.iterations >= 1);
  assert.deepEqual(prototypesOf(rootB), ["arch-beta.json"]);
  assert.deepEqual(prototypesOf(rootA), ["arch-alpha.json"]);

  // The flushed artifact carries the surface the loop actually rendered.
  const flushed = JSON.parse(fs.readFileSync(path.join(rootB, ".deeporca", "prototypes", "arch-beta.json"), "utf8"));
  assert.equal(flushed.surfaceId, "arch-beta");
  assert.equal(flushed.title, "Architecture arch-beta");

  // Zero session residue from either background task.
  assert.equal(manager.listSessions().length, 0);

  manager.dispose();
});

test("background task aborts before the first LLM call on a pre-aborted signal", async () => {
  setHomeDir(createTempDir("deepcode-archabort-home-"));

  let llmCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          llmCalls += 1;
          return { choices: [{ message: { content: "should never run" } }] };
        },
      },
    },
  };
  const manager = new SessionManager({
    projectRoot: createTempDir("deepcode-archabort-ws-"),
    createOpenAIClient: () => ({
      client: client as never,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });

  await assert.rejects(
    manager.runBackgroundLlmTask({ skill: "a2ui-flush-probe", signal: AbortSignal.abort() }),
    (err: unknown) => err instanceof Error && err.name === "AbortError"
  );
  assert.equal(llmCalls, 0);

  manager.dispose();
});
