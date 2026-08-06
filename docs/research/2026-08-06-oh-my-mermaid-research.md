# 调研：oh-my-mermaid（omm）架构图生成

> 日期：2026-08-06 · 决策：**采纳 omm 探索方法（perspective + 递归），渲染用 A2UI**（不引入 omm CLI / Mermaid 工具链）
> 仓库：[oh-my-mermaid/oh-my-mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid) · README：[README.zh.md](https://github.com/oh-my-mermaid/oh-my-mermaid/blob/main/README.zh.md) · Skill 源：[`skills/omm-scan/SKILL.md`](https://github.com/oh-my-mermaid/oh-my-mermaid/blob/main/skills/omm-scan/SKILL.md)

---

## 一、omm 是什么

oh-my-mermaid（omm）是一个**面向人类的架构文档生成器**。它解决的问题是：AI 快速写出复杂代码后，代码库变成"黑盒"，人类难以理解。omm 通过 AI 分析代码库，生成多视角、可递归嵌套的 Mermaid 架构图 + 结构化元数据文档。

核心技术机制（与 DeepOrca 现有能力的关系）：

| omm 机制                           | 说明                                                          | DeepOrca 现状                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **AI 驱动生成**（非 AST 静态分析） | 用户在 AI 编码环境里触发 `/omm-scan` skill，AI 分析代码生成图 | DeepOrca 已有同样的 skill 触发机制（`identifyMatchingSkillNames` + LLM 调用），**无需引入 omm 的 skill 注入层** |
| **多视角（perspectives）**         | 结构、数据流、外部集成等独立图表                              | 可由 A2UI 原生表达（Surface + 组件树）                                                                          |
| **递归嵌套**                       | 复杂节点展开为子图                                            | A2UI 的嵌套组件天然支持                                                                                         |
| **文件系统架构**                   | `.omm/` 目录树 + `diagram.mmd` + 7 字段元数据                 | DeepOrca 已有 `.deeporca/` 项目目录 + 文件历史                                                                  |
| **本地 viewer**                    | `omm view` 启动本地交互式查看器                               | DeepOrca 桌面端本身就是 Electron，A2UI 预览组件已内置                                                           |
| **云同步**                         | 私有/团队/公开分享架构                                        | DeepOrca 暂无云同步，但非核心诉求                                                                               |

---

## 二、决策：采纳 omm 探索方法，渲染用 A2UI

### 采纳的部分（omm 的探索方法论）

omm 的核心价值在于它的**代码架构分析方法论**，这套方法论 DeepOrca 直接复用：

1. **Perspective Catalog（视角目录）**：omm 定义了 12 个标准视角（overall-architecture / request-lifecycle / data-flow / dependency-map / external-integrations / state-transitions / route-page-map / command-surface / extension-points / pipeline / orchestration / storage）。架构不是一张大图，而是按视角拆分的多张图。**DeepOrca 自建 `arch-scan` skill 完整采用这套视角目录。**

2. **Recursive drill-down（递归下钻）**：每个图里的元素，如果内部有结构就递归展开成子图（group），没有就是叶子（leaf）。**DeepOrca 的 A2UI 组件树天然支持这种嵌套。**

3. **7 字段元数据**：description / context / constraint / concern / todo / note —— 每个元素的结构化文档。**DeepOrca 用 A2UI Surface 的组件属性承载这些字段。**

### 不采纳的部分（omm 的工具链 / 渲染层）

| 不采纳                                                           | 理由                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| omm CLI（`omm` / `omm setup` / `omm view`）                      | DeepOrca 作为 agent harness 本身就是宿主，不需要桥接多种 AI 编辑器的工具   |
| Mermaid `.mmd` 静态图                                            | A2UI 组件树（可嵌套、可点击展开、可联动代码）比静态 Mermaid 更适合架构探索 |
| `.omm/` 文件树结构                                               | DeepOrca 用 A2UI Surface 描述（内存中的组件树），不落盘成 omm 私有目录结构 |
| omm 的 skill 注入层（`omm setup` 检测 Claude Code/Codex/Cursor） | DeepOrca 有自己的 skill 体系（`packages/core/templates/plugins/`）         |

### 实现方式：自建 `arch-scan` skill

DeepOrca 在 `packages/core/templates/plugins/code/skills/arch-scan/` 新建 skill，**忠实采用 omm 的 perspective 目录 + 递归方法论**，但：

- **输出**：A2UI Surface 描述（嵌套组件树），不是 Mermaid `.mmd` 文件
- **渲染**：A2UI 预览组件（iframe srcDoc），不是 `omm view`
- **触发**：`/arch-scan` 或自然语言（"扫描架构"/"架构图"/"architecture diagram"）
- **依赖**：零外部 CLI 依赖（omm 需要 `npm install -g oh-my-mermaid`，DeepOrca 不需要）

---

## 三、A2UI 架构图渲染（§六）

DeepOrca 的架构图/架构探索渲染归入 **§六 设计生成** 域，由 **A2UI** 承载：

- **生成**：`arch-scan` skill（采用 omm 方法论）→ LLM 分析代码 → 产出 A2UI Surface（每个 perspective = 一个可嵌套架构图组件）。
- **渲染**：A2UI 组件树（可嵌套、可点击展开、可与代码联动），比 omm 的静态 Mermaid + web viewer 更强。
- **预览**：桌面端内置 DesignPreview 组件（iframe srcDoc），无需额外 viewer。

这与 §六 已有的 A2UI PM-Design P0-P4 + DeepDesign `.dd` 格式一脉相承，不引入新的工具依赖。

---

## 四、结论

| 项                                   | 决策                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| omm 探索方法论（perspective + 递归） | **采纳** —— `arch-scan` skill 完整复用 12 视角目录 + 递归下钻 + 7 字段元数据        |
| omm CLI / 工具链                     | **不采纳** —— DeepOrca 自身是 agent harness，不需要桥接多编辑器的工具               |
| Mermaid 静态图渲染                   | **不采纳** —— 改用 A2UI 组件树（可嵌套、可联动代码）                                |
| `.omm/` 文件树                       | **不采纳** —— 用 A2UI Surface（内存组件树）替代                                     |
| 渲染层                               | **A2UI（§六）** —— DesignPreview 组件（iframe srcDoc），无需 `omm view`             |
| 实现位置                             | `packages/core/templates/plugins/code/skills/arch-scan/` + 路线图 §六 备注 + 本文档 |
