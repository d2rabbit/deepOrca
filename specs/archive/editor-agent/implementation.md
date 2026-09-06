# editor-agent 落地说明（B3c 实现映射与验证指南）

> 配套 [design.md](./design.md)。本文是设计 → 代码的逐项映射与验证步骤，
> 供评审/验证使用。状态：**S1–S4 全部落地**，分支
> `feat/modern-ui-redesign`（提交 9d49ce1c…f6b2ce1e 区间）。

## 目标回顾（用户原始要求 → 切片）

用户要求编辑器升级为类 VSCode/zen 的实际编码器，其中核心新增：「选中位置
后，通过 A2UI 绘制即时的 agent 交互窗口，发布指令，实时输出结果，并为该
功能单独设计一个子 agent」。按此拆为四片：

| 切片 | 内容                                                   | 状态                                   |
| ---- | ------------------------------------------------------ | -------------------------------------- |
| S1   | 编辑器内核（高亮/格式识别/worker/主题/保存）           | ✅ 已有（Monaco 集成在先，本轮仅增强） |
| S2   | 专职数字体通路 + `editor:agentRun` IPC + 就地执行/应用 | ✅ a3cf182c + 9d22b761                 |
| S3   | A2UI Surface 反问交互（数字体可反问表单/多选项确认）   | ✅ 4661ec85 + df3c71b4                 |
| S4   | 结果 diff 内联（±N 统计 + Monaco decoration）          | ✅ df3c71b4                            |

## 逐项落地映射

### S1 · 编辑器内核（既有 + 本轮增强）

- `packages/desktop/src/renderer/components/EditorOverlay.tsx`
  - `ensureMonacoLoaded()`：Monaco 动态加载、worker 分发
    （json/css/html/ts/editor 五类 worker）、**本轮新增** TS/JS 编译选项
    （jsx React、ESNext、allowNonTsExtensions、eager model sync——tsx 不再
    按纯 ts 误报）；
  - `languageForFile()`：60+ 扩展名 → Monaco language id（格式识别）；
  - 脏状态/⌘S 保存/Esc 关闭守卫/明暗主题（`vs`/`vs-dark`）。

### S2 · 专职数字体通路

- **core** `packages/core/templates/skills/bundled/editor-agent/SKILL.md`
  — 数字体契约：范围即世界 / 用户语言 / diff 优先（一个围栏、缩进保持、
  drop-in 兼容）/ 说明 ≤3 行 / 不足即坦白；含 S3 的 A2UI 反问协议模板。
- **core** `packages/core/src/actions/types.ts` —
  `BackgroundLlmTaskOptions.profile` 增 `"editor"`（review 的只读机制 +
  面向用户的 system 前导：最终文本原样进编辑器）。
- **core** `packages/core/src/session-manager-tasks.ts` —
  `runBackgroundLlmTask` 的 editor 分支（无产物目录/无 write 工具/无
  steering；工具面 read+bash+codegraph/serena MCP）。
- **desktop** `packages/desktop/src/main/session-bridge.ts` —
  `runEditorAgent()`：prompt 构造（文件/行范围/选区/语言/指令，选区 8KB
  截断）→ `manager.runBackgroundLlmTask({ skill: "editor-agent", profile:
"editor" })`。**sessionless 零残留**：不建会话、不写 JSONL、不进会话
  列表、不劫持主视图。
- **desktop** `packages/desktop/src/shared/ipc.ts` — 通道
  `EditorAgentRun: "editor:agentRun"`（privileged）+ `api.editorAgentRun`
  契约（入参 filePath/startLine/endLine/selection/instruction/lang；出参
  `{ok,content,iterations}` 或 `{ok:false,error}`）。
- **desktop** `packages/desktop/src/preload/index.ts` — `editorAgentRun`
  桥接；`packages/desktop/src/main/index.ts` — handler（入参校验 +
  `getBridge().runEditorAgent`）。

### S3 · A2UI 反问交互

