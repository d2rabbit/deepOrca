import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { buildDesignerPrompt, applyPromptToSkill, SKILL_PATH } from "../../../../scripts/generate-openui-prompt.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));

test("the SKILL.md component table is in sync with the generated prompt (drift guard)", async () => {
  const skillMd = fs.readFileSync(SKILL_PATH, "utf8");
  const regenerated = applyPromptToSkill(skillMd, await buildDesignerPrompt());
  assert.equal(
    regenerated,
    skillMd,
    "pm-designer-openui SKILL.md is out of sync — run `npm run openui:prompt` and commit."
  );
});

test("the generated prompt comes from the official openuiLibrary (signatures, not stubs)", async () => {
  const prompt = await buildDesignerPrompt();
  // Official TextContent sizes (the old hand-written stub had different enums).
  assert.match(prompt, /"small" \| "default" \| "large" \| "small-heavy" \| "large-heavy"/);
  // Key official components present across the roster's families.
  for (const name of [
    "Stack",
    "Card",
    "CardHeader",
    "Button",
    "Input",
    "Select",
    "Form",
    "Table",
    "Col",
    "Tabs",
    "Modal",
    "LineChart",
    "TextContent",
  ]) {
    assert.match(prompt, new RegExp(`\\b${name}\\(`));
  }
  // The standalone-agent system preamble is trimmed (we call tools, not raw DSL).
  assert.doesNotMatch(prompt, /Your ENTIRE response must be valid openui-lang/);
});

test("the generated prompt teaches interactive single-app prototypes", async () => {
  const prompt = await buildDesignerPrompt();
  // bindings flag → lang-core's state-syntax rule is present.
  assert.match(prompt, /\$varName = defaultValue/);
  assert.match(prompt, /@Set/);
  assert.match(prompt, /@Reset/);
  // toolCalls flag + tool list → Query workflow docs and the tool whitelist.
  assert.match(prompt, /Available Tools/);
  assert.match(prompt, /design\.readWiki/);
  // The single-app navigation example and hard rule are embedded verbatim.
  assert.match(prompt, /\$page == "home" \? homeView : ordersView/);
  assert.match(prompt, /ONE interactive application/);
  assert.match(prompt, /Action\(\[@Set\(\$page/);
  // 2026-09-07 review: bare-string button actions compile but silently dead-
  // click on the official library (triggerAction TypeError) — the prompt must
  // forbid them.
  assert.match(prompt, /MUST be Action\(\[\.\.\.\]\) expressions/);
  assert.match(prompt, /NEVER pass a bare string as a button action/);
});

test("applyPromptToSkill is idempotent across regenerations", async () => {
  const prompt = await buildDesignerPrompt();
  const once = applyPromptToSkill("# Old\n\n## Available components\n\n| hand table |\n\n## Next\n", prompt);
  const twice = applyPromptToSkill(once, await buildDesignerPrompt());
  assert.equal(twice, once);
});
