# AI 协调工作链（Coord Chain）— 设计文档

> 日期：2026-08-27 · 状态：**本阶段方案（设计稿 v6 交互定稿，2026-09-08）** · 归属：**王牌路线 OC**（优先级高于 next-version，见 `docs/features/coord-chain-plan.md`）
> **分支实现 → 底层实现参考（2026-09-08 用户拍板；原 2026-09-03「分支实现归档、合并后转正」口径废止）**——coord-chain 回归**本阶段方案**，不再通过 `next/coord-chain` 分支实现与合并；该分支已完成的协议底层（Ed25519/X25519+AES-GCM 协议核心、ws 加密传输、ChainNode 建链/重放、mDNS 发现+邀请码、SQLite 视图接线、双节点 e2e）**保留为实现参考**（快照归档 `specs/branch-implemented/coord-chain/`），**上层交互逻辑以本设计稿 v6 + §11 链上行为协议为准实施**。
> **2026-09-08 对照真实 UI 修正（用户拍板）**——共享模型改为「工作区级开关（会话模块打开工作区时决定）+ 任务树节点级 opt-out」；废除逐模块「上链」动作与逐动作确认，改为**自动记账**（R32/R33）；新增 知识库追随代码（R35）、编辑器本地历史（R36）、会话模块对齐本地 UI + 链 id 弹窗（R37）、会话 fork 记忆摘要注入（R38）、会话文件快照（R39）、任务树 hub 本地/链上二分（R34）。见 §10 与设计稿 v6（`screen-workchain.html`）。
> **数据落点修正（2026-09-08 补充，R40）**——`.deeporca/` 是项目数据根（类比 `.git`）：本项目全部历史数据（会话/审查报告/知识库/设计稿/任务树等）与链上行为数据统一落工作区 `.deeporca/`；coord-chain 账本/blob/视图随之迁入 `<workspace>/.deeporca/coordchain/<chainId>/`（原 `~/.deeporca/coordchain/` 仅保留设备密钥）。
> **链上行为深化（2026-09-08 · 交互定稿后）**——模块交互（§10 矩阵 + 设计稿 v6）定稿后，§11 把每个链行为落成精确协议：记录生命周期总表、share.rule/task.stub 节点共享协议（标题占位 + 视图遮蔽 + 不回收边界）、编辑器链上条目 = ws.commit 文件级投影（editor.snapshot 记录类型废止）、KB 覆盖/合并的机械判定（commit 谱系时间线 + AGENTS.md 标记块合并 + 符号图 hook 触发集）、会话文件快照与 fork 物化、轨迹图树构建算法、离线 outbox 与一致性总则。
> 配套：[requirements.md](./requirements.md)（R1–R40）· [tasks.md](./tasks.md)（OC1–OC4）· 调研 [2026-08-27-coord-chain-technology-survey.md](../../docs/research/2026-08-27-coord-chain-technology-survey.md)

## 1. 定位与总原则

DeepOrca 的跨设备协作层：**局域网联盟式许可链 + 内容寻址资产层 + 任务谱系协调语义**。

产品隐喻：**「共享文档空间」的放大版**——像腾讯文档/飞书共享文档那样"打开就有、成员可见、随手共享"，但共享的不是单篇文档，而是**整个项目的工作记录**（需求文档/设计稿/架构图 + 任务记录 + 会话轨迹），且接收方是 AI 可直接消费的（接续开发）。与共享文档产品的本质差异：无平台依赖（数据不出局域网）、防篡改可审计（链）、记录含 AI 可执行上下文（任务谱系）。

- **只认工作区主题**（2026-08-27 需求确立）：共享的判定单位是**工作区主题**，不是人工建链起名。同一局域网内，工作区主题相同的工作区自动同链、共享一切链上内容；主题不同则**在发现层即隔离**（互相不可见，连握手都不发生）。链的命名空间 = 主题命名空间。
- **链工作区 = 自研类 Git 版本层**（2026-08-27 需求确立）：共享层不是"一次性传文件"，而是版本化工作区——blob/tree/commit 对象模型跑在内容寻址资产层上，commit 锚定进区块。**仓库已有三处底子**：`GitFileHistory`（`packages/core/src/common/file-history.ts:29`）已自研 manifest→tree→commit 管线；CID/blob 分块层即对象存储等价物；账本哈希链即谱系锚定。第一版**无 merge**（并行提交=谱系分叉保留），见 §8。
- **无云**：不依赖任何云端账号/服务器；数据不出局域网（relay 期前）。
- **真链但非炒币链**：哈希链式追加账本、Ed25519 成员签名、轮值提议人 + 联签终局、从创世可重放校验。无 PoW/PoS/代币——威胁模型是"事后可审计"而非匿名对手方 BFT。
- **链上只有元数据**：区块记录 ≤8KB；文件本体走内容寻址 blob 层。
- **默认关、两级共享（2026-09-08 修正，R32）**：工作区默认不共享；是否入链在会话模块**打开该工作区时**一次性决定。共享开启后**所有节点默认可见可操作**，链上操作**自动记账**——不设逐模块「上链」按钮、不设逐动作确认；唯一的逐节点控制点是任务树上的节点级共享开关（关 = 对成员仅标题可见且锁定）。逐动作预览确认仅保留给**本地物化副作用**（接续检出对齐、历史版本检出）。
- **`.deeporca/` = 项目数据根（R40，类比 `.git`）**：本项目产生的一切历史数据与模块行为数据——会话（sessions）、审查报告（reviews）、知识库（deepwiki）、设计稿（designs）、索引任务（jobs）、原型产物（prototypes）、任务树工作区（task-trees）——统一落在工作区 `.deeporca/` 下；coord-chain 的账本/blob/视图/记录索引加入同一根（`.deeporca/coordchain/<chainId>/`）。链子目录 gitignore：链数据的分发通道是链本身（gossip + blob 同步 + 从创世重放可重建），不随代码仓库远端分发。设备密钥是唯一例外（设备级身份，存 `~/.deeporca/coordchain/device-key.json`）。
- **不进 core**：协作链不触碰 LLM 会话回路；`@deeporca/ledger` 是纯协议库，desktop main 持有节点生命周期。

