# AI 协调工作链（Coord Chain）— 需求文档

> 日期：2026-08-27 · 状态：调研定稿（未实现）· 归属：**王牌路线 OC**（优先级高于 next-version，见 `docs/features/coord-chain-plan.md`）· 调研：`docs/research/2026-08-27-coord-chain-technology-survey.md`

## 1. 问题与背景

DeepOrca 目前是单机作战的 coding agent：会话、任务记录、设计稿、架构图全部留在本机。小团队（同一办公室/局域网）内多台设备各自为战——A 做完的调研与踩坑，B 要从头再来；需求文档靠 IM 传文件；没有任何跨设备的、可审计的协作痕迹。

竞品的多人协作一律走云端账号 + Git 仓库。本特性给出另一条路：**局域网内的联盟式许可链**——产品体验对标腾讯文档/飞书的「共享文档空间」，但共享的粒度更大：不是单篇文档，而是**项目记录**（需求文档、设计稿、架构图、任务记录、会话轨迹）；且**共享只认工作区主题**：同一局域网内工作区主题相同的实例自动同链（开启配置即上链、持有统一链 ID），主题不同则互相不可见。他人可**基于链上任务记录接续开发**，形成跨设备的任务谱系。无云、无账号服务器、防篡改可审计。

这是与其他 coding agent 的核心区分点之一，与 next-version 并列为本项目王牌。

## 2. 范围

### 包含

- 新工作区 `packages/ledger/`（`@deeporca/ledger`）：UI-free/Electron-free/零运行时依赖的协议库——Ed25519 设备身份、RFC 8785 子集规范编码、**工作区主题规范化解析（git remote 锚定/显式主题名 → themeId）**、记录/区块/联签账本、链 ID（创世推导）、CID 内容寻址、`node:sqlite` 物化视图
- desktop main `coord-chain/` 服务：mDNS/DNS-SD 发现（`_deeporca-chain._tcp.local.`，按 themeId 匹配）、ws 同步服务器与出站连接（X25519+AES-GCM 链路加密 + Ed25519 握手挑战）、记录/区块 gossip、blob have/want 分块同步
- **链工作区（自研类 Git 版本层）**：blob/tree/commit 内容寻址对象模型（tree 与 `GitFileHistory` manifest 同构）、commit 谱系与文件级 diff、历史版本检出（预览确认 + 目录白名单）、会话变更集直通提交；第一版无 merge（分叉保留 + 择线）
- 协调语义：资产发布/撤销、任务记录共享（task.share，负载基座为 `TaskTrajectory`）、任务认领（claim）、接续开发（从链上任务记录生成本地接续会话，parentRecordId 谱系）
- desktop UI：设置面板「协作链」段、Hub「工作链」二级浮层（链 ID/成员/最近区块/资产流/任务流）、会话与任务上的「上链共享」动作
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
2. 作为同事，我在**同一项目**（工作区主题相同，无论本机路径如何）的机器上开启「共享」，系统自动发现同主题的链并加入（准入开放时无需操作），我的设备出现在成员列表中；主题不同的工作区互相看不见对方。
3. 作为用户，我在会话/任务上点「共享任务记录」，系统将任务的操作轨迹摘要、结论、遗留事项作为记录提交上链，联签封存后其他成员立即可见。
4. 作为同事，我在「工作链」面板浏览链上任务记录，点击「接续开发」，系统拉取关联资产、在本机创建注入任务上下文的新会话，我的 agent 据此继续工作；我完成后再共享，形成任务谱系。
5. 作为用户，我把需求文档/设计稿/架构图发布为链上资产，或把本次会话的文件变更**提交为链工作区版本**（像 commit/push），其他成员按需拉取，内容校验通过才落盘。
6. 作为同事，我在共享空间浏览**版本谱系**（谁、何时、改了什么、为什么），对比任意两个版本的文件级差异，并可把历史版本检出到本地。
7. 作为用户，我在工作链面板查看任意区块与记录（谁、何时、什么内容、谁联签）——本地完整审计，无需信任任何单点。
8. 作为谨慎用户，我确认：功能默认关闭；任何内容不经我显式操作不会离开本机（「自动共享任务记录」为独立子开关且默认关）。
9. 作为 AI 代理，我通过 defineAction 暴露的 chain 查询/认领动作，在开始大改动前查询并发布任务认领，避免与链上其他成员撞车。

## 4. 验收标准（EARS）

### 开关、身份与建链

