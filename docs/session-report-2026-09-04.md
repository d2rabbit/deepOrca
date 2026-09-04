# 会话工作纪要：从「拉取代码」到功能测试清单交付（2026-09-04）

> 分支 `feat/modern-ui-redesign` · 起点提交 `677083b9`（dsh 封闭 + CMB 台账登记）
> 终点提交 `dc083ff0`（X.3 进度流 + 车道观察面板 + 功能测试清单）
> **总账：17 个提交 · 87 个文件 · +8150/−436 行 · 全量 check/test 七轮全绿**
> 配套交付：[功能测试清单](./functional-test-checklist-2026-09-04.md)（用户执行）

---

## 一、时间线总览（你说了什么 → 发生了什么）

| # | 你的指令 | 产出 |
| --- | --- | --- |
| 1 | 「拉取远程代码，然后做一个汇报」 | 快进合并 11 个提交（编辑器工作区重构 / LSP 诊断桥 P0+P1 / Token 热力图 / 调研文档批次），汇报三条产品线 |
| 2 | 「找一下 nodejs 24/25 路径，直接用绝对路径」 | 找到 nvm v24.19.0（Homebrew 的 node@24/25 都被重定向到 26）；**并更正了我首轮"测试全绿"的误报**——实查 3 个失败（1 个拉取前存量 + 1 个 Windows fixture + 1 个过期断言） |
| 3 | 「再拉取一遍」 | 1 个纯文档提交（dsh 线封闭 + CMB-1~11 问题台账） |
| 4 | 「codebrain 调研落地产出 spec 方案，无编码」 | 立项 `specs/cmb-adoption/`（design+tasks，四批次 A-D，含 5 个拍板项）+ 三处索引同步 |
| 5 | 「两个调研一并制定计划，三个归档为一个计划案」 | depth-lane 已有 spec；立项 `specs/memory-audit/`；统一计划案 `docs/features/research-adoption-plan.md`（三线依赖/统一时序/决策门） |
| 6 | 「这个不是 nextversion 的，等下就要做」 | memory-audit 从 next-version 挪回活跃区，计划案时序重排 |
| 7 | 「直接开始落地」 | **CMB 四批次 + memory-audit P0 全部实现**（7 个提交） |
| 8 | 「继续干，直接干完，最后全域审查」 | P0.7 真实数据首跑、CMB-6 对账表、cmb-adoption 归档、**双评审代理全域审查（27 项发现全处理）** |
| 9 | 「不留」 | memory-audit P1+P2、depth-lane 激活转正并实现 P0+P1+P2.1/2.2（实现代理）、CMB-8/10 落地、CMB-9/11 决策关闭——**CMB 台账 11/11 终态、三线零留白** |
| 10 | 「先自己验证，用 GVGL 工作区；P3 验证后深入继续」 | **四层真机验证**（真模型网关五路径 / 率公式真实首跑 / 重轨全链 102s / 打包）+ P3 落地（sop-extraction + memory.distill） |
| 11 | 「使用 mmx-cli 做视觉」 | mmx 设计链（生成→VLM 修正→实现→真实像素→再评审→修正）落地 lane 徽标 X.1/X.2 |
| 12 | 「继续完善，先搞完，给我功能测试清单」 | X.3 阶段进度流 + P2.3 车道观察面板 + **功能测试清单交付** |

---

## 二、做了什么（按交付域）

### 2.1 CMB 供给侧工程（specs/cmb-adoption，已归档 `specs/archive/cmb-adoption/`）

