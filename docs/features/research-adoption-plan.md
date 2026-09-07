# 计划案：外部理念采纳三线归档（CodeBrain/MemBrain · 智能网关双轨 · backpass 记忆审计）

> 日期：2026-09-04 · 状态：**规划定稿（三线 spec 全部落位，本计划案为统一索引与排期依据）**
> 性质：把 2026-09 三条「借鉴外部方法论、用自有原语落地」的调研线归档为**一个计划案**——统一纪律、统一时序、统一决策门。实现仍以各线 `specs/` 为准（总口径不变），本计划案只管排期与跨线协同。
> 依据口径：路线与现状以 [`feature-roadmap.md`](./feature-roadmap.md) §0 为准；next 版本排期与 [`next-version-plan.md`](./next-version-plan.md)（A–E 主线 + 储备）并行不悖——本计划案三线均**非 A–E 主线**，属"调研驱动"支线，资源冲突时让位于主线与 OC。

---

## 一、三线总览

| # | 线 | 上游调研 | spec 落点 | 生命周期区 | 分期结构 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **CMB 供给侧工程**（CodeBrain/MemBrain 理念六处真差距） | [2026-09-04-codebrain-membrain-philosophy.md](../research/2026-09-04-codebrain-membrain-philosophy.md) + [问题台账 CMB-1~11](../research/2026-09-04-codebrain-membrain-issues.md) | [`specs/archive/cmb-adoption/`](../../specs/archive/cmb-adoption/design.md)（design+tasks） | **已收官归档（specs/archive/，当前版本落地）** | 批次 A（诊断诚实化）→ B（记忆供给面）→ C（编辑即提醒）→ D（辅助调用契约），~4-6d | **✅ 全部落地（2026-09-04）；观察项亦清账：CMB-6 对账 ✅、CMB-8/10 ✅、CMB-9/11 ❌ 决策关闭（2026-09-04 用户拍板「不留」）** |
| 2 | **depth-lane 复杂性路由双轨**（智能网关 × 轻轨/重轨） | [2026-09-03-smart-gateway-dual-lane-adaptation.md](../research/2026-09-03-smart-gateway-dual-lane-adaptation.md) | [`specs/depth-lane/`](../../specs/depth-lane/design.md)（2026-09-04 激活转正） | **活跃（当前版本，已落地主体）** | P0 纯观察 → 数据决策门 → P1 重轨最小链 → P2 对抗与自适应 | **🟡 P0+P1+P2.1/2.2 已落地（用户拍板跳过数据门与 next-version 直接干完）；P2.3/2.4（遥测公式/autoTune）与 X.*（桌面徽标/i18n）代码位就绪默认关，待生产数据** |
| 3 | **memory-audit 记忆审计子智能体**（backpass 方法论自研） | [2026-09-04-backpass-integration-feasibility.md](../research/2026-09-04-backpass-integration-feasibility.md) + [方案轮](../research/2026-09-04-memory-audit-subagent-proposal.md) | [`specs/memory-audit/`](../../specs/memory-audit/design.md)（design+tasks，随本计划案立稿） | **已收官归档（specs/archive/）** | P0 纯观察 → 数据决策门 → P1 合成+审核 → P2 受控写回 → P3 泛化（可选） | **✅ P0+P1+P2 全部落地（2026-09-04 用户拍板跳过数据门）；P3 泛化另行立项** |

三线共同的底色：**不引外部依赖/代码，用自有原语（flash 调用、subagent、background task、edit 权限面、确定性校验）把别人的工程哲学做进产品**。CMB 台账中的 CMB-6/8/9/10/11（文档对账 / 等数据 / 观念种子）不进任何 spec，留台账跟踪——遇下述决策门时再逐条激活。

## 二、统一纪律（三线共享，各 spec 不再重复）

1. **M1 规则（确定性优先）**：新增任何 LLM 步骤前，先问能否由预算化的确定性机制承担；只有真正的语义判断才允许 LLM 参与，且必须带预算与失败回退（源：CMB 调研 M1，已固化于 cmb-adoption design §0.3）。
2. **fail-open 全覆盖**：评分失败 → 轻轨（depth-lane）；扫描失败 → 证据快照照常返回（memory-audit）；校验失败 → null 走调用方既有回退（CMB-4）。三线的失败路径都退回"与现状等价"。
3. **P0 观察 → 数据决策门**：depth-lane P0.9（express 占比/误判率）与 memory-audit P0.7（失败模式数量/证据质量/误报率）都是**用数据决定是否进 P1**，不预设结论；CMB 全线无观察门（六项均为确定性缺陷/增强，直接实施）。
4. **零新依赖 / 零上游代码**：MemBrain 无 LICENSE 禁止拷贝；backpass 只借方法论不引 CLI；CodeBrain 只取失败模式分类学。
5. **带内诚实**：降级必须入带（CMB-1/5）、截断留计数、clean 与 unavailable 不可混淆——三线的输出面同守此规。

## 三、跨线依赖与协同（归档为一个计划案的核心价值）

