# AI 协调工作链（Coord Chain）— 设计文档

> 日期：2026-08-27 · 状态：调研定稿（未实现）· 归属：**王牌路线 OC**（优先级高于 next-version，见 `docs/features/coord-chain-plan.md`）
> 配套：[requirements.md](./requirements.md)（R1–R23）· [tasks.md](./tasks.md)（OC1–OC4）· 调研 [2026-08-27-coord-chain-technology-survey.md](../../docs/research/2026-08-27-coord-chain-technology-survey.md)

## 1. 定位与总原则

DeepOrca 的跨设备协作层：**局域网联盟式许可链 + 内容寻址资产层 + 任务谱系协调语义**。

产品隐喻：**「共享文档空间」的放大版**——像腾讯文档/飞书共享文档那样"打开就有、成员可见、随手共享"，但共享的不是单篇文档，而是**整个项目的工作记录**（需求文档/设计稿/架构图 + 任务记录 + 会话轨迹），且接收方是 AI 可直接消费的（接续开发）。与共享文档产品的本质差异：无平台依赖（数据不出局域网）、防篡改可审计（链）、记录含 AI 可执行上下文（任务谱系）。

- **只认工作区主题**（2026-08-27 需求确立）：共享的判定单位是**工作区主题**，不是人工建链起名。同一局域网内，工作区主题相同的工作区自动同链、共享一切链上内容；主题不同则**在发现层即隔离**（互相不可见，连握手都不发生）。链的命名空间 = 主题命名空间。
- **链工作区 = 自研类 Git 版本层**（2026-08-27 需求确立）：共享层不是"一次性传文件"，而是版本化工作区——blob/tree/commit 对象模型跑在内容寻址资产层上，commit 锚定进区块。**仓库已有三处底子**：`GitFileHistory`（`packages/core/src/common/file-history.ts:29`）已自研 manifest→tree→commit 管线；CID/blob 分块层即对象存储等价物；账本哈希链即谱系锚定。第一版**无 merge**（并行提交=谱系分叉保留），见 §8。
- **无云**：不依赖任何云端账号/服务器；数据不出局域网（relay 期前）。
- **真链但非炒币链**：哈希链式追加账本、Ed25519 成员签名、轮值提议人 + 联签终局、从创世可重放校验。无 PoW/PoS/代币——威胁模型是"事后可审计"而非匿名对手方 BFT。
- **链上只有元数据**：区块记录 ≤8KB；文件本体走内容寻址 blob 层。
- **默认关、显式共享**：任何字节离开本机前必须经过用户的显式动作（或用户亲自打开的显式子开关）。
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

- **设备密钥**：首次开启时生成 Ed25519 keypair，存 `~/.deeporca/coordchain/device-key.json`（0600，DER base64）。`keyId = "did" + SHA-256(pubkey)[:16]`；UI 显示指纹分组（`did:abcd 1234 efgh …`）。设备名默认主机名、可改。
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

设备上 N 个开启共享的工作区（N 个主题）= 同时持有 N 条链，各自独立的账本/blob/视图目录（`~/.deeporca/coordchain/<chainId>/`）与联签成员表。同一设备身份（同一 Ed25519 keyId）在各链中独立计为成员。

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
| `task.claim` / `task.progress` / `task.done` | taskId(=task.share 的 recordId), note, percent? | 认领/进度/完成 |
| `session.offer` | taskId, summary, commitRef? | 共享会话摘要供接续（不含对话原文） |
| `note` | text(≤2KB), refRecordId? | 自由批注 |

元数据冲突（如同任务并行 `task.done`）不试图强一致：视图按 `(ts, recordId)` 排序取 LWW，全部记录保留可审计。

## 6. 区块、封存与分叉（R8/R9）

- **出块**：本地待封记录先进 gossip（成员即时可见"未封存"），轮值提议人按 `slot = height % 成员数` 取Slot，每 2s（或满 256 条）打包 `block = { height, prevBlockHash, ts, proposer, merkleRoot, records[] }` 并广播征求批准。
- **终局**：收到 ≥ quorum（默认多数派 `floor(n/2)+1`；可选 2/3 或全员）成员对区块哈希的 Ed25519 批准签名后终局，物化视图随之推进。
- **超时顺延**：slot 持有者 4s 未出块，`slot+1` 接替（view-change-lite）。
- **分叉裁定**：同高度竞争块按"批准数多者胜 → 平票取 proposer 序号小者"；落败侧的记录按 recordId 幂等回流胜者后续区块（不丢已签名记录）。
- **重放校验**（加入链时，R5）：从高度 0 逐块验 `prevBlockHash` 链、每记录签名、每区块 quorum 签名，任一不符即拒绝并报首个不一致位置。

