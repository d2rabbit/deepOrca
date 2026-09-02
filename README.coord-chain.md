# [next/coord-chain] AI 协调工作链（Coord Chain / 区块链工作区）开发分支

> **本文件是 `next/coord-chain` 分支专属说明**，不随主线合并；主 README 见 [README.md](./README.md)。
> 分支状态：OC1（协议库）✅ · OC2 协议核心 ✅ · OC2 组网与双节点 e2e ✅ · OC2 收尾/OC3 UI 进行中

## 这个分支在做什么

DeepOrca 的**王牌路线 OC（Orca Coord Chain）**：局域网内多台 DeepOrca 按「工作区主题」自动组成联盟链——同主题（同一项目，无论各机器路径如何）自动同链，跨主题在发现层即隔离；需求文档/设计稿/任务记录以可审计、防篡改的方式共享，任何人（的 AI）都能基于链上任务记录**接续开发**。无云、无账号服务器、无代币——"区块链"取其哈希链 + 成员签名 + 联签终局的防篡改本质。

共享层是自研的类 Git **「链工作区」**（blob/tree/commit 内容寻址对象模型，commit 锚定进区块），第一版无 merge（并行提交 = 谱系分叉保留 + LWW 择线）。

需求/设计/任务三件套（唯一事实源）：[`specs/coord-chain/`](./specs/coord-chain/) · 路线总纲：[`docs/features/coord-chain-plan.md`](./docs/features/coord-chain-plan.md)

## 分支配线（不要动主线）

| 项 | 值 |
| --- | --- |
| 基点 | `feat/modern-ui-redesign` @ `e1cadb38` |
| 远端分支 | `origin/next/coord-chain` |
| 本地 worktree | `../deepcode-cli-coord-chain`（用 `git worktree` 挂载，不影响主 checkout） |
| 合并策略 | `next/*` 线，冻结期不回灌 `dev`/`test`；只在本分支/worktree 内开发 |
| 新增依赖 | 仅 `ws` + `multicast-dns`（R22 desktop 侧限额内）；`@deeporca/ledger` 保持零运行时依赖 |

## 已交付（提交序列）

| 提交 | 分期 | 内容 |
| --- | --- | --- |
| `07b65682` | OC1 | `packages/ledger/` 协议库：Ed25519 设备身份、JCS(RFC 8785) 子集规范编码、**工作区主题解析**（git remote 归一/显式主题名 → themeId，目录名不参与跨机匹配）、12 类签名记录、quorum 区块、创世链 ID（`orca1`+base32，主题双向锚定）、从创世全量重放校验、CID 4MB 分块、链工作区对象模型（tree/commit/tree diff/谱系/LWW head）、`node:sqlite` 物化视图 —— 42 单测 |
| `8401824b` | OC2·协议核心 | ledger `net/` + `objects/`：X25519+HKDF+AES-256-GCM 加密帧（序号防重放）、Ed25519 双向挑战握手（版本协商/主题钉扎/keyId 钉扎/明文拒收）、同步消息协议、内容寻址对象库（配额 LRU）—— 含真实 TCP socket 端到端单测 |
| `c2b4a71c` | OC2·组网 | desktop `src/main/coord-chain/`：ws 传输（PeerConnection，握手后明文帧即断连）、ChainNode（建链/重放入链/轮值提议/联签终局/记录 gossip/断线对高续传/资产 manifest+分块拉取）、mDNS 发现 + 邀请码、账本落盘与 SQLite 视图接线 —— **双节点 ws 回环 e2e 全流程**（建链→入链→双向 gossip→资产逐块校验拉取→重启重连续传） |

## 代码地图

```
packages/ledger/src/
  encode/    jcs.ts（规范 JSON，fail-closed）· base32 · bytes
  identity/  设备密钥（0600 存取）、keyId、指纹
  theme/     git remote 归一 → theme 串 → themeId（R24）
  record/    签名记录（12 类，8KB 硬顶，recordId 幂等）
  block/     Merkle 根、轮值 slot、quorum（majority/twoThirds/all）、分叉裁定
  chain/     创世、orca1 链 ID、主题锚定、全量重放校验（R5，报首个不一致高度）
  cid/       4MB 分块、chunk/manifest CID、逐块校验重组（R11/R12）
  ws/        链工作区对象模型：tree/commit/diff/lineage（R27–R30）
  view/      node:sqlite 物化视图（可删重建，R10）
  net/       加密帧、握手、同步消息协议
  objects/   内容寻址对象库（2GB 默认配额 LRU，R13）

packages/desktop/src/main/coord-chain/
  paths.ts        ~/.deeporca/coordchain/<chainId>/ 数据落点（R1，测试用 DEEPORCA_COORDCHAIN_HOME 覆盖）
  transport.ts    ws 监听/出站 + PeerConnection（TEXT 握手 → BINARY 加密帧）
  chain-store.ts  账本逐块落盘、视图重建、manifest 持久化
  node.ts         ChainNode：建链/入链/提议/联签/终局/gossip/资产拉取
  discovery.ts    mDNS `_deeporca-chain._tcp.local.`（TXT: wt/cid/v/port）+ deeporca-chain:// 邀请码
```

## 怎么跑

```bash
# 需要 Node ≥ 22.5（node:sqlite / node:crypto X25519）
nvm use 22

# ledger 全量（协议 + 网络 + 对象库 + 视图）
node packages/ledger/src/tests/run-tests.mjs

# 双节点 ws 回环 e2e（加密握手 → 入链重放 → gossip → 资产拉取 → 重连续传）
node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/coord-chain-node.test.ts

# 类型检查
npm run typecheck --workspace @deeporca/ledger
npm run typecheck --workspace @deeporca/desktop   # 需先 npm run build（依赖各包 dist）
```

运行期数据全部落在 `~/.deeporca/coordchain/`（密钥/账本/blob/视图），不写项目目录；功能默认关、任何字节出机前需显式共享动作（R1/R20/R21）。

## v1 已声明的简化（后续批次补齐）

- **slot 严格绑定高度**：设计 §6 的 view-change-lite（slot 持有者超时顺延）未做——slot 主离线时终局停摆直至回归；
- **同高度分叉裁定**：`chooseForkWinner` 已在 ledger 备好但节点侧未接入（当前依赖确定性 slot + 首个终局获胜）；
- mDNS 组播路径未做自动化测试（回环组播不可靠），仅覆盖邀请码与 TXT 编解码，真实办公网发现率属 OC2-13 手测项；
- 链工作区提交流（`wsCommit/wsLog/wsDiff/wsCheckout` + `.chainignore`）属 OC3：IPC 契约（`chain:*`）、共享空间 UI、任务谱系接续开发尚未接线。

## 下一步（本分支顺序）

1. OC2 收尾：fork 裁定接入 + slot 顺延；双机真机验证（mDNS 发现率/防火墙首启）。
2. OC3：`shared/ipc.ts` `chain:*` 契约 + preload/main 接线（R23）；`wsCommit` 会话变更集直通（复用 `GitFileHistory.changedFilePaths`，R28）；共享空间 UI 三栏 + 审计子页 + i18n 六套字典。
3. OC4：blob 静态加密/ACL、撤销与密钥轮换、账本修剪。
