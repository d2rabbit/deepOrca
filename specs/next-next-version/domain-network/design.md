# 域网链路协作（domain-network）· 技术设计

> **状态**：**概念/方案稿（只出方案，不改代码）** · **日期**：2026-09-14 · 分支 `feat/modern-ui-redesign` · **next-next 规划区支柱四**。
> **上游纲领**：[`docs/features/next-next-version-plan.md`](../../../docs/features/next-next-version-plan.md)（§2 网络域 · §3 依赖图）。
> **用户定调**：**协作链正是升级成域网链路协作。**本 spec 是该升级的实现面。
> **上游权威**：协作链现状以 [`specs/coord-chain/design.md`](../../coord-chain/design.md)（v7）为准，底层实现快照见 [`specs/branch-implemented/coord-chain/design.md`](../../branch-implemented/coord-chain/design.md)（`next/coord-chain` 分支，**当前分支零运行时代码**）。
> **命名考古**：该功能对外名历史即为**「域网链」**，在 `a73cd7814`（全站重设计）中被统一改称"协作链"（站点 section 由 `#domnet` → `#coordchain`，文案仍写"同一局域网内"）。本 spec 是把"域网"从命名史**恢复为协议概念**——且是在**现有 spec 之外的首次概念化**。

---

## §0 执行摘要

协作链当前的**全部硬前提**是局域网：

| # | 既有假设 | 证据 |
| --- | --- | --- |
| A1 | 单层广播域（L2 组播 mDNS 发现） | `coord-chain/design.md:154` |
| A2 | 节点地址直连可达（邀请码携带 `host:port`） | `design.md:155` |
| A3 | **数据不出局域网**（relay 期前） | `design.md:18`、`requirements.md:30` |
| A4 | 扁平全互联 mesh ≤50 节点，无中继/无分层 | `design.md:55,347,352` |
| A5 | 一主题一链、**跨主题发现层隔离**（v7 已松绑为"主题仅发现候选 + spaceId 定边界"，但多空间并存/选择未实现） | `design.md:154`、`requirements.md:97` |
| A6 | 加入 = 从创世**全量重放** | `design.md:148` |
| A7 | 信任 = 局域网 + 成员私钥保管（事后可审计，非 BFT） | branch `implementation.md:186` |
| A8 | 端到端直连会话，无 store-and-forward（节点离线即不可达） | `transport.ts` PeerConnection |
| A9 | 单一平铺命名空间（themeId → chainId） | `design.md:100` |

**关键结论：离"域网级链路协作"的距离不是参数调优，而是三个缺失的地基层。** 相反，**"链路"层面地基扎实且网络无关**——身份（Ed25519/keyId/轮换+硬件锚点）、编码（JCS fail-closed）、记录/区块/重放、CID 分块对象层、类 Git 链工作区（tree/commit/diff/checkout）、加密帧与握手——**协议面不需要改，改的是它脚下的网络与可用性假设**。

三支柱：**① 广域发现与寻址 ② store-and-forward 可用性 ③ 跨域信任与治理**（③ 复用 coord-chain v7 已设计未实现的 `space.charter`/epoch/replica 全套，本 spec 只补实现路径，不重定义语义）。

## §1 域网络模型（space 即网络域）

纲领 §2 的**网络域投影**：

```
域（Domain）  ──本地投影──►  工作域（workspace root）· 窗口域
              ──网络投影──►  space（跨设备的同一协作边界）
```

- **space** 语义以 coord-chain v7 `space.charter`（`design.md:375-505`）为**唯一权威**——本 spec 不重定义 spaceId/章程/成员 epoch/classification。
- 本 spec 的贡献：让 space **跨网段可达且不要求成员同时在线**（今天 A3/A4/A8 直接禁止这两件事）。
- **域边界即安全边界**（纲领红线 8）：space 成员边界 = 能力可用边界；链路加密范围随跨域扩展重新定义（A3 的"数据不出局域网"须显式修订为"数据不出 space"，并如实告知用户——这是**隐私语义的降级，必须显式**，不得默认静默）。