账本落盘：`~/.deeporca/coordchain/<chainId>/ledger/blocks/<height>-<hash>.json`；副本 `node:sqlite` 视图 `~/.deeporca/coordchain/<chainId>/view.db`（members/records/assets/tasks/blocks 表）。**视图可删除重建，账本为唯一事实源**（R10）。

## 7. 发现、传输与同步（L1/L2，R4/R19）

- **mDNS/DNS-SD**：服务 `_deeporca-chain._tcp.local.`，TXT：`wt=<themeId前8>` `cid=<链ID前8>` `v=1` `port=<同步端口>`（随机监听端口，防火墙首启授权为已知体验成本，自检命令内置面板）。`multicast-dns` 纯 JS 实现。**发现即按 themeId 匹配**：只与本机已开启共享的工作区主题相同的实例握手；主题不同 = 不同项目 = 发现层直接忽略（不连接、不可见、不出现在成员列表）——跨主题隔离不依赖 UI 过滤。
- **邀请码兜底**：`deeporca-chain://<host>:<port>/<themeId>[?sig=<创世成员签名>]`——组播被禁的企业网可用；`admission: invite` 时 sig 必填。邀请码携带 themeId 而非自造链名，收方核对本工作区主题一致才接受。
- **握手**（首帧协议版本协商 → 双向 Ed25519 挑战签名 → X25519 ECDH + HKDF 派生会话密钥 → 后续帧全 AES-256-GCM）。明文帧直接断连。重复连接按 keyId 去重。
- **同步**：
  - 新成员：`getChain` → 全量区块流 → 重放校验（R5）。
  - 稳态 gossip：签名记录即时扩散；区块/批准签名扩散；高度差探测触发增量补拉。
  - 断线重连：按 (height, blockHash) 对齐后续传。
- **blob 传输（R12/R13）：** 分块 4MB → `chunkCid = "b:" + SHA-256(chunk)[:24]`；have/want 位图请求 → 任意持有者供块 → 逐块哈希校验后写入对象库 `~/.deeporca/coordchain/<chainId>/objects/`（配额默认 2GB，LRU；清理不影响账本）。**大文件永不进区块**。blob之上的版本化语义（tree/commit/谱系/diff）见 §8 链工作区。

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

## 10. 桌面集成

### IPC 契约（`shared/ipc.ts` 新增，`chain:*` 前缀）

请求：`chain:getState`（开关/链列表/本机成员态）、`chain:create`、`chain:join`（自动/邀请码）、`chain:leave`、`chain:members`、`chain:blocks`（浏览器分页）、`chain:records`（按任务/资产聚合）、`chain:publishAsset`、`chain:listAssets`、`chain:fetchAsset`（拉取到本地）、`chain:shareTaskRecord`、`chain:listTasks`、`chain:resumeFromTask`、`chain:claimTask`、`chain:selfCheck`（网络自检）、**链工作区族**：`chain:wsCommit`（选定文件或会话变更集提交）、`chain:wsLog`（谱系分页）、`chain:wsDiff`（两 commit 文件级 diff）、`chain:wsCheckout`（历史版本检出，预览确认）。
事件：`chain:stateChanged`、`chain:syncProgress`、`chain:recordAppended`、`chain:assetAvailable`。

### 设置与存储

- **双层开关**（只认工作区主题的落地形态）：
  - 用户级 settings：`coordination: { enabled: false, deviceName: "", autoShareTaskRecords: false, storageQuotaMB: 2048 }`——总闸与设备身份/配额，默认关。
  - 项目级 settings（`.deeporca/settings.json`）：`coordination: { shared: false, themeOverride: "" }`——**每工作区独立开启**；开启即以该工作区主题（§4.1 解析，可覆盖）入链/建链。用户级总闸关闭时项目级无效。
- 链数据独立于 settings 存 `~/.deeporca/coordchain/<chainId>/`（密钥/账本/blob/视图，按主题链分目录），避免 settings 膨胀与误同步。
- **UI 隐喻 = 共享文档空间**（对齐腾讯文档/飞书心智，但内容是项目记录）：Hub（小球枢纽）新增「共享空间」二级浮层，顶部明示**本工作区主题**（来源与值）+ 链 ID + 成员头像列表；主体分三栏视图——**资料**（需求文档/设计稿/架构图，文档列表式浏览、预览、下载到本地）、**任务记录流**（共享的任务记录与谱系，「接续开发」入口）、**动态**（成员 publish/claim/progress 时间线）；「审计」子页承载链浏览器（区块/记录/签名/联签）与网络自检——链是机制，共享空间是体验。会话与任务树节点动作「上链共享」；共享确认弹层明示"将共享到主题 X 的链（N 名成员）"。全量走现有 ui 原语与双主题；i18n 六套字典（R23）。

