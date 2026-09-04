# 沙箱与副作用收口 — 落地任务清单

> 对应 `specs/archive/sandbox/design.md`（2026-08-16 定稿：P0.5 已落地，P0 已细化为 §4.1-R 可施工方案）。
> **✅ 2026-09-03 收官归档**：本清单 40/45 完成；5 项未决项（bwrap / WSL2 / 能力矩阵对账 / 任务 20 / 任务 21）延伸为独立任务规划 [`specs/sandbox-next/`](../../next-version/sandbox-next/tasks.md)，本清单不再勾选推进。
> 施工分支：`feat/sandbox-p0-path-gate`（自 `fix/stabilize-data-loss-and-test-suite` 切出，含 P0.5 全部改动）。
> 每项完成即打勾并注明验收证据（测试文件 / 运行输出）。

## 施工前提（2026-08-16 逐项验证）

- [x] **全绿基线**：`packages/core` 444 用例，443 pass / 1 skip / 0 fail（Node 22.23.2，`node src/tests/run-tests.mjs`）。接线后任何转红都归因于 P0。
- [x] **原语迁出零兼容负担**：`isPathInProject`（`permissions.ts:705`）/ `safeRealPath`（`:729`）/ `isPathInAnyDirectory`（`:737`）全仓（core + desktop + tests）**零外部调用方**，仅在 `permissions.ts` 内部使用。可整体搬移，`permissions.ts` 反向 import 并保留 re-export（防御未来外部引用，零成本）。
- [x] **透传爆炸半径 = 1**：`executeToolCalls` 现签名 `(sessionId, toolCalls, hooks?)`（`executor.ts:63`），生产调用点仅 `session.ts:4803` 一处，且为单 call `[toolCall]` —— pathGrant 天然 per-call。
- [x] **派生输入全在手上**：`appendToolMessages`（`session.ts:4772`）是 SessionManager 方法，可直接取 `this.projectRoot` / `this.getSkillScanRoots()` / `getSnippet`（snippet 解析，与 `:3456-3457` 权限编排同源）。R2 算法只需 `describeToolPermissionRequest`（`:284`，已导出）产出的 **scopes**，不需要 settings、不需要改 `PermissionPlan` 类型。
- [x] **resume 路径天然覆盖**：`appendToolMessages` 的两个调用点（`:3366` trailing-pending resume、`:3495` 正常流）共用同一执行循环，循环内派生对两条路径等价生效（resume 时 `permissionPlan` 对象不存在，R2 的零持久化依赖正是为此）。
- [x] **测试注入点现成**：`tool-handlers.test.ts:1020` `createContext` 支持 `Partial<ToolExecutionContext>` 覆写 —— R6 修法（破例用例显式注入 grant）零脚手架成本。fixture 目录（`:1040` `mkdtempSync`）同时充当 `projectRoot`，大多数用例路径在根内，fail-closed 默认值不影响。

---

## PR 1（本分支）— P0 执行期路径边界闸门（任务 1-5 + 9）

目标：关闭 G1（边界检查不参与执行）+ G2（权限决策不下传）。P0.5（任务 6-8）已在上游分支完成，本 PR 合入即形成 P0+P0.5 闭环。

### 任务 1 — `common/path-boundary.ts`：原语迁移 + 闸门函数

- [x] 新建 `packages/core/src/common/path-boundary.ts`，自 `permissions.ts:705-746` **原样搬移**（不改动函数体）：`isPathInProject`、`safeRealPath`（改为 export）、`isPathInAnyDirectory`。（commit `3f3311a1`）
- [x] `permissions.ts` 改为 `import { isPathInProject, isPathInAnyDirectory } from "./path-boundary.js"` 并保留同名 re-export，调用点不动。
- [x] `PathGrant` / `GateVerdict` / `gateWrite` / `gateRead` 落地；判定顺序 roots → 布尔位 → 拒；`grant === undefined` + `projectRoot` 参数退化为 projectRoot-only（**fail-closed**）。施工补充：`gate*` 增可选第 3 参 `projectRoot?: string` 供退化判定取根（设计文档未指定退化根来源）。
- [x] TOCTOU：父目录 realpath 拼回 basename；**悬垂 symlink 链手动追踪**（realpath 对悬垂目标失败回退词法，`<root>/link -> /etc/new-file` 会成为逃逸口——原语级新增 `followSymlinkChain`，深度上限 10）。
- [x] `PermissionScope` 以 `import type` 引入；reason 措辞对齐权限层风格（含目标路径 + scope + 放行指引）。

