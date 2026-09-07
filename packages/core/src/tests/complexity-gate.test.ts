/**
 * Complexity gate tests (specs/depth-lane P0.8).
 *
 * Covers: the L1 rule table; computeLane threshold boundary (49/50); strict
 * TPCR parsing; lane computed-not-trusted; the four fail-open paths (no
 * client / garbage / throw / abort); cache replay carrying the lane; the
 * disabled-mode byte-level baseline (prompt unchanged, no extra calls); and
 * the skill-matching template's byte stability with the directive slot empty.
 *
 * Harness pattern: instance monkey-patching of the LLM seams, identical to
 * aux-llm-contract.test.ts.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import { SessionManager } from "../session";
import type { SkillInfo } from "../session-types";
import { resolveComplexityGateSettings, DEFAULT_COMPLEXITY_GATE_SETTINGS } from "../settings";
import {
  computeLane,
  evaluateL1Rules,
  expressFailOpen,
  parseTpcrScores,
  parseVerdictReason,
  summarizeLaneTelemetry,
} from "../routing/gate/gate";
import { COMPLEXITY_SCORING_DIRECTIVE } from "../routing/gate/gate-prompt";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "complexity-gate-"));
}

type Harness = {
  manager: SessionManager;
  requests: Array<Record<string, unknown>>;
  outputs: string[];
};

/**
 * SessionManager with the LLM seams stubbed (aux-llm-contract pattern): each
 * createChatCompletionStream call records the request and shifts one canned
 * content ("THROW" = transport error). Gate settings are injected through the
 * host getResolvedSettings seam exactly like production.
 */
function createHarness(complexityGate?: Record<string, unknown>): Harness {
  const requests: Array<Record<string, unknown>> = [];
  const outputs: string[] = [];
  const manager = new SessionManager({
    projectRoot: tempRoot(),
    createOpenAIClient: () => ({
      client: null,
      model: "test-model",
      baseURL: "https://api.deepseek.com",
      thinkingEnabled: false,
    }),
    // Routing stays OFF so the G1 shortlist can never reshape the candidate
    // pool mid-test (embedding availability differs across machines).
    getResolvedSettings: () => ({
      model: "test-model",
      routing: { enabled: false },
      ...(complexityGate ? { complexityGate } : {}),
    }),
    renderMarkdown: (text: string) => text,
    onAssistantMessage: () => {},
  });
  const stub = manager as unknown as Record<string, unknown>;
  stub.createBackgroundLlm = () => ({ client: {}, model: "m", baseURL: "https://x", debugLogEnabled: false });
  stub.createChatCompletionStream = async (_client: unknown, request: Record<string, unknown>) => {
    requests.push(request);
    const content = outputs.shift();
    if (content === "THROW") throw new Error("transport boom");
    return { choices: [{ message: { content } }] };
  };
  return { manager, requests, outputs };
}

/** A minimal candidate pool so the flash call path actually runs. */
const SKILLS: SkillInfo[] = [{ name: "demo-skill", description: "demonstration skill", path: "bundled:demo" }];

type MatchSeam = {
  matchSkillsWithVerdict: (
    skills: SkillInfo[],
    prompt: string,
    options?: { laneGateEnabled?: boolean; planMode?: boolean; signal?: AbortSignal }
  ) => Promise<{ skillNames: string[]; verdict: ReturnType<typeof expressFailOpen> | null }>;
};

function seam(manager: SessionManager): MatchSeam {
  return manager as unknown as MatchSeam;
}

// ── L1 rule table (P0.1) ─────────────────────────────────────────────────────

describe("L1 heuristics", () => {
  test("planMode → deep (highest priority)", () => {
    assert.deepEqual(evaluateL1Rules({ planMode: true, text: "解释这段代码" }), {
      lane: "deep",
      source: "l1-plan-mode",
      reason: "plan mode requested",
    });
  });

  test("no text (image-only first frame) → express", () => {
    const result = evaluateL1Rules({ text: undefined, imageUrls: ["file:///a.png"] });
    assert.equal(result?.lane, "express");
    assert.equal(result?.source, "l1-image-only");
  });

  test("express keywords", () => {
    for (const prompt of ["解释一下这个函数", "翻译成英文", "什么是 monorepo", "how to install ripgrep on macOS"]) {
      assert.equal(evaluateL1Rules({ text: prompt })?.lane, "express", prompt);
    }
  });

  test("deep keywords", () => {
    for (const prompt of [
      "帮我出一个迁移方案，权衡一下风险",
      "要不要切换数据库？如果延迟上升则回滚",
      "review our deployment strategy",
    ]) {
      assert.equal(evaluateL1Rules({ text: prompt })?.lane, "deep", prompt);
    }
  });

  test("express beats deep when both match (cheap-first)", () => {
    // 解释 (express) + 方案 (deep) on the same prompt → express.
    assert.equal(evaluateL1Rules({ text: "解释一下这个迁移方案" })?.lane, "express");
  });

  test("historical follow-up rate >= threshold → deep", () => {
    assert.equal(evaluateL1Rules({ text: "generic grey prompt", followUpRate: 0.5 })?.lane, "deep");
    assert.equal(evaluateL1Rules({ text: "generic grey prompt", followUpRate: 0.1 }), null);
  });

  test("grey zone → null (proceeds to L2)", () => {
    assert.equal(evaluateL1Rules({ text: "refactor the parser module" }), null);
  });
});

