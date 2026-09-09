/**
 * openui-pages unit tests — the PRD↔program mapping core (WP0/WP2/WP4).
 * Covers: target-platform declaration parsing (single/combo/多端总称/absent),
 * page-list ID mapping (inline + column + legacy no-id), program page
 * extraction (initial/comparisons/navTargets), fence transparency, and the
 * Jaccard structural distance for variants.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractTargetPlatforms,
  parsePageList,
  extractProgramPages,
  componentUsage,
  componentJaccard,
} from "../common/openui-pages";

// ── extractTargetPlatforms ───────────────────────────────────────────────────

test("extractTargetPlatforms: single declarations map to one device", () => {
  const spec = ["# PRD", "", "| 目标平台 | 移动端 App（iOS/Android） |", "", "## 1. 背景与目标"].join("\n");
  assert.deepEqual(extractTargetPlatforms(spec), ["mobile"]);
  assert.deepEqual(extractTargetPlatforms("| 目标平台 | Web 应用 |"), ["desktop"], "web keyword maps to desktop");
  assert.deepEqual(extractTargetPlatforms("| 目标平台 | 桌面应用 |"), ["desktop"]);
  assert.deepEqual(extractTargetPlatforms("| 目标平台 | 平板优先 |"), ["tablet"]);
  assert.deepEqual(extractTargetPlatforms("| 适用平台 | 微信小程序 |"), ["mobile"], "mini-program → mobile");
});

test("extractTargetPlatforms: combo declarations enumerate devices", () => {
  assert.deepEqual(extractTargetPlatforms("| 目标平台 | 多端(web+mobile) |"), ["desktop", "mobile"]);
  assert.deepEqual(extractTargetPlatforms("| 目标平台 | web + mobile + tablet |"), ["desktop", "mobile", "tablet"]);
  assert.deepEqual(extractTargetPlatforms("| 目标平台 | 多端 |"), ["desktop", "mobile", "tablet"], "总称按三端");
});

test("extractTargetPlatforms: absent declaration returns null (legacy PRD)", () => {
  assert.equal(extractTargetPlatforms("# 只有标题的旧 PRD\n\n## 页面清单\n\n| 页面 | 目的 |\n| --- | --- |"), null);
  // 围栏内的行不算声明
  const fenced = ["# PRD", "", "```md", "| 目标平台 | 移动端 |", "```"].join("\n");
  assert.equal(extractTargetPlatforms(fenced), null);
});

// ── parsePageList ────────────────────────────────────────────────────────────

test("parsePageList: 页面 ID column + inline id both map; hasIds requires all rows", () => {
  const spec = [
    "# PRD",
    "",
    "## 4. 页面清单",
    "",
    "| 页面 | 页面ID | 目的 |",
    "| --- | --- | --- |",
    "| 订单列表 | orders | 浏览全部订单 |",
    "| 订单详情(order-detail) |  | 查看单笔订单 |",
    "| 设置 | settings | 偏好配置 |",
  ].join("\n");
  const list = parsePageList(spec);
  assert.ok(list);
  assert.equal(list?.pages.length, 3);
  assert.deepEqual(
    list?.pages.map((p) => p.id),
    ["orders", "order-detail", "settings"],
    "column id and inline id both parse"
  );
  assert.equal(list?.hasIds, true);
  assert.equal(list?.pages[1]?.name, "订单详情", "inline id is stripped from the display name");
});

test("parsePageList: legacy rows without ids degrade hasIds to false", () => {
  const spec = ["## 页面清单", "", "| 页面 | 目的 |", "| --- | --- |", "| 首页 | 计时 |", "| 设置页 | 偏好 |"].join(
    "\n"
  );
  const list = parsePageList(spec);
  assert.ok(list);
  assert.equal(list?.pages.length, 2);
  assert.equal(list?.hasIds, false);
});

test("parsePageList: fence transparency, CJK no-space heading, section boundary", () => {
  const spec = [
    "##页面清单",
    "",
    "| 页面 | 页面ID |",
    "| --- | --- |",
    "| 首页 | home |",
    "",
    "```md",
    "| 假页面 | fake |",
    "```",
    "",
    "## 5. 非功能需求",
    "",
    "| 项目 | 内容 |",
    "| --- | --- |",
    "| 性能 | 快 |",
  ].join("\n");
  const list = parsePageList(spec);
  assert.ok(list, "no-space CJK heading still opens the section");
  assert.deepEqual(
    list?.pages.map((p) => p.id),
    ["home"],
    "fenced rows and next-section tables are excluded"
  );
});

test("parsePageList: no 页面清单 section returns null", () => {
  assert.equal(parsePageList("# 只有背景\n\n## 1. 背景与目标\n\n正文"), null);
});

// ── extractProgramPages ──────────────────────────────────────────────────────

const PROGRAM = [
  '$page = "home"',
  'root = Stack([nav, $page == "home" ? homeView : $page == "orders" ? ordersView : settingsView])',
  'navHome = Button("首页", Action([@Set($page, "home")]))',
  'navOrders = Button("订单", Action([@Set($page, "orders")]))',
  "homeView = Card([])",
  "ordersView = Card([])",
  "settingsView = Card([])",
].join("\n");

test("extractProgramPages: initial / comparisons / navTargets", () => {
  const pages = extractProgramPages(PROGRAM);
  assert.equal(pages.initial, "home");
  assert.deepEqual([...pages.comparisons].sort(), ["home", "orders"]);
  assert.deepEqual([...pages.navTargets].sort(), ["home", "orders"]);
});

test("extractProgramPages: dead navigation target is visible to the closure check", () => {
  const pages = extractProgramPages('x = Action([@Set($page, "typo-page")])');
  assert.deepEqual([...pages.navTargets], ["typo-page"]);
  assert.equal(pages.comparisons.size, 0, "target never compared anywhere");
  assert.equal(pages.initial, null, "no $page declaration");
});

// ── statementJaccard ─────────────────────────────────────────────────────────

test("componentJaccard: renamed copy keeps the mix, a real platform variant swaps it", () => {
  const desktop = [
    '$page = "home"',
    "root = Stack([sidebar, homeView])",
    'sidebar = Stack([], "row")',
    'homeView = Table([Col("订单", [])])',
    'kpiRow = Stack([Card([]), Card([])], "row")',
  ].join("\n");
  const renamed = desktop.replace(/sidebar/g, "sideNav").replace(/kpiRow/g, "kpis");
  const mobile = [
    '$page = "home"',
    "root = Stack([homeView, tabBar])",
    'tabBar = Stack([Button("首页"), Button("我的")], "row")',
    'homeView = Card([CardHeader("订单")])',
  ].join("\n");
  // 换名副本:组件构成逐字不变 → ≈1 → verify 的 distinct 检查判 failed(同构)。
  assert.ok(componentJaccard(desktop, renamed) >= 0.99, "rename-only copy keeps the component mix");
  // 真平台变体:Table→Card、侧栏→底部 tab,构成实质不同 → 低分 → distinct 通过。
  assert.ok(componentJaccard(desktop, mobile) < 0.75, "genuinely different shell scores low");
  assert.equal(componentUsage("Card([])\nCard([])").get("Card"), 2, "histogram counts occurrences");
});
