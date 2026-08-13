/* global document, window, localStorage, IntersectionObserver, requestAnimationFrame, console */
// DeepOrca GitHub Pages — dual theme + zh/en i18n + interactions

// ============================================================
// i18n dictionary
// ============================================================

const I18N = {
  zh: {
    "nav.pillars": "能力",
    "nav.modules": "核心模块",
    "nav.extend": "扩展生态",
    "nav.gallery": "界面预览",
    "nav.roadmap": "路线图",
    "nav.boot": "快速开始",
    "nav.cta": "开始创作",

    "hero.badge": "v0.1.34 · AI 创作 Studio",
    "hero.title": '原型 · 设计 · 编码<br><span class="gtext">AI 创作 Studio</span>',
    "hero.desc":
      "DeepOrca 是一个 AI 驱动的创作 Studio。<strong>原型设计</strong>、<strong>UI 设计稿</strong>、<strong>智能编码</strong>三大能力独立可用，按需组合 —— 专为 DeepSeek 模型优化，以 Electron 桌面客户端呈现。",
    "hero.cta1": "⤓ 下载 Studio",
    "hero.cta2": "GitHub →",
    "hero.s1": "原型模板",
    "hero.s2": "设计系统 · UI 风格",
    "hero.s3": "内置 Skills",
    "hero.s4": "MCP 服务器",
    "hero.t1": "帮我搭一个看板管理原型",
    "hero.t2": "● 分析需求 · 路由到原型管线…",
    "hero.t3": "● 使用 4 个工具 read×2 edit×1 bash×1",
    "hero.t4": "✓ 原型已生成 — A2UI Surface 渲染完成",

    "tick.0": "原型设计",
    "tick.1": "UI 设计稿",
    "tick.2": "智能编码",
    "tick.9": "语义路由",

    "pillars.tag": "// 三大核心能力",
    "pillars.title": "独立可用 · 按需组合",
    "pillars.sub": "从一句话需求到可交互原型、可交付设计稿、可运行代码 —— 每条管线都由同一个 Agent 引擎驱动。",
    "pillars.p1t": "原型设计",
    "pillars.p1d": "用自然语言描述需求，AI 生成可交互原型：表单、看板、多页面导航，双向交互验证用户流程。",
    "pillars.p1g": "7 个模板",
    "pillars.p1p": "“帮我搭一个看板管理原型”",
    "pillars.p2t": "UI 设计稿",
    "pillars.p2d": "生成自包含 HTML 设计稿，3 种设计系统、14 种 UI 风格、本地内置 Tailwind JIT，可脱离宿主独立交付。",
    "pillars.p2g": "14 种风格",
    "pillars.p2p": "“出一个玻璃拟态的落地页设计稿”",
    "pillars.p3t": "智能编码",
    "pillars.p3d": "DeepSeek 驱动的会话式编码：7 个内置工具、MCP 协议无限扩展、Monaco 编辑器与 Git 集成。",
    "pillars.p3p": "“把这个模块重构成依赖注入”",

    "modules.tag": "// 核心模块",
    "modules.title": "不止是聊天窗口",
    "modules.sub": "编辑器、源码管理、索引、审查、记忆 —— 一个完整的创作工作台。",
    "mod.1t": "AI 会话工作台",
    "mod.1d": "流式会话循环 + 工具调用 + 上下文压缩，跨会话持久化与恢复。",
    "mod.2t": "Monaco 编辑器",
    "mod.2d": "VS Code 同源编辑器，内联 diff、Agent 变更接受/拒绝。",
    "mod.3t": "Git 源码管理",
    "mod.3d": "内置源码管理面板，变更审阅、提交、分支一目了然。",
    "mod.4t": "工作区索引三件套",
    "mod.4d": "CodeGraph 符号级 · OpenWiki 文档级 · arch-scan 架构级，一键构建。",
    "mod.5t": "GitMCP 知识源",
    "mod.5d": "SQLite FTS5 + BM25 本地检索，任意 GitHub 仓库变身 MCP 知识源。",
    "mod.6t": "本地智能层",
    "mod.6d": "Granite 本地向量嵌入 + L0–L3 记忆流水线 + 语义路由，全程 fail-open。",
    "mod.7t": "多主题系统",
    "mod.7d": "Orca 深色 / Aqua 原生 / Glass Prism 玻璃拟态 / Punk 2077 赛博朋克。",
    "mod.8t": "多语言界面",
    "mod.8d": "简/繁中文、English、日本語、한국어、香港繁体 —— 6 种界面语言。",

    "extend.tag": "// 扩展生态",
    "extend.title": "随时给虎鲸换上新装备",
    "extend.sub": "Skills、MCP、Actions —— 三层扩展体系，能力边界由你决定。",
    "extend.act": "⚡ Actions：能力一次定义，多处调用",
    "extend.actd":
      "单个 defineAction 定义自动成为 LLM 工具、桌面 IPC/UI 与组合工作流 —— 内置代码审查、知识索引、系统诊断等 Actions 开箱即用。",
    "extend.flow4": "组合工作流",
    "extend.e1t": "Skills 技能",
    "extend.e1d": "一个 SKILL.md 即是一项能力。语义路由自动召回相关技能，越用越聪明。",
    "extend.e1s": "183 个内置技能",
    "extend.e2t": "MCP 服务器",
    "extend.e2d": "基于官方 @modelcontextprotocol/sdk，接入任意 MCP 生态工具与数据源。",
    "extend.e2s": "10 个内置服务器",
    "extend.e3t": "内置插件",
    "extend.e3d": "CodeGraph、Serena、SkillSpector 安全扫描、browser-skill 浏览器自动化等 vendored 开箱即用。",
    "extend.e3s": "零外部运行时依赖",

    "gallery.tag": "// 界面预览",
    "gallery.title": "工作区 · 会话 · 源码管理",
    "gallery.sub": "Orca 深色主题实拍 —— 点击查看大图。",
    "gal.welcome": "欢迎页 · 快速开始",
    "gal.chat": "AI 会话 · 权限授权",
    "gal.plan": "计划模式 · 先规划再实现",
    "gal.code": "Monaco 编辑器 · Agent 变更",
    "gal.diff": "差异对比 · 变更审阅",
    "gal.review": "代码评审 · 风险分级",
    "gal.question": "交互提问 · 结构化输入",
    "gal.palette": "命令面板",
    "gal.extensions": "扩展中心 · Skills / MCP",
    "gal.preview": "实时预览 · 原型即所得",
    "gal.settings": "设置 · 模型与主题",

    "roadmap.tag": "// 发展路线图",
    "roadmap.title": "正在发生的下一步",
    "roadmap.sub":
      "与 docs/features/feature-roadmap.md（v3.17）同步；路线图可能包含尚未交付的目标能力，以仓库当前实现为准。",
    "road.1t": "Actions 能力面扩展",
    "road.1d": "外部 MCP、HTTP/CLI、参数表单与更细粒度权限。",
    "road.2t": "远程插件中心",
    "road.2d": "在线插件市场，一键安装/更新社区 Skills 与 MCP；兼容 Agent Plugins 1.0.0 双格式。",
    "road.3t": "自定义 CLI 与指令",
    "road.3d": "用户可注册斜杠命令和 CLI 子命令。",
    "road.4t": "项目图谱与沉浸式 Wiki",
    "road.4d": "代码知识图谱可视化 + 项目级知识沉淀。",
    "road.5t": "PM-Design V2 需求具现化",
    "road.5d": "需求分析 → 管线自动路由 → 原型生成 → 持久化工作台。",
    "road.plan": "🔨 规划中",
    "road.design": "📐 设计中",

    "dom.title": "功能域全景",
    "dom.sub": "17 个功能域 —— 已集成 / 部分集成 / 规划中",
    "dom.ship": "已集成",
    "dom.partial": "部分集成",
    "dom.plan": "规划中",
    "dom.1t": "代码智能",
    "dom.1d": "CodeGraph · CRG · Serena · arch-scan",
    "dom.2t": "知识中心",
    "dom.2d": "OpenWiki · L0–L3 记忆 · 行为记忆",
    "dom.3t": "移动开发",
    "dom.3d": "Flutter · Android · HarmonyOS · RN",
    "dom.4t": "桌面开发",
    "dom.4d": "Apple · Qt/KDE · Tauri · deepin",
    "dom.5t": ".NET 开发",
    "dom.5d": "Microsoft 官方 dotnet/skills 12 域",
    "dom.6t": "设计生成",
    "dom.6d": "DeepDesign .dd · A2UI · html-in-canvas",
    "dom.7t": "办公套件",
    "dom.7d": "Bento Slides · 文档/表格生成",
    "dom.8t": "浏览器与联网",
    "dom.8d": "browser-skill · WebSearch",
    "dom.9t": "桌面自动化",
    "dom.9d": "computer-use · sim-use 模拟器",
    "dom.10t": "引擎演进",
    "dom.10d": "Plan Mode · MCP SDK · 长程任务",
    "dom.11t": "自进化",
    "dom.11d": "skill-writer · skill-up · HarnessBank",
    "dom.12t": "插件中心",
    "dom.12d": "SkillSpector · 远程源 · Agent Plugins",
    "dom.13t": "远程接入",
    "dom.13d": "WebSocket 桥 + 反向隧道",
    "dom.14t": "语音双工",
    "dom.14d": "whisper.cpp 本地优先 + API 兜底",
    "dom.15t": "统一模型网关",
    "dom.15d": "OmniRoute · 多提供商路由",
    "dom.16t": "能力编排协议",
    "dom.16d": "defineAction · 一次定义多表面",
    "dom.17t": "密钥保险库",
    "dom.17d": "AES-256-GCM · 凭证按需注入",

    "boot.tag": "// 快速开始",
    "boot.title": "三步部署，即刻创作",
    "boot.sub": "需要 Node.js 22+ 与 npm 10.9+；Windows 上 bash 工具需要 Git Bash。",
    "boot.1t": "获取应用",
    "boot.1d": "克隆仓库并安装依赖，一条命令构建并启动桌面客户端。",
    "boot.2t": "接入模型",
    "boot.2d": "创建 ~/.deeporca/settings.json（已有 ~/.deepcode 配置会直接沿用，无需迁移）。",
    "boot.3t": "开始创作",
    "boot.3d": "描述你的需求 —— 原型、设计稿、代码，虎鲸接手剩下的工作。",

    "finale.title": '开启你的<span class="gtext">创作之旅</span>',
    "finale.sub": "原型、设计、编码 —— 让 AI 虎鲸成为你的创作伙伴。",
    "finale.cta1": "⤓ 下载 Studio",
    "finale.cta2": "Star on GitHub →",

    "foot.docs": "文档",
    "foot.note":
      'MIT License · © 2026 DeepOrca · 源自 <a href="https://github.com/lessweb/deepcode-cli" target="_blank" rel="noopener">Deep Code</a>（© 2026 lessweb，MIT）',

    "meta.title": "DeepOrca — 原型 · 设计 · 编码，AI 创作 Studio",
  },

  en: {
    "nav.pillars": "Capabilities",
    "nav.modules": "Modules",
    "nav.extend": "Ecosystem",
    "nav.gallery": "Screenshots",
    "nav.roadmap": "Roadmap",
    "nav.boot": "Quickstart",
    "nav.cta": "Start Creating",

    "hero.badge": "v0.1.34 · AI Creation Studio",
    "hero.title": 'Prototype · Design · Code<br><span class="gtext">The AI Studio</span>',
    "hero.desc":
      "DeepOrca is an AI-driven creation studio. <strong>Prototyping</strong>, <strong>UI design</strong> and <strong>agentic coding</strong> work independently and compose on demand — optimized for DeepSeek, shipped as an Electron desktop client.",
    "hero.cta1": "⤓ Download Studio",
    "hero.cta2": "GitHub →",
    "hero.s1": "Prototype templates",
    "hero.s2": "Design systems · UI styles",
    "hero.s3": "Built-in Skills",
    "hero.s4": "MCP servers",
    "hero.t1": "Build me a kanban board prototype",
    "hero.t2": "● Analyzing · routing to prototype pipeline…",
    "hero.t3": "● Used 4 tools read×2 edit×1 bash×1",
    "hero.t4": "✓ Prototype generated — A2UI surface rendered",

    "tick.0": "Prototyping",
    "tick.1": "UI Design",
    "tick.2": "Agentic Coding",
    "tick.9": "Semantic Routing",

    "pillars.tag": "// Three Core Capabilities",
    "pillars.title": "Independent · Composable",
    "pillars.sub":
      "From a one-line brief to an interactive prototype, a deliverable design doc, and runnable code — every pipeline is driven by the same agent engine.",
    "pillars.p1t": "Prototyping",
    "pillars.p1d":
      "Describe your need in natural language and AI generates interactive prototypes: forms, kanban boards, multi-page navigation — validate user flows both ways.",
    "pillars.p1g": "7 templates",
    "pillars.p1p": "“Build me a kanban board prototype”",
    "pillars.p2t": "UI Design",
    "pillars.p2d":
      "Generate self-contained HTML design docs: 3 design systems, 14 UI styles, local Tailwind JIT — deliverable without the host app.",
    "pillars.p2g": "14 styles",
    "pillars.p2p": "“Draft a glassmorphism landing page”",
    "pillars.p3t": "Agentic Coding",
    "pillars.p3d":
      "Conversational coding driven by DeepSeek: 7 built-in tools, infinite extension via MCP, Monaco editor and Git integration.",
    "pillars.p3p": "“Refactor this module to dependency injection”",

    "modules.tag": "// Core Modules",
    "modules.title": "More Than a Chat Window",
    "modules.sub": "Editor, source control, indexing, review, memory — a complete creation workbench.",
    "mod.1t": "AI Session Workbench",
    "mod.1d": "Streaming session loop + tool calls + context compaction, with cross-session persistence and resume.",
    "mod.2t": "Monaco Editor",
    "mod.2d": "The same editor as VS Code: inline diffs, accept/reject agent changes.",
    "mod.3t": "Git Source Control",
    "mod.3d": "Built-in SCM panel — review changes, commit and branch at a glance.",
    "mod.4t": "Workspace Index Trio",
    "mod.4d": "CodeGraph (symbols) · OpenWiki (docs) · arch-scan (architecture), built in one click.",
    "mod.5t": "GitMCP Knowledge",
    "mod.5d": "SQLite FTS5 + BM25 local search turns any GitHub repo into an MCP knowledge source.",
    "mod.6t": "Local Intelligence",
    "mod.6d": "Granite local embeddings + L0–L3 memory pipeline + semantic routing, fail-open throughout.",
    "mod.7t": "Theme System",
    "mod.7d": "Orca Dark / Aqua Native / Glass Prism / Punk 2077.",
    "mod.8t": "Multilingual UI",
    "mod.8d": "Simplified/Traditional Chinese, English, Japanese, Korean — 6 UI languages.",

    "extend.tag": "// Ecosystem",
    "extend.title": "Gear Up Your Orca",
    "extend.sub": "Skills, MCP and Actions — a three-layer extension system where you define the boundary.",
    "extend.act": "⚡ Actions: Define Once, Surface Everywhere",
    "extend.actd":
      "A single defineAction automatically becomes an LLM tool, desktop IPC/UI and a composable workflow — code review, knowledge indexing and diagnostics ship built in.",
    "extend.flow4": "Composed workflow",
    "extend.e1t": "Skills",
    "extend.e1d": "One SKILL.md is one capability. Semantic routing recalls relevant skills automatically.",
    "extend.e1s": "183 built-in skills",
    "extend.e2t": "MCP Servers",
    "extend.e2d": "Built on the official @modelcontextprotocol/sdk — plug into any MCP tool or data source.",
    "extend.e2s": "10 built-in servers",
    "extend.e3t": "Bundled Plugins",
    "extend.e3d": "CodeGraph, Serena, SkillSpector security scanning, browser-skill automation — vendored and ready.",
    "extend.e3s": "Zero external runtime deps",

    "gallery.tag": "// Screenshots",
    "gallery.title": "Workspace · Sessions · Source Control",
    "gallery.sub": "Shot in the Orca dark theme — click to enlarge.",
    "gal.welcome": "Welcome · Quick start",
    "gal.chat": "AI Chat · Permission grant",
    "gal.plan": "Plan Mode · Plan first",
    "gal.code": "Monaco · Agent changes",
    "gal.diff": "Diff · Change review",
    "gal.review": "Code Review · Severity-ranked",
    "gal.question": "Agent Questions · Structured input",
    "gal.palette": "Command Palette",
    "gal.extensions": "Extensions · Skills / MCP",
    "gal.preview": "Live Preview · WYSIWYG prototype",
    "gal.settings": "Settings · Models & themes",

    "roadmap.tag": "// Roadmap",
    "roadmap.title": "What's Happening Next",
    "roadmap.sub":
      "Synced with docs/features/feature-roadmap.md (v3.17). The roadmap may describe capabilities not yet shipped — the repo is the source of truth.",
    "road.1t": "Actions Surface Expansion",
    "road.1d": "External MCP, HTTP/CLI, parameter forms and finer-grained permissions.",
    "road.2t": "Remote Plugin Hub",
    "road.2d": "An online marketplace for one-click install/update of community Skills & MCP; Agent Plugins 1.0.0 dual-format compatible.",
    "road.3t": "Custom CLI & Commands",
    "road.3d": "Register your own slash commands and CLI subcommands.",
    "road.4t": "Project Graph & Immersive Wiki",
    "road.4d": "Code knowledge-graph visualization + project-level knowledge retention.",
    "road.5t": "PM-Design V2 Requirement Materialization",
    "road.5d": "Requirement analysis → pipeline auto-routing → prototype generation → persistent workbench.",
    "road.plan": "🔨 Planned",
    "road.design": "📐 Designing",

    "dom.title": "Capability Domains",
    "dom.sub": "17 domains — shipped / partially shipped / planned",
    "dom.ship": "Shipped",
    "dom.partial": "Partial",
    "dom.plan": "Planned",
    "dom.1t": "Code Intelligence",
    "dom.1d": "CodeGraph · CRG · Serena · arch-scan",
    "dom.2t": "Knowledge Hub",
    "dom.2d": "OpenWiki · L0–L3 memory · behavior memory",
    "dom.3t": "Mobile Dev",
    "dom.3d": "Flutter · Android · HarmonyOS · RN",
    "dom.4t": "Desktop Dev",
    "dom.4d": "Apple · Qt/KDE · Tauri · deepin",
    "dom.5t": ".NET Dev",
    "dom.5d": "Microsoft's official dotnet/skills, 12 areas",
    "dom.6t": "Design Generation",
    "dom.6d": "DeepDesign .dd · A2UI · html-in-canvas",
    "dom.7t": "Office Suite",
    "dom.7d": "Bento Slides · doc/sheet generation",
    "dom.8t": "Browser & Web",
    "dom.8d": "browser-skill · WebSearch",
    "dom.9t": "Desktop Automation",
    "dom.9d": "computer-use · sim-use emulators",
    "dom.10t": "Engine Evolution",
    "dom.10d": "Plan Mode · MCP SDK · long-horizon tasks",
    "dom.11t": "Self-Evolution",
    "dom.11d": "skill-writer · skill-up · HarnessBank",
    "dom.12t": "Plugin Hub",
    "dom.12d": "SkillSpector · remote sources · Agent Plugins",
    "dom.13t": "Remote Access",
    "dom.13d": "WebSocket bridge + reverse tunnel",
    "dom.14t": "Voice Duplex",
    "dom.14d": "whisper.cpp local-first + API fallback",
    "dom.15t": "Unified Model Gateway",
    "dom.15d": "OmniRoute · multi-provider routing",
    "dom.16t": "Capability Orchestration",
    "dom.16d": "defineAction · define once, surface everywhere",
    "dom.17t": "Secret Vault",
    "dom.17d": "AES-256-GCM · credentials injected on demand",

    "boot.tag": "// Quickstart",
    "boot.title": "Three Steps to Create",
    "boot.sub": "Requires Node.js 22+ and npm 10.9+. On Windows, the bash tool needs Git Bash.",
    "boot.1t": "Get the App",
    "boot.1d": "Clone the repo, install dependencies, and launch the desktop client with one command.",
    "boot.2t": "Connect a Model",
    "boot.2d": "Create ~/.deeporca/settings.json (an existing ~/.deepcode config is picked up as-is, no migration needed).",
    "boot.3t": "Start Creating",
    "boot.3d": "Describe what you need — prototype, design doc, code — the orca takes it from there.",

    "finale.title": 'Start Your <span class="gtext">Creation Journey</span>',
    "finale.sub": "Prototype, design, code — let the AI orca be your creation partner.",
    "finale.cta1": "⤓ Download Studio",
    "finale.cta2": "Star on GitHub →",

    "foot.docs": "Docs",
    "foot.note":
      'MIT License · © 2026 DeepOrca · Originated from <a href="https://github.com/lessweb/deepcode-cli" target="_blank" rel="noopener">Deep Code</a> (© 2026 lessweb, MIT)',

    "meta.title": "DeepOrca — Prototype · Design · Code, the AI Studio",
  },
};

