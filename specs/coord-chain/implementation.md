# Coord Chain 底层私有链方案 — 实现说明

> 日期：2026-09-04 · 状态：与代码基线一致（OC1 全量 + OC2 组网 + 任务树桥接）·
> 本文件回答「**我们底层的私有链是怎么做的**」：协议栈分层、终局机制、重放校验、传输安全与诚实边界。
> 设计依据：[design.md](./design.md) §3–§7 · 需求追溯：[requirements.md](./requirements.md) R1–R31
> 代码位置：协议全部在 `packages/ledger/src/`（零运行时依赖，纯 Node 可测）；节点生命周期在
> `packages/desktop/src/main/coord-chain/`；54 个协议单测 + 双节点 ws 回环 e2e 覆盖正负例。

## 1. 定位与威胁模型

**联盟式许可链（consortium / permissioned chain），不是公链**。威胁模型是“**事后可审计**”：
小团队（5–50 节点）局域网内，任何成员随时可以从创世块独立验证全部历史；篡改、伪造、夹带
都会被全量重放当场戳穿。

- **无** PoW / PoS / 代币 / 挖矿 / 智能合约 / 跨互联网广播——那些对局域网可信团队是纯开销。
- **“区块链”取其本质**：哈希链 + 成员签名 + 联签终局 + 从创世可重放。对外叙事统一为
  “防篡改审计”，不提币（`docs/features/coord-chain-plan.md` 风险项）。
- **不主张**匿名抗拜占庭（BFT）。默认准入 `open`：信任边界 = 局域网 + 成员私钥保管。
  威胁是“内部人篡改痕迹、落地可究”，不是“匿名对手方多数作恶”。

## 2. 协议栈总览

```
┌─ 链工作区层 ws/      blob(4MB分块) → manifest → tree(路径→blob清单) → commit(签名)
│                      commit 镜像为 ws.commit 记录上链锚定（taskRef/commitRef 互链）
├─ 区块与终局层 block/  哈希链 + Merkle 根 + 轮值提议人 + quorum 联签终局
├─ 记录层 record/       12 类签名记录（≤8KB），recordId = 内容寻址 → 幂等去重
├─ 编码层 encode/       JCS(RFC 8785 子集) 规范 JSON —— 签名/哈希打在逐字节确定的规范字节上
├─ 身份层 identity/     Ed25519 设备密钥，keyId 推导，member.join 自包含注册表
└─ 链/重放层 chain/     创世 + orca1 链 ID（主题锚定）+ 从创世全量重放校验（R5）
```

（`net/` 传输层、`objects/` 内容寻址对象库、`view/` SQLite 物化视图见 §6/§4/§7。）

## 3. 分层详解

### 3.1 身份层（L0，`identity/` + `record/` 的 member.join/rotate）

**身份对象是设备，不是人。** 我们不做任何用户字段（无账号/邮箱/实名）；追溯粒度与
加密货币一致——设备密钥即身份锚，链上成员即设备。

- **硬件绑定锚点**（`identity/anchor.ts` + `identity/hardware-binding.ts`）：每台设备
  一个 `IdentityAnchor`（v3，0600 存 `identity-anchor.json`）——`anchorId` 由创生钥
  派生且永不变；`machineBinding.seal` 在创建时把**机器指纹哈希**（macOS
  IOPlatformUUID / Windows MachineGuid / Linux machine-id，原始串绝不落盘）签名进锚点。
  启动时 `checkAnchorBinding` 重算当前机指纹：不匹配 = **未绑定副本**——只可读，拒绝
  签名/出块/进链（fail-closed）。v1 为指纹弱绑定（防复制/云同步迁移），Secure
  Enclave/TPM 强绑定（私钥不出安全芯片）为 OC4 路线。