## 2. 总体架构

```
┌─ renderer（浏览器 bundle）──────────────────────────────────────────┐
│  设置面板「协作链」段        Hub「工作链」二级浮层       会话/任务   │
│  （开关/设备名/配额）        （链ID/成员/区块流/          「上链共享」 │
│                              资产流/任务流/链浏览器）      /接续开发   │
└──────────────┬──────────────────────────────────────────────────────┘
               │ chain:* IPC（shared/ipc.ts 契约，preload 类型化）
┌──────────────┴─ main（Electron）────────────────────────────────────┐
│  coord-chain/ 服务（节点生命周期、UI 桥接）                          │
│   ├─ discovery.ts   mDNS/DNS-SD 广播与监听（multicast-dns，           │
│   │                 按工作区主题 themeId 匹配，跨主题即隔离）          │
│   ├─ transport.ts   ws 服务器 + 出站连接、ECDH/AES-GCM 加密帧、      │
│   │                 Ed25519 挑战握手、协议版本协商                    │
│   ├─ sync.ts        记录/区块 gossip、want/have、全量重放同步        │
│   └─ blobs.ts       分块存储/拉取/校验/配额 LRU                      │
│  ┌─────────────── @deeporca/ledger（packages/ledger/，零依赖）─────┐ │
│  │ identity/  device key、keyId、指纹        encode/  JCS 子集      │ │
│  │ record/    类型、签名、recordId            block/   区块、联签    │ │
│  │ chain/     创世、链ID、重放校验、分叉裁定   cid/      SHA-256 CID  │ │
│  │ theme/     工作区主题规范化（git remote/显式名 → themeId）        │ │
│  │ ws/        链工作区对象模型（blob/tree/commit、tree diff）       │ │
│  │ view/      node:sqlite 物化视图（可重建）                          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│  集成点：TaskTrajectory（任务负载）· GitFileHistory（会话变更集 →    │
│         链工作区 commit）· defineAction（chain.* LLM 表面）·          │
│         工作区身份（workspace-registry/app-dirs → 主题解析）           │
└──────────────────────────────────────────────────────────────────────┘
               │ ws（局域网，加密帧）
        其他 DeepOrca 实例（对等 mesh，≤50 节点全互联）
```

目录落点：`packages/ledger/src/{identity,encode,record,block,chain,cid,view}/`（各 200–600 行，遵守 2500 行纪律）；desktop `src/main/coord-chain/`；renderer 复用现有 ui 原语，无新依赖。

## 3. 身份与准入（L0）

- **设备密钥**（设备级身份 · 项目数据根原则的唯一例外，R40）：首次开启时生成 Ed25519 keypair，存 `~/.deeporca/coordchain/device-key.json`（0600，DER base64）。`keyId = "did" + SHA-256(pubkey)[:16]`；UI 显示指纹分组（`did:abcd 1234 efgh …`）。设备名默认主机名、可改。
- **成员注册**：`member.join { deviceName, pubKey }` 记录入链后即成员；准入策略在链参数中：`open`（默认，局域网即团队）/ `invite`（须创世成员或其授权者签名的邀请码）。
- **撤销**：`member.leave`（自主）或 `member.expel`（创世成员签名，OC4）。撤销影响后续握手准入；历史记录与其签名永久保留（不可抵赖）。

## 4. 工作区主题与建链（R3/R4/R24/R25）

**共享只认工作区主题**：链不是人工创建命名的，而是由工作区主题唯一决定。主题是跨机器稳定的规范身份——现有 `projectCode` 由绝对路径派生（`packages/core/src/common/app-dirs.ts:51`，超长时 basename+路径哈希），机器本地、跨机必不相等，**不能**作为主题。

### 4.1 主题解析（`packages/ledger/src/theme/`，纯函数可单测）

| 优先级 | 来源 | 规范化规则 | theme 串形态 |
| --- | --- | --- | --- |
| 1 | git remote（origin 优先，可选 upstream） | 协议无关归一（SSH/HTTPS 同源）：小写 host、去 `.git` 后缀、去凭据 | `git:github.com/zshipu/deeporca` |
| 2 | 用户显式主题名（非 git 工作区，或用户覆盖自动推导） | 小写化、空白转连字符、长度 1–64 | `name:平台中台重构` |
| 3 | 目录名 | **仅本地显示，不参与跨机匹配**——无 git remote 且未设主题名的工作区，共享面板提示"无法与其他机器自动匹配，请设定主题名"后方可开启 | （不产生 theme 串） |

`themeId = "wt:" + SHA-256(theme 串)[:16]`。面板明示当前工作区的主题来源与值，用户可随时覆盖（覆盖 = 换链，本机视角切换到另一条链，原链数据保留）。

### 4.2 创世与链 ID

每个主题一条链。该主题在本局域网**首次**有工作区开启共享时创世：

```jsonc
{
  "type": "genesis",
  "theme": "git:github.com/zshipu/deeporca",   // 工作区主题规范串（链的命名空间）
  "createdAt": "2026-08-27T09:00:00Z",
  "creator": "did:9f3a…",                       // 创世成员 keyId
  "params": {
    "quorum": "majority",                       // majority | twoThirds | all
    "blockIntervalMs": 2000,
    "maxBlockRecords": 256,
    "admission": "open"                         // open | invite
  },
  "salt": "<32B random>"
}
```

`chainId = "orca1" + base32(SHA-256(JCS(genesis))).slice(0, 20).toLowerCase()`，展示为 `orca1-abcd23-…` 五字符分组。**链 ID 与主题双向锚定**：加入校验时同时核对创世块的主题串与本工作区 themeId——主题不符即拒绝（防止主题名碰撞/拼写近似导致误入）。

### 4.3 一机多工作区 = 并行多链

设备上 N 个开启共享的工作区（N 个主题）= 同时持有 N 条链，各自独立的账本/blob/视图目录（`<workspace>/.deeporca/coordchain/<chainId>/`，随项目数据根走，R40）与联签成员表。同一设备身份（同一 Ed25519 keyId）在各链中独立计为成员；同一机器上同主题的两个克隆各有项目级存储，按 chainId 对齐、靠 gossip 收敛同一账本。

