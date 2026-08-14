import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionManager } from "../session";
import { composePlan, ioTypeCoercion } from "../routing/composer";
import { categoryJaccard } from "../routing/sad";

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
});

test("skill frontmatter metadata (categories/inputs/outputs) is parsed", async () => {
  const workspace = createTempDir("skill-meta-parse-");
  const home = createTempDir("skill-meta-parse-home-");
  process.env.HOME = home;
  const dir = path.join(workspace, ".deepcode", "skills", "chained-skill");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    dir + "/SKILL.md",
    "---\n" +
      "name: chained-skill\n" +
      "description: Chains with others\n" +
      "categories:\n  - docs\n  - testing\n" +
      "inputs:\n  - markdown\n" +
      "outputs:\n  - html\n" +
      "---\n# Chained\n",
    "utf8"
  );
  // A sibling without metadata — must stay undefined (back-compat shape).
  const plain = path.join(workspace, ".deepcode", "skills", "plain-skill");
  fs.mkdirSync(plain, { recursive: true });
  fs.writeFileSync(plain + "/SKILL.md", "---\nname: plain-skill\ndescription: Plain\n---\n# Plain\n", "utf8");

  const manager = new SessionManager({
    projectRoot: workspace,
    createOpenAIClient: () => ({ client: null, model: "test-model", thinkingEnabled: false }),
    getResolvedSettings: () => ({ model: "test-model" }),
    renderMarkdown: (text) => text,
    onAssistantMessage: () => {},
  });
  const skills = await manager.listSkills();
  const chained = skills.find((s) => s.name === "chained-skill");
  const plainSkill = skills.find((s) => s.name === "plain-skill");

  assert.deepEqual(chained?.categories, ["docs", "testing"]);
  assert.deepEqual(chained?.inputs, ["markdown"]);
  assert.deepEqual(chained?.outputs, ["html"]);
  assert.equal(plainSkill?.categories, undefined);
  assert.equal(plainSkill?.inputs, undefined);
  assert.equal(plainSkill?.outputs, undefined);
});

test("metadata activates the Compose compatibility measures (no longer always zero)", () => {
  const producer = {
    name: "producer",
    description: "Converts markdown source into html output",
    categories: ["docs"],
    outputTypes: ["html"],
  };
  const consumer = {
    name: "consumer",
    description: "Renders html pages into a report",
    categories: ["docs"],
    inputTypes: ["html"],
  };
  const blind = { name: "blind", description: "Unrelated thing entirely", categories: [], inputTypes: [] };

  assert.ok(ioTypeCoercion(producer, consumer) > 0, "output→input type match scores > 0");
  assert.equal(ioTypeCoercion(producer, blind), 0);
  assert.ok(categoryJaccard(producer, consumer) > 0);

  // Compose with metadata: the compatible consumer outranks an equally
  // similar but incompatible candidate for the second step.
  const plan = composePlan(
    [
      { step: 1, description: "convert markdown" },
      { step: 2, description: "render report" },
    ],
    [
      [
        { skill: producer, similarity: 0.8 },
        { skill: { ...producer, name: "producer2" }, similarity: 0.8 },
      ],
      [
        { skill: consumer, similarity: 0.5 },
        { skill: { ...blind, inputTypes: [] }, similarity: 0.5 },
      ],
    ],
    { alpha: 0.5, minSelectionScore: 0.1 }
  );
  assert.equal(plan.steps[1]?.skill?.name, "consumer");
});

test("composePlan without metadata behaves exactly as before (backward compat)", () => {
  const a = { name: "a", description: "write docs" };
  const b = { name: "b", description: "write docs" };
  const plan = composePlan(
    [
      { step: 1, description: "write the docs" },
      { step: 2, description: "write more docs" },
    ],
    [[{ skill: a, similarity: 0.9 }], [{ skill: b, similarity: 0.9 }]],
    { alpha: 0.5, minSelectionScore: 0.3 }
  );
  assert.equal(plan.steps[0]?.skill?.name, "a");
  assert.equal(plan.steps[1]?.skill?.name, "b");
  assert.deepEqual(plan.dependencies, []);
});

test("multi-intent sessions receive the orchestration plan message", async () => {
  const workspace = createTempDir("skill-meta-orch-");
  const home = createTempDir("skill-meta-orch-home-");
  process.env.HOME = home;
  for (const name of ["slides-skill", "test-skill"]) {
    const dir = path.join(workspace, ".deepcode", "skills", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dir + "/SKILL.md", `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`, "utf8");
  }

  const responses: unknown[] = [
    { choices: [{ message: { content: JSON.stringify({ skillNames: ["slides-skill"], multiIntent: true }) } }] },
    { choices: [{ message: { content: "done" } }] },
  ];
  const client = {
    chat: {
      completions: {
        create: async (request: any) => {
          if (request?.messages?.[1]?.content && !request.response_format) {
            return responses[1];
          }
          return responses.shift();
        },
      },
    },
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
  (manager as any).getRouters = async () => ({
    skillRouter: {
      shortlist: async () => null,
      composeRoute: async () => ({
        steps: [
          {
            subTask: { step: 1, description: "make slides" },
            skill: { name: "slides-skill" },
            score: 1,
            similarity: 1,
            compatibility: 0,
          },
          {
            subTask: { step: 2, description: "run tests" },
            skill: { name: "test-skill" },
            score: 1,
            similarity: 1,
            compatibility: 0,
          },
        ],
        dependencies: [[0, 1]],
        decomposed: true,
      }),
    },
    toolRouter: null,
  });

  const sessionId = await manager.createSession({ text: "generate slides and run the tests" });
  const orchestration = manager.listSessionMessages(sessionId).find((m) => m.content?.includes("<orchestration-plan>"));

  assert.ok(orchestration, "orchestration message injected");
  assert.match(orchestration!.content!, /make slides/);
  assert.match(orchestration!.content!, /use the "test-skill" skill/);
  assert.match(orchestration!.content!, /1 → 2/);
});
