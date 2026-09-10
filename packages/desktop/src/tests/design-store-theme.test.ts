/**
 * PRD 主题层存储（specs/prd-theme-layer WP1）：主题 CRUD 于 index.json、
 * 套件主题归属/阶段/关系指派为元数据（永不追加版本）、删主题解绑套件、
 * 旧索引缺 themes 字段缺省。
 */

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appendDesignSuiteVersion,
  assignSuiteTheme,
  createDesignSuite,
  createDesignTheme,
  deleteDesignSuite,
  deleteDesignTheme,
  listDesignSuites,
  listDesignThemes,
  onDesignSuiteChange,
  readDesignSuite,
  updateDesignTheme,
  type DesignSuiteChangeEvent,
  type PrototypeSuiteContent,
} from "../main/tools/design-store";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "design-theme-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function protoSuite(root: string, title: string, extra?: Partial<Parameters<typeof createDesignSuite>[1]>): string {
  const content: PrototypeSuiteContent = { spec: `# ${title}\n\n## 需求\n\n- item` };
  const created = createDesignSuite(root, { title, kind: "prototype", content, ...(extra as object) });
  assert.ok(created, "suite created");
  return created.id;
}

test("theme CRUD round-trips through index.json with oldest-first listing", () => {
  const root = tempRoot();
  const first = createDesignTheme(root, { title: "人员管理", note: "基础模块" });
  const second = createDesignTheme(root, { title: "登录" });
  assert.ok(first && second);
  assert.deepEqual(
    listDesignThemes(root).map((theme) => theme.title),
    ["人员管理", "登录"],
    "themes list oldest-first"
  );
  assert.equal(first.note, "基础模块");

  assert.equal(updateDesignTheme(root, second.id, { title: "登录与鉴权", note: null }), true);
  const updated = listDesignThemes(root).find((theme) => theme.id === second.id);
  assert.equal(updated?.title, "登录与鉴权");
  assert.equal(updated?.note, undefined, "note: null clears the note");

  // 空标题拒绝；不存在 id 更新/删除返回 false。
  assert.equal(createDesignTheme(root, { title: "   " }), null);
  assert.equal(updateDesignTheme(root, "no-such-theme", { title: "x" }), false);
  assert.equal(deleteDesignTheme(root, "no-such-theme"), false);
});

test("suites carry theme fields at creation and across appends without new versions", () => {
  const root = tempRoot();
  const theme = createDesignTheme(root, { title: "登录" });
  assert.ok(theme);
  const parent = protoSuite(root, "人员管理 PRD");
  const suiteId = protoSuite(root, "登录 PRD", {
    themeId: theme.id,
    stage: "阶段1",
    inherits: { suiteId: parent },
    references: [{ suiteId: parent }],
  });

  const suite = readDesignSuite(root, suiteId);
  assert.ok(suite);
  assert.equal(suite.themeId, theme.id);
  assert.equal(suite.stage, "阶段1");
  assert.deepEqual(suite.inherits, { suiteId: parent });
  assert.deepEqual(suite.references, [{ suiteId: parent }]);

  // append（内容变化）不丢主题字段，也不因主题字段变化而追加版本。
  const before = readDesignSuite(root, suiteId)?.versions.length ?? 0;
  assert.equal(assignSuiteTheme(root, suiteId, { stage: "阶段2" }), true);
  const afterAssign = readDesignSuite(root, suiteId);
  assert.equal(afterAssign?.versions.length, before, "theme assignment must never append a version");
  assert.equal(afterAssign?.stage, "阶段2");
  assert.equal(afterAssign?.themeId, theme.id, "unspecified fields keep their value");

  const appended = appendDesignSuiteVersion(root, {
    suiteId,
    content: { spec: `# 登录 PRD\n\n## 需求\n\n- 修订` },
    note: "content revision",
  });
  assert.ok(appended);
  assert.equal(appended.themeId, theme.id, "theme fields survive appends (lineage-stable)");
  assert.equal(appended.stage, "阶段2");
  assert.deepEqual(appended.references, [{ suiteId: parent }]);

  // 索引 summary 同步携带主题字段（目录分组的数据源）。
  const summary = listDesignSuites(root, "prototype").find((candidate) => candidate.id === suiteId);
  assert.equal(summary?.themeId, theme.id);
  assert.equal(summary?.stage, "阶段2");
});