### 任务 2 — `ToolExecutionContext.pathGrant` + executor 透传

- [x] `common/tool-types.ts`：`ToolExecutionContext` 新增 `pathGrant?: PathGrant`（`import type` + JSDoc）。（commit `6b54d8c0`）
- [x] `tools/executor.ts`：`executeToolCalls` 加第 4 参 `extras?: { pathGrant?: PathGrant }`，经 `executeToolCall` 透传至 context；hooks 形状不变。

### 任务 3 — session.ts 按 R2 算法派生 per-call PathGrant

- [x] `appendToolMessages` 循环内、`executeToolCalls` 之前派生：新私有方法 `derivePathGrantForToolCall`，重跑 `describeToolPermissionRequest`（含 snippet 解析与 skill 扫描根），`allowWriteOutsideRoots = scopes.includes("write-out-cwd")`、read 同理；roots 取 `safeRealPath(projectRoot)` + exempt 根。（commit `5638bcad`）
- [x] 只对 read/write/edit（含大小写别名）派生；bash 不派生。

### 任务 4 — write / edit / read handler 接闸门

- [x] **write**：绝对路径校验后（早于 `existsSync`/`ensureParentDirectory`）接 `gateWrite`；拒绝返回 `errorType:"PERMISSION_DENIED"` / `retryable:false`。（commit `967ffef5`）
- [x] **edit**：filePath/snippet 归属定型后接 `gateWrite`（仅 write 侧，R4），早于 `getFileState`/内部读，fail-fast。
- [x] **read**：最终绝对路径定型后、首次 fs 触碰（`existsSync`）前单点接 `gateRead`（R5）。

### 任务 5 — file-utils.ts 底层兜底断言

- [x] `configureFileUtilsWriteBoundary(roots | null)` + `PathBoundaryError`；`writeTextFile` / `ensureParentDirectory` 增可选 `options.pathGrant`。（commit `e77c3237`）
- [x] **R7 施工修正（2026-08-16）**：原任务方案"SessionManager 构造时以 `[realpath(projectRoot)]` 静态初始化"有两处缺陷——①静态根会误杀 R1 布尔位授权的合法越界写（兜底在 `writeTextFile` 内抛出，破坏「仅本次允许」UX）；②5 个测试文件直接构造 SessionManager，构造器内初始化模块级全局会跨测试泄漏。修正：断言改为 **grant 感知**（grant 在场 → `gateWrite` 全语义判定；无 grant → 静态 roots 包含判定），初始化走**宿主注入**（desktop `session-bridge.createManager`），core 保持休眠、测试天然封闭。
- [x] handler 将 `context.pathGrant` 下行至 `writeTextFile` / `ensureParentDirectory`；core index 导出 `configureFileUtilsWriteBoundary` / `PathBoundaryError` / `gateWrite` / `gateRead` / `PathGrant` / `GateVerdict`。

### 任务 9 — 测试（已随各任务同行，汇总验收）