- **R1** The 协作链功能 shall 默认关闭，采用双层开关：用户级总闸（设备身份/配额）+ 项目级「本工作区开启共享」（`shared`）；链数据（密钥/账本/blob）shall 存放于 `~/.deeporca/coordchain/<chainId>/`，不写入项目目录。
- **R2** When 用户首次开启协作链，the 系统 shall 生成 Ed25519 设备密钥对（权限 0600）并要求设定设备名；the 设备身份 shall 以公钥指纹（keyId）在链内唯一标识。
- **R3** When 某主题在本局域网首次有工作区开启共享，the 系统 shall 构造含**工作区主题规范串**的创世块（主题/创建时间/创始人公钥/链参数）并以 `orca1` 前缀的链 ID 标识；the 链 ID 与主题 shall 可复制展示且在 UI 中分组易读（面板明示主题来源与值）。
- **R4** When 同一局域网存在与**本工作区主题相同**且准入开放的链，the 新开启共享的工作区 shall 自动发现并加入（按 themeId 匹配，无需人工选链）；when 组播不可用，the 系统 shall 支持通过携带 themeId 的邀请码（`deeporca-chain://host:port/<themeId>`）手动加入。
- **R5** When 新设备加入链，the 系统 shall 先拉取全量账本、从创世重放校验（哈希链 + 记录签名 + 联签数），校验通过才接受加入并广播 `member.join`；when 校验失败，the 系统 shall 拒绝加入并给出首个不一致位置。
- **R6** When 用户离开链（或撤销设备），the 系统 shall 广播 `member.leave` 记录；the 历史记录 shall 不可篡改地保留（撤销只影响后续准入，不抹除历史）。

### 记录与账本

- **R7** The 账本 shall 为哈希链式追加账本：区块携带 prevBlockHash 与记录 Merkle 根，出块节奏默认 2 秒或满 256 条；the 单条记录 shall ≤8KB（元数据 + 哈希引用，不携带文件本体）。
- **R8** The 每条记录 shall 由作者设备 Ed25519 签名；the 每个区块 shall 由轮值提议人打包并收集 ≥ quorum（默认多数派，可配）成员批准签名后方为终局。
- **R9** When 同步收到历史区块/记录，the 系统 shall 按 recordId 幂等去重；when 同高度出现竞争区块，the 系统 shall 依"批准数多者胜、平票取提议人序号小者"裁定，the 竞争侧记录 shall 幂等回流主链不丢失。
- **R10** The 系统 shall 维护 `node:sqlite` 物化视图（成员/资产/任务/记录），且 the 视图 shall 可从原始账本全量重建（账本为唯一事实源）。

### 资产共享

- **R11** When 用户发布资产（需求文档/文件/设计稿/架构图等），the 系统 shall 按 4MB 分块、逐块 SHA-256、生成 manifest 并将 manifest CID 与元数据作为 `asset.publish` 记录上链；文件本体 shall 不进入区块。
- **R12** When 成员浏览/消费资产，the 系统 shall 经 have/want 协议从任意持有者拉取分块，逐块校验哈希后才落盘；when 校验失败，the 系统 shall 丢弃并重新路由其他来源。
- **R13** The 本地 blob 存储 shall 有配额（默认 2GB）与 LRU 清理，且清理 blob shall 不影响账本完整性；When 用户撤销资产，the 系统 shall 广播 `asset.revoke`（链不可删，仅撤销声明 + 视图过滤）。

### 任务记录与接续开发

- **R14** When 用户共享任务记录，the 系统 shall 以 `TaskTrajectory`（操作轨迹，不含对话内容）为基座构造 `task.share` 记录：目标、已完成操作摘要、触及文件、结论、遗留事项；when 变更需要随行，shall 提交为链工作区 `ws.commit` 并以 taskRef 互链（无变更时为纯记录共享）。
- **R15** When 用户对链上任务记录点击「接续开发」，the 系统 shall 先将其关联的 `ws.commit` 版本物化或生成补丁对齐本地工作区（预览确认，R31），创建本地新会话并注入结构化任务上下文卡（含上游链 ID、recordId 与 commitCid），且新会话完成后再共享时 shall 自动携带 parentRecordId 形成谱系。
- **R16** The 任务记录共享 shall 默认逐次显式触发；「自动共享任务记录」shall 为独立子开关且默认关闭，开启时 the 系统 shall 在任务终态后仅共享轨迹摘要（仍不含对话原文）。

### AI 协调语义

