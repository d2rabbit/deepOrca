# AI 协调工作链（Coord Chain）— 实施计划

> 日期：2026-08-27 · 状态：规划中（未启动）· 分期代号 OC1–OC4 与 [`docs/features/coord-chain-plan.md`](../../docs/features/coord-chain-plan.md) 对齐 · 追溯目标：[requirements.md](./requirements.md) R1–R40
> **2026-09-08 注（替代 2026-09-03 分支口径）**：coord-chain 调整为**本阶段方案**，不再经 `next/coord-chain` 分支实现与合并；该分支已完成的 OC1–OC2 底层（协议核心 + 组网同步 + 双节点 e2e）**保留为实现参考**——OC1/OC2 对应任务实施时对照分支实况取材校准，**上层交互任务（OC3 起）以设计稿 v6 / §11 为准实施**。
> **2026-09-08 修正批（对照真实 UI，R32–R39）**：任务 15/16/18 按新共享模型改写（工作区级开关 + 节点级 opt-out + 自动记账，废除逐模块上链按钮与逐动作确认）；新增任务 23–25（知识库追随代码 / 编辑器本地历史 / 会话对齐 + 链 id 弹窗 + 任务树 hub 二分）。
> **数据落点修正（2026-09-08 补充，R40）**：任务 7 改为项目数据根落点——链数据随 `.deeporca/`（类比 `.git`）入工作区，gitignore 隔离，设备密钥留用户级。
> **链上行为深化（2026-09-08 · 交互定稿后）**：交互面（§10 矩阵 + 设计稿 v6）定稿；任务 26 承接 design.md §11 协议深化（记录生命周期/share.rule+task.stub/编辑器投影/KB 判定机械化/fork 物化/轨迹图树/outbox）。

## OC1 协议库 `@deeporca/ledger`（纯离线，零网络）

- [ ] 1. 工作区脚手架：`packages/ledger/`（package.json/tsconfig 入 workspace、`@deeporca/ledger`、零运行时依赖声明）
  - core/desktop 依赖关系不动；本包不 import react/electron/core
  - _Requirement: R22_

- [ ] 2. 身份与编码（`identity/` + `encode/` + `theme/`）
  - `node:crypto` Ed25519 keypair 生成/加载/存盘（0600 JSON）、keyId/指纹分组显示串
  - JCS 子集规范编码器（string/number/bool/null/array/object；安全整数与规范小数形态），拒绝超集输入
  - **工作区主题规范化解析器**：git remote 归一（协议无关/小写 host/去 `.git`）/显式主题名 → theme 串与 `themeId`；目录名与绝对路径不参与匹配
  - _Requirement: R2, R22, R24_

- [ ] 3. 记录与区块（`record/` + `block/`）
  - Record 全类型（member/asset/task/session/note）构造、签名、recordId；8KB 硬顶校验
  - Block 组装（prevBlockHash/Merkle 根/轮值 slot 计算）、批准签名收集与 quorum 判定（majority/twoThirds/all）
  - 分叉裁定（批准数 → proposer 序号）与 recordId 幂等去重容器
  - _Requirement: R7, R8, R9_

- [ ] 4. 链与重放（`chain/`）
  - 创世块构造（含**工作区主题规范串**）、`orca1` 链 ID 推导（base32 分组）、主题锚定核对接口（创世主题串 vs themeId）
  - 从创世全量重放校验器（哈希链/记录签名/quorum），失败返回首个不一致位置
  - _Requirement: R3, R5, R26_

- [ ] 5. CID、链工作区对象与物化视图（`cid/` + `ws/` + `view/`）
  - 4MB 分块、chunk/manifest CID、清单结构
  - **`ws/` 对象模型**：tree（path→blob，与 `GitFileHistory` manifest 同构）/commit（parents/message/签名）构造与校验、`commitCid`/`treeCid`、两 tree 文件级 diff 纯函数、谱系遍历
  - `node:sqlite` 视图建库（members/records/assets/tasks/blocks/commits）+ 账本/对象库→视图全量重建入口
  - _Requirement: R10, R11, R27_

- [ ] 6. 协议库单测（`src/tests/ledger.test.ts` 等）
  - JCS 穷举向量（键序/转义/数字形态）；签名/篡改/重放负例；分叉裁定与回流；创世→1000 块重放性能（<1s）；视图重建等价性
  - 链工作区向量：tree diff 边界（增/删/改/重命名）、commit 篡改负例、跨 commit 内容寻址去重、任意 commit 全量物化校验
  - 纯 Node 环境运行（run-tests.mjs 接线）
  - _Requirement: R5, R7, R8, R9, R10, R22, R27_