// ── lane computation + strict parsing ────────────────────────────────────────

describe("lane computation", () => {
  test("threshold boundary: total == threshold routes deep, total == threshold-1 routes express", () => {
    // Realistic subset sums only (each dimension is 0 or full): P+R = 50,
    // C+R = 45. The >= boundary is exercised via the threshold, not by
    // inventing impossible intermediate scores.
    assert.equal(computeLane({ T: 0, P: 30, C: 0, R: 20 }, 50), "deep"); // 50 >= 50
    assert.equal(computeLane({ T: 0, P: 30, C: 0, R: 20 }, 51), "express"); // 50 < 51
    assert.equal(computeLane({ T: 0, P: 0, C: 25, R: 20 }, 45), "deep"); // 45 >= 45
    assert.equal(computeLane({ T: 0, P: 0, C: 25, R: 20 }, 46), "express"); // 45 < 46
    assert.equal(computeLane({ T: 25, P: 30, C: 25, R: 20 }, 50), "deep"); // 100
    assert.equal(computeLane({ T: 0, P: 0, C: 0, R: 20 }, 50), "express"); // 20
  });

  test("parseTpcrScores accepts only exact 0/full values", () => {
    assert.deepEqual(parseTpcrScores({ T: 25, P: 30, C: 25, R: 20 }), { T: 25, P: 30, C: 25, R: 20 });
    assert.deepEqual(parseTpcrScores({ T: 0, P: 0, C: 0, R: 0 }), { T: 0, P: 0, C: 0, R: 0 });
    // Intermediate / missing / wrong-type / extra-garbage values all fail.
    assert.equal(parseTpcrScores({ T: 12, P: 30, C: 25, R: 20 }), null);
    assert.equal(parseTpcrScores({ T: 25, P: 30, C: 25 }), null);
    assert.equal(parseTpcrScores({ T: "25", P: 30, C: 25, R: 20 }), null);
    assert.equal(parseTpcrScores(null), null);
    assert.equal(parseTpcrScores("garbage"), null);
  });

  test("a self-reported lane field is not part of the strict parse at all", () => {
    // Even with a bogus model-claimed lane present, the scores parse cleanly —
    // the lane is derived by computeLane, never read from the response.
    const parsed = { skillNames: [], lane: "express", T: 25, P: 30, C: 25, R: 20 };
    const tpcr = parseTpcrScores(parsed);
    assert.ok(tpcr);
    assert.equal(computeLane(tpcr, 50), "deep");
  });

  test("parseVerdictReason tolerates garbage", () => {
    assert.equal(parseVerdictReason({ reason: " multi-party conflict " }), "multi-party conflict");
    assert.equal(parseVerdictReason({ reason: "" }), null);
    assert.equal(parseVerdictReason({ reason: 42 }), null);
  });

  test("expressFailOpen shape", () => {
    assert.deepEqual(expressFailOpen("boom"), { lane: "express", tpcr: null, reason: "boom", source: "fail-open" });
  });
});

// ── settings resolution (P0.5) ───────────────────────────────────────────────

describe("complexityGate settings", () => {
  test("defaults are all off with threshold 50 and budgets 3/3", () => {
    assert.deepEqual(resolveComplexityGateSettings(undefined), {
      enabled: false,
      threshold: 50,
      autoTune: false,
      maxPaths: 3,
      maxRounds: 3,
      depthLaneEnabled: false,
    });
    assert.equal(DEFAULT_COMPLEXITY_GATE_SETTINGS.threshold, 50);
  });

  test("budget clamps are hard (maxPaths/maxRounds never exceed 3)", () => {
    const resolved = resolveComplexityGateSettings({
      complexityGate: { enabled: true, maxPaths: 9, maxRounds: 99, threshold: 150 },
    });
    assert.equal(resolved.maxPaths, 3);
    assert.equal(resolved.maxRounds, 3);
    assert.equal(resolved.threshold, 50); // out-of-range → default, not clamp
  });
});

