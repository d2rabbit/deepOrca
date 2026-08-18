# 预生产人工收尾手册 — 7 项待测清单（执行版）

> 日期：2026-08-18 · 来源：`docs/spec-open-items-status.md` §一（收尾批开发项已全部完成，余 7 项均为人工/外部条件项）
> 用途：**等你有时间时照着做**。每项含前置、步骤（带预期）、完成后回写位置。全部完成后本阶段出口闭合（F4 + H 是门槛）。
> 证据留痕：建议每步截图或保留日志片段到本地，回写时在 tasks.md 勾选行附一句结论即可（无需入 Git）。

## 建议执行顺序与批次

| 批次             | 项                                                               | 需要什么                           | 预计耗时 |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------- | -------- |
| ① Windows 真机批 | #1 F4 交互走查（含双开）＋ #2 gitmcp 手测 ＋ #3 外部 server 验证 | Windows 机器 + 构建                | 1.5–2h   |
| ② 文档批（随时） | #4 sandbox 能力矩阵对账                                          | 只需本仓                           | 0.5h     |
| ③ LLM 花费批     | #5 T2.3 双引擎对拍 + CI 首跑 ＋ #6 B3 蒸馏演练                   | DEEPSEEK_API_KEY + 少量 token 费用 | 1h       |
| ④ 出口批（最后） | #7 H0–H4 预生产切换                                              | #1–#6 完成后                       | 0.5h     |

---

## #1 F4 真机烟雾：完整交互清单走查（🔴 门槛）

**目标**：启动烟雾已过（2026-08-18 已修 5 个真问题），剩余**完整交互链路**人工走查。
**回写**：`specs/pre-production/tasks.md:67` 勾选 → 台账 §一 #1 划项。

**前置**：Windows 真机；Node ≥22（`node -v` 确认）；仓库根 `npm install` 完成；模型 API Key 已配置（设置面板可连通）。

**步骤**（每步给预期；任何一步不符合即停下记录现象）：

1. **构建+启动**：`npm run desktop:startWin` → 窗口出现，启动日志无红错（CDP 9333 就绪、openwiki vendor up-to-date 为正常输出）。
2. **会话**：新会话发一条消息（如"列出当前目录文件"）→ 助手调 `bash`/`read` 工具并正常返回。
3. **plan mode**：开启 Plan Mode 发一条写操作需求 → 首轮**只读**（不得出现 write/edit 实际执行）→ 产出 `<proposed_plan>` → 批准后第二轮才执行写操作。
4. **permission**：触发一次越界写（让它写项目外路径，如 `C:\Windows\Temp\x` 或上级目录）→ PermissionCard 弹出；分别试「单次允许 / 始终允许 / 拒绝」三态行为正确（始终允许后同类不再询问；拒绝后会话继续不崩）。
5. **design.materialize**：面板发"帮我做一个落地页原型：xxx"→ 产物出现在 Designer 列表，预览可渲染；顺手验证 **⬇ 导出**：pm-design 产物存出 `.ddp`、ui-design 产物存出 `.ddu`，用资源管理器解压确认包内 `manifest.json` + 源文件 + `index.html`（`.ddu` 双击 index.html 可直接渲染）。
6. **review.full**：Code Review 面板一键审查 → ocr 语义审查结果渲染；如已构建 CRG 图则附结构影响。
7. **任务树**：Task History 面板 create → 会话绑定徽标出现 → step 带产物 → fork 出分支 → switch 分支（有快照时文件随之切换）→ 时间线 ⏪ 恢复快照可用。
8. **重启恢复（验证 P1-1）**：在第 7 步任务进行中**完全退出应用并重启** → 会话列表完整、任务树仍在且指向正确分支、崩溃/中断的 trailing pending 工具调用被合成收尾（`TOOL_NOT_STARTED`/`OUTCOME_UNKNOWN` 语义，不重放）。
9. **双开回归**：同一工作区启动**两个实例**（`npm run desktop:startWin` 两次）→ 两实例各自会话互不串扰、无锁冲突崩溃、任务树/索引不被写坏（一实例写文件后另一实例刷新可见为通过线）。

## #2 gitmcp 任务 12 手测（可与 #1 同机同批）

**目标**：GitMCP 本地模块 GUI 全链路回归。
**回写**：`specs/gitmcp-local-module/tasks.md` 任务 12 手测子项勾选 → 台账 §一 #6 划项。

**步骤**：

1. MCP/插件面板添加合法仓库（如 `facebook/react` 或任一 GitHub repo）→ 出现在列表，自动建索引。
2. 添加**非法**地址（乱串/不存在 repo）→ 结构化报错，不崩。
3. **重复**添加同一仓库 → 幂等或明确提示，不产生重复项。
4. 对已添加仓库：停用 → 启用 → 重建索引 → 每步状态正确。
5. 删除 → 列表与索引清理干净。
6. MCP 页签下该 server 的工具权限开关可切换且生效。
7. 会话内让 AI 查询文档（"用 gitmcp 查一下 react 的 useEffect 文档"）→ `search_documentation` 被调用并返回内容。
8. **断网**后再查 → 优雅报错/降级，不挂死会话（本地索引查询应仍可用）。

## #3 外部 MCP server 实机验证

**目标**：MCP SDK 迁移验收残留项——真实外部 server 的 listTools + callTool 在 GUI 下验证（原 subagent 无桌面访问未跑）。
**回写**：`specs/mcp-sdk-migration/design.md` §8 第 3 项 ⏳ → ✅ 并注日期 → 台账 §一 #7 划项。

**步骤**（server 任选可得的三类，配置于 `.deeporca/settings.json` 的 `mcpServers` 或插件面板）：

