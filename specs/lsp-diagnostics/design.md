# LSP 诊断桥（lsp-diagnostics）· 语言服务器类型级诊断 — 技术设计

> **状态**：**设计定稿（本阶段内容，未启动）**——2026-09-04 调研定稿（上游：[`docs/research/2026-09-04-lsp-idea-feasibility.md`](../../docs/research/2026-09-04-lsp-idea-feasibility.md)）。拍板项见 §7。
> **上游提案**：用户「引入 LSP；IDEA 系实现是否可用？更干净备选亦接受」——适配判定：IDEA 系全部绑 IntelliJ Platform/JVM 不可移植；真正增量 = **类型级诊断**；形态 = **LSP→MCP 桥**，复用既有 Post-Edit 诊断环接线。
> **对应实现域**：`core/`（桥 seam + MCP 注册 + 诊断回灌扩展）与 `desktop/`（main 侧桥 tool + language server 生命周期）；**活跃 spec（本阶段内容），不属 `next-version` 规划区**。

---

## 0. 背景与结论

### 0.1 提案是什么（一句话）

给本仓的"编辑后诊断"补上**类型级**能力：把真正的语言服务器（typescript-language-server / pyright-langserver）以 **LSP→MCP 桥**形态接入——language server 经 stdio LSP 挂到一枚新的 MCP server 上，工具面（首期仅 `get_diagnostics`）进既有会话诊断环，agent 编辑后除 Serena（语法/符号级）外还能拿到 tsserver/pyright（工程/类型级）错误。

### 0.2 适配判定（TL;DR，详情见 §1）

1. **IDEA 系 LSP 不引入**：lsp4ij/lsp4intellij/intellij-lsp-server 均绑定 IntelliJ Platform（JDK 17+、PSI 深度耦合），与本仓 Electron/TS 及 ts-native 迁移路线冲突；"IDEA 的 LSP 最完整"系对 PSI 引擎与 lsp4j 的误读。可借鉴物仅 lsp4ij 的 server 管理 UX（设置面板形态），落 P2 观察项。
2. **形态 = 一枚新 MCP server，不新增内置工具**：本仓诊断闭环已是「MCP server → 会话中台 → 系统消息回灌」（Serena/SolidLSP 跑通），LSP 桥照同一接线（AGENTS.md：外部能力走 MCP，built-in 工具刻意最小）。
3. **协议层取 `vscode-languageserver-protocol`（MIT），不引全量 `vscode-languageclient`**：只取类型 + JSON-RPC + 帧协议，客户端自写薄层（~300 行），避免 VS Code 扩展模型适配噪音。
4. **进程纪律**：language server 按需拉起、回合结束强制回收、空闲超时回收（撞线内存止血 M0）；默认禁用，受信项目显式开启；fail-open 降回 Serena 现状。

## 1. 现状与证据（代码取证）

### 1.1 既有诊断环（全程 MCP 形态，可复用接线）

- `packages/core/src/actions/serena-controller.ts`：Serena（oraios/serena，SolidLSP，40+ 语言）MCP server 的 seam——`buildMcpServerConfig(root)` 返回 spawn 配置，Desktop 注入 `SerenaCliController`（uv/uvx 组装、SERENA_HOME、版本 pin）。桥沿用同一 seam 模式。
- `packages/core/src/session-manager-persistence.ts:570-593`：回合结束 `maybeRunDiagnosticsCheck`——对 `diagnosticsDirtyFiles` 逐文件调 Serena MCP `get_diagnostics_for_file`，错误级诊断注入 `⚠️ 编辑后诊断检查发现 N 个错误（<file>）：…` 系统消息（fire-and-forget）。
- `packages/core/src/session-mcp-hints.ts:26-64`：`extractErrorDiagnostics` 解析 `{severity, message, range}` 数组；同文件 hint 词典（`get_diagnostics_for_file: "（实时 LSP 诊断，全栈唯一错误检查来源）"`）——LSP 桥工具的说明词条照此登记。
- `packages/core/src/prompt.ts:387`：系统提示引导"每次代码修改后，建议用 Serena `get_diagnostics_for_file` 检查类型/语法错误"——**注意**：这句话里"类型错误"目前实际只有语法级覆盖，正是本 spec 要补的。

