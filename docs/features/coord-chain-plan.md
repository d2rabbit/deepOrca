# 王牌路线：AI 协调工作链（Coord Chain）专属规划

> 日期：2026-08-27 · 状态：**规划中（专属路线，优先级高于 [`next-version-plan.md`](./next-version-plan.md) 的 A–D 主线）**
> 来源：用户方向确立（2026-08-27）：「内置区块链的 AI 协调工作链」为与其他 coding agent 的核心区分点，与 next-version 并列双王牌。
> 依据口径：现状以 [`feature-roadmap.md`](./feature-roadmap.md) §0 为准；实现以 [`specs/coord-chain/`](../../specs/coord-chain/design.md) 为准；调研 [`2026-08-27-coord-chain-technology-survey.md`](../research/2026-08-27-coord-chain-technology-survey.md)。

## 0. 定位与优先级声明

- **双王牌**：next-version（自进化引擎 · Studio 基座 · 远程访问 · 知识编译）+ **本路线 OC（Orca Coord Chain，AI 协调工作链）**。OC 是产品差异化的外向旗帜，next-version 是能力纵深——两者共同构成下一大版本的对外叙事。
- **优先级裁决**：资源（人力/评审带宽/发布窗口）冲突时，**OC 优先于 next-version 的 A–D 主线**；next-version 各主线的启动顺序在其文档基础上整体后移一位。例外：OC 不挤占当前版本预生产收尾（F4/H），那是两条路线共同的前置。
- **启动条件**：与 next-version 相同——预生产切换（H）完成、`next/*` 冻结解除后启动；OC0（设计评审）可在冻结期内完成（纯文档，先例：doc-wiki spec 2026-08-19 立于冻结期）。
- **命名**：产品名「AI 协调工作链 / 工作链」；spec 目录 `specs/coord-chain/`；新包 `@deeporca/ledger`；链 ID 前缀 `orca1`。

## 1. 愿景与差异化

一句话：**局域网内多台 DeepOrca 按「工作区主题」自动组成联盟链，需求文档/设计稿/架构图/任务记录以可审计方式共享，任何人（的 AI）都能基于链上任务记录接续开发——无云、无账号服务器、防篡改。共享层是自研的类 Git「链工作区」：commit 谱系、diff、历史版本检出，但没有中心仓库服务器。**

产品体验定位（2026-08-27 需求确立）：**「腾讯文档/飞书共享文档」的放大版**——像共享文档一样"打开就有、成员可见、随手共享"，但共享的粒度是整个项目的工作记录而非单篇文档，且**共享只认工作区主题**：同主题（同一项目，无论各机器路径如何）自动同链，跨主题互相不可见。

与竞品的区分（调研 §1）：

| 维度 | 竞品（Claude Code / Cursor / Copilot Workspace 等） | DeepOrca OC |
| --- | --- | --- |
| 多人协作载体 | 云端账号 + Git 仓库 | 局域网内置联盟链，无云 |
| 共享粒度 | 仓库/工单（人工归置） | **工作区主题**：同项目自动同链，跨主题发现层隔离 |
| 版本化协作 | Git 仓库 + 中心托管（GitHub/GitLab） | **链工作区**：自研类 Git 对象模型（blob/tree/commit，CID 寻址 + 记录锚定），谱系/diff/历史检出，无中心服务器 |
| 协作痕迹 | 分散在 IM/工单/commit message | 链上记录：签名、联签、可本地审计、不可篡改 |
| 任务记录复用 | 基本不存在 | task.share → 接续开发 → parentRecordId 任务谱系 |
| AI 参与协作 | 被动（人协调 AI） | AI 可查链/认领任务（defineAction 表面），声明性防撞车 |
| 数据边界 | 出企业网络 | 数据不出局域网 |

诚实边界（对外叙事亦如此表述）：这是**联盟式许可链**（哈希链 + 成员签名 + 联签终局），不是公链——无币、无挖矿；"区块链"取其防篡改与可审计的本质。链上只有元数据，文件走内容寻址层。

## 2. 里程碑总览

| 分期 | 内容 | 体量 | 优先级 |
| --- | --- | --- | --- |
| **OC0 设计冻结** | 本路线文档 + spec 三件套评审定稿；与主线 C 的 ws/Ed25519 地基共享协调会（一次） | 小（文档期可完成） | P0 |
| **OC1 协议库** | `packages/ledger/`：身份/JCS/**工作区主题解析（git remote/显式名 → themeId）**/记录/区块/联签/链ID（主题锚定）/重放校验/CID/**链工作区对象模型（tree/commit/tree diff）**/SQLite 视图 + 单测（纯离线） | 中 | P0 |
| **OC2 组网同步** | mDNS 发现 + ws 加密传输 + gossip + 对象/blob have/want 分块分发 + IPC 接线 + 双机端到端（含 commit→检出 round-trip 与跨主题隔离负例） | 中大 | P0 |
| **OC3 语义与 UI** | 资产共享/**链工作区提交流（wsCommit/wsLog/wsDiff/wsCheckout + `.chainignore`）**/任务记录上链（变更随行 ws.commit）/接续开发（版本对齐 + 任务谱系互链）/AI 协调动作/Hub 共享空间面板/六套 i18n | 中大 | P0 |
| **OC4 深化加固** | blob 静态加密 + ACL、撤销与密钥轮换、账本快照修剪、规模压测、文档 | 中 | P1 |

