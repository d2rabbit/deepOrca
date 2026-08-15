# 沙箱与副作用收口 — 设计方案

> 日期：2026-08-15 · 状态：设计定稿（P0.5 已实现并复验，P0 已细化为可施工方案 §4.1-R，其余未实现）
>
> **bash 沙箱定稿（2026-08-16）**：P3 由"仅 macOS"扩为**三平台内核进程隔离 + 禁止静默降级**（§4.5 修订）；VM 级方案（v86/vfkit）经评审**否决——太重**（用户决策 2026-08-16）。强化隔离诉求由 §十 的**轻量 quarantine 信任分级**承接：零新基础设施，复用 P0 闸门与 forceAsk 机制。
>
> **WASM/WASI 路线评审（2026-08-15）**：已评审并记录决策 —— WASI 作为主威胁（T1/T2/T3）的隔离机制是**范畴错误**（它隔离 WASM guest 代码，而我们的 A 级出口是宿主进程内代码与原生 shell 子进程），但作为**不可信扩展代码**（MCP/第三方工具）的执行底座是正解，其 preopen 模型与 P0 的 `PathGrant` 同构。评审全文见 §九；任务清单新增 #19（P5，独立预研）。P0/P0.5/P1/P3 路线不变。
>
> **复验记录（2026-08-15，二轮）**：P0.5 落地与本文一致 —— `forceAskDefaultedScopes`（`permissions.ts:76` 参数、`:186` 接线、`:233-250` 过滤器）、`isDefaultedAllow`（`:250`）、`DEFAULT_FORCE_ASK_DEFAULTED_SCOPES`（`:275`）、session 编排（`session.ts:3454`），验收 6 条在 `permissions.test.ts:724-800`，单文件 43/43 全绿（Node 22）。P0 未动工（无 `path-boundary.ts`、无 `sandbox/`、`ToolExecutionContext` 无 `pathGrant`）。二轮审计发现原 §4.1 有三处施工级缺陷（PathGrant 形状无法表达"已授权越界"、派生点拿不到 per-scope 信息、透传点描述错误），已在 §4.1-R 修正。§二 行号锚点已按当前代码刷新。
>
> 起因：外部提出的「借鉴 celld 模式构建 OS 级沙箱」方案评审。评审结论是**架构骨架可用、集成层与后端层需重写、优先级需倒置**，故重写为本方案。
>
> **决策记录（2026-08-15）**：`allowAll` 下的项目外写/删 —— 采纳「收窄为强制 ask」。实现语义见 §4.2，其中的"显式授权 vs 默认放行"区分是本决策能否不破坏 UX 的关键。**已于同日落地**：`forceAskDefaultedScopes` 双参数方案 + `DEFAULT_FORCE_ASK_DEFAULTED_SCOPES` baseline 接线（`session.ts` 权限编排），验收用例见 `packages/core/src/tests/permissions.test.ts`（P0.5 系列 6 条）。
> 关联：`packages/core/src/common/permissions.ts`（权限判定）、`packages/core/src/tools/executor.ts`（工具分发 seam）、`packages/core/src/session.ts`（权限编排）
> 前序审计：本文 §二 全部结论均来自 2026-08-15 对当前分支 `fix/stabilize-data-loss-and-test-suite` 的代码审计，带 `file:line` 证据。
>
> 设计约束：
>
> 1. **先堵执行期边界，再谈 OS 隔离**——当前真实缺口不是"缺少沙箱"，而是"权限判定完了不落地执行"（§三 T1）。OS 隔离是纵深防御的第二层，不是第一层。
> 2. **能力传递取代环境权限（capability over ambient authority）**——权限决策已在 `session.ts:3444` 算出，但只用于"是否放行分发"，放行后 handler 以宿主全权限运行。核心改造是把决策**下传**给 handler 强制执行。
> 3. **core 无 UI、core 不依赖 electron**——沿用既有 `Spawner` / controller-seam 铁律，隔离后端走 seam 注入。
> 4. **不新增原生构建**——`electron-builder.yml:21-22` 显式关闭 `npmRebuild`/`nodeGypRebuild`，仓库无 `binding.gyp`/`Cargo.toml`。任何需要编译原生 helper 的方案（如 Landlock）本阶段直接否决。
> 5. **不引入宿主 Python**——仓库刻意 vendor `uv` 以规避宿主 Python（`scripts/vendor-uv.js`），沙箱 bootstrap 不得依赖 `python3`。
> 6. **不宣称做不到的隔离**——平台能力矩阵（§六）必须诚实。"有沙箱"的错觉比"无沙箱"更危险。
> 7. **fail-closed，但不破坏 allowAll 的产品 UX**——边界闸门在拒绝时给出明确的权限错误，而非静默失败或内部错误。

---

## 一、定位重构：为什么原方案的顺序是反的

原方案的路线是 `Sans-IO 核心 → bwrap 后端 → macOS 后端 → 审计`，即**先建隔离机制，再想怎么接进去**。审计后发现三个错位：

| 错位 | 原方案假设 | 实际 |
| --- | --- | --- |
| **拦截点** | 沙箱化子进程即可 | `write`/`edit` 走进程内 `fs.writeFileSync`，**零子进程**（`file-utils.ts:61`）。子进程沙箱对它们完全无效 |
| **缺口性质** | 缺少 OS 隔离机制 | 边界检查**已经有且已加固**（`isPathInProject`，`permissions.ts:633-655`），只是没接到执行路径上 |
| **平台优先级** | Linux/bwrap 为 Phase 1 主力 | 主力分发是 macOS arm64（`electron-builder.yml:39-46`），Linux 是 AppImage（嵌套 userns 雷区） |

**修正后的三层定位：**

```
第 1 层 执行期边界闸门（P0 + P0.5）  ← 真实漏洞在这里，2-3 天，无隔离依赖
        权限决策下传 handler，fs 调用层强制校验
        + allowAll 不再隐式覆盖越界写/删
第 2 层 副作用审计总线（P1）  ← 可观测性，用真实数据决定第 3 层做多重
        所有 spawn + fs 写入 + 闸门判决落链式审计日志
第 3 层 执行基质隔离（P2/P3） ← 内核进程隔离三后端（sandbox-exec/bwrap/WSL2）
        + quarantine 信任分级（§十，轻量）；VM 方案已否决（太重）
        Sans-IO PolicyEngine 统一供策略
```

---

## 二、事实基线

### 2.1 副作用出口全表（按"模型可控性"分级）

模型可控性是唯一重要的分级维度 —— 引导期/配置期的 spawn 不在 LLM 的攻击面内。

| 等级 | 出口 | 位置 | 模型控制什么 |
| --- | --- | --- | --- |
| **A. 模型全控** | bash 工具 | `bash-handler.ts:161,272` | **完整 shell 字符串**（设计如此）。仓库最大的模型可控出口 |
| **A. 模型全控** | `write` / `edit` 工具 | `write-handler.ts:101`、`edit-handler.ts:321` → `file-utils.ts:61` | **任意绝对路径 + 任意内容**，且 `write` 会 `mkdir -p` 父链（`file-utils.ts:66-68`） |
| **A. 模型全控** | `read` 工具 | `read-handler.ts:154,182` | **任意绝对路径**（仅 128MB 大小上限） |
| **B. 模型控 argv** | `browser.*` action | `actions/browser.ts:81` → `action-ipc.ts:59` | `bsk` 命令固定，但 `subcommand` + `args[]` 是自由 LLM 输入（定义无 enum/allowlist）。属 argv 注入面，非 shell 注入 |
| **B. 模型控 argv** | WebSearch | `web-search-handler.ts:160` | 仅 `argv[1]`（query）；脚本路径来自配置。无 shell ⇒ 单 argv 元素，无注入 |
| **C. 配置期任意命令** | MCP stdio 服务器 | `mcp-manager.ts:465` | 模型不可控。命令来自 `settings.json` 的 `mcpServers`，**项目级覆盖用户级**（`settings.ts:640`）⇒ 真实威胁是"克隆不可信仓库" |
| **D. 引导期固定** | prompt 版本探测、sqlite/node 探测、crg、wiki-cli、git-service、gitmcp 维护、vendor 刷新 | `prompt.ts:487-554`、`sqlite-runtime.ts:102-231`、`crg.ts:214`、`wiki-cli.ts:169`、`git-service.ts:16`、`session-bridge.ts:869-1005`、`main/index.ts:319` | 无。命令与 argv 全固定或来自 UI/配置，且均走 `execFile`（无 shell） |

