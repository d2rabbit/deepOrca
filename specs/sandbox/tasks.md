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

- [ ] 新建 `packages/core/src/common/path-boundary.ts`，自 `permissions.ts:705-746` **原样搬移**（不改动函数体）：`isPathInProject`、`safeRealPath`（改为 export）、`isPathInAnyDirectory`。
- [ ] `permissions.ts` 改为 `import { isPathInProject, isPathInAnyDirectory } from "./path-boundary.js"` 并保留同名 re-export（`export { isPathInProject } from "./path-boundary.js"`），调用点（`:301,302,313,324`）不动。
- [ ] 新增类型与闸门（纯函数，realpath 之外零 I/O）：
  ```ts
  export type PathGrant = {
    readonly writeRoots: readonly string[];   // 始终含 realpath(projectRoot)
    readonly readRoots: readonly string[];    // projectRoot + readPermissionExemptPaths
    readonly allowWriteOutsideRoots: boolean; // 本次调用 write-out-cwd 已判 allow（R1）
    readonly allowReadOutsideRoots: boolean;  // 本次调用 read-out-cwd 已判 allow（R1）
  };
  export type GateVerdict = { ok: true } | { ok: false; reason: string; scope: PermissionScope };
  export function gateWrite(grant: PathGrant | undefined, filePath: string): GateVerdict;
  export function gateRead(grant: PathGrant | undefined, filePath: string): GateVerdict;
  ```
  判定顺序：路径 ∈ roots ⇒ ok → 布尔位 ⇒ ok → 拒（带 scope + reason）。`grant === undefined` ⇒ 退化为 roots=[projectRoot]、布尔全 false（**fail-closed**）。
- [ ] **TOCTOU**：目标文件可能不存在 —— 对**父目录** `dirname(filePath)` 做 `safeRealPath`，拼回 basename 后做 roots 包含判定；父目录 realpath 失败回退词法路径（沿用 `isPathInProject` 既有策略，不引入新语义）。
- [ ] `PermissionScope` 以 `import type` 自 `settings.ts` 引入（types 模块，无分层问题；`verbatimModuleSyntax` 要求 type-only）。
- [ ] 闸门拒绝的 `reason` 措辞对齐 `permissions.ts:88-108` 风格（含目标路径、越界 scope、放行方式提示）。

### 任务 2 — `ToolExecutionContext.pathGrant` + executor 透传

- [ ] `common/tool-types.ts`：`ToolExecutionContext`（`:28-42`）新增 `pathGrant?: PathGrant`（`import type` 自 `./path-boundary.js`），JSDoc 注明"缺省 undefined ⇒ handler fail-closed 退化为仅 projectRoot，派生算法见 specs/sandbox/design.md §4.1"。
- [ ] `tools/executor.ts:63`：`executeToolCalls` 加第 4 参 `extras?: { pathGrant?: PathGrant }`；`:258` 附近构建 context 时透传 `pathGrant: extras?.pathGrant`。**不改** hooks 既有形状。

### 任务 3 — session.ts 按 R2 算法派生 per-call PathGrant

- [ ] `appendToolMessages`（`session.ts:4772`）执行循环内、`executeToolCalls` 调用（`:4803`）之前，对每个通过 `buildPermissionToolExecution` 的 call 派生：
  ```
  const request = describeToolPermissionRequest({
    sessionId, projectRoot: this.projectRoot, toolCall,
    readPermissionExemptPaths: this.getSkillScanRoots().map(e => e.root),
    resolveSnippetPath: (id, snippetId) => getSnippet(id, snippetId)?.filePath,
  });
  // R2 关键观察：能走到执行阶段的 call，resolved 决策必然已是 allow（:4798 已拦截其余）
  const grant: PathGrant = {
    writeRoots: [safeRealPathOf(this.projectRoot)],
    readRoots:  [safeRealPathOf(this.projectRoot), ...exemptPaths],
    allowWriteOutsideRoots: request.scopes.includes("write-out-cwd"),
    allowReadOutsideRoots:  request.scopes.includes("read-out-cwd"),
  };
  ```
- [ ] 派生只对 `read`/`Read`、`write`/`Write`、`edit`/`Edit`（含别名归一）计算 grant，其余工具不传（undefined ⇒ fail-closed 对非文件工具无消费点，无行为差异）。
- [ ] bash 调用不派生（其 scope 是副作用推断而非路径判定，P0 不触碰 bash 执行路径）。
- [ ] `session.ts:4803` 调用点传入 `extras: { pathGrant }`。

### 任务 4 — write / edit / read handler 接闸门

