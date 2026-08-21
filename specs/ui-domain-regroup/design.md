# 域归组更正 — drift 闸门入设计维度 / CRG 锚定代码插件（ui-domain-regroup）

> **日期**：2026-08-21（下班前立稿，**同日实施完成**——留痕见 [tasks.md](./tasks.md)；真机 UI 实测待桌面环境）
> **拍板**：用户口头决策——品牌漂移闸门**放进设计维度**（推翻 specs/pre-production E1d "drift 入 review 面板"的落位）；CRG（code-review-graph）MCP **锚定在代码插件组保留，不放"其他"**。
> **性质**：UI/归类重组，零行为变更；全部为既有能力的搬迁与归组修正。

---

## 一、现状（证据）

### 1. 品牌漂移闸门（design.drift，E1d）在代码审查面板

- UI 在 `packages/desktop/src/renderer/components/CodeReviewPanel.tsx`：drift 输入区（baseline 默认 `.deeporca/design-baseline.json` + current URL）+ `review.drift.*` i18n 键（6 语言块）。
- action 本体在 `packages/core/src/actions/design.ts`（`design.drift`，dembrandt 基线对比，确定性零 LLM）——归属设计域，无需动。
- 落位依据：`specs/pre-production/design.md` E1 末行 "design.drift 作为 review 维度" + commit `09c9445`（E1d drift 入 review 面板）。**本 spec 推翻该 UI 落位**：审查面板名实（CodeReviewPanel=代码审查）与品牌/设计语义冲突。

### 2. CRG（code-review-graph）MCP 未锚定代码插件

- CRG 的 skills/actions 已在代码插件清单（`packages/core/templates/plugins/code/skill.plugin.md`：smart-code-review / review.full / crg.reindex / crg.visualize），**但 mcp 列表只有 codegraph、serena——CRG 不在其中**。
- MCP 侧注册在 `packages/desktop/src/main/plugin-mcp-view.ts`：以 builtin "analysis-layer MCP server" 身份直接 push 进列表（generic builtin 标记），插件中心 MCP 视图里没有代码插件归属 → 展示上落入未分组/"其他"类。
- 实现层 CRG 是 core 内置 Node 直查 SQLite（`actions/crg-controller.ts`），MCP server config 由 `buildCrgMcpServerConfig` 构造——搬迁只影响**归组展示与清单声明**，不动运行链路。

## 二、目标态

1. **drift 闸门 → 设计维度**：UI 从 CodeReviewPanel 迁至 DesignPanel（`design.materialize` 所在面板），与 design.extract（品牌摄取）同面板成对出现——"摄取基线 → 检测漂移"闭环在同一界面。CodeReviewPanel 回归纯代码审查（review.run / review.full + CRG 图）。
2. **CRG → 代码插件组保留**：`code/skill.plugin.md` 的 `mcp:` 列表补 `crg`；插件中心 MCP 视图的 CRG 条目显示代码插件归属（category=code），确保任何"未分组/其他"兜底桶不接收它。

## 三、改动清单（tasks 详见 tasks.md）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `desktop/renderer/components/DesignPanel.tsx` | 新增 drift 闸门区（baseline/current 两输入 + 运行按钮 + 结果渲染，从 CodeReviewPanel 平移） |
| 2 | `desktop/renderer/components/CodeReviewPanel.tsx` | 移除 drift 区块与相关 state；头注释更新为纯代码审查定位 |
| 3 | i18n ×6（messages.ts en/zh + ja/ko/zh-hk/zh-tw） | `review.drift.*` 键迁移为 `design.drift.*`（文案不变，键名与归属对齐）；CodeReview/Design 面板标题按需微调 |
| 4 | `core/templates/plugins/code/skill.plugin.md` | `mcp:` 列表补 `crg`；正文 MCP 服务器段落补 CRG 描述一行 |
| 5 | `desktop/main/plugin-mcp-view.ts` | CRG 条目挂 code 插件归属（若 MCP 视图结构支持 category/plugin 字段；无则仅靠 #4 清单声明 + 验证展示端读取路径） |
| 6 | `specs/pre-production/design.md` | E1 末行补记 2026-08-21 决策回写："drift UI 落位由 review 面板改为设计面板（本 spec 推翻 E1d 落位），action 归属不变" |

## 四、验收

- DesignPanel 能跑通 design.drift（baseline 文件 + 当前 URL → findings）；CodeReviewPanel 不再出现任何品牌/设计字样。
- 插件中心：CRG 展示在代码插件组；`builtin-plugin.other` 桶无 CRG。
- `npm run check` + `npm test` 全绿；i18n 六语言键完整（design.drift.* 存在、review.drift.* 清零）。

## 五、不做（Non-goals）

- 不改 `actions/design.ts` / drift 的 action 语义、不改 dembrandt 链路。
- 不动 CRG 的运行时注册/启停逻辑（`plugin-mcp-view.ts` 的 push 顺序、toggle 行为保持）。
- 不顺手重命名 CodeReviewPanel → ReviewPanel（原 A 方案作废，本 spec 采用 B 方向：drift 迁设计）。