> 更正：`common/codegraph.ts` 的 `execFileSync` 导入是**死导入**，零调用点（spawn 逻辑已迁至 desktop 的 `SdkCodegraphController`）。

**关键推论：真实需要覆盖的模型可控出口只有 4 个（A×3 + B×2 中的 browser），不是"10 个逃逸口"。** 这显著缩小了工作量，也说明 OS 沙箱的边际收益低于边界闸门。

### 2.2 已有能力（比原方案描述的成熟得多）

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 符号链接加固的项目边界判定 | `permissions.ts:705-735` `isPathInProject` + `safeRealPath` | ✅ 已加固（双端 realpath，失败回退词法 `path.relative`），注释标注 "deep review 2026-08-15, B3" |
| 10 个权限 scope + 判定引擎 | `settings.ts:28-38`、`permissions.ts:304` | ✅ 完整 |
| 配置损坏 fail-closed | `settings.ts:328-346` `failClosedPermissionDefault` | ✅ 损坏时 `allowAll`→`askAll` |
| 进程组杀 + Windows taskkill | `process-tree.ts:36,43` | ✅ 负 pid 组杀，有回退 |
| 可动态调整的超时 | `bash-timeout.ts`、`bash-handler.ts:190-210` | ✅ 默认 10min，可中途延长 |
| 双进程注册表 + 中断 | `session.ts:776-777, 3719, 5082-5093` | ✅ 持久化 + 内存两份 |
| 变更前 git checkpoint | `session.ts:4085-4096` ← `onBeforeFileMutation` | ✅ 可 undo |
| 工具执行 seam + 8 个钩子 | `tool-types.ts:28-53`、`executor.ts:250-271` | ✅ 现成的注入点 |
| 测试自动发现 | `tests/run-tests.mjs:22` `globSync("*.test.ts")` | ✅ 新测试零注册成本 |

### 2.3 真实缺口

| 缺口 | 证据 | 后果 |
| --- | --- | --- |
| **G1. 边界检查不参与执行** | `isPathInProject` 的调用点只有 `permissions.ts:301,313,324`，全部在 `describeToolPermissionRequest` 内做 scope 归类。`write-handler` / `edit-handler` / `read-handler` / `file-utils` **均不调用** | 一旦 `write-out-cwd` 被判为 allow，`write` 可写入磁盘任意绝对路径并创建父目录链，**无第二道检查** |
| **G2. 权限决策不下传** | 决策在 `session.ts:3444` 算出，在 `:4797-4801`（`buildPermissionToolExecution`）用于"是否放行分发"；`ToolExecutionContext`（`common/tool-types.ts:28-42`）**不含任何权限字段** | handler 放行后以宿主全权限运行 = 环境权限（ambient authority）。持久化的 always-allow（`permissions.ts:696` 附近 `appendProjectPermissionAllows`）会把一次授权变成永久全盘授权 |
| **G3. `onBeforeFileMutation` 无法否决** | 签名 `(filePath: string) => void`（`tool-types.ts:38`），同步、可选链调用、无 `if`/`await`/`try`（`write-handler.ts:100`、`edit-handler.ts:320`） | 不能作为策略拦截点。抛异常虽能中断写入，但被 `executor.ts:271-284` 归类为 `INTERNAL` 错误，与崩溃不可区分 |
| **G4. 无 OS 级隔离** | `bash-handler.ts:161` 裸 spawn 继承父进程全部权限 | 命令内的任意行为不受约束（这是原方案唯一说对的缺口） |

> 更正上一轮评审中我的一处表述：曾建议"用 `onBeforeFileMutation` 作为 fs 拦截点"。按 G3，该钩子是 checkpoint 机制、不可否决，**不应重载它**。P0 改为独立的显式闸门（§4.1）。

---

## 三、威胁模型

先定义威胁，再谈机制 —— 原方案缺这一步，导致为不存在的问题（会话级 drain/grace）建模。

| ID | 威胁 | 载体 | 现状 | 本方案覆盖 |
| --- | --- | --- | --- | --- |
| **T1** | 模型被诱导写/删项目外文件（`~/.ssh/authorized_keys`、shell rc、`~/.claude/settings.json`） | `write`/`edit` 工具，A 级 | ⚠️ P0.5 后 allowAll 下转为强制 ask，但执行层仍无第二道检查（G1/G2），任何放行路径都是全权限 | **P0 + P0.5**（主目标，两者互为补全） |
| **T2** | 模型读取项目外敏感文件并外泄（凭据、密钥） | `read` 工具 + 网络，A 级 | ⛔ 仅 128MB 上限 | **P0** 闸门 + **P1** 审计（读侧刻意不强制 ask，理由见 §4.2c） |
| **T3** | bash 命令内的任意副作用（含绕过 T1/T2 闸门） | bash 工具，A 级 | ⛔ 无隔离 | **P0.5** 削减越界破坏性命令（`inferBashSideEffects`）+ **P3** 三后端内核进程隔离 + quarantine 下 bash 全量强制 ask（§十） |
| **T4** | 不可信仓库通过项目级 `settings.json` 的 `mcpServers` 执行任意命令 | 配置期，C 级 | ⛔ 项目级覆盖用户级 | **P4**（独立课题） |
| **T5** | `bsk` argv 注入触达非预期浏览器能力 | `browser.*` action，B 级 | ⚠️ 无 allowlist | **P1** 审计 + **P2** 策略 |
| T6 | 资源耗尽（fork bomb、磁盘填满） | bash | ⚠️ 有超时无资源限制 | P3 附带 |
| T7 | 提权/内核逃逸 | — | 明确**不在**威胁模型内 | 不做 |

**主威胁是 T1/T2，且它们与子进程沙箱无关。** 这是优先级倒置的全部理由。

---

## 四、方案

### 4.1 P0 — 执行期路径边界闸门（1-2 天，最高优先级）

**问题**：G1 + G2。权限层算出了决策，执行层不知道，于是不执行。

**设计**：能力下传 + fs 调用层强制校验。两个改动点。

**(a) 新增边界原语模块** `packages/core/src/common/path-boundary.ts`

把 `isPathInProject` / `safeRealPath` / `isPathInAnyDirectory` 从 `permissions.ts` **移到**本模块，`permissions.ts` 反向 import。理由：handler 不应 import 权限模块（分层），且这三个函数本身与权限语义无关，是纯路径原语。

新增闸门函数（纯函数、零 I/O 之外的 realpath）：

