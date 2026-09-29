---
id: moonviz-engine-replacement
type: design
status: draft
depends-on: []
covers: [prototype-stack, moonviz-wasm, engine-seam, moonviz-contract, ddp-codec]
tags: [engine-replacement, prototype, moonviz]
---

# MoonViz 引擎更换——原型模块生成栈替换（moonviz-engine-replacement）

> **状态**：**主体收官**（2026-09-29 实施批：P0–P3 全部落地——vendor 管线 + 接缝 + P0 电池 20 项全绿（[p0-report.md](./p0-report.md)）+ OpenUI 物理删除与 moonviz 全栈替换（core 1192 / desktop 806 测试全绿）+ DDP codec 与黄金向量 + export-ddp 动作。遗留移交预生产：打包形态实测、真机 GUI 走查；DDP1 密码 UX 维持决策 7 遗留）。
> **设计基准**：[docs/engine-integration-plan.md](../../docs/engine-integration-plan.md) **v5.2**（实现级详案；基线 = 引擎 main @ `2c34ac0`（tag `engine-v0.1.7`，ENGINE_VERSION `0.1.7`；**`wasm/main.mbt` 自 0.1.6-fix 零变更，deepDesign 生产背书经同一 wasm 边界传递**）+ deepDesign 生产参照 `@main 68c33af`（锚仍 0.1.6-fix，宿主协议未变））——引擎事实基线 / deepDesign 生产协议移植清单（含 #12 双门探针）/ 删除与不动清单（精确到文件与符号）/ 接缝与薄合同 / 工件模型 / Gate 回灌 / DDP 编解码 / 拍板决策（**12 项**）/ P0–P3 路线**均以基准文档为唯一权威**，本稿只做立项定位、对账与门槛，不重复其内容。
> **单目标纪律（v5.1 硬约束）**：本项目**只消费 wasm-gc SDK**，不采用标准/classic 版本，不存在双目标兜底设计——宿主不满足 js-string builtins 即实例化硬失败并给诊断。
> **前置约束**（基准文档总纲，不变）：可验证、可回滚、可并行。
> **生产参照**（deepDesign，协议权威）：`src-tauri/src/wasmtime_host.rs`（会话缓存/脏缓存弃置/内存棘轮/泄漏探针/编排纪律）、`scripts/sync-engine.mjs`（GitHub Releases 产物锚点 + 实例化契约探针 + 组件快照）、`vendor/moonviz-ddp/src/lib.rs`（DDP 格式黄金参照）。
> **姊妹/对账**：[prototype-reliability](../archive/prototype-reliability/design.md)（冻结——其 §4 引擎重规划底座的承接线，§0.1）；[leafer-ui-engine](../archive/leafer-ui-engine/design.md) / [clay-ui-runtime](../archive/clay-ui-runtime/design.md)（均已收官——不同子域，§0.2）；[design-stage-gates](../archive/design-stage-gates/design.md)（已归档——质量门映射，§0.3）；[prompt-doc-chain](../archive/prompt-doc-chain/design.md)（冻结——链路环节替换，§0.4）。

---

## 0. 对账

### 0.1 与 prototype-reliability（冻结）的对账

该 spec 的四工作包（三端断链/设备修订基线/导航闭包 gate/预览一致性）是 **OpenUI 栈上的可靠性根治**，随栈冻结——**不随本 spec 复活、不在 moonviz 栈上重做**。其 §4「原型绘制引擎重规划开放决策底座」即本 spec 的立项缘起；其可靠性诉求由新栈结构性承接（基准文档 §2.2 质量门：结构/交互门 → 引擎 AgentGate 随 op 内建；页面覆盖 → 合同层比对；三端 → 单文档三画板 + 平台契约句；**视觉质量 → `session_lint`/`session_critique` 引擎直调**——v2 立项时的 pending 项已随引擎 wasm 全量面关闭；**交互行为 → `session_tap` 点击仿真**，检查从「声明存在」升级为「行为可达」）。

### 0.2 与 leafer-ui-engine / clay-ui-runtime（均已收官）的对账——不同子域，互不替代

三层定位纪律不变：本 spec 动的是**原型生成栈**（PM-Design / 原型，替换 `OpenUI Lang` 物化链）；leafer（创作引擎）/ clay（并行渲染导出）属 **UI-Design 视觉稿子域**，两者均已于 2026-09-19 代码核实收官。三条引擎线各归各的子域：原型生成栈（本 spec）、UI-Design 创作引擎（leafer）、UI-Design 渲染/导出运行时（clay）——互不阻塞、互不判废。

