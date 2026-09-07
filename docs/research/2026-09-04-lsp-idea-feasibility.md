# 预研：引入 LSP——IDEA 系实现是否可用？干净备选路线

日期：2026-09-04 · 分支：`feat/modern-ui-redesign` · 性质：预研（无代码变更）

## 问题重述

用户提议：若本仓要引入 LSP（Language Server Protocol），使用 IntelliJ IDEA 系
的 LSP 实现是否可行（听闻其"最完整"）；若有更干净/更轻的备选，一并给出。

**一句话结论**：IDEA 系的"LSP 最完整"是误读——IDEA 的完整性在自家 PSI 语言引擎，
通用 LSP 客户端是第三方补齐（Red Hat lsp4ij 等），全部绑定 IntelliJ Platform
（JDK 17+）不可移植，对本仓**直接使用不可行**；但存在更干净且更贴合本仓架构的
路线——**LSP→MCP 桥**（把 language server 包成本仓既有 MCP server 形态），因为
本仓早已有 Serena（SolidLSP）MCP 诊断环，唯一真实缺口是**类型级诊断**。

## 命题映射

| 模块线 | 仓库 | 在本线中的角色 |
| --- | --- | --- |
| 代码智能线（Serena / CodeGraph / CRG / OpenWiki） | JetBrains 系 LSP（lsp4ij / lsp4intellij / intellij-lsp-server / Kotlin LSP）+ Eclipse lsp4j | 候选评估：IDEA 系实现的形态、许可、可移植性 | 
| 同上 | VS Code 官方 LSP npm 栈（vscode-languageserver-node） | 干净备选：协议层 vs 全量客户端的取用边界 |
| 同上 | lsp-mcp 类桥项目 + OpenCode 实践 | 与本仓既有 MCP 接线模式的对位与先例 |

调研材料：`redhat-developer/lsp4ij` README 全文（zread 一手核证，EPL-2.0、IDEA
2024.2+、JDK 17+、LSP+DAP）；web 检索（intellij-lsp-server、lsp4intellij、Kotlin
LSP 2025、OpenCode LSP 集成、lsp-mcp 生态）；本仓侧代码走读取证：
`packages/core/src/actions/serena-controller.ts`（Serena/SolidLSP 40+ 语言）、
`packages/core/src/session-manager-persistence.ts`（Post-Edit 诊断环）、
`packages/core/src/session-mcp-hints.ts`（`extractErrorDiagnostics`）、
`packages/core/src/prompt.ts:387`（系统提示引导）、AGENTS.md（MCP 路线与 vendor/
内存纪律）。

## TL;DR

| 选项 | 本质 | 许可 | 可行性 | 结论 |
| --- | --- | --- | --- | --- |
| **lsp4ij**（Red Hat） | IntelliJ 系最完整的开源 LSP+DAP 客户端（ALL IDEA 变体、用户自定义 server、LSP Console、trace/错误分级） | EPL-2.0 | ❌ IntelliJ Platform 插件（IDEA 2024.2+、JDK 17+、PSI 深度集成） | 不可移植；仅 UX/架构形态可借鉴 |
| **lsp4intellij**（Ballerina） | 同上代的插件级客户端库 | EPL/社区 | ❌ 同平台绑定 | 不用 |
| **intellij-lsp-server**（Ruin0x11） | 把 IDEA 能力经 LSP 曝给 Emacs 的 server（"用 IDEA 当 LSP server"字面解） | MIT | ❌ 2018 年个人项目、依赖完整 IDEA 实例 | 不用 |
| **JetBrains Kotlin LSP**（官方，2025） | JetBrains 首个官方 LSP server（Kotlin） | 官方 | ⚠️ 仅 Kotlin；server 端是 LSP 可移植侧 | 狭窄；若将来要 Kotlin 支持可单独评估 |
| **vscode-languageserver-node**（官方 npm） | 微软官方 TS 实现：协议类型 + JSON-RPC + 帧协议 + 全量 `vscode-languageclient` | MIT | ✅ 与 Electron/TS 同栈 | 协议层可取；全量客户端偏重、面向 VS Code 扩展模型 |
| **LSP→MCP 桥**（lsp-mcp 类 + 自建） | 把任意 language server（stdio）包成 MCP server，工具面 = 诊断/悬停/定义 | MIT 系 | ✅✅ 与本仓"外部能力走 MCP"路线完全同构 | **推荐主路线** |
| **零依赖窄客户端**（自研） | JSON-RPC 2.0 + Content-Length 帧 ~80 行 + 本地类型覆盖所需子集 | — | ✅ 最轻、最可控 | 若只做"编辑后类型诊断"一个场景，够用 |

