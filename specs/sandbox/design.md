# 沙箱与副作用收口 — 设计方案

> 日期：2026-08-15 · 状态：设计定稿（P0.5 已实现，其余未实现）
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
> 2. **能力传递取代环境权限（capability over ambient authority）**——权限决策已在 `session.ts:3369` 算出，但只用于"是否放行分发"，放行后 handler 以宿主全权限运行。核心改造是把决策**下传**给 handler 强制执行。
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
第 3 层 OS 级隔离（P2/P3）    ← 纵深防御，单后端起步，诚实宣称
        Sans-IO PolicyEngine + macOS sandbox-exec
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
| 符号链接加固的项目边界判定 | `permissions.ts:633-655` `isPathInProject` + `:657-663` `safeRealPath` | ✅ 已加固（双端 realpath，失败回退词法 `path.relative`），注释标注 "deep review 2026-08-15, B3" |
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
| **G1. 边界检查不参与执行** | `isPathInProject` 的调用点只有 `permissions.ts:230,241,252`，全部在 `describeToolPermissionRequest` 内做 scope 归类。`write-handler` / `edit-handler` / `read-handler` / `file-utils` **均不调用** | 一旦 `write-out-cwd` 被判为 allow（`defaultMode:"allowAll"` 即默认如此），`write` 可写入磁盘任意绝对路径并创建父目录链，**无第二道检查** |
| **G2. 权限决策不下传** | 决策在 `session.ts:3369` 算出，在 `:4688` 用于"是否放行分发"；`ToolExecutionContext`（`tool-types.ts:28-42`）**不含任何权限字段** | handler 放行后以宿主全权限运行 = 环境权限（ambient authority）。持久化的 always-allow（`permissions.ts:696`）会把一次授权变成永久全盘授权 |
| **G3. `onBeforeFileMutation` 无法否决** | 签名 `(filePath: string) => void`（`tool-types.ts:38`），同步、可选链调用、无 `if`/`await`/`try`（`write-handler.ts:100`、`edit-handler.ts:320`） | 不能作为策略拦截点。抛异常虽能中断写入，但被 `executor.ts:271-284` 归类为 `INTERNAL` 错误，与崩溃不可区分 |
| **G4. 无 OS 级隔离** | `bash-handler.ts:161` 裸 spawn 继承父进程全部权限 | 命令内的任意行为不受约束（这是原方案唯一说对的缺口） |

> 更正上一轮评审中我的一处表述：曾建议"用 `onBeforeFileMutation` 作为 fs 拦截点"。按 G3，该钩子是 checkpoint 机制、不可否决，**不应重载它**。P0 改为独立的显式闸门（§4.1）。

---

## 三、威胁模型

先定义威胁，再谈机制 —— 原方案缺这一步，导致为不存在的问题（会话级 drain/grace）建模。

| ID | 威胁 | 载体 | 现状 | 本方案覆盖 |
| --- | --- | --- | --- | --- |
| **T1** | 模型被诱导写/删项目外文件（`~/.ssh/authorized_keys`、shell rc、`~/.claude/settings.json`） | `write`/`edit` 工具，A 级 | ⛔ **allowAll 下无任何阻挡** | **P0 + P0.5**（主目标，两者互为补全） |
| **T2** | 模型读取项目外敏感文件并外泄（凭据、密钥） | `read` 工具 + 网络，A 级 | ⛔ 仅 128MB 上限 | **P0** 闸门 + **P1** 审计（读侧刻意不强制 ask，理由见 §4.2c） |
| **T3** | bash 命令内的任意副作用（含绕过 T1/T2 闸门） | bash 工具，A 级 | ⛔ 无隔离 | **P0.5** 削减越界破坏性命令（`inferBashSideEffects`）+ **P3** OS 隔离（仅 macOS） |
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
  /** 允许写入的根目录集合（已 realpath 归一化） */
  readonly writeRoots: readonly string[];
  /** 允许读取的根目录集合 */
  readonly readRoots: readonly string[];
  /** 显式放行的单个路径（快照/临时文件等豁免，对应现有 readPermissionExemptPaths） */
  readonly exemptPaths: readonly string[];
};