### 0.3 与 design-stage-gates（已归档）的对账——质量门映射沿用

五 stage 机械门与 OCR 分层失败语义的门域定稿沿用；在本栈的落点按基准文档 §2.2 映射表执行（结构合法性/交互流 → 引擎随 op 内建拒；页面覆盖/平台契约 → 合同层；**视觉质量 → `session_lint`/`session_critique` + `session_auto_fix` healing 手段，全量已在 wasm 导出面**；交互行为验证 → `session_tap` 逐 flow 命中断言）。Gate 回灌为**推进式**协议（引擎只报首个 `mbt_gate_block` 四段串），每轮上限 2、两轮未过动作失败附诊断不静默降级；`apply_human_op` v1 不对 Agent 开放。

### 0.4 与 prompt-doc-chain（冻结）的对账——链路环节替换，冻结件不回写

冻结件链路 `PRD(spec) → pm-design.md → 原型(OpenUI) → ui-design.md → UI(Leafer)` 中的「原型(OpenUI)」环节随 P2 替换为 moonviz。冻结 spec 原样保留不作回写；该依赖变化由基准文档 §4 工件模型承载（`content.openui` 作废、套件版本 payload 单 `moonviz.doc`、三端 = 单文档三画板 1200×800 / 768×1024 / 390×844）。

### 0.5 与 deepDesign 的关系——生产参照，非依赖

deepDesign 是同版本引擎的已上线 Tauri 宿主（wasmtime/classic 目标）：其**工程协议**（canonical 键控会话缓存、脏缓存全弃、内存棘轮 192MB 重建、泄漏/缓存探针、编排直调守卫、产物 sha512 锚点 + 实例化契约探针、组件快照入库）与 wasm 目标无关，整体移植进本设计（基准文档 §0.2 移植清单 + §6 决策 10）；其 **wasm-classic 目标专属实现**（`_in` 槽写契约、线性内存字符串指针解码）属 wasmtime 宿主细节，**不进本设计**（单目标纪律，基准 §6 决策 11）。deepDesign 对 DeepOrca 是参照物，无代码/运行时依赖。

## 1. 命题与拍板继承

**命题**：原型模块生成栈由 OpenUI Lang 替换为 **MoonViz wasm-gc 引擎（进程内直嵌）**——MBT 单文档多画板模型，经**无状态批式导出面（12 个）+ 有状态 Session 句柄面（`session_open → Int` + 30+ session 方法，canonical 回传契约）**双面驱动 materialize / revise / verify 全链；执行模型 = **动作级会话（`withSession` 唯一编排入口）+ worker_thread 隔离**。

**拍板继承**（基准文档 §6，v5.2 十二项；上游 0.1.7 发版吸收后新增第 12 项，其余不重开）：

| # | 决策（摘要） | 状态 |
| --- | --- | --- |
| 1 | ~~主进程同步直调~~ → **worker_thread 隔离为默认**（V8 无 epoch 执行中断；deepDesign 实战确认挂死风险；超时 = terminate + 棘轮重建，canonical 键控 = 零语义损失） | v5.1 修订 |
| 2 | 三端变体 = 单文档三画板（尺寸实参化），删除 openuiVariants 三程序结构 | 维持 |
| 3 | 运行时 vendor 仅 wasm 资产（**GitHub Releases 直链 + sha512 锚点 + 实例化契约探针**，gc 变体唯一目标）；无本地构建 | v5.1 明确化（**T1.1 已落地**） |
| 4 | 预览 = iframe srcDoc 承载 export_html 产物；A2UI 物化链删除；inline fence 链删除 | 维持 |
| 5 | ~~wasm 全量面待上游导出~~ → **已关闭**：引擎 main @ 0.1.7 已全量导出 `lint/critique/fix/list_components/list_tokens/list_themes/list_ops`；组件词汇 = components.json 快照 + 运行时 `list_components` 直调校准 | 已关闭 |
| 6 | **DDP 编解码 TS 自建进程内实现**（`common/ddp-codec.ts`，格式黄金参照 = deepDesign 生产 vendor 同 crate + 黄金向量四项），不消费 `ddp_codec` 二进制 | 维持 |
| 7（遗留） | DDP1 密码 UX 待定——仅阻塞 `export_ddp` 动作 UI，不阻塞 codec 与 P1/P2 | 维持 |
| 8 | 执行模型 = 动作级 `withSession` 唯一编排入口 + canonical 契约强制履行 + 泄漏探针 + 批式直通（单步校验/渲染/发现类） | v5 新增 |
| 9 | 基线纪律：只消费引擎 **main** 产物（当前锚点 `engine-v0.1.7` @ `2c34ac0`，随发版滚动升锚）；`release/1.0` 不进依赖、不预消费其 API 冻结承诺 | v5 新增（v5.2 锚点已升至 0.1.7） |
| 10 | **deepDesign 生产协议移植清单**：canonical 键控会话缓存/脏缓存全弃/内存棘轮 192MB/编排直调守卫/产物 sha512 锚点 + 实例化契约探针/组件快照入库——以 `wasmtime_host.rs` + `sync-engine.mjs` 为参照权威 | v5.1 新增 |
| 11 | **单目标纪律：只 wasm-gc；标准/classic 版本不进设计、不进 vendor、不进代码路径，无双目标兜底**；宿主能力缺失走硬失败诊断 | v5.1 新增（硬约束） |
| 12 | **探针运行时纪律**：vendor 契约探针必须在 gc 能力运行时执行（`MOONVIZ_PROBE_BIN` → 仓库 Electron-as-node → Node ≥24，全无硬失败）；仓库 Node 20/22 探针失败 = 环境缺格而非引擎回归 | v5.2 新增 |

