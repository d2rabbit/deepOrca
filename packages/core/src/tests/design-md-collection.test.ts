/**
 * specs/design-md-collection：设计系统三源解析（bundled / project DESIGN.md /
 * vendored VoltAgent/awesome-design-md 收藏集）的机械验证。
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BUNDLED_DESIGN_SYSTEM_IDS,
  PROJECT_DESIGN_SYSTEM_ID,
  configureDesignSystemsVendorRoot,
  designMaterializeRun,
  listVendoredDesignSystems,
  looksLikeDesignSystemDoc,
  readVendoredDesignSystem,
  resolveDesignSystem,
} from "../actions";
import { NULL_SPAWNER } from "../actions/types";
import type { ActionContext, RunSubagentOptions } from "../actions/types";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "design-md-collection-"));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  configureDesignSystemsVendorRoot(null);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeCtx(projectRoot: string, generatedQueue: string[]): ActionContext {
  let callIndex = 0;
  const subagentCalls: RunSubagentOptions[] = [];
  return {
    projectRoot,
    signal: new AbortController().signal,
    emit: () => {},
    spawner: NULL_SPAWNER,
    runSubagent: async (call) => {
      subagentCalls.push(call);
      const content = generatedQueue[Math.min(callIndex, generatedQueue.length - 1)] ?? "";
      callIndex += 1;
      return { sessionId: "sub", content };
    },
    executeMcpTool: async () => ({
      ok: true,
      output: `saved\nArtifactRef: ${JSON.stringify({ suiteId: "ui-suite", versionId: "ui-v1", kind: "ui" })}`,
    }),
  };
}

const STITCH_DOC = [
  "## Overview",
  "Cinematic dark canvas, single accent.",
  "",
  "## Colors",
  "| Token | Hex | Role |",
  "| --- | --- | --- |",
  "| accent | #5e6ad2 | primary CTA |",
  "",
  "## Typography",
  "Display 64/1.0, body 16/1.6.",
  "",
  "## Components",
  "Buttons carry hover/active/disabled states.",
].join("\n");

const LEAFER_SUBAGENT =
  "```json\n" +
  JSON.stringify({
    tag: "Leafer",
    width: 1440,
    height: 1024,
    fill: "#fff",
    children: [{ tag: "Rect", x: 24, y: 24, width: 200, height: 64, fill: "#4F46E5" }],
  }) +
  "\n```";

test("looksLikeDesignSystemDoc: ≥3 ## sections pass, prose and thin docs fail", () => {
  assert.equal(looksLikeDesignSystemDoc(STITCH_DOC), true);
  assert.equal(looksLikeDesignSystemDoc("plain prose without any heading"), false);
  assert.equal(looksLikeDesignSystemDoc("## Only\none\n\n## Two\nsections"), false);
  // 收藏集真实形态：YAML 元信息直接 ## 起（无 H1）——必须通过。
  assert.equal(
    looksLikeDesignSystemDoc("version: alpha\nname: x\n\n## Overview\na\n\n## Colors\nb\n\n## Typography\nc"),
    true
  );
});

test("bundled systems still resolve first (contract baseline wins over vendored drift)", () => {
  const root = tempDir();
  const vendored = tempDir();
  // 同名 vendored 干扰项：bundled 必须赢。
  fs.mkdirSync(path.join(vendored, "dark-tech"), { recursive: true });
  fs.writeFileSync(path.join(vendored, "dark-tech", "DESIGN.md"), "## A\nx\n## B\ny\n## C\nz", "utf8");
  configureDesignSystemsVendorRoot(vendored);
  const resolved = resolveDesignSystem("dark-tech", root);
  assert.ok(resolved);
  assert.equal(resolved.source, "bundled");
  assert.ok(resolved.content.length > 100, "bundled template content, not the vendored decoy");
});

test("project DESIGN.md resolves at the workspace root and rejects malformed docs", () => {
  const root = tempDir();
  configureDesignSystemsVendorRoot(null);
  assert.equal(resolveDesignSystem(PROJECT_DESIGN_SYSTEM_ID, root), null, "missing file → null");
  fs.writeFileSync(path.join(root, "DESIGN.md"), "not a design doc", "utf8");
  assert.equal(resolveDesignSystem(PROJECT_DESIGN_SYSTEM_ID, root), null, "prose → null");
  fs.writeFileSync(path.join(root, "DESIGN.md"), STITCH_DOC, "utf8");
  const resolved = resolveDesignSystem(PROJECT_DESIGN_SYSTEM_ID, root);
  assert.ok(resolved);
  assert.equal(resolved.source, "project");
  assert.equal(resolved.content, STITCH_DOC);
});

test("project source falls back to .deeporca/DESIGN.md (design.extract replication output)", () => {
  const root = tempDir();
  configureDesignSystemsVendorRoot(null);
  // 只有复刻落盘位（.deeporca/DESIGN.md）→ 解析得到它。
  fs.mkdirSync(path.join(root, ".deeporca"), { recursive: true });
  fs.writeFileSync(path.join(root, ".deeporca", "DESIGN.md"), STITCH_DOC, "utf8");
  const fromExtract = resolveDesignSystem(PROJECT_DESIGN_SYSTEM_ID, root);
  assert.ok(fromExtract);
  assert.equal(fromExtract.source, "project");
  assert.equal(fromExtract.content, STITCH_DOC);
  // 两处都有 → 根 DESIGN.md（Stitch 约定）优先。
  fs.writeFileSync(path.join(root, "DESIGN.md"), `${STITCH_DOC}\nroot-wins`, "utf8");
  const resolved = resolveDesignSystem(PROJECT_DESIGN_SYSTEM_ID, root);
  assert.ok(resolved);
  assert.match(resolved.content, /root-wins/);
});

test("vendored ids resolve through the injected root; unsafe ids are rejected", () => {
  const root = tempDir();
  const vendored = tempDir();
  configureDesignSystemsVendorRoot(null);
  assert.deepEqual(listVendoredDesignSystems(), [], "no root → no vendored systems");
  fs.mkdirSync(path.join(vendored, "linear.app"), { recursive: true });
  fs.writeFileSync(path.join(vendored, "linear.app", "DESIGN.md"), STITCH_DOC, "utf8");
  fs.mkdirSync(path.join(vendored, "vercel"), { recursive: true });
  fs.writeFileSync(path.join(vendored, "vercel", "DESIGN.md"), STITCH_DOC, "utf8");
  configureDesignSystemsVendorRoot(vendored);
  assert.deepEqual(listVendoredDesignSystems(), ["linear.app", "vercel"]);
  const resolved = resolveDesignSystem("linear.app", root);
  assert.ok(resolved);
  assert.equal(resolved.source, "vendor");
  // 路径安全：大写/斜杠/点开头一律拒绝（即使文件系统上有对应目录）。
  assert.equal(resolveDesignSystem("Linear.app", root), null);
  assert.equal(resolveDesignSystem("../design-md/linear.app", root), null);
  assert.equal(resolveDesignSystem(".hidden", root), null);
});

test("oversized project DESIGN.md is truncated at the payload cap", () => {
  const root = tempDir();
  const big = `${STITCH_DOC}\n${"padding ".repeat(40_000)}`;
  fs.writeFileSync(path.join(root, "DESIGN.md"), big, "utf8");
  const resolved = resolveDesignSystem(PROJECT_DESIGN_SYSTEM_ID, root);
  assert.ok(resolved);
  assert.ok(resolved.content.length <= 200_000 + 100, "truncated near the cap");
});

test("design.materialize with project id and no file returns an actionable error", async () => {
  const root = tempDir();
  configureDesignSystemsVendorRoot(null);
  const result = await designMaterializeRun(
    { requirement: "登录页", designSystemId: "project" },
    makeCtx(root, [LEAFER_SUBAGENT])
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : (result as { error?: string }).error, /DESIGN\.md at the workspace root/);
});

test("design.materialize runs end-to-end on a vendored system id", async () => {
  const root = tempDir();
  const vendored = tempDir();
  fs.mkdirSync(path.join(vendored, "stripe"), { recursive: true });
  fs.writeFileSync(path.join(vendored, "stripe", "DESIGN.md"), STITCH_DOC, "utf8");
  configureDesignSystemsVendorRoot(vendored);
  const ctx = makeCtx(root, [LEAFER_SUBAGENT]);
  const result = await designMaterializeRun({ requirement: "登录页", designSystemId: "stripe" }, ctx);
  assert.equal(result.ok, true, `materialize on vendored id: ${result.ok ? "" : (result as { error?: string }).error}`);
  assert.ok(BUNDLED_DESIGN_SYSTEM_IDS.includes("dark-tech") as boolean, "bundled set unchanged");
});

test("vendored docs must pass the structural gate (thin file is unavailable)", () => {
  const root = tempDir();
  const vendored = tempDir();
  fs.mkdirSync(path.join(vendored, "thin"), { recursive: true });
  fs.writeFileSync(path.join(vendored, "thin", "DESIGN.md"), "## Only\none\n\n## Two\nsections", "utf8");
  configureDesignSystemsVendorRoot(vendored);
  assert.equal(resolveDesignSystem("thin", root), null, "two sections → rejected like the project source");
  fs.writeFileSync(path.join(vendored, "thin", "DESIGN.md"), STITCH_DOC, "utf8");
  assert.ok(resolveDesignSystem("thin", root), "three sections → resolves");
});

test(
  "vendored DESIGN.md symlinks are refused (never read outside the collection)",
  { skip: process.platform === "win32" },
  () => {
    const root = tempDir();
    const vendored = tempDir();
    // 上游把 DESIGN.md 提交成 symlink 时，跟随它会读出发动机之外的任意文件，
    // 而内容会进提示词与目录 IPC——只认常规文件。
    const secret = path.join(tempDir(), "secret.md");
    fs.writeFileSync(secret, `${STITCH_DOC}\nsecret`, "utf8");
    fs.mkdirSync(path.join(vendored, "linked"), { recursive: true });
    fs.symlinkSync(secret, path.join(vendored, "linked", "DESIGN.md"));
    configureDesignSystemsVendorRoot(vendored);
    assert.equal(resolveDesignSystem("linked", root), null);
    assert.ok(!readVendoredDesignSystem("linked"), "core's public vendored reader applies the same rule");
  }
);

test("oversized vendored DESIGN.md is read bounded and truncated", () => {
  const root = tempDir();
  const vendored = tempDir();
  fs.mkdirSync(path.join(vendored, "huge"), { recursive: true });
  // 1.6MB > 读取上限（800K 字节）：只读头部即够，截断语义不变。
  fs.writeFileSync(path.join(vendored, "huge", "DESIGN.md"), `${STITCH_DOC}\n${"padding ".repeat(200_000)}`, "utf8");
  configureDesignSystemsVendorRoot(vendored);
  const resolved = resolveDesignSystem("huge", root);
  assert.ok(resolved);
  assert.ok(resolved.content.length <= 200_000 + 100, "truncated near the cap");
  assert.match(resolved.content, /## Overview/, "head kept");
});