| 项 | 内容 | 提交 |
| --- | --- | --- |
| CMB-1+CMB-5 | 诊断腿状态机（unavailable 入带+降级行豁免截断）+ LSP 桥依赖就绪探测（TS/Python/Go 三族，deps-missing 走 isError 通道带补救指引）；**顺带修复存量信封缺陷**：`extractErrorDiagnostics` 只认 content 数组、对 manager 信封永远返回 `[]`——回合末诊断自始提取不到错误（假 clean），实证后修复 | `007d57e8` |
| CMB-2+CMB-7 | L1 抽取提示词三式（上下文分界/输出前终检/逐字保留）+ 专名软校验；渲染期相对时间锚定（中英词表、原文保留只标注、无锚标"源未锚定"）+ 事件/获知时间分离（"记录于"标签） | `584440aa` |
| CMB-3 | edit/write 成功后代码文件附"建议立即运行诊断检查"提示（不承诺无法保证的事） | `95e0ac5d` |
| CMB-4 | `AuxSchema` 纯函数校验器 + 内容级重试预算（≤2，传输级不重试）+ 技能匹配提示词抽成 EJS 模板工件（为 depth-lane 单调用双 verdict 铺路） | `1e5cdf95` |
| CMB-6 | CodeBrain 失败模式七项对账表：已有 2 + 部分 2 + 候选 3（全挂数据门） | `373799eb` |
| CMB-8+CMB-10 | 召回充分性二轮（确定性变体、零 LLM、有界 fail-open）+ 召回/lane 遥测行 | `3754ea29` |
| CMB-9/CMB-11 | 正式决策关闭 ❌（触发条件保留，算法蓝本留档） | `b13da444` |
| 全域审查 | 双独立评审代理：代码 15 项（3 P1 全修：截断负预算/UTC 锚定错位/模板回退丢指令）+ 文档 12 项（含 2 个早于本会话的存量死链） | `2a4cf793` |

### 2.2 memory-audit 记忆审计（specs/archive/memory-audit，P0-P2 全落地后归档）

- **P0**（`19b3bcf9`）：`memory.audit` action——三源证据扫描（transcript 失败事件 + 索引 + audit 哈希链 deny）→ 佐证聚合（≥2 独立 session）→ dryRun 默认全程只读
- **P0.7**（`373799eb`）：本仓真实数据首跑（2 会话，1 个已佐证模式 `session-failed|API key not found`）→ 后被「不留」跳过数据门
- **P1+P2**（`3754ea29`）：LLM proposal 合成（契约校验/坏证据丢弃/≤5 预算/fail-open）+ AskUserQuestion 逐项审核 + 决策持久化（**任何已决不重现**）+ 自包含双语 HTML 报告 + 受控写回（接受项回原生 edit 工具指令，禁 bash 直写）
- **P3**（`35790718`）：延伸立项 `specs/sop-extraction/`——`memory.distill` SOP 萃取通道：素材从"什么坏了"反转为"这次怎么做成的"；会话摘要（意图/工具画像/结论）→ SOP 提案（新建技能含全文 SKILL.md 草案/规则/增补）→ 同一审核环与决策库；批内同名去重（测试驱动发现的真缺口）

### 2.3 depth-lane 复杂性双轨（specs/depth-lane，从 next-version 激活转正）

- **P0 网关观察**（`500fdff7`，实现代理完成+本人抽查五个风险面）：L1 免费启发式 + L2 四维评分并入既有 skill 匹配 flash 调用（单调用双 verdict，轻轨零增量）；lane 由程序计算绝不信任模型自报；禁用态**字节级等价测试锁定**；G0 遥测
- **P1 重轨 + P2.1/2.2**（同上）：S1→S5 状态机（729 行新链尾层）：证据闸/分歧 K≤3/red-team 击穿/融合收敛（极差<15% 或轮次上限）/<proposed_plan> 形态报告（结论先行，不可逆风险置顶=拍板点）
- **P2.3/P2.4**（`cdf2d162`）：`lane-rates.ts`（追问率/负反馈率 + autoTune 公式）——**真实历史首跑校准**：追问率 0.33、autoTune 50→50.17
- **X.1/X.2**（`b40d36d5`+`181530b4`）：lane 徽标（mmx 视觉设计链：生成参考→VLM 14px 修正（去渐变/去框/粗杆短尾/粗条）→手绘 SVG→Playwright 真实像素→再评审→内边距修正）
- **X.3 + 面板**（`dc083ff0`）：阶段进度流（core seam→IPC root 戳→进度条，done 自隐）+ 设置面板"车道观察"只读区块（root-pin IPC + i18n×6）

