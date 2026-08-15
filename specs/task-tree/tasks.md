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

## P2（未开始）

- [ ] 记忆驱动 fork 六步闭环（埋点→召回→分歧→提议→播种→回收）
- [ ] 树图 UI（分支色条升级为简化 DAG 画布）
- [ ] PM-Design 工作台整合（design.materialize = branch 产出）
- [ ] artifact 快照切换（file-history 复用）
