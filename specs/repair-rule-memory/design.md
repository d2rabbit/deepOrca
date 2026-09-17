# 修复规则记忆（repair-rule-memory）— fork 谱系失败对挖掘

> **状态**：方案稿（2026-09-17 立稿，本计划周期内实施）。上游调研：[2026-09-17-emg-experience-memory-graph-prestudy.md](../../docs/research/2026-09-17-emg-experience-memory-graph-prestudy.md)（EMG, KDD 2027；拍板：概念级移植，不引代码）。
> **命题**：把「失败→修复」经验变成可审查、可回写的 agent 行为规则——从任务树 fork 谱系挖掘「父分支废弃 + 子分支同任务修复成功」的配对，**确定性序列 diff** 产出编辑路径，LLM 只做措辞，经 AskUserQuestion 审查后写入项目 AGENTS.md。
> **规模判断**（拍板依据）：无大规模重构——复用 memory-audit 三段式基础设施与 task-tree 既有存储，新动作一个 + 纯函数 diff 模块一个。
> **实施状态（2026-09-17）**：P0+P1 代码面落地——`repair-diff.ts`（LCS 编辑路径纯函数，5 例 + mutation-check）、`repair-rules.ts`（`memory.mine-repairs` 动作：确定性配对挖掘/措辞/审查回写三段 + 双语 HTML 报告 + 共享决策存储）、挖掘集成测试 3 例（真 TaskTreeService + 临时 HOME transcript）；门禁全绿。真机一轮（T2.1）待排期。

---

## 0. 为什么是 AGENTS.md 而不是记忆库（关键设计裁决）

EMG 的价值是「失败修复规则」这个**象限**（现有记忆线全在成功侧：L1 事实/SOP/触发器）。但它的**检索注入**机制对本仓是冗余的：coding harness 的 AGENTS.md 本来就每会话注入系统提示——少量高信噪比修复规则的最强归宿就是它，而非新存储+新检索通道。因此：

- **存储 = 项目 AGENTS.md**（`## Repair rules` 小节，双语短句），复用 memory-audit P2 的受控回写通道；
- **不做** L0–L3 mutation（沿袭 memory-audit 红线）、不做 stuck 触发注入（AGENTS.md 常驻已覆盖；若未来规则量大再评估记忆库+检索，见 §6）。

## 1. 现状与证据（全部已核对代码）

| # | 事实 | 出处 |
| --- | --- | --- |
| E1 | `fork()` 强制要求 why（"a fork without a story is a UI lie"），reflog 记 `{op:"fork", branch, nodeId, detail:why}`；节点不可变 | `tasks/task-tree-service.ts:180-236` |
| E2 | 分支终态可计算：`outcome: "abandoned" \| "merged" \| "open"` | `task-tree-service.ts:738` |
| E3 | 分支↔会话绑定：`bindSession()` 把 sessionRef 盖在分支头节点（首绑定格，不静默改绑）；index 有 sessionIds 台账 | `task-tree-service.ts:504-534` |
| E4 | 会话 transcript 可确定性扫描（工具调用/失败事件词汇已有现成扫描器） | `actions/memory-audit.ts` `scanTranscript`（:221）+ audit hash-chain 扫描（:266） |
| E5 | memory-audit 三段式可整体套用：P0 确定性扫描 → P1 单次结构化 proposal（aux schema 契约 + 上限 5 条）→ P2 AskUserQuestion 逐条裁决 + 受控回写指令 | `actions/memory-audit.ts`（P1/P2 段 :406 起） |
| E6 | fork 时记忆快照可作种子（`memory-spawn` kind）——谱系里「为什么 fork」的语义记录已存在 | `task-tree-service.ts:195` |

## 2. 管线设计（三段，对齐 memory-audit 纪律）

