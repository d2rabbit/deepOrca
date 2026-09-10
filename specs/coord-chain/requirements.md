# AI 协调工作链（Coord Chain）— 需求文档

> 日期：2026-08-27 · 状态：**本阶段方案（R32–R40 修正批，2026-09-08 交互定稿）** · 归属：**王牌路线 OC**（优先级高于 next-version，见 `docs/features/coord-chain-plan.md`）· 调研：`docs/research/2026-08-27-coord-chain-technology-survey.md`

## 1. 问题与背景

DeepOrca 目前是单机作战的 coding agent：会话、任务记录、设计稿、架构图全部留在本机。小团队（同一办公室/局域网）内多台设备各自为战——A 做完的调研与踩坑，B 要从头再来；需求文档靠 IM 传文件；没有任何跨设备的、可审计的协作痕迹。

竞品的多人协作一律走云端账号 + Git 仓库。本特性给出另一条路：**局域网内的联盟式协作空间**——产品体验对标腾讯文档/飞书的「共享文档空间」，但共享的粒度更大：不是单篇文档，而是**项目工作事实**（需求文档、设计稿、架构图、Work Item、证据、决策与会话轨迹）。工作区主题仅发现候选，`spaceId`、创世哈希与签名 charter 才确认成员边界；主题不同互不可见，同主题空间也不隐式合并。他人可基于 Work Item 接续编码或非编码工作，形成跨设备谱系。无云、无账号服务器、可验证且可审计。

这是与其他 coding agent 的核心区分点之一，与 next-version 并列为本项目王牌。

## 2. 范围

### 包含

- 新工作区 `packages/ledger/`（`@deeporca/ledger`）：UI-free/Electron-free/零运行时依赖的协议库——Ed25519 设备身份、RFC 8785 子集规范编码、**工作区主题规范化解析（git remote 锚定/显式主题名 → themeId）**、记录/区块/联签账本、链 ID（创世推导）、CID 内容寻址、`node:sqlite` 物化视图
- desktop main `coord-chain/` 服务：mDNS/DNS-SD 发现（`_deeporca-chain._tcp.local.`，按 themeId 匹配）、ws 同步服务器与出站连接（X25519+AES-GCM 链路加密 + Ed25519 握手挑战）、记录/区块 gossip、blob have/want 分块同步
- **链工作区（自研类 Git 版本层）**：blob/tree/commit 内容寻址对象模型（tree 与 `GitFileHistory` manifest 同构）、commit 谱系与文件级 diff、历史版本检出（预览确认 + 目录白名单）、会话变更集直通提交；第一版无 merge（分叉保留 + 择线）
- 协调语义：资产发布/撤销、任务记录共享（task.share，负载基座为 `TaskTrajectory`）、任务认领（claim）、接续开发（从链上任务记录生成本地接续会话，parentRecordId 谱系）
- desktop UI：设置总闸与会话模块的工作区共享/协作空间选择；任务树顶部的空间状态、节点级共享与分类控制、底部链操作日志；各模块将自动记账投影到既有界面，而不新增 Hub 或逐模块「上链共享」动作
- 手动邀请码入链（组播不可用时的兜底，携带 themeId）；链浏览器（本地即可审计链上全部内容）
- UI 隐喻对标「共享文档空间」：资料/任务记录流/动态三栏 + 审计子页（链浏览器）

### 非目标（本期不做）

- 公链/挖矿/代币/跨互联网广播（无 PoW/PoS/BFT 完整实现）
- 多人字符级协同编辑（CRDT 库不引入；元数据冲突用版本链 + LWW）
- 三向合并/分支管理（OC4 评审；第一版并行提交=谱系分叉保留 + LWW head 择线）
- 跨网段/公网组链（远期与 next-version 主线 C 的 relay 隧道结合）
- 跨主题聚合视图（面板只显示当前工作区主题对应的链；多工作区各自独立面板上下文）
- blob 静态加密与 ACL 细粒度（OC4 加固期；本期 ACL 仅"链内全员"）
- 账本修剪/快照截断（OC4）；智能合约/链上脚本（不做，无场景）
- 核心会话循环改动（协调链不进入 core LLM 回路，仅桌面侧服务 + 可选 defineAction 暴露）

