# 索引与知识增强（K 线）— 技术设计

> 日期：2026-08-20 · 状态：**规划中（`next/*` 版本窗口，冻结期外）**
> 来源预研：`docs/research/quality/2026-08-20-pr-af-adversarial-review-prestudy.md`（PR-AF）、`docs/research/agent-harness/2026-08-20-fastcode-iterative-retrieval-prestudy.md`（FastCode）
> 路线挂靠：`docs/features/next-version-plan.md` 主线 D；`docs/features/feature-roadmap.md` §二 知识中心
> 邻居 spec：`specs/doc-wiki/`（知识编译层，另分支立稿合流后生效——FastCode repo overview 路由思想记入其对照）
>
> **总原则（本 spec 的存在理由）**：对外部项目**不引入、不 vendor、不拷贝代码与 prompt 原文**（PR-AF 许可未核验，净室红线；FastCode 虽 MIT 但能力与既有栈重叠）——只借鉴两个可自研的思想，全部落在现有 seam 与 action 体系内，**零新增运行时依赖、零 vendor 脚本、不增安装包体积**。

---

## 0. 结论速览

| 轨道 | 内容 | 借鉴源 | 落点 | 分期 |
| --- | --- | --- | --- | --- |
| **K1 对抗证伪审查** | `review.challenge` action：对 review.full 的 findings 逐条证伪挑战，过滤后才进面板 | PR-AF Adversary + 可证伪门 | `packages/core/src/actions/review.ts`（新增 action，走注入的 LLM 会话） | K1 P0 |
| **K2a 检索预算显式化** | 会话级代码上下文记账：自适应行数预算、边际收益递减观测、每轮 ROI 指标 | FastCode 自适应预算/停止条件 | `packages/core/src/session.ts`（观测先行）+ usage 记账 | K2 P0 观测 / P1 干预 |
| **K2b 粒度感知上下文选择** | file/class/function 三档粒度选择策略（"问函数别给全文件"） | FastCode LLM 粒度选择 | CodeGraph 符号 + read 前上下文组装（设计参考，P2） | P2 设计先行 |

不采纳清单（预研已定稿，防翻烧饼）：PR-AF 元提示规划 / AI-PR 意识 / severity×confidence 打分（触发条件：K1 上线后漏报集中特定维度再评估）；PR-AF 外部挂载与二进制集成；FastCode 整体引入（含 MCP 形态）。

## 1. K1 对抗证伪审查（review.challenge）

### 1.1 动机

本仓流程层已有"两轮对抗评审 + 修复收敛至零"（`docs/audit-archive/`，人工/agent 会话执行），但产品层 `review.full`（CRG 结构分析 → OCR 语义审查 → 确定性合并）是**单遍审查**，误报与夸大严重度直接进 CodeReviewPanel。K1 = 把流程层已验证有效的对抗环节自动化进产品，语义与既有门禁（"发现收敛至零"）完全一致。

### 1.2 设计

```
review.full（现状不动）
   ↓ findings + crgRisk 标注
review.challenge（新 action，packages/core/src/actions/review.ts）
   输入：findings 列表（含文件/行号/评论原文）+ crgRisk
   执行：对每条 finding 一次证伪挑战（走 SessionManager 注入的 LLM 会话，budget 模型即可），
         挑战维度（自研措辞，非上游 prompt）：
         ① 是否预存在问题（改动前已存在，非本次引入）
         ② 是否项目既有惯例/有意设计（对照 AGENTS.md 与周边代码）
         ③ 严重度是否夸大（有无现成缓解/安全边界）
         ④ 证据是否充分（能否在变更行内找到支撑片段）
   输出：每条 finding 一个 verdict（upheld / downgraded / refuted + 一句理由）
   合并：确定性（无 LLM）——refuted 剔除、downgraded 降级标注、upheld 保留；结果附 challenge 元数据
   产出：{ challenged: [...], verdicts, upheldCount, refutedCount }，status/statusNote 沿用 review.full 惯例
```

