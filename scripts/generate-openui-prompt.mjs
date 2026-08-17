#!/usr/bin/env node
/**
 * generate-openui-prompt.mjs — regenerate the OpenUI Lang component prompt
 * from the designer component contract via library.prompt().
 *
 * The component schemas live in
 * packages/desktop/src/renderer/openui/library-schema.ts (single source of
 * truth, React-free). This script binds them to stub components — only the
 * schema matters for prompt generation — so the component table in
 * pm-designer-openui SKILL.md is a generated artifact, never hand-maintained.
 *
 * Usage:
 *   npm run openui:prompt            # --write, update SKILL.md in place
 *   node scripts/generate-openui-prompt.mjs           # print to stdout
 *   node scripts/generate-openui-prompt.mjs --write    # update SKILL.md
 *
 * The desktop build regenerates and fails on drift (see packages/desktop/build.mjs).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// library-schema.ts is TypeScript — load it through tsx's CJS loader so this
// script stays runnable with plain `node` (tsx is a devDependency).
require("tsx/cjs");
const {
  DESIGNER_COMPONENT_DEFS,
  DESIGNER_COMPONENT_GROUPS,
} = require("../packages/desktop/src/renderer/openui/library-schema.ts");

export const SKILL_PATH = join(repoRoot, "packages/core/templates/plugins/design/skills/pm-designer-openui/SKILL.md");

/** Build the component prompt from the real schema (exported for tests). */
export async function buildDesignerPrompt() {
  const { createLibrary, defineComponent } = await import("@openuidev/lang-core");
  const Stub = () => null;
  const lib = createLibrary({
    components: Object.entries(DESIGNER_COMPONENT_DEFS).map(([name, def]) =>
      defineComponent({ name, description: def.description, props: def.props, component: Stub })
    ),
    componentGroups: DESIGNER_COMPONENT_GROUPS.map((group) => ({ ...group, components: [...group.components] })),
  });

  const fullPrompt = lib.prompt({
    additionalRules: [
      "Follow the taste skill's design discipline (one accent, 4/8px spacing, ≥4.5:1 contrast).",
      "Use Query('design.readWiki', {name: '...'}) to pull project context into prototypes.",
    ],
    editMode: false,
  });

  // library.prompt() opens with a standalone-agent system preamble ("Your
  // ENTIRE response must be valid openui-lang...") that contradicts our
  // tool-call flow — the LLM must call render_openui, not reply in raw DSL.
  // Keep everything from the Syntax Rules onward.
  const syntaxIndex = fullPrompt.indexOf("## Syntax Rules");
  return syntaxIndex > 0 ? fullPrompt.slice(syntaxIndex) : fullPrompt;
}

/** Replace the SKILL.md component-table section with the generated prompt. */
export function applyPromptToSkill(skillMd, prompt) {
  const wrapped = `## Available components\n\n<!-- BEGIN generated component prompt (npm run openui:prompt) -->\n${prompt}\n<!-- END generated component prompt -->\n`;
  // The generated prompt itself contains ## headings, so re-runs must match
  // against the END sentinel rather than the next heading.
  const sentinelRegex = /## Available components[\s\S]*?<!-- END generated component prompt -->/;
  if (sentinelRegex.test(skillMd)) {
    return skillMd.replace(sentinelRegex, wrapped.trimEnd());
  }
  // First migration from a hand-written table: up to the next ## heading.
  const legacyRegex = /## Available components[\s\S]*?(?=\n## )/;
  if (!legacyRegex.test(skillMd)) {
    throw new Error("'## Available components' section not found in SKILL.md");
  }
  return skillMd.replace(legacyRegex, wrapped);
}

async function main() {
  const prompt = await buildDesignerPrompt();

  if (process.argv.includes("--write")) {
    let content = readFileSync(SKILL_PATH, "utf8");
    content = applyPromptToSkill(content, prompt);
    writeFileSync(SKILL_PATH, content, "utf8");
    console.log(`[generate-openui-prompt] updated ${SKILL_PATH}`);
  } else {
    console.log(prompt);
  }
}

// Only run main when invoked directly (tests import the helpers above).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[generate-openui-prompt] failed: ${err.message}`);
    process.exit(1);
  });
}