### 1.2 MCP 基建设施（直接复用）

- `core/src/mcp/`：mcp-manager / spawn-spec / MCP SDK 已迁移；stdio 运行时跑通 Serena / gitmcp / a2ui / activity-frames 多枚内置 server（AGENTS.md 取证）。
- desktop main tools 模式：`desktop/src/main/tools/` 同类实现先例（gitmcp/a2ui/wiki-cli），进程生命周期、根钉死、spawn 安全全有现成范式。

### 1.3 真实缺口

Serena/SolidLSP = tree-sitter 为主 + LSP 混合，语法/符号级强；**跨文件类型错误**（TS 类型不匹配、pyright 工程诊断）需要真类型引擎。SolidLSP 对 tsserver/pyright 类型级的覆盖**未实测**（V1 验证点，P0 前置）。

### 1.4 工程约束冲突面（适配点，不可照搬通用 LSP 客户端）

1. **内存纪律**：kernel-wasm 预研 M0 确立"offscreen Chromium/embedding 单例/子进程懒启动"为既定方向；tsserver 常驻 ~100-200MB、pyright ~百 MB 级——**禁止常驻**，短命进程 + 预算审计（§2.4）。
2. **分层铁律**（AGENTS.md）：桥的协议实现落 desktop main（工具层，照 gitmcp 同模），core 只留 seam 接口与既有诊断环扩展；core 无 UI 依赖、无 `console.*`。
3. **文件长度 2500 ±10%**：`session-manager-persistence.ts` 已 900+ 行——诊断环扩展若有新增逻辑落**新文件** `session-manager-diagnostics.ts`（自旧文件抽出），桥 seam 落 `actions/lsp-bridge-controller.ts`。
4. **受信边界**：language server = 任意进程 spawn + 读工作区 → 走既有 registered-root 门；未受信项目零行为（与 IPC 根钉死同语义）。
5. **记账/遥测**：LSP 无 LLM 消耗（不触 usage-ledger）；诊断耗时/条数仅 debug 日志。

## 2. 设计

### 2.1 总览与名词映射

| 通用概念   | 本仓落地形态                                                                                                                                   | 落点                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| LSP client | **桥内薄客户端**（仅协议子集：initialize / didOpen / didChange / textDocument·diagnostic / shutdown）                                          | `desktop/src/main/tools/lsp-bridge/`（新） |
| LSP server | `typescript-language-server`（MIT，首期）/ `pyright-langserver`（MIT，P1）                                                                     | 系统探测或 vendor，pin 版本                |
| MCP 工具面 | `get_diagnostics`（参数 `filePath`；返回 `{ok, diagnostics:[{severity,message,range}]}`，形状对齐 Serena，`extractErrorDiagnostics` 直接复用） | core MCP 注册 + bridge 实现                |
| 会话接线   | `maybeRunDiagnosticsCheck` 并列调用（Serena + LSP 桥，按 settings 配置）                                                                       | `session-manager-diagnostics.ts`（新）     |
| 生命周期   | 按需拉起 → 空闲回收（默认 30s）→ 回合结束强制回收；诊断结果回灌后即断                                                                          | bridge tool 内                             |
| settings   | `lspDiagnostics` 节：`enabled`（默认关）/ `servers` / `maxDiagnostics` / `idleTimeoutMs` / `trigger`（manual\|auto）                           | `core/settings.ts` + i18n 6 目录           |

### 2.2 数据流（增量路径）

```text
agent 编辑文件
  → diagnosticsDirtyFiles 记录（既有）
  → 回合结束 maybeRunDiagnosticsCheck（既有，扩展为并列两路）
       ├─ Serena get_diagnostics_for_file（既有，语法级）
       └─ LSP 桥 get_diagnostics（新，类型级；仅受信项目 + enabled 时）
  → extractErrorDiagnostics（既有，复用）
  → ⚠️ 编辑后诊断检查发现 N 个错误（<file>）：…（既有注入，两路错误合并去重）
```