- **密钥轮换不走"身份搬家"**：`rotateAnchorKey` 在同一硬件上换钥，`rotations` 是
  自证签名链（每步旧钥签新钥，`verifyRotationChain` 链外可验）；链上对应
  `member.rotate { oldKeyId, newPubKey }` 记录——成员条目连续迁移（pubKey 时间线），
  历史用当时的钥、新记录用新钥，全重放自然验证。换硬件 = 新锚点入链（配合 invite 准入），
  旧设备历史链上永留。
- **注册表自包含**：`member.join { deviceName, pubKey }` 记录体携带公钥且作者键必须与
  公钥绑定（`keyIdFromPublicKeyBase64(body.pubKey) === record.author` 才有效）。因此
  重放链时不需要任何外部信任源，就能重建完整成员公钥表。
- 准入策略在创世参数：`open`（默认，局域网即团队）/ `invite`（须创世成员签名邀请码，
  用锚点当前钥签发）；`member.leave` 撤销后续准入，历史签名永久保留（不可抵赖）。
- **批准的双表语义**：轮值/批准按「块前成员表 ∪ 块后成员表」验签（轮换者用旧钥批自己
  离场前的块）；**quorum 基数 = 块后成员数**（旧钥只验签、不占席）。

### 3.2 编码层（`encode/`）

- **JCS（RFC 8785）子集**：对象键按 UTF-16 码序排序、无空白、字符串最小转义、数字用
  ES6 最短往返形式（`1e21` 形态保留）；拒绝 NaN/Infinity/孤代理。
- `parseCanonicalJson` **fail-closed**：输入必须能原样往返（重复键、`1.0`、乱序键、
  空白一律拒绝）——凡被要求“应是规范字节”的输入，不规范的直接拒。
- 签名/哈希全部打在规范字节（UTF-8）上：两台机器对同一记录产出**逐字节相同**的待签数据，
  这是跨机验证成立的前提。

### 3.3 记录层（前 L3，`record/`）

- 12 类记录：`member.join/leave`、`asset.publish/update/revoke`、`ws.commit`、
  `task.share/claim/progress/done`、`session.offer`、`note`。链上只有元数据，单条硬顶
  **8KB**（`MAX_RECORD_BYTES`）；文件本体永不进区块。
- 作者 Ed25519 签名覆盖 `{type, ts, author, parentRecordId?, body}` 的规范字节
  （absent 的 parentRecordId 整体不进载荷，保证规范字节稳定）。
- `recordId = "r:" + SHA-256(规范字节) 前 12 字节的 hex`（24 hex）——**内容寻址**：
  gossip 重复投递、重放、分叉回流全部按 id 幂等去重（R9），账本天然无重复状态。

### 3.4 区块与终局层（`block/` + `chain/`）

```jsonc
// 区块（终局后可落盘 <height>-<hash16>.json，账本=唯一事实源）
{ "height": 5, "prevBlockHash": "<hex>", "ts": 1807286400000, "proposer": "did:…",
  "merkleRoot": "<hex>", "records": [ … ] }
```

- **blockHash 只覆盖头部**（height/prevBlockHash/ts/proposer/merkleRoot 的规范 JSON 的
  SHA-256）——记录体由 Merkle 根承诺，所以批准签名小而快、验证无需重传记录体。
- **Merkle 根**：对每条 recordId 取 SHA-256，逐层两两合并，奇数补末位。
- **轮值提议人**（“共识”的全部）：`proposer = 活动成员按 keyId 排序[height % 人数]`，
  任何节点可从自身成员表独立推导；height 0 是成员引导块，由**创世者**提议
  （此时成员表还为空）。v1 无 view-change：slot 主离线则终局暂停直至回归（见 §8）。
- **联签终局**：提议人打包广播 `blockProposal` → 每个成员独立验证（前链哈希、Merkle、
  逐条记录签名 + FIFO 成员资格模拟、ts 单调）→ 对 blockHashDigest 签名回 `approval`
  → 收满 **quorum** 即终局。quorum 按创世参数：多数派 `⌊n/2⌋+1` / 三分之二
  `max(2, ⌈2n/3⌉)` / 全员；批准表按**块后成员集**（块内 join 可当场参批）。
