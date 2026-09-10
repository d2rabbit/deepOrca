# prd-theme-layer — 任务分解

> 对应 [requirements.md](./requirements.md) / [design.md](./design.md)。每 WP 完成即过 typecheck + 相关测试，按 WP 分批提交。

## WP0 — 规格三件套

- [x] requirements.md（EARS 14 条，含四项 user 裁决立项依据）
- [x] design.md（数据模型 / 存储 / IPC / a2ui / core / 渲染 / 测试设计）
- [x] tasks.md

## WP1 — 存储层（design-store.ts）

- [ ] `DesignTheme` / `DesignThemeRef` 类型 + `DesignSuiteMeta`/`DesignSuiteSummary` 主题字段 + `DesignIndex.themes?`
- [ ] 主题 CRUD：list/create/update/delete（delete 解绑套件 meta+索引）
- [ ] `assignSuiteTheme`（meta+索引+事件，不追加版本）
- [ ] `createDesignSuite` 主题字段；`change:"theme"` 事件
- [ ] store 测试：CRUD 往返 / 解绑 / assign / 旧数据缺省

## WP2 — IPC + MCP 通道

- [ ] shared/ipc.ts：5 条通道常量 + `DesignTheme` 类型 + `DesktopApi` 方法
- [ ] preload 单行接线；design-ipc 五个 handler（root-pinned，写走 privileged）+ `DesignStoreOps` 扩展
- [ ] a2ui：render_spec/render_leafer 主题字段入 schema 与 meta；read_suite_version 载荷附主题；重置逻辑不触及主题
- [ ] 测试：design-ipc 通道根校验；a2ui 三工具主题持久化

## WP3 — core 动作

- [ ] `PrototypeSpecInput` 主题字段 + 参考拉取/预算装配（每篇 8K、总 24K）+ 提示词区块 + 缺参考跳过 + render_spec 透传
- [ ] `readSuiteVersion` 帮助函数解析载荷主题字段
- [ ] `design.materialize` 主题透传 render_leafer
- [ ] 测试：注入全文/截断/缺失跳过/无参考字节不变/透传

## WP4 — 渲染层

- [ ] WorkspaceDirectory：主题分组区 + CRUD + 套件 归属主题/阶段 指派菜单 + `"theme"` 事件刷新
- [ ] PrototypeWorkspace 编辑器：设计上下文折叠区（主题/阶段/继承/参考选择器）接入 runSpec
- [ ] DesignWorkspaceFrame `railHeader` 槽位 + ThemeStrip（两工作台只读主题条，无主题隐藏）
- [ ] design-workspaces.css 配套样式
- [ ] 测试：目录分组渲染 stub 测试；ThemeStrip 条件渲染

## WP5 — i18n 与收尾

- [ ] `designTheme.*` 键 ×6 语言目录（typecheck 强制完整）
- [ ] 全量 `npm run check` + `npm test`
- [ ] 关键回归 mutation check（参考注入 / 主题删除解绑）
- [ ] 真机走查移交预生产清单（两处入口 / 继承注入效果 / UI 自动继承）

## 验收对照

- EARS 1–4 → WP1 测试；EARS 5–6 → WP2 测试；EARS 7–9 → WP3 测试；EARS 10–12 → WP4 + WP5 渲染测试；EARS 13–14 → typecheck + 兼容测试。