- [x] `tests/path-boundary.test.ts` **16 用例**：包含判定 / 布尔位正交性 / fail-closed 退化（含无根全拒）/ TOCTOU 穿越（目标不存在按父目录判）/ 存量 symlink / 悬垂 symlink / symlink 目录 / 多根 exempt / symlink 别名根 / 迁移原语回归 / file-utils 兜底 4 例（休眠默认、越界抛出含父链不创建、R1 布尔位放行与未授权拒、多根）/ **executor extras 透传端到端**（拒 + 布尔位放行）。
- [x] `tool-handlers.test.ts` 增补 **5 用例**（commit 见任务 9 收口提交）：越界 write 拒且父目录未创建 / 无 grant 时根内写照常（fail-closed 默认不伤日常工作）/ R1「仅本次允许」模拟（批准放行 → 下次新 grant 再拒）/ read 越界拒 + 显式 allow 放行 + exempt 根放行 / R4 edit 已授权越界写内部读不误杀 + 未授权越界 edit 拒。
- [x] R6 基线回归：接线后全量重跑，**零转红**（既有 fixture 均与 projectRoot 同根）。
- [x] `permissions.test.ts` 43/43 保持全绿。
- [x] 全仓门禁：`npm run check` 0 errors（11 个 warning 均为非本次改动文件的存量）；`npm test` core 465（464 pass / 1 存量 skip / 0 fail）+ desktop 163/163 + embedding 10/10 + memory 14/14。

### PR 1 提交切分建议（Conventional Commits）

1. `feat(core): path-boundary 原语迁移 + gateWrite/gateRead 闸门`（任务 1 + path-boundary.test.ts）
2. `feat(core): ToolExecutionContext.pathGrant + executor extras 透传`（任务 2）
3. `feat(core): session 按 R2 算法派生 per-call PathGrant`（任务 3）
4. `feat(core): write/edit/read 接执行期路径闸门`（任务 4 + handler 用例）
5. `feat(core): file-utils 写边界兜底断言`（任务 5）
6. `test(core): P0 验收汇总 + 全量回归`（任务 9 收口，如已随行可并入 4/5）

---

## PR 2 — P1 副作用审计总线（任务 10-11，已落地本分支）

- [x] `sandbox/audit.ts`：`process.hrtime.bigint()` 单调纳秒（string 序列化）+ `node:crypto createHash("sha256")` 同步摘要 + 会话目录 `audit/<sessionId>.jsonl` append-only，链式 hash（记录内含 `prevChecksum`，checksum 覆盖去除自身后的 canonical JSON——键排序确定性序列化）。**不做** LZ4/CRC64/page index。
  - 纯函数核心（sans-IO）：`buildAuditEvent` / `computeAuditChecksum` / `serializeAuditEvent` / `verifyAuditChain` / `canonicalJson` / `parseAuditLine` / `readAuditEvents`。
  - `AuditLog` 写入器 **fail-open**：任何 I/O 失败不抛出（审计永不断工具执行），落 `droppedEvents`/`lastFailure` 计数；重开自动续链（读取尾条 checksum）；0o600 权限。
  - 事件四类：`path_gate` / `process_start`（命令截断 512 字符）/ `file_write` / `sandbox_backend`（P3 预留）。
- [x] `onPathGateVerdict` 钩子（`tool-types.ts` 新增 `PathGateVerdictRecord` + context/hooks 双挂载 + executor 透传）：三 handler 闸门后发射（**含被拒项**）。
- [x] spawn 事件接入：session 侧 `onProcessStart` 钩子追加审计（bash `:213/:296` 与 WebSearch `:167/:332` 的 spawn 一处接线全覆盖）。
- [x] fs 写入事件：`onAfterFileMutation` 扩可选 `source` 参数（write/edit handler 传入），session 侧追加 `file_write` 审计。
- [x] session 生命周期：`getSessionAuditLog` 惰性缓存；`removeSessionMessages` 同步清理审计文件；`dispose` 清缓存。
- [x] `tests/audit.test.ts` **7 用例**：append→serialize→parse→verify 往返；**逐条篡改**（5 条链每条单独改）verify=false 且 `firstBadIndex` 定位 + 前缀计数；断链检测（合法 checksum 但 prevChecksum 不衔接）；canonicalJson 键序无关/undefined 剔除；写入器跨重开续链；fail-open（EISDIR 不抛、计数暴露）；executor 端到端（deny+allow 判决都到达钩子）。