- **主题锚定与链 ID**：链由工作区主题派生而非人工命名——`genesis` 内写死主题串 +
  32B 随机盐；`chainId = "orca1" + base32(SHA-256(JCS(genesis)))[:20]`（RFC 4648 小写
  无填充）。入链时双向核对创世主题串 == 本机主题串 && 重算 themeId 一致（R26），防
  近似主题误入他链。一机多工作区 = 多链并存，各自独立账本/对象库/视图/成员表。
- **分叉裁定**（函数已备，`chooseForkWinner`）：同高度竞争块按「有效批准数多者胜 →
  提议人成员序小者胜 → 块哈希小者胜」，落败侧记录按 recordId 幂等回流。节点 v1 用
  确定性 slot 避免产生竞争块（见 §8）。

### 3.5 重放层（`chain/replay.ts`，R5 之锚）

新成员（或任何离线恢复者）入链 = 拉全量区块流，**从创世逐块重放**：

```
对每块依次验证：height 连续 → prevBlockHash 链接 → 提议人=slot 主（0 号块=创世者）
  → 记录数 ≤ maxBlockRecords → ts 单调 → 每条记录：作者是活动成员 & 签名有效
    （member.join：公钥绑定 + 用体内公钥验，验过即入表）→ recordId 未重复
  → Merkle 根吻合 → 每块 quorum 个有效批准（用块后成员集公钥逐个验签）
任一不符 → 拒绝加入并报【首个不一致高度】+ 原因。
```

成员、记录、视图全部由此**无外部信任重建**——账本双通道与对象库双通道都可独立重放校验。

## 4. 一条记录的生命周期（闭环示例）

```
A 提交 task.share
 → 规范字节 → Ed25519 签名 → recordId → 本地 pending + 加密 gossip（成员即时见“未封存”）
 → slot 主下一 tick（默认 2s）打包 blockProposal 广播
 → 各成员独立验证 → 对 blockHash 回 approval（广播给全员，人人可独立促成终局）
 → quorum 集齐 → 终局：区块 JSON 落盘 + SQLite 物化视图推进 + 终局块广播
 → B 离线回来：chainInfo 对高 → getChain 增量补拉 → 逐块验证 → 视图就地重建
```

## 5. 链工作区（自研类 Git 层，`ws/` + `cid/` + `objects/`）

- **blob**：文件 4MB 分块，`chunkId = "b:" + SHA-256(chunk) 前 12 字节`，收块先验哈希再
  落盘；对象库配额（默认 2GB）LRU 逐出——**账本是唯一事实源，blob 可再取**。
- **manifest**：分块清单 + 总尺寸，自身内容寻址（`manifestCid`）——同内容只存/传一份。
- **tree**：`{version, entries: 路径→{blob, mode}}`，与 core `GitFileHistory` 的 manifest
  同构（会话变更集直通）；路径安全校验（拒绝对路径/`..`/空段）。
- **commit**：`{treeCid, parents[], message, author, ts, taskRef?, sig}`，作者签名；
  镜像为 `ws.commit` 记录上链锚定。**任务谱系（parentRecordId）× 版本谱系（parents）
  在同一点分叉**，`taskRef`/`commitRef` 互链（见 collaboration-flows.md §3）。
- v1 **无 merge**：并行提交保留为谱系分叉，视图 head 按 (ts, commitId) LWW、可手动择线。

## 6. 传输安全（`net/` + `transport.ts`）

- **发现**：mDNS `_deeporca-chain._tcp.local.`，TXT 带 `wt`(themeId 前 8)/`cid`/`v`/`port`；
  **发现即按主题匹配**——跨主题实例不握手、不可见（R25）；组播被禁时用
  `deeporca-chain://host:port/<themeId>` 邀请码（携带主题，收方核对）。
