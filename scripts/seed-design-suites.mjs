/**
 * Seed the running app's workspace with the design-mockup demo data
 * (轻订单管理) — prototype suite v1..v3 and ui suite v1..v4 — using the
 * REAL design-store implementation so the on-disk shape matches exactly.
 * Run: node --import tsx/esm scripts/seed-design-suites.mjs <gvgl-root>
 */
import { createDesignSuite, appendDesignSuiteVersion } from "../packages/desktop/src/main/tools/design-store.ts";

const root = process.argv[2];
if (!root) {
  console.error("usage: node --import tsx/esm scripts/seed-design-suites.mjs <workspaceRoot>");
  process.exit(1);
}

const SPEC = `# 轻订单管理 — 需求文档

## 背景与目标
小团队订单处理目前依赖群聊接龙，错单漏单频发。目标：一个最小闭环——登录、看单、刷新，先跑通再迭代。

## 用户与场景
- PM / 运营（非技术）：晨间看当日单量与履约率。
- 店员：移动端 375px 快速查单、改状态。

## 功能需求
- 邮箱 + 密码登录，支持「记住我」。
- 订单列表：KPI（今日订单 / 履约率 / 退款中）+ 表格 + 刷新。
- 侧栏导航：订单 / 设置。

## 页面清单（= 原型契约）
- **登录** — 邮箱 + 密码，记住我
- **订单列表** — KPI + 表格 + 刷新
- **设置** — 通知开关占位

## 非功能需求
- 移动 375px 不横向溢出。
- 触点 ≥ 44px；正文对比度 ≥ 4.5:1。

## 验收标准（→ 可勾选验证清单）
- 邮箱 + 密码可登录并进入订单列表（auth:submit）
- 侧栏导航可切换 订单 / 设置（nav:goto:*）
- 刷新按钮更新订单行数 12 → 14（data:refresh）
- 重置按钮清空登录表单（form:reset）
- 375px 视口无横向溢出

## 待确认
- 是否需要导出 CSV？（当前排期外）
`;

// MoonViz 替换后：原型套件走 moonviz 字段（canonical .mbt.md），UI 套件走
// leafer 字段（合法场景树 JSON）。旧 OpenUI 程序串已随栈作废。
const LEAFER_SCENE = JSON.stringify({
  tag: "Leafer",
  width: 1440,
  height: 1024,
  fill: "#ffffff",
  children: [
    {
      tag: "Frame",
      name: "orders",
      x: 0,
      y: 0,
      width: 1440,
      height: 1024,
      fill: "#111318",
      children: [{ tag: "Text", x: 40, y: 40, width: 400, height: 32, fill: "#ffffff", text: "轻订单管理" }],
    },
  ],
});
const MOONVIZ_DOC = `---
moonviz:
  format: visual-document
  revision: 1
  entry: orders
---

# 轻订单管理

<!-- moonviz:artboard orders -->
\`\`\`mbt
fn visual_orders() -> @decl.Prototype {
  let page = @decl.prototype(name="orders", width=1200.0, height=800.0)
  page.add(@decl.generic_node(id="title",component="heading",kind="text",width=@decl.fixed(300),height=@decl.fixed(36),x=40,y=32,text="轻订单管理",fill="none",stroke="none",stroke_width=0,radius=0,opacity=1,font_size=24,text_color="#1A1C1E",font_weight="normal",shadow="none",rotate=0,blur=0,blend="normal",line_height=1.5,tracking=0,flip="none",constraint="lt"))
  page.add(@decl.generic_node(id="new_btn",component="button",kind="rect",width=@decl.fixed(120),height=@decl.fixed(40),x=1040,y=28,text="新建订单",fill="#4B6BFB",stroke="none",stroke_width=0,radius=8,opacity=1,font_size=14,text_color="#FFFFFF",font_weight="normal",shadow="none",rotate=0,blur=0,blend="normal",line_height=1.5,tracking=0,flip="none",constraint="lt"))
  page
}
\`\`\`

<!-- moonviz:artboard orders_v2 -->
\`\`\`mbt
fn visual_orders_v2() -> @decl.Prototype {
  let page = @decl.prototype(name="orders_v2", width=1200.0, height=800.0)
  page.add(@decl.generic_node(id="title",component="heading",kind="text",width=@decl.fixed(300),height=@decl.fixed(36),x=40,y=32,text="轻订单管理",fill="none",stroke="none",stroke_width=0,radius=0,opacity=1,font_size=24,text_color="#1A1C1E",font_weight="normal",shadow="none",rotate=0,blur=0,blend="normal",line_height=1.5,tracking=0,flip="none",constraint="lt"))
  page.add(@decl.generic_node(id="new_btn",component="button",kind="rect",width=@decl.fixed(120),height=@decl.fixed(40),x=1040,y=28,text="新建订单",fill="#2E9E8F",stroke="none",stroke_width=0,radius=8,opacity=1,font_size=14,text_color="#FFFFFF",font_weight="normal",shadow="none",rotate=0,blur=0,blend="normal",line_height=1.5,tracking=0,flip="none",constraint="lt"))
  page
}
\`\`\`
`;

