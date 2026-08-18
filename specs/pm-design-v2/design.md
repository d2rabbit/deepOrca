# PM-Design V2：需求具现化工作台

> **状态**：**部分实现（2026-08-18 终判回写）**——已实现：design-store 持久化（两管线 + 版本快照 FIFO 20 版）+ design.materialize Action + DesignPanel（一键具现化）+ P3 预览迭代闭环（PrototypePanel/DesignPreview composer → update_openui/update_design/update_surface + 预览联动 + 渲染错误纠正回路）。未做：版本切换 UI（快照在磁盘）、P4 独立导出（仅 iframe 打印 PDF；独立 HTML 导出可做、React 代码导出不做——2026-08-18 评估）；明确偏差：管线集合为 2（A2UI 交互层按三层定位排除）、pm-analyst/analysis.json 显式缓期。任务明细见 tasks.md（已回写）。
> **日期**：2026-08-11
> **前置**：[A2UI 集成](../a2ui-integration/design.md) · [DeepDesign .dd 格式](../deep-design/design.md)
> **受众**：产品经理（PM）—— 不需要懂代码，用自然语言驱动从需求到原型的全流程

---

## §1 现状诊断 —— 三管线割裂

当前 DeepOrca 的"设计生成"域是**三条独立管线**，共享一个右侧响应式预览面板，但各自有独立的载体格式、MCP 工具、渲染器和 slash 命令触发方式：

| 管线 | 载体格式 | MCP 工具（均在 `a2ui` in-process server） | 渲染器 | 触发命令 |
| --- | --- | --- | --- | --- |
| **A2UI** | Surface JSON（邻接表组件树 + dataModel） | `render_surface` / `render_prototype` / `update_surface` / `a2ui_action` | `a2ui/A2uiSurface.tsx`（自研） | `/pm-design` · `/prototype` |
| **OpenUI Lang** | OpenUI Lang 代码（紧凑行式语法） | `render_openui` / `update_openui` | `openui/OpenuiRenderer.tsx`（SDK Renderer） | `/pm-design-openui` · `/openui` |
| **DeepDesign** | `.dd` 文档（YAML front-matter + HTML body） | `render_design` / `update_design` | `components/DesignPreview.tsx`（iframe） | `/deep-design` · `/design` |

三条管线技术上已完整可用（7 个 A2UI 模板 + 11 个 OpenUI 组件 + 3 个 .dd 设计系统 + Tailwind 本地内置），但从**产品经理视角**看存在五个痛点：

### 痛点 1：三选一认知负担

PM 不知道该用 `/pm-design` 还是 `/deep-design` 还是 `/pm-design-openui`。三者区别（交互 vs 展示、JSON vs 代码 vs HTML、可脱离宿主 vs 依赖运行时）对非技术用户是不可见的实现细节，不应暴露为选择负担。

### 痛点 2：无左侧工作区

设计模块**仅作为右侧响应式预览**（由 `usePreview()` 在工具结果到达时自动打开），没有左侧导航入口。对比 Index Library（`index`）、Code Review（`review`）、GitMCP（`gitmcp`）、Editor（`editor`）都有独立的 `SidebarView` 和左侧面板——设计是唯一一个"有完整能力但无工作区"的模块。

用户无法：
- 查看历史设计产物列表
- 管理多个并行设计
- 从左侧一键发起设计（必须记住 slash 命令）

### 痛点 3：缺少需求分析前置

当前流程是 **需求 → 直接跳到原型生成**，跳过了 PM 职责链中最关键的**需求拆解**环节：
- 功能模块划分
- 用户故事（User Story）提炼
- 核心交互流程识别
- 优先级排序

这意味着 AI 生成的原型缺少结构化思考的前置，容易"想到哪画到哪"，产出的原型缺少全局视角。

### 痛点 4：设计产物不持久

- A2UI 有 surface 持久化（`.deeporca/prototypes/<surfaceId>.json`），但仅在会话恢复时使用，无项目管理视角
- OpenUI Lang 和 DeepDesign **完全没有持久化** —— 关闭会话即丢失
- 三条管线没有统一的"设计资产"索引

### 痛点 5：无一键入口

PM 需要记住三个 slash 命令，且没有"描述需求 → 自动出原型"的一站式入口。对比 Code Review 的 `review.full` 一键审查、Index Library 的 `index.build-all` 一键建索引——设计模块缺少同等级别的复合 Action。

