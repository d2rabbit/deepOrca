# Coord Chain 协作流程设计 — 共享、跨机 Fork、分支联动、工区合并、任务合并

> 日期：2026-09-04 · 状态：设计定稿（OC3 实施蓝本）· 上游：[design.md](./design.md) §5/§8/§9 ·
> 代码基线：`packages/ledger`（OC1 全量）+ `packages/desktop/src/main/coord-chain/`（ChainNode/transport/store）+
> `task-tree-bridge.ts` + core `TaskTreeService`（任务树 hub，merge 自 `feat/modern-ui-redesign`）
> 本文回答五个问题：**怎么共享工作区与会话任务；别人怎么从我的任务树 fork 一个节点；fork 如何与分支联动；
> 工作区怎么合并；任务怎么合并。** 每节末尾标注【已实现 / OC3 接线 / OC4】。

## 0. 两个世界与 ID 映射（一切的前提)

|            | 本地任务树（单机）                                                                                 | 协调链（去中心化）                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 载体       | `TaskTreeService`：`tree.json + nodes/<id>.json + reflog.jsonl`，存 `<root>/.deeporca/task-trees/` | 账本记录流：`task.share`（谱系）+ `ws.commit`（版本）+ `task.claim/progress/done`（状态）                 |
| fork 表达  | fork 节点（必带 `why`），fork 即切分支                                                             | `task.share` 的 `parentRecordId` 指向上游记录（单亲边）                                                   |
| merge 表达 | cherry-pick：目标分支挂 merge 节点，源分支标 `mergedInto`                                          | 版本层：merge commit（`parents: [A, B]` 双亲）；任务层：收敛 `task.done` + `note`（refRecordId 引用）注记 |
| 状态       | `status: planned/running/done/abandoned`                                                           | `task.claim/progress/done` 记录，视图按 (ts, recordId) LWW                                                |
| 归档       | archived（文件永留）                                                                               | 账本不可删（链保留一切）                                                                                  |

**ID 映射**（桥接核心，`task-tree-bridge.ts` 已实现映射函数）：本地节点 meta 挂
`chainRef = { chainId, recordId, commitCid }`——本地 fork 节点 ↔ 链上 `task.share.recordId` ↔
版本 `ws.commit.commitCid` 三向互指。链是跨机器的**逻辑任务树**；每台机器的 TaskTree 是它的一份**物理投影**。

---

## 1. 如何共享工作区与会话任务

### 1.1 开启共享（入链）

```
用户在项目内开启「共享」
  → 主题解析：git remote 归一 → theme 串 → themeId（无 remote 则强制显式主题名，目录名不参与匹配 R24）
  → 用户级总闸 coordination.enabled + 项目级 coordination.shared（R1，双层开关）
  → mDNS 发现同主题链（invite 码兜底）→ 握手（主题钉扎）→ chainInfo → chainSnapshot
  → 从创世全量重放校验（R5）→ 采纳 → 广播 member.join
```

【已实现：ChainNode create/join 全流程 + e2e】OC3 接线：settings 双层开关 + 面板引导。

### 1.2 共享的三层内容（粒度即三层，不共享整个目录）

| 层                           | 上链形式                                                                                                                                              | 触发                                                                                                                         | 状态                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **版本层**（工作区改了什么） | `ws.commit`：tree(manifest) → commit（parents/message/taskRef），大文件走 blob 分块                                                                   | 用户选定文件/目录，或**会话变更集直通**：`GitFileHistory.recordCheckpoint` 产出的 `changedFilePaths`/`checkpointHash`（R28） | 对象模型/提交构造【已实现】；`chain:wsCommit` IPC【OC3】 |
| **任务层**（会话任务是什么） | `task.share`：title/goal/trajectory(压缩 reflog+TaskTrajectory)/filesTouched/conclusion/leftovers + `parentRecordId`（谱系）+ `commitRef`（随行版本） | 会话/任务树节点「上链共享」动作，逐次显式 + 预览确认（R20）；自动共享为独立子开关默认关（R16）                               | `task-tree-bridge` 载荷映射【已实现】；面板动作【OC3】   |
| **资产层**（项目资料）       | `asset.publish`：需求文档/设计稿/架构图，4MB 分块逐块验哈希                                                                                           | 用户发布动作                                                                                                                 | publish/fetch【已实现】；UI【OC3】                       |

**会话任务的完整共享动作序列**（一个人「把我的会话任务放上去」）：

```
会话进行中 → GitFileHistory 持续 recordCheckpoint（已有行为，不变 R21）
用户点「上链共享」→ 预览卡展示：将共享到主题 X 的链（N 名成员）
  变更集 diff（changedFilePaths 对应文件的 tree diff）+ 任务摘要（轨迹压缩，不含对话原文 R16）
确认 → ① collectBranchSnapshot(任务树分支) → branchToTaskSharePayload → task.share
     ② 变更集 → applyChangesToTree → tree → commit（taskRef = ①的 recordId）→ ws.commit
     ③ 两者经 ChainNode gossip → slot 主打包 → quorum 联签终局 → 全员可见
```

