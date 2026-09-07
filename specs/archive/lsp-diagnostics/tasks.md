# LSP 诊断桥（lsp-diagnostics）— 任务指引（规划中）

> 日期：2026-09-04 建立 · 状态：**设计定稿（P0 未开工，本阶段内容，不属 `next-version` 规划区）**
> 阶段模型：**预研 → 设计 → 任务**，三层在当前树内可查：
>
> | 层   | 文档                                                                                                         | 现状                                 |
> | ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
> | 预研 | [`docs/research/2026-09-04-lsp-idea-feasibility.md`](../../docs/research/2026-09-04-lsp-idea-feasibility.md) | ✅ 定稿（IDEA 系不引入；MCP 桥形态） |
> | 设计 | [`design.md`](./design.md)（§2 架构 / §3 分期 / §7 拍板项）                                                  | ✅ 定稿                              |
> | 任务 | **本文件**                                                                                                   | ⏳ 待开工                            |

## 预研结论摘要

IDEA 系 LSP（lsp4ij/lsp4intellij/intellij-lsp-server）全绑 IntelliJ Platform/JVM，直接使用不可行；干净路线 = **LSP→MCP 桥**：一枚新 MCP server（协议层取 `vscode-languageserver-protocol`，客户端自研薄层），工具面仅 `get_diagnostics`（类型级），复用既有 Post-Edit 诊断环接线（`session-manager-persistence.ts:570` 同款），server 按需拉起/空闲回收/fail-open。首期 TS（typescript-language-server）+ P1 Python（pyright-langserver）。

## 任务清单（自 design.md 分期抽离）

- [x] **V0** 五个验证点实测（V1：SolidLSP 类型级覆盖；V2：tsserver 冷启动/峰值内存；V3：lsp-mcp 生态抽样；V4：诊断注入体量；V5：Windows 进程树清理）— 产出决策记录，**P0 硬前置**（1d）→ 结论已回写 design.md §8（2026-09-04）：P0 按原案推进，V1 活体实测转 P1 硬前置
- [x] **P0-1** `lsp-bridge-controller.ts` seam（照 `serena-controller.ts` 同模：`buildMcpServerConfig`/`isAvailable`）— `core/actions/`（0.5d）
- [x] **P0-2** 桥薄客户端 + stdio MCP server：协议帧（initialize/didOpen/didChange/diagnostic/shutdown）+ `get_diagnostics` 工具 + 语言路由表（`.ts/.tsx/…` → typescript-language-server）— `desktop/src/main/tools/lsp-bridge/`（2-3d）_协议帧手写零依赖（design §8 偏差记录），未引 `vscode-languageserver-protocol`_
- [x] **P0-3** server 探测链（环境覆盖 → vendor → npx）与进程生命周期（按需拉起/空闲回收 30s/回合强杀/Windows 进程树）— 桥内（1d）
- [x] **P0-4** `lspDiagnostics` settings 节（enabled 默认关/trigger/maxDiagnostics/idleTimeoutMs/perTurnMaxRequests）— `core/settings.ts`（0.5d）
- [x] **P0-5** 受信门接线：仅注册 root + enabled 时工具存活；手动触发路径跑通 — core seam + desktop 注入（0.5d）
- [x] **P0-6** 单测：协议帧序列化/路由表/回收计时/失败路径（server 崩溃→`ok:false` 降级）+ 每用例 mutation-check — `src/tests/`（1d）_desktop `lsp-bridge.test.ts` 8/8（路由/URI/根钉死/帧拆分重装/垃圾重同步）+ core `lsp-bridge-seam.test.ts` 3/3_
- [x] **P0-7** 既有回归全绿（`npm run check` + `npm test`）；V0 决策记录回写 design.md 状态行 — （0.5d）

**P0 合计约 5–6d。** P1（回合末自动并列 `session-manager-diagnostics.ts` + pyright + i18n 6 目录 + 双行引导文案）与 P2（hover/definition、扩列、设置 UI）另估，见 design.md §3。

## P1 任务清单（2026-09-04 用户拍板扩列 + 继续开发）

- [x] **P1-1** 回合末自动并列：诊断检查自 `session-manager-persistence.ts` 抽出至新层 `core/src/session-manager-diagnostics.ts`（Mcp 层之上），Serena 路 + LSP 桥路并列；两路错误按行去重合并、2KB 预算截断后注入单条系统消息；`trigger: "auto"` 才进回合末路径（默认 manual 保持 P0 行为）
- [x] **P1-2** pyright：`pyright-langserver`（npm pin `pyright@1.1.413`）纳入路由表
- [x] **P1-3** 语言扩列（用户拍板，自 P2 提前）：rust-analyzer / gopls / clangd / csharp-ls+omnisharp / jdtls / kotlin-language-server / sourcekit-lsp / dart language-server —— 全部按「探测不安装」纪律，缺失降级为带安装提示的软错误
- [x] **P1-4** 桥内进程池按语言分槽（每语言独立空闲回收 + 请求预算）；severity 字符串化对齐 Serena 形状
- [x] **P1-5** 双行引导文案：`prompt.ts` 编辑后验证节改为「Serena 查语法/符号 + lsp-bridge 查类型错误」双行（列明支持语言）
- [x] **P1-6** 回归全绿：`npm run check` + `npm test` + `desktop:build` 全过；desktop `lsp-bridge.test.ts` 9/9（十语言路由断言）、core `session-manager-diagnostics.test.ts` 4/4（合并/去重/分文件/截断）
- 备注：settings 设置 UI 仍在 P2（本轮无新增用户可见文案，i18n 无需变更）；`DEEPORCA_LSP_*_BIN` 环境覆盖按扫描器「spawn 首参须字面量」策略暂缓（PATH 安装 / 全局 npm 覆盖等效），记录于 design.md §8

**P1 状态：已落地（同日完成），随 P0 同分支提交。**

## 开工前置条件

- 本阶段排期确认后即开工（活跃 spec，无 next-version 流转步骤）。
- **V0 五个验证点全过**（尤其 V1：SolidLSP 若已覆盖类型级 → 整体方案重估，按 design.md §5 流程）。
- 受信/安全纪律继承设计 §2.6-2.7：默认全关、受信门、最小环境、不注入凭据。
