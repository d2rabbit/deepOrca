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

## 后续切片

### S2 · 专职子代理（core）

- 新 skill `editor-agent`（SKILL.md：编辑器上下文契约——只处理选区相关
  文件、输出 diff 优先、禁止越权写其他路径）；
- `SessionManager.runSubagent({ skill: "editor-agent", silent: false })`
  通路（已有），产物以 unified diff 回传；
- IPC：`editor:agentRun`（filePath + selection + instruction）→
  子代理执行 → 流事件回流编辑器浮窗（进度 + 结果）。

### S3 · A2UI 交互窗升级

- 浮窗从静态表单升级为 A2UI Surface（a2ui 基建已有）：数字体可用
  Surface 表单追问（多选项确认 / 参数补充）；
- 结果以 diff 预览卡渲染，用户「应用 / 放弃」；应用走 editorWriteFile。

### S4 · 编辑器内联渲染

- 结果 diff 直接内联到 Monaco（collapse ranges / decoration 高亮），
  不再切回会话视图查看。

## 约束

- core 无 UI 铁律：子代理与 skill 落 core，浮窗/渲染落 desktop renderer；
- 沙盒：子代理写文件走 editorWriteFile 同一通路，享受既有的路径校验；
- 记忆：editor-agent 的执行走静默标记（isSilentSubagent）以外的可见会话，
  保留 trajectory 可追溯。