## 3. 用户故事

1. 作为团队首位用户，我在某工作区开启「共享」，系统解析该工作区主题（git remote 自动锚定，或我显式设定的主题名），生成设备密钥并以该主题创世（或加入已有链），持有链 ID（如 `orca1-ABCD23…`）；面板顶部明示主题与成员。
2. 作为同事，我在**同一项目**（工作区主题相同，无论本机路径如何）的机器上开启「共享」，系统发现同主题的协作空间候选；若只有一个已信任、准入开放的空间可自动建议加入，若有多个候选则我核对空间身份后选择。主题不同的工作区互相看不见对方。
3. 作为用户，我在会话模块**打开新工作区时**决定是否「开启共享」（系统解析该工作区主题并明示）；开启后我的任务记录随任务终态**自动记账上链**（操作轨迹摘要、结论、遗留事项，不含对话原文），无需逐次确认；不想共享的关键任务，我在任务树上对该节点单独关闭共享即可。
4. 作为同事，我在任务树的链上 Work Item 或任务记录中点击「接续开发」，系统拉取关联资产、在本机创建注入任务上下文的新会话，我的 agent 据此继续工作；共享与分类允许时，终态自动记账并形成任务谱系。
5. 作为用户，我把需求文档/设计稿/架构图发布为链上资产，或把本次会话的文件变更**提交为链工作区版本**（像 commit/push），其他成员按需拉取，内容校验通过才落盘。
6. 作为同事，我在共享空间浏览**版本谱系**（谁、何时、改了什么、为什么），对比任意两个版本的文件级差异，并可把历史版本检出到本地。
7. 作为用户，我在工作链面板查看任意区块与记录（谁、何时、什么内容、谁联签）——本地完整审计，无需信任任何单点。
8. 作为谨慎用户，我确认：功能默认关闭；共享边界由我两级控制——**工作区级**（打开工作区时决定是否入链）与**节点级**（任务树上逐节点关闭共享，未共享节点对成员仅标题可见且锁定不可操作）；所有已上链内容可在链浏览器全量审计。
9. 作为 AI 代理，我通过 defineAction 暴露的 chain 查询/认领动作，在开始大改动前查询并发布任务认领，避免与链上其他成员撞车。

## 4. 验收标准（EARS）

### 开关、身份与建链

- **R1** The 协作链功能 shall 默认关闭，采用双层开关：用户级总闸（设备身份/配额）+ 项目级「本工作区开启共享」（`shared`）；链数据（账本/blob/视图）shall 存放于**工作区数据根** `<workspace>/.deeporca/coordchain/<chainId>/`（2026-09-08 修正：项目数据根类比 `.git`，见 R40），且 the `coordchain/` 子目录 shall 加入 gitignore——链数据的分发通道是链本身，不随代码仓库远端分发；the 设备密钥 shall 为例外存于用户级 `~/.deeporca/coordchain/device-key.json`（设备身份非项目数据）。
- **R2** When 用户首次开启协作链，the 系统 shall 生成 Ed25519 设备密钥对（权限 0600）并要求设定设备名；the 设备身份 shall 以公钥指纹（keyId）在链内唯一标识。
- **R3** When 用户为工作区创建协作空间，the 系统 shall 构造含工作区主题规范串、签名空间章程、创建时间、创始成员、公钥与链参数的创世块，并推导稳定 `spaceId` 与 `orca1` 链 ID；the 主题仅作发现线索，spaceId/创世哈希/charter 才是加入和审计身份。UI shall 明示主题来源、空间名称、成员与可复制身份。
- **R4** When 同一局域网存在与**本工作区主题相同**的协作空间，the 新开启共享的工作区 shall 发现其 spaceId、创世哈希、协议版本和准入状态；仅单一已信任且准入开放的候选可自动建议加入，多个候选 shall 要求用户选择，不得静默合并。when 组播不可用，the 系统 shall 支持携带 spaceId、创世哈希、协议版本与准入证明的邀请码手动加入。
- **R5** When 新设备加入协作空间，the 系统 shall 先拉取空间 charter、账本及必要 epoch 状态，从创世或被确认归档锚点重放校验（哈希链、记录签名、成员 epoch、validator-set hash、确认票和 canonical fork-choice）；校验通过才接受加入并广播成员变更。when 校验失败，the 系统 shall 拒绝加入并给出首个不一致位置。
- **R6** When 用户离开链（或撤销设备），the 系统 shall 广播 `member.leave` 记录；the 历史记录 shall 不可篡改地保留（撤销只影响后续准入，不抹除历史）。