## OC2 组网与同步（desktop main `coord-chain/`）

- [ ] 7. 设置与数据落点（2026-09-08 修正：项目数据根）
  - 双层开关：用户级 settings `coordination` 段（总闸/设备名/配额，默认全关）+ 项目级 `.deeporca/settings.json` `coordination.shared`（每工作区独立开启，可带 themeOverride）
  - **项目数据根（R40，类比 `.git`）**：链数据落 `<workspace>/.deeporca/coordchain/<chainId>/`（ledger/blobs/view/objects，按主题链分目录），与既有 `.deeporca/` stores（sessions/reviews/deepwiki/designs/jobs/prototypes/task-trees）同根；**`coordchain/` 整体 gitignore**（链数据走链同步 + 重放可重建，不随代码仓库远端分发）；设备密钥例外存用户级 `~/.deeporca/coordchain/device-key.json`
  - _Requirement: R1, R2, R24, R40_

- [ ] 8. 传输层（`transport.ts`）
  - ws 监听（随机端口）+ 出站连接；首帧协议版本协商（不兼容明确拒绝）
  - X25519 ECDH + HKDF + AES-256-GCM 帧加密；Ed25519 双向挑战握手；按 keyId 去重；明文帧断连
  - _Requirement: R19_

- [ ] 9. 发现层（`discovery.ts`）
  - `multicast-dns` 广播/监听 `_deeporca-chain._tcp.local.`（TXT: wt/cid/v/port，**按 themeId 匹配**）
  - 同主题自动加入（免选链）、**跨主题发现层隔离**（不握手/不可见/不列成员）、邀请码 `deeporca-chain://host:port/<themeId>` 解析（含 invite 签名校验 + 主题一致性核对）
  - _Requirement: R4, R25, R26_

- [ ] 10. 同步层（`sync.ts`）
  - 新成员 getChain 全量拉取 + 重放校验（失败报首个不一致位置）；member.join/leave 广播
  - 稳态 gossip（记录/区块/批准）；(height, blockHash) 对齐断线续传；slot 超时顺延
  - _Requirement: R5, R6, R8, R9_

- [ ] 11. 对象与 blob 层（`blobs.ts` → `objects.ts`）
  - 对象库（blob 分块/tree/commit）存取；have/want 位图拉取、逐块哈希校验、多来源重路由、配额 LRU、revoke 视图过滤
  - _Requirement: R11, R12, R13, R27_

- [ ] 12. IPC 契约与主进程接线
  - `shared/ipc.ts` `chain:*` 请求/事件全集 + preload；main/index.ts 注册 handler；`chain:selfCheck`（组播回环/端口连通）
  - _Requirement: R20, R23_

- [ ] 13. 双机端到端验证（自动化 + 手测清单）
  - 自动：本地起两节点（子进程 + 随机端口 + 手动邀请码路径）跑通 建链→加入→共享资产→**A 机 commit → B 机 log/diff/checkout round-trip**→断线→重连；**隔离负例**：两工作区主题不同（不同 git remote/主题名）时互不可见、零握手
  - 手测：真实局域网两台 Windows/一台 macOS 的 mDNS 发现率、防火墙首启体验、同项目不同本机路径发现同主题空间候选并核对 spaceId
  - _Requirement: R4, R5, R11, R12, R19, R25, R27, R29_

## OC3 共享语义与 UI

- [ ] 14. 资产与链工作区提交流
  - 显式资产导入/发布（会话产物/设计稿/架构图/任意文件）：分块→manifest→`asset.publish`；这是非自动生成资产的例外操作，须先通过分类/技术 deny 检查。变更集 diff 可供检查，但不恢复逐模块「上链共享」或逐动作确认。
  - **`wsCommit`**：选定文件/目录或会话变更集（`GitFileHistory.changedFilePaths` 直通）→ tree → commit → 分发 → `ws.commit` 记录；共享范围忽略清单（`.chainignore` + 默认规则：构建产物/密钥类文件，内容 OC3 评审）
  - `wsLog/wsDiff/wsCheckout` 三接口（谱系分页/两 commit 文件级 diff/历史检出：预览确认 + 目标目录白名单 + 路径穿越拒绝）
  - 资产列表/拉取/打开/撤销（revoke）
  - _Requirement: R11, R13, R20, R27, R28, R29_