**关键对位（本仓现状）**：Post-Edit 诊断反馈环**已落地**——任务回合结束后对每个
mutated 文件调 Serena MCP `get_diagnostics_for_file`（SolidLSP，40+ 语言），错误级
诊断经 `extractErrorDiagnostics` 注入系统消息供 agent 修复（
`session-manager-persistence.ts:570-593`、`session-mcp-hints.ts:26-42`）。因此
"引入 LSP"对本仓不是从零建地基，而是**升级/增补诊断来源**：从 Serena（tree-sitter
为主 + LSP 混合，语法级强）增补**类型级诊断**（tsserver/pyright 才能给的
跨文件类型错误）。这也是全部后续判断的出发点。

---

# Part I "IDEA 的 LSP"到底是什么

## 1.1 先把误解拆开

- **IDEA 的完整性在 PSI 语言引擎，不在 LSP**。IntelliJ IDEA 各语言支持走自家
  PSI（Program Structure Interface）插件体系；LSP 在 JetBrains 世界是补充通道——
  官方直到 2025 年才发布首个 LSP server（Kotlin LSP，把 Kotlin 支持带到 VS Code
  等外部 IDE），通用 LSP **客户端**则由社区/厂商补齐（Red Hat lsp4ij 是当代事实
  标准）。"IDEA 的 LSP 最完整"若指客户端，是 lsp4ij 的完整（LSP+DAP 双协议、全部
  IDEA 变体、用户自定义 server 定义、LSP Console 追踪、错误上报分级）；若指协议
  实现完整度，那是 Eclipse **lsp4j**（Java 协议库全集，EPL-2.0，驱动 Eclipse/
  Theia/che）的名声。两者都是 JVM 产物。
- **LSP 协议本身无"IDEA 独有完整性"**：协议本体是微软维护的开放规范，任何实现
  等价；可移植性差异只存在于客户端载体与服务器实现质量。

## 1.2 四个候选物逐一核证（zread + 检索）

| 候选物 | 形态 | 许可/依赖 | 对本仓可移植性 |
| --- | --- | --- | --- |
| lsp4ij（redhat-developer/lsp4ij） | IntelliJ Platform 插件：LSP+DAP 客户端；扩展点 + 用户自定义 server；LSP Console/偏好页 | EPL-2.0；IDEA 2024.2+、JDK 17+；使用者包括 Quarkus/Haskell/Clojure/Pyright 等 ~24 个官方生态插件 | ❌ 与 IntelliJ 平台 SDK/PSI 深度耦合，无法脱离 IDE 发行 |
| lsp4intellij（ballerina-platform） | 插件开发用 LSP 客户端库（前代） | 社区许可、平台绑定 | ❌ 同左，已基本被 lsp4ij 取代 |
| intellij-lsp-server（Ruin0x11） | **IDEA 当 LSP server**：把 IDEA 的 PSI 能力经 LSP 曝给 Emacs | MIT；2018；需完整 IDEA 实例常驻 | ❌ 个人项目已陈旧；"借 IDEA 引擎"的成本 = 常驻整个 IDE |
| JetBrains Kotlin LSP | 官方 LSP **server**（仅 Kotlin，2025 发布） | JetBrains 官方 | ⚠️ server 是协议的可移植侧，理论上任何客户端可接；但仅 Kotlin，与本仓 TS/Python 主线无关 |

**可借鉴但非可搬的形态**（若未来桌面侧有"语言服务"面板）：lsp4ij 的用户自定义
server 定义页、LSP Console（请求/响应/通知追踪）、错误上报三级策略（忽略/通知/
日志）——是"多 server 生命周期管理 UX"的现成参照。

# Part II 本仓现状与真实缺口

## 2.1 已有：Serena（SolidLSP）MCP 诊断环（一手取证）