### 记录与账本

- **R7** The 账本 shall 为哈希链式追加账本：区块携带 prevBlockHash 与记录 Merkle 根，出块节奏默认 2 秒或满 256 条；the 单条记录 shall ≤8KB（元数据 + 哈希引用，不携带文件本体）。
- **R8** The 每条记录 shall 由作者设备 Ed25519 签名；the 每个区块 shall 由轮值提议人打包并收集当前确认 epoch 的 ≥ quorum 成员确认票后标记为 confirmed。确认票 shall 绑定 epoch、validator-set hash、parent hash、height、round 与 block hash，且不得被解释为业务/内容审批。
- **R9** When 同步收到历史区块/记录，the 系统 shall 按 recordId 幂等去重并保留 observed/provisional/confirmed 状态；when 出现竞争链段，the 系统 shall 在相同 epoch、父块与 round 验证域中依 charter 的 canonical fork-choice 裁定。竞争侧记录 shall 被保留为可审计链段或重入后续区块；任何裁定不得自动覆盖本地物化内容。
- **R10** The 系统 shall 维护 `node:sqlite` 物化视图（空间/epoch/成员/资产/任务/Work Item/证据/主张/决策/审批/分类/副本健康/记录），且 the 视图 shall 可从可用的已验证账本或确认归档锚点重建（账本为事实源）。视图可重建不表示 blob/object 内容必然可恢复。

### 资产共享

- **R11** When 用户发布资产（需求文档/文件/设计稿/架构图等），the 系统 shall 按 4MB 分块、逐块 SHA-256、生成 manifest 并将 manifest CID 与元数据作为 `asset.publish` 记录上链；文件本体 shall 不进入区块。
- **R12** When 成员浏览/消费资产，the 系统 shall 经 have/want 协议从任意持有者拉取分块，逐块校验哈希后才落盘；when 校验失败，the 系统 shall 丢弃并重新路由其他来源。
- **R13** The 本地 blob 存储 shall 有配额（默认 2GB）与 LRU 清理，且清理 blob shall 不影响账本完整性；When 用户撤销资产，the 系统 shall 广播 `asset.revoke`（链不可删，仅撤销声明 + 视图过滤）。

### 任务记录与接续开发

- **R14** When 共享工作区中的 coding Work Item 对应会话任务达到终态且节点共享/分类允许，the 系统 shall 以 `TaskTrajectory`（操作轨迹，不含对话内容）为基座构造关联 `workRef` 的 `task.share`：目标、已完成操作摘要、触及文件、结论、遗留事项；when 变更需要随行，shall 提交为链工作区 `ws.commit` 并以 taskRef/workRef 互链。非编码 Work Item 使用结构化 work activity/result 与 evidence，不伪造工具或文件轨迹。
- **R15** When 用户对链上 coding Work Item 或任务记录点击「接续开发」，the 系统 shall 先将其关联的 `ws.commit` 版本物化或生成补丁对齐本地工作区（预览确认，R31），创建本地新会话并注入结构化任务上下文卡（含上游 spaceId、recordId 与 commitCid）；共享与分类允许时，新会话终态自动携带 parentRecordId/workRef 形成谱系。
- **R16** When 工作区共享已开启，the 任务记录与随行变更 shall 随任务终态**自动记账上链**（`task.share` + `ws.commit`，不含对话原文），shall 不要求逐次显式确认（「自动共享任务记录」子开关废除，2026-09-08）；the 任务树 shall 提供节点级共享开关（默认开），when 用户对某节点关闭共享，the 系统 shall 停止该节点**内容**上链、仅产生**标题占位记录**（`task.stub` ≤1KB：nodeId/title/ts/author，无任何轨迹/文件/结论字段），且 the 节点对其他成员 shall 仅呈现标题并锁定（不可接续/不可展开/不可批注）；the 已上链历史内容 shall 不可回收（链不可删，关闭仅止血后续增量——协议见 design.md §11.2）。