## PR 3+ — P2 Sans-IO PolicyEngine（任务 12-13，已落地本分支）

- [x] `sandbox/types.ts` + `sandbox/policy.ts`：**真实 10 scope**（`settings.ts:29-40` 全集 + `ALL_SANDBOX_SCOPES` 常量自证）；纯逻辑零 I/O。`resolveScopeVerdict` 判定优先级镜像 `evaluatePermissionScopes`（deny > ask > allow > defaultMode 兜底，双模式 allowAll/askAll）；`buildPolicyMatrix` 一次解析全矩阵。
- [x] 3 态 lifecycle（`creating → active → dead`）+ generation fencing：`beginGeneration()` 发放能力句柄，新代开启即围栏旧代（悬垂句柄永久失能）；dead 终态不可复活（activate/updateSettings 均无效）；`decide` 对非 active 引擎或围栏句柄一律 fail-closed 拒绝；唯一销毁点宿主 `dispose()`。
- [x] `tests/sandbox-policy.test.ts` **6 用例**：scope 集合自证 = 真实 10 值；**10 scope × 7 种 settings 组合**（deny/ask/allow 列表、优先级覆盖×2、双 defaultMode 兜底）逐格断言；矩阵构建；lifecycle 三态全拒/全矩阵/死态终局；fencing（旧代句柄被围栏）；updateSettings 仅影响当前代未来判定。
- [x] 任务 14 路径级「始终允许」（已落地，消化 §4.2(d) 残余风险——一次点击不再等于永久全盘授权）：
  - **settings**：`PermissionSettings.allowedWritePaths/allowedReadPaths?: string[]`（normalize 填充 + user/project 并集合并 + 非法项过滤去重）；quarantine clamp **保留**路径授权（窄授权正是 clamp 想要的粒度）。
  - **权限层**：`writePermissionExemptPaths` 参数（与读侧 exempt 同构）——已授权路径的 write/edit 不再产生 `write-out-cwd` scope（空 scope ⇒ allow，P0.5 基线零扰动）；`AskPermissionRequest.filePath` 结构化携带（read/write/edit 填充，bash 无）；`appendProjectAllowedPaths` 持久化（镜像 appendProjectPermissionAllows，去重、不动 scope 列表）；`hasUserPermissionReplies` 认可路径回复。
  - **session**：`UserPromptContent.alwaysAllowPaths`（replySession 持久化 + prompt 拷贝点）；权限计划与 grant 派生两处传豁免路径；**grant roots 追加**——`writeRoots += realpath(allowedWritePaths)`、`readRoots += allowedReadPaths`（R1 形状如预留：布尔语义不变，quarantine 下布尔仍恒 false，roots 是唯一放宽通道）。
  - **desktop**：`PermissionResult.alwaysAllowPaths` + PermissionCard 路径级「始终允许（仅此路径）」按钮（write/read-out-cwd 且 ask 携带 filePath 时绑定路径而非 scope；同轮同路径去重跳过；bash/network 保持 scope 级）；App.tsx 三处 plumbing（approve continue / deny pending reply / reply 复用）；i18n `perm.alwaysPath` 六语言。
  - **测试**：core `path-grants.test.ts` 6 用例（持久化去重且不碰 scope / P0.5 基线下授权路径免问而他路径仍问 / ask 携带 filePath / quarantine 下窄授权仍可用他处仍拒 / 派生 roots 精确收录且闸门只放行该树、布尔不放宽 / 回复判定）+ desktop `permissions-lib.test.ts` 2 用例（pathGrantFor 绑定规则 / buildResult 聚合）。
  - 回归：core 498（497 pass/1 存量 skip/0 fail）+ desktop 166 + 全仓 check 0 errors。

## PR 4+ — P3 三平台进程隔离 + quarantine（任务 15-19、22）