export type GateVerdict = { ok: true } | { ok: false; reason: string; scope: PermissionScope };

export function gateWrite(grant: PathGrant, filePath: string): GateVerdict;
export function gateRead(grant: PathGrant, filePath: string): GateVerdict;
```

**TOCTOU 处理**：对**父目录**做 `realpath`（目标文件可能尚不存在），再拼回 basename 做包含判定 —— 复用 `safeRealPath` 现有的"realpath 失败回退词法"策略。这与 `isPathInProject` 已有的加固思路一致，不引入新语义。

**(b) 决策下传**

`ToolExecutionContext`（`tool-types.ts:28-42`）新增一个字段：

```ts
/**
 * 本次工具调用被授予的路径能力。由 SessionManager 从已算出的权限计划派生
 * （见 session.ts:3369 computeToolCallPermissions）。缺省 undefined ⇒ handler
 * 退化为"仅 projectRoot"，即 fail-closed。
 */
pathGrant?: PathGrant;
```

- 派生点：`session.ts:4663` `appendToolMessages` 内，已有 `permissionPlan`，据其把 `write-out-cwd`/`read-out-cwd` 是否 allow 翻译成 `writeRoots`/`readRoots`。
- 消费点：`write-handler.ts`（`ensureParentDirectory` **之前**）、`edit-handler.ts:321` 之前、`read-handler.ts` 读取之前。
- 拒绝时返回**权限类错误**（复用 `permissions.ts:88-108` 的措辞风格），不是 `INTERNAL`。

**(c) 底层兜底**

`file-utils.ts` 的 `writeTextFile` / `ensureParentDirectory` 是公开导出（`index.ts:120`），desktop 也能直接调。加一个模块级可选的"已授权根"断言，未初始化时不改变行为（避免破坏现有 desktop 调用），初始化后越界抛出。这是纵深防御，不是主闸门。

**验收**

| 断言 | 方式 |
| --- | --- |
| `defaultMode:"allowAll"` 下，`write` 到 `/etc/xxx` 被拒 | 新增 `tests/path-boundary.test.ts` |
| `write` 到 `<root>/../evil` 被拒，且**父目录未被创建** | 同上（验证 `mkdir -p` 也在闸门内） |
| 项目内经符号链接指向 `/etc` 的路径被拒 | 复用 `isPathInProject` 已有的 symlink 用例形态 |
| `read-out-cwd` 显式 allow 时，越界读放行 | 同上 |
| `pathGrant` 缺省时退化为 projectRoot-only（fail-closed） | 同上 |
| 既有 `permissions.test.ts` / `tool-handlers.test.ts` 全绿 | `npm test -w @deeporca/core` |

**风险**：现有 always-allow 用户升级后可能突然被拒 —— 需确认 `writeRoots` 派生逻辑忠实反映持久化的 allow 列表，否则是功能回退。这是本阶段唯一的兼容性风险点，必须有测试覆盖。

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

### 4.5 P3 — 单后端 OS 隔离：macOS `sandbox-exec`（1-2 周）

只做 macOS（主力平台）+ `noop`（其余平台）。

- 机制：`sandbox-exec -p <profile>` 包裹 `bash-handler.ts:161` 的 shell。profile 由 PolicyEngine 从 `PathGrant` 生成（`deny default` + `allow file-read*`/`file-write*` 限定子树 + `deny network*` 视 `network` scope）。
- **已知约束**：`sandbox_init` 自 macOS 10.14 起 deprecated，`sandbox-exec` CLI 仍可用（Claude Code / Codex 走同一条路）。需在 profile 生成处注释标注，并在 probe 失败时 fail-open 到 noop + 审计告警。
- 集成点：**不是**原方案设想的"扩展 `Spawner`" —— bash 不走 `Spawner`（`bash-handler.ts:1` 直接 `import { spawn }`）。改为在 `bash-handler` 内经 `ToolExecutionContext` 取隔离器，与 `pathGrant` 同源。
- 验收：沙箱内 `cat ~/.ssh/id_rsa` 失败；`touch /tmp/x` 视 profile 成败符合预期；`network` deny 时 `curl` 失败；probe 失败时退化 noop 且审计有记录。

**明确否决 Linux/bwrap 进入本阶段**，理由见 §五。

---

### 4.6 P4 — MCP 进程隔离（独立课题）

T4 的收益可能高于 T3，但改造面在 `mcp-manager.ts:455-529` 与 settings 合并策略（`settings.ts:640` 项目级覆盖用户级）。建议独立立项，本方案只登记不展开。最小可行改动：**项目级 `settings.json` 新增/修改 `mcpServers` 时强制用户确认**，成本远低于进程隔离。

---

## 五、被否决的部分与理由

| 原方案项 | 判定 | 理由 |
| --- | --- | --- |
| 扩展 `Spawner` 接口作为集成点（§4.1） | ❌ | bash 不走 `Spawner`（`bash-handler.ts:1`）。`Spawner` 只被 `actions/browser.ts` 用于 `bsk`。扩展它对主威胁零收益 |
| `class BashHandler { constructor(spawner, sandboxManager) }`（§4.3） | ❌ | 无此类。实际是自由函数 `handleBashTool(args, context)`（`bash-handler.ts:45`）。seam 是 `ToolExecutionContext` |
| `permissionsToSandboxPolicy(permConfig)`（§4.2） | ❌ | 实际类型 `PermissionSettings{allow,deny,ask,defaultMode}`，无 `network`/`timeoutMs`/`env` 字段；6/9 个 scope 名不存在。编译不过 |
| 6 态生命周期 + Draining/grace（§2.2） | ❌ | 桌面应用无会话结束事件，无触发条件。为不存在的问题建模 |
| deadline expiry + alarm/wake（§2.4/2.5） | ❌ | 现有 `bash-timeout` + `killProcessTree` 已覆盖真实需求（含中途延长，原方案未提） |
| Linux bwrap 后端（§3.6） | ❌ 本阶段 | ①`--dev-bind / /` 是**可读写**挂载全根并授予设备访问，注释却写"只读"，这一行抵消整个沙箱；②`--proc /proc` 与随后 `--ro-bind /proc /proc` 冲突；③`--unshare-all` 已含 `--unshare-net`；④Landlock 只在注释里，无实际调用（需原生 helper，违反约束 4）；⑤AppImage 内嵌套 user namespace 是已知雷区；⑥bwrap 非默认安装 |
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

P3 完成后对外可宣称的能力，逐格必须与实现一致：

| 平台 | 边界闸门 + ask 收窄（P0/P0.5） | 审计（P1） | 策略引擎（P2） | OS 隔离（P3） | 对外表述 |
| --- | --- | --- | --- | --- | --- |
| macOS arm64/x64 | ✅ | ✅ | ✅ | ✅ `sandbox-exec` | "进程级隔离 + 路径边界" |
| Windows | ✅ | ✅ | ✅ | ❌ noop | **"仅策略层与路径边界，无 OS 隔离"** |
| Linux (AppImage/deb) | ✅ | ✅ | ✅ | ❌ noop | **"仅策略层与路径边界，无 OS 隔离"** |

三个平台的 P0/P0.5/P1/P2 完全一致（纯 TS，无平台依赖）—— 这也是把它们排在 OS 隔离之前的另一个理由：**一次投入，三平台受益**；而 P3 只覆盖三分之一的分发面。

---

## 七、任务清单

| # | 任务 | 阶段 | 落点 | 依赖 |
| --- | --- | --- | --- | --- |
| 1 | `common/path-boundary.ts`：迁移 `isPathInProject`/`safeRealPath`/`isPathInAnyDirectory`，新增 `gateWrite`/`gateRead` | P0 | 新文件 + `permissions.ts` 反向 import | — |
| 2 | `ToolExecutionContext.pathGrant` 字段 + `executor.ts` 透传 | P0 | `tool-types.ts:28-42`、`executor.ts:250-271` | 1 |
| 3 | `session.ts` 从 `permissionPlan` 派生 `PathGrant` | P0 | `session.ts:4663` 附近 | 2 |
| 4 | `write`/`edit`/`read` handler 接闸门（写侧须在 `ensureParentDirectory` 之前） | P0 | 三个 handler | 3 |
| 5 | `file-utils.ts` 底层兜底断言（可选初始化，默认不改行为） | P0 | `file-utils.ts:54-68` | 1 |
| 6 | `isDefaultedAllow()` 纯判定函数 | P0.5 | `permissions.ts:330` 后 | — |
| 7 | `getAllowedForcedAskScopes` 拆为两个过滤器 + `forceAskDefaultedScopes` 参数 | P0.5 | `permissions.ts:169-206`、`:64` options 类型 | 6 |
| 8 | `DEFAULT_FORCE_ASK_DEFAULTED_SCOPES` 常量 + 在 `computeToolCallPermissions` 调用处始终传入 | P0.5 | `session.ts:197` 附近 + `:3448` | 7 |
| 9 | `tests/path-boundary.test.ts` + `permissions.test.ts` 补 §4.2(d) 七条断言 | P0 | 测试 | 4,5,8 |
| 10 | `sandbox/audit.ts`（`hrtime.bigint` + `createHash` + JSONL 链式 hash） | P1 | 新目录 | — |
| 11 | `onPathGateVerdict` 钩子 + spawn 事件接入审计 | P1 | `tool-types.ts`、`session.ts` | 9,10 |
| 12 | `sandbox/types.ts` + `sandbox/policy.ts`（真实 10 scope） | P2 | 新文件 | — |
| 13 | 3 态 lifecycle + generation fencing | P2 | 新文件 | 12 |
| 14 | 路径级「始终允许」（持久化 `writeRoots` 取代 scope）—— 消化 §4.2(d) 残余风险 | P2 | settings schema + PermissionCard UI | 12 |
| 15 | `backend/interface.ts` + `noop.ts` + `detect.ts` | P3 | 新文件 | 13 |
| 16 | `backend/macos-sandbox-exec.ts` + profile 生成 | P3 | 新文件 | 15 |
| 17 | `bash-handler` 接隔离器 | P3 | `bash-handler.ts:161` | 16 |
| 18 | 项目级 `mcpServers` 变更强制确认 | P4 | 独立立项 | — |

**建议执行顺序**：

- **PR 1 = 任务 1-9**（P0 + P0.5 完整闭环）。两者必须同批：只做 P0 而不收窄 allowAll，闸门会忠实放行 allowAll 的越界写，T1 依旧敞开；只做 P0.5 而不做 P0，权限层判 ask 之后 handler 仍无二次校验，绕过路径（如 snippet_id 解析、`file-utils` 直接调用）依旧存在。**两者互为补全，分开发布任一半都是假修复。**
- **PR 2 = 任务 10-11**（审计总线）。
- **PR 3+ = 任务 12-17**。其中 12/13 为纯逻辑、零 I/O，与当前 routing 分支正交，可并行动工。
- 任务 18 独立立项。


---

## 八、与当前分支的关系

当前分支 `fix/stabilize-data-loss-and-test-suite` 的改动（`routing/telemetry.ts`、`routing-gating.test.ts`、`skill-metadata.test.ts`）与本方案**无文件级冲突**。

但 P0 会触碰 `session.ts`（5108 行）与三个 tool handler —— 这是全仓测试刚转全绿的区域（见 commit `ef1050f1`）。建议 P0 单独成 PR 并跑全量 `npm test`，不与 routing 工作混在同一提交。
