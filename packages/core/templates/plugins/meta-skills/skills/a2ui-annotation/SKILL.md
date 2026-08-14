---
name: a2ui-annotation
description: >-
  交互式批注反馈层 — 当用户对 AI 产出（原型、设计稿、代码审查结果、架构图等）有反馈时，
  使用 render_surface 构建交互式批注 UI。用户可以点击建议选项、打字描述修改、或标记问题区域。
  Use when the agent needs to present structured feedback options, interactive
  annotations, or contextual modification suggestions to the user.
  触发词: 批注, 标注, 反馈, 建议, annotation, feedback, suggestion.
---

# A2UI 交互式批注反馈层

A2UI 是 DeepOrca 的全域交互式批注系统。当用户需要对 Agent 的产出提供结构化反馈时，
Agent 使用 `render_surface` 构建一个交互式 Surface——内嵌上下文、建议选项和输入框，
用户通过点击或打字回应，比纯文本对话更高效。

## 与 Designer 的关系

A2UI **不生成设计内容**。设计原型使用 OpenUI Lang（`render_openui`），
设计稿使用 DeepDesign（`render_design`）。A2UI 专注于**交互反馈**：
当用户说"这里不好"或需要选择方案时，Agent 弹出一个交互式批注。

## 何时使用

- 用户对某个产出（原型/设计/代码）提出修改意见，Agent 想给出结构化选项
- Agent 需要用户在多个方案中选择
- Agent 需要用户确认某个修改方向
- 展示对比：旧方案 vs 新方案，让用户选择

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

| 类型 | 用途 |
|---|---|
| `card` | 上下文、方案描述、问题说明 |
| `button` | 确认/取消/选择操作 |
| `textfield` | 自由文本输入 |
| `text` | 标签、提示文字 |
| `badge` | 标记优先级、状态 |
| `divider` | 视觉分隔 |

## 最佳实践

1. **总是提供自由输入选项** — 不要强制用户从预设中选择
2. **聚焦一个决策点** — 一个 Surface 解决一个问题
3. **及时关闭** — 用户选择后立即 close_surface
4. **上下文清晰** — 明确标注用户关注的是哪个产出