## 2. 不做清单

1. **不动 UI-Design 子域**（leafer/clay 领域）与 **A2UI 基础设施**（保留 DeepOrca 自身 UI 用途）。
2. **不迁移存量 `content.openui`**：替换提交合入即作废（不迁移、不渲染）；合入前跑一次 designs 存量清单，需留样手工处理。
3. **不消费 Rust 平台产物**（`ddp_codec` 二进制不引入；`@noble/*` 等主进程执行依赖按仓库规则 exact-pin）。
4. **不新造 inline fence 等价物**——原型预览统一收敛到动作事件与工作区。
5. **不引入 classic wasm 目标与任何双目标兜底**（决策 11 硬约束）：`_in` 槽 codec、线性内存字符串解码属 deepDesign 宿主实现细节，不进 DeepOrca 代码路径。
6. **不接**：`session_history`（引擎级 undo/redo，DeepOrca 已有 suite versions，v2+ 评估）、`infer_*`/`extract_design_system`（v1.5）、`session_component_compile_b64`/`library_snapshot`（自定义组件，v2+）、渲染进程画布编辑器（二期，参照 deepDesign `frontend/`）。
7. **本稿不编码、不复制基准文档内容**——实现细节一律以 [engine-integration-plan.md](../../docs/engine-integration-plan.md) 为准；基准文档随实施推进更新版本（v5.2 → …）。

## 3. 启动门槛与上游节奏（v3 修订：已启动实施，基线随 main 升 0.1.7）

v1 立项时「上游仍有问题、迭代中」的前提已变化：引擎 main @ 0.1.6-fix 经 deepDesign 生产集成实战验证，且 **0.1.6-moon/0.1.7 两次发版 `wasm/main.mbt` 零变更**（工具链门 + mooncakes 打包 + SDK 门面 + CI 全流程，均为 wasm 消费者无感的打包侧演进）——基线稳定性由生产背书 + 边界源不变双重确立；当前锚点 `engine-v0.1.7`（`2c34ac0`），`scripts/vendor-moonviz.js` 已锁定并全绿。P0 电池验证本方接缝实现面（worker 隔离/缓存协议/契约往返等为主）；引擎侧回归由 vendor 契约探针（锚点/导出/**14 模板集合**/组件快照双门探针）拦。

| 阶段 | 门槛 |
| --- | --- |
| **P0 验收电池** | 无门槛，即可开工——电池（9 项，基准文档 §7）验证本方接缝实现面；引擎侧回归由 vendor 契约探针（锚点/导出/14 模板集合/组件快照 place 探针）拦；**资产与探针主进程侧已随 T1.1 闭合** |
| **P1 接缝周** | P0 报告产出后可开工（seam 单测 fixture 驱动，无 UI 依赖）；T1.1 已先行落地 |
| **P2 替换周** | **硬门槛：P0 全绿**；物理删除基准 §1 删除清单与替换同一提交 |
| **P3 闭环周** | P2 出口后；lint/critique/tap 检查项全量接入（能力已就位，纯本方接线）；DDP 另需密码 UX 拍板（决策 7） |

**回滚**：git revert 替换提交（P0 的意义即压低此概率）。**跟版本纪律**：引擎 main 每次发版 = 升 sha512 锚点 + 重跑实例化契约探针 + CI 黄金重放（deepDesign 同款升级动作：改锚点 + 过测试）；**0.1.6-fix → 0.1.7 已履行一次**（`wasm/main.mbt` 零变更，探针全绿，无需设计变更）。
