# Task Tree — 任务核对表

## P0（已完成 2026-08-15）

- [x] core `tasks/types.ts`：TaskNode（含 why 叙事字段）/TaskBranch/TaskTreeIndex/TaskReflogEntry
- [x] core `tasks/task-tree-service.ts`：createTree/appendStep/fork/switchBranch/abandon/getTree/getNode/listTrees/readReflog
- [x] 存储：`.deeporca/task-trees/<treeId>/{tree.json, nodes/<id>.json, reflog.jsonl}`（0700/0600、原子写、单写者、读优先 pending）
- [x] Action：task.create / task.step / task.fork / task.switch / task.abandon / task.list（RegistryHost 注入）
- [x] 验收①：agent 会话内可 `task.fork`（why 必填）
- [x] 验收②：面板可见双分支（含 why）——desktop `TaskTreePanel` + rail "tasktree" + IPC tasktree:list/get
- [x] 验收③：重启后树恢复（测试锁定）
- [x] 测试：6 用例（fork/switch/abandon/recovery/fail-open/id 防穿越/分支名净化）
- [x] 消歧规则写入 design.md：plan→tree 单向只读物化

## P1（2026-08-15 完成，除注记项）

- [x] merge + 冲突报告（artifact 级 cherry-pick；task.merge 返回冲突清单供人确认——确认清单 UI 列入 P2 树图改版）
- [x] session 绑定：SessionEntry 扩展 `taskRef: {treeId, branch, nodeId}` + normalize；task.create/fork 自动绑定；分支头 sessionRef 单次绑定防抢占
- [x] `/resume` branch 级：activateSession 恢复绑定分支为 active（fail-open）
- [x] Plan Mode 步骤物化（单向只读，§十一 规则；标题去重、计划内重复行折叠、幂等）
- [x] memory 谱系：L2 增量 spec 先行 → `specs/task-tree/memory-lineage.md`（实现列 P2）

## P2（2026-08-15 完成，快照切换除外）

- [x] 记忆驱动 fork 闭环（最小可用环）：①埋点 = AskUserQuestion 触发 `probeTaskRecallAtDecision`（一次/会话，隐藏 <task-recall-hints> 提示）；②召回 = `TaskTreeService.recallAtDecision`（token-Jaccard，世系映射 fork→分支）；③分歧判断留给 agent/人（候选带 outcome）；④提议 = task.recall Action 输出候选；⑤播种 = fork(memorySnapshot) 注入 contextSummary（memory-spawn ✦）；⑥回收 = merge/abandon 经 `appendSessionSystemMessage` 写 <task-lineage> 隐藏消息——现有记忆 capture 管道自然摄取，**零 memory 包改动**（memory-lineage.md 的 L2 字段实现因此降级为可选增强）
- [x] 树图 UI：泳道式画布（每分支一列、世系自上而下、active 高亮、abandoned 灰显、⚠ 冲突清单渲染、✦ 徽章）
- [x] merge 冲突确认清单：冲突持久化进 merge 节点 meta + 面板渲染
- [x] PM-Design 整合：design.materialize 在绑定会话中产出 → 分支 step 节点
- [ ] artifact 快照切换（file-history 复用）——**明确缓期**：需按分支管理文件快照模式，改动面大且与 file-history 的 per-session 语义冲突，待出现真实需求再立项
