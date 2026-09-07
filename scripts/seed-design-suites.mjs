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

const OPENUI = `root = Screen("轻订单管理")
root.addChild(nav = SideNav("轻订单"))
nav.addItem("orders", "订单")
nav.addItem("settings", "设置")
root.addChild(page = Page("orders"))
page.addChild(kpis = KpiRow())
kpis.addChild(kpi1 = KpiCard("今日订单", "128", "+12%"))
kpis.addChild(kpi2 = KpiCard("履约率", "96.4%", "+1.2%"))
kpis.addChild(kpi3 = KpiCard("退款中", "3", "-2"))
page.addChild(table = DataTable("订单列表", rows = 12))
table.addColumn("单号"); table.addColumn("客户"); table.addColumn("金额"); table.addColumn("状态")
page.addChild(refreshBtn = Button("刷新", action = "data:refresh"))
login = Page("login")
login.addChild(email = Input("邮箱"))
login.addChild(password = Input("密码", secret = true))
login.addChild(remember = Checkbox("记住我"))
login.addChild(submit = Button("登录", action = "auth:submit"))
login.addChild(reset = Button("重置表单", action = "form:reset"))
root.addChild(login)
`;

const OPENUI_V2 = OPENUI + "\n// v2: brand accent aligned to DESIGN.md (sea-green)\n";

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

const DESIGN_OPENUI = `root = Screen("轻订单管理 · UI 设计稿")
section hero {
  heading = Text("轻订单 · 小团队订单处理", size="h1", data-sem="hero-title")
  sub = Text("从群聊搬进系统 —— 登录、对账、履约一屏完成。", data-sem="hero-sub")
}
section login {
  title = Text("登录", size="h2", data-sem="login-title")
  email = Input(placeholder="邮箱", data-sem="login-email")
  password = Input(placeholder="密码", type="password", data-sem="login-password")
  submit = Button("登录", action="auth:submit", data-sem="login-submit")
}
section orders {
  title = Text("订单列表", size="h2", data-sem="orders-title")
  kpi = Row(data-sem="orders-kpi") { Text("今日订单 12") Text("履约率 96%") Text("退款中 1") }
  refresh = Button("刷新", action="orders:refresh", data-sem="orders-refresh")
}
`;

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
  content: { requirement: "小团队订单处理从群聊搬进系统，先做最小闭环。", spec: SPEC, openui: OPENUI_V2 },
  note: "品牌注入 · --pd-accent 同源 DESIGN.md",
  status: "ready",
});
appendDesignSuiteVersion(root, {
  suiteId: proto.id,
  content: {
    requirement: "小团队订单处理从群聊搬进系统，先做最小闭环。",
    spec: SPEC,
    openui: OPENUI,
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
    openui: DESIGN_OPENUI,
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
    openui: DESIGN_OPENUI,
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
    openui: DESIGN_OPENUI,
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
    openui: DESIGN_OPENUI,
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
