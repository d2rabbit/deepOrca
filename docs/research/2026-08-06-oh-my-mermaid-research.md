# 调研：oh-my-mermaid（omm）架构图生成

> 日期：2026-08-06 · 决策：**不采纳**（架构图构建改用 A2UI 方案）
> 仓库：[oh-my-mermaid/oh-my-mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid) · README：[README.zh.md](https://github.com/oh-my-mermaid/oh-my-mermaid/blob/main/README.zh.md)

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

## 二、为什么不采纳

### 决策：架构图构建使用 **A2UI**（§六），不引入 omm

理由：

1. **能力重叠，无增量价值**：omm 的核心（AI 分析代码 → 生成架构图）DeepOrca 已经能做 —— skill 触发 + LLM + Mermaid 渲染全链路已具备。omm 的价值主要在它的 **skill 模板**（`/omm-scan` 的 prompt 工程），这部分可以**借鉴 prompt 思路**，不需要引入整个工具链。

2. **渲染层重复**：omm 用 Mermaid 静态图 + 本地 web viewer。DeepOrca 的 A2UI（§六）已经是更强的交互式富组件层 —— Surface + 可嵌套组件 + iframe srcDoc 预览，天然比静态 Mermaid 图更适合"架构探索"（点击节点展开、实时联动代码）。

3. **集成成本**：omm 是独立的 CLI + skill 注入工具（`omm setup` 检测 Claude Code/Codex/Cursor 等）。DeepOrca 作为 agent harness 本身，再引入一个面向"多种 AI 编辑器"的桥接工具是**架构倒置** —— 我们就是那个被桥接的宿主。

4. **输出格式锁定**：omm 强制 7 字段元数据 schema + Mermaid `.mmd` 文件树。DeepOrca 的设计生成域（§六）已有 DeepDesign `.dd` 格式 + A2UI Surface，格式上不该再多一套 omm 私有结构。

### 可借鉴的点（不引入代码，只借鉴思路）

- **多视角分解**：架构图不应是一张大图，而应按视角（结构/数据流/依赖/外部集成）拆分 —— 这个理念可指导 A2UI 架构图组件的设计。
- **递归嵌套探索**：复杂节点可展开为子图 —— A2UI 的嵌套组件模型直接支持。
- **`/omm-scan` 的 prompt 工程**：它的 skill 模板里关于"如何让 AI 系统性分析代码架构"的提示词，可作为 DeepOrca 自建架构分析 skill 的参考。

---

## 三、替代方案：A2UI 架构图构建（§六 已规划）

DeepOrca 的架构图/架构探索能力归入 **§六 设计生成** 域，由 **A2UI** 承载：

- **生成**：自建 skill（借鉴 omm 的多视角 + 递归 prompt 思路），LLM 分析代码 → 产出 A2UI Surface 描述（非 Mermaid）。
- **渲染**：A2UI 组件树（可嵌套、可点击展开、可与代码联动），比 omm 的静态 Mermaid + web viewer 更强。
- **预览**：桌面端内置 DesignPreview 组件（iframe srcDoc），无需额外 viewer。

这与 §六 已有的 A2UI PM-Design P0-P4 + DeepDesign `.dd` 格式一脉相承，不引入新的工具依赖。

---

## 四、结论

| 项                   | 决策                                                            |
| -------------------- | --------------------------------------------------------------- |
| 引入 omm 代码/工具链 | **否**                                                          |
| 架构图构建方案       | **A2UI（§六）**，自建 skill，借鉴 omm 的多视角/递归 prompt 思路 |
| omm 的 skill prompt  | 可参考，但用自己的 skill 体系实现                               |
| 记录位置             | 路线图 §六 备注 + 本调研文档                                    |