## 5. 记录模型（L3，R7/R8/R14/R17）

Record 规范形态（JCS 编码后整体 Ed25519 签名）：

```jsonc
{
  "type": "task.share",
  "ts": 1807286400000,
  "author": "did:9f3a…",
  "parentRecordId": "r:8c11…",       // 可选：任务谱系上游
  "body": { /* 类型化负载，见下表 */ },
  "sig": "<ed25519 sig over JCS of {type,ts,author,parentRecordId?,body}>"
}
// recordId = "r:" + SHA-256(规范字节)[:24]
```

| type | body 关键字段 | 语义 |
| --- | --- | --- |
| `member.join` / `member.leave` | deviceName, pubKey | 成员准入/退出 |
| `asset.publish` | cid(manifest), name, mime, size, kind(`requirement`/`design`/`architecture`/`file`/`other`), note | 资产发布 |
| `asset.update` | cid, parentRecordId | 新版本（版本链头） |
| `ws.commit` | treeCid, parents[], message, taskRef?, assetRefs? | **链工作区提交**（版本锚定，见 §8） |
| `asset.revoke` | cid, reason | 撤销声明（视图过滤，链保留） |
| `task.share` | title, goal, trajectory(压缩自 TaskTrajectory), filesTouched, conclusion, leftovers[], commitRef? | 任务记录上链（R14；变更随行 ws.commit，taskRef 互链） |
| `task.stub` | nodeId, title, ts | **标题占位记录**（节点关闭共享时上链的唯一内容：仅标题 + 锁定态；见 §11.2） |
| `branch.fork` | from(recordId/commitCid), branch, domains[], why | 任务树声明式 fork（fork = checkout 新分支 · 即上链；fork 铁律，R32） |
| `task.claim` / `task.progress` / `task.done` | taskId(=task.share 的 recordId), note, percent? | 认领/进度/完成 |
| `session.offer` | taskId, summary, commitRef? | 共享会话摘要供接续（不含对话原文） |
| `note` | text(≤2KB), refRecordId? | 自由批注 |
| `design.version` | name, manifestCid, parentRecordId, taskRef?, domain(`prototype`/`ui`) | 原型/UI 设计版本（`asset.update` 特化；共享开启后随任务终态自动记账，R33） |
| `kb.sync` | baseline, adopted[], keptLocal[], agentsMerged, symbolHook | 知识库追随代码的合并结果记账（自动，无人工确认；R35） |
| `share.rule` | nodeId, shared: bool, scope? | 节点级共享开关变更记账（R16/R32；关闭后该节点对成员仅标题可见且锁定） |
| ~~`editor.snapshot`~~ | — | **废止于 2026-09-08 深化**：编辑器链上条目不是独立记录，而是相关 `ws.commit` 的**文件级投影**（见 §11.4） |

元数据冲突（如同任务并行 `task.done`）不试图强一致：视图按 `(ts, recordId)` 排序取 LWW，全部记录保留可审计。

## 6. 区块、封存与分叉（R8/R9）

- **出块**：本地待封记录先进 gossip（成员即时可见"未封存"），轮值提议人按 `slot = height % 成员数` 取Slot，每 2s（或满 256 条）打包 `block = { height, prevBlockHash, ts, proposer, merkleRoot, records[] }` 并广播征求批准。
- **终局**：收到 ≥ quorum（默认多数派 `floor(n/2)+1`；可选 2/3 或全员）成员对区块哈希的 Ed25519 批准签名后终局，物化视图随之推进。
- **超时顺延**：slot 持有者 4s 未出块，`slot+1` 接替（view-change-lite）。
- **分叉裁定**：同高度竞争块按"批准数多者胜 → 平票取 proposer 序号小者"；落败侧的记录按 recordId 幂等回流胜者后续区块（不丢已签名记录）。
- **重放校验**（加入链时，R5）：从高度 0 逐块验 `prevBlockHash` 链、每记录签名、每区块 quorum 签名，任一不符即拒绝并报首个不一致位置。

账本落盘：`<workspace>/.deeporca/coordchain/<chainId>/ledger/blocks/<height>-<hash>.json`；副本 `node:sqlite` 视图 `<workspace>/.deeporca/coordchain/<chainId>/view.db`（members/records/assets/tasks/blocks 表）。**视图可删除重建，账本为唯一事实源**（R10）。

## 7. 发现、传输与同步（L1/L2，R4/R19）

- **mDNS/DNS-SD**：服务 `_deeporca-chain._tcp.local.`，TXT：`wt=<themeId前8>` `cid=<链ID前8>` `v=1` `port=<同步端口>`（随机监听端口，防火墙首启授权为已知体验成本，自检命令内置面板）。`multicast-dns` 纯 JS 实现。**发现即按 themeId 匹配**：只与本机已开启共享的工作区主题相同的实例握手；主题不同 = 不同项目 = 发现层直接忽略（不连接、不可见、不出现在成员列表）——跨主题隔离不依赖 UI 过滤。
- **邀请码兜底**：`deeporca-chain://<host>:<port>/<themeId>[?sig=<创世成员签名>]`——组播被禁的企业网可用；`admission: invite` 时 sig 必填。邀请码携带 themeId 而非自造链名，收方核对本工作区主题一致才接受。
- **握手**（首帧协议版本协商 → 双向 Ed25519 挑战签名 → X25519 ECDH + HKDF 派生会话密钥 → 后续帧全 AES-256-GCM）。明文帧直接断连。重复连接按 keyId 去重。
- **同步**：
  - 新成员：`getChain` → 全量区块流 → 重放校验（R5）。
  - 稳态 gossip：签名记录即时扩散；区块/批准签名扩散；高度差探测触发增量补拉。
  - 断线重连：按 (height, blockHash) 对齐后续传。
