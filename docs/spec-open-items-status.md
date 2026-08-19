# specs 未收尾项状态台账 — 本阶段逐项确认

> 日期：2026-08-18 · 方法：对 `specs/` 全部 19 个 spec 的 design.md 状态行 + tasks.md 逐项确认，未勾项逐一对照代码/登记记录核实（承重声明抽查取证），按「本阶段待收尾 / 待拍板 / 显式缓期 / 下一版承接 / 废弃」五档归类。
> 上游依据：[pre-production-spec-final-audit.md](./pre-production-spec-final-audit.md)（F5 spec 级终判）· [features/next-version-plan.md](./features/next-version-plan.md)（下一版承接）· [../specs/pre-production/tasks.md](../specs/pre-production/tasks.md)（冻结期范围白名单）。
> **定位与生命周期**：本文是应需建立的**活台账**——回答「哪些还没收尾和完善」。闭合一项就回流到对应 spec 的 tasks.md 勾选并在这里划掉；H 预生产切换完成后整篇归档（届时未收项应已清零或移交 next-version-plan），不与 specs/ 形成双头权威。

---

## 〇、拍板记录（2026-08-18 用户指定收尾批）

以下五项 + 一条域声明为用户当日拍板，构成**指定收尾批**（实施时点 = 本阶段收尾，本文 §一 对应行已标注）：

1. **F4 真机烟雾完整交互清单**：确认收尾批核心项（§一 #1 维持）。
2. **H0-H4 预生产切换**：确认收尾批出口项（§一 #2 维持）。
3. **pm-design-v2 独立导出**：拍板**做**——原 §二"建议做"落定，升入 §一 #8；**同日收尾批已完成，并随后升级格式拍板为 `.ddp`（pm-design 原型）/`.ddu`（ui-design 文档）专用 ZIP 压缩包**（manifest + 源文件 + index.html，`.ddu` 含可独立打开的编译渲染）。
4. **skill-routing 目标表 G3 大技能分片召回注入**：拍板**纳入收尾批实施**——推翻此前"建议缓做"评估（缓做理由 book-distill ≤300 行缓解论不再作为延后依据），升入 §一 #9；**同日收尾批已完成**。
5. **task-tree artifact 快照切换**（tasks.md:35）：拍板**纳入收尾批实施**——推翻原"待真实需求再立项"缓期（file-history per-session 语义冲突作为实施时须解决的约束而非缓期理由——解法=tree 级独立仓库），升入 §一 #10；**同日收尾批已完成**。
6. **域声明**：**deep-design = pm-design + ui-design**——deep-design 域为 pm-design 与 ui-design 的合并域（已同步至 `specs/deep-design/design.md` 状态行与 §六速览）。

未拍板维持原状：bwrap/WSL2、graph-engineering（仍留 §二）；**设置面板路径授权 UI 归位下一版强化清单**（§二——初版台账误入 §一，next-version-plan 强化清单口径为"进下一版窗口"，如需提前入收尾批须另行拍板）。

## 一、本阶段待收尾（冻结期"闭环"范围内，原 10 项——📌 开发项 3 项已于 2026-08-18 收尾批完成）

按优先级排序；🔴 = 出口门槛或明确该做，🟡 = 待人工/待外部条件，📌 = 指定收尾批（2026-08-18 拍板新增）。

