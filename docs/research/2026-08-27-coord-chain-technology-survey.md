# AI 协调工作链（Coord Chain）技术调研与选型

> 日期：2026-08-27 · 状态：调研定稿（未实现）· 归属：**王牌路线 OC**（[`docs/features/coord-chain-plan.md`](../features/coord-chain-plan.md)，优先级高于 next-version）· spec：[`specs/coord-chain/`](../../specs/coord-chain/design.md)

## 1. 需求解读与三个关键判定

原始诉求：内置一套区块链；局域网内所有开启该配置的 DeepOrca 实例自动上链并生成链 ID；需求文档/文件/设计稿/架构图等资料可共享；任务记录也可共享，方便他人**基于任务记录接续开发**。

调研后确立三个判定，后续全部选型围绕它们展开：

1. **"区块链"取其本质而非其炒作形态**：本需求真正需要的是哈希链式追加账本带来的**防篡改、可审计、成员签名背书、统一链身份（链 ID）**。无代币、无挖矿、无匿名对手方——成员是局域网内的同事设备。因此选型为**联盟式许可链**（permissioned consortium chain）：区块由轮值提议人打包、成员联签终局，而非 PoW/PoS。能耗为零、终局为秒级，且"链 ID / 区块 / 联签 / 从创世重放校验"的产品叙事完整保留。
2. **链上只放元数据，资产走内容寻址层**：设计稿动辄几十 MB，永远不应整块进区块。区块记录（record）只存清单哈希（CID）+ 元数据 + 签名（单条 ≤8KB 硬顶）；文件本体按 4MB 分块后内容寻址存储，peer 间 have/want 协议按需拉取（BitTorrent/CFB 思路）。这与 IPFS"账本 + blob 分层"同构，但零 IPFS 依赖。
3. **差异化核心是协调语义，不是链本身**：链是地基；卖点在**任务谱系**（task.share → 他人接续 → 再 share，parentRecordId 串成链）与 **AI 可消费的接续上下文**（复用现有 `TaskTrajectory`——它"刻意只含操作轨迹、不含对话内容"，`packages/desktop/src/shared/ipc.ts:545`，天然适合跨设备共享）。竞品（Claude Code / Cursor / Copilot Workspace 等）的多人协作全部依赖云端账号 + Git 仓库；"无云、局域网、链上可审计、任务记录可接续"是空白区。

## 2. Prior Art 扫描