- **握手**（ws 连接上，一帧一协议单元）：hello(版本协商) → challenge(32B nonce +
  临时 X25519 公钥) → response(回显 nonce + 临时钥 + **Ed25519 transcript 签名**) →
  done(对端 transcript 签名)；任一方可 `bye{reason}` 干净中止。主题钉扎/keyId 钉扎
  在握手内完成（防误连/冒名，防御纵深）。
- **加密帧**：握手成功后同一 socket 切二进制帧，每帧 =
  `seq(u32BE) ‖ nonce(12B) ‖ AES-256-GCM(ciphertext‖tag)`，AAD = seq 字节；密钥来自
  **X25519 临时 ECDH + HKDF-SHA256**（盐 = 双方临时公钥排序拼接，64B 输出劈成双向钥）。
  seq 强制严格递增 → 篡改/重放/乱序/明文帧一律断连（明文直接 terminate）。

## 7. 存储形态

```
~/.deeporca/coordchain/
  device-key.json                      设备私钥库（0600；轮换时随之更新）
  identity-anchor.json                 硬件封印锚点（anchorId/轮换链/机器指纹 seal）
  <chainId>/genesis.json               链身份（主题+链参数+盐）——重启恢复的根
  <chainId>/ledger/blocks/<h>-<hash16>.json   账本（唯一事实源，逐块追加）
  <chainId>/objects/chunks/<hex2>/…   内容寻址分块（可丢弃，LRU）
  <chainId>/objects/manifests/*.json   发布过的 manifest（供 getManifest 回执）
  <chainId>/view.db                    SQLite 物化视图（可删重建，R10）
```

节点重启（`tryResumeChain`）：扫描 dataRoot 下 theme 匹配的 genesis.json → 加载区块全量重放 → 恢复同一链；轮换后的密钥经 device-key.json + 锚点 keys 一致性校验后继续签名。
任何时间 `rebuildView(blocks)` 都能从账本全量重建视图（已实现 + 等价性单测）。

## 8. 与经典区块链对照

| 概念      | 公链         | 本方案                                        |
| --------- | ------------ | --------------------------------------------- |
| 出块权    | PoW/PoS 竞争 | 轮值提议（height % 成员数，确定性可推导）     |
| 终局      | 概率性确认   | 成员联签 quorum（多数派默认，可配 2/3/全员）  |
| 防篡改    | 全网算力     | 哈希链 + 成员签名 + 联签 + 任意节点全量重放   |
| 身份      | 匿名地址     | Ed25519 设备钥 + 链上自包含注册表             |
| 代币/合约 | 有           | 无（明确非目标）                              |
| 链上数据  | 任意         | 仅 ≤8KB 元数据；文件走内容寻址 blob 层        |
| 分叉      | 最长链收敛   | 确定性 slot 防分叉；备用：批准数→提议人序裁定 |
| 信任假设  | 无需信任     | 局域网 + 成员私钥保管（事后可审计）           |

## 9. v1 已声明的边界（后续批次）

1. **无 view-change**：slot 主离线，终局停摆直至回归（design §6 的顺延机制 OC4）。
2. **分叉裁定未接线**：`chooseForkWinner` 已备于 ledger，节点侧依赖确定性 slot +
   首个终局获胜；同高度竞争块的裁定与回流未端到端联测。
3. 准入默认 `open`；`invite` 策略、撤销后的彻底拒连（member.expel）OC4 完整化。
4. blob 静态加密与细粒度 ACL（工作组口令 → HKDF）、账本修剪/快照截断均为 OC4。
5. 风险评估与表决：密码学主张以 OC1 单测（篡改/伪签/quorum 不足/重放负例 ×N）为证据，
   正式评审建议在 OC2 双机真机验证前做一次（design §4 排期）。
6. **mDNS 可自动化性评估（2026-09-04 探针实证）**：本机回环（lo）不转发 mDNS 组播，
   8s 内无响应——发现层协议解析与匹配已全部纯逻辑单测封测（TXT 解析/主题+版本隔离/
   邀请码），真实局域网发现成功率属双机手测项（OC2-13），不构成自动测试缺口。