- **blob 传输（R12/R13）：** 分块 4MB → `chunkCid = "b:" + SHA-256(chunk)[:24]`；have/want 位图请求 → 任意持有者供块 → 逐块哈希校验后写入对象库 `<workspace>/.deeporca/coordchain/<chainId>/objects/`（配额默认 2GB，LRU；清理不影响账本）。**大文件永不进区块**。blob之上的版本化语义（tree/commit/谱系/diff）见 §8 链工作区。

## 8. 链工作区（Chain Workspace）：自研类 Git 版本层（R27–R31）

共享层是**版本化工作区**：类 Git 的对象模型（blob/tree/commit）跑在链的资产层上，commit 锚定进区块记录。仓库已有三处底子，本层是把它们接成一体：

- **底子一（对象管线）**：`GitFileHistory`（`packages/core/src/common/file-history.ts:29`）已自研"manifest（`files: Record<path, {blob, mode}>`）→ tree → commit"管线（会话 checkpoint/undo 在用）——链工作区的 tree 对象直接沿用该形态；
- **底子二（内容寻址）**：OC1 的 CID/blob 分块层即 git 对象存储的等价物（天然跨 commit 去重）；
- **底子三（谱系锚定）**：账本本身是哈希链，commit 作为记录上链即获得签名 + 联签级防篡改。

### 8.1 对象模型（`packages/ledger/src/ws/`，纯函数可单测）

| 对象 | 形态 | 说明 |
| --- | --- | --- |
| blob | CID → 4MB 分块 | 与资产层共用；同内容只存一份（内容寻址去重） |
| tree | `{ version: 1, entries: Record<path, { blob, mode }> }` | 快照清单，与 file-history manifest 同构；`treeCid = CID(JCS(tree))` |
| commit | `{ treeCid, parents: commitCid[], message, author, ts, taskRef? }` | `commitCid = CID(JCS(commit))`；作者 Ed25519 签名 |

commit 同时镜像为 `ws.commit` 记录（§5）上链；对象库 + 账本双通道都可独立重放校验（对象按 CID 校验内容，记录按签名/联签校验锚定）。

### 8.2 操作语义（类 Git 动词，UI 与 AI 双表面）

- **提交（commit/push）**：变更来源二选一——(a) 用户选定文件/目录；(b) **直接采用会话变更集**（`GitFileHistory.recordCheckpoint` 已产出 `changedFilePaths`/`checkpointHash`，"本次会话改了什么"现成可得）→ 在 parent head 的 tree 基础上叠加变更构造新 tree → commit → blob 分块分发 → `ws.commit` 记录。共享确认预览即变更集 diff（R20）。
- **拉取与检出（pull/checkout）**：按 commitCid 拉 tree + blobs → 逐块校验 → 物化到本地目录（预览确认后写盘，目标路径必须落在用户选定目录内）；可检出任意历史版本。
- **历史与 diff（log/diff）**：commit 谱系视图（谁/何时/为什么改）；任意两 commit 的 tree 对比得出文件级 diff（新增/删除/修改 + 逐文件差异），纯 TS 计算，不依赖 git CLI。
- **任务谱系 × 版本谱系互链**：`task.share` 引用 `ws.commit`（"这个任务产生了这些变更"），commit 的 `taskRef` 反向指回——接续开发时"做过什么"（任务记录）与"改了什么"（版本检出）一起对齐。

### 8.3 并行版本语义（第一版明确无 merge）

多成员并行提交 = 谱系分叉（同 parent 的多个孩子全部保留，链不可删）；视图默认按 `(ts, commitId)` 取 LWW head，用户可显式切换 head 择线继续。三向合并（共同祖先 diff3）留 OC4 评审——共享主场景是"接力"而非"同文件并发编辑"，merge 优先级低于加密与 ACL。

### 8.4 为什么不直接共享 .git 裸仓库（否决记录）

耦合 git 内部打包格式（packfile/refs 布局）与宿主 git 版本、无法做记录级锚定/ACL/静态加密、成员身份与链 ID 叙事缺位；自研对象模型约 1k LOC 且全部可穷举单测。git CLI 仅在桌面侧可选用于本地 diff 预览增强（非依赖）。

## 9. 任务谱系与接续开发（L5，R14/R15/R17/R31）

这是特性命名的语义闭环——"工作链"是任务串成的链：

```
A 机：任务甲完成 → task.share(r:8c11)
                                  └─ parentRecordId
B 机：接续开发 → 本地新会话（注入任务上下文卡）→ 任务甲' 完成 → task.share(r:9d44)
                                                                        └─ parentRecordId
C 机：再接续 …
```

- **共享侧**：从 `TaskTrajectory`（`packages/desktop/src/shared/ipc.ts:545`，天然"只含操作轨迹、不含对话内容"）压缩为 trajectory 摘要（工具计数、文件触及、成败统计、关键操作取样 ≤50 条）；结论/遗留事项由用户编辑确认（预览确认满足 R20）；**变更随行为 `ws.commit`**（§8.2：会话变更集直接提交为链工作区版本，taskRef 互链；无随行变更时退化为纯记录共享）。
- **接续侧**：链面板任务流 →「接续开发」→ 若 taskRef 指向 `ws.commit`，先将上游版本**检出物化或生成补丁对齐本地工作区**（预览确认，目标路径须在用户选定目录内），再生成新会话，系统提示注入结构化上下文卡（目标/已完成/触及文件/结论/遗留/上游链 ID + recordId + commitCid）。会话与普通会话同构，不进 core 回路（上下文卡只是 prompt 模板 + IPC 数据）。
- **AI 表面**（R17）：defineAction 注册 `chain.query`（成员/资产/任务/认领查询）与 `chain.claim`（认领/进度/完成）——LLM 在改动前可主动查撞车、发认领。claim 为声明性软锁（R18）。

### 9.1 会话 fork 与文件快照（2026-09-08 修正，R38/R39）