诊断消息体量预算：单文件最多 `maxDiagnostics`（默认 10）条、每条截断 + 省略号；总注入 ≤ ~2KB，防止诊断噪声稀释 prompt（对齐"LLM 只见摘要"纪律）。

### 2.3 MCP 合约（bridge server）

```text
工具：get_diagnostics
入参：{ filePath: string }            // 相对受信 root 的路径或绝对路径（root 内）
出参：{ ok: boolean, error?: string,
        diagnostics?: Array<{ severity: 1|2|3|4, message: string, range: {…} }> }
行为：按扩展名路由到对应 language server → 按需 spawn（未跑则拉）→ didOpen(filePath)
      → textDocument/diagnostic（pull）或 publishDiagnostics（push 收转）→ 立即返回 → 不保活
失败：server 缺失/崩溃/超时（默认 8s）→ { ok:false, error }，会话侧忽略，不阻塞回合
```

- 语言路由表（首期）：`.ts/.tsx/.mts/.cts` → typescript-language-server（含 JS 同 server）；`.py` → pyright-langserver（P1）；无匹配 → 空诊断 `{ ok: true, diagnostics: [] }`（不报错）。
- server 解析：`DEEPORCA_LSP_*_BIN` 环境覆盖 → vendor 目录 → 系统 `npx`/`uvx` 探测；全部失败 → 工具返回 `ok:false`（fail-open，会话侧静默）。

### 2.4 生命周期与进程纪律

- 桥自身是 **stdio MCP server**（照 gitmcp 模式，desktop main 拉起，随会话生命周期）；language server 子进程由桥管理。
- 拉起策略：`trigger: manual`（默认，P0）——仅在**回合末自动检查开启时**或用户显式调用时拉起；`trigger: auto`（P1 可选）随诊断检查自动拉。
- 回收：诊断返回后桥关闭 didClose；空闲超时（默认 30s）无请求 → kill 整个进程树（Windows 用既有 `process-tree` 设施，`taskkill /T /F` 语义）；回合结束强杀。
- 预算审计：单回合内每个 server 最多服务 K 次请求（默认 20）；超限本次会话不再拉（记录 debug 日志）。内存峰值（RSS 采样）进 debug logger，供 P1 决策。

### 2.5 会话侧接线（core）

- 新文件 `session-manager-diagnostics.ts`，自 `session-manager-persistence.ts:570-593` 抽出的诊断检查逻辑迁入并扩展为「Serena 路 + LSP 路」两路并列：LSP 路仅在 ①项目受信 ②settings `lspDiagnostics.enabled` ③桥工具可用 时执行；两路错误合并去重（按 `filePath + severity + message 前缀`）。
- 桥 seam：`actions/lsp-bridge-controller.ts`（照 `serena-controller.ts` 同模：`buildMcpServerConfig(root)` / `isAvailable()`），Desktop 注入实现；core 不感知 server 细节。
- hint 词典（`session-mcp-hints.ts`）登记 `get_diagnostics`：`（类型级诊断：tsserver/pyright，需受信项目 + LSP 开启）`。
- 系统提示 `prompt.ts:387` 行在 P1 启用后改写为"Serena 查语法/符号，LSP 桥查类型错误"双行引导（i18n 无关，属模板文案）。

### 2.6 配置（`lspDiagnostics` 节，settings.ts）

```ts
lspDiagnostics: {            // 默认全关；改动经既有 settings 通道（无新增 IPC）
  enabled: false,            // 总开关（默认关，受信项目且用户开启才生效）
  trigger: "manual",         // manual | auto（P1）
  maxDiagnostics: 10,        // 单文件返回上限
  idleTimeoutMs: 30000,      // server 空闲回收
  perTurnMaxRequests: 20,    // 单回合单 server 请求预算
}
```