test("assignSuiteTheme validates, clears, and replaces; unknown theme is refused", () => {
  const root = tempRoot();
  const themeA = createDesignTheme(root, { title: "A" });
  const themeB = createDesignTheme(root, { title: "B" });
  assert.ok(themeA && themeB);
  const suiteId = protoSuite(root, "PRD", { themeId: themeA.id, references: [{ suiteId: "x" }] });

  assert.equal(assignSuiteTheme(root, suiteId, { themeId: "no-such-theme" }), false, "unknown theme refused");
  assert.equal(readDesignSuite(root, suiteId)?.themeId, themeA.id, "refused assignment leaves state untouched");

  assert.equal(assignSuiteTheme(root, suiteId, { themeId: themeB.id, references: null, inherits: null }), true);
  const cleared = readDesignSuite(root, suiteId);
  assert.equal(cleared?.themeId, themeB.id);
  assert.equal(cleared?.references, undefined, "references: null clears");
  assert.equal(cleared?.inherits, undefined);

  assert.equal(assignSuiteTheme(root, suiteId, { themeId: null, stage: null }), true);
  const detached = readDesignSuite(root, suiteId);
  assert.equal(detached?.themeId, undefined, "themeId: null clears");
  assert.equal(detached?.stage, undefined);
});

test("deleting a theme detaches its suites but never deletes a PRD", () => {
  const root = tempRoot();
  const theme = createDesignTheme(root, { title: "登录" });
  assert.ok(theme);
  const keepId = protoSuite(root, "归属主题的 PRD", { themeId: theme.id });
  const otherId = protoSuite(root, "无主题 PRD");

  const events: DesignSuiteChangeEvent[] = [];
  const unsubscribe = onDesignSuiteChange((event) => events.push(event));

  assert.equal(deleteDesignTheme(root, theme.id), true);
  assert.deepEqual(listDesignThemes(root), [], "theme removed from index");

  const kept = readDesignSuite(root, keepId);
  assert.ok(kept, "the PRD itself survives the theme delete");
  assert.equal(kept.themeId, undefined, "detached (meta cleared)");
  const summary = listDesignSuites(root, "prototype").find((candidate) => candidate.id === keepId);
  assert.equal(summary?.themeId, undefined, "index summary detached too");
  assert.ok(readDesignSuite(root, otherId), "unrelated suite untouched");

  assert.ok(
    events.some((event) => event.change === "theme" && event.root === root),
    "theme deletion fires a theme change event for the directory"
  );
  unsubscribe();
});

test("an old index without the themes field degrades to an empty theme list", () => {
  const root = tempRoot();
  protoSuite(root, "旧数据 PRD");
  // 模拟旧版 index.json：没有 themes 字段。
  const indexPath = path.join(root, ".deeporca", "designs", "index.json");
  const raw = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Record<string, unknown>;
  delete raw.themes;
  fs.writeFileSync(indexPath, JSON.stringify(raw), "utf8");

  assert.deepEqual(listDesignThemes(root), []);
  const suiteId = protoSuite(root, "再次创建");
  assert.equal(listDesignSuites(root, "prototype").length, 2, "suites unaffected");
  const theme = createDesignTheme(root, { title: "新主题" });
  assert.ok(theme);
  assert.equal(assignSuiteTheme(root, suiteId, { themeId: theme.id }), true);
});

test("deleting a suite leaves its theme intact", () => {
  const root = tempRoot();
  const theme = createDesignTheme(root, { title: "登录" });
  assert.ok(theme);
  const suiteId = protoSuite(root, "临时 PRD", { themeId: theme.id });
  assert.equal(deleteDesignSuite(root, suiteId), true);
  assert.deepEqual(
    listDesignThemes(root).map((item) => item.id),
    [theme.id],
    "theme survives suite deletion"
  );
});