### AI 协调语义

- **R17** The 系统 shall 通过 defineAction 暴露链查询/任务认领能力（LLM 表面）；When AI 在改动前查询认领状态，the 系统 shall 返回活跃 claim 列表；When AI 发布 claim，the 记录 shall 即时 gossip 且对其他成员的查询可见。
- **R18** The claim shall 为声明性软锁（提示撞车风险），shall 不阻塞也不强制任何成员的本地执行。

### 安全与隐私

- **R19** The 节点间传输 shall 全程加密（X25519 ECDH + HKDF + AES-256-GCM）并以 Ed25519 挑战签名完成双向认证；明文帧 shall 不被接受。
- **R20** The 工作链面板 shall 提供链浏览器（区块/记录/签名/联签可本地审计）与网络自检（组播回环/端口连通）；the 凡涉链操作 shall 自动记账并在此全量可审计（不设逐动作「上链」确认，2026-09-08）；the 产生本地物化副作用的动作（接续开发检出对齐、历史版本检出）shall 保留预览确认 + 目录白名单。
- **R21** The 现有单机能力（会话、任务树、设计、知识、MCP）shall 在协作链关闭时零行为变化；开启时亦 shall 不影响未共享内容的本地语义。

### 兼容与工程约束

- **R22** The `@deeporca/ledger` shall 无运行时 npm 依赖、无原生模块、不 import react/electron（可在纯 Node 环境单测）；desktop 侧新增依赖 shall 限定 `multicast-dns` 与 `ws`（后者与 next-version 主线 C 共享）。
- **R23** The 桌面 UI 新增文案 shall 覆盖全部 6 套字典（en/zh + ja/ko/zh-tw/zh-hk）；IPC 通道按 `chain:*` 前缀集中于 `shared/ipc.ts` 并双侧接线。

### 工作区主题与隔离（2026-08-27 增补）

- **R24** The 工作区主题 shall 以跨机器稳定的规范串解析：优先 git remote 归一（协议无关、小写 host、去 `.git` 后缀），次选用户显式主题名；the 目录名/绝对路径 shall 不参与跨机匹配（现有 `projectCode` 为机器本地路径派生，不可用作主题）。themeId 只用于发现候选空间；when 工作区无 git remote 且未设定主题名，the 系统 shall 在开启共享前要求用户显式设定主题名。
- **R25** The 跨主题隔离 shall 在发现层生效：主题不同的实例互相不可见（不握手、不出现在成员列表、不交换任何记录或资产）；the 面板 shall 仅呈现当前工作区主题对应的链内容。
- **R26** When 加入协作空间时，the 系统 shall 核对创世块主题串、spaceId、创世哈希、签名 charter 与本工作区 themeId/用户选择一致（防主题碰撞、近似误入或并发创世混淆）；when 用户覆盖主题，the 系统 shall 重新发现候选空间并保留原空间数据，不得把两个空间视为同链。

### 链工作区（2026-08-27 增补 II）

- **R27** The 链工作区 shall 采用类 Git 对象模型：blob/tree/commit 全部内容寻址（CID），tree 为路径→blob 清单（与 `GitFileHistory` manifest 同构），commit 含 parents/message/作者签名并镜像为 `ws.commit` 记录上链锚定；the 任意 commit shall 可经对象 CID 逐项校验后完整物化。
- **R28** When 用户（或 AI）提交链工作区变更，the 系统 shall 支持选定文件/目录或直接采用会话变更集（复用 `GitFileHistory` 的 `changedFilePaths`/`checkpointHash`）构造 tree 与 commit（parent = 当前 head）；when 共享任务记录附带变更，the `task.share` 与 `ws.commit` shall 以 taskRef 互链。
- **R29** The 共享空间 shall 呈现 commit 谱系（作者/时间/说明）与任意两 commit 间的文件级 diff；when 用户检出历史版本，the 系统 shall 预览确认后物化，且 the 物化目标 shall 限于用户选定目录内（路径穿越拒绝）。
- **R30** The 并行提交 shall 保留为谱系分叉（第一版无 merge，链不可删）；the 推荐 head shall 按确认链位置、因果关系与确定性 commitId 规则投影，并显式标注并发分叉，用户可择线。设备 `ts` 仅展示，不得作为跨设备 head 的权威 LWW。
- **R31** When 接续开发且上游任务关联 ws.commit，the 系统 shall 先将上游版本物化或生成补丁对齐本地工作区（预览确认），再创建注入上下文卡的接续会话。

