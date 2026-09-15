# 域网链路协作（domain-network）— 任务清单

> 对应设计：[design.md](./design.md)。2026-09-14 立稿，概念/方案稿（未开工）。
> 上游纲领：[docs/features/next-next-version-plan.md](../../../docs/features/next-next-version-plan.md) §2（网络域）/§3。
> 上游权威：协作链 v7 设计 [`specs/coord-chain/design.md`](../../coord-chain/design.md)；实现快照 [`specs/branch-implemented/coord-chain/design.md`](../../branch-implemented/coord-chain/design.md)（`next/coord-chain` 分支，当前分支零运行时代码）。
> 红线：**不重定义 space/epoch/confirmed/classification 语义**（v7 唯一权威）；不改链路协议本身（身份/编码/记录/区块/CID/链工作区/加密帧全复用）；中继**只转发密文不持密钥**；数据出域须经 classification 机械闸门 + 用户可见（禁静默降级）；**N5.4 硬前置 = coord-chain OC1.5–OC4.5 安全加固完成**（加固前不放开陌生节点准入）；与主线 C 端点选择/隧道**对表复用**。

## N5.0 隐私边界修订（纯设计）

- [ ] **N5.0.1** 修订 A3：从"数据不出局域网"改为"**数据不出 space**"——记为**显式语义变更**，须经评审（涉 `coord-chain/design.md:18`、`requirements.md:30` 非目标）
- [ ] **N5.0.2** classification 闸门设计：只有明确标记可跨域的数据才出域；默认不出域
- [ ] **N5.0.3** 用户可见提示设计：跨域激活时如实告知隐私边界变化（不得默认静默开启）

## N5.1 广域发现与寻址（前置：coord-chain 协议核心，已实现于 `next/coord-chain`）

- [ ] **N5.1.1** 发现分层：L0 mDNS 保留（零成本路径）+ L1 DNS-SD 单播 + L2 rendezvous 绑定节点目录（`spaceId → 可达端点`）
- [ ] **N5.1.2** 邀请码扩展：`deeporca-chain://` 从 `host:port` 单点 → **候选端点列表**（含中继端点）
- [ ] **N5.1.3** 统一 `CandidateEndpoint[]` + 端点选择逻辑（LAN 直连 → 公网直连 → 中继）——**与主线 C 远程访问对表复用同一逻辑**
- [ ] **N5.1.4** 测试：无组播环境下经 L1/L2 成功发现；端点降级顺序真值表；跨网段建链 e2e

## N5.2 中继与 store-and-forward

- [ ] **N5.2.1** 中继（透明转发 AES-256-GCM 加密帧；**不持密钥、不解密、不存明文**）+ 多中继可选 + space 可声明"禁用中继"（纯直连域）
- [ ] **N5.2.2** outbox 持久化（本地待发消息落盘，重启不丢）——承接 coord-chain §11 已设计未实现项（`design.md:240-313`）
- [ ] **N5.2.3** 离线队列：目标节点离线 → 消息由中继/复本代持 → 上线后投递（**加密态代持**）
- [ ] **N5.2.4** 账本语义不变式测试：消息顺序 / 幂等键 / 记录签名在代持投递路径下不受影响
- [ ] **N5.2.5** 威胁模型补充：中继的信任假设与不变量（无密钥、无法读取、可被观测元数据）

## N5.3 复本与快照（解 A6 全量重放）

- [ ] **N5.3.1** 复本节点角色（**显式指定，非默认全员**）：持有 space 完整复本（账本 + 对象）
- [ ] **N5.3.2** 快照 / 检查点：新成员与断线节点经 checkpoint 同步，替代从高度 0 全量重放（coord-chain 开放问题 7）
- [ ] **N5.3.3** 配额与归档：复本存储配额（沿用 2GB LRU 先例）；archive 可离线
- [ ] **N5.3.4** 验收：新成员加入时间随复本可用显著下降；快照同步后账本与全量重放等价（哈希对拍）

## N5.4 跨域信任与治理（**硬前置：coord-chain OC1.5–OC4.5 安全加固完成**）

- [ ] **N5.4.0** 前置门禁：确认 OC1.5–OC4.5 完成（含 `confirmed` 安全边界证明）；未满足则**不启动本批**
- [ ] **N5.4.1** space charter / spaceId 作为网络域身份与治理载体（**单 space 多网段**场景先行验证）
- [ ] **N5.4.2** 成员 epoch / validator-set hash：跨域成员集合变化显式换 epoch（防跨轮次重放）
- [ ] **N5.4.3** 确认语义呈现：observed → provisional → confirmed 在高延迟域如实展示；高延迟域显式标注
- [ ] **N5.4.4** classification 机械闸门接线（N5.0 设计落地）：出域数据必须过闸门
- [ ] **N5.4.5** 双签证据 / 跨轮次锁 / round/view-change 接线（承接 hardening 工作包）
- [ ] **N5.4.6** 跨域准入收口：加固完成后才放开陌生节点准入；准入策略（open/invite）与撤销（expel）端到端验证

## N5.5 NAT 打洞（可选，与主线 C M4 同源）

- [ ] **N5.5.1** WebRTC/STUN 打洞评估（与主线 C M4 合并评估，不自建第二套）
- [ ] **N5.5.2** 打洞失败回退中继路径（N5.2 已就绪）