---

## §2 核心理念：需求具现化（Requirement Materialization）

PM-Design V2 从"原型生成器"升级为**"需求具现化工作台"**。

### 什么是"需求具现化"

模拟产品经理的完整职责链，将抽象需求逐步"具现化"为可交互的原型：

```
需求采集 → 需求分析 → 管线路由 → 原型生成 → 预览验证 → 迭代 → 持久化/交付
  ↑                                                              │
  └──────────── 对话反馈闭环 ←────────────────────────────────────┘
```

### 设计哲学

> **不是让用户选工具，而是让 AI 理解需求后自动选择最佳表达载体。**

PM 只需描述"我要做什么"，AI 负责：
1. 拆解需求结构（功能模块 + 用户故事 + 交互流程）
2. 判断最佳原型载体（A2UI 交互型 / DeepDesign 展示型 / OpenUI 混合型）
3. 生成初始原型
4. 打开预览供验证
5. 持续对话迭代
6. 持久化为可管理的"设计资产"

三条管线从"用户三选一"变为"AI 自动路由"——管线选择从用户认知负担变为 AI 的结构化决策。

---

## §3 V2 架构：统一设计工作台

### 整体布局

```
┌─ Left Rail ──┐  ┌─ DesignPanel (新左侧工作区) ──────┐  ┌─ Chat ─┐  ┌─ Preview ─┐
│  Explorer    │  │ ┌──────────────────────────────┐ │  │        │  │           │
│  SCM         │  │ │  🎯 一键需求具现化             │ │  │        │  │  [原型    │
│  Index       │  │ │  design.materialize          │ │  │        │  │   预览]   │
│  Review      │  │ └──────────────────────────────┘ │  │        │  │           │
│► Design ◄新增│  │ 设计产物 (Artifacts)              │  │        │  │  A2UI /   │
│  GitMCP      │  │ ┌──────┐ ┌──────┐ ┌──────┐      │  │        │  │  OpenUI / │
│  Editor      │  │ │ 📐.dd│ │🔧A2UI│ │📝Open│      │  │        │  │  .dd      │
│              │  │ │登录页│ │看板  │ │表单  │      │  │        │  │           │
│              │  │ └──────┘ └──────┘ └──────┘      │  │        │  │           │
│              │  │ (按 updatedAt 排序)               │  │        │  │           │
│              │  └──────────────────────────────────┘  │        │  │           │
└──────────────┘                                        └────────┘  └───────────┘
```

### 三层分工

| 层 | 职责 | 复用/新增 |
| --- | --- | --- |
| **左侧工作区层**（DesignPanel） | 设计资产管理 + 一键入口 + 产物列表 | **新增** |
| **编排层**（design.materialize） | 需求分析 → 管线路由 → 原型生成 → 持久化 | **新增**（复合 Action） |
| **管线层**（A2UI / OpenUI / DeepDesign） | 具体的原型生成与渲染 | **完全复用**，零改动 |

### 核心设计原则

1. **编排层不重新实现管线** —— `design.materialize` 是纯编排，调用现有 MCP 工具
2. **右侧预览保持不变** —— 仍由 `usePreview()` 响应式驱动，PrototypePanel / DesignPreview 不改
3. **左侧是增量** —— 新增 DesignPanel + rail item，不移动现有功能
4. **手动管线仍保留** —— `/pm-design` `/deep-design` `/pm-design-openui` 保留给高级用户

---

## §4 左侧导航集成

### 改动清单

| 改动点 | 文件 | 行号参考 | 说明 |
| --- | --- | --- | --- |
| `SidebarView` 联合类型 | `packages/desktop/src/renderer/hooks/use-panel-layout.ts` | L4-13 | 增加 `"design"` |
| Rail 按钮 | `packages/desktop/src/renderer/App.tsx` | L1076-1083 之后 | Code Review 下方插入 Design RailButton |
| 视图分发 | `packages/desktop/src/renderer/App.tsx` | L1138-1187 | `sidebarView === "design" → <DesignPanel />` |
| i18n keys | `packages/desktop/src/renderer/i18n/messages.ts` + 4 locale 文件 | — | `rail.design` + DesignPanel 标签集 |
| 新组件 | `packages/desktop/src/renderer/components/DesignPanel.tsx` | — | 工作区外壳 |

