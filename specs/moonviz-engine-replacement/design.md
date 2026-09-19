---
id: moonviz-engine-replacement
type: design
status: draft
depends-on: []
covers: [prototype-stack, moonviz-wasm, engine-seam, moonviz-contract, ddp-codec]
tags: [engine-replacement, prototype, moonviz]
---

# MoonViz 引擎更换——原型模块生成栈替换（moonviz-engine-replacement）

> **状态**：立项稿（2026-09-19 立项，**待启动——上游 moonviz 引擎自身仍有问题、在迭代中**，用户立项时点拍板）。启动门槛见 §3：P1 接缝周可先行（引擎 mock/fixture 驱动），**P2 替换周（物理删除 OpenUI）必须上游问题收敛 + P0 电池全绿**。
> **设计基准**：[docs/engine-integration-plan.md](../../docs/engine-integration-plan.md) **v4.1**（实现级详案，228 行，未编码；对齐 `moonviz@99d91ab` 与 `feat/modern-ui-redesign` 现状盘点）——引擎事实基线 / 删除与不动清单（精确到文件与符号）/ 接缝与薄合同 / 工件模型 / Gate 回灌 / DDP 编解码 / 拍板决策 / P0–P3 路线**均以基准文档为唯一权威**，本稿只做立项定位、对账与门槛，不重复其内容。
> **前置约束**（基准文档总纲，不变）：可验证、可回滚、可并行。
> **姊妹/对账**：[prototype-reliability](../archive/prototype-reliability/design.md)（冻结——其 §4 引擎重规划底座的承接线，§0.1）；[leafer-ui-engine](../archive/leafer-ui-engine/design.md) / [clay-ui-runtime](../archive/clay-ui-runtime/design.md)（均已收官——不同子域，§0.2）；[design-stage-gates](../archive/design-stage-gates/design.md)（已归档——质量门映射，§0.3）；[prompt-doc-chain](../archive/prompt-doc-chain/design.md)（冻结——链路环节替换，§0.4）。

---

## 0. 对账

### 0.1 与 prototype-reliability（冻结）的对账

该 spec 的四工作包（三端断链/设备修订基线/导航闭包 gate/预览一致性）是 **OpenUI 栈上的可靠性根治**，随栈冻结——**不随本 spec 复活、不在 moonviz 栈上重做**。其 §4「原型绘制引擎重规划开放决策底座」即本 spec 的立项缘起；其可靠性诉求由新栈结构性承接（基准文档 §4.2 质量门映射：结构/交互门 → 引擎 AgentGate 内建；页面覆盖 → 合同层比对；三端 → 单文档三画板 + 平台契约句）。

### 0.2 与 leafer-ui-engine / clay-ui-runtime（均已收官）的对账——不同子域，互不替代

三层定位纪律不变：本 spec 动的是**原型生成栈**（PM-Design / 原型，替换 `OpenUI Lang` 物化链）；leafer（创作引擎）/ clay（并行渲染导出）属 **UI-Design 视觉稿子域**，两者均已于 2026-09-19 代码核实收官。三条引擎线各归各的子域：原型生成栈（本 spec）、UI-Design 创作引擎（leafer）、UI-Design 渲染/导出运行时（clay）——互不阻塞、互不判废。

### 0.3 与 design-stage-gates（已归档）的对账——质量门映射沿用

五 stage 机械门与 OCR 分层失败语义的门域定稿沿用；在本栈的落点按基准文档 §4.2 映射表执行（结构合法性/交互性 → 引擎随 op 内建拒；页面覆盖/平台契约 → 合同层；视觉质量项 → 待上游全量面 wasm 导出后接入 `lint_design/critique`，到位前 verify 视觉项诚实标注 **pending**，不冒充）。Gate 回灌为**推进式**协议（引擎只报首个 `mbt_gate_block`），每轮上限 2、两轮未过动作失败附诊断不静默降级；`apply_human_op` v1 不对 Agent 开放。

### 0.4 与 prompt-doc-chain（冻结）的对账——链路环节替换，冻结件不回写

