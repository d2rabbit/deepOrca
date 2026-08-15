# 沙箱与副作用收口 — 落地任务清单

> 对应 `specs/sandbox/design.md`（2026-08-16 定稿：P0.5 已落地，P0 已细化为 §4.1-R 可施工方案）。
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

## PR 3+ — P2 Sans-IO PolicyEngine（任务 12-14，可与 PR 2 并行）

- [ ] `sandbox/types.ts` + `sandbox/policy.ts`：**真实 10 scope**（`settings.ts:28-38`），非编造值；纯逻辑零 I/O，`node --import tsx --test` 直跑，10 scope × allow/deny/ask 全组合。
- [ ] 3 态 lifecycle（`Creating → Active → Dead`）+ generation fencing；唯一销毁点 `dispose()`（`session.ts:1643`），不做 Draining/grace（无触发条件）。
- [ ] 任务 14 路径级「始终允许」：持久化路径追加进 `writeRoots`/`readRoots`（R1 形状已预留），settings schema + PermissionCard UI 改动，消化 §4.2(d) scope 级授权残余风险。

## PR 4+ — P3 三平台进程隔离 + quarantine（任务 15-19、22）

- [ ] `sandbox/backend/interface.ts` + `noop.ts` + `detect.ts`：probe + 降级链，**每次降级落审计 + UI 可见，禁止静默**（约束 6）。
- [ ] macOS `sandbox-exec` 后端：profile 由 PolicyEngine 从 PathGrant 生成（`deny default` + 子树限定 + network 视 scope）；probe 失败 fail-open 到 noop + 审计告警 + UI 提示。
- [ ] Linux 系统 bwrap 后端（**不 vendor**，Ubuntu 24.04+ AppArmor 只放行有 profile 的打包二进制）：`--ro-bind / /` 起步、`--bind <projectRoot>` 可写、`--unshare-net` 视 scope、proc/tmpfs 显式声明；AppImage 嵌套 userns 雷区，probe 必须在真实运行环境做。
- [ ] Windows WSL2 后端：`wsl.exe` 探测 + 专用 distro（`wsl.conf` 关 interop）+ cwd 映射校验（默认 `/mnt/c` 暴露整盘，只承诺 projectRoot 映射内操作）；未装 WSL 是常态 → noop + 诚实宣称。
- [ ] bash-handler 接隔离器（`bash-handler.ts:161`，经 `ToolExecutionContext` 与 pathGrant 同源；bash 不走 `Spawner`）；后端选择结果（含 probe 失败原因）落审计。
- [ ] 任务 22 quarantine 信任分级（§十，零新基础设施）：项目级 settings 存 `trusted|quarantine`；quarantine 会话 bash 副作用 scope 全集塞 `forceAskScopes`（plan mode 同款机制）、grant 派生布尔恒 false（out-cwd 读写 fail-closed 全拒）、mcpServers 不自动加载（`settings.ts:640` 合并策略加信任条件）。
- [ ] 平台能力矩阵（§六）逐格与实现核对后对外宣称。

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
