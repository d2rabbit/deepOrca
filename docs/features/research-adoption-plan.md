# 计划案：外部理念采纳三线归档（CodeBrain/MemBrain · 智能网关双轨 · backpass 记忆审计）

> 日期：2026-09-04 · 状态：**规划定稿（三线 spec 全部落位，本计划案为统一索引与排期依据）**
> 性质：把 2026-09 三条「借鉴外部方法论、用自有原语落地」的调研线归档为**一个计划案**——统一纪律、统一时序、统一决策门。实现仍以各线 `specs/` 为准（总口径不变），本计划案只管排期与跨线协同。
> 依据口径：路线与现状以 [`feature-roadmap.md`](./feature-roadmap.md) §0 为准；next 版本排期与 [`next-version-plan.md`](./next-version-plan.md)（A–E 主线 + 储备）并行不悖——本计划案三线均**非 A–E 主线**，属"调研驱动"支线，资源冲突时让位于主线与 OC。

---

## 一、三线总览

| # | 线 | 上游调研 | spec 落点 | 生命周期区 | 分期结构 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **CMB 供给侧工程**（CodeBrain/MemBrain 理念六处真差距） | [2026-09-04-codebrain-membrain-philosophy.md](../research/2026-09-04-codebrain-membrain-philosophy.md) + [问题台账 CMB-1~11](../research/2026-09-04-codebrain-membrain-issues.md) | [`specs/cmb-adoption/`](../../specs/cmb-adoption/design.md)（design+tasks） | **活跃（当前版本）** | 批次 A（诊断诚实化）→ B（记忆供给面）→ C（编辑即提醒）→ D（辅助调用契约），~4-6d | **✅ 四批次全落地（2026-09-04，007d57e8/584440aa/95e0ac5d/1e5cdf95）** |
| 2 | **depth-lane 复杂性路由双轨**（智能网关 × 轻轨/重轨） | [2026-09-03-smart-gateway-dual-lane-adaptation.md](../research/2026-09-03-smart-gateway-dual-lane-adaptation.md) | [`specs/next-version/depth-lane/`](../../specs/next-version/depth-lane/design.md)（design+tasks，2026-09-03 入库） | **next-version 储备** | P0 纯观察 → 数据决策门 → P1 重轨最小链 → P2 对抗与自适应 | 设计定稿待启动 |
| 3 | **memory-audit 记忆审计子智能体**（backpass 方法论自研） | [2026-09-04-backpass-integration-feasibility.md](../research/2026-09-04-backpass-integration-feasibility.md) + [方案轮](../research/2026-09-04-memory-audit-subagent-proposal.md) | [`specs/memory-audit/`](../../specs/memory-audit/design.md)（design+tasks，随本计划案立稿） | **活跃（当前版本，P0 即将开工）** | P0 纯观察 → 数据决策门 → P1 合成+审核 → P2 受控写回 → P3 泛化（可选） | **🟡 P0 已落地（19b3bcf9）；P1 等 P0.7 数据门** |

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

## 四、统一时序

```text
当前版本（feat/* 合并线）
  CMB 批次 A（CMB-1+5 诊断诚实化）      ← 缺陷修复，最高优先
  CMB 批次 B（CMB-2+7 记忆供给面）      ← 含 B-7 depth-lane 论据回写
  CMB 批次 C（CMB-3 编辑即提醒）
  CMB 批次 D（CMB-4 辅助调用契约）      ← ⚠ depth-lane P0 的前置
  memory-audit P0（确定性证据扫描）      ← 与 CMB 批次并行（memory/core 域，零文件冲突）
    ↓ P0 数据决策门（P0.7）
  memory-audit P1 合成+审核 / P2 受控写回 ← 门过则同版本推进；门不过则封存为单发扫描工具
    ↓（冻结期后，next/* 分支）
next 版本观察窗
  depth-lane P0（网关+lane 记录，零行为变化）
    ↓ 数据决策门（P0.9）
  depth-lane P1 重轨最小链               ← 按门结果启动或砍
    ↓
  depth-lane P2 对抗+自适应
  （观察项池：CMB-8 升档、CMB-10 遥测、CMB-6 对账、memory-audit P3 泛化——按数据逐条激活）
```

**让位规则**：next 版本内 depth-lane 与 A–E 主线资源冲突时，主线优先（OC > A–E > 本计划案）；其 P0 体量小（~2-4d）可穿插。当前版本侧（CMB 批次 + memory-audit P0）按上表直接排期。

## 五、决策门清单（集中登记）

| 门 | 判据 | 出口 |
| --- | --- | --- |
| depth-lane P0.9 | express 真实占比 >90% 且误判率可忽略 | 砍重轨，只留"轻轨指令 + 追问率提示"；CMB-8/10 转入长期观察池 |
| memory-audit P0.7 | 真实项目失败模式数量/证据质量/误报率证明 ROI | 进 P1；否则封存为"确定性扫描工具"单发使用，不进产品流程 |
| CMB 批次门 | 无数据门（确定性缺陷/增强） | 每批 `npm run check && npm test` 全绿 + mutation-check + 台账回写即收 |

## 六、索引与维护

- 各线落地/否决：回写各自调研文档 README 行消费状态 + spec 状态行 + CMB 线另回写台账总览表。
- 本计划案只在**跨线事件**时更新：某线过/死决策门、依赖关系变化、新调研线并入（并入条件：同一"外部理念自有化"底色 + 落 spec + 过本计划案登记）。
- 三线 spec 的流转（开工 `git mv`、收官归档）按 [`specs/README.md`](../../specs/README.md) 口径，不受本计划案约束。
