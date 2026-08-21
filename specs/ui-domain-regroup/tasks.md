# 域归组更正 — 任务清单

> 对应设计：[design.md](./design.md)。2026-08-21 立稿；**同日实施完成**（留痕见下）。

## T1 品牌漂移闸门迁入设计面板

- [x] T1.1 DesignPanel 新增 drift 闸门区（baseline/current 输入 + actionRun("design.drift") + 进度订阅 + 结果渲染含逐 token 明细折叠），置于 materialize 区之后成"摄取→检测"闭环（2026-08-21 实施）
- [x] T1.2 CodeReviewPanel 移除 drift 区块/state/prettyJson，头注释更新为纯代码审查定位并记录迁移去向（ReviewActionId 收敛为 review.full）
- [x] T1.3 i18n ×6：`review.drift.*` → `design.drift.*` 九键全量迁移（messages.ts en/zh + ja/ko/zh-hk/zh-tw；核验：全仓 review.drift 残留 0，design.drift 六目录各 9 键）
- [x] T1.4 `specs/pre-production/design.md` E1 末行决策回写（2026-08-21 推翻 E1d 落位，action 归属不变）

## T2 CRG 锚定代码插件组

- [x] T2.1 `code/skill.plugin.md` `mcp:` 列表补 `code-review-graph`（精确 server 名，与 codegraph/serena 同为全名），正文 MCP 段落补 CRG 描述一行
- [x] T2.2 展示链核验：PluginMcpPanel → pluginBuiltinGroups → session-bridge → core `listBuiltinPluginGroups` 按清单 `mcp:` 匹配（session.ts groupMcp）——`PluginMcpServer` 无 category 字段，按设计 #5 兜底条款靠清单声明即可，plugin-mcp-view.ts 无需改动（其合成 CRG 条目的路径已在分组测试中复刻）
- [x] T2.3 新增 `tests/plugin-grouping.test.ts`：CRG 条目被 code 组认领、`other` 兜底桶不接收（清单匹配路径的直接证明；插件中心 UI 实测并入真机项）

## 验收门

- [x] `npm run check` + `npm test` 全绿（含新增分组测试）
- [x] i18n 六语言：`design.drift.*` 齐全、`review.drift.*` 清零（grep 全仓 0 残留）
- [ ] 真机：DesignPanel 跑通一次 drift；插件中心 CRG 在代码组（待桌面环境，命令行链路已由测试锁定）

## 不做

- action 语义/dembrandt 链路/CRG 运行时注册逻辑零变更；CodeReviewPanel 不改名 ✓（本次未触碰）