```ts
export type PathGrant = {
  /** 允许写入的根目录集合（已 realpath 归一化）。始终含 realpath(projectRoot) */
  readonly writeRoots: readonly string[];
  /** 允许读取的根目录集合。projectRoot + readPermissionExemptPaths */
  readonly readRoots: readonly string[];
  /** 本次调用的 write-out-cwd 已判 allow（显式授权 / 用户本次批准） */
  readonly allowWriteOutsideRoots: boolean;
  /** 本次调用的 read-out-cwd 已判 allow */
  readonly allowReadOutsideRoots: boolean;
};

export type GateVerdict = { ok: true } | { ok: false; reason: string; scope: PermissionScope };

export function gateWrite(grant: PathGrant | undefined, filePath: string): GateVerdict;
export function gateRead(grant: PathGrant | undefined, filePath: string): GateVerdict;
```

> **修正 R1（二轮审计）**：原设计的 `PathGrant{writeRoots, readRoots, exemptPaths}` **无法表达"已授权的越界放行"**——用户点「仅本次允许」后，该次调用应能写任意路径，而 root 列表无法枚举"全盘"。必须加两个布尔位。布尔位与 roots 是正交的两层：roots 是静态边界，布尔位是本次调用的动态授权。P2 任务 14（路径级「始终允许」）落地时，持久化的路径直接追加进 roots，布尔语义不变，形状向后兼容。

**TOCTOU 处理**：对**父目录**做 `realpath`（目标文件可能尚不存在），再拼回 basename 做包含判定 —— 复用 `safeRealPath` 现有的"realpath 失败回退词法"策略。这与 `isPathInProject` 已有的加固思路一致，不引入新语义。

**闸门语义**：

| 调用 | 判定顺序 |
| --- | --- |
| `gateWrite` | 路径 ∈ writeRoots ⇒ ok；否则 `allowWriteOutsideRoots` ⇒ ok；否则拒（scope=`write-out-cwd`）。grant 为 `undefined` ⇒ 退化为 writeRoots=[projectRoot]、布尔全 false（**fail-closed**） |
| `gateRead` | 路径 ∈ readRoots ⇒ ok；否则 `allowReadOutsideRoots` ⇒ ok；否则拒（scope=`read-out-cwd`）。grant 为 `undefined` ⇒ 退化为 readRoots=[projectRoot]（fail-closed） |

**(b) 决策下传 — 派生算法（修正 R2/R3）**

`ToolExecutionContext`（`common/tool-types.ts:28-42`）新增字段：

```ts
/**
 * 本次工具调用被授予的路径能力。缺省 undefined ⇒ handler 退化为
 * "仅 projectRoot"，即 fail-closed。派生算法见 specs/sandbox/design.md §4.1。
 */
pathGrant?: PathGrant;
```

> **修正 R2（二轮审计）**：原设计写"在 `appendToolMessages` 内据 `permissionPlan` 派生"——**做不到**。`PermissionPlan.permissions`（`permissions.ts:54-57`）只有 per-call 三态决策，`appendToolMessages` 收到的 `options.messagePermissions` 不含 per-scope 信息，直接派生会丢失 scope 维度。且 resume/trailing-pending 路径重放的是持久化的 toolCalls + 用户 overrides，`permissionPlan` 对象此时根本不存在。
>
> **修正后的派生算法**（零持久化依赖、与 resume 路径天然一致）：对每个即将执行的 call，在 `appendToolMessages`（`session.ts:4771`）的循环内重跑 `describeToolPermissionRequest`（已导出，`permissions.ts:284`）拿到 scopes。关键观察：**能走到执行阶段的 call，其 resolved 决策必然已是 "allow"**（否则 `:4797` 的 `buildPermissionToolExecution` 已拦截）——无论这个 allow 来自 settings、显式授权、还是用户本次批准。因此：
>
> ```
> 对 write/edit 调用：allowWriteOutsideRoots = scopes.includes("write-out-cwd")
> 对 read 调用：     allowReadOutsideRoots  = scopes.includes("read-out-cwd")
> writeRoots = [realpath(projectRoot)]
> readRoots  = [realpath(projectRoot), ...readPermissionExemptPaths]
> ```
>
> 该算法按构造与权限层永远一致：「始终允许」（scope 在 allow 列表→决策 allow→布尔 true）、「仅本次允许」（override allow→本次布尔 true，下次重新 ask）、P0.5 强制 ask 后批准（同 override）全部正确覆盖，且**不需要改动 `PermissionPlan` 类型**。

> **修正 R3（二轮审计）**：透传点不是"`executor.ts:250-271` 加字段就完事"。`executeToolCalls` 的生产调用点全仓只有 `session.ts:4803` 一处，且就是**单 call 调用**（`[toolCall]`）——pathGrant 天然 per-call，无需解决"一个 turn 内混合决策"的问题。签名加第 4 参 `extras?: { pathGrant?: PathGrant }`，executor 在 `:258` 构建 context 时透传。爆炸半径 = 1 个调用点。

**消费点**：

| Handler | 闸门位置 | 说明 |
| --- | --- | --- |
| `write-handler.ts` | `:94` `ensureParentDirectory` **之前** | 保证越界时父目录链也不创建（验收断言 #2） |
| `edit-handler.ts` | `:321` `writeTextFile` 之前、`onBeforeFileMutation` 之前 | **只接 gateWrite**（见 R4） |
| `read-handler.ts` | 相对路径经 suffix match 解析为绝对路径之后、首次 `fs` 触碰之前 | 单点闸，notebook/pdf/image 各分支共享同一 `filePath`，无需逐分支埋点（见 R5） |

拒绝时返回**权限类错误**（`errorType: "PERMISSION_DENIED"`，`retryable: false`，措辞复用 `permissions.ts:88-108` 风格），不是 `INTERNAL`。

> **R4 — edit 的内部读不走 gateRead**：edit 的授权维度只有 write scope（`permissions.ts:313,324`），handler 内部 `readTextFileWithMetadata` 读取目标文件是写的必要前置。若对内部读套 read grant，会在"已授权 write-out-cwd 但 read-out-cwd 未被单独授权"时误杀一次合法编辑。
>
> **R5 — snippet_id 路径天然被覆盖**：edit 经 `resolveSnippetPath` 解析出的目标文件参与 `describeToolPermissionRequest` 的 scope 归类（`session.ts:3456` 已接线），越界 snippet 目标会被归类为 `write-out-cwd` → P0.5 强制 ask → 闸门布尔位按授权结果设置。snippet 不是绕过路径。

**(c) 底层兜底**

`file-utils.ts` 的 `writeTextFile` / `ensureParentDirectory` 是公开导出（`index.ts:120`），desktop 也能直接调。加一个模块级可选的"已授权根"断言，未初始化时不改变行为（避免破坏现有 desktop 调用），初始化后越界抛出。这是纵深防御，不是主闸门。

**验收**

| 断言 | 方式 |
| --- | --- |
| `defaultMode:"allowAll"` 且无显式授权时，`write` 到 `/etc/xxx` 被拒（P0.5 ask 未批准 ⇒ 不执行；若绕过权限层直接执行 ⇒ 闸门 fail-closed 拒） | 新增 `tests/path-boundary.test.ts` |
| `write` 到 `<root>/../evil` 被拒，且**父目录未被创建** | 同上（验证 `mkdir -p` 也在闸门内） |
| 项目内经符号链接指向 `/etc` 的路径被拒 | 复用 `isPathInProject` 已有的 symlink 用例形态 |
| `read-out-cwd` 显式 allow 时，越界读放行 | 同上 |
| `pathGrant` 缺省时退化为 projectRoot-only（fail-closed） | 同上 |
| 用户「仅本次允许」越界写 ⇒ 该次放行（布尔位 true），下一次调用重新 ask | handler 级测试：显式构造 grant 模拟 override 后的派生结果 |
| edit 越界目标（已授权 write-out-cwd）的内部读不被误杀 | handler 级测试（R4 防回退用例） |
| 既有 `permissions.test.ts` / `tool-handlers.test.ts` 全绿 | `npm test -w @deeporca/core` |