### Rail 按钮位置

```
现有顺序:
  Explorer → SCM → Tasks → Commands → Plugins → Tokens → Index → Review → GitMCP → Editor
                                                                        ↑
                                                                   插入 Design
```

Design 位于 **Code Review（`review`）正下方**、GitMCP（`gitmcp`）上方，归类到"功能视图"集群（Index / Review / Design / GitMCP / Editor）。

### Icon 选择

使用画板/调色板类图标（与 Review 的检查图标、Index 的图书馆图标区分），候选：
- `🎨` 调色板语义 → SVG 画板图标
- 命名：`IconDesign`（新增到 `App.tsx` 的图标组件区，与 `IconGitmcp` / `IconEditor` 同级）

---

## §5 DesignPanel 组件设计

### 组件树

```
DesignPanel (workspace shell — 参考 CodeReviewPanel / IndexLibraryPanel 模式)
├── Header
│   ├── Title: "设计" / "Design"
│   └── 工具栏: [+ 新需求, ⟳ 刷新]
├── CompositeAction 区
│   └── 🎯 一键需求具现化 Button
│       ├── onClick → api.actionRun("design.materialize", { requirement: prompt(...) })
│       └── progress → api.onActionProgress (按 actionId 过滤, 同 CodeReviewPanel)
├── Filter Tabs
│   └── [全部] [A2UI] [OpenUI] [.dd]  (按管线类型过滤产物列表)
├── Artifacts 列表
│   └── ArtifactCard (循环)
│       ├── 类型图标 + 类型 badge (A2UI/OpenUI/.dd)
│       ├── 标题 (来自 pm-analyst 输出的 title)
│       ├── 摘要 (一行)
│       ├── 更新时间 (相对时间)
│       └── 操作按钮: [👁 打开预览] [💬 对话迭代] [🗑 删除]
└── EmptyState
    └── "尚无设计产物。点击「🎯 一键需求具现化」，描述你的需求。"
```

### 交互流

```
用户点击「🎯 一键需求具现化」
    ↓
弹出输入框（或聚焦 Composer 预填提示词模板）
    ↓
api.actionRun("design.materialize", { requirement: "..." })
    ↓
DesignPanel 显示进度条 (onActionProgress)
    ├── 📊 分析需求… (pm-analyst 子代理)
    ├── 🎨 生成 a2ui 原型… (MCP 工具调用)
    └── ✅ 完成
    ↓
右侧 Preview 自动打开 (usePreview 响应式)
DesignPanel 列表新增一条 ArtifactCard
```

### "对话迭代"入口

点击 ArtifactCard 的「💬 对话迭代」→ 向 Composer 注入上下文消息：

```
请基于设计产物「<title>」继续迭代。
当前管线: <pipeline>
产物 ID: <artifactId>
我的修改需求是: [用户填写]
```

Agent 收到后调用对应的 `update_surface` / `update_openui` / `update_design` MCP 工具（delta-patch），右侧预览实时更新。

---

## §6 design.materialize 复合 Action

### Action 定义

```ts
// packages/core/src/actions/design.ts

export const designMaterializeDefinition: ActionDefinition = {
  name: "design.materialize",
  description: "需求具现化 —— 从自然语言需求生成可交互原型（自动选择 A2UI/OpenUI/DeepDesign 管线）",
  inputSchema: {
    type: "object",
    properties: {
      requirement: {
        type: "string",
        description: "自然语言需求描述（与 specPath 二选一）",
      },
      specPath: {
        type: "string",
        description: "已有 spec 文件路径（与 requirement 二选一，读取文件内容作为需求）",
      },
      pipeline: {
        type: "string",
        enum: ["auto", "a2ui", "openui", "design"],
        default: "auto",
        description: "原型管线：auto=AI 自动路由, a2ui=交互型, openui=混合型, design=展示型",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      artifactId: { type: "string" },
      pipeline: { type: "string" },
      analysis: { type: "object" },
    },
  },
};
```

### 执行流程