| #   | 项                                                                                                                                                        | 来源 spec                             | 档    | 说明                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **F4 真机烟雾：完整交互清单人工走查**                                                                                                                     | pre-production（tasks.md:67）         | 🔴 📌 | 启动烟雾已过并修 5 个真问题（2026-08-18）；剩余 plan mode → 权限 → design.materialize → review.full → 任务树 → **重启恢复（验证 P1-1）** 走查后勾选                                                                              |
| 2   | **H 预生产切换全流程**（H0 前置复核 → H1 `release:version` 定格 → H2 合并 dev → H3 tag `pre-production-baseline` → H4 冻结生效 + AGENTS.md 分支策略更新） | pre-production（tasks.md:81-85）      | 🔴 📌 | 本阶段出口门槛；master 同步决策一并落地                                                                                                                                                                                          |
| 3   | **sandbox 平台能力矩阵（§六）逐格与实现对账后对外宣称**                                                                                                   | sandbox（tasks.md:110）               | 🟡    | 文档级收尾；对账对象含 detect.ts 已登记的降级记录                                                                                                                                                                                |
| 4   | **T2.3 双引擎趋势对拍 + CI 首跑**                                                                                                                         | skill-eval（tasks.md:55）             | 🟡    | S1/S2 产物全落盘（pin v0.9.0 已定版）；对拍需真实 LLM 花费，已登记为预生产测试内容                                                                                                                                               |
| 5   | **B3 book-distill 端到端演练一次**                                                                                                                        | pre-production（tasks.md:24）         | 🟡    | 选一本自有文档蒸馏 → 验证 G1 短名单能召回；需真实 LLM 会话                                                                                                                                                                       |
| 6   | **gitmcp 任务 12 手测清单**                                                                                                                               | gitmcp-local-module（tasks.md:75）    | 🟡    | `desktop:start` 下：添加合法/非法/重复 → 启停/重建/删除 → MCP 页签权限 → 会话内 AI 调用 search_documentation → 断网检索                                                                                                          |
| 7   | **外部 MCP server 实机验证**                                                                                                                              | mcp-sdk-migration（design.md §8-3）   | 🟡    | dart/serena/expo 的 listTools + callTool 待 GUI 人工验证（subagent 无桌面访问，spec 已如实记载）                                                                                                                                 |
| 8   | ~~独立导出（`.ddp`/`.ddu` 专用 ZIP 压缩包）~~ **✅ 已收尾（2026-08-18 收尾批 + 格式拍板）**                                                               | pm-design-v2（tasks.md:154）          | ✅    | DesignPanel 双管线 ⬇ 按钮 → `design:exportPackage` 特权通道 → 零依赖 zip 写入器（dd-package.ts）→ `.ddp`/`.ddu`（manifest+源文件+index.html）→ 原生保存对话框；React 导出/版本切换 UI 维持不做                                   |
| 9   | ~~G3 大技能分片召回注入~~ **✅ 已收尾（2026-08-18 收尾批）**                                                                                              | skill-routing（design.md §一 目标表） | ✅    | `skill-sharding`（标题分片/索引/行边界硬切）+ `SkillShardRecaller`（VectorIndex 召回+缓存）+ session 接线（大技能注入 header+索引+top-K 小节）；fail-open 全文回退；9 用例测试在树                                               |
| 10  | ~~artifact 快照切换（file-history 复用）~~ **✅ 已收尾（2026-08-18 收尾批）**                                                                             | task-tree（tasks.md:35）              | ✅    | tree 级 file-history 仓库（`<treeDir>/file-history`，ref 冲突解法=独立仓库）：appendStep/merge 自动快照 + `meta.snapshot` stamp、面板 ⏪ 显式恢复、switchBranch 出向安全 checkpoint+入向快照恢复（全 fail-open）；4 用例测试在树 |

> 1/2 完成即本阶段出口；#8-#10 开发项已于收尾批完成（✅ 行）；余下全部为人工/外部条件项——**逐步操作手册见 [`pre-production-manual-test.md`](./pre-production-manual-test.md)（含前置/步骤/预期/回写位置，按 ①Windows 真机批 ②文档批 ③LLM 花费批 ④出口批 顺序执行）**。

## 二、待拍板/下一版窗口的评估建议（2026-08-18 口径；同日 pm-design 导出与 G3 已拍板移出）

| 项                                      | 建议                  | 备注                                                                                                        |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| 设置面板路径授权可见/可撤销             | **建议做**（~0.5 天） | next-version-plan 强化清单口径：**进下一版窗口**；初版台账误入本阶段 §一 已归位。如需提前入收尾批须另行拍板 |
| sandbox Linux bwrap / Windows WSL2 后端 | **建议不做**          | 任务 17/18 未动工；detect.ts 诚实降级在树，不静默                                                           |
| graph-engineering 收编                  | **建议关闭**          | 见 next-version-plan 登记行                                                                                 |

## 三、显式缓期/登记边界（有记录有理由，**不算欠账**）

- **sandbox** 已知边界 2-4：沙箱内 DNS/mach 未验证；沙箱内强制 `/bin/bash`（zsh 在 deny-default 下无法启动，实证）；网络条款按会话快照（settings 中途改只对新会话生效）。
- **pm-design-v2**：版本切换 UI 不做、A2UI/OpenUI → React 代码导出不做、pm-analyst/analysis.json 缓期（管线集合 2 条为已拍板偏差）。
- **deep-design**：PDF 导出以 iframe print 替代（F5 已记正向偏差）；设计系统 3→9 为超 spec 演进。
- **activity-frames**：Linux/Windows 屏幕捕获不做（nocta-recorder 为 macOS 二进制）；OAuth App 连接不做。
- **define-action**：Phase 4（defineAction 成为所有新能力标准入口）为渐进演进方向，非本阶段承诺项。

## 四、下一版本承接（`next-version-plan` 三主线，不属本阶段）