**风险**

1. **兼容性**：现有 always-allow 用户升级后行为必须不变 —— R2 的派生算法按构造忠实反映持久化 allow 列表与 override，但仍需"显式授权未被误伤"的测试兜底（P0.5 已有同型用例，模式照搬）。
2. **测试基线（R6，二轮审计新增）**：`tool-handlers.test.ts:1040` 用 `os.tmpdir()` 建 fixture。需逐套件确认 `context.projectRoot` 与 fixture 同根；个别读/写 projectRoot 外路径的用例会被 fail-closed 默认值拦截——修法是在测试 context 里**显式注入 pathGrant**，而不是放宽默认值。施工第一步先跑 `npm test -w @deeporca/core` 建立全绿基线，接线后立即重跑定位受影响用例。

---

### 4.2 P0.5 — `allowAll` 语义收窄（已决策：收窄为强制 ask）

**决策**：即使 `defaultMode: "allowAll"`，项目外写/删仍强制询问。

**这不是加一行常量就完事的改动** —— 现有 `forceAskScopes` 机制承载不了这个语义，直接复用会毁掉「始终允许」按钮。以下是必须处理的三件事。

#### (a) 机制缺口：现有 forceAsk 无法区分"显式授权"与"默认放行"

`evaluatePermissionScopes`（`permissions.ts:304-330`）里有**两条**不同的 allow 路径：

| 路径 | 位置 | 语义 |
| --- | --- | --- |
| 显式授权 | `:326` `permissionScopes.every(s => settings.allow.includes(s))` | 用户/项目配置**主动**把该 scope 写进了 allow 列表（含点过「始终允许」） |
| 默认放行 | `:329` `settings.defaultMode === "askAll" ? "ask" : "allow"` | 谁都没表态，靠 `allowAll` 兜底 |

而 `getAllowedForcedAskScopes`（`permissions.ts:202-205`）的过滤条件是 `evaluatePermissionScopes([scope], settings) === "allow"` —— **把两条路径混为一谈**。

对 plan mode 而言混同是**正确**的：plan mode 的语义是"什么都别碰"，理应压制显式授权。所以 `PLAN_MODE_FORCE_ASK_SCOPES`（`session.ts:197-203`，含 `write-in-cwd`/`write-out-cwd`/`delete-in-cwd`/`delete-out-cwd`/`mutate-git-log`）沿用现状，**不动**。

对本决策而言混同是**错误**的：若基线 forceAsk 也压制显式授权，用户点了「始终允许 write-out-cwd」之后**依然每次被问**，`appendProjectPermissionAllows`（`permissions.ts:696`）的持久化形同废纸。这是必须避免的功能回退。

#### (b) 设计：两种 forceAsk 语义，两个独立参数

不给现有参数加模式标志（会让 plan mode 与基线互相纠缠），而是并列新增一个语义不同的参数：

```ts
// computeToolCallPermissions options 新增
/**
 * 强制询问：无条件压制 allow，含用户显式授权。用于 plan mode
 * ——"什么都别碰"。沿用现状，语义不变。
 */
forceAskScopes?: readonly PermissionScope[];

/**
 * 强制询问：仅压制"由 defaultMode 兜底得来"的 allow，不动用户显式
 * 授权。用于收窄 allowAll 的隐式覆盖面（决策 2026-08-15）。
 */
forceAskDefaultedScopes?: readonly PermissionScope[];
```

配套新增一个纯判定函数（与 `evaluatePermissionScopes` 同文件、同风格）：

```ts
/** 该 scope 的 allow 是否来自 defaultMode 兜底而非显式 allow 列表。 */
export function isDefaultedAllow(scope: PermissionScope, settings: Required<PermissionSettings>): boolean;
// = !deny.includes(s) && !ask.includes(s) && !allow.includes(s) && defaultMode === "allowAll"
```

`getAllowedForcedAskScopes` 拆成两个过滤器，结果并入现有的 `mergeAskScopes`（`permissions.ts:208`）—— 该函数已做去重，无需改动。`permissions.ts:169-173` 的 `forcedAskScopes.length > 0 ? "ask" : evaluatedPermission` 结构保持不变。

#### (c) 基线 scope 集合：只放 out-cwd 两项

```ts
/**
 * allowAll 不再隐式覆盖的 scope。刻意只含 out-cwd 两项：
 * 项目内写/删是 agent 的日常工作，纳入会让 allowAll 失去意义。
 */
const DEFAULT_FORCE_ASK_DEFAULTED_SCOPES = ["write-out-cwd", "delete-out-cwd"] as const;
```

**不含** `write-in-cwd`/`delete-in-cwd`（日常工作，纳入等于废掉 allowAll）、不含 `mutate-git-log`（破坏性但可 undo，且 `file-history` 有 checkpoint）、不含 `read-out-cwd`（T2 的读侧靠 P0 闸门 + 审计覆盖；纳入会让读配置文件、读全局 skill 等常规操作频繁弹窗）。

**附带收益：bash 也一并收紧。** `inferBashSideEffects`（`permissions.ts:419`）会把越界破坏性命令推断为 out-cwd 类 scope 而非仅 `unknown`（见 `:447` 注释），因此基线 forceAsk 对 bash 路径同样生效 —— 这在不做任何 OS 隔离的前提下就削减了 T3 的一部分。

#### (d) 与「始终允许」的交互（收敛后的行为）

| 场景 | 收窄前 | 收窄后 |
| --- | --- | --- |
| allowAll，首次越界写 | 静默通过 ⛔ | **询问** ✅ |
| allowAll，用户点「始终允许」后再次越界写 | 静默通过 | 静默通过（显式授权已生效，不再问）✅ |
| allowAll，用户点「仅本次允许」后下次越界写 | 静默通过 ⛔ | **再次询问** ✅ |
| plan mode 下越界写（即使已始终允许） | 询问 | 询问（`forceAskScopes` 语义不变）✅ |
| `deny` 列表含 write-out-cwd | 拒绝 | 拒绝（`:170-171` 提前短路，forceAsk 不参与）✅ |

**残余风险**：「始终允许 write-out-cwd」是 **scope 级**授权，一次点击等于永久放开全盘越界写。路径级授权（把 `PathGrant` 的 `writeRoots` 持久化，而非持久化 scope）是正确解，但涉及 settings schema 变更与 UI 改动，归入 P2 后续，不在 P0 范围。P0 完成后，越界写至少**每个新项目都会被问一次**且**全部落审计**（P1），风险面已从"默认敞开"降到可接受。

**验收补充**（并入 §4.1 的测试）

| 断言 | 说明 |
| --- | --- |
| allowAll + 空 allow 列表 ⇒ `write-out-cwd` 判为 `ask` | 基线生效 |
| allowAll + allow 列表含 `write-out-cwd` ⇒ 判为 `allow` | **显式授权未被误伤（防回退核心用例）** |
| allowAll + allow 列表含 `write-out-cwd` + plan mode ⇒ 判为 `ask` | 两种语义正确共存 |
| deny 列表含 `write-out-cwd` ⇒ 判为 `deny`（不是 ask） | `:170-171` 短路未被破坏 |
| allowAll ⇒ `write-in-cwd` 仍为 `allow` | 未过度收紧 |
| 越界 `rm -rf` 的 bash 调用 ⇒ `ask` | 附带收益验证 |
| 既有 `permissions.test.ts` 全绿 | plan mode 行为零变化 |


