# prompt-doc-chain — 任务分解

> 对应 [requirements.md](./requirements.md) / [design.md](./design.md)。

## S0 — 规格三件套

- [x] requirements.md（EARS 10 条，两项 user 裁决立项）
- [x] design.md（数据模型/文档契约/动作改动/a2ui/渲染/测试设计）
- [x] tasks.md

## S1 — core 原型线（prototype.ts）

- [ ] `PrototypeSuiteContent.pdDesign?` 字段 + `PD_DESIGN_CONTRACT`
- [ ] `prototype.pddesign` 动作（定义+run+注册+导出）：读 spec+参考区块 → 子代理 → 结构门 → save_pd_design
- [ ] materialize stage0（无→自动生成并驱动；有→直接用）+ 进度码
- [ ] 原型提示词改为 pdDesign 主驱动（旧数据字节不变）
- [ ] a2ui `save_pd_design` 工具（重置语义同 render_spec）+ `render_spec` 重置 `pdDesign`

## S2 — core UI 线 + 类型镜像（design.ts / design-store / shared/ipc）

- [ ] `UiSuiteContent.uiDesign?` 字段（三处镜像）+ `UI_DESIGN_CONTRACT`
- [ ] design.materialize ui-design stage（有 pdDesign → 生成 uiDesign → render_leafer.uiDesign；无→字节不变）+ 进度码
- [ ] design.revise leafer 提示词注入 uiDesign（存在才注入）
- [ ] 投影：`pd-design.md` / `ui-design.md`

## S3 — 渲染与 i18n

- [x] PrototypeWorkspace：spec 页"提示词"视图 + "重新生成"按钮
- [ ] `progress-label` 4 新码 + i18n ×6

## S4 — 测试与门禁

- [ ] core 测试（pddesign/stage0/失效/ui-design stage/降级字节不变/revise 注入）+ mutation check
- [ ] a2ui/store/渲染测试
- [ ] `npm run check` + `npm test` 全绿，分批提交
- [ ] 真机走查（与 PRD 主题层走查合并执行）
