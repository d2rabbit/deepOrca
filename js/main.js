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
      "DeepOrca 是一个 AI 驱动的创作 Studio。<strong>原型设计</strong>、<strong>UI 设计稿</strong>、<strong>智能编码</strong>三大能力独立可用，按需组合 —— 从一句想法到可用成果，一站落地。",
    "hero.cta1": "⤓ 下载 Studio",
    "hero.cta2": "GitHub →",
    "hero.t1": "帮我搭一个看板管理原型",
    "hero.t2": "● 分析需求 · 生成原型中…",
    "hero.t3": "● 正在编辑文件并验证…",
    "hero.t4": "✓ 原型已生成，预览就绪",

    "tick.0": "原型设计",
    "tick.1": "UI 设计稿",
    "tick.2": "智能编码",
    "tick.3": "代码审查",
    "tick.4": "项目知识库",
    "tick.5": "长期记忆",
    "tick.6": "多语言界面",
    "tick.7": "主题随心",
    "tick.8": "本地优先",
    "tick.9": "持续进化",

    "pillars.tag": "// 三大核心能力",
    "pillars.title": "独立可用 · 按需组合",
    "pillars.sub": "从一句话需求到可交互原型、可交付设计稿、可运行代码 —— 每条管线都由同一个 Agent 引擎驱动。",
    "pillars.p1t": "原型设计",
    "pillars.p1d": "用自然语言描述需求，AI 生成可交互原型：表单、看板、多页面导航，双向交互验证用户流程。",
    "pillars.p1a": "可交互验证",
    "pillars.p1b": "多页面导航",
    "pillars.p1g": "多套模板",
    "pillars.p1p": "“帮我搭一个看板管理原型”",
    "pillars.p2t": "UI 设计稿",
    "pillars.p2d": "生成自包含设计稿，多种设计系统与 UI 风格随心切换，可脱离宿主独立交付。",
    "pillars.p2a": "自包含交付",
    "pillars.p2b": "多设计系统",
    "pillars.p2g": "多风格",
    "pillars.p2p": "“出一个玻璃拟态的落地页设计稿”",
    "pillars.p3t": "智能编码",
    "pillars.p3d": "会话式编码：内置丰富工具、开放扩展生态，专业编辑器与版本管理深度集成。",
    "pillars.p3a": "会话式",
    "pillars.p3b": "开放扩展",
    "pillars.p3c": "版本管理",
    "pillars.p3p": "“把这个模块重构成依赖注入”",

    "modules.tag": "// 核心模块",
    "modules.title": "完整的创作工作台",
    "modules.sub": "从会话、编辑到索引、审查、记忆，一应俱全。",
    "mod.1t": "AI 会话工作台",
    "mod.1d": "流式会话循环 + 工具调用 + 上下文压缩，跨会话持久化与恢复。",
    "mod.2t": "专业编辑器",
    "mod.2d": "流畅的编辑体验，内联差异对比，AI 变更一键接受或拒绝。",
    "mod.3t": "Git 源码管理",
    "mod.3d": "内置源码管理面板，变更审阅、提交、分支一目了然。",
    "mod.4t": "项目索引与 Wiki",
    "mod.4d": "符号、文档、架构三个视角，一键读懂整个项目。",
    "mod.5t": "仓库知识库",
    "mod.5d": "任意 GitHub 仓库都能变成可问答的知识库，本地检索，快速又私密。",
    "mod.6t": "本地智能层",
    "mod.6d": "本地向量嵌入与长期记忆，越用越懂你的项目，数据不出本机。",
    "mod.7t": "多主题系统",
    "mod.7d": "Orca 深色 / Aqua 原生 / Glass Prism 玻璃拟态 / Punk 2077 赛博朋克。",
    "mod.8t": "多语言界面",
    "mod.8d": "简/繁中文、English、日本語、한국어、香港繁体 —— 6 种界面语言。",

    "extend.tag": "// 扩展生态",
    "extend.title": "随时给虎鲸换上新装备",
    "extend.sub": "技能、开放协议、自动化 —— 三层扩展体系，能力边界由你决定。",
    "extend.act": "⚡ Actions：能力一次定义，多处调用",
    "extend.actd":
      "一次定义的能力，在 AI 会话、桌面界面和自动化工作流中都能直接调用 —— 内置代码审查、知识索引、系统诊断，开箱即用。",
    "extend.flow1": "一次定义",
    "extend.flow2": "AI 会话",
    "extend.flow3": "桌面界面",
    "extend.flow4": "自动化工作流",
    "extend.e1t": "技能扩展",
    "extend.e1d": "一项技能即是一种新能力，安装后 AI 会在合适的场景自动调用，越用越聪明。",
    "extend.e1s": "百余项内置技能，持续生长",
    "extend.e2t": "开放协议互联",
    "extend.e2d": "基于开放标准协议，接入任意兼容的工具、服务与数据源。",
    "extend.e2s": "常用服务内置就绪",
    "extend.e3t": "内置插件",
    "extend.e3d": "代码索引、安全扫描、浏览器自动化等能力全部内置，开箱即用。",
    "extend.e3s": "安装即用，无需配置环境",

    "gallery.tag": "// 界面预览",
    "gallery.title": "工作区 · 会话 · 源码管理",
    "gallery.sub": "Orca 深色主题实拍 —— 点击查看大图。",
    "gal.welcome": "欢迎页 · 快速开始",
    "gal.chat": "AI 会话 · 权限授权",
    "gal.plan": "计划模式 · 先规划再实现",
    "gal.code": "专业编辑器 · AI 变更",
    "gal.diff": "差异对比 · 变更审阅",
    "gal.review": "代码评审 · 风险分级",
    "gal.question": "交互提问 · 结构化输入",
    "gal.palette": "命令面板",
    "gal.extensions": "扩展中心 · 技能与服务",
    "gal.preview": "实时预览 · 原型即所得",
    "gal.settings": "设置 · 模型与主题",

    "roadmap.tag": "// 发展路线图",
    "roadmap.title": "正在发生的下一步",
    "roadmap.sub": "路线图可能包含尚未交付的目标能力，以仓库当前实现为准。",
    "road.1t": "Actions 能力面扩展",
    "road.1d": "接入更多外部服务，支持参数表单与更细粒度权限。",
    "road.2t": "远程插件中心",
    "road.2d": "在线插件市场，一键安装与更新社区技能和扩展服务。",
    "road.3t": "自定义 CLI 与指令",
    "road.3d": "注册你自己的快捷指令与命令，常用操作一键完成。",
    "road.4t": "项目图谱与沉浸式 Wiki",
    "road.4d": "代码知识图谱可视化 + 项目级知识沉淀。",
    "road.5t": "需求具现化工作台",
    "road.5d": "需求分析 → 智能分配管线 → 原型生成 → 持久化工作台。",
    "road.plan": "🔨 规划中",
    "road.design": "📐 设计中",

    "dom.title": "功能域全景",
    "dom.sub": "18 个功能域 —— 已集成 / 部分集成 / 规划中",
    "dom.ship": "已集成",
    "dom.partial": "部分集成",
    "dom.plan": "规划中",
    "dom.1t": "代码智能",
    "dom.1d": "语义级代码检索、风险分析与重构",
    "dom.2t": "知识中心",
    "dom.2d": "项目 Wiki · 长期记忆 · 行为记忆",
    "dom.3t": "移动开发",
    "dom.3d": "Flutter · Android · HarmonyOS · RN",
    "dom.4t": "桌面开发",
    "dom.4d": "Apple · Qt/KDE · Tauri · deepin",
    "dom.5t": ".NET 开发",
    "dom.5d": "覆盖 C#、Web、云原生等 12 个领域",
    "dom.6t": "设计生成",
    "dom.6d": "设计稿 · 交互原型 · 视觉特效",
    "dom.7t": "办公套件",
    "dom.7d": "演示文稿 · 文档与表格生成",
    "dom.8t": "浏览器与联网",
    "dom.8d": "浏览器自动化 · 联网搜索",
    "dom.9t": "桌面自动化",
    "dom.9d": "桌面软件操控 · 模拟器交互",
    "dom.10t": "引擎演进",
    "dom.10d": "计划模式 · 长程任务 · 交互升级",
    "dom.11t": "自进化",
    "dom.11d": "技能生成 · 质量评估 · 自我改进",
    "dom.12t": "插件中心",
    "dom.12d": "统一插件管理 · 安装安全扫描",
    "dom.13t": "远程接入",
    "dom.13d": "手机与远程浏览器随时接入",
    "dom.14t": "语音双工",
    "dom.14d": "语音输入替代键盘，本地优先",
    "dom.15t": "统一模型网关",
    "dom.15d": "多模型提供商统一接入",
    "dom.16t": "能力编排协议",
    "dom.16d": "能力一次定义，多处调用",
    "dom.17t": "密钥保险库",
    "dom.17d": "凭证加密存储，按需安全注入",
    "dom.18t": "3D 与制造",
    "dom.18d": "CAD 模型生成 · 3D 交互预览",

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
      "DeepOrca is an AI-driven creation studio. <strong>Prototyping</strong>, <strong>UI design</strong> and <strong>agentic coding</strong> work independently and compose on demand — from a single idea to a usable result, all in one place.",
    "hero.cta1": "⤓ Download Studio",
    "hero.cta2": "GitHub →",
    "hero.t1": "Build me a kanban board prototype",
    "hero.t2": "● Analyzing · generating prototype…",
    "hero.t3": "● Editing files and verifying…",
    "hero.t4": "✓ Prototype ready — preview available",

    "tick.0": "Prototyping",
    "tick.1": "UI Design",
    "tick.2": "Agentic Coding",
    "tick.3": "Code Review",
    "tick.4": "Project Knowledge",
    "tick.5": "Long-term Memory",
    "tick.6": "Multilingual UI",
    "tick.7": "Themes",
    "tick.8": "Local-first",
    "tick.9": "Always Evolving",

    "pillars.tag": "// Three Core Capabilities",
    "pillars.title": "Independent · Composable",
    "pillars.sub":
      "From a one-line brief to an interactive prototype, a deliverable design doc, and runnable code — every pipeline is driven by the same agent engine.",
    "pillars.p1t": "Prototyping",
    "pillars.p1d":
      "Describe your need in natural language and AI generates interactive prototypes: forms, kanban boards, multi-page navigation — validate user flows both ways.",
    "pillars.p1a": "Interactive validation",
    "pillars.p1b": "Multi-page flows",
    "pillars.p1g": "Ready templates",
    "pillars.p1p": "“Build me a kanban board prototype”",
    "pillars.p2t": "UI Design",
    "pillars.p2d":
      "Generate self-contained design docs with multiple design systems and UI styles to choose from — deliverable without the host app.",
    "pillars.p2a": "Self-contained delivery",
    "pillars.p2b": "Multiple design systems",
    "pillars.p2g": "Style variety",
    "pillars.p2p": "“Draft a glassmorphism landing page”",
    "pillars.p3t": "Agentic Coding",
    "pillars.p3d":
      "Conversational coding with a rich built-in toolset and an open extension ecosystem, plus a professional editor and version control built in.",
    "pillars.p3a": "Conversational",
    "pillars.p3b": "Open extensions",
    "pillars.p3c": "Version control",
    "pillars.p3p": "“Refactor this module to dependency injection”",

    "modules.tag": "// Core Modules",
    "modules.title": "A Complete Creation Workbench",
    "modules.sub": "Sessions, editing, indexing, review and memory — all included.",
    "mod.1t": "AI Session Workbench",
    "mod.1d": "Streaming session loop + tool calls + context compaction, with cross-session persistence and resume.",
    "mod.2t": "Professional Editor",
    "mod.2d": "A fluid editing experience with inline diffs — accept or reject AI changes in one click.",
    "mod.3t": "Git Source Control",
    "mod.3d": "Built-in SCM panel — review changes, commit and branch at a glance.",
    "mod.4t": "Project Index & Wiki",
    "mod.4d": "Understand any project from three angles — symbols, docs and architecture — built in one click.",
    "mod.5t": "Repo Knowledge Base",
    "mod.5d": "Turn any GitHub repo into a question-answering knowledge base — local, fast and private.",
    "mod.6t": "Local Intelligence",
    "mod.6d": "Local embeddings and long-term memory that understand your project better over time — your data never leaves the machine.",
    "mod.7t": "Theme System",
    "mod.7d": "Orca Dark / Aqua Native / Glass Prism / Punk 2077.",
    "mod.8t": "Multilingual UI",
    "mod.8d": "Simplified/Traditional Chinese, English, Japanese, Korean — 6 UI languages.",

    "extend.tag": "// Ecosystem",
    "extend.title": "Gear Up Your Orca",
    "extend.sub": "Skills, open protocols and automation — a three-layer extension system where you define the boundary.",
    "extend.act": "⚡ Actions: Define Once, Surface Everywhere",
    "extend.actd":
      "A capability defined once is callable from the AI chat, the desktop UI and automated workflows — code review, knowledge indexing and diagnostics included out of the box.",
    "extend.flow1": "Define once",
    "extend.flow2": "AI chat",
    "extend.flow3": "Desktop UI",
    "extend.flow4": "Automated workflows",
    "extend.e1t": "Skill Extensions",
    "extend.e1d": "One skill is one new capability — once installed, the AI invokes it automatically in the right situations, getting smarter over time.",
    "extend.e1s": "100+ built-in skills, ever-growing",
    "extend.e2t": "Open Protocol Integration",
    "extend.e2d": "Built on open standard protocols — connect any compatible tool, service or data source.",
    "extend.e2s": "Common services ready out of the box",
    "extend.e3t": "Bundled Plugins",
    "extend.e3d": "Code indexing, security scanning, browser automation and more — all built in and ready to use.",
    "extend.e3s": "Ready to use, zero setup",

    "gallery.tag": "// Screenshots",
    "gallery.title": "Workspace · Sessions · Source Control",
    "gallery.sub": "Shot in the Orca dark theme — click to enlarge.",
    "gal.welcome": "Welcome · Quick start",
    "gal.chat": "AI Chat · Permission grant",
    "gal.plan": "Plan Mode · Plan first",
    "gal.code": "Editor · AI changes",
    "gal.diff": "Diff · Change review",
    "gal.review": "Code Review · Severity-ranked",
    "gal.question": "Agent Questions · Structured input",
    "gal.palette": "Command Palette",
    "gal.extensions": "Extensions · Skills & services",
    "gal.preview": "Live Preview · WYSIWYG prototype",
    "gal.settings": "Settings · Models & themes",

    "roadmap.tag": "// Roadmap",
    "roadmap.title": "What's Happening Next",
    "roadmap.sub": "The roadmap may describe capabilities not yet shipped — the repo is the source of truth.",
    "road.1t": "Actions Surface Expansion",
    "road.1d": "Connect more external services, with parameter forms and finer-grained permissions.",
    "road.2t": "Remote Plugin Hub",
    "road.2d": "An online marketplace for one-click install and update of community skills and extension services.",
    "road.3t": "Custom CLI & Commands",
    "road.3d": "Register your own shortcuts and commands to one-click your frequent actions.",
    "road.4t": "Project Graph & Immersive Wiki",
    "road.4d": "Code knowledge-graph visualization + project-level knowledge retention.",
    "road.5t": "Requirement Materialization Workbench",
    "road.5d": "Requirement analysis → smart pipeline routing → prototype generation → persistent workbench.",
    "road.plan": "🔨 Planned",
    "road.design": "📐 Designing",

    "dom.title": "Capability Domains",
    "dom.sub": "18 domains — shipped / partially shipped / planned",
    "dom.ship": "Shipped",
    "dom.partial": "Partial",
    "dom.plan": "Planned",
    "dom.1t": "Code Intelligence",
    "dom.1d": "Semantic code search, risk analysis & refactoring",
    "dom.2t": "Knowledge Hub",
    "dom.2d": "Project wiki · long-term memory · behavior memory",
    "dom.3t": "Mobile Dev",
    "dom.3d": "Flutter · Android · HarmonyOS · RN",
    "dom.4t": "Desktop Dev",
    "dom.4d": "Apple · Qt/KDE · Tauri · deepin",
    "dom.5t": ".NET Dev",
    "dom.5d": "12 areas covering C#, web, cloud-native and more",
    "dom.6t": "Design Generation",
    "dom.6d": "Design docs · interactive prototypes · visual effects",
    "dom.7t": "Office Suite",
    "dom.7d": "Slides · doc & sheet generation",
    "dom.8t": "Browser & Web",
    "dom.8d": "Browser automation · web search",
    "dom.9t": "Desktop Automation",
    "dom.9d": "Desktop app control · emulator interaction",
    "dom.10t": "Engine Evolution",
    "dom.10d": "Plan mode · long-horizon tasks · interaction upgrades",
    "dom.11t": "Self-Evolution",
    "dom.11d": "Skill authoring · quality evaluation · self-improvement",
    "dom.12t": "Plugin Hub",
    "dom.12d": "Unified plugin management · install security scanning",
    "dom.13t": "Remote Access",
    "dom.13d": "Access from phones and remote browsers",
    "dom.14t": "Voice Duplex",
    "dom.14d": "Voice input instead of typing, local-first",
    "dom.15t": "Unified Model Gateway",
    "dom.15d": "Unified access to multiple model providers",
    "dom.16t": "Capability Orchestration",
    "dom.16d": "Define capabilities once, use everywhere",
    "dom.17t": "Secret Vault",
    "dom.17d": "Credentials encrypted at rest, injected on demand",
    "dom.18t": "3D & Manufacturing",
    "dom.18d": "CAD model generation · interactive 3D preview",

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