1. dart（`dart-mcp-server` 或同类 dart 工具 server）→ 启动后 MCP 面板工具列表出现 → 会话内触发一次调用成功。
2. serena（本仓内置 vendored serena 免配）→ 确认经新 SDK 路径工具发现/调用正常（日常在用即算，补一次显式观察）。
3. expo（`npx expo-mcp-server` 或同类）→ 同上两步。

任一 server 无法获取可记录替代 server 名——验收点是「外部 stdio server 经新 SDK 的发现+调用」，不绑定具体三家。

## #4 sandbox 平台能力矩阵对账（纯文档，随时可做）

**目标**：`specs/sandbox/design.md` §六矩阵「逐格与实现对账后对外宣称」。
**回写**：矩阵表更新 + `specs/sandbox/tasks.md:110` 勾选 → 台账 §一 #3 划项。

**步骤**：

1. 读 design.md:398 起的 §六矩阵表。
2. 对照实现现实：macOS `sandbox-exec` 后端在树且实测过（保留 ✅）；**Windows WSL2 / Linux bwrap 任务 17/18 未动工**——矩阵中两处 `⚠️（有则有，无则 noop）` 的措辞需更正为与 `detect.ts` 一致的「未实现，noop + 降级必报（不静默）」，相应「对外表述」列措辞跟进。
3. quarantine 两列按 tasks.md 任务 22 落地事实核对（强隔离：无后端时 bash 全量 ask）。
4. 结论写回矩阵表（每格标注实测/未实现），若 docs/ 用户文档有沙箱宣称段落一并核对（目前无独立沙箱用户文档则只改 spec）。

## #5 T2.3 双引擎对拍 + CI 首跑（需真实 LLM 花费）

**目标**：skill-eval S2 出口——双引擎趋势一致 + CI 流水线首跑闭环。
**回写**：`specs/skill-eval/tasks.md` T2.3 勾选（附对拍结论一句）→ 台账 §一 #4 划项。

**前置**：`DEEPSEEK_API_KEY` 可用；skill-up 二进制就位（`node scripts/get-skill-up.mjs`，pin v0.9.0，缓存在 `.cache/skill-up/`）。

**步骤**：

1. **claude_code 引擎基线**：`node scripts/run-skill-evals.mjs --package code --all` 与 `--package browser --all` → 记录各用例得分/排序（产物 benchmark.md）。
2. **deeporca 自定义引擎对拍**：临时解开 `packages/core/templates/plugins/code/evals/eval.yaml` 里注释态的 `engine.custom` 块（`command: ["node", "scripts/skill-up-engine-deeporca.mjs"]`，跑完改回）→ 同样两包各跑一轮。
3. **口径**（design.md §4.3）：允许分数差异，**看排序趋势一致**；结论一句写入 T2.3 行。
4. **CI 首跑**：推一个改动 `packages/core/templates/plugins/<pkg>/**` 的最小 PR → Actions 里 `skill-evals` 工作流触发，PR 模式 report-only 产出 benchmark.md artifact、增量耗时 <5 分钟；再等一次 nightly cron（`0 18 * * *`）全量跑通。

## #6 B3 book-distill 端到端演练（需真实 LLM 会话）

**目标**：验证"文档 → 技能 → 召回"闭环。
**回写**：`specs/pre-production/tasks.md:24`（B3）勾选 → 台账 §一 #5 划项。

**步骤**：

1. 选一本自有文档（MD/PDF 均可，建议 30 页以上）。
2. 会话内用 book-distill 技能蒸馏 → 产出 SKILL.md + references/ 落盘且结构合规（≤300 行约定）。
3. 新开会话发一条与该文档强相关的问题 → 验证技能被 **G1 短名单召回并自动注入**（会话中出现 `<skill-name>` 技能块即通过）。
4. 顺手观察：若该 SKILL.md 超过 6000 字符，确认注入为**分片形态**（header + Section index + 召回小节——G3 新行为）；低于阈值则全文注入。

## #7 H0–H4 预生产切换（🔴 出口，最后执行）

**目标**：版本定格 → 冻结生效。**前置：#1–#6 全部完成。**
**回写**：`specs/pre-production/tasks.md:81-85` 逐项勾选 → 台账 §一 #2 划项（台账随后应 §一 清零，按维护约定整篇归档）。

**步骤**：

1. **H0 前置复核**：`git fetch origin` 后确认集成分支无新分叉——当前收尾工作在 `fix/test-baseline-ui-feedback`，确认 `git merge-base` 与目标集成分支（dev）关系符合预期（无并行新提交）；`specs/pre-production/tasks.md` A–G 区块全勾（本文档 #1/#2/#6 完成后即满足）。
2. **H1 定版**：`npm run release:version`（跨包版本号统一 bump，按当日拍板的版本号执行）。
3. **H2 合并**：将收尾分支合入 dev 并 push（`git checkout dev && git merge --no-ff <收尾分支> && git push origin dev`；tasks.md 原文写的 `feat/sandbox-p0-path-gate` 是立项时的分支名，**以 H0 复核时的实际收尾分支为准**）。
4. **H3 打标**：`git tag pre-production-baseline && git push origin pre-production-baseline`。
5. **H4 冻结生效**：确认 dev/feat 分支此后仅接受 fix/perf/docs/test/refactor/build/chore + 闭环项；新功能走 `next/*`；**更新 AGENTS.md 分支策略段落**（master 同步决策此刻一并拍板落地）。

---

## 完成后

台账 `docs/spec-open-items-status.md` §一 应清零 → 按其维护约定，把整篇移入 `research/archive/` 或 `audit-archive/` 登记，预生产正式收口；下一版本按 `docs/features/next-version-plan.md` 启动 `next/*`。
