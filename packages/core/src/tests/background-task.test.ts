/**
 * Sessionless background LLM task (specs/index-knowledge-rework R2-2).
 *
 * The acceptance criterion for moving index.build-all's arch-scan stage off
 * runSubagent: a manual index build must produce ZERO foreground conversation
 * artifacts — no sessions-index entry, no message JSONL, no active-session
 * switch, no assistant-message stream, no LLM stream progress.
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";

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

test("runBackgroundLlmTask leaves zero session residue", async () => {
  setHomeDir(createTempDir("deepcode-bgtask-home-"));
  const workspace = createTempDir("deepcode-bgtask-workspace-");
  fs.writeFileSync(path.join(workspace, "note.txt"), "hello background", "utf8");

  let llmCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          llmCalls += 1;
          if (llmCalls === 1) {
            // First turn: the task calls the read tool.
            return {
              choices: [
                {
                  message: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call-1",
                        type: "function",
                        function: {
                          name: "read",
                          arguments: JSON.stringify({ file_path: path.join(workspace, "note.txt") }),
                        },
                      },
                    ],
                  },
                },
              ],
            };
          }
          // Later turns: prose-only reports, no tool calls. For an
          // ARTIFACT task (arch-scan) with nothing on disk, the loop now
          // nudges twice before accepting prose completion (2026-08-29) —
          // turn 2 prose → nudge 1, turn 3 prose → nudge 2, turn 4 prose →
          // accepted.
          return { choices: [{ message: { content: "arch map emitted" } }] };
        },
      },
    },
  };

  const assistantMessages: unknown[] = [];
  const streamProgress: Array<{ sessionId?: string }> = [];
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
    onAssistantMessage: (m) => assistantMessages.push(m),
    onLlmStreamProgress: (p) => streamProgress.push(p),
  });

  const result = await manager.runBackgroundLlmTask({ skill: "arch-scan" });

  // The loop ran: read tool executed, then the artifact-less prose answer
  // was nudged twice (new contract: text-only ≠ completion for arch-scan
  // until 2 nudges are spent) before the final content was accepted.
  assert.equal(llmCalls, 4);
  assert.equal(result.content, "arch map emitted");
  assert.ok(result.iterations >= 1);

  // Zero residue: no session entries, no active-session switch, no messages,
  // no stream progress into the conversation view.
  assert.equal(manager.listSessions().length, 0);
  assert.equal(manager.getActiveSessionId(), null);
  assert.equal(assistantMessages.length, 0);
  assert.equal(streamProgress.filter((p) => p.sessionId?.startsWith("bg-")).length, 0);

  // Nothing persisted on disk: no sessions index and no message JSONL anywhere
  // under the config home's session stores. (An empty project dir may exist —
  // plain SessionManager construction creates it; that is not session residue.)
  const projectsDir = path.join(process.env.HOME!, ".deeporca", "projects");
  const legacyProjectsDir = path.join(process.env.HOME!, ".deepcode", "projects");
  const residue: string[] = [];
  for (const dir of [projectsDir, legacyProjectsDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const proj of fs.readdirSync(dir)) {
      const projDir = path.join(dir, proj);
      if (!fs.statSync(projDir).isDirectory()) continue;
      for (const f of fs.readdirSync(projDir)) {
        if (f === "sessions-index.json" || f.endsWith(".jsonl")) {
          residue.push(path.join(projDir, f));
        }
      }
    }
  }
  assert.deepEqual(residue, []);

  manager.dispose();
});