---

### 4.3 P1 — 副作用审计总线（2-3 天）

**目标**：在做任何隔离之前，用真实数据回答"哪些出口真的被用到、越界尝试有多频繁"。

- 复用现成钩子：`onProcessStart`（`tool-types.ts:45`）+ 新增 `onPathGateVerdict`（P0 产出的判决，含被拒项）。
- 事件模型（**修正原方案 §3.7 的技术错误**）：
  - 用 `process.hrtime.bigint()` 取单调纳秒 —— 原方案的 `performance.now() * 1_000_000` 不是纳秒精度却命名 `monotonicNs`
  - 用 `node:crypto` 的 `createHash("sha256")` 同步摘要 —— 原方案的 `crypto.subtle.digestSync` **该 API 不存在**
  - `checksum` 必须在事件类型里声明 —— 原方案 spread 进了未声明该字段的类型
- 落盘：会话目录下 append-only JSONL，链式 hash（前一条 checksum 参与本条计算）。**不做**原方案的 LZ4/双 CRC64/page index —— 那是 celld 为对象存储设计的，本场景是本地小文件，纯 JSONL 足够。
- 验收：`audit.test.ts` 覆盖 append→serialize→verify 往返 + 篡改任一条后 `verify()` 返回 false。

---

### 4.4 P2 — Sans-IO PolicyEngine（3-4 天）

保留原方案 §2.1（Sans-IO 核心）与 §2.3（generation fencing），**丢弃** §2.2 的 6 态机与 §2.4/2.5 的 deadline/alarm（理由见 §五）。

**必须修正的输入**：scope 用真实的 10 个值，而非原方案编造的 6 个不存在的值。

| 原方案编造 | 实际（`settings.ts:28-38`） |
| --- | --- |
| `read-outside-cwd` / `write-outside-cwd` | `read-out-cwd` / `write-out-cwd` |
| `network-outbound` / `network-inbound` | `network`（单值，无方向区分） |
| `subprocess` / `syscall` | **不存在**（bash 侧用 `parseBashSideEffects` 的 9 值集，`permissions.ts:365`） |
| — | 遗漏了 `delete-in-cwd` / `delete-out-cwd` / `query-git-log` / `mcp` |

**状态机简化为 3 态**：`Creating → Active → Dead`。桌面应用无"会话结束"事件（`cleanupSessionResources` 是 private，仅 `deleteSession` 与索引裁剪调用，`session.ts:3845,3035`），Draining/grace 无触发条件。唯一真实销毁点是 `dispose()`（`session.ts:1643`，应用退出）。

**验收**：纯逻辑、零 I/O、可在 `node --import tsx --test` 直跑；10 scope × allow/deny/ask 组合全覆盖。可与当前 routing 工作并行，无冲突。

---

### 4.5 P3 — OS 级进程隔离：三后端 + 降级链（1-2 周，2026-08-16 扩展）

**修订背景**：原方案只做 macOS + noop。决策 2026-08-16：bash 不得裸跑宿主机，三平台都要有后端，且**禁止静默降级** —— 每次降级落审计 + UI 可见提示。VM 级方案已否决（§十），本层是 bash 隔离的唯一执行档，quarantine 强化诉求由 §十 的信任分级以零新基础设施承接。

**后端矩阵（默认档，按探测顺序）**：

| 平台 | 首选 | 回退 | 最终 |
| --- | --- | --- | --- |
| macOS | `sandbox-exec -p <profile>` | — | noop + 明示 |
| Linux | 系统 `bwrap`（PATH 探测 + userns 可用性 probe） | — | noop + 明示（提示用户安装 bwrap） |
| Windows | WSL2（`wsl.exe` 探测，专用 distro 内执行） | — | noop + 诚实宣称 |

- **macOS**：`sandbox-exec` 包裹 `bash-handler.ts:161` 的 shell。profile 由 PolicyEngine 从 `PathGrant` 生成（`deny default` + `allow file-read*`/`file-write*` 限定子树 + `deny network*` 视 `network` scope）。已知约束不变：`sandbox_init` 自 10.14 deprecated，CLI 仍可用（Claude Code / Codex 同路）；probe 失败 fail-open 到 noop + 审计告警 + UI 提示。
- **Linux（bwrap 修订）**：§五 否决的是**原方案那组错误的 bwrap  flags 与"假定已安装"**，不是 bwrap 本身。修订后：flags 重写（`--ro-bind / /` 起步、`--bind <projectRoot>` 可写、`--unshare-net` 视 scope、proc/tmpfs 显式声明）；**不 vendored** —— Ubuntu 24.04+ 的 AppArmor userns 管控只放行有 profile 的打包二进制（distro 装的 bwrap 有，随机路径的 vendored 副本没有），vendor 了也会被打回。探测系统 bwrap，缺失/被打回 → noop + 明确提示「安装 bubblewrap 可启用进程隔离」。AppImage 嵌套 userns 雷区不变，probe 必须在真实运行环境做，不能只看 PATH。
- **Windows（WSL2 修订）**：`wsl.exe` 是系统自带命令，零原生构建。真实 VM 边界（Hyper-V）。三个必须处理的坑：①默认挂载 `\mnt\c` 暴露整盘 —— 命令执行前校验 cwd 映射，只承诺 projectRoot 映射目录内的操作；②WSL interop 允许 guest 调宿主 Windows exe —— 需在专用 distro 的 `wsl.conf` 关闭 interop，否则隔离形同虚设；③WSL 未安装是常态，探测失败 → noop + 诚实宣称。性能注意：`/mnt/c` 下 I/O 慢，重度命令体验下降，属已知折衷。
- **集成点**：不是"扩展 `Spawner`" —— bash 不走 `Spawner`（`bash-handler.ts:1` 直接 `import { spawn }`）。在 `bash-handler` 内经 `ToolExecutionContext` 取隔离器，与 `pathGrant` 同源。后端选择结果（含 probe 失败原因）写入 P1 审计。
- **验收**：沙箱内 `cat ~/.ssh/id_rsa` 失败；`touch /tmp/x` 视 profile 成败符合预期；`network` deny 时 `curl` 失败；各平台 probe 失败时退化路径符合降级链且审计/UI 均有记录。

---

### 4.6 P4 — MCP 进程隔离（独立课题）

T4 的收益可能高于 T3，但改造面在 `mcp-manager.ts:455-529` 与 settings 合并策略（`settings.ts:640` 项目级覆盖用户级）。建议独立立项，本方案只登记不展开。最小可行改动：**项目级 `settings.json` 新增/修改 `mcpServers` 时强制用户确认**，成本远低于进程隔离。长期方向见 §九 —— MCP/第三方工具的 WASM 化执行底座（P5）是 T4 的根治路径，进程隔离只是过渡。

---

## 五、被否决的部分与理由