- [ ] 15. 任务记录共享（`task.share` · 2026-09-08 改写：自动记账）
  - TaskTrajectory → trajectory 摘要压缩（工具计数/文件触及/≤50 条关键操作）；结论与遗留项自动提炼（可事后编辑）
  - **共享开启后随任务终态自动记账**：`task.share` + 随行 `ws.commit`（taskRef 互链，见任务 14）——无逐次确认、无「自动共享」子开关（R16 修订）
  - 节点级共享开关：任务树逐节点 `share.rule`（默认开；关闭后停止上链 + 对成员仅标题可见且锁定）
  - _Requirement: R14, R16, R28, R32, R33_

- [ ] 16. 接续开发与会话 fork（2026-09-08 扩：R38/R39）
  - `chain:resumeFromTask`：taskRef 指向 ws.commit 时**先检出物化或生成补丁对齐本地工作区**（预览确认 + 目录白名单），再新建本地会话注入任务上下文卡（目标/已完成/触及文件/结论/遗留/上游链 ID+recordId+commitCid）
  - **会话 fork**：从历史会话节点 fork → 新会话**不保留前置历史**，以记忆摘要注入（复用 compaction 摘要管线）+ 项目内容取当前节点覆盖（ws.commit 物化）
  - **会话文件快照**：每会话节点保留操作文件快照（GitFileHistory checkpoint），随 task.share 以 ws.commit 随行上链
  - 接续会话再共享时自动携带 parentRecordId 与新 ws.commit；链面板任务谱系 + 版本谱系双视图（互链跳转）
  - _Requirement: R15, R29, R31, R38, R39_

- [ ] 17. AI 协调动作（defineAction）
  - `chain.query`（成员/资产/任务/认领）、`chain.claim`（认领/进度/完成）；LLM 表面注册与进度接线
  - _Requirement: R17, R18_

- [ ] 18. 共享空间 UI 全量（2026-09-08 改写：链是底座层，非第八模块；v7 由任务 32–34 扩展通用协作语义）
  - 设置面板「协作链」段（用户级总闸 + 设备名）；**会话模块「打开工作区」流程内置共享决定**（解析/设定工作区主题并明示链 ID/成员，非 git 工作区强制显式主题名）
  - 任务树顶部空间状态：主题来源 + 空间/链 ID + 成员 + 同步态；任务树底部**链操作日志**是一切自动记账的全量审计聚合面（无恒定全局主题条）
  - 各模块表面按 §10 矩阵落地：会话对齐本地 UI + 链 id 弹窗；任务树 hub 本地/链上二分 + 节点级共享开关；原型/UI 版本 rail 自动记账（无发布按钮）；知识库追随代码（无应用按钮）；编辑器本地历史 ∪ 链上来源（无快照上链按钮）；审查保持既有核心
  - 链浏览器/网络自检（原「审计」子页能力保留于链操作日志与设置面板入口）
  - i18n 六套字典（en/zh + ja/ko/zh-tw/zh-hk）全键覆盖
  - _Requirement: R3, R16, R20, R23, R24, R29, R32–R37_

### OC3 修正批（2026-09-08 对照真实 UI，R32–R39）

- [ ] 23. 知识库追随代码（R35）
  - 同步引擎：链上知识版本到达 → 按代码基线**覆盖采纳**（无人工确认、无独立历史）；对方缺失 wiki/架构图 → 保留本地；AGENTS.md 单文件**始终合并**；符号关系图 fork/代码改动**自动 update hook**（仅此资产）
  - `kb.sync` 记账（adopted/keptLocal/agentsMerged/symbolHook）；知识节点可 fork 但 fork 行为在任务树发起（fork 铁律，R32），覆盖与否取决于代码库时间线
  - 顶部**仅同步状态行**：已同步 + 链信息 + 时间（存在覆盖/写入行为时标注）；无语义声明 chips、无模块内 fork 按钮、无「应用链上知识版本…」人工流程
  - _Requirement: R35, R33, R32_

