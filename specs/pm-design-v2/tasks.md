# PM-Design V2 — 任务核对表

> 实现状态对账（2026-08-15 差距审计）：P0 存储与 Action、P2 面板已实现（design-store.ts / actions/design.ts / DesignPanel.tsx），下方未勾选框为历史遗留未更新；本批补齐「一键具现化」按钮。**明确偏差**：管线集合为 2（openui|design，A2UI 交互层按三层定位决策排除）；analysis.json 与 pm-analyst 显式缓期（路由已降级 flash 判定，无消费方）；版本切换 UI 与导出（iframe 内打印已有，独立导出通道）列为后续。

# PM-Design V2 任务分解

> **关联设计文档**：[design.md](./design.md)
> **状态**（2026-08-18 终判回写）：P0 存储/Action、P2 面板、P3 预览迭代闭环（PrototypePanel/DesignPreview composer → update_openui/update_design/update_surface + design-store 版本快照 FIFO 20 版 + 预览联动 + 渲染错误纠正回路）已实现；未做：版本切换 UI（快照在磁盘，已拍不做）、React 代码导出（已拍不做）；P4 独立导出已实现（.ddp/.ddu 专用压缩包，2026-08-18 收尾批+格式拍板）。**2026-08-18 评估**（冻结期）：P3 迭代闭环按当前预览面板实现方案判定完成（不再补 DesignPanel 迭代按钮）；见 `docs/pre-production-spec-final-audit.md`。

---

## P0：设计文档 + 工作区骨架

### P0-设计（已完成 ✅）

- [x] 编写 `specs/pm-design-v2/design.md` —— 完整架构设计（10 节 + 2 附录）
- [x] 编写 `specs/pm-design-v2/tasks.md` —— 本任务分解
- [ ] 更新 `docs/features/feature-roadmap.md` §六 —— 增加 PM-Design V2 条目

### P0-实现（待开发）

- [ ] `use-panel-layout.ts` —— `SidebarView` 联合类型增加 `"design"`
- [ ] `App.tsx` —— Rail 区在 Code Review（L1076-1083）下方插入 Design RailButton
  - [ ] 新增 `IconDesign` 图标组件（画板/调色板语义）
  - [ ] `<RailButton active={panelOpen && sidebarView === "design"} onClick={() => selectView("design")}>`
- [ ] `App.tsx` —— 视图分发（L1138-1187）增加 `sidebarView === "design" → <DesignPanel />`
- [ ] `components/DesignPanel.tsx` —— 工作区空壳
  - [ ] Header（标题 + 工具栏）
  - [ ] CompositeAction 区（一键按钮，暂不接线）
  - [ ] EmptyState（"尚无设计产物"）
- [ ] `i18n/messages.ts` + 4 locale 文件 —— 增加 `rail.design` + DesignPanel 标签
  - [ ] `zh-hans`（默认）: `rail.design = "设计"`
  - [ ] `zh-hant`: `rail.design = "設計"`
  - [ ] `ja`: `rail.design = "デザイン"`
  - [ ] `ko`: `rail.design = "디자인"`

**P0 交付**：左侧可见空的"设计"工作区，用户知道模块存在。

---

## P1：design.materialize + pm-analyst（一键核心）

### P1-1: pm-analyst Skill

- [ ] 创建 `packages/core/templates/plugins/design/skills/pm-analyst/SKILL.md`
  - [ ] YAML frontmatter（name, description）
  - [ ] 需求分析框架（模块划分 → 用户故事 → 交互流程 → 管线推荐）
  - [ ] JSON 输出格式说明
  - [ ] 管线路由决策树（附录 A）
  - [ ] 示例（2-3 个 input/output 范例）

### P1-2: design.materialize Action