- [x] `sandbox/backend/interface.ts` + `noop.ts` + `detect.ts`（任务 15）：probe + 降级链，**每次降级必经 `onDegradation` 回调**（session 侧落 `sandbox_backend` 审计）；probe 为"编译并真实运行"最小 profile（防 sandbox_init 运行期失败被语法检查漏过）。
- [x] macOS `sandbox-exec` 后端（任务 16，本机实测定稿）：读侧黑名单（broad read + deny HOME + 项目/skill 根再放行）+ 写侧白名单（projectRoot + temp 根 + 设备字面量）+ **终局 HOME 写围栏**（防 HOME⊂TMPDIR 时被 temp 写根按 last-match-wins 重开——测试运行器实际暴露的边缘）+ network 视 scope。实证约束：`process-fork` 无星号（`process-fork*` 为 unbound variable）、subpath 读白名单方案会 SIGABRT（弃）、zsh 在 deny-default 下无法启动（沙箱内强制 `/bin/bash`）、git 需 `GIT_CONFIG_GLOBAL=/dev/null`（HOME 不可读时 EPERM 致 fatal）。
- [ ] Linux 系统 bwrap 后端（任务 17，未动工）：`--ro-bind / /` 起步、`--bind <projectRoot>` 可写、`--unshare-net` 视 scope、proc/tmpfs 显式声明；**不 vendor**（Ubuntu 24.04+ AppArmor 只放行有 profile 的打包二进制）；AppImage 嵌套 userns 雷区，probe 必须在真实运行环境做。detect.ts 已登记"未实现"降级记录（不静默）。
- [ ] Windows WSL2 后端（任务 18，未动工）：`wsl.exe` 探测 + 专用 distro（`wsl.conf` 关 interop）+ cwd 映射校验；未装 WSL 是常态 → noop + 诚实宣称。detect.ts 已登记"未实现"降级记录（不静默）。
- [x] bash-handler 接隔离器（任务 19）：`ToolExecutionContext.bashSandbox`（与 pathGrant 同 extras 通道）；前台（:161）与后台（:272）两个 spawn 点统一经 `wrapShell` 包装（noop 返回 null → 原样 spawn）；session 侧 `deriveBashSandbox` 惰性构造（仅 bash 调用触发，网络条款快照自 `resolveScopeVerdict("network") !== "deny"`——ask 被拒的调用不会到执行层，故 allow+ask ⇒ on），激活与降级**双落审计**；会话删除/dispose 清缓存。
- [x] 任务 22 quarantine 信任分级（已落地，零新基础设施）：
  - **settings**：`DeepcodingSettings.workspaceTrust?: "trusted"|"quarantine"`（项目级，缺省/非法值 = trusted，不因 typo 突然隔离）；`ResolvedDeepcodingSettings.workspaceTrust` 透出；`mergeMcpServers` 在 quarantine 下**跳过项目级 mcpServers**（项目文件是攻击面；用户级服务器是用户自己的选择，照常加载）。
  - **权限层收紧**：`applyQuarantinePermissionClamp`——out-cwd 读/写/删三 scope 注入 deny 列表（**直接拒，不询问**——不可信仓库无权"批准出去"）；deny 对 allow/ask 优先的既有短路不变。
  - **bash 无后端必问**：`computeToolCallPermissions` 新增 `forceAskTools`（按工具名整体 force-ask，deny 仍优先）——scope 级 forceAsk 无法表达"每条 bash 都问"（bash 的副作用 scope 名与文件工具同命名空间，scope 集会误伤同轮 write/read），这是对设计"一行编排"设想的施工修正；session 侧 `quarantined && !probe.available ⇒ ["bash"]`，后端探针经 `getOrCreateBashBackend` 缓存复用（权限计划期即可用）。
  - **grant 收紧**：`grantOutsideRootsFlags(scopes, quarantined)`——quarantine 下布尔恒 false（执行侧保险带，权限层已拒）。
  - **测试**（`tests/quarantine.test.ts` 5 用例）：clamp 拒越界（含显式 allow 授权也被拒）+ 根内照常 + deny 去重形状；forceAskTools 同轮 bash×2（含别名 Bash）全问 + write 不受影响；deny 优先不被 forceAsk 升级；grant 布尔 clamp；settings 解析（trusted 加载项目服务器 / quarantine 跳过 / 非法值回退 trusted）。
  - ~~已知边界：首次打开询问信任级别的 UI~~ ✅ 已闭环（desktop UI 批次）：`IpcRequest.WorkspaceTrustGet/Set`（set 走特权通道）+ preload 暴露 + App.tsx 首开/切项目时 `getWorkspaceTrust().explicit === false` 弹 `WorkspaceTrustDialog`（六语言），选择后写项目 settings 并 refreshSettings；quarantine 选择提示"已运行的项目级 MCP 服务器重启后停用"。bridge 侧抽取纯 helper `readWorkspaceTrustStatus`/`writeWorkspaceTrust`（无需 Electron 可测，`tests/workspace-trust.test.ts` round-trip）；`SettingsSummary.workspaceTrust` 供 UI 徽标。core 侧 `tests/sandbox-status.test.ts` 锁定回调契约（最终结果通知 + 缓存去重 + 降级必报）。
