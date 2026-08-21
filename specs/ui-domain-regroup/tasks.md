# 域归组更正 — 任务清单

> 对应设计：[design.md](./design.md)。2026-08-21 立稿未实施。

## T1 品牌漂移闸门迁入设计面板

- [ ] T1.1 DesignPanel 新增 drift 闸门区（baseline/current 输入 + actionRun("design.drift") + 结果渲染），布局与 design.materialize 区并列成"摄取→检测"闭环
- [ ] T1.2 CodeReviewPanel 移除 drift 区块/state/头注释更新（回归纯代码审查：review.run / review.full / CRG 图）
- [ ] T1.3 i18n ×6：`review.drift.*` → `design.drift.*`（键迁移，文案随迁；六语言块同步）
- [ ] T1.4 `specs/pre-production/design.md` E1 末行决策回写（drift UI 落位改设计面板，2026-08-21 推翻 E1d 原落位）

## T2 CRG 锚定代码插件组

- [ ] T2.1 `code/skill.plugin.md` `mcp:` 列表补 `crg`，正文 MCP 段落补 CRG 一行描述
- [ ] T2.2 核对插件中心 MCP 视图读取路径：CRG 条目按 code 分组展示；若 `plugin-mcp-view.ts` 需补 plugin 归属字段则补，否则验证清单声明已足够
- [ ] T2.3 验证 `builtin-plugin.other` 兜底桶不接收 CRG（插件中心 UI 实测）

## 验收门

- [ ] `npm run check` + `npm test` 全绿
- [ ] i18n 六语言：`design.drift.*` 齐全、`review.drift.*` 清零
- [ ] 真机：DesignPanel 跑通一次 drift；插件中心 CRG 在代码组

## 不做

- action 语义/dembrandt 链路/CRG 运行时注册逻辑零变更；CodeReviewPanel 不改名