【①②③ 的协议与节点逻辑已实现；预览卡与 IPC 是 OC3 任务 14/15】

### 1.3 其他人如何"看到并拿到"你的工作区

- **看**：共享空间面板三栏（资料/任务记录流/动态）全部读本地 SQLite 视图（账本重放而来），版本谱系 `wsLog`、两版差异 `wsDiff` 即两 tree 的键集对比（毫秒级）。
- **拿**：`wsCheckout(commitCid, 目标目录)` → 按 commitCid 拉 tree → 逐 blob want/chunkData 逐块验哈希 → **预览确认后**物化落盘；目标路径必须在用户选定目录内（路径穿越拒绝，R29）。历史任意版本可检出。
  【对象拉取/校验/重组【已实现】；checkout 物化与预览【OC3】】

---

## 2. 其他人如何从你的任务树上 fork 一个节点

链上没有"你的树"这个实体——**树就是 task.share 谱系森林**（`buildChainGenealogy` 已实现重建）。fork 一个节点 = 在谱系上长出一个带 `parentRecordId` 的子记录。动作序列（B fork A 的任务）：

```
B 在任务记录流选中 A 的 task.share 节点（recordId=r:A）→ 点「接续开发 / Fork」
 ① B 发 task.claim { taskId: r:A, note: "fork：passkey 方向" }
    —— 声明性软锁：即时 gossip，A 的面板亮起"B 正在此任务上工作"（R17/R18，不阻塞任何人）
 ② B 本地：TaskTreeService.fork(treeId, { name: "passkey", why: "并行验证 passkey 方案" })
    —— 本地树长出 fork 节点；新节点 meta.chainRef = { chainId, recordId: r:A }
 ③ 版本对齐（若 r:A 带 commitRef）：chain:wsCheckout(r:A.commitRef, 预览确认) 把 A 的版本
    物化/打补丁到 B 的工作区（R15/R31）——B 的代码起点 = A 的终点
 ④ B 的新会话注入上游上下文卡：目标/已完成/触及文件/结论/遗留 + 上游 chainId + r:A + commitCid
 ⑤ B 完成后共享：新 task.share 且 parentRecordId = r:A —— 链上 fork 边成形
```

- **Fork 的链上定义就一条：`parentRecordId` 指向别人任务记录的新 `task.share`。** 谱系森林天然呈现"谁从谁 fork"。
- 同一节点可被多人 fork（多子）——并行路线全部保留，与链工作区"并行提交=分叉保留"同构。
- fork 记忆召回：`memory-spawn` 类 fork 的 memorySnapshot 随 task.share.trajectory 上链，他机接续时可回放。
  【桥接与谱系重建【已实现】；claim 的 defineAction（chain.query/chain.claim，R17）与面板入口【OC3 任务 16/17】】

## 3. Fork 如何与分支联动（任务谱系 × 版本谱系同构生长）

**原则：任务每分叉一次，版本就分叉一次；两个谱系共享同一批分叉点。**

```
A:  task.share(r:A1, commitRef=c1)          ws.commit(c1, parents=[])      ← A 的基线
B:  fork r:A1 → task.share(r:B1, parent=r:A1, commitRef=c2)
                                       ws.commit(c2, parents=[c1])         ← 版本分叉点 = 任务分叉点
A:  继续 → ws.commit(c3, parents=[c1])       （A 的版本线，与 c2 平行保留）
B:  完成 → task.done(r:B1) + ws.commit(c4, parents=[c2])
```

- **联动规则（硬约束）**：fork 产生的首个 `ws.commit` 必须以 fork 源任务的 `commitRef` 为 parent——任务分叉点即版本分叉点；此后每个 ws.commit 可选带 taskRef 回指当前任务。
- **双向跳转**：面板任务节点 →（commitRef）→ 版本谱系高亮该线；版本节点 →（taskRef）→ 任务卡。数据都在视图 `commits`/`tasks` 表（已建）。
- **本地侧联动**：TaskTree 分支的 `sessionRef`/checkpoint 已绑会话；fork 时把当前 checkpointHash 写入分支 meta，`chain:wsCommit` 优先取该 checkpoint 的 changedFilePaths——本地树、本地版本库、链上双谱系三者对齐。
  【链上互链字段与查询【已实现】；联动 UI 与 fork 时自动首提【OC3 任务 16】】

## 4. 如何实现工区合并（工作区对工作区）

"工区合并"分三阶梯，按成本递增（v1 只做前两级，第三级 OC4 评审）：

### 4.1 择线（默认态，已实现语义）

并行提交 = 谱系分叉，全部保留；视图 head 按 (ts, commitId) LWW，用户可在版本谱系里**显式切换 head**（R30）。适合"接力"主场景：我基于你的线继续，不并行改同一文件。

### 4.2 检出对齐 + cherry-pick（任务合并的主路径，OC3）

