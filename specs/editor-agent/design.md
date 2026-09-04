# editor-agent — 编辑器专职数字体（design draft）

> 状态：设计切片。B3c-3 第一切片已落地（EditorOverlay 选区浮窗 → 主会话
> 流式执行，见 `EditorOverlay.tsx` onAskAgent / App 接线）；本 spec 描述
> 专职子代理的完整形态与后续切片。

## 目标

编辑器内选中代码 → A2UI 即时交互窗 → 发布指令 → 专职数字体在编辑器
上下文中执行 → 结果实时回流（内联 diff / A2UI Surface）。

## 已落地（第一切片）

- 选区跟踪（Monaco onDidChangeCursorSelection）；
- 右下浮出「问数字体」按钮 + 迷你指令窗（选区预览 + 指令输入 + ⌘⏎）；
- 提交的 prompt 携带 `文件路径 + 行范围 + 选区代码` 注入主会话，复用
  主会话的流式管线实时输出。

## 切片（S2/S3/S4 已落地 2026-09-04，实现与设计的偏差见各节注记）

### S2 · 专职子代理 ✅（提交 a3cf182c + 9d22b761）

- 内置 skill `editor-agent`（templates/skills/bundled/，三形态分发验证）；
- 通路改为 **`runBackgroundLlmTask`（sessionless 零残留）而非 runSubagent**：
  不建会话/不写 JSONL/不进列表，比设计的 silent-subagent 更干净；core 增
  `"editor"` profile（review 的只读机制 + 面向用户的 system 前导）；
- IPC：`editor:agentRun`（privileged）→ `SessionBridge.runEditorAgent`。

### S3 · A2UI 交互窗升级 ✅

- 数字体反问协议：结果含 ```a2ui 围栏（v0.9 批次：CreateSurface + Column
  [Text 问题, ChoicePicker 选项, TextField 补充, Button(submit)]）——SKILL.md
  给了逐字模板；
- 浮窗检测围栏后直接渲染 **A2uiSurface**（官方 v0.9 引擎 + basicCatalog）；
  submit 动作从 `getSurfaceModel(sid).dataModel` 读回答案 JSON，作为
  follow-up 续跑（agentTurnsRef 保留问答历史）。

### S4 · 编辑器内联渲染 ✅

- 替换代码与选区做**行级 LCS diff**，浮窗内渲染 ±N 统计 + 红绿行 diff；
- 提交范围在 Monaco 挂 **pending decoration**（淡黄整行底 + 右缘琥珀
  标记，`edagent-pending-*`），应用/关闭浮窗即清除；
- 应用走 `executeEdits` 落回提交时范围（undo 可撤，⌘S 写盘）——比设计
  的 editorWriteFile 更安全（改动先经过用户保存动作）。

## 约束

- core 无 UI 铁律：skill 与 profile 落 core，浮窗/渲染落 desktop renderer；
- 写路径：数字体只产文本，落盘经用户「应用 → 保存」两步确认；
- 后续可选：diff 内联升级为 ghost-text 双栏预览、Surface 历史多轮持久化。
