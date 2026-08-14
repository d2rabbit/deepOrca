import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { buildDesignerPrompt, applyPromptToSkill, SKILL_PATH } from "../../../../scripts/generate-openui-prompt.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));

test("the SKILL.md component table is in sync with library-schema.ts (drift guard)", async () => {
  const skillMd = fs.readFileSync(SKILL_PATH, "utf8");
  const regenerated = applyPromptToSkill(skillMd, await buildDesignerPrompt());
  assert.equal(
    regenerated,
    skillMd,
    "pm-designer-openui SKILL.md is out of sync with library-schema.ts — run `npm run openui:prompt` and commit."
  );
});

test("the generated prompt reflects the real schema (signatures, not stubs)", async () => {
  const prompt = await buildDesignerPrompt();
  // Real TextContent variants — the old hand-written stub had different enums.
  assert.match(prompt, /"small" \| "body" \| "large" \| "large-heavy" \| "title" \| "caption" \| "muted"/);
  // All 11 components present.
  for (const name of [
    "Column",
    "Row",
    "Stack",
    "Card",
    "TextContent",
    "Badge",
    "Button",
    "TextField",
    "Metric",
    "Divider",
    "Spacer",
  ]) {
    assert.match(prompt, new RegExp(`\\b${name}\\(`));
  }
  // The standalone-agent system preamble is trimmed (we call tools, not raw DSL).
  assert.doesNotMatch(prompt, /Your ENTIRE response must be valid openui-lang/);
});

test("applyPromptToSkill is idempotent across regenerations", async () => {
  const prompt = await buildDesignerPrompt();
  const once = applyPromptToSkill("# Old\n\n## Available components\n\n| hand table |\n\n## Next\n", prompt);
  const twice = applyPromptToSkill(once, await buildDesignerPrompt());
  assert.equal(twice, once);
});
