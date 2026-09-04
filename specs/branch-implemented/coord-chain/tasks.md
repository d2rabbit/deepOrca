# AI 协调工作链（Coord Chain）— 实施计划

> 日期：2026-08-27 · 状态：规划中（未启动）· 分期代号 OC1–OC4 与 [`docs/features/coord-chain-plan.md`](../../../docs/features/coord-chain-plan.md) 对齐 · 追溯目标：[requirements.md](./requirements.md) R1–R23
> **2026-09-03 注**：OC1–OC2 已在 `next/coord-chain` 分支实现（协议核心 + 组网同步 + 双节点 e2e，未合并主线）；本清单勾选状态未随分支同步，合并时以分支实况回写。

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

- [ ] 7. 设置与数据落点
  - 双层开关：用户级 settings `coordination` 段（总闸/设备名/配额，默认全关）+ 项目级 `.deeporca/settings.json` `coordination.shared`（每工作区独立开启，可带 themeOverride）
  - `~/.deeporca/coordchain/<chainId>/` 目录规划（device-key/ledger/blobs/view，按主题链分目录）
  - _Requirement: R1, R2, R24_

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
  - 手测：真实局域网两台 Windows/一台 macOS 的 mDNS 发现率、防火墙首启体验、同项目不同本机路径自动同链
  - _Requirement: R4, R5, R11, R12, R19, R25, R27, R29_

## OC3 共享语义与 UI

- [ ] 14. 资产与链工作区提交流
  - 「上链共享」动作（会话产物/设计稿/架构图/任意文件）：分块→manifest→`asset.publish`；共享前预览确认（链 ID/成员数/内容摘要）
  - **`wsCommit`**：选定文件/目录或会话变更集（`GitFileHistory.changedFilePaths` 直通）→ tree → commit → 分发 → `ws.commit` 记录；共享范围忽略清单（`.chainignore` + 默认规则：构建产物/密钥类文件，内容 OC3 评审）
  - `wsLog/wsDiff/wsCheckout` 三接口（谱系分页/两 commit 文件级 diff/历史检出：预览确认 + 目标目录白名单 + 路径穿越拒绝）
  - 资产列表/拉取/打开/撤销（revoke）
  - _Requirement: R11, R13, R20, R27, R28, R29_

- [ ] 15. 任务记录共享（`task.share`）
  - TaskTrajectory → trajectory 摘要压缩（工具计数/文件触及/≤50 条关键操作）；结论与遗留项编辑确认
  - **变更随行为 `ws.commit`**（taskRef 互链，见任务 14）；无变更时退化为纯记录共享
  - 「自动共享任务记录」子开关（默认关；终态后仅轨迹摘要）
  - _Requirement: R14, R16, R28_

- [ ] 16. 接续开发
  - `chain:resumeFromTask`：taskRef 指向 ws.commit 时**先检出物化或生成补丁对齐本地工作区**（预览确认 + 目录白名单），再新建本地会话注入任务上下文卡（目标/已完成/触及文件/结论/遗留/上游链 ID+recordId+commitCid）
  - 接续会话再共享时自动携带 parentRecordId 与新 ws.commit；链面板任务谱系 + 版本谱系双视图（互链跳转）
  - _Requirement: R15, R29, R31_

- [ ] 17. AI 协调动作（defineAction）
  - `chain.query`（成员/资产/任务/认领）、`chain.claim`（认领/进度/完成）；LLM 表面注册与进度接线
  - _Requirement: R17, R18_

- [ ] 18. 共享空间 UI 全量（隐喻对标腾讯文档/飞书共享文档）
  - 设置面板「协作链」段（用户级总闸 + 设备名）；项目级「开启共享」引导（解析/设定工作区主题，非 git 工作区强制显式主题名）
  - Hub「共享空间」二级浮层：顶部主题（来源与值）+ 链 ID + 成员；三栏视图（资料/任务记录流/动态）+「审计」子页（链浏览器/自检）；**资料栏含版本谱系视图**（commit 列表/diff 对比/历史检出，R29）
  - i18n 六套字典（en/zh + ja/ko/zh-tw/zh-hk）全键覆盖
  - _Requirement: R3, R20, R23, R24, R29_

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
