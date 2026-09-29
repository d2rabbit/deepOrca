# DeepOrca 原型模块生成栈替换设计 — OpenUI Lang → MoonViz wasm 引擎

> 状态：设计 v5.2（2026-09-29，实现级设计；**T1.1 vendor 管线已落地**，其余未编码）。基线 = **引擎 main @ `2c34ac0`（tag `engine-v0.1.7`，ENGINE_VERSION `0.1.7`）** + deepDesign 生产参照（`deepDesign@main 68c33af`，wasmtime classic 宿主，仍锚 0.1.6-fix——其宿主协议 `wasmtime_host.rs` 自 4ac1383 仅测试 import 移动，参照权威稳定）。接入形态：**wasm-gc 直嵌 Node（Electron 主进程 worker）**。
> v5.1 → v5.2（上游发版吸收 + 首个实现落地）：① 基线随引擎 main 升至 **0.1.7**（0.1.6-moon：moonc ≥0.10.14 工具链门 + CI 全流程；0.1.7：mooncakes 原生包更名 `asdshuaishuai/moonviz` + SDK 门面 + `list_ops` 计数 25→26 更正）——**`wasm/main.mbt` 自 f109d15 零变更，wasm 导出面与 0.1.6-fix 完全一致，升版零表面风险**；deepDesign 虽未升锚，其 0.1.6-fix 生产背书经"同一 wasm 边界源文件"传递成立。② 吸收 deepDesign issue **#12 双门探针语义**：组件探针统一位置的 AgentGate 拒=警告不硬失败（fill 宽组件 artifact），真实债登记上游。③ **事实修正**（对照 0.1.7 真机探针）：批式导出 **11** 个（v5.1 误写 12）；模板 **14** 个（8 mobile + 3 web + 1 pc + 2 adaptive，v5.1 误写 8，`templates.mbt` 自 f109d15 未变即已是 14）；`session_save` 返回 **project JSON**（`{ok, data}`）而非 canonical mbt——**canonical 唯一权威 = 变更信封的 `mbt` 字段**，`session_save` ↔ `session_open_project_json` 是 studio JSON 再水化通道（T0.2 判据随之修正）；`session_close` 成功返回 i32 `1`、`session_count` 直接返回 Int（非 JSON 信封）。④ **T1.1 落地**：`scripts/vendor-moonviz.js` 已实现并全绿（§3），npm `moonviz-engine-wasm` 已停滞于 0.1.1——GitHub Releases 直链消费的决策再确认。
> **单目标纪律（硬约束）：本项目只消费 wasm-gc SDK，不采用标准/classic 版本，不存在双目标兜底设计**——宿主不满足 js-string builtins 即硬失败并给诊断，任何场景都没有降级路径。
> 前置约束不变：可验证、可回滚、可并行。接口形状以 0.1.7 真机探针实测为准。

---

## 0. 事实基线（引擎 main @ 0.1.7 + deepDesign 生产实现，全部已核对源码 + 0.1.7 真机探针）

### 0.1 引擎 wasm 面（`moonviz@main`）