- [ ] 创建 `packages/core/src/actions/design.ts`
  - [ ] `designMaterializeDefinition` —— ActionDefinition（inputSchema + outputSchema）
  - [ ] `designMaterializeRun` —— 执行流程（5 步：采集 → 分析 → 路由 → 生成 → 持久化）
  - [ ] `toolForPipeline(pipeline)` —— 管线 → MCP 工具名映射
  - [ ] `argsForPipeline(pipeline, analysis)` —— 管线 → MCP 工具参数构造
- [ ] `packages/core/src/actions/index.ts` —— 导出 design actions
- [ ] `packages/core/src/index.ts` —— 顶层导出

### P1-3: Action 注册

- [ ] `packages/core/src/session.ts` —— 构造器注册 `design.materialize`（第 16 个 action）
  - [ ] `this.actionRegistry.register(designMaterializeDefinition, designMaterializeRun);`
- [ ] 验证 `runSubagent` 注入点可用（pm-analyst 子会话）
- [ ] 验证 `executeMcpTool` 注入点可用（调用 a2ui MCP 工具）

### P1-4: DesignPanel 按钮接线

- [ ] `components/DesignPanel.tsx` —— 一键按钮接线
  - [ ] 点击弹出需求输入框（或聚焦 Composer 预填模板）
  - [ ] `api.actionRun("design.materialize", { requirement: "..." })`
  - [ ] 进度显示（`api.onActionProgress` 按 actionId 过滤）

### P1-5: 测试

- [ ] `packages/core/src/tests/phase-actions.test.ts` —— 增加 design.materialize 注册测试
- [ ] 手动验证：需求 → 分析 → 路由 → 原型 → 预览全流程

**P1 交付**：一键需求具现化可用（无持久化，会话内有效）。

---

## P2：设计产物持久化 + 列表渲染

### P2-1: 持久化层

- [ ] 创建 `packages/core/src/actions/design-store.ts`
  - [ ] `saveDesignArtifact(root, data)` —— 创建 `.deeporca/designs/<uuid>/` 目录 + 写文件
  - [ ] `listDesignArtifacts(root)` —— 读取 `.deeporca/designs/index.json`
  - [ ] `readDesignArtifact(root, id)` —— 读取单个产物
  - [ ] `deleteDesignArtifact(root, id)` —— 删除产物 + 更新索引
  - [ ] `updateDesignArtifact(root, id, patch)` —— 更新产物（迭代后调用）

### P2-2: design.materialize 接入持久化

- [ ] `actions/design.ts` —— Step 5 调用 `saveDesignArtifact()` 替代临时变量

### P2-3: IPC

- [ ] `packages/desktop/src/shared/ipc.ts` —— 增加 Design IPC 通道
  - [ ] `DesignList = "design:list"`
  - [ ] `DesignOpen = "design:open"`
  - [ ] `DesignDelete = "design:delete"`
- [ ] `packages/desktop/src/main/` —— IPC handler 实现（调用 core design-store）

### P2-4: DesignPanel 列表渲染

- [ ] `components/DesignPanel.tsx` —— Artifacts 列表区
  - [ ] 挂载时调用 `api.designList()` 加载索引
  - [ ] Filter Tabs（全部 / A2UI / OpenUI / .dd）
  - [ ] ArtifactCard 循环渲染（图标 + badge + 标题 + 摘要 + 时间）
  - [ ] [打开预览] 按钮 → 读取产物 → 注入 usePreview
  - [ ] [删除] 按钮 → 确认 → `api.designDelete(id)` → 刷新列表

### P2-5: 预加载层

- [ ] `packages/desktop/src/preload/index.ts` —— 暴露 `design.list/open/delete` API

**P2 交付**：设计资产可管理，跨会话持久。

---

## P3：对话迭代闭环

### P3-1: 迭代入口

- [ ] `components/DesignPanel.tsx` —— ArtifactCard [对话迭代] 按钮
  - [ ] 点击 → Composer 注入上下文消息（产物 ID + 管线 + 迭代模板）
  - [ ] 用户填写修改需求 → 发送
  - [ ] Agent 调用 `update_surface` / `update_openui` / `update_design`

