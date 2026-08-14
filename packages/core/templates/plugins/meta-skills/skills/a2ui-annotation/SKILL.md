---
name: a2ui-annotation
description: >-
  全域交互层 — A2UI 是 agent 与用户之间的结构化交互通道：主动式追问（方案选择、
  方向确认、对比决策）与批注式交互（对原型/设计稿/代码审查结果等产出的反馈卡）。
  使用 render_surface 构建交互式 Surface；不生成设计内容。
  Use when the agent needs to proactively ask the user structured questions or
  present interactive annotations/feedback options on any artifact.
  触发词: 批注, 标注, 反馈, 建议, 追问, 确认, annotation, feedback, suggestion.
---

# A2UI 全域交互层（主动追问 + 批注交互）

A2UI 是 DeepOrca 的全域交互层：agent 需要用户**结构化回应**时（选择方案、确认方向、
对产出提出反馈），用 `render_surface` 构建交互式 Surface——内嵌上下文、建议选项和
输入框，用户通过点击或打字回应，比纯文本对话更高效。

## 定位与红线

- **职责**：主动式追问 + 批注式交互——一切"agent ↔ 用户"的结构化交互表面。
- **增量原则**：只承载**新增**交互表面；QuestionCard、权限询问卡片等存量交互
  组件不迁移、不由本技能替代。
- **红线**：A2UI **不生成设计内容、不进入 design 子域主流程**。设计原型使用
  OpenUI Lang（`render_openui`），设计稿使用 DeepDesign（`render_design`）。

## 何时使用

- Agent 主动追问：需要用户在多个方案中选择、确认某个修改方向
- 批注交互：用户对某个产出（原型/设计/代码）提出修改意见，Agent 给出结构化选项
- 展示对比：旧方案 vs 新方案，让用户选择
- 注意：权限确认走系统内置的权限卡片，文本澄清优先普通对话；本技能用于
  需要点击/选择/结构化输入的场景。

## 工作流

### Step 1: 构建批注 Surface

使用 `render_surface` 创建一个交互式批注面板。典型结构：

- **上下文卡片** — 描述用户关注的区域/产出
- **方案选项卡片** — 每个方案一张卡片，含标题 + 描述
- **自由输入框** — 让用户打字描述自己的修改想法
- **操作按钮** — 确认选择 / 取消

### Step 2: 处理用户反馈

用户点击按钮或提交输入后，`a2ui_action` 工具收到反馈。
根据用户的选择（点击的组件 + 输入文本）继续迭代。

### Step 3: 关闭批注

完成后 `close_surface` 关闭 Surface。

## 组件类型

| 类型        | 用途                       |
| ----------- | -------------------------- |
| `card`      | 上下文、方案描述、问题说明 |
| `button`    | 确认/取消/选择操作         |
| `textfield` | 自由文本输入               |
| `text`      | 标签、提示文字             |
| `badge`     | 标记优先级、状态           |
| `divider`   | 视觉分隔                   |

## 最佳实践

1. **总是提供自由输入选项** — 不要强制用户从预设中选择
2. **聚焦一个决策点** — 一个 Surface 解决一个问题
3. **及时关闭** — 用户选择后立即 close_surface
4. **上下文清晰** — 明确标注用户关注的是哪个产出