| 原方案项 | 判定 | 理由 |
| --- | --- | --- |
| 扩展 `Spawner` 接口作为集成点（§4.1） | ❌ | bash 不走 `Spawner`（`bash-handler.ts:1`）。`Spawner` 只被 `actions/browser.ts` 用于 `bsk`。扩展它对主威胁零收益 |
| `class BashHandler { constructor(spawner, sandboxManager) }`（§4.3） | ❌ | 无此类。实际是自由函数 `handleBashTool(args, context)`（`bash-handler.ts:45`）。seam 是 `ToolExecutionContext` |
| `permissionsToSandboxPolicy(permConfig)`（§4.2） | ❌ | 实际类型 `PermissionSettings{allow,deny,ask,defaultMode}`，无 `network`/`timeoutMs`/`env` 字段；6/9 个 scope 名不存在。编译不过 |
| 6 态生命周期 + Draining/grace（§2.2） | ❌ | 桌面应用无会话结束事件，无触发条件。为不存在的问题建模 |
| deadline expiry + alarm/wake（§2.4/2.5） | ❌ | 现有 `bash-timeout` + `killProcessTree` 已覆盖真实需求（含中途延长，原方案未提） |
| Linux bwrap 后端（§3.6） | ⚠️ 部分修订（2026-08-16） | 否决**原方案的错误 flags 与"假定已安装"**：①`--dev-bind / /` 是**可读写**挂载全根并授予设备访问，注释却写"只读"，这一行抵消整个沙箱；②`--proc /proc` 与随后 `--ro-bind /proc /proc` 冲突；③`--unshare-all` 已含 `--unshare-net`；④Landlock 只在注释里，无实际调用（需原生 helper，违反约束 4）；⑤AppImage 内嵌套 user namespace 是已知雷区；⑥vendored bwrap 在 Ubuntu 24.04+ 会被 AppArmor userns 管控打回（无 profile）。**修订**：flags 重写 + 探测系统 bwrap 的 P3 后端已采纳，见 §4.5 |
| `BOOTSTRAP_SCRIPT`（§3.6） | ❌ | ①Python 里写 JS 字面量 `null`/`true`（应 `None`/`True`）⇒ **SyntaxError**；②socket 绑 `/tmp/sandbox-init.sock` 而 `/tmp` 被挂为 tmpfs ⇒ **宿主永不可达**，exec 路径根本不通；③依赖沙箱内有 `python3`，违反约束 5 |
| Windows Job Objects 作为对等后端 | ❌ | 范畴错误。Job Objects 提供内存/CPU/进程数限制与 kill-on-close，**零文件系统与网络隔离**。真隔离需 AppContainer/受限令牌或 WSL2 |
| `crypto.subtle.digestSync`（§3.7） | ❌ | **该 API 不存在**。改用 `node:crypto` `createHash` |
| `Result`/`Ok`/`Err`（§3.4） | ❌ | 仓库无此helpers（已 grep 确认）。且原文混用 `Err("string")` 与 `Err({kind,...})` 两种不兼容类型 |
| 原 Phase 1 估时 2-3 天 | ❌ | 严重低估。但**修正方向与原判断相反**：真实工作量比我上一轮估的 2-3 周更小（模型可控出口只有 4 个），瓶颈在 P0 的兼容性验证，不在后端实现 |
| **Sans-IO 核心（§2.1）** | ✅ 保留 | 与仓库风格契合，测试零注册成本 |
| **generation fencing（§2.3）** | ✅ 保留 | 廉价，防悬垂句柄 |
| **审计日志（§2.6）** | ✅ 保留但提前 | 简化为 JSONL + 链式 hash，且**独立于沙箱先做** |

---

## 六、平台能力矩阵（诚实宣称）

P3 + quarantine 完成后对外可宣称的能力，逐格必须与实现一致：

| 平台 | 边界闸门 + ask 收窄（P0/P0.5） | 审计（P1） | 策略引擎（P2） | 进程隔离（P3） | quarantine（§十） | 对外表述 |
| --- | --- | --- | --- | --- | --- | --- |
| macOS arm64/x64 | ✅ | ✅ | ✅ | ✅ `sandbox-exec` | ✅ 强制沙箱 | "进程级隔离 + 路径边界 + 不可信仓库隔离模式" |
| Windows | ✅ | ✅ | ✅ | ⚠️ WSL2（有则有，无则 noop） | ⚠️ 有后端强制沙箱，无则全量 ask | "路径边界 + 隔离模式；进程隔离视 WSL2" |
| Linux (AppImage/deb) | ✅ | ✅ | ✅ | ⚠️ 系统 bwrap（probe，无则 noop） | ⚠️ 有后端强制沙箱，无则全量 ask | "路径边界 + 隔离模式；进程隔离视 bwrap" |

三个平台的 P0/P0.5/P1/P2 完全一致（纯 TS，无平台依赖）—— **一次投入，三平台受益**。P3/quarantine 的 bash 隔离强度依赖平台能力，故 ⚠️ 诚实标注；所有 noop 降级必须 UI 可见，禁止静默（约束 6）。VM 级隔离经评审否决（§10.2），不在宣称范围内。

---

## 七、任务清单

| # | 任务 | 阶段 | 落点 | 依赖 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | `common/path-boundary.ts`：迁移 `isPathInProject`/`safeRealPath`/`isPathInAnyDirectory`（`permissions.ts:705-746`），新增 `gateWrite`/`gateRead`（含 R1 布尔位语义） | P0 | 新文件 + `permissions.ts` 反向 import | — | 未动工 |
| 2 | `ToolExecutionContext.pathGrant` 字段 + `executeToolCalls` 第 4 参 `extras` 透传 | P0 | `common/tool-types.ts:28-42`、`executor.ts:63` 签名 + `:258` context 构建 | 1 | 未动工 |
| 3 | `appendToolMessages` 循环内按 R2 算法派生 per-call `PathGrant`（重跑 `describeToolPermissionRequest`，`permissions.ts:284` 已导出） | P0 | `session.ts:4792-4805` 循环 + `:4803` 调用点 | 2 | 未动工 |
| 4 | `write`/`edit`/`read` handler 接闸门（写侧须在 `ensureParentDirectory` 之前；edit 只接 gateWrite——R4；read 在路径解析后单点闸——R5） | P0 | `write-handler.ts:94`、`edit-handler.ts:321`、`read-handler.ts` | 3 | 未动工 |
| 5 | `file-utils.ts` 底层兜底断言（可选初始化，默认不改行为） | P0 | `file-utils.ts:54-68` | 1 | 未动工 |
| 6 | `isDefaultedAllow()` 纯判定函数 | P0.5 | `permissions.ts:250` | — | ✅ 已完成 |
| 7 | `getAllowedDefaultedForcedAskScopes` 过滤器 + `forceAskDefaultedScopes` 参数 | P0.5 | `permissions.ts:76,186,233-248` | 6 | ✅ 已完成 |
| 8 | `DEFAULT_FORCE_ASK_DEFAULTED_SCOPES` 常量 + 编排接线 | P0.5 | `permissions.ts:275`、`session.ts:149,3454` | 7 | ✅ 已完成 |
| 9 | `tests/path-boundary.test.ts` + handler 级防回退用例（§4.1 验收表 8 条）；先建全绿基线再接线，tmpdir fixture 破例处显式注入 grant（R6） | P0 | 测试 | 4,5 | 未动工 |
| 10 | `sandbox/audit.ts`（`hrtime.bigint` + `createHash` + JSONL 链式 hash） | P1 | 新目录 | — | 未动工 |
| 11 | `onPathGateVerdict` 钩子 + spawn 事件接入审计 | P1 | `tool-types.ts`、`session.ts` | 9,10 | 未动工 |
| 12 | `sandbox/types.ts` + `sandbox/policy.ts`（真实 10 scope） | P2 | 新文件 | — | 未动工 |
| 13 | 3 态 lifecycle + generation fencing | P2 | 新文件 | 12 | 未动工 |
| 14 | 路径级「始终允许」（持久化路径追加进 `writeRoots`/`readRoots`，取代 scope 级授权）—— 消化 §4.2(d) 残余风险；R1 的 PathGrant 形状已为此预留 | P2 | settings schema + PermissionCard UI | 12 | 未动工 |
| 15 | `backend/interface.ts` + `noop.ts` + `detect.ts`（probe + 降级链；每次降级落审计 + UI 可见，禁止静默） | P3 | 新文件 | 13 | 未动工 |
| 16 | `backend/macos-sandbox-exec.ts` + profile 生成 | P3 | 新文件 | 15 | 未动工 |
| 17 | `backend/linux-bwrap.ts`：修正 flags + 系统 bwrap probe（**不 vendor**，Ubuntu 24.04+ AppArmor 管控）+ AppImage 环境实测 | P3 | 新文件 | 15 | 未动工 |
| 18 | `backend/windows-wsl2.ts`：wsl.exe 探测 + 专用 distro（关 interop）+ cwd 映射校验 | P3 | 新文件 | 15 | 未动工 |
| 19 | `bash-handler` 接隔离器（经 `ToolExecutionContext`，与 `pathGrant` 同源；后端选择落审计） | P3 | `bash-handler.ts:161` | 16,17,18 | 未动工 |
| 20 | 项目级 `mcpServers` 变更强制确认 | P4 | 独立立项 | — | 未动工 |
| 21 | WASM/WASI 工具 ABI 预研（不可信扩展代码的 capability 执行底座，preopen≅PathGrant） | P5 | 独立预研，见 §九 | 1 | 未动工 |
| 22 | quarantine 信任分级：项目级 settings 存级别 + bash 全量 forceAsk 编排 + grant 派生收紧 + mcpServers 信任条件（§十，零新基础设施） | P3 同期 | `settings.ts`、`session.ts:3444-3456` 编排 | 8,15 | 未动工 |

