# 任务报告：OCR 内置插件集成 & Understand-Anything 耦合度分析

> 日期：2026-07-21 · 状态：✅ 已完成 · 构建验证：TypeCheck 0 错误 / Desktop Build 通过

---

## 任务 1：Open Code Review 内置插件 + 代码审查面板

### 目标

将阿里巴巴开源的 [Open Code Review (OCR)](https://github.com/alibaba/open-code-review) 集成为内置插件，
提供代码审查能力技能，并在桌面端新增代码审查面板。

### 实现方案

采用与 CodeGraph 索引库相同的集成模式：IPC 通道 → 主进程 spawn 子进程 → 流式事件 → 渲染器面板。

### 交付物

| 层级 | 文件 | 说明 |
|------|------|------|
| 内置插件 | `core/templates/plugins/open-code-review/plugin.json` | 插件清单 |
| 技能文档 | `PLUGIN.md` / `PLUGIN.zh.md` | 教 agent 使用 `ocr` CLI 的完整工作流 |
| IPC 合约 | `desktop/src/shared/ipc.ts` | `ReviewRun` / `ReviewCheckAvailable` 通道 + `ReviewProgress` 事件 + `ReviewComment` / `ReviewOptions` / `ReviewProgressEvent` 类型 |
| 主进程 | `desktop/src/main/index.ts` | `execFile` 检测 ocr 可用性 + `spawn ocr review --format json` 流式输出 |
| Preload | `desktop/src/preload/index.ts` | 3 个新 API 绑定 |
| 面板组件 | `desktop/src/renderer/components/CodeReviewPanel.tsx` | 可用性检测 / 模式选择(workspace/branch) / JSON 解析 / severity 评论卡片 |
| Rail 按钮 | `App.tsx` + `ui/icons.tsx` | "review" sidebarView + IconReview（放大镜+勾号） |
| 样式 | `ui.css` | +82 行 review 面板样式 |
| 国际化 | 6 个 locale 文件 | 8 key × 6 语言 (en/zh/ja/ko/zh-hk/zh-tw) |

### 功能说明

- **自动检测**：面板打开时检测 `ocr` 是否在 PATH 中，未安装时显示安装指引
- **审查模式**：支持"工作区变更"和"分支对比"两种模式
- **流式输出**：审查过程实时显示 ocr 输出日志
- **结构化展示**：自动解析 JSON 输出，按 severity（critical/warning/info）分色展示评论卡片

---

## 任务 2：Understand-Anything 项目耦合度分析

### 目标

分析 [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything)（55.5K Stars）
与本项目的耦合度，评估是否可作为内置集成能力（类似 CodeGraph 索引库）。

### 项目概况

| 属性 | 值 |
|------|-----|
| 定位 | 将代码库/知识库转化为交互式知识图谱 |
| 架构 | Tree-sitter AST（确定性）→ 多 Agent LLM 管线（语义）→ 交互式 Dashboard（可视化） |
| 运行模型 | **无独立进程** — "Prompt 即代码"，57 个 Markdown 文件注入宿主 AI 上下文 |
| 输出 | `.ua/knowledge-graph.json`（标准 JSON） |
| 许可证 | MIT |
| 技术栈 | Node.js / pnpm / Tree-sitter / Vite |

### 耦合度评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 代码耦合 | **极低** | 无共享依赖、无 API 调用、无运行时交互 |
| 数据耦合 | **低** | 仅通过 `.ua/knowledge-graph.json` 文件交换数据 |
| 运行耦合 | **无** | 没有可执行文件/守护进程，完全依赖宿主 LLM |
| 协议耦合 | **无** | 不是 MCP Server，不提供 RPC/HTTP 接口 |

### 与 CodeGraph 对比

| | CodeGraph | Understand-Anything |
|---|---|---|
| 集成模式 | vendor 二进制 → spawn 子进程 → MCP Server | Prompt/Skill 注入 → 宿主 LLM 执行 |
| 独立运行 | ✅ 有自己的 CLI | ❌ 依赖宿主 AI 的 LLM 能力 |
| 面板可视化 | SQLite → 简单状态列表 | JSON 知识图谱 → 需力导向图可视化 |
| 集成难度 | 低（spawn + parse） | 中（skill 简单，dashboard 需额外工作） |
| Token 成本 | 无（纯本地计算） | 首次全量分析消耗大，后续增量低 |

### 结论与建议

**可以作为内置集成能力**，推荐分两阶段：

**Phase 1（低成本，推荐立即执行）：**
将 UA 的 skill 文件作为 bundled skill 集成 → agent 获得 `/understand`、`/understand-chat`、
`/understand-diff`、`/understand-onboard` 等能力。与现有 skill 系统完全兼容，无需改架构。

**Phase 2（可选，需额外投入）：**
新增"知识图谱"面板，读取 `.ua/knowledge-graph.json` 并用 D3/vis.js 渲染力导向图。
类似 IndexLibraryPanel 模式但需引入图可视化库。

**不建议**像 CodeGraph 那样作为 MCP Server 集成 — UA 没有独立进程，它的"引擎"就是宿主 LLM 本身。

---

## 构建验证

```
TypeCheck:  4 workspaces 全部通过（0 errors）
Desktop:    esbuild 构建成功
文件统计:   17 个文件修改/新建，+653 行
```

## 待办

- [ ] Git commit（改动尚在工作区未提交）
- [ ] Phase 1 实施：将 UA skill 文件集成为 bundled skill（如需要）