// ============================================================
// Language
// ============================================================

let currentLang = "zh";
try {
  currentLang = localStorage.getItem("deeporca-lang") === "en" ? "en" : "zh";
} catch (e) {
  /* private mode */
}

function applyLang(lang) {
  currentLang = lang;
  const dict = I18N[lang];
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] !== undefined) el.innerHTML = dict[key];
  });
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.title = dict["meta.title"];
  const toggle = document.getElementById("lang-toggle");
  if (toggle) toggle.textContent = lang === "en" ? "中" : "EN";
  try {
    localStorage.setItem("deeporca-lang", lang);
  } catch (e) {
    /* ignore */
  }
}

const langToggle = document.getElementById("lang-toggle");
if (langToggle) {
  langToggle.addEventListener("click", () => applyLang(currentLang === "en" ? "zh" : "en"));
}
if (currentLang === "en") applyLang("en");
else {
  const toggle = document.getElementById("lang-toggle");
  if (toggle) toggle.textContent = "EN";
}

// ============================================================
// Theme
// ============================================================

const themeToggle = document.getElementById("theme-toggle");

function syncThemeIcon() {
  if (!themeToggle) return;
  themeToggle.textContent = document.documentElement.dataset.theme === "light" ? "🌙" : "☀️";
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("deeporca-theme", next);
    } catch (e) {
      /* ignore */
    }
    syncThemeIcon();
  });
}
syncThemeIcon();