```ts
export const designMaterializeRun: ActionRun = async (input, ctx) => {
  // ── Step 1: 需求采集 ──
  const requirement = input.requirement
    ?? (input.specPath ? await readFile(input.specPath, "utf-8") : undefined);
  if (!requirement) {
    return { ok: false, error: "请提供 requirement 或 specPath" };
  }

  // ── Step 2: 需求分析 (pm-analyst 子代理) ──
  ctx.emit({ label: "📊 分析需求…", progress: 0.15 });
  const analysis = await ctx.runSubagent({
    skill: "pm-analyst",
    prompt: requirement,
  });
  // analysis 结构: { title, summary, modules[], userStories[], flows[], recommendedPipeline, pipelineReason }

  // ── Step 3: 管线路由 ──
  const pipeline: "a2ui" | "openui" | "design" =
    input.pipeline === "auto" ? analysis.recommendedPipeline : input.pipeline;

  // ── Step 4: 原型生成 (调用现有 MCP 工具) ──
  ctx.emit({ label: `🎨 生成 ${pipeline} 原型…`, progress: 0.55 });
  const mcpTool = toolForPipeline(pipeline);
  //   a2ui   → "render_prototype" (template-based) 或 "render_surface" (free-form)
  //   openui → "render_openui"
  //   design → "render_design"
  const mcpArgs = argsForPipeline(pipeline, analysis);
  const result = await ctx.executeMcpTool("a2ui", mcpTool, mcpArgs);

  // ── Step 5: 持久化 ──
  ctx.emit({ label: "💾 保存设计产物…", progress: 0.9 });
  const artifactId = await saveDesignArtifact(ctx.projectRoot, {
    type: pipeline,
    title: analysis.title,
    summary: analysis.summary,
    requirement,
    analysis,
    content: extractPayload(result, pipeline),
  });

  ctx.emit({ label: "✅ 完成", progress: 1.0 });
  return { ok: true, output: { artifactId, pipeline, analysis } };
};
```

### 管线路由规则

`pm-analyst` 子代理输出的 `recommendedPipeline` 遵循以下决策树：

```
需求特征分析
├── 有表单输入 / 列表 / 看板 / 多页面导航 / 双向交互验证
│   └── → A2UI
│        理由: a2ui_action 双向交互回路是核心价值，其他管线不支持
│
├── 纯展示 / 着陆页 / 海报 / 文档 / 视觉质量优先
│   └── → DeepDesign (.dd)
│        理由: .dd 输出自包含 HTML，可脱离宿主，Tailwind 内置，视觉表现力最强
│
├── 简单交互但需组件生态 / token 敏感场景
│   └── → OpenUI Lang
│        理由: 紧凑行式语法省 3-4x token，$variable 自动依赖追踪
│
└── 混合型（既有展示又有交互）
    └── → A2UI（优先交互验证能力）
         理由: 交互验证 > 视觉表现，A2UI 自研渲染器已覆盖足够组件
```

---

## §7 pm-analyst Skill

### 定位

**新增 Skill**：`packages/core/templates/plugins/design/skills/pm-analyst/SKILL.md`

将自然语言需求拆解为结构化的产品分析文档，是 `design.materialize` 的需求分析前置环节。

### Skill 规格

```yaml
---
name: pm-analyst
description: >
  产品经理分析技能 —— 将自然语言需求拆解为结构化的功能模块、用户故事和交互流程，
  并推荐最佳原型管线（A2UI / OpenUI / DeepDesign）。design.materialize 的前置分析环节。
---
```

### 输入 / 输出

**输入**：自然语言需求描述（一段话到几段话）

**输出**（JSON）：

```json
{
  "title": "功能标题（简短，用于产物列表展示）",
  "summary": "一句话概述（用于产物列表摘要）",
  "modules": [
    {
      "name": "模块名",
      "description": "模块职责描述",
      "priority": "P0 | P1 | P2"
    }
  ],
  "userStories": [
    {
      "as": "作为<角色>",
      "iWant": "我想要<功能>",
      "soThat": "以便<价值>"
    }
  ],
  "flows": [
    {
      "name": "流程名（如：用户登录流程）",
      "steps": ["步骤1", "步骤2", "步骤3"]
    }
  ],
  "recommendedPipeline": "a2ui | openui | design",
  "pipelineReason": "选择该管线的理由（一句话）"
}
```

### 分析框架

Skill body 教导 AI 按以下框架分析需求：