## 11. 安全与隐私（R19/R20/R21）

| 威胁 | 对策 |
| --- | --- |
| 被动窃听（局域网抓包） | 链路 X25519+HKDF+AES-256-GCM 全帧加密，握手即协商，M1 强制 |
| 伪造身份/中间人 | Ed25519 双向挑战；成员公钥锚定在链内 `member.join` 记录（重放可验） |
| 篡改账本/资产 | 哈希链 + 记录签名 + 联签 quorum + 从创世重放（R5/R9）；blob 逐块哈希校验（R12） |
| 重放/双花记录 | recordId 幂等去重（R9）；ts 单调窗口 |
| 恶意成员读取敏感资产 | 本期 ACL=链内全员（明示）；blob 静态加密 + 细粒度 ACL 为 OC4 |
| 恶意 commit 物化写盘 | 检出目标必须在用户选定目录内（预览确认）；路径穿越拒绝；物化前逐对象 CID 校验 |
| 密钥泄露 | 设备密钥仅存本机 0600；member.leave/expel 撤销准入；历史不可抵赖保留 |
| 误共享（隐私事故） | 默认关；逐次显式共享 + 共享前预览确认；轨迹不含对话原文；链浏览器全透明 |

工程红线：功能关闭时零行为变化（R21）；不做"静默上传"任何形式的默认路径；共享确认弹层明示目标链 ID 与成员数。

## 12. 体积与性能预算

- 记录 ≤8KB、区块 ≤256 条 → 日均千条记录 ≈ 数 MB 账本；SQLite 视图查询 <10ms（面板分页）。
- **链工作区**：tree/commit 对象为 KB 级 JSON，主要成本仍在 blob；内容寻址天然跨 commit 去重（未变文件不重复存储/传输）；两 commit diff 为两 tree 键集对比，毫秒级。
- blob 层吞吐受磁盘约束；4MB 分块 + 逐块校验在百兆局域网约 10MB/s 级，满足设计稿分发场景。
- 内存：mesh ≤50 节点全互联 + gossip 扇出 4–8，稳态连接数 ≤50，心跳 15s。

## 13. 开放问题

1. **企业网组播禁用率**未知——邀请码兜底已设计，OC2 期需真实办公网验证 mDNS 成功率（Windows 防火墙/虚拟网卡是已知坑）。
2. **主题选择的边角**：fork 场景（origin 各异但 upstream 相同）默认不同链——是否符合团队预期待 dogfood 验证；解法候选：面板允许把主题源切到 upstream。monorepo 多项目共用一个 remote 时全部同链（目录级细分留观察）。
3. **非 git 工作区引导**：目录名不参与跨机匹配后，首次开启共享的引导必须把"设定主题名"做成必填步骤（否则用户以为开了共享但永远匹配不到人）——UX 细节 OC3 评审。
4. **链工作区的共享范围过滤**：整个工作区直接上链通常过重，需要忽略清单机制（类 `.gitignore`，如 `.chainignore` + 默认忽略二进制构建产物/密钥文件）——OC3 评审默认清单内容。
5. **三向合并的时机**：第一版无 merge（分叉保留 + 择线），若 dogfood 中"接力冲突"高频出现再上 diff3（OC4 评审）。
6. **与主线 C（远程访问）的地基共享**：`ws` 依赖与 Ed25519 设备身份两边同源，谁先落地谁抽取公共件（TunnelClient 的密钥管理 vs 本设计的握手）；协调设计评审一次即可，无需预先合并。
7. **账本修剪**：全节点保留全账本在小团队成立；跨年使用后需要快照 + 截断（OC4，参数化 checkpoint 高度）。
8. **blob 静态加密的密钥分发**：倾向"工作组口令 → HKDF"（零依赖、UX 直观），成员级 wrap（X25519 sealed box）留 OC4 评审。
9. **Hypercore/Hyperdrive 后备**：若 OC2 自研 have/want 分发不顺，评估以 Hypercore 承载 blob 层（协议面不变，仅替换 blobs.ts 内部实现）；链工作区的版本化文件系统语义与 Hyperdrive 同构，届时一并评估。