- [ ] 平台能力矩阵（§六）逐格与实现核对后对外宣称。

**P3 本批实测证据**（`tests/sandbox-backend.test.ts` 7 用例，darwin 实跑）：profile 生成纯断言（HOME 写围栏次序/转义/network 条款）×2、noop 语义、detect 降级必报、wrapShell 强制 bash + git env、darwin 实测矩阵（HOME secret 读拒且零泄漏 / 项目内写读 / HOME 越界写拒含 HOME⊂TMPDIR 边缘 / loopback 网络双向——deny 拒 allow 通）、**handler 端到端**（经 `handleBashTool` 完整路径 + 真实沙箱，项目内命令成功、HOME secret 不泄漏）。

**已知边界（登记不阻塞）**：
1. ~~**降级的 UI 可见性缺口**~~ ✅ 已闭环（desktop UI 批次）：core `SessionManagerOptions.onSandboxStatusChanged`（active/degraded 双通知，缓存去重）→ session-bridge 发射 `IpcEvent.SandboxStatusChanged` → preload `onSandboxStatusChanged` → App.tsx 降级 toast（六语言 i18n `sandbox.degradedToast`）。
2. **DNS/mach 依赖未验证**：loopback TCP/HTTP 已验证 `network*` 足够；真实 DNS（mDNSResponder mach 服务）在 deny-default 下的行为未测——若沙箱内 DNS 失败需补 `(allow mach-lookup (global-name …))` 细则。
3. **沙箱内 bash 强制 /bin/bash**：用户 shell 偏好（zsh）在沙箱内被覆盖（zsh 在 deny-default 下无法启动，实证）；wrapped command 为 POSIX，行为等价。
4. **网络条款按会话快照**：settings 中途修改只对新会话生效（代码已注释）。

## 独立轨道（不阻塞 PR 1-4）

- [ ] 任务 20（P4）：项目级 `mcpServers` 变更强制确认 —— 独立立项，T4 的最小可行改动。
- [ ] 任务 21（P5）：WASM/WASI 工具 ABI 预研（§九）—— `PathGrant` 落地后即为 WASI preopen 的直接输入；`node:wasi` 或 `jco transpile` 纯 JS 路线（约束 4 禁 wasmtime/extism 原生依赖）。

---

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 现有 always-allow 用户升级后行为变化 | R2 派生按构造忠实反映 allow 列表；"显式授权未误伤"用例（P0.5 同型）锁定 |
| 测试 fixture 在 projectRoot 外读写被 fail-closed 拦截（R6） | 逐用例显式注入 grant，禁止放宽默认值；全绿基线已建，转红归因零成本 |
| `appendToolMessages` 每调用一次 `describeToolPermissionRequest` 的开销 | 单 call 单次 scope 归类，纯函数级成本（与 `:3444` 编排同量级），无实测风险；如需可缓存 exemptPaths |
| file-utils 兜底误伤 desktop 直调 | 未初始化默认关闭；SessionManager 单项目进程模型下接线，多项目限制已登记 |
| P0 与 routing 工作混提交 | 本分支独立成 PR，跑全量 `npm test`（§八） |
| 回滚 | 任务 1-3 为加法（新模块/新字段/新参数），单 revert 任务 4 的三个 handler 接线点即可整体失效闸门，无数据迁移 |

