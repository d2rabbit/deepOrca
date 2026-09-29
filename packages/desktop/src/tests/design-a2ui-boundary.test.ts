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

test("guard ③: the split modules route only through the design sub-domain tools", () => {
  // specs/moonviz-engine-replacement 后的通道矩阵：原型栈 = render_moonviz /
  // update_moonviz（canonical 单文档），UI 栈 = render_leafer（leafer-only，
  // 旧 update_openui 通道随栈退役）；.dd 通道仍不对两个设计模块开放。
  const design = read("packages/core/src/actions/design.ts");
  assert.match(design, /render_leafer/, "design.materialize should persist through render_leafer");
  assert.doesNotMatch(design, /render_openui|update_openui/, "the retired openui channels must not reappear");
  assert.doesNotMatch(design, /render_design|update_design/, "design module must not write .dd suites");
  const proto = read("packages/core/src/actions/prototype.ts");
  assert.match(proto, /render_moonviz/, "prototype.materialize should persist through render_moonviz");
  assert.match(proto, /update_moonviz/, "prototype.revise should persist through update_moonviz");
  assert.match(proto, /render_spec/, "prototype.spec should reference render_spec");
  assert.doesNotMatch(
    proto.replace(/render\/update_openui\)\./g, ""),
    /render_openui|update_openui/,
    "the retired openui channels must not reappear"
  );
  // 原型管线不得碰 leafer 持久化通道；UI 管线不得碰 moonviz 持久化通道。
  assert.doesNotMatch(proto, /from "\.\/leafer-|render_leafer/, "prototype pipeline must stay leafer-free");
  assert.doesNotMatch(design, /render_moonviz|update_moonviz/, "UI pipeline must stay moonviz-free");
  const a2ui = read("packages/desktop/src/main/tools/a2ui/a2ui-mcp.ts");
  assert.match(a2ui, /render_leafer/, "the a2ui server hosts the leafer persistence channel");
  assert.match(a2ui, /render_moonviz/, "the a2ui server hosts the moonviz persistence channel");
  assert.doesNotMatch(a2ui.split("render_leafer")[1] ?? "", /render_design|update_design/);
  // A2UI interaction tools must not appear anywhere in either routing.
  for (const source of [design, proto]) {
    assert.doesNotMatch(source, /render_surface|update_surface|render_prototype|close_surface|a2ui_action/);
  }
});