- `serena-controller.ts` 注释原文：Serena（oraios/serena）提供 IDE 级符号语义操作
  （find symbol / references / rename / replace symbol body），**基于 SolidLSP
  （40+ 语言）**；`buildMcpServerConfig` 返回 MCP server spawn 配置，Desktop 注入
  `SerenaCliController`（uv/uvx 组装、SERENA_HOME、版本 pin）。
- `session-manager-persistence.ts:570-593`：回合结束后 `maybeRunDiagnosticsCheck`
  对 `diagnosticsDirtyFiles` 逐个调 `get_diagnostics_for_file`，错误级诊断注入
  `⚠️ 编辑后诊断检查发现 N 个错误：…` 系统消息（fire-and-forget）。
- `session-mcp-hints.ts:26-64`：`extractErrorDiagnostics` 解析 severity/message/
  range；MCP hint 词典标注该工具为"（实时 LSP 诊断，全栈唯一错误检查来源）"。
- `prompt.ts:387`：系统提示显式建议修改后调 `get_diagnostics_for_file`。

结论：本仓的诊断闭环 = **MCP server（stdio）→ 会话中台 → 系统消息回灌**，已跑通、
已 pin、已有降级路径。任何"引入 LSP"都必须**复用这条接线**，而不是另起炉灶引一个
客户端库再重新接一遍。

## 2.2 缺口：类型级诊断

Serena/SolidLSP 的强项是语法/符号级（tree-sitter 解析 40+ 语言的跨文件符号），
编辑后检查能抓语法错与明显结构错；**跨文件类型错误**（TS 类型不匹配、Python
类型标注/未导入符号、tsconfig 工程级错误）依赖真正的类型引擎（tsserver / pyright
/ clangd / rust-analyzer）。SolidLSP 虽混合了 LSP 状态机，但其内置诊断对
tsserver/pyright 类型级的覆盖**需实测核证**（本文不武断下结论，标记为立项前验证
点 V1）。若覆盖不足，引入真 LSP 的净增量即成立。

## 2.3 约束纪律（必须遵守，来自既有裁决）

- **外部能力走 MCP**（AGENTS.md）："do not add new built-in tools lightly"——LSP
  不该变成第 9 个内置工具，应作为 MCP server 加入既有运行时（`core/src/mcp/`）。
- **内存止血纪律**（2026-08-19 kernel-wasm 预研 M0）：offscreen Chromium/embedding
  单例/子进程懒启动是既定方向；LSP server（tsserver ~100-200MB 常驻、pyright
  ~百 MB 级）若常驻，直接撞这条红线 → **按需拉起、空闲回收、一次会话内短命**。
- **受信边界**（AGENTS.md IPC 根钉死）：language server = 任意进程 spawn + 读工作区
  文件 → 必须走既有 registered-root 门 + 默认禁用 + 受信项目显式开启。
- **fail-open**（与 routing/embedding 同姿态）：server 缺失/崩溃 → 诊断环降级回
  Serena 现状，绝不阻塞回合。
- **core UI-free**：客户端协议逻辑只进 `core/src/common/lsp/`（或桥进 MCP server），
  进程管理在 desktop main，与既有 seam 模式一致。

# Part III 可选路线对比与推荐

## 3.1 路线表

| 路线 | 形态 | 增量成本 | 优点 | 缺点 |
| --- | --- | --- | --- | --- |
| **A. LSP→MCP 桥**（推荐） | desktop main 起一个 LSP-MCP server（自建 ~300-500 行桥：stdio LSP 客户端 ↔ stdio MCP server），或接入现成 lsp-mcp 类项目；工具面：`get_diagnostics`（核心）+ 可选 `hover/definition/references` | 中低：桥一层 + 每个 language server 一份 spawn 配置（复用 systemPrompt 既有工具说明与 session-mcp-hints 词典） | 与本仓诊断环**零改造接线**（替换/并列 Serena 工具即可）；权限/发现/生命周期全走既有 MCP 设施；会话中台无需新增 IPC | 代理层心智损耗；桥自身的进程/缓冲区要处理 |
| **B. vscode-languageclient 全量客户端** | core 引 `vscode-languageclient`，desktop main 管理 server 进程 | 中：依赖链（vscode-jsonrpc 等）+ 适配非 VS Code 宿主 | 功能全（多 server、自动重启、inlay、语义令牌） | 偏离"外部能力走 MCP"路线；客户端模型面向 VS Code 扩展，适配噪音大；依赖体量进入 main 进程 |
| **C. 只取协议层自研窄客户端** | 仅 `vscode-languageserver-protocol`（类型 + JSON-RPC + 帧帧），自写 ~300 行客户端，服务本仓内部直接调用，不经 MCP | 低 | 最轻、类型齐全、MIT 干净 | 绕开 MCP 接线 → 需要新的进程管理/seam（等于再造半个 MCP）；对"只做诊断"场景其实够用 |
| **D. 什么都不引** | 依赖 Serena 现有诊断，不升级 | 零 | 零风险 | 抓不到类型级错误 |