---

## 十一、模块审查记录（2026-08-16 链路闭环审查）

对全部 15 个沙箱提交做了一轮系统复查（闸门语义 / 权限层 / 派生 / 后端 / IPC / renderer 全链路），逐项结论：

### 发现并修复的缺陷（2 个，均附防回退测试）

| ID | 缺陷 | 后果 | 修复 |
| --- | --- | --- | --- |
| **R1（数据丢失）** | `session-bridge.updateSettings` 经 `buildPermissionSettings` 完全重建 permissions 对象，只保留 defaultMode/allow/ask/deny | 用户在设置面板**任何一次保存**都会抹掉已积累的路径授权（`allowedWritePaths`/`allowedReadPaths`） | `buildPermissionSettings` 增 `preserve` 参数透传 `raw.permissions` 的路径字段；导出供测试（desktop `workspace-trust.test.ts` 防回退） |
| **R2（功能退化）** | `normalizeAskPermissions`（会话中断/重启后的 pending ask 恢复路径）重建条目时丢 `filePath` | 恢复后的权限卡拿不到路径绑定，「始终允许（仅此路径）」退化回 scope 级全盘授权——正是任务 14 要消除的形态 | 归一化保留 `filePath`（非字符串值剔除不强制转换；core `path-grants.test.ts` 防回退） |

### 复核通过、无需改动的项

- 三 handler 闸门位置（write 早于 `ensureParentDirectory`/`existsSync`；edit 在 snippet 归属定型后、仅 gateWrite；read 单点闸）与 R4/R5 设计一致。
- `appendProjectPermissionAllows` 写回经 `{...existingPermissions}` 展开保留路径字段；`inheritedPermissions` 重建分支仅在项目文件无 permissions 时触发（无可丢数据，且为增量拷贝语义）。
- `appendProjectAllowedPaths` 全量读-改-写，不碰其他字段；空输入零副作用（不创建文件）。
- macos 后端 `wrapShell` 语义：强制 `/bin/bash`（zsh 在 deny-default 下无法启动，实证）、`GIT_CONFIG_GLOBAL=/dev/null`、忽略原 shellPath 但 shellArgs 为 POSIX（marker/init 逻辑 shell 无关）。
- IPC 安全分类：`WorkspaceTrustGet` 只读走普通 `handle`，`WorkspaceTrustSet`（写 settings）走 `handlePrivileged`（主渲染器来源校验）——与 SettingsUpdate 同级；事件通道无特权语义。
- quarantine clamp 保留路径授权（窄授权即 clamp 想要的粒度）；`applyQuarantinePermissionClamp` 与 `derivePathGrantForToolCall` 的豁免路径来源一致。
- 审计链 fail-open、会话删除同步清理、`replySession` 先持久化后派生（`resolveCurrentSettings` 每次重读文件，同轮生效）。
- PermissionCard 同轮去重（scope 与 path 两个维度）、`hasDeny` 时路径授权仍按用户点击持久化（语义正确：用户确实对该路径点了始终允许）。

### 登记的已知缺口（不阻塞，后续批次）

1. **设置面板不可见/不可撤销路径授权**：`allowedWritePaths`/`allowedReadPaths` 只能经 PermissionCard 累积、手工编辑 settings.json 撤销——需要在 EditableSettings 中展示与移除（下批 desktop UI）。
2. Linux bwrap（任务 17）/ Windows WSL2（任务 18）未实现，detect 降级必报；沙箱内 DNS（mDNSResponder mach 服务）未验证。

### 二轮复审（评审 agent 流水线，2026-08-16）