- OC1–OC3 构成 MVP（可用即差异化成立）；OC4 是安全与规模化收尾。
- 任务明细与需求追溯见 [`specs/coord-chain/tasks.md`](../../specs/coord-chain/tasks.md)（22 项，R1–R31）。

## 3. 与 next-version 四主线的接口

| 主线 | 关系 | 处置 |
| --- | --- | --- |
| C 远程访问（M1/M2） | 同源地基：`ws` 依赖、Ed25519 设备身份、加密握手 | **OC0 协调会定归属**：公共件放哪边、谁先落地谁抽取；OC 不依赖 C 的 relay，OC2 在局域网内自洽 |
| A 自进化引擎（E1/E2） | 下游消费：链上任务谱系是天然的执行语料（跨设备轨迹） | E1 埋点不动；后续版本可将链上任务纳入评估语料池（另行设计） |
| B Studio 基座（B1/B2） | 承载关系：`chain.query/claim` 以 defineAction 注册，B1 动态化后免费获益 | OC3 起步用静态注册（同 D1 的 `docwiki.*` 先例） |
| D 知识编译（doc-wiki） | 上游供给：共享的需求文档/架构图可进 doc-wiki 摄取管线 | 远期联动，本期不耦合 |

冲突面检查：OC 改动集中在 `packages/ledger/`（新）、`packages/desktop/src/main/coord-chain/`（新）、`shared/ipc.ts`（追加 `chain:*` 段）、设置面板与 Hub（追加段/浮层）——与 B1（core/modules + desktop main）、A-E1（core session）无文件冲突；`shared/ipc.ts` 与 C-M1 的 dispatch 抽取同文件，OC0 协调会对齐一次即可。

底子复用（既有代码，非 next-version 主线）：链工作区的"manifest→tree→commit"管线与"会话改了什么"变更集，直接沿用 `GitFileHistory`（`packages/core/src/common/file-history.ts:29`，会话 checkpoint/undo 在用）的形态与产出；CID/blob 层与账本哈希链为本路线 OC1 自建。

## 4. 资源与排期建议

- 核心投入 1–2 人（OC1 一人即可并行于 B1 的另一人；OC2 起建议专人）；评审带宽：密码学/协议设计需一次正式评审（防篡改主张必须经得起推敲）。
- 顺序硬依赖：OC1 → OC2 → OC3 → OC4；OC2 的手测（真实局域网发现率）越早安排越好——它是最大不确定性来源。
- 与当前版本的关系：不碰预生产收尾（F4/H）；冻结期内仅完成 OC0。

## 5. 风险与观察项

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 企业网禁组播，mDNS 失效 | 中 | 邀请码兜底已进 MVP 范围（R4）；OC2 真实办公网验证成功率 |
| "区块链"叙事被误解为炒币 | 中 | 文档与对外表述统一为"联盟式许可链/防篡改审计"，不提代币 |
| 隐私事故（误共享） | 高 | 默认关 + 逐次显式 + 预览确认 + 轨迹不含对话原文（R1/R14/R16/R20） |
| 主题误匹配/误隔离（fork 各异、非 git 工作区无 remote） | 中 | 面板明示主题来源与值 + 可覆盖；加入时主题锚定核对（R24/R26）；非 git 工作区强制显式主题名引导 |
| 协议设计缺陷（分叉/重放边角） | 中 | OC1 单测穷举 + OC0 正式评审；账本可全量重放，升级期可校验自愈 |
| Hypercore 路线后悔成本 | 低 | 对象/blob 层接口化（`objects.ts` 内部可替换；Hyperdrive 是版本化文件系统的同构先例，一并评估，见设计 §13） |

## 6. 启动顺序

1. **冻结期内（现在）**：OC0——spec 三件套 + 本文档评审定稿；与主线 C 地基协调会；`docs/spec-open-items-status.md` 台账登记本路线条目。
2. **H 预生产切换完成后**：开 `next/coord-chain`（或并入统一 next 集成分支的 OC 线），OC1 协议库先行——纯离线、零依赖、可单测，不受任何网络环境制约。
3. OC1 后半程并行准备 OC2 的双机测试环境（真实局域网 + Windows/macOS 各一）。
4. OC2 端到端打通即内部 dogfood（本团队自己的需求文档与任务记录先上链），OC3 完成后对外可演示——差异化叙事成立的最小闭环。