| 事实 | 出处 |
|---|---|
| 引擎侧存在双目标编译（引擎事实，仅陈述）：classic（WASM MVP，零 import，为 wasmtime 类非 V8 宿主而设——deepDesign 生产在用）与 **wasm-gc**（WasmGC + js-string builtins，MoonBit String ↔ 宿主 string 直通，无需手工编解码） | `wasm/moon.pkg` |
| **DeepOrca 单目标契约：只消费 wasm-gc，classic 不进本设计、不进 vendor、不进任何代码路径**。宿主要求 Node 24+/Chromium 119+；Electron 43.2.0 主进程实测 Node 24.18.0/V8 15.0 ✅；**实例化配方 = `new WebAssembly.Module(bytes, {builtins:["js-string"], importedStringConstants:"_"})`**（上游 `sdk/wasm/index.mjs` 权威）。不满足即实例化硬失败 + 可诊断错误，无降级分支 | 本机 `ELECTRON_RUN_AS_NODE` 实测 |
| 无状态批式导出 **11** 个（全 String→String JSON 同步）：`render_mbt/validate_mbt/apply_agent_op/apply_human_op/export_html/list_templates/list_components/list_themes/list_tokens/list_ops/version_info` | `wasm/main.mbt` |
| 有状态 Session 句柄面（`session_open(mbt)→Int`，空/非法源 **-1**）：变更类 7 个信封**回传 canonical `mbt`**（`apply_agent/human`、`constrain`、`auto_fix`、`generate_responsive`、`component_compile_b64`、`tap`、`history undo/redo/checkout`）；只读类 `lint/critique/query_nodes/list_artboards/flows/interactions/states/spec/infer_page_type/infer_missing/extract_design_system/export_svg/save/close/count/benchmark/library_snapshot/open_project_json`。**标量契约（0.1.7 实测）：`session_save`→`{ok, data: projectJSON}`（studio 序列化，↔ `session_open_project_json` 成对）；`session_close` 成功→i32 `1`；`session_count`→直接 Int** | `wasm/main.mbt`、deepDesign `SESSION_MUTATING[7]` |
| `version_info()` 动态注入 `@core.ENGINE_VERSION`（**`"0.1.7"`**）——版本握手真实可用 | `core/version.mbt:5`、`wasm/main.mbt:36` |
| op 语法全量（**26 条 mutating op**，0.1.7 计数更正）：`place <ab> <comp> <id> [variant|-] [x] [y] [w] [h] [k=v…]`（w/h 最终 bbox 门）、`interact/state/set-state/theme/token/responsive/restyle`；Gate 拒绝 = `mbt_gate_block:<画板>:<谓词>:<节点>` 单阻断四段串 | main SKILL.md、`decl/mbt.mbt`、`core/agent_api.mbt` |
| **模板 14 个**（8 mobile：login/signup/dashboard/profile/settings/list_detail/onboarding/empty_state；3 web：web_landing/web_login/web_dashboard；1 pc：pc_app；2 adaptive：adaptive_landing/login_v2） | `core/templates.mbt` |
| GitHub Releases 分发双变体资产：`moonviz-wasm-classic-<ver>.wasm` 与 `moonviz-wasm-gc-<ver>.wasm`（0.1.2 起资产版本与 tag 同步）；npm `moonviz-engine-wasm` 为 gc 变体的包形态但**已停滞于 0.1.1**——Releases 直链是唯一新鲜产物层。**本设计只消费 gc 变体，classic 资产不进 vendor 清单** | deepDesign `sync-engine.mjs`、npm registry |
| 0.1.6-fix → 0.1.7 上游增量（wasm 消费者视角）：moonc ≥0.10.14 工具链门 + CI 全流程（moon check/test + examples 可复现 + 双 wasm 构建 + classic ABI 断言 `check-wasm-abi.mjs`）+ mooncakes 原生包更名 `asdshuaishuai/moonviz`（只影响 MoonBit 原生宿主与 `moon.pkg` import 路径）+ SDK 门面 `sdk/sdk.mbt`（CLI/MCP/WASM/SDK 四面同源的第 4 面，MoonBit 宿主用，非本项目消费路径）。**`wasm/main.mbt` 零变更** | `git diff f109d15..2c34ac0` |
| DDP 容器（Rust 参照，deepDesign 生产 vendor 同 crate）：DDP2=`"DDP2"`+ver+CRC32-IEEE(zstd 帧,4B LE)+`zstd(mbt,8)`；DDP1=`"DDP1"`+ver+salt(16)+nonce(24)+XChaCha20-Poly1305(Argon2id m=19MiB,t=2,p=1,32B,v=0x13,aad=45B 头)；明文 ≤8MB/密文 ≤16MB/错误码 `ddp_*` | `deepDesign/vendor/moonviz-ddp/src/lib.rs` |
| 引擎红线：零 LLM、零网络、宿主持久化（IO-free） | docs/11 |

### 0.2 deepDesign 生产集成（`src-tauri/src/wasmtime_host.rs` 631 行，参照权威）