1. **功能模块划分** —— 将需求拆为 2-5 个高内聚低耦合的模块，标注优先级
2. **用户故事提炼** —— 每个模块提炼 1-3 个 User Story（As-IWant-SoThat 格式）
3. **核心交互流程** —— 识别 1-3 条关键用户路径（步骤序列）
4. **管线推荐** —— 基于 §6 的决策树判断最佳原型载体

---

## §8 设计产物持久化

### 目录结构

```
<projectRoot>/.deeporca/designs/
├── index.json                          # 产物索引（轻量，仅 meta）
├── <uuid-1>/
│   ├── meta.json                       # 完整元数据
│   ├── requirement.md                  # 原始需求文本
│   ├── analysis.json                   # pm-analyst 结构化分析
│   ├── prototype.a2ui.json             # A2UI Surface（pipeline=a2ui 时）
│   ├── prototype.openui.txt            # OpenUI Lang 代码（pipeline=openui 时）
│   └── prototype.dd                    # DeepDesign .dd 文档（pipeline=design 时）
├── <uuid-2>/
│   └── ...
```

### index.json 格式

```json
{
  "version": 1,
  "artifacts": [
    {
      "id": "uuid-1",
      "type": "a2ui",
      "title": "用户登录注册原型",
      "summary": "邮箱+密码登录，支持注册和忘记密码",
      "pipeline": "a2ui",
      "createdAt": "2026-08-11T10:30:00Z",
      "updatedAt": "2026-08-11T11:45:00Z"
    }
  ]
}
```

### meta.json 格式

```json
{
  "id": "uuid-1",
  "type": "a2ui",
  "title": "用户登录注册原型",
  "summary": "邮箱+密码登录，支持注册和忘记密码",
  "pipeline": "a2ui",
  "requirement": "我需要一个用户登录注册系统...",
  "analysis": { ... },
  "createdAt": "2026-08-11T10:30:00Z",
  "updatedAt": "2026-08-11T11:45:00Z",
  "versions": [
    { "version": 1, "createdAt": "2026-08-11T10:30:00Z", "note": "初始生成" }
  ]
}
```

### 与 A2UI surface 持久化的关系

A2UI 已有 `.deeporca/prototypes/<surfaceId>.json`（用于会话恢复）。V2 的 `.deeporca/designs/` 是**更高层的项目管理索引**：

- `prototypes/` = A2UI 运行时 surface 状态（管线内部细节）
- `designs/` = 跨管线的统一设计资产索引（PM 视角）

两者不合并：`prototypes/` 服务于 A2UI 管线的会话恢复机制，`designs/` 服务于 DesignPanel 的资产管理。当 pipeline=a2ui 时，`designs/<uuid>/prototype.a2ui.json` 是 `prototypes/` 的快照副本。

---

## §9 与现有模块的关系

| 现有模块 | V2 关系 | 说明 |
| --- | --- | --- |
| **A2UI MCP** (`a2ui-mcp.ts`) | ✅ 完全不变 | `design.materialize` 调用现有 `render_surface` / `render_prototype` |
| **OpenUI Lang** (`openui/`) | ✅ 完全不变 | `design.materialize` 调用现有 `render_openui` |
| **DeepDesign** (.dd) | ✅ 完全不变 | `design.materialize` 调用现有 `render_design` |
| **右侧 Preview 面板** | ✅ 完全不变 | 预览仍由 `usePreview()` 响应式驱动 |
| **`/pm-design`** **`/deep-design`** **`/pm-design-openui`** | ✅ 保留 | 高级用户仍可手动选管线 |
| **IndexLibraryPanel / CodeReviewPanel** | 📐 模式参考 | DesignPanel 复用 workspace + `actionRun` + `onActionProgress` 模式 |
| **ActionRegistry** | 🔧 扩展 | 注册 `design.materialize` action（第 16 个 action） |
| **action-ipc.ts** | ✅ 不变 | 已有的 ActionList / ActionRun IPC 自动覆盖新 action |
| **defineAction 体系** | ✅ 自动生效 | `design.materialize` 自动成为 LLM tool + IPC handler + UI button |

---

## §10 实施阶段

### P0：设计文档 + 工作区骨架（本方案）