```
P0 配对挖掘（纯确定性，零 LLM）
  遍历树 reflog 的 fork 记录 → 候选对 {parentBranch, childBranch, why}
  过滤：parent 分支 outcome=abandoned（或其绑定会话存在失败事件）
       AND child 分支绑定了会话且未废弃
  对每对：经 sessionRef 取两侧会话 → 提取工具调用序列
       （对齐单元 = {tool 名, 关键 args 摘要}——同 harness 词汇天然规范）
  → LCS/编辑距离 diff → 编辑路径：
       {删除簇: parent 独有的连续动作, 插入: child 独有, 公共脊柱}
  无有效信号（序列近同 / 公共脊柱过短 / child 无绑定会话）→ 0 提案，如实空报告

P1 规则措辞（单次结构化补全，LLM 仅措辞）
  输入：fork why + 双分支标题/摘要 + 编辑路径 + AGENTS.md 现有 Repair rules 段
  输出（aux schema 契约强制）：≤3 条双语修复规则
       形状：「在 <失败上下文 X> 下做 <Y>，不要 <Z>」+ 证据对引用（fork id/分支名）
  去重：与现有规则语义撞车（proposalKey 同款归一）→ 丢弃不挤占

P2 审查回写（AskUserQuestion + 受控回写）
  逐条 accept/reject/skip；accepted → 回写指令（主会话 edit 通道）
  AGENTS.md `## Repair rules` 小节追加/合并；每条规则带一行谱系溯源
     （tree id + fork why 摘录——可审查、可回溯到原始分支）
```

**上限与优雅退化**（对齐 EMG 退化语义的安全侧）：每轮 ≤3 条（repair 规则比 SOP 更锋利，宁缺勿滥）；P0 零信号即零提案——绝不为了出结果而弱化配对判据。

## 3. 动作面与实现落点

| 件 | 落点 | 说明 |
| --- | --- | --- |
| 动作 `memory.mine-repairs` | `core/actions/repair-rules.ts`（新，~250 行） | defineAction 三端自动承接（面板/命令/会话动词），报告沿 memory-audit 的自包含双语 HTML 形态 |
| 序列 diff 纯函数 | `core/actions/repair-diff.ts`（新，~150 行） | `extractToolSequence(transcript)` + `diffSequences(parent, child) → EditPath`；独立单测（无 IO） |
| 复用件 | memory-audit 的 aux schema 契约、AskUserQuestion 审查循环、受控回写指令形状 | 导出缺什么补什么（加性 export，不动 memory-audit 主体） |
| 任务树读取 | 既有 TaskTreeService 只读 API（reflog/分支 outcome/sessionRef） | 零存储改动 |

## 4. 明确不做（决策留痕）

1. **不做 FGW/图匹配**——同任务 fork 配对用序列编辑距离足矣（调研 §3 已论证）。
2. **不做跨任务边洞察聚合**（EMG 的 edge insights）——v1 靠 AGENTS.md 常驻注入；规则跨任务泛化交给读规则的模型自己完成。
3. **不做 stuck 触发注入**——无新注入通道（§0 裁决）；cmb-next 的 stuck 检测立项时再议。
4. **不做记忆库写入**——沿袭 memory-audit「no L0–L3 mutation」红线。
5. **不自动回写**——无人工 accept 的规则永不落盘（与 memory-audit 同款闸门）。

## 5. 验收（EARS）

- **R1 配对确定性**：When 同树存在「abandoned 父分支 + 绑定会话的子分支」fork 对，P0 shall 产出其编辑路径，且零 LLM 参与（纯函数可单测）。
- **R2 优雅退化**：When 无合格配对或编辑路径无信号（公共脊柱 < 3 步或删除簇为空），动作 shall 返回零提案的空报告，不调用 P1。
- **R3 措辞受契约**：P1 输出 shall 过 aux schema 校验（≤3 条、双语、必带证据引用），违约自动重试一次后仍败则整轮失败。
- **R4 审查闸门**：未 accept 的规则 shall 不出现在任何写入指令中；回写仅经主会话 edit 通道。
- **R5 谱系溯源**：每条落盘规则 shall 携带 tree id + fork why 一行摘要。
- **门禁**：`npm run check && npm test` 全绿；repair-diff 单测含 mutation-check 一次。

## 6. 分期

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| P0 | repair-diff.ts + 单测（含黄金对：构造 parent/child 假 transcript 断言编辑路径） | 0.5 天 |
| P1 | 动作三段接线 + aux schema + i18n ×6 文案 | 1 天 |
| P2 | 真机一轮（真实 abandoned fork 树上跑全链）+ 报告面走查 | 0.5 天 |

后续（不排期）：规则量大后评估迁入记忆库 + 检索注入（触发器召回线合流）。