- **R17** The 系统 shall 通过 defineAction 暴露链查询/任务认领能力（LLM 表面）；When AI 在改动前查询认领状态，the 系统 shall 返回活跃 claim 列表；When AI 发布 claim，the 记录 shall 即时 gossip 且对其他成员的查询可见。
- **R18** The claim shall 为声明性软锁（提示撞车风险），shall 不阻塞也不强制任何成员的本地执行。

### 安全与隐私

- **R19** The 节点间传输 shall 全程加密（X25519 ECDH + HKDF + AES-256-GCM）并以 Ed25519 挑战签名完成双向认证；明文帧 shall 不被接受。
- **R20** The 工作链面板 shall 提供链浏览器（区块/记录/签名/联签可本地审计）与网络自检（组播回环/端口连通）；The 系统 shall 在任何共享动作发生前呈现将上链内容的预览确认。
- **R21** The 现有单机能力（会话、任务树、设计、知识、MCP）shall 在协作链关闭时零行为变化；开启时亦 shall 不影响未共享内容的本地语义。

### 兼容与工程约束

- **R22** The `@deeporca/ledger` shall 无运行时 npm 依赖、无原生模块、不 import react/electron（可在纯 Node 环境单测）；desktop 侧新增依赖 shall 限定 `multicast-dns` 与 `ws`（后者与 next-version 主线 C 共享）。
- **R23** The 桌面 UI 新增文案 shall 覆盖全部 6 套字典（en/zh + ja/ko/zh-tw/zh-hk）；IPC 通道按 `chain:*` 前缀集中于 `shared/ipc.ts` 并双侧接线。

### 工作区主题与隔离（2026-08-27 增补）

- **R24** The 工作区主题 shall 以跨机器稳定的规范串解析：优先 git remote 归一（协议无关、小写 host、去 `.git` 后缀），次选用户显式主题名；the 目录名/绝对路径 shall 不参与跨机匹配（现有 `projectCode` 为机器本地路径派生，不可用作主题）；when 工作区无 git remote 且未设定主题名，the 系统 shall 在开启共享前要求用户显式设定主题名。
- **R25** The 跨主题隔离 shall 在发现层生效：主题不同的实例互相不可见（不握手、不出现在成员列表、不交换任何记录或资产）；the 面板 shall 仅呈现当前工作区主题对应的链内容。
- **R26** When 加入链时，the 系统 shall 核对创世块主题串与本工作区 themeId 一致（防主题碰撞/近似误入）；when 用户覆盖主题，the 系统 shall 视为切换到另一条链（本机视角切换，原链数据保留）。

### 链工作区（2026-08-27 增补 II）

- **R27** The 链工作区 shall 采用类 Git 对象模型：blob/tree/commit 全部内容寻址（CID），tree 为路径→blob 清单（与 `GitFileHistory` manifest 同构），commit 含 parents/message/作者签名并镜像为 `ws.commit` 记录上链锚定；the 任意 commit shall 可经对象 CID 逐项校验后完整物化。
- **R28** When 用户（或 AI）提交链工作区变更，the 系统 shall 支持选定文件/目录或直接采用会话变更集（复用 `GitFileHistory` 的 `changedFilePaths`/`checkpointHash`）构造 tree 与 commit（parent = 当前 head）；when 共享任务记录附带变更，the `task.share` 与 `ws.commit` shall 以 taskRef 互链。
- **R29** The 共享空间 shall 呈现 commit 谱系（作者/时间/说明）与任意两 commit 间的文件级 diff；when 用户检出历史版本，the 系统 shall 预览确认后物化，且 the 物化目标 shall 限于用户选定目录内（路径穿越拒绝）。
- **R30** The 并行提交 shall 保留为谱系分叉（第一版无 merge，链不可删）；the 视图 head shall 默认按 (ts, commitId) 取 LWW 且可由用户显式切换择线。
- **R31** When 接续开发且上游任务关联 ws.commit，the 系统 shall 先将上游版本物化或生成补丁对齐本地工作区（预览确认），再创建注入上下文卡的接续会话。

## 5. 约束

- Node ≥ 22（Ed25519/X25519/HKDF/AES-GCM/`node:sqlite` 全部走 `node:crypto`/内置，零新增密码学依赖）
- 遵守分层规则：core 不感知协作链（桌面侧服务 + ledger 独立包）；renderer 零 Node/Electron 直引
- TypeScript strict / `import type` / kebab-case / 文件 ≤2500 行拆分纪律
- 协议版本进 mDNS TXT 与握手首帧；不兼容版本明确拒绝并提示升级