按 /code-review 流程（摘要 + 5 并行评审 agent + 逐 issue 置信度评分，<80 过滤）对 14 个沙箱提交复核，15 个候选问题中 **3 个通过 80 分阈值**，全部当日修复（防回退测试随行）：

| # | 问题（评分） | 修复 |
| --- | --- | --- |
| F1（85） | PermissionCard 渲染期跳过循环与提交期 remaining 循环判定不一致——bash scope 级始终允许后，同批 filePath 绑定的 write 提示"既不提交也不渲染"，权限卡静默卡死 | 判定抽为共享纯函数 `isPromptGranted`（renderer lib/permissions.ts），双循环统一使用；permissions-lib.test.ts 防回退 |
| F2（88） | 信任标记存于项目级 settings——被隔离仓库可自带 `workspaceTrust:"trusted"` 使首开对话框永不出现、整套 clamp 静默失效（防御自拆，mcpServers 隔离自己的注释都写明"项目文件是攻击面"） | 信任标记移到**用户级存储** `~/.deeporca/projects/<code>/trust.json`（core app-dirs.ts read/writeWorkspaceTrustStore）；`DeepcodingSettings.workspaceTrust` 字段移除（项目文件该字段被忽略）；mergeMcpServers 改经参数取信任值；getProjectCode 迁至 app-dirs（避免 settings→session 循环）；quarantine.test.ts 含"仓库无法自我解除隔离"防回退 |
| F3（85） | quarantine clamp 保留 allowedWritePaths/allowedReadPaths——被隔离仓库可预置 `allowedWritePaths:["/"]` 静默绕过 out-cwd 全拒（"保留窄授权"的记档只考虑了用户来源，未考虑攻击者来源） | clamp 清零两列表；session 新增 `effectivePermissions()` 单一权限真源（计划评估 + 读写豁免 + grant 派生全部走 clamp 后形态，堵住"豁免列表从未 clamp 取值"的残余旁路）；path-grants.test.ts 断言翻转（预置授权在 quarantine 下 buys nothing） |

未过阈值（≤75）的 12 项归因存档：4 项注释措辞类（50-55）、3 项设计明示权衡（macos 沙箱硬边界 vs 授权 75、quarantine 网络快照 30、policy 引擎消费者 70）、3 项条件触发缺陷（symlink 深链 55、路径授权 symlink 首写 75、renderer 去重字面等值 50）、PascalCase 命名 40、trust 设置后未 reload 48（toast 已诚实披露）。

**两项 75 分经用户确认影响较大，同日修复（G 批次，2026-08-16）**：

- **G1 路径授权 symlink 首写（75）**：授权根此前用 `safeRealPath ?? resolve`——目标文件不存在时保持词法形态（如 macOS `/tmp/x`），而闸门候选经父目录 realpath 解析为 `/private/tmp/x`，永不匹配 → 用户批准的写入被拒且不自愈。修复：`resolveGateRoot` 导出**闸门同源 canonicalizer**（最深存在祖先 realpath + 余段），派生侧 `toRealRoot` 改用之——根与候选共用一个规范化器。防回退：symlink 目录下不存在目标文件的授权写入放行、链接真实位置同判定、兄弟树仍拒。
- **G2 macOS profile 接入授权（75）**：设计 §4.5"profile 由 PathGrant 生成"此前未兑现——沙箱内 bash 对已授权路径（`cp x ~/granted/`、读已授权的 HOME 子树）一律 EPERM，比文件工具更窄且无解释。修复：`getOrCreateBashBackend` 经 `effectivePermissions()` 把 `allowedWritePaths`（writeRoots）与 `allowedReadPaths`（extraReadRoots，HOME 读拒后再放行）喂进 profile；**scope 级 write-out-cwd 授权刻意不进沙箱**（硬边界语义，跨边界 bash 需求走路径级授权）；quarantine 下 effectivePermissions 清零列表——被隔离仓库无法自行放宽沙箱。快照语义不变（会话构造期取值，与网络条款一致）。darwin 实测：授权目录沙箱内可写可读、未授权 HOME 仍拒。