deepDesign 是引擎 0.1.6-fix 的**已上线生产宿主**（Rust/wasmtime/classic 目标；其锚点尚未随 main 升 0.1.7，但 `wasm/main.mbt` 自 0.1.6-fix 零变更，背书经同一 wasm 边界源传递）。以下协议经过生产验证，**与宿主语言和 wasm 目标无关，整体移植**：

| 实战协议 | deepDesign 实现 | 移植到 DeepOrca |
|---|---|---|
| **canonical 键控会话缓存**：mbt 为键，命中复用/失配关旧开新；变更信封 canonical 键前移 + 同句柄补画板索引（data 为数组才补） | `wasmtime_host.rs` 会话缓存编排 | `moonviz-engine.ts` 同构缓存 |
| **脏缓存弃置**：任何解析失败/腐坏读/trap 一律弃缓存——脏缓存会让重试落在幽灵提交上；`auto_fix/constrain/tap` 后弃缓存 | 同上（node 调试宿主仅 trap 弃缓存，是有意保留的调试对照，生产宿主全弃） | 同构全弃策略 |
| **内存棘轮**：bump 堆只增不减（实测 ~200 变更 op ≈ +37MB），超阈值整体重建实例；缓存按权威 mbt 键控，重建零语义影响 | `MEMORY_RECYCLE_BYTES = 192MB` | 同阈值移植（V8 wasm 同样只增不减） |
| **泄漏/缓存探针**：`session_count`（句柄泄漏契约）、缓存命中统计纳入诊断 | `session_count_probe`/`session_cache_stats` | 接缝诊断面 |
| **编排纪律**：`session_open/close/open_project_json/count` **拒绝业务直调**，必须经宿主编排层 | 同上 | `withSession` 唯一入口 + 直调守卫 |
| **产物锚点同步**：GitHub Releases 直链 + **sha512 锚点** + 实例化契约探针（必需导出在场/模板 id 集合对齐/组件快照逐个 place 探针/回归硬退出）+ 组件清单快照入库；**#12 双门观察（2026-09-28 收编）：统一探针位置 (10,10) 的 AgentGate 拒只是警告不硬失败——fill 宽组件（app_bar/tab_bar/navbar 等）在偏移处必触发 contained_in_parent，是探针 artifact 而非组件债；真实债登记上游 `AGENT_GATE_DEBT`** | `scripts/sync-engine.mjs`（产物层获取的现成实现） | `scripts/vendor-moonviz.js` 同构改写（已落地，§3） |
| **挂死是真风险**：30s CALL_TIMEOUT + wasmtime epoch interruption 真中断 + 中断后实例毫秒级重建 | `EPOCH_TICK_MS=100` 看门狗线程 | **V8 无执行中断** → worker 隔离（§2.1） |
| **初始化失败可重试**：init 槽 RwLock，失败不缓存、reset 可清（无「首次失败终身粘滞」） | issue #1-B | 引擎单例懒加载同语义 |
| 画布前端集成参照：拖拽/ink 标注/组件 SVG 图标/热区 demo，写路径经 `engSlotLoad` | `frontend/` | 二期画布编辑器参照（v1 不做） |

## 1. 替换范围与不动点（v5 结论不变）

**删除清单**（P2 一次提交物理删除）：core 侧 `openui-contract.ts`（QUALITY 合同改写 moonviz 词汇、三端平台契约句原样迁入 `moonviz-contract.ts`）、`openui-pages.ts`+测试、`design-gates.ts` 内 `pageCoverageFindings/openuiInteractivityFindings/programPageCount`（`runDesignStage`/`callSubagentStable`/`pmSectionsAudit` 保留）、`prototype.ts` openui 路径、`settings.ts`/`index.ts` openui 符号；desktop 侧 `render_openui`/`update_openui` 工具、`openui-library-schema.ts`（1956 行）+`openui-validate.ts`、`dd-package.ts` openui 管线、`App.tsx` inline fence 链、其余 openui 引用。**测试七个文件随栈等价迁移重写。**