- **fork ≠ 带全量历史**：从历史会话节点 fork 时，新会话**不保留前置历史**——前置上下文以**记忆摘要**注入 fork 后的任务区（复用 compaction 摘要管线，`packages/core/src/session.ts` 的中段摘要机制同源）；项目内容采用**当前节点的覆盖内容**（以该节点 ws.commit 物化）。这与「接续开发」（上下文卡注入）的区别：接续是"接着做"（结构化卡片），fork 是"基于这个时间点重开"（摘要 + 内容覆盖）。
- **会话文件快照 = 项目历史协同的数据基座**：每个会话节点保留其操作文件的快照（`GitFileHistory` checkpoint，`changedFilePaths`/`checkpointHash` 现成可得），随 `task.share` 以 ws.commit 随行上链（R39）。fork/接续时"项目内容取哪个时间点"由快照回答；会话区下方链 id 弹窗中的「文件快照」列表即此数据的 UI 表面（R37）。
- **链上元信息收敛为单一入口**：会话模块不设常驻链表面（对齐本地 UI，R37）；链溯源（来源 fork/上游记录/文件快照/操作者链上 id 时间线）全部收敛进**链 id 弹窗**。

## 10. 模块链语义矩阵（2026-09-08 对照真实 UI 修正，R32–R39）

七个模块与链的关系不是"各模块加一个上链按钮"，而是**一条底座层语义**：共享在会话模块打开工作区时决定（R32），开启后各模块按自身形态自动记账（R33），唯一逐节点控制点在任务树（R16/R32）。

| 模块 | 历史管理 | 链语义（共享开启后） | UI 表面 |
| --- | --- | --- | --- |
| 任务树 | 本地任务谱系（既有） | 整条共享链的混排视图；节点级共享开关（默认开，关 = 对成员仅标题 + 锁定，`share.rule` 记账） | **链状态的唯一家**（2026-09-08：全局链底座条移除）：链 ID/同步态/成员/共享态聚在任务树顶部；右侧信息板**二分**（R34）：链上节点才有链元信息板 + 链上轨迹**图树**（操作者以链上 id 声明）；本地节点无链信息板；**链操作日志**面板在任务树底部（唯一审计聚合面） |
| 会话 | 会话列表即本地形态（**对齐本地 UI，零差异**，R37） | fork 历史会话节点 → **不保留前置历史，记忆摘要注入** + 项目内容取当前节点覆盖（R38）；每会话节点保留操作文件快照（R39） | 无常驻链表面；链上元信息经**会话区下方链 id 点击弹窗**呈现；打开新工作区时的共享决定在此模块；**本地 fork 为既有独立能力**（不产生链记录，R32） |
| 原型设计 | 版本 rail（既有） | 版本随任务终态自动记账（`design.version`），无「发布」按钮 | 版本 rail **单列混排**：链上版本以 ⛓ tag + 成员色区分，**不做本地/链上过滤分裂**（2026-09-08）；模块内无 fork 按钮（fork 铁律，R32） |
| UI 设计 | 同原型设计（共用骨架） | 同原型设计 | 同原型设计 |
| 审查报告 | 报告存档（既有，**核心设计保持不变**） | 报告随基线自动记账；findings 批注回链（note）照旧 | **审查范围控件保持既有形态**（不新增链上选项，2026-09-08）；报告历史**仅存在于左侧审查列表**（链上到达的报告 = 同一列表 + ⛓ tag，不另立表面） |
| 知识库 | **无历史管理**（R35）：追随代码时间线，覆盖即采纳 | wiki/架构图：链上到达即按代码基线覆盖采纳，**对方缺失则保留本地**；AGENTS.md 单文件**始终合并**；符号关系图：fork/代码改动**自动触发 update hook**（仅此资产）；kb.sync 结果自动记账 | 顶部**仅同步状态行**（已同步 + 链信息 + 时间；覆盖/写入时标注）——无语义声明 chips、无模块内 fork 按钮、无「应用链上版本」按钮（R35/R32） |
| 编辑器 | **本地历史管理（新增设计，R36）**：对标 IDEA/VSCode local history，以基线自动保存为前提自动产出历史点，永不出机 | fork/合并链上来源的历史点以**链上 id 声明来源**；链上条目恢复前逐块 CID 校验 | **底部基线式**（R36）：底部既有检查点/基线行 = 历史入口，展开即列表展示**当前文件的全部历史快照**（单列混排 + tag 区分链上来源，随选中文件切换）；右栏结对栏保持原样；无「快照上链」按钮 |

配套语义：

- **链上/本地以 tag 区分，不做分区分裂**（2026-09-08）：凡本地与链上内容同列的场景（版本 rail、历史区、报告列表），一律单列混排 + ⛓ tag（成员色）区分，**不提供本地/链上过滤 chips、不另立链内容分区**——分裂式交互徒增操作成本。
- **fork 铁律（R32）**：fork 只在任务树发起；各模块（知识库/原型/UI/编辑器）一律不设 fork 按钮；会话模块的本地 fork 是既有独立能力，纯本地、不产生链记录，与链 fork 并存但互不改写。
- **链操作日志是唯一审计聚合面**：一切自动记账（fork / task.share / design.version / editor.snapshot / kb.sync / share.rule / 创世）在任务树底部的日志面板全量可审计（R20/R33）——记录不打断操作，审计不必逐模块找。
- **链上轨迹图树（R34）**：对已开共享的链上节点，右侧信息板以图树展示其链上谱系（parentRecordId 链），每节点标注"谁（链上 id）+ 做了什么（记录类型）+ 何时"；未开共享的链上节点对成员仅呈现标题 + 锁定（无信息板、无轨迹）。
- **与旧模型的差异**：v5 的「逐次显式共享 + 自动共享子开关（默认关）」废除——替换为"工作区开关决定边界 + 节点开关收回例外"；预览确认仅保留给本地物化（接续检出/历史检出，R20 修订）。

## 11. 链上行为深化（2026-09-08 · 交互定稿后协议设计）

交互面（§10 矩阵）已定稿，本章把每个模块的链行为翻译成**精确协议**：记录何时产生、字段形态、幂等键、接收方如何物化。约定：所有链行为**自动记账**（R33）、无逐动作确认；`ts` 均为作者设备单调时钟（成员间不比较绝对值，只用于同域 LWW）。

### 11.1 记录生命周期总表

