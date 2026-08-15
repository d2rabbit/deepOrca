# Memory 谱系增量规格 — L2 fork 谱系字段（task-tree P2 前置）

> 日期：2026-08-15 · 状态：规格（不含实现）
> 归属：任务轨迹 × 记忆管道的桥接层（单向数据馈赠，非模型统一）
> 前置：`specs/task-tree/design.md` §3.2（记忆驱动 fork 六步闭环的"回收"步）
> 定位提醒：task-tree 给人看、行为记忆给 agent 看——本规格是**任务轨迹向行为/情景记忆的单向馈赠**：分支的"选择与结果"结构化写回 L2，让未来的记忆驱动 fork 有谱系可查。

---

## 一、目标

让"分岔的代价与收益"进入记忆：当一个任务分支完成或被放弃，其决策摘要（fork 为什么发生、结果如何）作为带谱系标记的 L2 情景记忆写回。后续记忆驱动 fork 召回历史任务时，可按谱系过滤"同源不同择"的平行分支，相似度阈值由谱系反馈自学习（spec §3.2 第 6 步）。

## 二、数据模型（L2 记录增量字段）

L2 情景记忆记录（session 摘要级）新增可选 `taskLineage` 块：

```ts
interface TaskLineage {
  treeId: string; // 任务树 id
  branch: string; // 本记录所属分支
  forkedFrom?: string; // 分叉源分支（root 分支无此字段）
  forkWhy: string; // 分叉理由（节点的 why，人类叙事）
  outcome: "merged" | "abandoned" | "completed" | "open";
  outcomeNote?: string; // merge 挑了什么 / abandon 教训一句话
  siblingChoice?: string; // 同源其他分支的选择（分歧检测的输入）
}
```

- 全部可选：无 taskRef 的会话写回完全不变（向后兼容）。
- 由记忆管道的 capture 钩子在写 L2 前注入——来源是 SessionManager 在会话终态时提供的 lineage 快照（经 MemoryProvider 现有接口扩展，不新增进程内通道）。

## 三、写回触发（谁在什么时候写）

1. **分支终态事件**：`TaskTreeService` 的 merge / abandon / 分支 head 节点 status=done → SessionManager 发 `task-branch-terminal` 内部事件（复用现有 onXxx 回调模式）。
2. **会话 capture 携带谱系**：绑定该分支的会话在 `maybeCaptureMemory` 时，`capture()` 的入参附加 `taskLineage` 快照（从 entry.taskRef + 树服务读取）。
3. 幂等：同一 (treeId, branch) 只在终态变化时写一条增量记录；`outcomeNote` 变更视为新记录。

## 四、读取与过滤（召回侧）

- `recallAtDecision`（spec §六 API）：召回 L2 时按 `taskLineage.treeId == 当前树 && branch != 当前分支` 过滤"同源异枝"候选——这正是分歧检测需要的对照集。
- 记忆驱动 fork 的提议文案消费 `forkWhy` + `outcome` + `outcomeNote`："相似任务 X 当时在同类岔路口选了 B（因为 …），结果是 …"。
- 阈值自学习（P2 后期）：abandoned-with-lessons 的分支谱系计入负样本。

## 五、不做的事（防漂移）

- 不做跨树谱系聚合（每棵树独立）。
- 不改 L0/L1/L3 的任何格式。
- 不在记忆侧反向写任务树（方向永远是 tree → memory）。
- 不做谱系 UI（面板的 ✦ 徽章已够 P2 前使用）。

## 六、实现顺序（P2 启动时）

1. memory 包：L2 记录类型 + capture 入参扩展（向后兼容默认缺省）。
2. core：`task-branch-terminal` 事件 + capture 携带 lineage 快照。
3. core：`recallAtDecision` 按谱系过滤（task-tree spec §六 已有签名，本规格只补过滤语义）。
4. 测试：终态写回幂等 / 无 taskRef 会话零变化 / 召回过滤只出同源异枝。