**推荐**：A 为主（若 lsp-mcp 生态成熟度不够则自建桥，参考 gitmcp/a2ui 的既有
tool 落地模式）；C 作 A 的内部实现选项（桥内的 LSP 客户端就用协议层自研，不必引
全量 client）。B 不选。D 是默认回退。

## 3.2 server 选型表（干净优先、按许可/体积/Windows 友好度）

| 语言 | server | 实现栈 | 许可 | 备注 |
| --- | --- | --- | --- | --- |
| TypeScript/JS | `typescript-language-server` | Node（TypeScript 官方 tsserver 包装） | MIT | 最标准；`--stdio`；工程类型诊断强 |
| Python | `pyright-langserver` | Node（pyright 引擎） | MIT（微软系） | 类型级最强；runs 于 Node 22 |
| C/C++ | clangd | C++ | Apache-2.0 | LLVM 官方；Windows 有官方构建 |
| Rust | rust-analyzer | Rust | MIT/Apache-2.0 | 重、索引大——观察项 |
| Go | gopls | Go | BSD-3 | 官方 |
| Kotlin | JetBrains Kotlin LSP | JVM | 官方 | 仅当 Kotlin 成为支持目标 |

选型原则：与"干净"标准对齐（MIT/Apache/BSD 优先）、Node 系优先（与 Electron 同
生态、免额外运行时）、体积与内存进预算审计；首期只做 TS + Python。

## 3.3 立项前验证点（若决定推进，先答五个问题）

- V1：SolidLSP/Serena 现有诊断对 tsserver/pyright 类型级是否已覆盖（可能零增量）。
- V2：tsserver/pyright 在受信项目上的冷启动时间与峰值内存（决定"按需拉起"的
  可承受度）。
- V3：lsp-mcp 现成桥（精选 1-2 个活跃项目）的协议覆盖与稳定性。
- V4：诊断结果回灌的系统消息体量预算（避免诊断噪声稀释 prompt——对齐 token
  纪律"LLM 只见摘要"）。
- V5：Windows 路径与进程树清理（对齐 process-tree 既有设施）。

# 结论

1. **直接用 IDEA 系 LSP：不可行**——lsp4ij/lsp4intellij/intellij-lsp-server 全部
   绑定 IntelliJ Platform/JVM（数百 MB 运行时、PSI 深度耦合），与本仓
   Electron/TS 技术栈及 ts-native 迁移路线（`specs/ts-native-migration`）直接
   冲突；"IDEA 的 LSP 最完整"是对 PSI 引擎与 lsp4j 的误读。其价值仅在 UX 形态
   参考（多 server 管理与 LSP Console/错误分级）。
2. **干净备选成立且更贴合本仓**：本仓诊断环已是"MCP server → 会话中台 → 消息
   回灌"闭环（Serena/SolidLSP），引入 LSP 的正确姿势是**增补一个 LSP→MCP 桥
   （或协议层窄客户端包成的 MCP server）**，进既有 `core/src/mcp/` 运行时，首期
   TS（typescript-language-server）+ Python（pyright-langserver）两枚 server，
   按需拉起、空闲回收、受信 root 门、fail-open 降回 Serena。
3. 按惯例：本文 ⬜ 纯调研留档，不立项、不动代码；若推进，以 `specs/` 立项，
   先过 §3.3 五个验证点。