// ============================================================
// Navbar scroll state
// ============================================================

const nav = document.getElementById("nav");
let lastScrollY = window.scrollY;
let ticking = false;

function updateNav() {
  const y = window.scrollY;
  if (nav) {
    nav.classList.toggle("scrolled", y > 20);
    if (y > 120 && y > lastScrollY) nav.classList.add("hidden");
    else nav.classList.remove("hidden");
  }
  lastScrollY = y;
  ticking = false;
}

window.addEventListener(
  "scroll",
  () => {
    if (!ticking) {
      requestAnimationFrame(updateNav);
      ticking = true;
    }
  },
  { passive: true }
);

// ============================================================
// Reveal on scroll
// ============================================================

const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const groups = new Map();
  revealEls.forEach((el) => {
    const parent = el.parentElement;
    if (!groups.has(parent)) groups.set(parent, 0);
    const idx = groups.get(parent);
    el.style.setProperty("--reveal-delay", `${Math.min(idx * 0.08, 0.4)}s`);
    groups.set(parent, idx + 1);
  });
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("visible"));
}

// ============================================================
// Smooth anchor scrolling (with nav offset)
// ============================================================

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const id = link.getAttribute("href");
    if (!id || id === "#") return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 20;
    window.scrollTo({ top, behavior: "smooth" });
  });
});

// ============================================================
// Lightbox
// ============================================================

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCap = document.getElementById("lightbox-cap");

document.querySelectorAll(".shot").forEach((shot) => {
  shot.addEventListener("click", () => {
    const img = shot.querySelector("img");
    const cap = shot.querySelector(".cap");
    if (!img || !lightbox || !lightboxImg) return;
    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    if (lightboxCap && cap) lightboxCap.textContent = cap.textContent;
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  });
});

function closeLightbox() {
  if (!lightbox) return;
  lightbox.classList.remove("open");
  document.body.style.overflow = "";
}

if (lightbox) {
  lightbox.addEventListener("click", closeLightbox);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}

// ============================================================
// Card hover tilt
// ============================================================

document.querySelectorAll(".pillar-card, .mod-card, .ext-card, .road-card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(1000px) rotateY(${x * 3}deg) rotateX(${-y * 3}deg) translateY(-4px)`;
  });
  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
  });
});

// ============================================================
// Button ripple
// ============================================================

document.querySelectorAll(".cbtn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const size = 80;
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
});

console.log("%c🐋 DeepOrca %c| AI 创作 Studio · 原型 · 设计 · 编码", "font-weight:bold;font-size:14px", "color:#00c4d6");