| 记录 | 触发点（发送方） | 幂等键 | 接收方物化 |
| --- | --- | --- | --- |
| `task.share` | 会话任务终态（完成/中断归档）且节点共享=开 | `(nodeId, terminalTs)` | 任务树出现 ⛓ 节点（带轨迹摘要/结论/遗留）+ 拉取随行 ws.commit（按需） |
| `task.stub` | 会话任务终态且节点共享=关 | `(nodeId, terminalTs)` | 任务树出现 ⛓ 标题占位节点（仅标题 + 🔒 锁定，无详情/无接续/无批注） |
| `ws.commit` | 任务终态随行变更 / 检出对齐 / 编辑器物化恢复 | `commitCid`（内容寻址天然幂等） | 对象库落块 → 版本谱系/编辑器投影（§11.4）按需展开 |
| `design.version` | 原型/UI 版本随任务终态定格 | `(domain, versionId)` | 版本 rail 出现 ⛓ 条目（tag + 成员色）；拉取为显式动作 |
| `kb.sync` | KB 覆盖/保留/合并终态（§11.5 规则计算完成） | `(baseline, kind)` | 触发本地 KB 同步评估（§11.5） |
| `share.rule` | 任务树节点级开关变更 | `(nodeId, seq)`（节点内单调） | 视图按最新 share.rule 渲染完整态/标题态（LWW） |
| `branch.fork` | 任务树「声明 fork」确认（checkout 即上链） | `branch` 名全局唯一 | 谱系分叉边 + 对方任务树出现 ⑂ 上链标记 |
| `ws.commit(parents=[head, picked])` | fork 线汇入（cherry-pick 拣选，非三向合并） | `commitCid` | 双亲谱系边（"合入"可审计，内容拣选由拣选者负责） |
| `note` / `task.claim`* | 报告批注 / 认领（显式但无需确认弹层） | `recordId` | 报告/任务树标注出现 |

*`task.claim` 系列为 AI 表面（R17）保留的显式动作，不属自动记账。

**发送管线统一形态**：本地事件 →（若该域节点共享=开）构造记录 → Ed25519 签名 → gossip（成员即时可见未封存态）→ 轮值出块联签终局（§6）。记账失败（离线/联签不足）**不阻塞本地操作**，记录进本地待发队列，重连后续传。

### 11.2 节点级共享开关协议（share.rule / task.stub）

任务树是唯一控制点（R32），协议上拆成「占位」与「切换」两个正交动作：

- **占位（stub）**：节点在共享工作区内**恒有链上存在**——共享=开产生完整 `task.share`；共享=关产生 `task.stub`（≤1KB：nodeId/title/ts/author）。这保证成员侧"未共享节点仍能看到标题 + 锁定"是**链数据**而非带外信息；stub 不含任何轨迹/文件/结论字段。
- **切换（share.rule）**：开关每次变更产生一条 `share.rule{nodeId, shared, seq}`，seq 为节点内单调序号；接收方取 **seq 最大者**为现行态（同 seq 冲突按 (ts, recordId) LWW，全部保留可审计）。
- **视图遮蔽**：现行态=关时，接收方任务树/链浏览器将该节点的历史 `task.share` 内容降为标题渲染（记录本身仍在链上——**链不可删**），且 have/want 层**拒供**该节点内容 blob 的后续请求（增量止血）。
- **边界（必须向用户明示）**：关闭共享**不回收**已散播的历史内容——签名记录与已传 blob 无法从他人账本抹除；隐私边界 = 关闭之后的增量。此语义与 `asset.revoke`（视图过滤，链保留）一致，设置页文案与 R16 对照。

### 11.3 会话文件快照与 fork 物化协议（R38/R39）

- **快照定义**：会话节点 N 的文件快照 = 该节点存续期间最后一次 `GitFileHistory` checkpoint（manifest：`files: Record<path, {blob, mode}>` + checkpointHash）——只含**本节点操作触及的文件**，非全树。链上节点随 `task.share.commitRef` 指向的 ws.commit 携带同集内容（本地=checkpoint blob，链上=ws.commit blob，两者 manifest 同构）。
- **fork 物化（记忆摘要注入）**：本地 fork 时——目标节点为本地节点 → checkpoint 直接物化（预览确认）；为链上节点 → 经 commitRef 物化该 tree 的触及文件子集（逐块 CID 校验 + 预览确认）。物化本身产生一个**新本地历史点**（R36）。记忆摘要由 compaction 摘要管线对节点轨迹产出，以 prompt 模板卡注入新任务区（不进 core 回路，与接续开发的上下文卡同构）。
- **弹窗数据源**：会话链 id 弹窗的「文件快照」列表 = checkpoint/commitRef manifest 的路径键集展开；「操作者链上 id 时间线」= §11.6 轨迹构建的会话域子集。

### 11.4 编辑器链上条目 = ws.commit 文件级投影（R36 落地形态）

- **无独立记录类型**：编辑器历史区底部的 ⛓ 条目不是 `editor.snapshot`（已废止），而是**相关 ws.commit 在当前文件上的投影**——对每个本机持有对象的链上 commit c，若 c.tree 中当前文件的 blob ≠ 该文件本地当前内容，则在历史列表产生一条 ⛓ 条目（hash=commitCid 前 6 位、来源声明=c + taskRef 记录 + 链 id）。同一 commit 在多个文件上投影出多条目，底层数据只有一份（内容寻址去重）。
- **条目产生的本地条件**：仅当该 commit 的对象已被拉取（检出/接续对齐时随行到达）或按需懒拉（点开历史列表时 want 该文件 blob，4MB 分块校验）。
- **恢复语义**：↺ 恢复 ⛓ 条目 = 物化该 commit 中该文件 blob（CID 校验 + 预览确认）→ 写入编辑器 → 产生新本地历史点（此后的 undo 走本地线）。● 本地点恢复 = 纯本地 undo，永不触链。

### 11.5 KB 同步协议精确化（R35 落地规则）