冻结件链路 `PRD(spec) → pm-design.md → 原型(OpenUI) → ui-design.md → UI(Leafer)` 中的「原型(OpenUI)」环节随 P2 替换为 moonviz。冻结 spec 原样保留不作回写；该依赖变化由基准文档 §3 工件模型承载（`content.openui` 作废、套件版本 payload 单 `moonviz.doc`、三端 = 单文档三画板 1200×800 / 768×1024 / 390×844）。

## 1. 命题与拍板继承

**命题**：原型模块生成栈由 OpenUI Lang 替换为 **MoonViz wasm 引擎**——MBT 单文档多画板模型，经 7 个同步 `String→String` 无状态 wasm 导出（`render_mbt` / `validate_mbt` / `apply_agent_op` / `apply_human_op` / `export_html` / `list_templates` / `version_info`）驱动 materialize / revise / verify 全链。

**拍板继承**（基准文档 §6，v3 六项全部闭环 + 一项遗留，本稿不重开）：

| # | 决策（摘要） |
| --- | --- |
| 1 | 主进程同步直调 + 接缝计时观测；worker_thread 仅实测超阈值后无感切换 |
| 2 | 三端变体 = 单文档三画板（尺寸实参化），删除 openuiVariants 三程序结构 |
| 3 | 运行时 vendor 仅 wasm 资产；原生 CLI 仅 CI 对拍临时下载 |
| 4 | 预览 = iframe srcDoc 承载 export_html 产物；A2UI 物化链删除；inline fence 链删除 |
| 5 | **wasm 全量工具面由上游 moonviz 仓库直接导出**，DeepOrca 升 vendor marker 即接入 |
| 6 | **DDP 编解码 TS 自建进程内实现**（`common/ddp-codec.ts`，格式对齐 Rust 参照 + 黄金向量），不消费 `ddp_codec` 二进制 |
| 7（遗留） | DDP1 密码 UX 待定——仅阻塞 `export_ddp` 动作 UI，不阻塞 codec 与 P1/P2 |

## 2. 不做清单

1. **不动 UI-Design 子域**（leafer/clay 领域）与 **A2UI 基础设施**（保留 DeepOrca 自身 UI 用途）。
2. **不迁移存量 `content.openui`**：替换提交合入即作废（不迁移、不渲染）；合入前跑一次 designs 存量清单，需留样手工处理。
3. **不消费 Rust 平台产物**（`ddp_codec` 二进制不引入；`@noble/*` 等主进程执行依赖按仓库规则 exact-pin）。
4. **不新造 inline fence 等价物**——原型预览统一收敛到动作事件与工作区。
5. **本稿不编码、不复制基准文档内容**——实现细节一律以 [engine-integration-plan.md](../../docs/engine-integration-plan.md) 为准；基准文档随实施推进更新版本（v4.1 → …）。

## 3. 上游迭代应对与启动门槛（立项时点拍板：引擎仍有问题、迭代中）

上游 moonviz 由本方维护、仍在迭代修复——**立项不设「上游稳定」为硬前置**（决策 5 的跟版本 marker 机制 + P0 电池就是为迭代期设计的），但分期设门：

| 阶段 | 门槛 |
| --- | --- |
| **P0 验收电池** | 无门槛，即可开工——电池（9 项，基准文档 §7）同时是对**当前上游快照**的体检，已知问题在此暴露并记录 |
| **P1 接缝周** | P0 报告产出后可开工（引擎 mock / fixture 驱动，无 UI 依赖，不受上游迭代阻塞） |
| **P2 替换周** | **硬门槛：上游问题收敛（电池从「记录问题」转为全绿）+ P0 全绿**；物理删除 §1.1 清单与替换同一提交 |
| **P3 闭环周** | P2 出口后；`lint/critique` 接入另需上游全量面 wasm 导出落地（决策 5 的 marker 升级点） |

**回滚**：git revert 替换提交（P0 的意义即压低此概率）。**跟版本纪律**：上游每次迭代 = 升 vendor marker + 重跑 P0 电池（CI 常驻黄金快照层，发版层跑原生 CLI 对拍）。