```
B 想要 A 线上的部分成果：
 ① wsDiff(我的head, A的head) → 文件级差异预览
 ② 勾选要的文件/任务 → wsCheckout 物化到本地工作区（预览确认 + 目录白名单，R29）
 ③ 本地确认落盘 → 一次性 ws.commit（parents=[我的head]，message="merge ← A@<taskRef>"）
    —— 版本层收敛为一个新提交；被并入方分支在任务层标 mergedInto（对齐 TaskTreeService.merge 语义）
```

- **冲突规则（与本地任务树一致）**：同路径不同 blob = 冲突，**报告不自动解**——预览卡列出 `artifactRef → 两边版本`，人工选择取哪边或手工合；确认后随本次 ws.commit 上链注记。
- 这正是 `TaskTreeService.merge(treeId, srcBranch, picks)` 的跨机器版：picks 从"源分支节点"变为"对端 commit 的文件子集"，mergedInto/冲突报告语义原样保留。

### 4.3 三向合并（diff3，OC4）

共同祖先 = fork 点 commitCid；对 base/ours/theirs 做 diff3 产出合并 commit（`parents=[我的head, 对方head]` 双亲）。触发条件：dogfood 中"接力冲突"高频才上（design §8.3/开放问题 5）。

### 4.4 "同项目多工作区"本来就同链

主题机制（§1.1）保证同 git remote 的所有工作区自动汇入同一条链——**工作区之间的聚合不需要合并动作**，合并只发生在版本线与任务线上。

## 5. 如何进行任务合并（任务层收敛）

任务合并与工区合并是同一动作的两面：**文件合并在版本层，任务状态在记录层。**

```
B 完成fork并并入 A 的线：
 ① 版本层：ws.commit(merge, parents=[B_head, A_head|A_基线])   ← 双亲 merge commit（4.2/4.3）
 ② 任务层：task.done { taskId: r:B1, note: "已并入 主任务，携带 passkey 实现" }
 ③ A 侧视图：r:B1 状态 done（LWW），面板在 r:A1 下渲染"⑂ 已合并 ← B"回边
    —— 对齐本地任务树 mergedInto 的渲染语义（九轮 UI 迭代的既有约定）
 ④ 收敛注记：note { refRecordId: r:A1, text: "merge ← r:B1 (commit c4)" } 上链存证
```

- **同任务并行 done 的冲突**：不试图强一致——视图按 `(ts, recordId)` LWW 取终态，全部记录保留可审计（design §5）。
- **不引入 `task.merge` 新记录类型**：合并的"双亲"语义由版本层 merge commit（天然 parents[]）承载，任务层用单亲 task.share + done/note 注记即可完整表达——协议面保持最小。
  【claim/done 记录与 LWW 视图【已实现】；合并编排动作与 UI【OC3 任务 15/16】】

## 6. 端到端时序（A、B 两人的完整故事）

```
① A 在项目（git remote X）开共享 → 创世 orca1-xxxx（theme=X）
② B 同项目开共享 → mDNS 命中同主题 → 入链重放 → member.join 终局 → 双方成员
③ A 会话做完调研 → 上链共享：task.share(r:A1)+ws.commit(c1) → 联签封块 → B 面板可见
④ B「fork」→ claim(r:A1) → 本地树 fork → checkout c1 对齐代码 → 接续开发
⑤ A、B 并行各改各的 → 各自 ws.commit（c2∈A线 / c3∈B线，parents=[c1]，版本分叉保留）
⑥ B 先完成 → task.done(r:B1) → task.share(r:B2, parent=r:A1, commitRef=c4, c4.parents=[c3])
⑦ A  cherry-pick B 的 passkey 文件 → 合并 ws.commit(parents=[c2,c4]) → task.done + note 存证
⑧ 全程任何一步：预览确认才出机（R20）；链浏览器可审计每条记录的签名与联签（R5/R9）
```

## 7. 落地清单（对照本文）

| 项                                                                                | 状态                                    |
| --------------------------------------------------------------------------------- | --------------------------------------- |
| 主题同链 / 握手加密 / 重放入链 / gossip / 联签终局 / 资产拉取 / 断线续传          | ✅ ChainNode + e2e                      |
| `task.share` parentRecordId 谱系 / 谱系森林重建 / 树↔载荷映射 / `taskGenealogy()` | ✅ task-tree-bridge                     |
| LWW 任务视图 / cherry-pick 冲突报告语义 / 本地 fork+merge（TaskTreeService）      | ✅（随 `feat/modern-ui-redesign` 合入） |
| `chain:wsCommit/wsLog/wsDiff/wsCheckout` IPC + 预览确认卡 + `.chainignore`        | OC3 任务 14                             |
| 「上链共享」/「fork 接续」面板动作 + 上下文卡注入 + claim defineAction            | OC3 任务 15–17                          |
| 共享空间三栏 UI + 审计子页 + i18n 六套                                            | OC3 任务 18                             |
| diff3 三向合并 / blob 静态加密+ACL / 账本修剪                                     | OC4                                     |
