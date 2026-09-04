# Coord Chain 双机/实机验收清单

> 日期：2026-09-04 · 状态：**单机实机部分已执行（本会话）；双机局域网部分待双机环境执行**
> 适用对象：`next/coord-chain` 分支交付的共享工作区（Coord Chain）功能。

## A. 单机 Electron 实机验收（✅ 已执行，2026-09-04）

**环境**：macOS 本机；`electron . --remote-debugging-port=9222` 实跑真实主进程+渲染进程；
经 CDP `Runtime.evaluate` 直接在真实渲染进程调用 `window.deeporca.chain*`（真实 IPC 全链路）。

| #   | 验收动作                                                                                                              | 结果 |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---- |
| A1  | 渲染进程 `window.deeporca.chain*` 8 方法存在（start/stop/getState/rotateKey/members/blocks/genealogy/onStateChanged） | ✅   |
| A2  | `chainGetState` 空闲态返回默认值                                                                                      | ✅   |
| A3  | `chainStart({mode:'create'})` 建链；`chainGetState` running/chainId `orca1…`/anchorBound/height 0                     | ✅   |
| A4  | `chainMembers` 返回本设备条目（current=true, joinedHeight 0）                                                         | ✅   |
| A5  | `chainBlocks` 返回 block 0 真实哈希/提议人/记录数/**审批人列表**                                                      | ✅   |
| A6  | `chainRotateKey` → newKeyId；等封块后成员条目迁移到新钥、anchorId 不变、height+1                                      | ✅   |
| A7  | `chainStop` → 状态干净复位                                                                                            | ✅   |

**本次实机暴露并修复的缺陷**（重要收获）：

1. `registerCoordChainIpc` 只有 import 无调用（早期注入静默失配）→ 真实渲染报
   `No handler registered for 'chain:getState'` —— 已修复 + 重建（此前 typecheck/测试无法覆盖该接线点）。
2. `tryResumeChain` 把 `device-key.json` 文件当链目录扫描 → `ENOTDIR` 且失败后节点半启动泄漏 ——
   已修复（仅目录参与扫描）+ 失败路径清理半启动 + 回归测试。
3. 实机流程本身就是一次端到端验收：IPC → preload → 主进程 service → 锚点/链节点 → SQLite 视图。

**可重复脚本**：`scripts/electron-chain-e2e.mjs <ws-url> <shot.png>`（CDP 驱动，配合
`--remote-debugging-port=9222` 启动）。

## B. 视觉走查（Electron 实跑 + 像素级判读，已执行）

**方法**：Electron 实跑窗口 → CDP 真实点击（Hub orb → 「工作链」）→ `Page.captureScreenshot`
真实像素 → MiniMax 视觉模型两轮判读（评审-修复-复检闭环）。

**第一轮判读**（发现了问题即修复）：

- ✅ 面板四段（状态卡/成员/区块含审批人/谱系）文本正确、深色主题、无乱码
- ⚠️ 成员与区块的设备标识截断长度不一致（16 vs 12）→ **已修**：统一 `keyIdShort`
  （`did:xxxx…xxxx`）并在列表项加 `title` 悬停完整标识 → **复检一致**（`did:427b51…ad87`）
- ⚠️ `1 rec` 英文混排 → **已修**：i18n 六套 `chain.pane.records`（`{n} 条记录` 等）→ 复检 `1 条记录`
- ✅ 链 ID 完整（`orca1…` 24 字符，判读器曾疑截断——**误解校正**：`orca1` 前缀与 base32 是链 ID 设计规范，非缺陷）

**第二轮判读（复检）**：核心缺陷清零；剩余视觉精修项（面板底部留白、按钮宽度比、
主 UI 顶栏元素在小窗口溢出、撤销按钮 5+1 排布等）均属**主 UI 既有设计或 P2 级精修**，
不阻断本分支功能验收，列入后续打磨（不影响 coord-chain 交付判定）。

## B1. 视觉走查结论（由替代证据覆盖的部分保留）

- 共享空间面板（CoordChainPane）DOM 渲染：jsdom + api stub 测试全绿（状态卡/成员/区块/谱系中文文案）。
- renderer 实捆：esbuild 产物含 CoordChainPane/chainGetState。
- 本机限制：模型无视觉通道 + 系统截图权限未授权 → 像素级人工走查留双机/桌面环境；DOM 级渲染与
  真实 IPC 数据流均已实机验证（A 表）。

## C. 双机局域网验收清单（待双机环境执行）

**前置**：两台设备（建议 Windows + macOS 各一，覆盖防火墙首启体验）；各自 checkout `next/coord-chain`
并 `desktop:build`；同一局域网、允许 UDP 5353 组播。

| #   | 步骤                                                          | 通过标准                                                                               |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| C1  | 设备 1 开共享（git remote 主题）；设备 2 同项目路径不同开共享 | 2 号在 ≤30s 内自动发现入链，双方成员列表互见（**mDNS 发现率**，连测 5 轮，记录成功率） |
| C2  | 设备 1 发布资产/提交任务记录；设备 2 拉取/查谱系              | 记录联签终局后 2 号可见；资产逐块校验拉取成功                                          |
| C3  | 设备 1 轮换设备钥                                             | 2 号成员表迁移到新钥；1 号新钥续签出块                                                 |
| C4  | 跨主题负例：改主题名后两台重启                                | 互不可见、零握手（R25）                                                                |
| C5  | 防火墙首启（Windows）：首次组播被拦的体验                     | 面板自检给出可读指引；邀请码 `deeporca-chain://` 兜底可入链                            |
| C6  | 断线重连：拔网线 30s 恢复                                     | 按 (height, hash) 对齐续传，无分叉最终一致                                             |
| C7  | 面板走查（Electron 实跑）：Hub → 工作链视图                   | 状态卡/成员/区块/谱系正确、开始/停止/轮换按钮可用                                      |

> 说明：本会话环回探针（两次，默认与显式 loopback/reuseAddr）均确认 macOS 本机组播不可达
> （lo 不转发 mDNS 组播）——C 表项目无法在单机自动验证，属真实双机环境动作；协议层可自动部分
> （TXT 解析/主题+版本隔离/邀请码/完整链流程）已全部单测与 Electron 实机闭环。