新增用户可见文案（设置项名/说明）进 **6 个 i18n 目录**（AGENTS.md 规则）。

### 2.7 权限与安全

- 桥 MCP server 只对**已注册受信 root** 注入（沿用 builtin MCP 注入门，与 Serena 同门）；未受信项目不 spawn 任何 language server。
- server 子进程最小环境：不注入凭据/env；cwd 限定受信 root；超时/崩溃异常全捕获——**LSP server 视为不可信计算**（只读工作区文件，不给写工具——首期工具面无写）。
- 不做：远程 LSP（tcp/websocket server）、自动安装 server（仅探测，缺啥提示用户）、诊断自动修复。

## 3. 分期

| 期                     | 内容                                                                                                                             | 门槛                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **P0（原型 + 验证）**  | 桥最小实现（仅 tsserver）+ seam + settings 节 + 手动触发 `get_diagnostics` 工具 + 单测（协议帧/路由表/回收计时/失败路径）        | V1-V5 验证点全过（§5 前置）；默认关、零行为变化 |
| **P1（落地）**         | 回合末自动并列（`session-manager-diagnostics.ts`）+ pyright + 空闲回收/请求预算 + i18n 6 目录 + 双行引导文案                     | P0 验证通过 + 预算审计数字可接受                |
| **P2（增益，观察项）** | hover/definition 只读工具（供 agent 查悬停/跳定义）、clangd/rust-analyzer 扩列、设置 UI 面板（lsp4ij 形态参考）、`trigger: auto` | 按 P1 数据决策                                  |

## 4. 验收标准

**P0 验收（最低门槛）**：

1. 受信项目 + 手动触发：对含类型错误的 `.ts` 文件返回 tsserver 类型级诊断；同文件语法错误与 Serena 输出可合并。
2. 未受信项目/`enabled:false`/server 缺失：工具不存活或返回 `ok:false`，会话零行为变化；回合照常完成。
3. 进程纪律：诊断返回后空闲超时回收生效（单测 + 冒烟）；崩溃的 language server 不拖垮会话（下次调用重新拉起或静默降级）。
4. 既有回归全绿：`npm run check` + `npm test`（含 `session.test.ts` 等既有诊断环用例不变）。
5. mutation-check：故意破坏桥的失败路径，确认降级用例真红过。

**明确不做**：LSP 成为第 9 个内置工具；常驻 language server；全量 LSP 特性（语义高亮/补全/rename）；远程 server；自动修诊断。

## 5. 风险与前置验证点（V1-V5，P0 开工前必须答）

- **V1**：实测 Serena/SolidLSP 现有诊断对 tsserver/pyright 类型级错误是否已覆盖——若已覆盖，本 spec 降级为"零增量，仅补 server 形态"，拍板重估。
- **V2**：tsserver（`typescript-language-server --stdio`）在受信项目冷启动时间与峰值内存（决定 manual/auto 与预算数字）。
- **V3**：现成 lsp-mcp 桥项目抽样评估（若 ≥1 个活跃且覆盖达标，自建桥可退化为薄壳）。
- **V4**：诊断注入体量上限（maxDiagnostics/截断）对回合 token 的实测影响。
- **V5**：Windows 路径 & 进程树清理验证（align `process-tree` 既有设施）。

## 6. 工作量估算（P0 粗估）

| 件                                            | 估算                             |
| --------------------------------------------- | -------------------------------- |
| 桥薄客户端 + MCP 工具（tsserver 单 server）   | 2–3d                             |
| seam + settings 节 + 手动触发接线             | 0.5–1d                           |
| 单测（协议帧/路由/回收/失败）× mutation check | 1d                               |
| V1-V5 验证跑测 + 决策记录                     | 1d                               |
| **P0 合计**                                   | **约 5–6d**（P1 另估，约 +3–4d） |

## 7. 拍板项（调研裁决落地）