## §2 支柱一：广域发现与寻址

### 2.1 发现层分层（补 A1/A2/A9）

今天只有 mDNS（`_deeporca-chain._tcp.local.`）+ 静态邀请码。目标：**发现是分层的，mDNS 只是最内层**：

| 层 | 机制 | 适用 | 状态 |
| --- | --- | --- | --- |
| L0 同广播域 | mDNS/DNS-SD（**保留**，零成本路径） | 同一局域网 | ✅ 已实现（`discovery.ts`） |
| L1 跨网段单播 | DNS-SD unicast / 配置化 rendezvous 列表 | 企业网、多 VLAN | 新增 |
| L2 绑定节点（rendezvous） | 轻量目录服务：登记 `spaceId → 可达端点` | 无组播环境、跨地域 | 新增 |
| L3 邀请码（保留） | `deeporca-chain://` 深链，携带**多个候选端点** | 兜底 | ✅ 已有，需扩展为端点列表 |

**关键修订**：邀请码从 `host:port` 单点扩展为**候选端点列表**（含中继端点）；发现结果统一产出 `CandidateEndpoint[]`，由连接层按序尝试（LAN 直连 → 公网直连 → 中继）。这与 next-version 主线 C（远程访问）的"三档入口自动选择"**同构**——**建议两会话对表，复用同一套端点选择逻辑**。

### 2.2 寻址与穿透

- **NAT 穿透**：先做中继（可靠、可审计），打洞（WebRTC/STUN）列为后续可选（与主线 C 的 M4 同源）。
- **中继不是中心**：中继只转发加密帧，**不持密钥、不解密、不存储明文**——链路加密（AES-256-GCM 帧）保持端到端，中继是"看不见内容的邮局"。这是跨域信任的底线，必须写进威胁模型。
- **身份不变**：Ed25519 keyId 仍是唯一身份，跨网段不引入第二套身份（避免 A9 命名空间分裂）。

## §3 支柱二：store-and-forward 可用性（补 A4/A8）

今天 mesh 假设**成员基本随时在线**——节点离线即不可达，无复本、无离线队列。域网络必然跨时区/跨在线状态，必须补：

| 机制 | 内容 | 复用 |
| --- | --- | --- |
| **复本节点（replica）** | 指定节点持有 space 的完整复本（账本 + 对象），新成员/断线节点可从复本同步而非创世重放 | coord-chain v7 `replica/archive` 设计（未实现）；**同时解 A6 的全量重放带宽问题** |
| **快照/检查点** | 复本提供 checkpoint，替代"从高度 0 全量重放"（开放问题 7） | v7 已列，本 spec 补实现路径 |
| **离线队列（store-and-forward）** | 目标节点离线时，消息进入转发队列（中继或复本代持），上线后投递 | **新增**——今天 `transport.ts` 是纯端到端直连 |
| **outbox 持久化** | 本地待发消息持久化（重启不丢） | coord-chain §11 已设计（`design.md:240-313`，未实现） |
| **成员离线容忍** | 出块与终局不要求全员在线（quorum 语义已有，但需明确离线成员不阻塞推进） | 共识层已有 quorum，需端到端验证 |

**红线**：store-and-forward **不得**改变账本语义（消息顺序、幂等键、记录签名一律沿用）；中继/复本代持期间消息仍为加密态，代持方无法读取内容。

## §4 支柱三：跨域信任与治理（补 A5/A7）

域网络意味着**半可信/陌生节点**，威胁模型必须重估。**语义全部复用 coord-chain v7，本 spec 只划实现路径**：