### 模块链语义与共享模型（2026-09-08 对照真实 UI 修正）

- **R32 共享模型（两级）**：the 工作区是否入链 shall 在会话模块**打开该工作区时**一次性决定（解析工作区主题 → 明示链 ID/成员 → 开启即入链/建链）；共享开启后 the 任务树全部节点 shall 默认对成员可见且可操作；the 任务树节点级共享开关 shall 为唯一的逐节点控制点（R16）；the 系统 shall 不在每个模块单独提供「上链」动作按钮或逐动作确认。**fork 铁律（2026-09-08 补充）**：the fork 行为 shall 仅存在于任务树（声明式 fork）；the 会话模块的本地 fork 为既有独立能力（纯本地、不产生链记录），shall 与链 fork 明确区分，shall 不被链能力改写。
- **R33 链上操作自动记账**：凡涉链操作 shall 自动产生链记录并全量可审计——会话任务区记录上游链（parentRecordId 谱系）、原型设计与 UI 设计记录版本（design.version）、审查报告随基线记录、编辑器记录版本历史（checkpoint → ws.commit）、知识库记录合并结果（kb.sync）；记账 shall 不打断用户当前操作，shall 以链操作日志统一呈现。
- **R34 任务树 hub 二分**：the 任务树右侧信息板 shall 区分本地节点与链上节点——**仅链上节点**呈现链元信息（来源设备/链/记录/关联版本）与链上轨迹图树（对已开共享的链上节点，以图树展示链上谱系：谁、做了什么，操作者以链上 id 声明）；本地节点 shall 不呈现任何链信息板；未开共享的链上节点 shall 仅呈现标题 + 锁定态。
- **R35 知识库追随代码（无历史管理）**：the 知识库 shall 不做独立历史管理，同步语义追随代码仓库时间线——链上知识版本到达即按代码基线**覆盖采纳**（覆盖后以覆盖版为准）；when 对方链上无对应 wiki/架构图，the 本地版本 shall 保留；AGENTS.md shall 作为单文件始终走**合并**语义；符号关系图 shall 在 fork 或代码改动时自动触发 update hook（仅此资产有自动 hook）。the 知识库节点 shall 仍可 fork（fork 行为本身在任务树发起，R32）：fork 连带本地代码分支信息，是否覆盖本地取决于代码库时间线。the 知识库顶部 shall 仅呈现**同步状态行**（已同步 + 链信息 + 时间；存在覆盖/写入行为时一并标注），shall 不铺设语义声明 chips、shall 不设模块内 fork 按钮。
- **R36 编辑器本地历史**：the 编辑器 shall 具备本地历史管理（对标 IDEA/VSCode local history），以现有基线自动保存为前提自动产出本地历史点（本地修改、fork 落地、合并均产生历史点），且 shall 永不出机；when 历史点来自 fork 链或合并链，the 条目 shall 以链上 id 声明来源；恢复链上来源条目前 shall 逐块 CID 校验。the 历史 shall 采用**底部基线式**呈现：编辑器底部既有的检查点/基线行即历史入口，展开即以列表展示**当前文件的全部历史快照**（本地历史 ∪ 链上来源，随选中文件切换）；the 右栏既有结对栏 shall 保持原样——后来者 shall 不改变、不挤占既有结对编程内容。
- **R37 会话模块对齐本地 UI**：共享态下的会话模块 shall 与本地会话模块**无 UI 差异**（不新增常驻链表面、不设会话级上链按钮）；the 会话的链上元信息 shall 经会话区下方的链 id 入口**点击弹窗**呈现（来源 fork/上游记录/文件快照/操作者链上 id 时间线）。
- **R38 会话 fork 语义**：when 用户从历史会话节点 fork，the 新会话 shall **不保留前置历史**，而 shall 以**记忆摘要**注入 fork 后的任务区；the 项目内容 shall 采用当前节点的覆盖内容。
- **R39 会话文件快照（项目历史协同）**：the 每个会话节点 shall 保留其操作文件的快照（`GitFileHistory` checkpoint），作为 fork/接续时项目内容覆盖与回溯的数据基座，且 shall 随 task.share 以 ws.commit 随行上链。
- **R40 项目数据根（`.deeporca/` 类比 `.git`）**：the 工作区项目数据根 shall 容纳 coord-chain 的账本/blob/视图/记录索引（优先 `<workspace>/.deeporca/coordchain/<spaceId>/`；已有 legacy 项目根时遵循既有 `.deepcode` 兼容解析）；the 设备密钥 shall 为唯一设备级例外，存用户级目录。the `coordchain/` 子目录 shall 在实施时加入对应项目根的 gitignore：账本与视图可经可用 peer/归档重放重建，但 blob/object 仍依赖持有者、pin 或归档，不能被承诺为必然可恢复。