### 2.4 GVGL 真机验证批（`cdf2d162`，你授权后执行）

| 层 | 内容 | 结果 |
| --- | --- | --- |
| Tier1 | 真模型（step-3.7-flash）跑网关：GVGL 真实 prompt+对照 | 五路径全命中（l1-keyword/l2-flash/fail-open）；**真实发现：该端点 L2 空评分率 2/4，fail-open 全部正确兜底** |
| Tier2 | 率公式真实历史首跑（GVGL+本仓 3 会话，L1 代理回溯） | 追问率 0.33、deep 率 null（诚实未定义）、autoTune 50→50.17 |
| Tier3 | 真模型完整重轨 S1→S5 | 102 秒/37 消息/六段报告齐全（真实跨平台 API 建议内容）；顺带修 AbortSignal 监听器告警 |
| Tier4 | desktop 全量打包 | exit=0 |

### 2.5 文档与治理

- 统一计划案 `docs/features/research-adoption-plan.md`（三线依赖/统一时序/决策门；两处数据门后被你拍板跳过并标注）
- CMB 台账 11/11 终态、两份 spec 归档（cmb-adoption 第 16 项 / memory-audit 第 17 项）、sop-extraction + depth-lane 转正登记
- 修复 2 个**早于本会话**的存量问题：ts-native-migration 搬移后 specs/README 死链、research README 两处历史断链
- [功能测试清单](./functional-test-checklist-2026-09-04.md)：七节 40+ 项（前置/A 回归/B 诊断/C 双轨/D 审计/E 萃取/F 记忆/G 视觉）+ 已知观察项 + 问题记录格式

---

## 三、关键发现与决策（值得你知道的）

1. **存量信封缺陷**（本会话最重要的意外发现）：回合末诊断桥从上线起就提取不到任何错误——manager 信封与解析器形状不匹配。已修复并被诊断诚实化放大价值（诊断桥第一次真正端到端工作）。
2. **L2 空评分率 2/4**：真机验证抓到的端点特性，fail-open 防线全部正确——记入观察项，若你环境比例更高可为评分加一次重试。
3. **EJS `<%= %>` 会把 JSON 引号转义成 `&quot;`**——模板化时的坑，改 `<%- %>` 并写入提交信息留档。
4. **autoTune/开闸纪律**：公式已实现并真实校准，但保持默认关闭——自动调参静默改行为，需 ≥20 会话生产数据再拍板。
5. **并行会话协调**：全程与另一会话（App modal 重构/astryx 预研）共用工作区，17 个提交严格逐文件挑选，其未完成改动零触碰（两处必须携带的在途块均已在提交信息注明）。

## 四、当前状态

- **全绿**：`npm run check` + `npm test`（core 823 测试 822 过 0 挂 1 既有跳过 / desktop 72 / memory 71 / embedding 14）+ `desktop:build`
- **工作区**：剩余未提交文件全部属并行会话
- **留位（均有客观外部前提，非欠账）**：X.4 真机冒烟（=功能测试清单，移交你）、embedding 余弦精确标定与 autoTune 开闸（需生产数据量）、sop-extraction P2 连接器（需 ActionContext 宿主 seam）

## 五、快速索引

| 想看什么 | 去哪 |
| --- | --- |
| 功能测试怎么做 | `docs/functional-test-checklist-2026-09-04.md` |
| CMB 六项的实现细节与验收 | `specs/archive/cmb-adoption/` + 台账 `docs/research/2026-09-04-codebrain-membrain-issues.md` |
| 记忆审计/SOP 萃取用法 | `specs/archive/memory-audit/` + `specs/sop-extraction/` |
| 双轨怎么开/怎么关 | `specs/depth-lane/`（settings `complexityGate.enabled`；徽标设计稿在 `specs/depth-lane/designs/`） |
| 三线全局与决策门 | `docs/features/research-adoption-plan.md` |