- **module-system**：P 轨/D 轨全部任务未开工（⬜ 规划性）→ 下一版主线 B（B1 冷插拔 + B2 热激活）整包承接。
- **android-dev-kit**（A1-A5）、**cad-3d-generation**（三阶段）、**desktop-pet**（P1-P10）：⬜ 规划性零代码；desktop-pet 的 P1 悬浮窗按 spec 另立项。
- 远程访问 M1-M3（当前零代码，`main/remote/` 不存在）。

## 五、废弃（无欠账）

- **behavior-memory**：2026-08-17 拍板作废，由 `@deeporca/memory`（TDAI L0-L3）承接；旁系 activity-frames 已另行落地。
- **harmonyos-dev-kit**：曾完整落地后整体下线；重启属 `next/*`；反向命题（DeepOrca 跑在鸿蒙 PC）2026-08-18 调研"先不做"（`research/platform/2026-08-18-harmonyos-pc-electron-port-feasibility.md`）。

## 六、19 spec 逐个确认速览

| spec                | 确认结论                            | 未收尾项（指向本文档节）                                                                       |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| a2ui-integration    | ✅ 已实现（状态行 2026-08-18 回写） | 无                                                                                             |
| activity-frames     | ✅ 已实现                           | 边界项见 §三                                                                                   |
| android-dev-kit     | ⬜ 规划性                           | §四                                                                                            |
| behavior-memory     | ❌ 废弃                             | §五                                                                                            |
| cad-3d-generation   | ⬜ 规划性                           | §四                                                                                            |
| deep-design         | ✅ 已实现（超 spec 演进）           | 偏差记录见 §三；**域声明（2026-08-18）：deep-design = pm-design + ui-design**（§〇-6）         |
| define-action       | ✅ 已实现                           | Phase 4 见 §三                                                                                 |
| desktop-pet         | ⬜ 规划性（调研定稿）               | §四                                                                                            |
| gitmcp-local-module | ✅ 任务 1-11 全勾                   | 任务 12 手测 → §一 #6                                                                          |
| harmonyos-dev-kit   | ❌ 废弃（下线）                     | §五                                                                                            |
| mcp-sdk-migration   | ✅ 已完成                           | §8-3 实机验证 → §一 #7                                                                         |
| module-system       | ⬜ 规划性（全 0 代码）              | §四（下一版主线 B）                                                                            |
| pm-design-v2        | 🟡 主体落地                         | 独立导出（.ddp/.ddu 包）→ §一 #8 ✅ 收尾批完成；其余未做项 → §三；**tasks 复选框回写债 → §七** |
| pre-production      | 🟡 收尾中                           | F4/H0-H4/B3 → §一 #1/#2/#5                                                                     |
| sandbox             | 🟡 主体全落地                       | 能力矩阵 → §一 #3；路径授权 UI/bwrap/WSL2 → §二                                                |
| skill-eval          | 🟡 S1/S2 落地                       | T2.3 对拍 + CI 首跑 → §一 #4                                                                   |
| skill-routing       | 🟡 部分实现（显式）                 | G3 → §一 #9（📌 拍板纳入收尾批）                                                               |
| task-tree           | ✅ P0-P2 + P1 收尾                  | 快照切换 → §一 #10（📌 拍板纳入收尾批）                                                        |
| text-embedding      | ✅ 已实现（正向偏差）               | 无                                                                                             |

## 七、本次确认新发现的文档债

1. **specs/pm-design-v2/tasks.md 复选框未回写**（skill-eval 同类问题第二处，F5 只修了 design.md 状态行）：DesignPanel/design.ts/design-store（含 versions[] FIFO 20 快照）/Design IPC 五通道（list/read/delete/saveFormState/readFormState）/`rail.design` i18n/roadmap §六 条目等**已实现项仍为 `- [ ]`**（代码逐一验证在树）。真正未做的只有 5 处：版本切换 UI（tasks.md:139，已拍不做）、独立导出（:154，**已实现 → §一 #8，格式为 .ddp/.ddu 压缩包**）、A2UI→React（:161，已拍不做）、OpenUI→React（:167，已拍不做）、pm-analyst skill 创建+注入点验证（:45-46/:66-67，缓期）。应按 skill-eval 先例（`fbcf8e8d`）回写勾选并在未做项上标注终态。
2. 其余无新债——skill-eval/text-embedding/builtin-inventory/pm-design 状态行四项 F5 文档债已于 `fbcf8e8d` 清偿完毕。

---

## 维护约定

- 本文**不替代** specs/ 的勾选状态：闭合一项 → 先回写来源 spec（tasks.md 勾选或 design.md 状态行）→ 再更新本文对应行。
- §二 的评估建议一经拍板：结论写入本文对应行并同步 next-version-plan 或 specs。
- H 预生产切换完成后：本文 §一 应清零（或余项全部显式移交），整篇移入 `research/archive/` 或 `audit-archive/` 登记，避免成为长期平行状态源。