1. **不引入 IDEA 系 LSP**（平台绑定不可移植；"最完整"系误读）；其 server 管理 UX 仅作 P2 设置面板形态参考。
2. **形态 = LSP→MCP 桥**（新 MCP server，非内置工具；协议层取 `vscode-languageserver-protocol`，客户端自研薄层，不引 `vscode-languageclient`）。
3. **首期 server 两枚**：typescript-language-server（P0）+ pyright-langserver（P1）；clangd/rust-analyzer/Kotlin LSP 观察不排期。
4. **默认全关**；受信项目 + 显式开启才生效；fail-open 无条件降回 Serena 现状。
5. **V1 是硬前置**：若 SolidLSP 已覆盖类型级，整体方案重估（降级为仅形态补全）。

## 8. V0 验证记录（2026-09-04，本机 Windows 11 / Node 23.9）

| 点                      | 结论                                                                                                                                                                                                               | 证据                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 SolidLSP 类型级覆盖  | **源码证据：基础存在、默认 TS 路径可用性未证实 → 按"未覆盖"推进 P0（fail-open 风险为零：默认关）**                                                                                                                 | 解包 vendored serena_agent-1.7.0 wheel：`solidlsp/ls.py` 有完整 publishDiagnostics/pull 基础设施（`_store_published_diagnostics` L665、`request_text_document_diagnostics` L963）；默认 TS server 为 typescript-language-server（`TYPESCRIPT_VTS` 标记 experimental，ls_config.py L328）；**实验性 vts 路径显式丢弃 TS 诊断**（`vts_language_server.py:233` → `do_nothing`）。活体 get_diagnostics 实测留待 P1 前置复验 |
| V2 tsserver 冷启动/内存 | **冷启动 initialize handshake ≈ 6.7s**（npx 解析主导；`typescript-language-server@6.0.0` 经 npx 可用）→ 印证 `trigger: manual` + 按需拉起 + 空闲回收，禁止常驻                                                     | 本机 `npx -y typescript-language-server --stdio` + LSP initialize 握手计时探针                                                                                                                                                                                                                                                                                                                                          |
| V3 现成 lsp-mcp 桥      | ≥1 个活跃（[isaacphi/mcp-language-server](https://github.com/isaacphi/mcp-language-server)，Go，覆盖达标），**但其二进制 vendor 依赖 GitHub Releases 下载（本网络不可达）→ 维持自建 TS 薄桥原案**，Go 桥作 P2 备选 | Web 抽样（2026-09-04）                                                                                                                                                                                                                                                                                                                                                                                                  |
| V4 诊断注入体量         | maxDiagnostics=10 ×（消息截断 + range）≈ ≤2KB/文件 → 设计预算成立                                                                                                                                                  | 算术核验                                                                                                                                                                                                                                                                                                                                                                                                                |
| V5 Windows 进程树清理   | 通过：`core/common/process-tree.ts`（taskkill /T /F）既有单测绿；桥内独立实现同语义（kill /T + POSIX 组杀），协议帧/路由/回收/失败路径有单测                                                                       | `npm test` 套件 + 新增 `lsp-bridge.test.ts`                                                                                                                                                                                                                                                                                                                                                                             |

**V0 裁决**：P0 按原设计推进。补充偏差记录：协议层未引入 `vscode-languageserver-protocol`——桥只需帧协议 + 6 个方法，手写 ~60 行零依赖实现，符合供应链最小面原则（设计 §0.2-3 的意图即"避免依赖噪音"，此实现更进一步）。V1 活体实测列为 **P1 硬前置**。

---

## 附：与相邻线的边界

- **vs Serena**：Serena = 语法/符号级实时操作（find/replace 等，不动）；LSP 桥只补诊断子集，不重复其符号能力。
- **vs CodeGraph/CRG/OpenWiki**：图谱快照与文档编译线不动；LSP 桥仅服务于「编辑后错误检查」一条时点链路。
- **vs A2UI/designer**：无关。
- **vs 桌宠**：无关（桌宠不做小游戏边界不受影响）。