| 依赖 | 方向 | 内容 | 排期含义 |
| --- | --- | --- | --- |
| **辅助调用契约 → 网关扩展** | CMB 批次 D → depth-lane P0.2 | 两者改的是**同一个调用点**（`identifyMatchingSkillNames` flash 调用）：CMB D-5 先把内联提示词模板化 + schema 校验落地，depth-lane P0.2 再在其上扩展 `lane/tpcr` 双 verdict——先后次序可避免二次返工 | **CMB 批次 D 应先于 depth-lane P0 完成**（至少 D-1/D-5） |
| **遥测同源** | memory-audit P0 → depth-lane P0 | 两线 P0 同为"纯观察、零行为变化"，遥测都经 usage-ledger（`auxiliary`/`background` 源）；memory-audit P0 当前版本先行落地，depth-lane P0 留 next 版本观察窗——先后对照可互为基线 | memory-audit P0 与 CMB 批次并行（无文件冲突）；depth-lane P0 随 next 版本启动 |
| **数据门解锁观察项** | depth-lane P0 数据 → CMB-8/10 | agentic recall 充分性检查（CMB-8）与检索即维护遥测（CMB-10）都以 depth-lane P0 观察面为前置 | CMB-8 的 depth-lane design 论据回写已排入 cmb-adoption 任务 B-7；升档实现等数据门 |
| **记忆面互补** | CMB-2/7 ∥ memory-audit | CMB 改运行时记忆质量（L1 抽取/渲染）；memory-audit 改规则级记忆（AGENTS.md/SKILL.md）——同属"记忆供给面"，文件族不同零冲突，可同批推进 | 无次序约束 |
| **结构债远期同构** | CMB-9 ↔ memory-audit P3 | top-K 预算审计思想同源；memory-audit 的 proposal 管线若 P3 泛化为通用"规则/SOP 萃取"，是 CMB-9 蓝本的第一个落点候选 | 仅存档，无排期 |

## 四、统一时序（终态 2026-09-04：用户拍板「不留」，全量清账）

```text
当前版本（feat/* 合并线）—— 已全部完成
  CMB 批次 A→D（四提交）+ 全域审查修复
  memory-audit P0 → [数据门被用户拍板跳过] → P1 合成审核 + P2 受控写回 → spec 归档
  depth-lane 激活（next-version → specs/）→ P0 网关 + P1 重轨 S1-S5 + P2.1/2.2 落地
  CMB-6 对账表 ✅；CMB-8 充分性二轮 ✅；CMB-10 遥测 ✅；CMB-9/11 ❌ 决策关闭（触发条件保留）
2026-09-04 GVGL 真机验证批（用户授权，workspace=GVGL，真模型/真数据）:
  Tier1 网关: 真实 prompt 五路径全命中(l1-keyword/l2-flash/fail-open), G0 遥测五事件落地;
    该端点 L2 空评分率 2/4 → fail-open 全部正确兜底(观察日志项)
  Tier2 P2.3/2.4: lane-rates.ts 落地 + 真实历史首跑(3 会话: 追问率 0.33, deep 率 null,
    autoTune 50→50.17) —— 原「留位」转「已落地+真实校准」
  Tier3 重轨: 真机全链 102s/37msg/S5 六段报告齐全; 顺带修复 AbortSignal 监听器告警
  Tier4 desktop 全量打包 exit=0
  P3 延伸: specs/sop-extraction 立项并落地(memory.distill; memory-audit P3 闭环)
留位（更新后）:
  X.*（桌面 lane 徽标 + i18n×6 + 设置面板率只读展示）——待 enabled 生产开启后有物可显
  P2.3 embedding 余弦精确阈值标定与 autoTune 开闸——需生产数据量（公式与插槽已就绪并经真实首跑）
  sop-extraction P2 行为侧/召回侧连接器——待 ActionContext 宿主 seam
  观察项消费：G0/召回遥测积累后按 specs/depth-lane tasks P0.9 口径出正式占比报告
```

## 五、决策门清单（集中登记）

| 门 | 判据 | 出口 |
| --- | --- | --- |
| depth-lane P0.9 | ~~express 占比>90% 砍重轨~~ **已被 2026-09-04 用户拍板跳过（不留）——重轨直接实现**；报告口径保留，待 enabled 打开后按遥测出 |
| memory-audit P0.7 | ~~数据证明 ROI 才进 P1~~ **已被 2026-09-04 用户拍板跳过（不留）——P1/P2 直接实现并收官**；首轮真实数据（n=2）已留档 |
| CMB 批次门 | 无数据门（确定性缺陷/增强） | 每批 `npm run check && npm test` 全绿 + mutation-check + 台账回写即收 |

## 六、索引与维护

- 各线落地/否决：回写各自调研文档 README 行消费状态 + spec 状态行 + CMB 线另回写台账总览表。
- 本计划案只在**跨线事件**时更新：某线过/死决策门、依赖关系变化、新调研线并入（并入条件：同一"外部理念自有化"底色 + 落 spec + 过本计划案登记）。
- 三线 spec 的流转（开工 `git mv`、收官归档）按 [`specs/README.md`](../../specs/README.md) 口径，不受本计划案约束。