- [ ] **write**（`write-handler.ts`）：`filePath` 归一后、`:94 ensureParentDirectory` **之前**接 `gateWrite(context.pathGrant, filePath)` —— 保证越界时父目录链也不创建（验收断言 #2）。拒绝返回结构化错误：`ok:false`、`errorType:"PERMISSION_DENIED"`、`retryable:false`、error 措辞用闸门 `reason`（不是 INTERNAL）。
- [ ] **edit**（`edit-handler.ts`）：filePath 经 stat/isDirectory 校验后（≈`:152`）、`getFileState`（`:155`）之前接 `gateWrite` —— 早于内部读（`:173`）与变更钩子（`:320`），语义满足设计文档"writeTextFile 之前"且失败更快。**只接 gateWrite**（R4：edit 的授权维度只有 write scope，内部读是写的必要前置，套 read grant 会误杀"已授权 write-out-cwd 但 read-out-cwd 未单独授权"的合法编辑）。
- [ ] **read**（`read-handler.ts`）：`filePath` 定型为最终绝对路径后（相对路径 suffix-match 解析块 `:67-107` 之后）、首次 fs 触碰（`:109 existsSync`）之前接 `gateRead` —— 单点闸，notebook/pdf/image/gitignore 各分支共享同一 `filePath`，无需逐分支埋点（R5）。`findSuffixMatches`/`loadGitignoreMatcher` 在 projectRoot 内遍历，天然在 readRoots 内，不受闸门影响。
- [ ] 三处拒绝的错误结构统一走一个小的本地 helper（或直接复用 `buildPermissionDeniedResult(toolName, verdict)` 形状），保证 `errorType` 一致。

### 任务 5 — file-utils.ts 底层兜底断言

- [ ] `file-utils.ts`（`:54-68` `writeTextFile` / `ensureParentDirectory`）加模块级**可选**写边界：`configureFileUtilsWriteBoundary(roots | null)`，未初始化（null）时行为零变化（不破坏 desktop 直接调用与全部现有测试默认态）。
- [ ] 初始化后 `writeTextFile` / `ensureParentDirectory` 对目标路径做 roots 包含断言，越界抛带标记的错误（如 `PathBoundaryError`）。这是纵深防御兜底（防绕过主闸门的直调路径），**不是**主闸门；抛出后由 executor 归类为权限类错误的映射放在 handler 层已来不及，接受其以 INTERNAL 形态出现并靠测试锁定主闸门在前。
- [ ] 接线点：SessionManager 构造时以 `[realpath(projectRoot)]` 初始化（单项目进程模型；多项目进程为已知限制，登记即可）。

### 任务 9 — 测试（随各任务同行，此处汇总验收）

- [ ] 新增 `tests/path-boundary.test.ts`（纯函数级）：
  - roots 包含判定（项目内 ok / 项目外拒）；
  - 布尔位放行（`allowWriteOutsideRoots=true` ⇒ 越界 ok，read 同理）；
  - `grant === undefined` ⇒ fail-closed（write/read 双向）；
  - TOCTOU：目标文件不存在时按父目录 realpath 判定（`<root>/../evil` 拒，且不依赖目标存在）；
  - symlink：项目内 symlink 指向 `/etc`（tmpdir 模拟）被拒；
  - `writeRoots` 多根（projectRoot + 显式追加根）判定。
- [ ] handler 级用例（`tool-handlers.test.ts` 增补，`createContext` overrides 注入 grant）：
  - allowAll 语义下 `write` 到项目外（grant 布尔 false）被拒，且**父目录未创建**；
  - 「仅本次允许」模拟：grant 布尔 true ⇒ 该次放行；下一次（新 grant 布尔 false）再拒；
  - edit 越界目标（write-out-cwd 已授权，布尔 true）内部读不被误杀（R4 防回退）；
  - read 越界（布尔 false）拒 / `read-out-cwd` 显式 allow（布尔 true）放行；
  - readRoots 含 exemptPaths（skill 扫描根）时越界读放行。
- [ ] R6 基线回归：接线后重跑全量 `node src/tests/run-tests.mjs`；转红用例**在测试 context 显式注入 pathGrant**，禁止放宽默认 fail-closed。
- [ ] 既有 `permissions.test.ts` 43/43 保持全绿（P0.5 零扰动）。
- [ ] 全仓 `npm run check` + `npm test` 通过（PR 门禁）。

### PR 1 提交切分建议（Conventional Commits）

1. `feat(core): path-boundary 原语迁移 + gateWrite/gateRead 闸门`（任务 1 + path-boundary.test.ts）
2. `feat(core): ToolExecutionContext.pathGrant + executor extras 透传`（任务 2）
3. `feat(core): session 按 R2 算法派生 per-call PathGrant`（任务 3）
4. `feat(core): write/edit/read 接执行期路径闸门`（任务 4 + handler 用例）
5. `feat(core): file-utils 写边界兜底断言`（任务 5）
6. `test(core): P0 验收汇总 + 全量回归`（任务 9 收口，如已随行可并入 4/5）

---

## PR 2 — P1 副作用审计总线（任务 10-11，P0 合入后动工）

- [ ] `sandbox/audit.ts`：`process.hrtime.bigint()` 单调纳秒 + `node:crypto createHash("sha256")` 同步摘要 + 会话目录 append-only JSONL，链式 hash（前一条 checksum 参与本条计算）。**不做** LZ4/CRC64/page index（那是 celld 为对象存储设计的）。
- [ ] `onPathGateVerdict` 钩子（`tool-types.ts` + executor 接线）：P0 闸门判决（含被拒项）全部落审计。
- [ ] spawn 事件接入：复用 `onProcessStart`，bash/bsk/WebSearch 子进程启动落审计。
- [ ] `tests/audit.test.ts`：append→serialize→verify 往返 + 篡改任一条后 `verify()` 返回 false。

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
