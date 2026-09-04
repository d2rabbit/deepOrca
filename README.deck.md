# README.deck — `docs/ui-ux-redesign-proposal` 分支专属说明

> ## ⏸ 分支状态：搁置（ON HOLD）· 2026-09-04 标记
>
> **主干整体策略发生改变**：产品线转向构建 **Swift 与 .NET 的原生系统实现**，Electron 内的 Deck 交互层实验暂不再推进。
>
> - **搁置 ≠ 废弃**：E0–E22 的全部交付（代码、测试、台账、真机对拍结论）完整保留在本分支，随时可恢复；
> - **恢复条件**：当原生实现路线的交互层方案需要参照/回流，或 Electron 线重启时，从本分支继续——恢复前建议先把最新的冻结线基座再并入一次（当前基座已落后 `feat/modern-ui-redesign` 若干提交）；
> - **隔离保证**：搁置期间本分支不接收新提交，也不影响任何其他分支；经典交互层是默认布局，产品功能不受本分支状态影响。

> 本文件只存在于本分支，是这条分支的"入口说明书"。主干共用的 `README.md` 在本分支上保持原样不动，仓库的产品级说明仍以它为准；本文件描述的是**这条分支自身**。

## 这条分支是什么

`docs/ui-ux-redesign-proposal` 是 **DeepOrca 下一版本交互层（Orca Deck）的演进主线**——一次大 redesign 重构：终态预期是 Deck 替换现有经典交互层成为产品 UI。当前它以**实验布局**形态随产品并行存在：

- 默认布局仍是经典层；在 设置 → 外观 → 界面布局 里切到 **Orca Deck**，或 `localStorage.setItem("deeporca.layout", "deck")` 后重载即可进入；
- Deck 全部代码隔离在 `packages/desktop/src/renderer/deck/` 一个目录内，自带 CSS 与六主题（Liquid Glass 默认），经 `React.lazy` 独立 chunk 加载；
- **可回退是硬约束**：deck chunk 加载失败/挂载异常会自动写回经典布局；Deck 内左上角"← 切回经典"入口永远可达。

## 基座与分支关系

- 本分支已并入冻结线 `feat/modern-ui-redesign`（潮汐舞台交互层等 100+ 提交）作为演进基座——合并冲突以冻结线内容为核心解决，其 K 线规划在本分支降为主线 E 保留（见 `docs/features/next-version-plan.md` 主线 D/E）。
- **冻结分支本身不在这条分支上改动**；经典交互层（`App.tsx`、`ui.css`、既有 hooks/components）在本分支上也保持零触碰——这是 experiment-plan §1 的隔离红线。deck 对经典层的唯一合法动作是**只读复用**（如 `StreamdownView`、`MermaidDiagram`、`lib/token-usage`、`lib/model-utils`、`ui` 的 `FileIcon`）。
- `core / preload / shared IPC` 零改动：deck 消费同一个 `window.deeporca` 契约。经典层仅有的两处挂点是 `main.tsx` 布局分支与设置面板的布局开关（各 ≤10 行）。

## 交付台账（E0–E22）

全部批次的过程记录、口径取舍与验收证据集中在：

**[`docs/research/ui-ux/design/experiment-plan.md`](./docs/research/ui-ux/design/experiment-plan.md)**（§1 隔离红线 / §2 挂点 / §3 可回退 / §4–§5 E 系分期 / §6 度量与退出 / §8–§16 并线与 E15–E22 批次）

速览（本分支新增/演进的批次）：

| 批次 | 内容 |
| --- | --- |
| E0–E14 | 骨架 → 核心闭环 → 功能面板 → 浮层栈/命令层/六主题 → 车间墙/任务树/知识源/审查完全体 → Studio 样板 → 交互补全与引擎深度集成（详见台账与各交付提交） |
| 合并批次 | 并入 modern-ui-redesign 基座；deck 适配 knowledge/memory 拆分与 Streamdown 渲染管线 |
| E15 | 控制中心模型/思考档位热切换 + 压缩阈值用户自定义对齐 |
| E16 | 车间墙会话操作簇（改名/导出/归档/删除两步确认）+ archmaps 内联预览（沙箱 iframe/Mermaid/JSON） |
| E17 | 导出 toast 反馈通路（onNotify 双通道）+ CC 上下文水位色阶 |
| E18 | AGENTS.md 就地读 + 符号检索 + 通知落档（"错过 ≠ 丢失"覆盖用户操作） |
| E19 | 符号调用关系 lite 视图（focus/callers/callees 分组） |
| E20 | 真机对拍回归（Playwright + 桩注入），修复 archmap resolve 形状守卫缺陷 |
| E21 | 破坏性操作一致化：git 丢弃 / 任务树放弃分支两步确认 |
| E22 | 阅读体验对齐：wiki 页 / AGENTS.md 经共享 Streamdown 管线渲染 + 文件树 FileIcon |

## 验证口径

```bash
npm run check        # typecheck + lint + format + deck-size 门禁（deck/**/*.{ts,tsx} ≤2000 行）
npm test             # 全仓四套件；desktop 含 deck 系列（E 系每批钉行为用例）
npm run desktop:dev  # 真机跑，切 deck 布局体验
```

- deck 测试位于 `packages/desktop/src/tests/deck-*.test.ts`，共用 `tests/dom-harness.ts`（jsdom + `createApiStub`）。注意：`renderer/api.ts` 在模块加载时捕获 `window.deeporca`，因此**一个测试文件只能建一个 stub，后续用例原地改 fixture**。
- 真机对拍方法（E12/E20 先例）：`dist/renderer` 注入 `__stub.js` IPC 桩 + 静态伺服 + Playwright 逐屏断言；桩方案未入库，方法见台账 §14。

## 当前留白（均有外部前置）

- action 取消按钮：registry 已有 CANCELLED 面，但 IPC 未暴露取消句柄——等 H 线 module-system。
- doc-wiki 第七知识源卡：等 D 线（`specs/doc-wiki/`）实施。
- 符号关系图画布化：lite 分组视图已交付，画布留待知识源浮层宽窗化。
- Studio/审查运行历史仅会话内存（≤20 条）：落盘口径待拍板。

## 协作约定

1. 本分支只做 Deck 侧演进；要动 `core/`、`preload/`、经典层或共享契约时，先在本文件与 experiment-plan 里记录理由与方案再动手。
2. 每批交付 = 代码 + i18n 六语言（`messages.ts` + `locales/{ja,ko,zh-hk,zh-tw}.ts`）+ 行为测试 + 台账回写，`npm run check && npm test` 全绿后提交。
3. 提交信息沿用 Conventional Commits，批次号（E 系）写入首行便于台账对照。
4. 远端同名分支 `origin/docs/ui-ux-redesign-proposal` 是本分支的唯一推送目标。