## 5. 约束

- Node ≥ 22（Ed25519/X25519/HKDF/AES-GCM/`node:sqlite` 全部走 `node:crypto`/内置，零新增密码学依赖）
- 遵守分层规则：core 不感知协作链（桌面侧服务 + ledger 独立包）；renderer 零 Node/Electron 直引
- TypeScript strict / `import type` / kebab-case / 文件 ≤2500 行拆分纪律
- 协议版本进 mDNS TXT 与握手首帧；不兼容版本明确拒绝并提示升级


## 4.1 v7 协作空间、通用工作项与数据治理增补（优先规则）

> 本节于 2026-09-10 增补。若本节与 R1–R40 的“每主题一条链”、跨设备 `ts` LWW、显式共享、可重放即可恢复内容等旧表述冲突，以本节为准。它不废止签名记录、CID 对象层、链工作区或 coding 任务谱系，而是把它们置入通用协作事实层。

### 协作空间与治理

- **R41 空间身份**：The 规范化工作区主题（`themeId`）shall 仅用于发现可能相关的协作空间；the 可加入协作空间 shall 以签名的 `space.charter`、创世哈希与稳定 `spaceId` 标识。一个主题可对应多个独立空间；the 客户端 shall 将其呈现为候选，不得因主题相同而静默合并、择一或导入对方记录。
- **R42 并发创世与邀请**：When 同主题设备并发创世或分区后发现多个空间，the 系统 shall 保留每个空间的独立账本、成员与资产；the 用户 shall 经空间名称、创世人指纹、成员、创建时间和 charter 摘要选择加入。邀请码 shall 绑定 `spaceId`、创世哈希、协议版本与准入证明，而非仅携带 `themeId`。
- **R43 成员 epoch**：The charter shall 定义成员角色、准入、确认策略和治理升级策略。成员加入、离开、驱逐、密钥替换或确认策略变更 shall 仅在已确认的 epoch 边界生效；每个区块及确认票 shall 绑定 `epoch`、validator-set hash、parent hash、height、round 与 block hash。
- **R44 确认与分区**：The 系统 shall 区分 `observed`、`provisional`、`confirmed`、`superseded` 与 `rejected` 记录/链段。确认票仅证明指定记录进入该空间账本，shall not 表示业务、内容或人员审批。成员不得对同一 `(epoch,height,round)` 的不同区块双签；双签 shall 形成可审计违规证据。网络分区可产生并行 provisional 后缀，重连后 shall 依 charter 的 canonical fork-choice 收敛；任何收敛不得自动覆盖本地工作区内容。
- **R45 因果与排序**：The 记录 shall 携带作者内单调序号、必要的因果前序引用和显式依赖。canonical ledger position 与因果关系 shall 用于权威投影排序；设备 wall clock 仅用于人类展示，shall not 用作成员、隐私、审批、状态或版本 head 的跨设备权威 LWW 比较。

### 通用 Work Item 与非编码协作