- **协议**（SKILL.md「Clarifying via A2UI」节）：数字体反问时在正文后
  输出 ` ```a2ui ` 围栏 = A2UI v0.9 批次（`createSurface`(`edq-*`) +
  `updateComponents`[Column: Text 问题 · ChoicePicker 选项 · TextField
  补充 · Button(action=submit)] + `updateDataModel`）。
- **desktop** `EditorOverlay.tsx` — `extractA2ui()` 解析围栏 →
  `A2uiSurface`（官方 v0.9 引擎 + basicCatalog）就地渲染；
  `handleSurfaceAction()`：submit 动作 →
  `getSurfaceModel(sid).dataModel.get("answer"/"choice"/…)` 读回答案 →
  JSON 作为 follow-up 续跑（`agentTurnsRef` 保留多轮问答历史）。

### S4 · diff 内联

- **desktop** `EditorOverlay.tsx` — `diffLines()`（自写行级 LCS，零依赖）
  计算 选区 vs 替换代码；浮窗渲染 `+N −M` 统计与红绿行 diff
  （`.ui-edagent-diff`）；Monaco `createDecorationsCollection` 对提交范围
  挂 pending 装饰（`edagent-pending-line` 整行淡黄底 +
  `edagent-pending-mark` 右缘标记），应用/关闭浮窗即清除。
- `applyAgentCode()`：`executeEdits` 落回**提交时记录的范围**
  （`appliedRangeRef`，结果返回期间移动光标不影响落点），undo 可撤，
  ⌘S 才写盘。
- 样式 `packages/desktop/src/renderer/ui-css/editor-panel.css`（`.ui-edagent-*`
  浮窗族 + diff 行色 + pending 装饰）。

## 数据流（一轮完整交互）

```
用户选中代码 → 浮出「问数字体」→ 输入指令 ⌘⏎
  → editor:agentRun (IPC, privileged)
  → SessionBridge.runEditorAgent → runBackgroundLlmTask(editor profile)
  → editor-agent skill 契约约束下的 LLM 循环（只读工具面）
  → 结果文本回浮窗
     ├─ 含代码围栏 → diff 视图 + ±N + Monaco pending 装饰 → 「应用到选区」
     └─ 含 a2ui 围栏 → A2UI 反问表单 → 用户作答 submit → 读回 data model
        → follow-up 续跑（回到结果分支）
「到会话」旁路：任意时刻可把选区指令注入主会话流式执行
```

## 验证指南

**构建门禁**（已全绿）：`npm run check`（typecheck + eslint +
format:check）· `npm run desktop:build` · 测试
`a2ui-processor / task-tree(27) / task-hub(5) / task-hub-workspace(6) /
slash-command(6) / thinking-row-toggle(3) / composer(6) / ipc-contract(9)`
全 fail=0。

**手工验证路径**：

1. 启动应用（`npm run desktop:startMac` 等），打开一个工作区 → dock「编辑
   器」→ 目录树展开到任一代码文件点击打开；
2. 选中一段代码 → 右下浮出「◈ 问数字体」→ 输入「重构这段」→ 发送；
3. 面板出现 busy → 结果 diff 视图（±N + 红绿行）→ 同时编辑器内该范围挂
   淡黄底 + 右缘琥珀标记；
4. 「应用到选区」→ 代码落回（Monaco undo 可撤）→ ⌘S 写盘；
5. 反问路径：输入一个故意含糊的指令（如「优化它」且选区语义多义）→ 数字
   体可能返回 a2ui 表单（选项 + 补充输入）→ 作答后 submit → 自动续跑；
6. 「到会话」旁路：点击后主会话收到带选区上下文的指令并流式回复。

## 已知边界与后续

- 数字体执行为**非流式**（后台任务循环跑完一次性返回）——流式回流需把
  后台任务的 chunk 事件桥接给浮窗，列为后续项；
- A2UI 反问目前限定 basicCatalog 组件与 `submit` 单动作；多轮 Surface 状态
  不持久化（每轮重新出块）；
- 分支独立 fork 的沙盒重定向（sandbox PathGrant 深水区）与本模块无关，
  见任务树相关提交说明。
