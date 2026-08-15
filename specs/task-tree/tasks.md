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

## P1（未开始）

- [ ] merge + 冲突确认清单（artifact 级 cherry-pick）
- [ ] session 绑定：SessionEntry 扩展 `taskRef: {treeId, nodeId}` 反向指针；`/resume` branch 级
- [ ] Plan Mode 步骤物化（单向只读，按 §十一 规则）
- [ ] memory 谱系：L2 增加 fork 谱系字段（增量 spec 先行）

## P2（未开始）

- [ ] 记忆驱动 fork 六步闭环（埋点→召回→分歧→提议→播种→回收）
- [ ] 树图 UI（分支色条升级为简化 DAG 画布）
- [ ] PM-Design 工作台整合（design.materialize = branch 产出）
- [ ] artifact 快照切换（file-history 复用）