**建议执行顺序**：

- **PR 1 = 任务 1-5 + 9**（P0 闭环；P0.5 的 6-8 已在本分支完成）。两者必须同批发布的理由不变：只做 P0 而不收窄 allowAll，闸门会忠实放行 allowAll 的越界写，T1 依旧敞开；只做 P0.5 而不做 P0，权限层判 ask 之后 handler 仍无二次校验。**两者互为补全，分开发布任一半都是假修复。** 当前 P0.5 已先行落地在本分支，P0 必须跟上才能闭环。
- **PR 2 = 任务 10-11**（审计总线）。
- **PR 3+ = 任务 12-19**。其中 12/13 为纯逻辑、零 I/O，与当前 routing 分支正交，可并行动工；15-19 是三后端与 bash 接线（P3 修订后范围）。任务 22（quarantine 信任分级）与 P3 同期，是编排层小改动。
- 任务 20 独立立项；21（P5 WASI ABI）为独立预研轨道，不阻塞 PR 1-3。


---

## 八、与当前分支的关系

当前分支 `fix/stabilize-data-loss-and-test-suite` 的改动（`routing/telemetry.ts`、`routing-gating.test.ts`、`skill-metadata.test.ts`）与本方案**无文件级冲突**。

但 P0 会触碰 `session.ts`（5108 行）与三个 tool handler —— 这是全仓测试刚转全绿的区域（见 commit `ef1050f1`）。建议 P0 单独成 PR 并跑全量 `npm test`，不与 routing 工作混在同一提交。

**二轮复验（2026-08-15）确认的施工前提**：

1. 注意 Node 版本：测试要求 Node ≥ 22.5（`node:sqlite`），本机默认 shell 是 Node 20，跑测试前 `nvm use 22`。
2. P0.5 已落地且 `permissions.test.ts` 43/43 全绿 —— P0 施工从全绿基线出发，任何转红都是 P0 引入的，归因零成本。
3. `executeToolCalls` 生产调用点只有 `session.ts:4803` 一处（grep 确认），executor 签名变更无第二个受害者。
4. `describeToolPermissionRequest`（`permissions.ts:284`）与 `evaluatePermissionScopes`（`:376`）均已导出，R2 派生算法不需要新增导出。

---

## 九、WASM/WASI 路线评审（2026-08-15 决策）

**提议**：借鉴 celld，把沙箱构建在 WASM 之上 —— WASM/WASI 是天然的隔离机制，黑白名单可以在 WASI 层设计。

**先说结论：提议的方向判断一半正确。** WASI 确实是天然的 capability 沙箱，黑白名单（preopen 目录 = fs 白名单、默认无网络、env/argv/clock 全由宿主控制）正是它的设计核心。但把它用在 DeepOrca 的主威胁上是一个**范畴错误**；用在另一个真实缺口（不可信扩展代码）上则是正解。以下逐条论证。

### 9.1 先澄清 celld 本体是什么

 celld（denoland/celld）不是 OS 级沙箱项目。它是「自托管的分布式 Durable Objects」：每个节点**内嵌 V8** 执行 Wrangler bundle，每个 cell 一个 SQLite 库，经 S3 CAS 做 ownership fencing 与复制。它对隔离的回答是 **V8 isolate + 运行时层 capability 门控**（Workers 模型），不是 bwrap/seatbelt。本文 §五批评的 bwrap 后端、Python bootstrap、LZ4/CRC64 审计格式，来自外部评审方案而非 celld 本体。celld 对我们的真实启示有两条，且**已被本方案吸收**：capability 应在运行时层显式传递（= §一约束 2，能力传递取代环境权限）；fencing 要廉价且防悬垂（= P2 保留的 generation fencing）。它并不支持"用 WASM 沙箱化任意宿主进程"这一主张——celld 自己也做不到。

### 9.2 范畴分析：WASI 的边界在哪里

WASI 沙箱的生效前提是**被隔离的代码编译为 WASM guest**，其全部副作用经 WASI host function 出去，宿主按 capability 授予。逐条对照 §2.1 的模型可控出口：

| 出口 | 执行基质 | WASI 能否覆盖 | 原因 |
| --- | --- | --- | --- |
| `write`/`edit`/`read` 工具 | **宿主进程内 TS 代码**（`fs.writeFileSync`，零子进程） | ❌ | WASM 无法约束宿主自己的 syscall。唯一走法是把 handler 逻辑整体编译成 WASM guest、fs 全走 preopen——这是对 17k 行深度集成的 handler（snippet/checkpoint/diff/状态跟踪）的重写，且 P0 的进程内 fail-closed 闸门已提供同等等价的边界，成本 2 天 vs 重写，收益为零 |
| `bash` 工具 | **原生 shell 子进程**（zsh/bash + 命令内任意原生二进制：git/node/rg/curl/rm） | ❌ | WASI guest 必须是 wasm 编译产物；`spawn(shell, -c, 任意命令)` 执行的是原生代码，WASI 边界根本不在场。要走 WASI 就得换成 wasm userland（wasm shell + wasm coreutils），而 coding agent 的真实工作流依赖宿主工具链（编译器、测试 runner、git），wasm userland 的覆盖面是玩具级 |
| `browser.*` / WebSearch | 原生子进程（bsk / 脚本） | ❌ | 同上，原生二进制 |
| **MCP stdio 服务器（T4）** | 原生 node/python 子进程 | ⚠️ 现状不能，**方向正确** | 今天的 MCP 服务器是任意 npm 包/二进制，不是 wasm 模块。但这是唯一一个"不可信**代码**（而非不可信参数）"的出口 —— 见 9.3 |