| 任务 | 交付 |
| --- | --- |
| 编写本设计文档 | `specs/pm-design-v2/design.md` |
| 编写任务分解 | `specs/pm-design-v2/tasks.md` |
| 更新路线图 | `docs/features/feature-roadmap.md` §六 |
| 左侧 design rail item | `SidebarView` + `App.tsx` Rail + i18n |
| DesignPanel 空壳 | 空状态 + Header + 一键按钮（暂不接线） |

**交付价值**：可见的空工作区，用户知道"设计模块存在"。

### P1：design.materialize + pm-analyst

| 任务 | 交付 |
| --- | --- |
| `pm-analyst` Skill | `templates/plugins/design/skills/pm-analyst/SKILL.md` |
| `design.materialize` Action | `core/actions/design.ts`（编排层） |
| 管线路由逻辑 | `toolForPipeline()` / `argsForPipeline()` |
| Action 注册 | `session.ts` 构造器注册第 16 个 action |
| DesignPanel 一键按钮接线 | `api.actionRun("design.materialize")` |

**交付价值**：一键需求具现化可用（无持久化，会话内有效）。

### P2：设计产物持久化 + 列表

| 任务 | 交付 |
| --- | --- |
| `saveDesignArtifact()` / `listDesignArtifacts()` | `core/actions/design-store.ts` |
| `.deeporca/designs/` 目录管理 | 读写 index.json + 产物文件 |
| DesignPanel 列表渲染 | ArtifactCard + Filter Tabs |
| 打开预览 / 删除操作 | IPC handler |

**交付价值**：设计资产可管理，跨会话持久。

### P3：对话迭代闭环

| 任务 | 交付 |
| --- | --- |
| "对话迭代"入口 | Composer 注入上下文 + 产物引用 |
| 版本快照 | 每次迭代保存版本到 `meta.json.versions[]` |
| 版本回溯 | DesignPanel 版本切换 |

**交付价值**：从产物列表发起迭代，闭环完成。

### P4：导出与交付

| 任务 | 交付 |
| --- | --- |
| .dd → 独立 HTML 文件导出 | `compileDdToHtml()` 已有，增加"另存为" |
| A2UI → React 代码导出 | Surface JSON → React 组件代码转换器 |
| OpenUI → React 代码导出 | OpenUI Lang → 标准 React（SDK 已有能力） |

**交付价值**：设计产物可脱离 DeepOrca 交付给开发团队。

---

## 附录 A：管线路由决策树（完整版）

```
输入: pm-analyst 输出的需求分析

Q1: 需求是否包含表单输入（input/checkbox/select）？
  ├─ 是 → Q2
  └─ 否 → Q3

Q2: 需求是否需要双向交互验证（用户点击 → AI 响应 → 界面更新）？
  ├─ 是 → A2UI (a2ui_action 双向回路是独有能力)
  └─ 否 → Q4

Q3: 需求是否是多页面导航型（dashboard / wizard / multi-step）？
  ├─ 是 → A2UI (navigate_to + multi-page 模板)
  └─ 否 → Q5

Q4: 简单交互但 token 敏感？
  ├─ 是 → OpenUI Lang (紧凑语法省 3-4x token)
  └─ 否 → A2UI (组件更丰富)

Q5: 纯展示型（着陆页 / 海报 / 文档 / 设计稿）？
  ├─ 是 → DeepDesign (.dd, 自包含 HTML, Tailwind 内置, 视觉最强)
  └─ 否 → A2UI (默认安全选择)
```

## 附录 B：与 v0 / bolt / Lovable 的定位差异

| 产品 | 定位 | 输出 | 与 PM-Design V2 的差异 |
| --- | --- | --- | --- |
| **v0** (Vercel) | UI 组件生成器 | React + Tailwind 代码 | 面向开发者，输出代码而非可交互原型 |
| **bolt.new** (StackBlitz) | 全栈应用生成器 | 可运行的 Web 应用 | 面向开发者，输出完整工程 |
| **Lovable** | AI 应用构建器 | 可部署的 Web 应用 | 面向开发者，端到端工程 |
| **PM-Design V2** | **需求具现化工作台** | **可交互原型（A2UI/OpenUI/.dd）** | **面向 PM，输出原型而非代码；需求分析前置；多管线自动路由** |

PM-Design V2 的核心差异是**受众是 PM 而非开发者**，且**需求分析是显式前置环节**（pm-analyst），而非直接跳到代码/原型生成。