- [ ] 24. 编辑器本地历史管理（R36）
  - 本地历史点：以基线自动保存为前提自动产出（本地修改/fork 落地/合并均产生），对标 IDEA/VSCode local history，**永不出机**；历史区单列混排本地历史 ∪ 链上来源，链上来源条目以**链上 id 声明**（fork 链/合并链）
  - **底部基线式布局**：底部既有检查点/基线行 = 历史入口，展开即以列表展示当前文件的**全部历史快照**（随选中文件切换）；右栏结对栏（PAIR）保持原样（后来者不影响既有内容）
  - 动作收敛：恢复此点（本地直接 undo / 链上走逐块 CID 校验 + 预览确认）· 与当前对比；**无「快照上链」按钮**（链上条目由共享开启后的自动记账产生）
  - _Requirement: R36, R33, R32_

- [ ] 25. 会话模块对齐 + 任务树 hub 二分（R34/R37/R38）
  - 会话模块共享态与本地**零 UI 差异**；链上元信息经会话区下方**链 id 点击弹窗**呈现（来源 fork/上游记录/文件快照/操作者链上 id 时间线）
  - 会话 fork：不保留前置历史 → 记忆摘要注入新任务区 + 项目内容取当前节点覆盖（联动任务 16）；**会话本地 fork 为既有独立能力，不产生链记录**（R32）
  - 任务树右侧信息板二分：**仅链上节点**显示链元信息板 + 链上轨迹图树（谁做了什么，操作者以链上 id 声明）；本地节点无链信息板；未共享链上节点 = 仅标题 + 锁定
  - **链状态归任务树**：链 ID/同步态/成员/共享态聚在任务树顶部（无全局链底座条）；**链上/本地一律 tag 区分、不做分区分裂**（版本 rail/历史区/报告列表单列混排 + ⛓ tag）
  - 移除各模块「上链共享 / 发布为链上版本 / 快照上链 / fork 此节点」等模块内动作（统一走任务树 + 自动记账）；审查范围控件保持既有形态、报告历史仅在左侧列表
  - _Requirement: R34, R37, R38, R32, R33_

- [ ] 26. 链上行为协议深化（design.md §11 · 2026-09-08 交互定稿后）
  - **记录生命周期管线**：自动记账统一发送管线（本地事件 → 签名 → gossip → outbox 持久化 `.deeporca/coordchain/<chainId>/outbox.jsonl` → 重连补发）；记录幂等键全集（§11.1 总表落地）
  - **share.rule / task.stub 协议**：标题占位记录（≤1KB）+ 节点内单调 seq + 接收方 LWW 物化 + 视图遮蔽（历史内容降标题渲染、blob have/want 拒供）+ 「关闭不回收已散播历史」的设置页明示文案
  - **编辑器 ws.commit 文件级投影**：`chain:edHistory`/`chain:edRestore` IPC；懒拉该文件 blob + CID 校验；恢复产生新本地历史点（editor.snapshot 记录类型废止）
  - **KB 覆盖判定机械化**：以链工作区 commit 谱系为时间线（baseline ≥ 本机知识锚 → 覆盖采纳；< → 仅记账）；AGENTS.md 标记块级合并（`<!-- X:START/END -->` 幂等追加，自由文本段不合并）；符号图 update hook 三触发事件（fork 记录/物化落地/本地保存 debounce）
  - **会话文件快照物化**：节点 checkpoint manifest → fork 物化触及文件子集（预览确认）+ 记忆摘要注入（compaction 管线复用）
  - **轨迹图树构建**：`chain:trajectory` 沿 parentRecordId/commitRef/refRecordId 反向遍历（深度上限 32，缺失 parent 显示"等待同步"占位）
  - _Requirement: R14, R16, R32, R33, R34, R35, R36, R38, R39_

## OC4 协调深化与加固

- [ ] 19. 安全加固
  - blob 静态加密（工作组口令 → HKDF → AES-256-GCM；密钥分发方案评审）；细粒度 ACL（按成员/按记录）
  - `member.expel` 与 invite 准入策略完整化；设备密钥轮换（旧钥历史仍可验）
  - _Requirement: R6, R20_

- [ ] 20. 账本生命周期
  - 周期快照（checkpoint 高度参数化）+ 截断修剪；账本/资产导出归档（单文件包，离线可验证重放）
  - _Requirement: R10, R13_

- [ ] 21. 性能与规模验证
  - 5/20/50 节点仿真（单机多端口）gossip 与出块延迟；百 MB 资产分发耗时；视图查询基准
  - _Requirement: R7, R11_