### P3-2: 版本快照

- [ ] `actions/design-store.ts` —— 迭代时保存版本到 `meta.json.versions[]`
  - [ ] 每次迭代前快照当前 prototype 文件
  - [ ] 版本记录：{ version, createdAt, note }
- [ ] DesignPanel 版本切换 UI（可选：ArtifactCard 展开版本历史）

### P3-3: 预览联动

- [ ] 迭代后右侧 Preview 自动更新（现有 usePreview 已支持 delta-patch）
- [ ] DesignPanel 列表 updatedAt 刷新

**P3 交付**：从产物列表发起迭代，闭环完成。

---

## P4：导出与交付

### P4-1: DeepDesign 导出

- [x] **独立导出（.ddp / .ddu 专用压缩包格式，2026-08-18 格式拍板）**——台账 `docs/spec-open-items-status.md` §一 #8；React 代码导出与版本切换 UI 维持不做
  - [x] 格式定义：`.ddp`（pm-design 原型导出）/ `.ddu`（ui-design 文档导出）——特殊 ZIP 压缩包：manifest.json（format/formatVersion/kind/title/artifactId/pipeline/exportedAt/generator）+ 源文件 + index.html（.ddu 的 index.html 为可独立打开的编译渲染；.ddp 的 index.html 为查看器兜底页——OpenUI Lang 仅在应用内 React 运行时渲染，无独立编译器）
  - [x] `main/tools/dd-package.ts`：零依赖 ZIP 写入器（node:zlib deflate + 手写 CRC32/zip 结构，store 兜底）+ buildDdpPackage/buildDduPackage；测试 `dd-package.test.ts` 4 用例（结构往返/store 兜底/两种 manifest/查看器转义）+ 系统 unzip 交叉验证
  - [x] DesignPanel 双管线 [⬇] 按钮（i18n 六语言）
  - [x] Electron `dialog.showSaveDialog()` → 写文件（`DesignExportPackage` 特权通道，同 SessionExport 先例）

### P4-2: A2UI 导出（可选）

- [ ] A2UI Surface JSON → React 组件代码
  - [ ] 转换器：组件树 → JSX（参考 `a2ui/A2uiSurface.tsx` 的 ComponentRenderer 映射）
  - [ ] 输出 `.tsx` 文件 + 样式

### P4-3: OpenUI 导出

- [ ] OpenUI Lang → 标准 React 代码
  - [ ] SDK `@openuidev/lang-core` 已有编译能力
  - [ ] DesignPanel [导出 React] 按钮

**P4 交付**：设计产物可脱离 DeepOrca 交付给开发团队。

---

## 依赖关系

```
P0（设计文档 + 骨架）
  └── P1（materialize + pm-analyst）
        └── P2（持久化 + 列表）
              └── P3（迭代闭环）
                    └── P4（导出交付）
```

P0 设计文档可独立完成（本次交付）。P0 实现到 P4 严格顺序依赖。

---

## 风险与注意事项

| 风险                                                    | 缓解措施                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| pm-analyst 子代理输出不稳定（JSON 格式漂移）            | Skill 中提供严格的 JSON schema + 2-3 个 few-shot 示例；runSubagent 增加输出校验 + 重试      |
| 管线路由判断错误（推荐 A2UI 但用户想要 .dd）            | `pipeline` 参数支持用户手动覆盖（`"auto"` 为默认，但可显式指定）                            |
| design.materialize 与现有 slash 命令功能重叠            | 不冲突：slash 命令是手动单管线入口，materialize 是自动路由一站式入口，两者并存              |
| 持久化文件膨胀（多次迭代产生大量版本）                  | P3 版本快照设上限（默认保留最近 10 个版本），meta.json 记录总数                             |
| A2UI surface 持久化（`prototypes/`）与 designs 索引重复 | 不合并：prototypes 是管线内部状态，designs 是 PM 视角索引；a2ui 产物在 designs 中存快照副本 |