| 方案 | 是什么 | 对我们的价值 | 结论 |
| --- | --- | --- | --- |
| **Keybase sigchain** | 个人签名哈希链（身份/声明），本地验证重放 | 思想原型：签名记录 + 从创世全量重放校验 + 链式防篡改 | 借鉴思想，净室自研（其服务已随 Keybase 停滞） |
| **Secure Scuttlebutt（SSB / Manyverse）** | 多 feed 追加日志 + gossip + 局域网友好 P2P | 证明"纯局域网追加式社交数据"工程可行；gossip 同步节奏参考 | 借鉴 gossip；不引入（多 feed 无统一链 ID，终局语义弱） |
| **Hypercore 10（Holepunch/Pear）** | 活跃维护的单写者签名追加日志 + 成熟复制协议 + 稀疏同步 | blob/日志复制的最强现成件；"personal blockchain"叙事同源 | **观察项**：MVP 不用（单写者 → 多 feed 合并复杂度高于自研联盟链；引入其运行时耦合）；若 OC2 blob 分发自研不顺，回头评估 |
| **GUN.js / OrbitDB / ipfs-lite** | 去中心化图数据库 / IPFS 上的 CRDT 库 / 嵌入式 IPFS | — | 否决：Electron 打包负担重、依赖树不稳、维护状态存疑 |
| **Tendermint/Raft 系共识库** | BFT/CFT 共识 | 共识参数（超时/轮转/投票）设计参考 | 否决引入：JS 生态无可嵌入实现；LAN 团队规模用轻量轮转 + 联签足够 |
| **Automerge / Yjs / Loro** | CRDT 协同编辑库 | 若未来加"多人共编需求文档"再引入（[对比](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026)：Yjs 轻、Automerge 全历史重载慢） | **MVP 不需要**：本需求是追加式记录共享，无字符级共编；账本天然 append-only，元数据冲突用 LWW + 版本链 |
| **libp2p（`@libp2p/mdns`）** | 模块化 P2P 栈，含跨平台 mDNS 发现 | 发现层可选项 | 否决全家桶（为用一个发现模块引入整个栈）；[Windows 上 mDNS 的已知坑](https://discuss.ipfs.tech/t/is-mdns-discovery-not-working/3984)（防火墙拦 UDP 5353、虚拟网卡错绑）对任何实现都成立，须写进 UX 文档 |
| **Dat / BitTorrent / CFB（CRDT 文件协议）** | 内容寻址分块分发 | blob 层 have/want + 分块校验的直接来源 | 借鉴协议形态，自研 ~几百行 |
| **Git / NAS 共享盘** | 现成的文件协作方式 | 明确差异化边界（见 §4） | 互补而非竞品：record 可引用 commit hash |

## 3. 关键技术域选型

### 3.1 密码学原语 — Node 22 原生全覆盖，零新增依赖

| 原语 | 用途 | Node 22 `node:crypto` 支持 |
| --- | --- | --- |
| Ed25519 | 设备身份签名（记录签名、区块联签、握手挑战） | ✅ `generateKeyPairSync('ed25519')` / `sign` / `verify` |
| X25519 | 握手 ECDH → 会话密钥（链路加密） | ✅ `'x25519'` + `diffieHellman` |
| HKDF-SHA256 | 会话密钥派生 | ✅ `hkdfSync` |
| AES-256-GCM | 链路帧加密、blob 静态加密 | ✅ |
| SHA-256 | 记录/区块/分块哈希（CID） | ✅ |

规范编码用 **RFC 8785（JCS）子集自研**（~100 行，限定 string/number/bool/array/object/null，数字仅安全整数与规范小数形态），不引入 `canonicalize` 依赖——签名跨设备一致性的命门必须握在自己手里，且可被单测穷举。

**结论：协议库 `packages/ledger/`（`@deeporca/ledger`）运行时零依赖、零原生模块、零 UI/Electron 引用**——完全满足分层规则，单测可在纯 Node 环境跑。

### 3.2 组网与发现

- **主路径 mDNS/DNS-SD**：服务类型 `_deeporca-chain._tcp.local.`，TXT 记录携带 `cid`（链 ID 前 8 位）、`v`（协议版本）、`port`（同步端口）。实现用 `multicast-dns`（纯 JS、无原生依赖、跨平台含 Windows）。Windows 首次监听会触发防火墙授权弹窗——列为已知的首次体验成本，文档 + 首启引导覆盖。
- **兜底路径手动邀请**：`deeporca-chain://<host>:<port>/<chainId>` 邀请码（可带 Ed25519 创始人签名，用于"需批准"准入模式）。企业网组播被禁时依然可用。
- **传输 WebSocket**：每设备监听一个同步端口（`ws`，与 next-version 主线 C-M1 同一依赖，两边谁先落地谁声明依赖）。握手：X25519 ECDH → HKDF → AES-GCM 帧加密 + 双向 Ed25519 挑战签名（Noise-XX 的简化定制，M1 实现而非留到加固期——局域网明文传输是不可接受的起点）。
- **拓扑**：全互联 mesh（团队 ≤50 节点可承受）；gossip 广播记录/区块；blob 走 have/want 点对点拉取。

### 3.3 账本结构

- **Record**（链的原子单位）：`{ type, ts, author(keyId), body, parentRecordId?, sig }`；`recordId = SHA-256(JCS(record))`；幂等去重按 recordId。
- **Block**：`{ height, prevBlockHash, ts, proposer, merkleRoot, records[] }`；出块节奏 2 秒或满 256 条；终局条件 = 收集到 ≥ quorum 个成员的区块批准签名（默认 `floor(n/2)+1`，可配 2/3 或全员）。
- **提议人轮转**：成员按 join 序编号，`slot = height % n`；slot 超时 4 秒顺延下一序号（view-change-lite）。
- **分叉规则**：同高度多区块 → 批准数多者胜，平票取提议人序号小者；分叉侧记录按 recordId 幂等回流主链。威胁模型是"事后可审计"而非 BFT 容错（成员是同事不是匿名对手），活性优先于强一致。
- **创世与链 ID**：创世块含链名/创建时间/创始人公钥/链参数/quorum/salt；`chainId = "orca1" + base32(SHA-256(创世规范字节))[:20]`，人类可读分组显示。新设备加入 = 发现 → 拉全量账本 → 从创世重放校验（签名 + 哈希链 + 联签数）→ 提交 `member.join` 记录。局域网内多条链并存时设备按链 ID 区分，UI 呈现链列表；仅有一条链且准入开放时自动加入（即"开启即上链"）。
- **存储**：原始账本 `~/.deeporca/coordchain/<chainId>/ledger/`（每块一文件）+ `node:sqlite` 物化视图（records/assets/tasks/members 表，复用 gitmcp 的 FTS5 先例）。视图可从账本全量重建——账本才是唯一事实源。

### 3.4 资产（blob）分发

4MB 分块 → 每块 SHA-256 → manifest（分块列表 + name/mime/size/acl/createdAt）→ manifest CID 上链（`asset.publish` 记录）。本地存储配额默认 2GB、LRU 清理（删 blob 不损账本完整性）。拉取校验哈希后落盘。静态加密（OC4）：工作组密钥（HKDF 派生）对 blob 加密，链上只见密文 CID。

### 3.5 协同编辑（CRDT）——明确不做（MVP）

需求域是"追加式记录 + 只读消费"，不存在两人同时编辑同一文档的字符级合并问题；元数据级冲突（同名资产更新）用版本链 + LWW。引入 Yjs/Automerge 会带来不可逆的数据模型负担（[Automerge 全历史加载的性能教训](https://github.com/automerge/automerge/issues/1231)）。若未来上"多人共编需求文档"，作为独立 spec 再议（候选 Loro）。

### 3.6 存储

原始账本 + blob 走文件系统；物化视图走 `node:sqlite`（Node ≥22 既有约束，gitmcp 已验证桌面侧 sqlite-capable Node 解析先例）。

## 4. 否决记录（为什么不是 X）

- **为什么不是 PoW/PoS 公链**：无代币经济需求；成员封闭可身份准入（Sybil 攻击面不存在）；秒级终局 vs 分钟级；零能耗。挖矿在桌面应用里同时是产品灾难。
- **为什么不是 Git 服务器**：Git 已能共享代码，但 (a) 不覆盖任务记录/设计稿等非代码资产的语义与检索；(b) 无成员/联签/审计语义；(c) 需要 中央 server 或裸仓库共享，UX 面向开发者而非 AI 协作流。设计上链与 Git 互补：`task.share` 记录可引用 commit hash，接续方据此对齐工作区。
- **为什么不是 NAS/共享盘**：无结构化任务语义、无 AI 可消费的接续上下文、无操作审计、无链身份。
- **为什么不是 OrbitDB/GUN/IPFS**：Electron 打包负担（IPFS 近乎不可行）、依赖树庞大、多个项目维护状态不稳；我们需要的能力（发现/传输/账本/blob）自研合计约 3–5k LOC 且全部可单测。
- **为什么 MVP 不用 Hypercore**：单写者日志 → 需要多 feed 合并层（SSB 模式），复杂度不低于自研联盟链，且"统一链 ID + 联签终局"的产品语义还要再包一层。保留为 blob 分发的后备实现（观察项）。

## 5. 风险清单

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 企业网禁组播（mDNS 不可用） | 中 | 手动邀请码为主兜底；UDP 广播探测为次兜底；文档明示网络要求 |
| Windows 防火墙/虚拟网卡干扰 | 中 | 首启引导 + 诊断命令（链面板内置自检：组播回环/端口连通） |
| 隐私事故（不该共享的内容上链） | 高 | 默认关；逐项显式共享；"自动共享任务记录"独立子开关默认关；TaskTrajectory 本就不含对话内容；链浏览器让"链上有什么"完全可见 |
| 恶意成员伪造/篡改 | 中 | 记录级 Ed25519 签名；从创世重放校验；联签 quorum；member.leave 撤销（历史不可抵赖地保留） |
| 被动窃听（局域网嗅探） | 中 | 链路 ECDH+AES-GCM 从 M1 起强制；blob 静态加密在 OC4 |
| 账本膨胀 | 低 | 链上仅元数据（估算日均千条 ≈ 数 MB）；OC4 加周期快照 + 截断修剪 |
| 双实例端口冲突 | 低 | 随机监听端口 + mDNS TXT 发布实际端口 |

## 6. 2026-08-27 需求收紧补记（主题即命名空间）

需求方同日澄清两点，已回写 spec 三件套与路线文档：

1. **产品隐喻 = 共享文档空间的放大版**：体验对标腾讯文档/飞书（打开就有、成员可见、随手共享），但共享的是**项目记录**（文档 + 设计稿 + 架构图 + 任务记录 + 会话轨迹），且接收方是 AI（接续开发）。UI 主隐喻是"共享空间"（资料/任务流/动态三栏），链/审计退居「审计」子页——链是机制，不是卖点界面。
2. **共享只认工作区主题**：链不由人工创建命名，而由**工作区主题**唯一决定；同主题自动同链、跨主题发现层隔离。关键技术依据：现有 `projectCode` 由绝对路径派生（`packages/core/src/common/app-dirs.ts:51`：超长时 basename+路径哈希前缀；桌面侧 `workspace-registry.ts:193` 同构），机器本地、跨机必不相等——**不可用作主题**。主题解析定为：git remote 归一（协议无关/小写 host/去 `.git`，`git:github.com/o/r`）优先 → 用户显式主题名（`name:xxx`）次之 → 目录名仅本地显示不参与匹配。themeId 进创世块与 mDNS TXT，加入时双向锚定核对（spec design §4，需求 R24–R26）。
3. **链工作区 = 自研类 Git 版本层**：共享层是版本化工作区（blob/tree/commit 对象模型 + CID 寻址 + `ws.commit` 记录锚定；谱系/diff/历史检出；第一版无 merge，并行提交=分叉保留）。**底子已有三处**：`GitFileHistory`（`packages/core/src/common/file-history.ts:29`）自研的"manifest→tree→commit"管线与会话变更集（changedFilePaths/checkpointHash）即现成地基；CID/blob 分块层即 git 对象存储等价物；账本哈希链即谱系锚定。否决"直接共享 .git 裸仓库"（耦合 packfile/refs 内部格式、无法记录级锚定/ACL/加密，见 spec design §8.4）。**prior art 强化**：Hyperdrive（Hypercore 生态的版本化文件系统层）与本设计同构，观察项价值上调（spec design §13）。

## 7. 结论

自研 **`@deeporca/ledger` 零依赖协议库**（身份/JCS 编码/记录/区块/联签/CID/物化视图）+ desktop main 的 `coord-chain/` 服务（mDNS 发现 + ws 加密传输 + gossip + blob 同步）+ 协调语义层（任务谱系/认领/接续开发）。全部密码学原语 Node 22 原生；新 npm 依赖合计两个：`multicast-dns`、`ws`（后者与主线 C 共享）。Hypercore 与 CRDT 库列为观察项不引入。

引用：[@libp2p/mdns](https://www.npmjs.com/package/@libp2p/mdns) · [libp2p mDNS 文档](https://libp2p.io/docs/mdns/) · [IPFS 论坛：js 实现的 Windows mDNS 问题](https://discuss.ipfs.tech/t/is-mdns-discovery-not-working/3984) · [holepunchto/hypercore](https://github.com/holepunchto/hypercore) · [Pear 文档：Hypercore 参考](https://docs.pears.com/reference/building-blocks/hypercore/) · [Yjs vs Automerge vs Loro（2026）](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026) · [Automerge 加载性能 issue #1231](https://github.com/automerge/automerge/issues/1231) · [HN：Yjs vs Automerge 实践](https://news.ycombinator.com/item?id=41012895)
