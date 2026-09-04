/**
 * REGRESSION PIN — typed-IR files must SURVIVE a background task (root cause
 * fixed 2026-08-31).
 *
 * The arch-scan task's finally block used to call a2ui persistSurfaces, which
 * UNLINKS every "arch-"-prefixed .json in prototypes/ as "stale" before
 * writing back only the surfaces tracked in its in-memory Map. A typed-IR
 * authored with the WRITE TOOL is invisible to that Map — freshly authored,
 * 9/9-validated maps were deleted the moment the task ended, and the deliver
 * gate reported "nothing to render" (real machine: this repo twice + GVGL;
 * decoded by the stage-failure diagnostics: lastValidate PASSED + empty dir).
 *
 * The flush call is now REMOVED from the arch-scan finally. This test pins
 * that: with an ACTIVE a2ui lifecycle (even with surfaces rendered during the
 * task), a model-authored typed-IR file still exists — byte-identical — after
 * the task completes. If anyone re-adds a sweeping flush to this path, this
 * test fails.
 *
 * Reuse of the background-arch-flush harness (temp HOME, real in-process a2ui
 * MCP server, scripted LLM).
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
  if (process.platform === "win32") process.env.USERPROFILE = dir;
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
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
});

test("model-written typed-IR survives a background task (arch-reap regression)", async () => {
  setHomeDir(createTempDir("deepcode-noreap-home-"));
  configureA2uiServerBuilder(a2uiServerBuilder);

  const workspace = createTempDir("deepcode-noreap-ws-");
  const root = createTempDir("deepcode-noreap-root-");
  fs.writeFileSync(path.join(workspace, "note.txt"), "hello", "utf8");

  // The exact artifact shape the arch-scan task authors with the write tool —
  // a TYPED suffix (visible to the deliver gate) and substantial content.
  const protoDir = path.join(root, ".deeporca", "prototypes");
  fs.mkdirSync(protoDir, { recursive: true });
  const irPath = path.join(protoDir, "arch-demo.architecture.json");
  const irBytes = JSON.stringify({
    schema_version: 1,
    diagram_type: "architecture",
    meta: { title: "Demo", quality_profile: "showcase" },
    components: [{ id: "a", type: "backend", label: "A", row: 0, col: 0 }],
    connections: [],
  });
  fs.writeFileSync(irPath, irBytes, "utf8");

  // Scripted LLM: one turn renders an A2UI surface (populating the module
  // surfaces Map — the old flush's write-back set), then finishes.
  let llmCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          llmCalls += 1;
          if (llmCalls === 1) {
            return {
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "c1",
                        type: "function",
                        function: {
                          name: "mcp__a2ui__render_surface",
                          arguments: JSON.stringify({
                            surfaceId: "arch-alpha",
                            title: "Architecture arch-alpha",
                            components: [
                              { id: "root", component: "Column", children: ["heading"] },
                              { id: "heading", component: "Text", text: "x", variant: "h4" },
                            ],
                            dataModel: {},
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            };
          }
          return { choices: [{ message: { content: "done — artifact finalized and validated" } }] };
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
  await manager.initMcpServers();

  const progress: string[] = [];
  await manager.runBackgroundLlmTask({
    skill: "arch-scan",
    root,
    onProgress: (m) => progress.push(m),
  });
  console.log("progress:", JSON.stringify(progress, null, 1));

  // THE PIN: the typed-IR written before/during the task is still on disk,
  // byte-identical. The old flush swept it as "stale" right after the task.
  assert.equal(fs.existsSync(irPath), true, "typed-IR must survive the task");
  assert.equal(fs.readFileSync(irPath, "utf8"), irBytes, "typed-IR content untouched");

  // The a2ui surface itself still persisted (server-side write) — removing
  // the flush must not break the a2ui flow either.
  // Manual persist with stamp 0 (write ALL tracked surfaces) — decides
  // whether the surface is in the module Map at all.
  const lifecycle = (
    manager as unknown as { currentA2uiLifecycle?: { persistSurfaces: (r: string, p?: string, s?: number) => void } }
  ).currentA2uiLifecycle;
  console.log("lifecycle present:", !!lifecycle);
  lifecycle?.persistSurfaces(root, "arch-", 0);
  console.log("after manual flush:", fs.readdirSync(protoDir));
  assert.equal(fs.existsSync(path.join(protoDir, "arch-alpha.json")), true, "a2ui surface persistence unaffected");

  assert.equal(manager.listSessions().length, 0);
  manager.dispose();
});