**最简洁的判据**：WASI 隔离的是「不可信代码的执行」；DeepOrca 的 A 级出口是「可信代码（handler/shell）携带不可信**参数**（路径、命令字符串）以宿主全权限执行」。对前者 WASI 是正解；对后者要么管参数（P0 闸门）、要么管进程（P3 OS 隔离）——WASI 两样都够不着。模型生成的 bash 命令字符串虽然是"代码"，但它以原生 shell 为执行基质，换成 WASM 执行基质等于重建整个用户态，不可行。

### 9.3 采纳的部分：WASI 作为不可信扩展代码的执行底座（新增 P5 预研，任务 #19）

T4（不可信仓库的 MCP 服务器）是目前**唯一**以"执行不可信代码"为核心的威胁，也是 WASI 的甜点区。长期方向：

- 定义 DeepOrca 的 **WASM 工具 ABI**（component-model 或 Extism 风格）：第三方工具/MCP 风格的扩展以 wasm 模块分发，**WASI preopen = P0 的 `PathGrant.writeRoots/readRoots`**（同构映射：preopen 授予的目录就是授权根，guest 对宿主 fs 没有其他任何视图）；网络默认无（preview1 无 socket API，preview2 需显式授予）；env/argv 由宿主注入。黑白名单就此落在 WASI 层 —— 这正是提议中有价值的部分，且与 P0 的能力模型无缝衔接。
- **运行时选型受约束 4（不新增原生构建）限制**：wasmtime/extism 均为原生依赖，否决。可行路径：`node:wasi`（Node 22 内置，preview1、实验 flag，需在 vendored Node 与 Electron main 双侧验证）或 `jco transpile` + `@bytecodealliance/preview2-shim`（纯 JS 跑 component，无原生依赖）。工具侧可用 `componentize-js` 把 JS 工具逻辑编译为组件（纯 JS 工具链）。
- **这不是 MCP 隔离的近期答案**：现有 MCP 生态是原生进程，P4 的最小可行改动不变（项目级 `mcpServers` 变更强制确认）。P5 是面向未来第三方工具生态的独立预研，不阻塞任何现有阶段。

### 9.4 否决的部分与理由

| 提议项 | 判定 | 理由 |
| --- | --- | --- |
| 用 WASI 沙箱化 write/edit/read 工具 | ❌ | 范畴错误：宿主进程内代码不在 WASI 边界内；等价边界 P0 闸门 2 天可得，重写 handler 为 wasm guest 成本数量级更高且零增量收益 |
| 用 WASI 沙箱化 bash（wasm shell + wasm userland） | ❌ | 执行基质错配：模型命令依赖原生工具链；wasm userland 覆盖面玩具级。可作为远期"不可信仓库隔离模式"的创意登记，不进路线图 |
| 引入 wasmtime/extism 作为运行时 | ❌ | 原生依赖，违反约束 4 |
| "WASI 替代 sandbox-exec 成为 P3 后端" | ❌ | P3 隔离的是原生 shell 子进程，WASI 不构成其后端。P3 维持 sandbox-exec（macOS）+ noop |
| WASI preopen ≅ PathGrant 的黑白名单层 | ✅ 采纳 | 移入 P5（任务 #19），用于不可信扩展代码，而非宿主工具 |

### 9.5 对总路线的净影响

**零改动**。第 1 层（P0/P0.5 边界闸门 + ask 收窄）、第 2 层（P1 审计）、第 3 层（P3 进程隔离）的定位与顺序全部维持——WASI 路线即便全部落地也不覆盖它们任何一个的威胁面，因为它们处理的是宿主代码与原生进程，而 WASI 处理的是 wasm guest。P5 作为第 4 条独立轨道登记：等 P0 的 `PathGrant` 落地后，它就是 WASI preopen 的直接输入，届时黑白名单层的设计可以直接复用 P0 的判定结果。

> 注（2026-08-16）：曾考虑用 v86（跑在 WASM 上的完整 x86 虚拟机）承接"真·不碰宿主机"诉求，当日即否决——太重，见 §十。

---

## 十、quarantine 信任分级（轻量版）+ VM 方案否决记录（2026-08-16）

**需求演化**：bash 不得裸跑宿主机 → 评审了 VM 级方案 → **用户决策：不上 VM，太重，要更轻量的**。

### 10.1 技术事实：为什么"轻量"的终点是内核进程隔离

要约束**原生 shell 命令**只有两条路：内核调解（seatbelt/bwrap/WSL2，毫秒级开销）或虚拟化（VM/v86，重）。**中间没有第三种机制** —— WASM 管不了原生进程（§9.2），Node `vm` 模块不是安全边界（官方文档明示）。所以轻量方案 = 把 P3 内核进程隔离做扎实 + 用信任分级把"没有后端可用的场景"管起来，而不是堆更重的隔离。

### 10.2 VM 方案否决记录

| 方案 | 否决理由 |
| --- | --- |
| v86（纯 JS/WASM x86 VM） | RSS 300-500MB + CPU 慢 1-2 个数量级 + rootfs 200-400MB 供应链；边际收益是防内核级逃逸，而 T7（提权/内核逃逸）本就不在威胁模型内（§三） |
| vfkit（macOS Virtualization.framework） | 仅 macOS，引入 VM 生命周期管理；同上，收益不抵重量 |

### 10.3 轻量替代：workspace 信任分级

两级信任（持久化于项目级 settings，首次打开项目时询问）：

| 级别 | 语义 | bash | write/edit/read | mcpServers |
| --- | --- | --- | --- | --- |
| **trusted**（默认） | 用户自己的项目 | P3 后端（有则隔离，无则现状 + UI 提示） | P0 闸门 + P0.5 ask 收窄（现状） | 现状 |
| **quarantine** | 新 clone 的不可信仓库、代码审查场景 | 有 P3 后端 ⇒ **强制沙箱**；**无后端 ⇒ 每条 bash 强制 ask** | `PathGrant` 收紧：out-cwd 读写全 deny（fail-closed，不询问） | 不自动加载，先确认（与任务 #20 叠加） |

**关键设计点：quarantine 零新基础设施。**

- "每条 bash 强制 ask"直接复用现有 `forceAskScopes` 机制（`session.ts:3449` plan mode 同款）：quarantine 会话把 bash 相关的副作用 scope 全集塞进 `forceAskScopes`，一行编排改动，无新子系统。
- "out-cwd 读写全 deny"是 P0 闸门的 grant 派生参数变化（`allowWriteOutsideRoots`/`allowReadOutsideRoots` 恒 false + forceAsk 不豁免），同样是编排层改动。
- mcpServers 不自动加载是 settings 合并策略（`settings.ts:640`）加一个信任级别条件。

### 10.4 诚实边界（必须写进 UI 与文档）

1. **quarantine 无 P3 后端时，bash 的隔离强度 = "每条都问 + 全量审计"，不是真隔离。** UI 必须明示当前级别与后端状态（约束 6 延伸）。真隔离需求（防内核逃逸）明确不做 —— T7 不在威胁模型。
2. **VM 否决不影响 P0 优先级**：P0 闸门在 quarantine 下是主防线（out-cwd 全 deny），它依然是全方案的施工起点。
3. **WSL2 的定位说明**：WSL2 技术上也是 VM，但它是 OS 管理的轻量工具 VM（近原生 CPU、秒级启动、动态内存），与被否决的 v86（模拟 CPU、解释执行）不在一个重量级；它是 Windows 平台上不新增原生构建的**唯一**真实隔离，保留为 P3 后端。若未来用户连 WSL2 也不要，Windows 回退为"P0 闸门 + quarantine 全量 ask + 诚实宣称"，这是已声明的可接受残余风险。