**不动清单**：ActionRegistry/defineAction、动作 id 面（`spec/pmdesign/materialize/revise/verify` + design ui 链）、`.deeporca/designs/<id>/` 工件目录、`runDesignStage`、A2UI 基础设施、IPC 骨架、`leafer-*`、pm-design.md 链。

## 2. 架构与模块设计

```
┌─ 动作层（改造 prototype.ts / design.ts moonviz 路径）─────────────┐
│  子代理产出「op 计划」→ 接缝会话内分批 apply → Gate 回灌           │
├─ 薄合同层（core 新建 actions/moonviz-contract.ts）────────────────┤
│  MOONVIZ_SEED_DOC 种子 · 画板覆盖比对 · flows 存在性              │
│  平台/质量合同 prompt 材料 · 组件词汇=components.json 快照        │
├─ 引擎接缝（core 新建 common/moonviz-engine.ts）───────────────────┤
│  worker 隔离执行（§2.1）+ canonical 键控会话缓存（deepDesign 协议）│
│  withSession(doc,fn) 唯一编排入口 · 批式直通（render/validate…）  │
│  脏缓存全弃策略 · 内存棘轮 192MB 重建 · 泄漏/缓存探针             │
│  GateBlock 四段解析 · version_info 握手 · 每调用计时环形缓冲      │
├─ worker（desktop 新建 moonviz-engine-worker.ts）──────────────────┤
│  wasm-gc 实例宿主：createEngine(bytes) · 会话缓存本体 ·           │
│  callTimeout 超时 terminate + 棘轮重建（canonical 键控=零语义损失）│
├─ wasm 资产（desktop vendor，GitHub Releases 直链+sha512 锚点）────┤
│  vendor/moonviz/moonviz.wasm（≈337KB gc 变体）+ components.json   │
│  字节经 configureMoonvizEngine 注入 core（vendor 路径红线）       │
├─ DDP 编解码（core 新建 common/ddp-codec.ts，TS 自建）─────────────┤
│  格式黄金参照=deepDesign/vendor/moonviz-ddp（生产同 crate）；     │
│  zlib.zstd/crc32 + @noble/* exact-pin；仅 export_ddp（P3）        │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 执行模型：worker 隔离为默认（v5 决策 1 修订）

deepDesign 花了整个「超时语义」章节做 wasmtime epoch 真中断（30s 到点 `Trap::Interrupt`，wasm 帧安全展开，挂死 op 被真正打断）——这证明**引擎调用挂死是实战确认过的风险**，不是理论担忧。而 V8（Node/Electron）**没有 wasm 执行中断原语**：主进程直调挂死 = 事件循环阻塞到调用自然结束，等价于应用冻结。因此：

- **动作执行一律在专用 worker_thread**：主进程 postMessage 驱动（doc/op 计划 → `{canonical, artboards, findings}` 回传）。worker 内同步调用（wasm-gc 字符串直通，无 ABI 开销）。
- **超时 = terminate + 整体重建**（等价 deepDesign epoch 中断语义）：worker 内 `callTimeout`（初值 30s，对齐 deepDesign）由主进程看门狗执行——到点 `worker.terminate()` + 重建实例。**canonical 键控缓存让重建零语义影响**（deepDesign 已验证：缓存按权威 mbt 键控，重建后命中即恢复现场）。外层无第二重超时（worker 消息驱动天然解耦事件循环，不存在「锁排队」兜底问题）。
- **内存棘轮**（deepDesign 协议直移）：worker 维护实例内存水位，超 192MB 主动重建——V8 wasm bump 堆与 wasmtime 同样只增不减（~200 op ≈ +37MB 实测）。
- **会话缓存**（deepDesign 协议直移）：canonical 键控；变更信封 canonical 键前移 + 同句柄补画板索引；解析失败/腐坏读/terminate 一律弃缓存；`auto_fix/constrain/tap` 后弃缓存。动作级 `withSession(doc, fn)`（open→fn→save→close）仍是最外层纪律——缓存只是**同 worker 内同文档连续操作**（如 verify 多检查项）的加速层，跨动作不信任任何内存态。
- **编排守卫**：`session_open/close/open_project_json/count` 拒绝业务侧直调（deepDesign 纪律）；`session_count`/缓存命中统计进接缝诊断面。

### 2.2 薄合同层与质量门（v5 结论维持，供给面落实）

- `MOONVIZ_SEED_DOC`（`session_open("") = -1`，种子常量冷启动用一次）· spec↔canonical artboards 覆盖比对 · flows 存在性。
- **组件词汇供给（v5.1 落实）**：`components.json` 快照随 vendor 脚本入库（sync-engine.mjs 同款「真机 place 探针生成、入库快照」模式，wasm-gc 实例探针），动作层读快照供 prompt；进程内 `list_components`/`list_ops` 直调缓存作**快照校准通道**（快照优先、直调比对，漂移即告警）。**删除 v4.1 时代的手写静态片段方案。**
- 质量门：AgentGate（随 op）+ `session_lint`（WCAG/触控/间距/空容器）+ `session_critique`（8 原则）+ 合同层覆盖/flows + **`session_tap` 点击仿真**（flows 逐条命中→目标画板断言）——verify 检查项全量引擎直调。
- 后续阶段：`session_history`（引擎级 undo/redo，v2+）、`infer_*`/`extract_design_system`（v1.5）、`component_compile/library_snapshot`（v2+）。

## 3. vendor 与版本治理（GitHub Releases 产物层，deepDesign 模式同构——**T1.1 已落地**）

- **`scripts/vendor-moonviz.js`**（已实现并全绿；`sync-engine.mjs` 同构改写；文件名随 `build.mjs ensureVendored` 派生命名约定落定，spec 原案名 vendor-moonviz-wasm.js 作废）：
  - 锚点块：`ENGINE_VERSION "0.1.7"` + `moonviz-wasm-gc-0.1.7.wasm` 直链（**gc 变体唯一目标**；`MOONVIZ_WASM_URL` 覆盖；`MOONVIZ_WASM_FILE` 离线旁路但探针不减）+ **sha512 整文件锚点**（传输级另 pin sha256 交 vendor-download 拒收坏字节）；资产缺失/哈希不符/探针失败 → 硬失败，**不存在 classic 降级路径**
  - **探针运行时选择器**（决策 12）：`MOONVIZ_PROBE_BIN` → 仓库 Electron（`ELECTRON_RUN_AS_NODE=1`，Node 24/V8 15）→ 当前 Node ≥24；全无 = 硬失败诊断。仓库 Node 20/22 缺 js-string builtins，在其下探针失败是环境缺格而非引擎回归
  - **实例化契约探针**（硬失败语义）：版本握手（`version_info()` ↔ 锚点）；批式 11 + session 全量导出在场；**14 模板 id 精确集合**（漂移即硬退出，升版必须有意为之）；组件 ≥65 且逐个 place 探针（**#12 双门语义**：AgentGate 拒=gateDebt 警告入 manifest，全失败才硬退）；会话往返（`session_open("") = -1` / template+place 信封 canonical / `session_save`→project JSON 重水化 / close→1 / count→0 / 重开 canonical 会话 SVG ↔ 批式 render 逐字节一致）；GateBlock 四段正则
  - 产出：`vendor/moonviz/{moonviz.wasm(329KB), components.json(65 组件快照), manifest.json(锚点/模板数/gateDebt/探针运行时)}` + `.vendored-moonviz-version` marker（幂等跳过：marker+哈希双核对）；`build.mjs ensureVendored("moonviz", …)` 已接线，`electron-builder` extraResources 全量拷贝 `vendor/` 自动携带；vendor-notice MANIFEST 已登记（MIT）
- **版本握手**：marker `engineVersion` ↔ 实例 `version_info()` 启动比对，主次不匹配拒绝实例化。
- **升级纪律**：引擎 main 发版 → PR 升锚点（双哈希）+ 契约探针 + CI 黄金重放 → 合入。0.1.6-fix → 0.1.7 已履行一次该动作。
- **DDP**：TS 自建维持；黄金参照指定为 **`deepDesign/vendor/moonviz-ddp/src/lib.rs`**（生产在用的同 crate），黄金向量四项不变（login-demo.ddp 逐字节解密/自建加密回灌 wasm/Rust 夹具互解/错误码同名）。`@noble/*` exact-pin。

## 4. 动作面（v5 骨架不变，worker 化适配）

| 动作 | 输入 | 调用（worker 内同步，主进程异步） | 产出 |
|---|---|---|---|
| `prototype.moonviz_create` | 需求 spec + 可选主题/画板清单 | `withSession(SEED)` → op 批（`template`14 套→`place w/h`→`interact/state`→`token/theme`→image `src`→可选 `constrain`）→ `save` | `doc.mbt.md` + 画板 SVG + `prototype.html` |
| `prototype.moonviz_revise` | 工件 id + 修订指令 | `withSession(磁盘 doc)` → 增量 op 批 → 同会话修复循环 → `save` | 新 revision |
| `prototype.moonviz_export_ddp` | 工件 id + 密码（可空，P3） | `ddp-codec.ts` 进程内（空密码→DDP2） | `.ddp` |

工件模型/三端单文档三画板/存量作废——v4.1 §3.2/3.3 全文维持。修复循环：apply 拒绝信封 `{ok:false,error:"mbt_gate_block:…"}` → GateBlock 回灌 → 同会话重放（失败 op 不入 history）→ 每轮上限 2。

## 5. 预览与交付（v5 结论不变）

iframe srcDoc 承载 `prototype.html`（CSP 收敛评估 + P0 冒烟）；每画板 SVG 进聊天/工作区；A2UI 物化链删除；两个 `.ddp` 消歧不变。二期画布编辑器参照 deepDesign `frontend/`（拖拽/ink/热区已生产验证），经 worker 直嵌 wasm-gc 实现编辑态即时重渲。

## 6. 决策记录（v5 → v5.2）

| # | 决策 | 状态 |
|---|---|---|
| 1 | ~~主进程同步直调 + 超阈值再 worker~~ → **worker_thread 隔离为默认**：V8 无 epoch 中断，挂死=事件循环冻结；deepDesign 实战确认挂死风险并投入真中断方案，Node 宿主等价物 = terminate+棘轮重建（canonical 键控=零语义损失） | **修订** |
| 2 | 三端单文档三画板；3 | 维持 |
| 4 | iframe srcDoc 预览；A2UI 物化链+inline fence 删除 | 维持 |
| 5 | ~~导出缺口等上游~~ 已关闭：lint/critique/fix/components/tokens/themes/ops 全进 wasm 面 | 维持（关闭） |
| 6 | DDP TS 自建；黄金参照锚定 deepDesign 生产 vendor（同 crate） | 维持（参照锚定） |
| 7（遗留） | DDP1 密码 UX（仅阻塞 export_ddp UI） | 维持 |
| 8 | 动作级 withSession 唯一编排入口 + canonical 契约强制 + 泄漏探针 | 维持（+直调守卫） |
| 9 | 基线纪律：只消费引擎 main；release/1.0 不进依赖（当前锚点 `engine-v0.1.7` @ `2c34ac0`，随 main 发版滚动升级） | 维持 |
| 10（v5.1 新） | **deepDesign 生产协议移植清单**：canonical 键控会话缓存/脏缓存全弃/内存棘轮 192MB/编排直调守卫/产物 sha512 锚点+实例化契约探针/组件快照入库——全部以 `wasmtime_host.rs`+`sync-engine.mjs` 为参照实现 | **新增** |
| 11（v5.1 新） | **单目标纪律：只消费 wasm-gc SDK；标准/classic 版本不进设计、不进 vendor、不进代码路径，无双目标兜底**。宿主能力缺失走硬失败诊断（实例化报错明确列出 WasmGC/js-string builtins 要求与实测版本）；classic 目标专属的 `_in` 槽 codec 属 deepDesign wasmtime 宿主实现细节，不进本设计 | **新增（硬约束）** |
| 12（v5.2 新） | **探针运行时纪律**：vendor 契约探针必须在 gc 能力运行时执行——选择器 `MOONVIZ_PROBE_BIN` → 仓库 Electron-as-node → Node ≥24，全无硬失败诊断；仓库 Node 20/22（.nvmrc=22）缺 js-string builtins，其探针失败视为环境缺格而非引擎回归（0.1.7 落地时实测确立） | **新增** |

## 7. 验收电池（Phase 0）与路线

1. **宿主与资产**：wasm-gc 实例化（主/worker 双验证 + 打包形态路径）；vendor 探针全链（锚点版本/导出在场/**14 模板集合**/组件快照 place 探针）——**探针链已随 `scripts/vendor-moonviz.js` 落地并全绿（主进程侧）**，worker 内与打包形态验证仍待 P0 电池；不匹配拒绝路径
2. **canonical 黄金往返（核心判据，v5.2 判据修正）**：`examples/login-demo.mbt.md` → open → 固定 op 序列逐 apply → **每步信封 canonical（`mbt` 字段）为权威** → close → 重开 canonical 渲染逐字节一致；批式 `render_mbt` 与会话路径输出一致；`session_save`→project JSON → `session_open_project_json` 再水化渲染等价（canonical 与 studio JSON 是两条序列化通道，save 不回传 mbt）
3. **会话缓存协议**（deepDesign 移植验证）：同 canonical 命中复用；变更后键前移；`auto_fix/constrain/tap` 后弃缓存；解析失败弃缓存；重建后缓存恢复（棘轮/terminate 重建零语义断言）
4. **worker 隔离**：超时 terminate 路径（构造长调用）；terminate 后主进程零副作用、重建毫秒级恢复；worker 内 trap 不传染主进程
5. **载荷形状**：GateBlock 四段/lint/critique/flows/spec 信封断言；`export_html` 结构 + 真浏览器点击冒烟
6. **tap 行为验证**：login-demo 交互流逐条 `session_tap` 命中断言
7. **内存棘轮**：多轮 op 内存水位曲线；192MB 重建触发与恢复
8. **种子闭环**：SEED → template → delete 种子板 → save → 重载一致
9. **CSP 冒烟** + **DDP 黄金向量**（P3 前，四项不变）

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0 验证周** | 上述电池；锚点锁 **0.1.7**（✅ 已随 vendor 脚本锁定）；vendor 探针主进程侧已全绿 | 报告全绿 |
| **P1 接缝周** | ~~vendor 脚本（锚点+探针+快照）~~（✅ T1.1 已落地）+ worker + `moonviz-engine.ts`（缓存协议/探针/守卫）+ `moonviz-contract.ts` + CI 黄金重放 | 接缝单测全绿 |
| **P2 替换周** | 三动作 + 预览分支 + `.ddp` moonviz 管线；同提交删除 §1 全部清单 | 一句话→三画板可交互原型；`git grep -i openui -- packages/` 零命中 |
| **P3 闭环** | export_ddp + lint/critique/tap 全量 + infer 类增益（v1.5） | 日常完整走 moonviz 栈 |

**回滚**：git revert 替换提交。**回归防线**：测试等价迁移（devices→画板尺寸/repair→Gate 回灌/coverage→合同层比对），P2 出口断言复核。

---

*参照材料：引擎 `moonviz@main 2c34ac0`（tag `engine-v0.1.7`；`wasm/main.mbt` 边界权威、`SKILL.md` op 语法、`sdk/wasm/index.mjs` gc 实例化配方 + `sdk/wasm/test/selftest.mjs` 最小文档、`examples/` 黄金、`core/templates.mbt` 14 模板）；**deepDesign@main 68c33af**（锚仍 0.1.6-fix；`src-tauri/src/wasmtime_host.rs` 会话缓存/棘轮/纪律权威、`scripts/sync-engine.mjs` 产物锚点+双门探针权威、`frontend/vendor/` 产物形态、`vendor/moonviz-ddp/src/lib.rs` DDP 格式参照）；DeepOrca 现状（`prototype.ts`/`openui-contract.ts`/`design-gates.ts` 替换对象；`scripts/vendor-moonviz.js` 已落地 vendor 管线）。`release/1.0` 不进依赖。*
