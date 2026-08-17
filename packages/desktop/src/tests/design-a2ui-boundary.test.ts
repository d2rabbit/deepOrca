import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

/**
 * Three-layer positioning guards (docs/research/2026-08-14-openui-full-adoption-plan.md §〇/§五):
 * A2UI is the domain-wide interaction layer (proactive questions + annotation)
 * and must NEVER enter the design sub-domains' artifact pipelines
 * (PM-Design: OpenUI Lang; UI-Design: .dd). These tests lock that boundary in.
 */

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), "utf8");

test("guard ①: the design plugin declares no A2UI skill — only design sub-domain skills", () => {
  const manifest = read("packages/core/templates/plugins/design/skill.plugin.md");
  const skillsSection = manifest.split("mcp:")[0];
  // The a2ui MCP *server* hosts our design tools (shared in-process server),
  // so `mcp: [a2ui]` below the skills section is infrastructure, not a
  // pipeline entry. The skills list itself must stay design-only.
  for (const line of skillsSection.split("\n")) {
    if (/^\s*-\s*name:/.test(line)) {
      assert.doesNotMatch(line, /a2ui/i, `design plugin must not list A2UI skills: ${line.trim()}`);
    }
  }
  // And the interaction skill lives in meta-skills, not here.
  const metaSkills = fs.readdirSync(path.join(repoRoot, "packages/core/templates/plugins/meta-skills/skills"));
  assert.ok(metaSkills.includes("a2ui-annotation"), "a2ui-annotation should stay in the meta-skills group");
});

test("guard ②: DesignPipeline excludes a2ui — designs/ never stores interaction surfaces", () => {
  const source = read("packages/desktop/src/main/tools/design-store.ts");
  const declaration = source.match(/export type DesignPipeline = ([^;]+);/);
  assert.ok(declaration, "DesignPipeline declaration not found");
  assert.doesNotMatch(declaration[1], /a2ui/, `DesignPipeline must not include a2ui: ${declaration[1]}`);
});

test("guard ③: design.materialize routes only through the design sub-domain tools", () => {
  const source = read("packages/core/src/actions/design.ts");
  assert.match(source, /render_openui/, "materialize should reference render_openui");
  assert.match(source, /render_design/, "materialize should reference render_design");
  // A2UI interaction tools must not appear anywhere in the action's routing.
  assert.doesNotMatch(source, /render_surface|update_surface|render_prototype|close_surface|a2ui_action/);
});