- **R46 Work Item**：The 系统 shall 支持独立于 coding session 的 `work.item`，含稳定 `workId`、类型、目标、状态、负责人/贡献者、优先级、期限、父项、标签、来源与分类。类型至少覆盖 coding、research、writing、review、design、analysis、operations、meeting、procurement、compliance、support 与 other。Work Item 可在工作开始前创建，shall 不以任务终态或文件改动为前提。
- **R47 生命周期与依赖**：The Work Item 状态机 shall 支持 draft、intake、triaged、ready、claimed、in_progress、waiting、blocked、in_review、approved、rejected、completed、cancelled、deferred 与 archived；状态变更 shall 由追加 `work.state` 事件表达，保留原因、阻塞/解阻预期和证据引用。`work.link` shall 表达 requires、blocks、duplicates、supersedes、implements、informs、produces 等命名关系；the 系统 shall 检测 hard dependency 环并推导非终态工作项的 blocked/waiting 状态。`parentRecordId` 只表达谱系与接续，不得代替依赖图。
- **R48 编码 adapter 边界**：When coding Work Item 的会话任务终态且共享与分类允许，the 系统 shall 自动产生或关联 `task.share`、`TaskTrajectory` 摘要和可选 `ws.commit`；这些是 coding 结果附件。研究、会议、评审、运营等 Work Item shall 使用受限的 `work.activity`/`work.result`、evidence 与资产引用，shall not 伪造 filesTouched 或工具轨迹。`TaskTrajectory` 的“不含对话原文”保证保持不变。
- **R49 证据、主张、决策与业务审批**：The 系统 shall 以独立、签名且可引用的 evidence、claim、decision 与 approval 记录表达来源、定位、采集方法、完整性、支持/反驳评估、决策选项、决策结论和批准响应。业务审批 shall 绑定被审对象版本、所需批准策略、有效期和理由；对象版本变化 shall 使旧审批显示为 stale。区块联签、业务审批和本地物化预览确认是三种不同机制，shall not 互相替代。
- **R50 外部与派生资产**：The 系统 shall 支持不复制到 blob 层的 `external.asset`，记录 canonical URI、来源系统、定位符、访问时间、内容 hash（若可得）、许可/归属、镜像状态与失效状态。脱敏、摘要、格式转换等 shall 生成新的 `asset.derive`，保留来源与变换关系，不得覆盖原资产。

### 分类、可用性与恢复

- **R51 分类与处理规则**：Work Item、资产、证据、决策、审批及派生物 shall 具有 `public`、`internal`、`confidential` 或 `restricted` 分类以及可选敏感类别、共享、导出与保留规则。分类默认从来源/父项保守继承；降级 shall 产生签名 `classification.change`，包含理由与必要批准。无静态加密和命名成员 ACL 时，restricted、凭据和敏感个人数据 shall 仅本地保存，禁止进入自动记账、`ws.commit`、blob 分发或链内共享。节点 opt-out 与 `.chainignore` 是额外防线，不得作为分类系统的替代。
- **R52 副本与恢复**：The 系统 shall 区分 participant、replica 与 archive：participant 可清理缓存，replica 对已 pin 对象承担可用性责任，archive 对账本与对象承担长期只读恢复责任。账本/视图可从可用账本重放；对象、tree、commit 与资产只有在至少一个持有者或可验证归档存在时才可恢复。UI shall 明示缺失对象、最后持有者风险和空间恢复路径。
- **R53 归档与退休**：The 空间 shall 支持签名归档导出、导入 bootstrap、退休/弃用声明与恢复引导。未来快照/修剪 shall 以被确认的快照锚点保留从创世或可信归档的验证链，shall not 把“视图可重建”误述为“所有内容可恢复”。


### v7 追溯矩阵

| 需求 | 主设计章节 | 实施任务 |
| --- | --- | --- |
| R41、R42、R43、R44、R45 空间、epoch、确认与因果 | §17 | 27、30、31、35 |
| R46、R47、R48 Work Item 与 coding/non-coding adapter | §18.1–§18.2 | 28、30、32、34 |
| R49、R50 evidence、decision、approval 与资产来源 | §18.3–§18.4 | 28、30、33、34 |
| R51 分类与脱敏派生 | §19.1 | 29、30、32、34、35 |
| R52、R53 副本、归档与恢复 | §19.2 | 29–31、32、35 |