// ── L2 merged call through the manager (P0.2) ────────────────────────────────

describe("matchSkillsWithVerdict", () => {
  test("disabled mode is the byte-level baseline: no directive bytes, null verdict", async () => {
    const h = createHarness(); // gate absent → disabled
    h.outputs.push(JSON.stringify({ skillNames: ["demo-skill"], T: 25, P: 30, C: 25, R: 20 }));
    const { skillNames, verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: false,
    });
    assert.deepEqual(skillNames, ["demo-skill"]);
    assert.equal(verdict, null); // gate off: TPCR present in the response and STILL ignored
    assert.equal(h.requests.length, 1);
    const systemPrompt = String(h.requests[0]?.messages?.[0]?.content ?? "");
    assert.ok(!systemPrompt.includes("COMPLEXITY"), "no scoring directive in disabled mode");
    assert.ok(!systemPrompt.includes("T (time horizon"), "no dimension criteria in disabled mode");
    // The prompt equals the pre-feature template render byte-for-byte.
    const poolJson = JSON.stringify(
      SKILLS.map((s) => ({ name: s.name, description: s.description })),
      null,
      2
    );
    assert.equal(systemPrompt, renderPreFeatureTemplate("", poolJson));
  });

  test("enabled + L2 scores → lane computed by program code, model-claimed lane ignored", async () => {
    const h = createHarness({ enabled: true });
    // The model self-reports "express" while its scores sum to 100 — the
    // computed lane MUST be deep.
    h.outputs.push(
      JSON.stringify({
        skillNames: ["demo-skill"],
        lane: "express",
        T: 25,
        P: 30,
        C: 25,
        R: 20,
        reason: "looks simple",
      })
    );
    const { verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: true,
    });
    assert.equal(verdict?.lane, "deep");
    assert.equal(verdict?.source, "l2-flash");
    assert.deepEqual(verdict?.tpcr, { T: 25, P: 30, C: 25, R: 20 });
    assert.equal(verdict?.reason, "looks simple");
    // The directive rode the system prompt tail.
    const systemPrompt = String(h.requests[0]?.messages?.[0]?.content ?? "");
    assert.ok(systemPrompt.includes(COMPLEXITY_SCORING_DIRECTIVE), "directive appended in enabled mode");
  });

  test("enabled + sub-threshold scores → express", async () => {
    const h = createHarness({ enabled: true });
    h.outputs.push(JSON.stringify({ skillNames: [], T: 0, P: 30, C: 0, R: 0 }));
    const { verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: true,
    });
    assert.equal(verdict?.lane, "express");
    assert.equal(verdict?.source, "l2-flash");
  });

  test("L1 hit decides the lane and keeps the prompt legacy-shaped (no directive)", async () => {
    const h = createHarness({ enabled: true });
    h.outputs.push(JSON.stringify({ skillNames: [] }));
    // planMode → L1 deep, no L2 scoring needed.
    const { verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: true,
      planMode: true,
    });
    assert.equal(verdict?.lane, "deep");
    assert.equal(verdict?.source, "l1-plan-mode");
    const systemPrompt = String(h.requests[0]?.messages?.[0]?.content ?? "");
    assert.ok(!systemPrompt.includes("T (time horizon"), "L1 hit → no directive bytes");
  });

  // ── fail-open paths (all → express, source fail-open) ──

  test("fail-open #1: no background client → express", async () => {
    const h = createHarness({ enabled: true });
    (h.manager as unknown as Record<string, unknown>).createBackgroundLlm = () => ({ client: null });
    const { skillNames, verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: true,
    });
    assert.deepEqual(skillNames, []);
    assert.equal(verdict?.lane, "express");
    assert.equal(verdict?.source, "fail-open");
  });

  test("fail-open #2: garbage content → express", async () => {
    const h = createHarness({ enabled: true });
    h.outputs.push("this is not json at all");
    const { verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: true,
    });
    assert.equal(verdict?.lane, "express");
    assert.equal(verdict?.source, "fail-open");
  });

  test("fail-open #2b: malformed TPCR fields → express", async () => {
    const h = createHarness({ enabled: true });
    h.outputs.push(JSON.stringify({ skillNames: [], T: 12, P: 30, C: 25, R: 20 })); // intermediate value
    const { verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: true,
    });
    assert.equal(verdict?.lane, "express");
    assert.equal(verdict?.source, "fail-open");
  });

  test("fail-open #3: transport throw → express (and abort still propagates)", async () => {
    const h = createHarness({ enabled: true });
    h.outputs.push("THROW");
    const { verdict } = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", {
      laneGateEnabled: true,
    });
    assert.equal(verdict?.lane, "express");
    assert.equal(verdict?.source, "fail-open");

    // Pre-aborted signal must rethrow (abort is not a fail-open, it is a stop).
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      seam(h.manager).matchSkillsWithVerdict(SKILLS, "another grey prompt", {
        laneGateEnabled: true,
        signal: controller.signal,
      })
    );
  });

  // ── cache replay (P0.3) ──

  test("cache replay: same prompt + pool replays skillNames AND lane with zero extra calls", async () => {
    const h = createHarness({ enabled: true });
    h.outputs.push(JSON.stringify({ skillNames: ["demo-skill"], T: 25, P: 30, C: 25, R: 20 }));
    const first = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", { laneGateEnabled: true });
    assert.equal(first.verdict?.lane, "deep");
    assert.equal(h.requests.length, 1);

    const second = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", { laneGateEnabled: true });
    assert.equal(h.requests.length, 1, "replay burns no LLM call");
    assert.deepEqual(second.skillNames, ["demo-skill"]);
    assert.equal(second.verdict?.lane, "deep");
    assert.deepEqual(second.verdict?.tpcr, { T: 25, P: 30, C: 25, R: 20 });

    // A different prompt misses the cache and re-calls.
    h.outputs.push(JSON.stringify({ skillNames: [], T: 0, P: 0, C: 0, R: 0 }));
    await seam(h.manager).matchSkillsWithVerdict(SKILLS, "a different grey prompt", { laneGateEnabled: true });
    assert.equal(h.requests.length, 2);
  });

  test("an entry cached with the gate disabled replays as fail-open express after enabling", async () => {
    const h = createHarness();
    // Disabled era: match with the gate off — the entry caches WITHOUT a verdict.
    (h.manager as unknown as Record<string, unknown>).getResolvedSettings = () => ({
      model: "test-model",
      routing: { enabled: false },
      complexityGate: { enabled: false },
    });
    h.outputs.push(JSON.stringify({ skillNames: ["demo-skill"] }));
    await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", { laneGateEnabled: false });

    // Enabled era, same prompt + pool: replay must cost zero calls and carry
    // an express fail-open verdict (no stale-deep, no re-burn).
    (h.manager as unknown as Record<string, unknown>).getResolvedSettings = () => ({
      model: "test-model",
      routing: { enabled: false },
      complexityGate: { enabled: true },
    });
    const replay = await seam(h.manager).matchSkillsWithVerdict(SKILLS, "grey zone prompt", { laneGateEnabled: true });
    assert.equal(h.requests.length, 1, "still zero extra calls");
    assert.deepEqual(replay.skillNames, ["demo-skill"]);
    assert.equal(replay.verdict?.lane, "express");
    assert.equal(replay.verdict?.source, "fail-open");
  });
});

