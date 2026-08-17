/**
 * skill-up `engine.custom` adapter for DeepOrca (specs/skill-eval S2 / T2.1,
 * design.md §4).
 *
 * Protocol (local transport, one shot per case):
 *   stdin  ← JSON { prompt: string, workspace?: string, skills?: SkillInput[] }
 *   stdout → JSON { transcript, toolCalls, finalText }
 * All diagnostics go to stderr — stdout carries exactly one JSON document.
 *
 * What it does:
 *   1. creates an isolated temp workspace (mkdtemp) + isolated HOME, so
 *      session persistence, settings reads and skill discovery cannot touch
 *      the developer's real environment (same isolation approach as
 *      packages/core/src/tests/run-tests.mjs);
 *   2. optionally copies the caller's `workspace` tree and installs `skills`
 *      into <workspace>/.deeporca/skills/ (highest-priority discovery path);
 *   3. imports @deeporca/core from packages/core/dist (build first:
 *      `npm run build`) and runs ONE SessionManager activation with a real
 *      DeepSeek client (DEEPSEEK_API_KEY required);
 *   4. emits the transcript, the tool calls and the final assistant text.
 *
 * Registration (kept commented in code/evals/eval.yaml — default engine stays
 * claude_code):
 *   engine:
 *     type: custom
 *     custom:
 *       command: ["node", "scripts/skill-up-engine-deeporca.mjs"]
 *
 * KNOWN LIMITATIONS (documented per design.md §4.1 — "bash 沙箱化"):
 *   - Bash confinement is NOT hard-enforced here. Core ships sandbox backends
 *     (seatbelt/sandbox-exec, policy engine, path gates) but wiring them is a
 *     host concern; this script only uses the public SessionManager API. The
 *     clamp is therefore threefold:
 *       a) the user prompt carries an explicit sandbox instruction (below);
 *       b) only read-in-cwd/write-in-cwd scopes are pre-granted — network,
 *          delete and outside-root operations fall back to "ask", which ends
 *          the turn instead of executing;
 *       c) heavyweight MCP servers (codegraph/serena/crg/skillspector/a2ui)
 *         are disabled so no vendored subprocess or network provision runs.
 *   - Hard timeout is process-level (default 120s per case,
 *     DEEPORCA_EVAL_TIMEOUT_MS override): on expiry the partial transcript is
 *     flushed and the process exits 1.
 *   - core is imported from dist/, which may be stale — guard below fails
 *     fast with a clear message when dist is missing; rebuild with
 *     `npm run build` when in doubt.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 120_000;
const EXIT_OK = 0;
const EXIT_RUN_FAILURE = 1;
const EXIT_INFRA = 2;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CORE_DIST_ENTRY = path.join(REPO_ROOT, "packages", "core", "dist", "index.js");

const SANDBOX_INSTRUCTION = [
  "（评估沙箱约束：本次运行在隔离临时工作区中。",
  "所有文件读写与 bash 操作仅限当前工作目录；",
  "禁止访问网络；禁止读写当前工作区之外的任何路径。",
  "任务完成后直接给出最终答复。）",
].join("");

function log(message) {
  process.stderr.write(`[skill-up-engine-deeporca] ${message}\n`);
}

function failInfra(message) {
  log(message);
  process.exit(EXIT_INFRA);
}

/** Skill entries accepted on stdin: "path" | {name, path} | {name, content}. */
function isSafeSkillName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => {
      if (!raw.trim()) {
        reject(new Error("empty stdin — expected { prompt, workspace?, skills? }"));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`stdin is not valid JSON: ${error.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

function installSkills(skills, workspace) {
  const skillsRoot = path.join(workspace, ".deeporca", "skills");
  const installed = [];
  for (const entry of Array.isArray(skills) ? skills : []) {
    if (typeof entry === "string") {
      const src = path.resolve(entry);
      if (!fs.existsSync(path.join(src, "SKILL.md"))) {
        throw new Error(`skill path has no SKILL.md: ${src}`);
      }
      const name = path.basename(src);
      if (!isSafeSkillName(name)) {
        throw new Error(`unsafe skill dir name: ${name}`);
      }
      fs.cpSync(src, path.join(skillsRoot, name), { recursive: true });
      installed.push(name);
    } else if (entry && typeof entry === "object") {
      const name = entry.name;
      if (!isSafeSkillName(name)) {
        throw new Error(`unsafe skill name: ${JSON.stringify(name)}`);
      }
      if (typeof entry.content === "string") {
        fs.mkdirSync(path.join(skillsRoot, name), { recursive: true });
        fs.writeFileSync(path.join(skillsRoot, name, "SKILL.md"), entry.content, "utf8");
        installed.push(name);
      } else if (typeof entry.path === "string") {
        const src = path.resolve(entry.path);
        if (!fs.existsSync(path.join(src, "SKILL.md"))) {
          throw new Error(`skill path has no SKILL.md: ${src}`);
        }
        fs.cpSync(src, path.join(skillsRoot, name), { recursive: true });
        installed.push(name);
      } else {
        throw new Error(`skill entry needs "path" or "content": ${JSON.stringify(name)}`);
      }
    } else {
      throw new Error(`unsupported skill entry: ${JSON.stringify(entry)}`);
    }
  }
  return installed;
}

/** Extract a compact transcript + tool-call list from assistant messages. */
function collectResults(messages) {
  const transcript = [];
  const toolCalls = [];
  let finalText = null;
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }
    const content = typeof message.content === "string" ? message.content : null;
    transcript.push({ role: "assistant", content });
    const params = message.messageParams;
    const calls = params && typeof params === "object" ? params.tool_calls : null;
    if (Array.isArray(calls)) {
      for (const call of calls) {
        const fn = call && typeof call === "object" ? call.function : null;
        if (fn && typeof fn.name === "string") {
          toolCalls.push({ id: call.id ?? null, name: fn.name, arguments: fn.arguments ?? null });
        }
      }
    }
    if (content && content.trim() && !Array.isArray(calls) && !calls) {
      finalText = content;
    }
  }
  return { transcript, toolCalls, finalText };
}

async function emit(payload, exitCode) {
  const json = JSON.stringify(payload);
  await new Promise((resolve) => process.stdout.write(json + "\n", resolve));
  process.exit(exitCode);
}

async function main() {
  if (!fs.existsSync(CORE_DIST_ENTRY)) {
    failInfra(
      `${CORE_DIST_ENTRY} not found.\n` +
        "The engine adapter runs the BUILT core (dist may be stale otherwise). Run: npm run build"
    );
  }

  const input = await readStdinJson();
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) {
    failInfra('stdin JSON must carry a non-empty "prompt" string');
  }

  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPORCA_API_KEY;
  if (!apiKey) {
    failInfra("DEEPSEEK_API_KEY (or DEEPORCA_API_KEY) is not set — the engine needs a real client");
  }
  const model = process.env.DEEPORCA_MODEL || "deepseek-v4-flash";

  // --- isolated environment (set BEFORE importing core) -----------------------
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-eval-ws-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "deeporca-eval-home-"));
  const cleanup = () => {
    if (process.env.DEEPORCA_EVAL_KEEP === "1") {
      log(`keeping workspace ${workspace} and home ${home}`);
      return;
    }
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  };

  process.env.HOME = home;
  if (process.platform === "win32") {
    process.env.USERPROFILE = home;
  }
  process.env.DEEPORCA_API_KEY = apiKey;
  process.env.DEEPORCA_MODEL = model;
  // Mirror run-tests.mjs: never fire network skill provisioning from an eval.
  process.env.DEEPORCA_SKIP_SKILL_PROVISION = "1";
  process.chdir(workspace);

  if (typeof input.workspace === "string" && fs.existsSync(input.workspace)) {
    fs.cpSync(input.workspace, workspace, { recursive: true });
  }
  const installedSkills = installSkills(input.skills, workspace);
  log(`workspace: ${workspace} (skills: ${installedSkills.join(", ") || "none"})`);

  // --- run one activation through the real core -------------------------------
  const core = await import(pathToFileURL(CORE_DIST_ENTRY).href);
  const messages = [];
  const timeoutMs = Number(process.env.DEEPORCA_EVAL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  try {
    // Keep the eval process lean and offline: no vendored MCP subprocesses.
    core.setCodegraphDisabled?.(true);
    core.setCrgDisabled?.(true);
    core.setSerenaDisabled?.(true);
    core.setSkillSpectorDisabled?.(true);
    core.setA2uiDisabled?.(true);

    const manager = new core.SessionManager({
      projectRoot: workspace,
      createOpenAIClient: () => core.createOpenAIClient(workspace),
      getResolvedSettings: () => ({ model }),
      renderMarkdown: (text) => text,
      onAssistantMessage: (message) => {
        messages.push(message);
      },
    });

    let timedOut = false;
    let timer = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("engine-timeout"));
      }, timeoutMs);
    });

    try {
      // Clamp (see header): only in-cwd read/write pre-granted; the prompt
      // carries the sandbox instruction. Anything wider falls back to "ask",
      // which ends the turn instead of executing.
      await Promise.race([
        manager.handleUserPrompt({
          text: `${SANDBOX_INSTRUCTION}\n\n${prompt}`,
          alwaysAllows: ["read-in-cwd", "write-in-cwd"],
        }),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }

    await manager.dispose?.();

    const { transcript, toolCalls, finalText } = collectResults(messages);
    const payload = { transcript, toolCalls, finalText };
    if (timedOut) {
      payload.error = `timeout after ${timeoutMs}ms (partial transcript)`;
    }
    await core.closeEmbeddingService?.();
    cleanup();
    await emit(payload, timedOut ? EXIT_RUN_FAILURE : EXIT_OK);
  } catch (error) {
    const { transcript, toolCalls, finalText } = collectResults(messages);
    await core.closeEmbeddingService?.();
    cleanup();
    await emit(
      {
        transcript,
        toolCalls,
        finalText,
        error: `engine run failed: ${error?.message ?? String(error)}`,
      },
      EXIT_RUN_FAILURE
    );
  }
}

main().catch((error) => {
  log(error?.message ?? String(error));
  process.exit(EXIT_INFRA);
});