- **架构约束**：core 不 spawn、不引依赖——挑战 pass 只是"LLM 会话内的一次结构化调用"，与 ReviewController seam 正交；无降级风险（challenge 失败 → 原样返回 findings + `challenge: "skipped"`，fail-open）。
- **产品接线**：CodeReviewPanel 加"对抗复核"开关（默认关，深度审查场景手开）；smart-code-review skill Step 增补（review.full → review.challenge 两步）。
- **流程接线**：F 线/audit-archive 的机器辅助选项——人工对抗轮前先跑 challenge，人工只抽查 upheld 项。

### 1.3 影响（必须付的账）

- 时延：review.full 分钟级 → 加挑战 pass 约 ×2（budget 模型 + 逐条短上下文）；以异步/开关控制，不阻塞默认路径。
- 测试：`phase-actions.test.ts` 补 challenge 单测（mock LLM 会话，验 verdict 合并确定性）；smart-code-review 正/反 eval 用例（skill-evals CI 跑的）加对抗 pass 断言。
- 流程：F4 真机烟雾用例扩展（下一版走查时纳入）。

## 2. K2a 检索预算显式化

### 2.1 动机

session 循环里 LLM 读代码无预算概念，上下文膨胀只能靠 compaction 事后压缩（512K/128K 阈值触发）；FastCode 验证了"预算前置 + 增益观测"可以更早止损。本仓已有全部记账原料（usage/token 统计、read 工具返回行数）。

### 2.2 分期

- **P0 观测（先做，零行为变更）**：在 session 记账中增加"本轮读代码行数 / 累计 / 连续 N 轮增益"三个指标，随 session 状态暴露到 UI 观测位（桌面端已有 usage 面板体系）；产出真实会话的预算分布基线。
- **P1 干预（基线之后拍板）**：依据基线定预算档（简单/中/复杂任务分级，借鉴"随复杂度自适应"思想但阈值自采）；触达预算时的动作候选——软提示（向 LLM 注入"上下文已充足，优先作答"）/ 硬停（需用户可见，不做静默截断）。**决策点**：是否干预、干预强度，待 P0 数据说话，本文不预支结论。

### 2.3 影响与红线

- 只动 `session.ts` 记账与状态暴露，不动 read 工具契约（snippet_id 机制不变）、不动 compaction 触发条件。
- 红线：不做静默丢弃已读上下文（用户可见性优先）；指标命名与 usage 记账对齐，避免第二套 token 口径。

## 3. K2b 粒度感知上下文选择（P2 设计先行）

只立设计方向不排实现：当未来出现"上下文组装器"需求（doc-wiki 检索管线或 CodeGraph 符号直供 LLM）时，采用三档粒度策略——问函数给函数（CodeGraph 符号行区间）、问类给类、要全貌才给文件；候选清单带符号摘要让 LLM 自选档位。read 工具现状（被动按需读）在交互式会话中仍为主路径，本节不改变它。

## 4. 净室红线（实现期约束）

1. 不拷贝 PR-AF / FastCode 任何源码、配置或 prompt 原文；挑战维度措辞自研（PR-AF 许可未核验）。
2. 思想级借鉴须在代码注释/PR 描述中标注思想来源（`docs/research/` 两篇预研为凭）。
3. 零新增 npm/pip 依赖、零 vendor 脚本、零 extraResources 体积变化——违反即偏离本 spec 立项前提。

## 5. 测试策略

- K1：verdict 合并确定性单测（同输入同输出）；fail-open 测试（LLM 会话异常 → findings 原样 + skipped 标注）；eval 用例进 skill-evals 体系（rule_based 断言 refuted 剔除）。
- K2a：记账单测（行数累计/增益计算）；P0 明确"零行为变更"——全量 `npm test` 不因记账引入任何用例差异。

## 6. 开放问题（实现前需拍板）

1. K1 挑战用模型档位（budget flash vs 主模型）——建议 flash 先行，eval 对比后定。
2. K1 verdict 三态是否进 session 持久化（进则 review 面板重开可复现，不进则一次性）。
3. K2a P1 的干预强度（软提示 vs 硬停）——P0 基线数据 + 用户可见性原则共同拍板。
4. 与 doc-wiki 检索管线的关系：doc-wiki 落地后，K2b 的粒度策略是否并入其检索管线统一实现（避免两套符号供给）。