- **时间线参考系**：知识资产不携带独立版本号，一切比较以**链工作区 commit 谱系**为时间线（ws.commit 的 (ts, commitCid) 全序；本地无链上对齐时以本地 head checkpoint 为等价锚）。
- **覆盖采纳判定**：链上 kb 资产到达时比较 baseline——`baseline ≥ 本机知识锚`（即来源基线不早于本机）→ **覆盖采纳**（重写本地该资产文件，kb.sync 记账 adopted）；`baseline < 本机知识锚` → **仅记账不采纳**（keptLocal——旧基线不覆盖新基线，这正是"是否覆盖取决于代码库时间线"的机械判定）。对方缺失的资产类别（wiki/架构图）→ 本地保留，不产生任何动作。
- **AGENTS.md 始终合并**：单文件合并的最小单元 = `<!-- X:START -->…<!-- X:END -->` 标记块（仓库现存的 OPENWIKI 块即此形态）。链上块按 (ts, recordId) 排序幂等追加（重复内容哈希跳过）；无标记的自由文本段**永不合并**（保留本机版本，kb.sync 记账冲突段清单）。链不可删 → 已合并块不因来源撤回而消失。
- **符号关系图 update hook（仅此资产自动重建）**：触发事件 = (a) `branch.fork` 记录到达或本地 fork 执行；(b) 检出/覆盖采纳导致工作区内容变化；(c) 本地文件保存（debounce 30s）。hook = 增量重建符号索引（复用 CodeGraph 管线），不产生独立链记录（kb.sync 的 symbolHook 字段携带最近一次 hook 结果）。
- **无历史管理的含义**：KB 本地不留版本链、不提供回滚 UI；"历史"仅存在于 kb.sync 记录的审计流（链浏览器可查谁在何时覆盖了什么）。

### 11.6 链上轨迹图树构建（R34 落地）

对选中链上节点 N，右侧信息板图树 = **沿互链字段反向遍历再正向渲染**：

```
队列 = [N]; 轨迹 = []
while 队列非空:
  r = 出队
  轨迹.append({rec: r.id, 类型: r.type, 操作者: r.author(did), ts: r.ts})
  入队(r.parentRecordId)            # 任务谱系（task.share ← task.share）
  入队(r.commitRef 的 taskRef)      # 版本谱系互链（ws.commit ↔ task.share）
  入队(r.refRecordId)               # 批注锚（note → 任意记录）
按 ts 排序去重渲染；深度上限 32（防环/防爆）
```

每个节点渲染"谁（`did:` 链上 id + 成员色）+ 做了什么（记录类型 + 一句话）+ 何时"；**本地节点不进入图树**（无链数据）；标题占位节点仅渲染标题行（§11.2）。

### 11.7 时序与一致性总则

- **可见性**：gossip 到达即"未封存可见"（任务树/版本 rail 即时出现 ⛓ 条目），联签终局仅改变审计状态标记——UI 不区分两态，链浏览器区分。
- **同域并发**：`share.rule` 按 seq；其余元数据域（title/note 等）按 (ts, recordId) LWW；内容域（blob/tree）按内容寻址天然无冲突。
- **离线**：待发记录队列持久化于 `.deeporca/coordchain/<chainId>/outbox.jsonl`（进程重启不丢）；重连后按序补发，recordId 幂等去重兜底。
- **覆盖率即一致性**：不追求全局即时一致——每个成员的视图 = 其已见记录的函数；谱系遍历（§11.6）遇缺失 parent 时显示"⏳ 等待同步"占位（want 该记录，不阻塞其余渲染）。

## 12. 桌面集成

### IPC 契约（`shared/ipc.ts` 新增，`chain:*` 前缀）

请求：`chain:getState`（开关/链列表/本机成员态）、`chain:create`、`chain:join`（自动/邀请码）、`chain:leave`、`chain:members`、`chain:blocks`（浏览器分页）、`chain:records`（按任务/资产聚合）、`chain:publishAsset`、`chain:listAssets`、`chain:fetchAsset`（拉取到本地）、`chain:setNodeShare`（任务树节点级共享开关 → `share.rule`/`task.stub`，2026-09-08 替代旧 `chain:shareTaskRecord`——任务记录已改自动记账）、`chain:listTasks`、`chain:resumeFromTask`、`chain:claimTask`、`chain:trajectory`（§11.6 轨迹图树构建）、`chain:selfCheck`（网络自检）、**链工作区族**：`chain:wsCommit`（选定文件或会话变更集提交）、`chain:wsLog`（谱系分页）、`chain:wsDiff`（两 commit 文件级 diff）、`chain:wsCheckout`（历史版本检出，预览确认）、**编辑器投影族**：`chain:edHistory`（当前文件的 ws.commit 投影列表，§11.4）、`chain:edRestore`（恢复链上条目：CID 校验 + 预览确认）。
事件：`chain:stateChanged`、`chain:syncProgress`、`chain:recordAppended`、`chain:assetAvailable`。

### 设置与存储

- **双层开关**（只认工作区主题的落地形态）：
  - 用户级 settings：`coordination: { enabled: false, deviceName: "", autoShareTaskRecords: false, storageQuotaMB: 2048 }`——总闸与设备身份/配额，默认关。
  - 项目级 settings（`.deeporca/settings.json`）：`coordination: { shared: false, themeOverride: "" }`——**每工作区独立开启**；开启即以该工作区主题（§4.1 解析，可覆盖）入链/建链。用户级总闸关闭时项目级无效。
