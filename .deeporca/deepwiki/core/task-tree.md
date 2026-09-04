---
type: package
title: 任务轨迹树（TaskTreeService）
description: 工作区级任务轨迹树：内容寻址节点、分支/合并/归档、会话绑定、记忆 fork、桌面跨工作区读取与操作轨迹（taskTreeTrajectory）。
tags: [core, task-tree, trajectory]
---

# Task Trajectory Tree (TaskTreeService)

`packages/core/src/tasks/task-tree-service.ts` (33KB) implements workspace-level task trajectories (specs/task-tree): it persists the evolution of a task (root prompt → steps → forked branches → session bindings) as a navigable, rollback-able tree.

## Storage Layout

```text
<project-root>/.deeporca/task-trees/<treeId>/
├── index.json        # TaskTreeIndex：branches、activeBranch、headId
└── nodes/
    ├── <nodeId>.json # TaskNode：kind( root|step )、parentId、title、why、prompt、artifactRefs、memoryRefs、status
    └── ...
```

- Each tree has one `GitFileHistory` (P2 artifact snapshots); `pendingIndexes` in-memory state + debounced write to disk (`saveIndex({flush})` writes directly for critical operations).
- Directory permissions 0o700; unwritable projects fail open and degrade to an empty list.

## Node Addressing and Immutability

- **Content addressing**: `nodeIdFor(parentId, payload)` = the **first 12 hex chars** of sha256(`parentId\0payload`) — same parent and payload always yield the same id (idempotent, verifiable); **written nodes are immutable**, any edit = a new node (`edits are new nodes`), history is never rewritten.
- **ID containment**: `VALID_TREE_ID` (a UUID-shaped regex) guards all `treeId` path concatenation (invalid ids → `__invalid__` directory, never escaping the storage root); `sanitizeBranchName` cleans branch names provided by the LLM/IPC (48 characters, whitelisted characters, fallback on empty).

## Write Discipline (Read Before Making Changes)

- Reads prefer `pendingIndexes` (in-memory state); non-critical `tree.json` writes are **debounced 250ms**; **each branch change calls a synchronous flush** (`saveIndex({ flush: true })`).
- `reflog.jsonl` is append-only; **TaskTreeService is the sole writer of `.deeporca/task-trees/**`** (other modules read only or write through it).

## Public API

| Method | Responsibility |
| --- | --- |
| `createTree(rootPrompt, {why, branchName})` | Creates a tree (root node kind=root, branch `main`) |
| `appendStep(treeId, {title, why, prompt, artifactRefs})` | Adds a step node under the activeBranch head |
| `fork(branch)` | Branch derivation — **`why` is required** (`why` is the reason for the branch's existence; missing → rejected); new node payload contains `kind\0branch\0why` |
| `switchBranch` / `abandon(treeId, branch)` | Switch/abandon branches (switch first **checkpoints the outbound branch, then restores the inbound branch** `syncBranchFilesOnSwitch`; **HEAD branch cannot be abandoned**) |
| `merge` | Branch merge — **cherry-picks** source branch nodes onto the active branch, **conflict list is persisted into the merge node** (`nodeIdFor(parent, merge\0src\0picks\0at)`) |
| `bindSession(treeId, branch, sessionId)` / `removeSessionBinding` | Session binding — **branch head is stamped only once, silent rebinding rejected**; session entry has `taskRef` back-pointer |
| `restoreNodeSnapshot(treeId, nodeId)` | Snapshot restore (`nearestSnapshotHash` finds nearest materialization point) |
| `archiveTree` / `unarchiveTree` | Archive/unarchive entire tree (cascade on session deletion) |
| `getTree` / `getNode` / `listTrees` / `readReflog` | Read surface |
| `recallAtDecision(query, {excludeTreeId, topK})` | **Memory-driven fork**: at decision points, recommends branches using memory candidates (**excludes the current tree** to avoid self-reference) |
| `flush()` | Flushes all pending indexes to disk |

## Session Integration and Lifecycle Hooks

- `restoreTaskBranchForSession`: restores the bound branch on activation; `setSessionTaskRef`/`getSessionTaskRef` back-pointers.
- `materializePlanToTaskTree`: **one-way Plan materialization** — after `<proposed_plan>` is approved, the plan is written into the task tree (P1).
- `probeTaskRecallAtDecision`: probes memory recall at decision points (P2 fork closed loop).
- Cascade archiving: desktop `cascadeTaskTreeArchive` (session deletion → tree-wide archive cascade; refined before freezing, commit 946cf77b).
- `task.*` actions (`actions/task.ts`) are the LLM-side entry point; the desktop TaskTreePanel is the UI-side entry point.
- **跨工作区读取（desktop R3-7）**: main 侧 `registerTaskTreeIpc` 的 `rootService(workspaceRoot)` 对显式 root `new TaskTreeService(root)` 读取该工作区已落盘状态（与归档处理同一一致性论证）；`TaskTreeTrajectory` IPC → `main/task-trajectory.ts` 的 `extractTaskTrajectory(sessionIds, projectDir)` 把绑定会话 JSONL 归约为**操作记录**（tool/ok/summary/触及文件，最多 8 会话 × 500 操作，**从不读入会话正文**），由 `TaskRecordPanel` 展示（见 [desktop/renderer-components](../desktop/renderer-components.md)）。

## Security Invariants

- `treeId` path containment validation: blocks LLM input from escaping the storage root (commit 120684cf).
- Artifact refs resolution is constrained within projectRoot (`resolveArtifactPaths`).

## Focused Tests

- `task-tree.test.ts` (759 lines / 35KB): **lineage** (create → append → fork produces two visible branches; fork requires why), **content addressing** (node id shape is stable), **containment** (treeId traversal ids cannot escape the storage root), **restore** (a new instance reads the persisted tree), **fail-open** (corrupted/missing trees degrade rather than throw), merge/abandon/snapshot/reflog/session binding/archiving.
- `actions.test.ts` (task.* action contract).
- Desktop: `task-trajectory.test.ts`（操作轨迹归约）、`symbol-graph-query.test.ts` 同族纯函数测试；`TaskTreePanel`/`TaskRecordPanel` 覆盖在 app 级 DOM harness。

## Related Pages

- [actions](actions.md) (task.* actions), [architecture/session-lifecycle](../architecture/session-lifecycle.md) (taskRef/materialization hooks)
- [desktop/renderer-components](../desktop/renderer-components.md) (TaskTreePanel)
- [workflows/llm-tool-loop](../workflows/llm-tool-loop.md)