// ── createSession integration (P0.4) ─────────────────────────────────────────

describe("createSession lane stamping", () => {
  function createSessionHarness(complexityGate?: Record<string, unknown>) {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      chat: {
        completions: {
          create: async (request: Record<string, unknown>) => {
            requests.push(request);
            if (request?.response_format?.type === "json_object") {
              return {
                choices: [{ message: { content: JSON.stringify({ skillNames: [], T: 25, P: 30, C: 25, R: 20 }) } }],
              };
            }
            return {
              choices: [{ message: { content: "done" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            };
          },
        },
      },
    };
    const projectRoot = tempRoot();
    // One candidate skill so the flash call actually fires.
    const skillDir = path.join(projectRoot, ".deeporca", "skills", "demo-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: demonstration\n---\n# demo\n"
    );
    const manager = new SessionManager({
      projectRoot,
      createOpenAIClient: () => ({
        client: client as never,
        model: "test-model",
        baseURL: "https://api.deepseek.com",
        thinkingEnabled: false,
      }),
      getResolvedSettings: () => ({
        model: "test-model",
        routing: { enabled: false },
        ...(complexityGate ? { complexityGate } : {}),
      }),
      renderMarkdown: (text: string) => text,
      onAssistantMessage: () => {},
    });
    return { manager, requests, projectRoot };
  }

  test("gate disabled: lane stays undefined and the LLM call count is unchanged", async () => {
    const disabled = createSessionHarness();
    (disabled.manager as unknown as Record<string, unknown>).activateSession = async () => {};
    const sessionId = await disabled.manager.createSession({ text: "grey zone refactor request" });
    assert.equal(disabled.manager.getSession(sessionId)?.lane, undefined);
    const jsonCalls = disabled.requests.filter((r) => r?.response_format?.type === "json_object");
    assert.equal(jsonCalls.length, 1, "exactly one flash call — no gate surcharge");

    const enabled = createSessionHarness({ enabled: true });
    (enabled.manager as unknown as Record<string, unknown>).activateSession = async () => {};
    const sessionId2 = await enabled.manager.createSession({ text: "grey zone refactor request" });
    assert.equal(enabled.manager.getSession(sessionId2)?.lane, "deep", "L2 verdict stamps the entry");
    const jsonCalls2 = enabled.requests.filter((r) => r?.response_format?.type === "json_object");
    assert.equal(jsonCalls2.length, 1, "the verdict rides the SAME call — zero incremental LLM calls");
  });

  test("image-only prompt: L1 stamps express without any flash call", async () => {
    const h = createSessionHarness({ enabled: true });
    (h.manager as unknown as Record<string, unknown>).activateSession = async () => {};
    const sessionId = await h.manager.createSession({ text: undefined, imageUrls: ["file:///a.png"] });
    assert.equal(h.manager.getSession(sessionId)?.lane, "express");
    assert.equal(h.requests.length, 0, "no text → no skill matching → no LLM call");
  });

  test("plan-mode prompt: L1 stamps deep without any flash call", async () => {
    const h = createSessionHarness({ enabled: true });
    (h.manager as unknown as Record<string, unknown>).activateSession = async () => {};
    const sessionId = await h.manager.createSession({ text: undefined, planMode: true });
    assert.equal(h.manager.getSession(sessionId)?.lane, "deep");
    assert.equal(h.requests.length, 0);
  });
});

// ── template byte stability (P0.2 red line) ──────────────────────────────────

describe("skill-matching template byte stability", () => {
  test("empty complexityDirective renders byte-identically to the pre-feature template", () => {
    const templatePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "templates",
      "auxiliary",
      "skill-matching.md.ejs"
    );
    const template = fs.readFileSync(templatePath, "utf8");
    const data = {
      agentInstructions: "agent rules",
      candidatePoolJson: JSON.stringify([{ name: "demo", description: "d" }], null, 2),
    };
    const disabled = Buffer.from(ejs.render(template, { ...data, complexityDirective: "" }));
    const baseline = Buffer.from(ejs.render(preFeatureTemplate(), data));
    assert.equal(disabled.compare(baseline), 0, "disabled render must be byte-identical");
    const enabledRender = ejs.render(template, { ...data, complexityDirective: COMPLEXITY_SCORING_DIRECTIVE });
    assert.ok(enabledRender.includes("T (time horizon"), "enabled render carries the criteria");
  });
});

// ── telemetry aggregation (P0.7) ──────────────────────────────────────────────

describe("summarizeLaneTelemetry", () => {
  test("lane distribution and per-source averages", () => {
    const summary = summarizeLaneTelemetry(
      [{ lane: "express" }, { lane: "express" }, { lane: "deep" }, {}, { lane: undefined }],
      {
        chat: [
          { prompt: 100, completion: 20 },
          { prompt: 80, completion: 20 },
        ],
        "depth-lane": [{ prompt: 500, completion: 100 }],
      }
    );
    assert.equal(summary.expressCount, 2);
    assert.equal(summary.deepCount, 1);
    assert.equal(summary.expressShare, 2 / 3);
    assert.equal(summary.avgChatRequestTokens, 110);
    assert.equal(summary.avgDepthLaneRequestTokens, 600);
  });

  test("empty input → zeros and null averages", () => {
    const summary = summarizeLaneTelemetry([], {});
    assert.equal(summary.expressShare, 0);
    assert.equal(summary.avgChatRequestTokens, null);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** The pre-feature skill-matching template: the current file minus the appended directive slot. */
function preFeatureTemplate(): string {
  // fileURLToPath (cross-platform fixture policy): URL.pathname keeps a
  // leading slash on Windows ("/D:/..."), which path.join then folds into
  // "D:\D:\..." — a guaranteed ENOENT on every drive-letter checkout.
  const templatePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "templates",
    "auxiliary",
    "skill-matching.md.ejs"
  );
  const template = fs.readFileSync(templatePath, "utf8");
  const legacyTail = /```\n<% if \(complexityDirective\) \{ -%>\n<%- complexityDirective -%>\n<% \} -%>\n$/;
  assert.ok(legacyTail.test(template), "the directive slot must sit at the template tail in this exact shape");
  return template.replace(legacyTail, "```\n");
}

function renderPreFeatureTemplate(agentInstructions: string, poolJson: string): string {
  return ejs.render(preFeatureTemplate(), { agentInstructions, candidatePoolJson: poolJson });
}