- **数据落点 = 项目数据根（2026-09-08 修正，R40）**：`.deeporca/` 是工作区的统一数据根（类比 `.git`），本项目全部历史数据与模块行为都在此——既有 stores：`settings.json`（gitignored）、`skills/`、`AGENTS.md`、`sessions/`（会话）、`reviews/`（审查报告）、`deepwiki/`（知识库）、`designs/`（设计稿）、`jobs/`（索引构建）、`prototypes/`（原型产物）、`task-trees/<id>/worktrees/`（任务树工作区沙盒）；coord-chain 加入为 `.deeporca/coordchain/<chainId>/`（ledger/blobs/view/objects，按主题链分目录），与 settings 分离避免膨胀与误同步。**`coordchain/` 整体 gitignore**：链数据走链同步、从创世重放可重建，绝不随代码仓库远端分发；设备密钥例外存用户级 `~/.deeporca/coordchain/device-key.json`。
- **UI 隐喻 = 共享文档空间（2026-09-08 修订）**：链不是第八个模块，而是织入七个模块的底座层——恒定主题条（主题/链 ID/成员/同步态 + 可开合的**链操作日志**，R33 审计聚合面）+「共享开 · 本工作区」状态 pill（开关本体在会话模块**打开工作区**的流程里，R32）。各模块表面见 §10 矩阵：会话与本地零差异 + 链 id 弹窗（R37）；任务树右侧信息板本地/链上二分 + 节点级共享开关（R34/R16）；原型/UI 版本 rail 自动记账（无发布按钮）；知识库追随代码（无应用按钮）；编辑器本地历史 ∪ 链上来源（无快照上链按钮）；审查保持既有核心设计。全量走现有 ui 原语与双主题；i18n 六套字典（R23）。

## 13. 安全与隐私（R19/R20/R21）

| 威胁 | 对策 |
| --- | --- |
| 被动窃听（局域网抓包） | 链路 X25519+HKDF+AES-256-GCM 全帧加密，握手即协商，M1 强制 |
| 伪造身份/中间人 | Ed25519 双向挑战；成员公钥锚定在链内 `member.join` 记录（重放可验） |
| 篡改账本/资产 | 哈希链 + 记录签名 + 联签 quorum + 从创世重放（R5/R9）；blob 逐块哈希校验（R12） |
| 重放/双花记录 | recordId 幂等去重（R9）；ts 单调窗口 |
| 恶意成员读取敏感资产 | 本期 ACL=链内全员（明示）；blob 静态加密 + 细粒度 ACL 为 OC4 |
| 恶意 commit 物化写盘 | 检出目标必须在用户选定目录内（预览确认）；路径穿越拒绝；物化前逐对象 CID 校验 |
| 密钥泄露 | 设备密钥仅存本机 0600；member.leave/expel 撤销准入；历史不可抵赖保留 |
| 误共享（隐私事故） | 默认关；工作区级开关（打开工作区时决定）+ 任务树节点级 opt-out（关 = 仅标题 + 锁定，R16/R32）；轨迹不含对话原文；链浏览器全透明；预览确认保留给本地物化动作 |

工程红线：功能关闭时零行为变化（R21）；共享开启后链上操作自动记账但边界始终由两级开关控制（R32）；本地物化动作（接续检出/历史检出）保留预览确认 + 目录白名单。

## 14. 体积与性能预算

- 记录 ≤8KB、区块 ≤256 条 → 日均千条记录 ≈ 数 MB 账本；SQLite 视图查询 <10ms（面板分页）。
- **链工作区**：tree/commit 对象为 KB 级 JSON，主要成本仍在 blob；内容寻址天然跨 commit 去重（未变文件不重复存储/传输）；两 commit diff 为两 tree 键集对比，毫秒级。
- blob 层吞吐受磁盘约束；4MB 分块 + 逐块校验在百兆局域网约 10MB/s 级，满足设计稿分发场景。
- 内存：mesh ≤50 节点全互联 + gossip 扇出 4–8，稳态连接数 ≤50，心跳 15s。

## 15. 开放问题

1. **企业网组播禁用率**未知——邀请码兜底已设计，OC2 期需真实办公网验证 mDNS 成功率（Windows 防火墙/虚拟网卡是已知坑）。
2. **主题选择的边角**：fork 场景（origin 各异但 upstream 相同）默认不同链——是否符合团队预期待 dogfood 验证；解法候选：面板允许把主题源切到 upstream。monorepo 多项目共用一个 remote 时全部同链（目录级细分留观察）。
3. **非 git 工作区引导**：目录名不参与跨机匹配后，首次开启共享的引导必须把"设定主题名"做成必填步骤（否则用户以为开了共享但永远匹配不到人）——UX 细节 OC3 评审。
4. **链工作区的共享范围过滤**：整个工作区直接上链通常过重，需要忽略清单机制（类 `.gitignore`，如 `.chainignore` + 默认忽略二进制构建产物/密钥文件）——OC3 评审默认清单内容。
5. **三向合并的时机**：第一版无 merge（分叉保留 + 择线），若 dogfood 中"接力冲突"高频出现再上 diff3（OC4 评审）。
6. **与主线 C（远程访问）的地基共享**：`ws` 依赖与 Ed25519 设备身份两边同源，谁先落地谁抽取公共件（TunnelClient 的密钥管理 vs 本设计的握手）；协调设计评审一次即可，无需预先合并。
7. **账本修剪**：全节点保留全账本在小团队成立；跨年使用后需要快照 + 截断（OC4，参数化 checkpoint 高度）。
8. **blob 静态加密的密钥分发**：倾向"工作组口令 → HKDF"（零依赖、UX 直观），成员级 wrap（X25519 sealed box）留 OC4 评审。
9. **Hypercore/Hyperdrive 后备**：若 OC2 自研 have/want 分发不顺，评估以 Hypercore 承载 blob 层（协议面不变，仅替换 blobs.ts 内部实现）；链工作区的版本化文件系统语义与 Hyperdrive 同构，届时一并评估。
10. **知识库"覆盖即采纳"的冲突粒度**（2026-09-08 新增，R35）：追随代码时间线在双方基线不相交时无歧义；同一 wiki 页在两侧基于不同基线各自修改时，"覆盖后以覆盖版为准"会丢一侧编辑——是否需要页级 LWW + 被覆盖内容进链上可溯（`kb.sync` 记 adopted/keptLocal 已留字段），OC3 dogfood 验证。
11. **节点级共享开关的默认面**（2026-09-08 新增，R16/R32）：默认全开 + 逐节点关，与"默认全关 + 逐节点开"相比把注意力成本转给了"想收回隐私的那一次"；且 §11.2 已明确"关闭不回收已散播历史"——若 dogfood 中误共享反馈高频，评估关键文件（如 `.env` 类）在 `share.rule` 之上的强制忽略清单（与开放问题 4 的 `.chainignore` 合流）。