| 语义 | v7 设计位置 | 本 spec 的实现路径 |
| --- | --- | --- |
| `space.charter` / spaceId | `design.md:375-505` | 作为网络域身份与治理载体，先在**单 space 多网段**场景验证 |
| 成员 epoch / validator-set hash | `hardening.md:8,14-24` | 跨域成员集合变化必须显式换 epoch（防跨轮次重放） |
| 确认语义 `observed → provisional → confirmed` | `design.md:369-373` | 跨域高延迟下 provisional 窗口会显著变长，需 UI 如实呈现 |
| `classification`（数据分级） | `design.md:375-505` | **隐私降级闸门**：只有明确标记为可跨域的数据才出域（A3 修订的机械保障） |
| `replica` / `archive` | `design.md:375-505` | 与支柱二共用（复本既是可用性机制也是治理角色） |
| 双签证据 / 跨轮次锁 / round/view-change | `hardening.md` | **前置**：OC1.5–OC4.5 工作包（`tasks.md:171-224`）——跨域前必须先补安全边界证明 |

**硬前置声明**：v7 协议（epoch / confirmed / classification / replica）**全部未实现**，且 `hardening.md` 指出连 `confirmed` 的安全边界都尚未证明。因此本支柱的启动条件是：**coord-chain 的 OC1.5–OC4.5 安全加固完成**。跨域是"把已证明的协议放到更敌对的网络里"，不能拿安全未证明的协议直接跨域。

## §5 分期

| 批次 | 内容 | 前置 |
| --- | --- | --- |
| **N5.0** | 隐私边界修订：A3 从"数据不出局域网"改为"数据不出 space"（**显式用户可见的语义变更**）+ classification 闸门设计 | 无（纯设计） |
| **N5.1** | 发现分层 L1/L2 + 邀请码候选端点列表 + `CandidateEndpoint[]` 统一端点选择（**与主线 C 对表复用**） | coord-chain 协议核心（已实现于 `next/coord-chain`） |
| **N5.2** | 中继（透明转发加密帧，不持密钥）+ outbox 持久化 + 离线队列 | N5.1 |
| **N5.3** | 复本节点 + 快照/检查点（解 A6 全量重放） | N5.2；v7 replica 语义 |
| **N5.4** | 跨域治理：space charter / epoch / confirmed 呈现 / classification 机械闸门 | **coord-chain OC1.5–OC4.5 加固完成**（硬前置） |
| **N5.5** | NAT 打洞（可选，与主线 C M4 同源） | N5.2 |

## §6 风险与对策

| 风险 | 对策 |
| --- | --- |
| **安全前置未满足就跨域**（最重风险） | N5.4 硬前置 OC1.5–OC4.5；在加固完成前，跨域仅限 N5.1–N5.3（发现/中继/复本，**不放开陌生节点准入**） |
| 隐私语义静默降级（数据出局域网） | N5.0 显式修订 + classification 机械闸门 + 用户可见提示；不得默认出域 |
| 中继成为中心化单点与信任焦点 | 中继只转发密文、不持密钥；多中继可选；space 可声明"禁用中继"（纯直连域） |
| 跨域延迟使 provisional 窗口过长，用户体验退化 | UI 如实呈现确认态（observed/provisional/confirmed）；高延迟域显式标注 |
| 与主线 C（远程访问）重复造端点选择/隧道 | **对表复用**：C 的隧道可作域网络的一条传输实现；端点选择逻辑共用 |
| 复本节点存储膨胀 | 复本为**显式角色**（非默认全员）；配额沿用 2GB LRU 先例；archive 可离线 |
| 全量重放带宽（A6）拖慢新成员加入 | N5.3 快照/检查点；在此之前新成员加入限同网段 |
| 与 coord-chain 现有非目标冲突 | 本 spec **显式修订**非目标"跨网段/公网组链"（`requirements.md:30`）——记为语义变更，须经评审；其余非目标（公链/代币/字符级协同/三向合并/跨主题聚合）**维持不变** |

## §7 明确不做

不做公链 / 代币 / 跨互联网无边界广播（域网络止于**域的组织边界**，非公网广播）；不做多人字符级协同编辑；不做三向合并；不做账本修剪；不做 blob 静态加密的重新设计（沿用 coord-chain OC4 规划）；**不重定义 space / epoch / confirmed / classification 语义**（v7 唯一权威）；不改链路协议本身（身份/编码/记录/区块/CID/链工作区/加密帧全部复用）；不引入第二套身份体系。