- [ ] 22. 回归与文档
  - `npm run check && npm test` 全绿；关闭态零行为回归清单（R21 逐项走查）
  - 用户文档（组网要求/防火墙/邀请码/隐私姿态）+ `docs/` 架构补篇
  - _Requirement: R21, R23_


## v7 设计增补工作包（先于新增实现任务评审）

> 下列任务承接 R41–R53，且校正 OC1–OC4 的旧前提：主题仅用于发现；空间身份、epoch 确认、分类和可恢复性属于 MVP 地基。它们只在协议和 UI 评审通过后进入实现。

### OC1.5 协作空间治理与通用事实模型

- [ ] 27. 空间 charter、身份与 epoch 协议
  - `space.charter` / spaceId / invitation、同主题多空间候选、并发创世保留与归档关联
  - 成员 epoch、角色、治理变更、validator-set hash、proposal/vote/confirmation、round/view change 与双签证据
  - confirmed/provisional/superseded/rejected 状态、canonical fork-choice、因果头与 replay 验证
  - _Requirement: R3–R10, R24–R26, R41, R42, R43, R44, R45_

- [ ] 28. 通用 Work Item、证据、决策与审批记录/视图
  - schema 与 materialized views：work items/state/links、evidence/claims、decisions/approvals、external assets/derivations、classification、replica health
  - work 状态迁移、dependency 环检测、subjectVersion stale、业务审批与区块确认语义隔离
  - TaskTrajectory、TaskNode、SOP evidence/decision 仅以 adapter 接入，保持本地与 coding 隐私边界
  - _Requirement: R10, R46, R47, R48, R49, R50_

- [ ] 29. 分类与数据可用性协议
  - classification inheritance/change、restricted 拒绝共享、redaction derivative、`.chainignore`/秘密扫描的职责边界
  - participant/replica/archive、author pin、对象可用性、缺失对象与 archive checkpoint/import 验证
  - _Requirement: R11–R13, R19–R21, R40, R51, R52, R53_

- [ ] 30. 协议性质与回放测试
  - 并发创世/同主题多空间、epoch 边界、离线 quorum、双签、分区双写/不同高度后缀、时钟回退和因果排序
  - Work Item terminal/reopen、dependency 环、evidence/claim、decision/approval stale、分类继承/redaction/restricted 拒绝、缺失 blob/最后持有者/archive restore
  - _Requirement: R5, R8–R10, R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51, R52, R53_

### OC2.5 发现、同步与恢复

- [ ] 31. 空间绑定发现、邀请与恢复
  - mDNS 发布 themeId + spaceId + charter/genesis 摘要；同主题多候选选择；space-bound invitation；archive bootstrap
  - epoch 同步、待发 outbox 在空间/epoch/分类变化后的重新验证；对象 availability/pin gossip 与诊断
  - _Requirement: R4–R6, R12–R13, R41, R42, R43, R44, R45, R52, R53_

### OC3.5 通用协作 UI 与模块投影

- [ ] 32. 任务树 Work Item 与空间状态
  - 顶部空间身份/epoch/confirmed-provisional/副本健康，底部审计日志；本地与链上 Work Item 混排
  - 生命周期、dependency/blocker、soft claim、分类与 restricted 本地阻止态；不恢复恒定主题条或第八模块
  - _Requirement: R20, R32–R34, R41, R42, R43, R44, R45, R46, R47, R51, R52, R53_

- [ ] 33. 证据、来源、决策与审批表面
  - external asset/evidence 浏览、claim 评估、decision 选项与 approval 队列；账本确认与业务审批分列；subjectVersion stale 提示
  - _Requirement: R49–R50_

- [ ] 34. 七模块 adapter 与非编码场景
  - coding：task.share/ws.commit/review；非编码：研究、会议、设计、写作、采购/合规的 activity/result/evidence 生成与接续
  - 原型/UI/审查/知识库/编辑器保留既有 UI，显示 Work Item 与空间来源投影；分类阻止时提供脱敏派生路径
  - _Requirement: R14–R18, R32–R39, R46, R47, R48, R49, R50, R51, R52_

### OC4.5 加密、ACL 与长期空间治理

- [ ] 35. restricted 共享解锁与长期治理
  - 命名成员加密封装、ACL、密钥轮换、成员驱逐/恢复、法律保留、签名归档与 pruning checkpoint
  - 5/20/50 节点、分区、archive/bootstrap、长期副本与隐私回归验证
  - _Requirement: R6, R13, R19–R21, R43, R44, R45, R51, R52, R53_