const verificationV3 = {
  status: "passed",
  generatedAt: "2026-09-06T09:12:00.000Z",
  healingRounds: 1,
  checks: [
    { id: "c1", label: "邮箱 + 密码可登录并进入订单列表", status: "passed", action: "auth:submit" },
    { id: "c2", label: "侧栏导航可切换 订单 / 设置", status: "passed", action: "nav:goto:orders" },
    { id: "c3", label: "刷新按钮更新订单行数 12 → 14", status: "passed", action: "data:refresh" },
    {
      id: "c4",
      label: "重置按钮清空登录表单",
      status: "healed",
      action: "form:reset",
      observation: "R1 观察到重置后 email 残留，自愈后 R2 复检通过",
    },
    { id: "c5", label: "375px 视口无横向溢出", status: "passed", action: "@resize:375" },
  ],
};

const uiQualityV4 = {
  lintFindings: [],
  runtimeChecks: [
    { id: "r1", label: "375px 溢出", status: "passed", value: "0px" },
    { id: "r2", label: "触达尺寸", status: "passed", value: "44px" },
    { id: "r3", label: "正文对比度", status: "passed", value: "4.6:1" },
    { id: "r4", label: "视口 meta / 字体", status: "passed" },
  ],
  review: {
    status: "passed",
    composite: 8.4,
    rounds: 2,
    evidence: {
      层级: "KPI → 表格 → 操作的 F 型动线清晰",
      品牌: "accent 海绿贯穿按钮与 Badge",
      a11y: "对比度实测 4.6:1；触点 44px",
      文案: "无占位 lorem；按钮动词开头",
    },
  },
};

// ── prototype suite: v1 → v2 → v3 ──
const proto = createDesignSuite(root, {
  title: "轻订单管理 · 原型",
  kind: "prototype",
  status: "draft",
  note: "初稿 · compact-utility",
  content: { requirement: "小团队订单处理从群聊搬进系统，先做最小闭环。", spec: SPEC },
});
if (!proto) throw new Error("prototype suite create failed");
appendDesignSuiteVersion(root, {
  suiteId: proto.id,
  content: { requirement: "小团队订单处理从群聊搬进系统，先做最小闭环。", spec: SPEC, moonviz: MOONVIZ_DOC },
  note: "品牌注入 · --pd-accent 同源 DESIGN.md",
  status: "ready",
});
appendDesignSuiteVersion(root, {
  suiteId: proto.id,
  content: {
    requirement: "小团队订单处理从群聊搬进系统，先做最小闭环。",
    spec: SPEC,
    moonviz: MOONVIZ_DOC.replace("revision: 1", "revision: 3").replace(
      'text="新建订单",fill="#4B6BFB"',
      'text="新建订单",fill="#2E9E8F"'
    ),
    verification: verificationV3,
  },
  note: "走查修复 · 验收 5/5（自愈 1）",
  status: "verified",
});
console.log("prototype suite:", proto.id);

// ── ui suite: v1 → v2 → v3 → v4 ──
const ui = createDesignSuite(root, {
  title: "轻订单管理 · UI 设计",
  kind: "ui",
  status: "draft",
  note: "初稿 · 未定向",
  content: {
    requirement: "把「轻订单管理」提升为品牌视觉稿",
    leafer: LEAFER_SCENE,
    tokens: { "brand.500": "#4f46e5", accent: "{brand.500}" },
    components: [{ name: "Button" }, { name: "Input" }, { name: "Card" }],
    sourcePrototype: { suiteId: proto.id, versionId: proto.currentVersionId },
    designSystemId: "modern-minimal",
  },
});
if (!ui) throw new Error("ui suite create failed");
appendDesignSuiteVersion(root, {
  suiteId: ui.id,
  content: {
    requirement: "把「轻订单管理」提升为品牌视觉稿",
    leafer: LEAFER_SCENE,
    tokens: { "brand.500": "#0e7c66", accent: "{brand.500}" },
    components: [{ name: "Button" }, { name: "Input" }, { name: "Card" }],
    sourcePrototype: { suiteId: proto.id, versionId: proto.currentVersionId },
    designSystemId: "modern-minimal",
  },
  note: "主题切换 · 确定性重染",
  status: "ready",
});
appendDesignSuiteVersion(root, {
  suiteId: ui.id,
  content: {
    requirement: "把「轻订单管理」提升为品牌视觉稿",
    leafer: LEAFER_SCENE,
    tokens: { "brand.500": "#0e7c66", accent: "{brand.500}" },
    components: [{ name: "Button" }, { name: "Input" }, { name: "Card" }],
    sourcePrototype: { suiteId: proto.id, versionId: proto.currentVersionId },
    designSystemId: "modern-minimal",
  },
  note: "品牌注入 · DESIGN.md tokens 同步",
  status: "ready",
});
appendDesignSuiteVersion(root, {
  suiteId: ui.id,
  content: {
    requirement: "把「轻订单管理」提升为品牌视觉稿",
    leafer: LEAFER_SCENE,
    tokens: { "brand.500": "#0e7c66", accent: "{brand.500}", "text.primary": "#1b2129", "surface.body": "#f7f9fc" },
    components: [{ name: "Button" }, { name: "Input" }, { name: "Card" }, { name: "Tabs" }],
    sourcePrototype: { suiteId: proto.id, versionId: proto.currentVersionId },
    designSystemId: "modern-minimal",
    quality: uiQualityV4,
  },
  note: "lint 清零 · 机检全绿 · review R2 8.4",
  status: "verified",
});
console.log("ui suite:", ui.id);
