# DeepOrca 原型模块生成栈替换设计 — OpenUI Lang → MoonViz wasm 引擎

> 状态：设计 v4.1（2026-09-16，实现级设计，未编码）。对齐引擎 `moonviz@99d91ab` 与 DeepOrca `feat/modern-ui-redesign` 现状盘点。
> v4 → v4.1：v4 遗留的 6 项中再拍板 2 项（产品输入）——① wasm 全量工具面由上游 moonviz 仓库直接导出，DeepOrca 跟版本 marker；② DDP 编解码按同格式 TS 自建进程内实现，不依赖 Rust 产物。遗留仅剩 DDP 密码 UX。
> 前置约束不变：可验证、可回滚、可并行。本文不编码；接口形状仅为设计示意。

---

## 0. 引擎事实基线（设计依据，全部已核对源码）

| 事实 | 出处 |
|---|---|
| wasm 边界 7 导出，全部 `String→String` JSON、同步、无状态：`render_mbt` / `validate_mbt` / `apply_agent_op` / `apply_human_op` / `export_html` / `list_templates` / `version_info` | `wasm/moon.pkg` exports |
| `apply_agent_op(mbt, op)` = `load_mbt_project(mbt)` → `@core.apply_operation` → `commit_and_render(AgentGate)`，返回 canonical MBT + 全量渲染（每画板 SVG + nodes + flows） | `wasm/main.mbt:43`、`decl/mbt.mbt:834` |
| op 语法与原生 CLI `apply-agent-mbt-op-b64` 同一分发器；`template/theme/token/interact/set-state/responsive/restyle` 全可达 | `core/ops.mbt:263-518`、SKILL.md |
| 交互词汇：trigger `tap/long_press/swipe_*/scroll_end/key_enter/focus/blur` × action `back/haptic/navigate_to:<board>/show_toast:<msg>/set_text:<node>:<text>/set_state:<node>:<state>/toggle_state:<node>/play_sound:<name>`；组件状态以 `[state:name:k=v,...]` 标记持久化 | SKILL.md |
| 内置组件 **52 个 preset**（README 的「8 组件×22 变体」是旧数据），8 页面模板 `login/signup/dashboard/profile/settings/list_detail/onboarding/empty_state` | SKILL.md（权威）、README（滞后） |
| Gate 拒绝载荷为**四段错误串** `mbt_gate_block:<画板id>:<谓词名>:<节点id>`，单次只携带**第一个**阻断；无完整违规列表（原生面才有） | `decl/mbt.mbt:620-645` |
| 合法文档必须有最小 frontmatter（`moonbit:` import + `moonviz:` 段：format/revision/title/entry/artboards/flows）+ MoonBit visual 块；**空源码不可加载** | `sdk/wasm/test/selftest.mjs` |
| `version_info()` 硬编码 `"0.1.0"`，不能作版本判据 | `wasm/main.mbt:30` |
| wasm 面缺口：`lint_design/critique/auto_fix/list_components/list_tokens/list_themes/export_react/get_violations` 未导出（**上游已计划从仓库导出全量面**，DeepOrca 跟版本，见 §6 决策 5） | `wasm/moon.pkg` |
| DDP 容器格式（Rust 参照实现）：DDP2 = `"DDP2"` + version(1B) + CRC32-IEEE(zstd 帧，4B LE) + `zstd(mbt, level 8)`；DDP1 = `"DDP1"` + version + salt(16B) + nonce(24B) + XChaCha20-Poly1305(key=Argon2id(pw,salt; m=19MiB,t=2,p=1,out=32B,v=0x13), msg=zstd 帧, aad=头部 45B)。明文 ≤8MB、密文 ≤16MB | `moonviz/ddp/src/lib.rs` |
| 宿主要求 WasmGC + js-string builtins（Node 24+/Chromium 119+）；本机 Electron 43.2.0 主进程实测 Node 24.18.0/V8 15.0 | `sdk/wasm/index.mjs`、本机 `ELECTRON_RUN_AS_NODE` 实测 |
| 二进制资产 ≈200 KB 单文件（README 写 ≈90 KB 已滞后） | `sdk/wasm/dist/moonviz.wasm` 204,936 B |
| 引擎红线：零 LLM、零网络、宿主持久化（IO-free） | `docs/11-user-components.md` |

## 1. 替换范围与不动点（精确到文件与符号）

### 1.1 删除清单（P2 一次提交内物理删除）

**core**（生成栈本体）：

| 文件/符号 | 处置 |
|---|---|
| `actions/openui-contract.ts` | 整文件删除。`OPENUI_PRESERVE_CONTRACT`/`OPENUI_CREATE_CONTRACT`（$page/ternary/Action 语法句）随栈消亡；`OPENUI_QUALITY_CONTRACT`（活原型/高保真/可编辑质量 bar）**改写为 moonviz 词汇后迁入新 `moonviz-contract.ts`**；`OPENUI_DEVICE_CONTRACTS` 三端平台契约句**原样迁入**（栈无关的质量材料） |
| `common/openui-pages.ts` | 整文件删除（componentJaccard/extractProgramPages/parsePageList——页面解析被引擎多画板取代）+ `openui-pages.test.ts` |
| `design-gates.ts` 内 `pageCoverageFindings`/`openuiInteractivityFindings`/`programPageCount` | 删除（被引擎画板 frontmatter 比对 + flows 存在性取代）；`runDesignStage`/`callSubagentStable`/`pmSectionsAudit` 等编排件**保留** |
| `prototype.ts` 内 OpenUI 路径 | `PrototypeSuiteContent.openui/openuiVariants` 字段、`MAX_OPENUI_REPAIR_ROUNDS` 文本修复循环、fence 文本提取（`extractGeneratedBody` 对 openui 的分支）、`prototype.verify` 的 openui 检查项——替换为 §4/§5 的 moonviz 路径 |
| `settings.ts` 3 处、`index.ts` 5 处导出 | `openuiInlineMode` 等设置项与 openui 导出符号清理 |

**desktop**（OpenUI 物化/校验/交付链）：

| 文件/符号 | 处置 |
|---|---|
| `main/tools/a2ui/a2ui-mcp.ts` 内 `render_openui`/`update_openui` 工具 | 删除——OpenUI→A2UI 组件物化链整体作废；A2UI 服务器本体、surface 生命周期、DeepOrca 自身 UI 组件词汇**保留** |
| `main/tools/a2ui/openui-library-schema.ts`（1956 行）/ `openui-validate.ts` | 整文件删除 |
| `main/tools/dd-package.ts` 内 `buildDduOpenuiPackage` 与 pipeline `"openui"` | 删除；pipeline 枚举 `"openui"|"design"|"leafer"` → `"moonviz"|"design"|"leafer"`（§6.3） |
| `renderer/App.tsx` inline 链（`extractOpenuiFence`、```openui-lang fence、`openuiInlineMode`） | 删除；聊天内嵌预览改走动作返回的每画板 SVG（复用既有附件/预览挂载） |
| `main/tools/prototype-brief.ts`、`subagent-cleanup.ts`、`design-store.ts`、`design-ipc.ts` 内 openui 引用 | 随字段/管线更名清理 |

**测试**：`openui-pages.test.ts`、`prototype-devices.test.ts`、`prototype-repair.test.ts`、`design-action.test.ts`、`design-stage-gates.test.ts`、`prompt-doc-chain.test.ts`、`prd-theme.test.ts` 中 openui 断言——随栈重写为 moonviz 断言（§7.4）。

### 1.2 不动清单（模块外骨架）

ActionRegistry/defineAction 动作模式与 LLM 工具派生（`registry.ts`）、动作 id 面与编排链（`prototype.spec / prototype.pmdesign / prototype.materialize / prototype.revise / prototype.verify`，`design.ts` 的 ui 套件链）、`.deeporca/designs/<id>/` 工件目录与 spec.md、`runDesignStage` 舞台编排、A2UI 服务器基础设施、桌面持久化与 IPC 通道骨架（`design-store.ts`/`design-ipc.ts`）、`leafer-*`（UI-Design 栈，独立演进）、pm-design.md 提示词文档链。

## 2. 架构与模块设计

```
┌─ 动作层（改造 prototype.ts / design.ts 内 moonviz 路径）──────────┐
│  子代理产出「op 计划」→ 逐批经接缝提交 → Gate 回灌修复            │
├─ 薄合同层（core 新建 actions/moonviz-contract.ts）────────────────┤
│  MOONVIZ_SEED_DOC 种子常量 · 画板覆盖比对 · flows 存在性检查      │
│  平台契约/质量合同 prompt 材料（迁自 openui-contract）            │
│  组件/模板词汇 prompt 片段（wasm 无 list_components 期间的供给）  │
├─ 引擎接缝（core 新建 common/moonviz-engine.ts）───────────────────┤
│  createMoonvizEngine(getBytes) 单例懒加载                        │
│  applyOp(doc, op) / render(doc) / exportHtml(doc) → 结果类型      │
│  错误串解析（mbt_gate_block 四段 → 结构化 GateBlock）             │
│  每调用计时观测（阻塞策略数据源）                                 │
├─ wasm 资产（desktop vendor）──────────────────────────────────────┤
│  vendor/moonviz/moonviz.wasm（download-marker，≈200KB）           │
│  字节经 configureMoonvizEngine 注入 core（vendor 路径红线）       │
├─ DDP 编解码（core 新建 common/ddp-codec.ts，TS 自建进程内）───────┤
│  DDP1/DDP2 容器格式对齐 Rust 参照（§5.3 黄金向量锁定互操作）      │
│  zlib.zstd*/crc32 原生 + @noble/* exact-pin；仅 export_ddp（P3）  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 引擎接缝 `common/moonviz-engine.ts`（core）

职责：wasm 生命周期、调用包装、错误解析、观测。**不含任何业务语义**（画板清单、页面比对都在合同层）。

接口形状（示意）：

- `configureMoonvizEngine(source: { getBytes(): Promise<ArrayBuffer> })` —— desktop main 启动时注入（`process.resourcesPath/vendor/moonviz/moonviz.wasm`；开发态直接 `packages/desktop/vendor/`）。core 不解析 vendor 路径，遵守 host-injected 红线。
- `getMoonvizEngine(): Promise<MoonvizEngine>` —— 单例懒加载，实例化失败抛 `MoonvizHostError`（宿主缺 WasmGC/js-string builtins 的可诊断信息，文案参照 `index.mjs` 的报错）。
- `MoonvizEngine.applyOp(doc: string, op: string): OpResult` —— 同步。`OpResult = { ok: true, canonical: string, artboards: ArtboardRender[] , flows: Flow[] } | { ok: false, error: string, gate?: GateBlock }`。`GateBlock = { artboard, predicate?, nodeId? }`（由四段错误串解析）。
- `render(doc)` / `validate(doc)` / `exportHtml(doc): { ok, html? }` 直映射。
- 每调用记录 `{ opKind, ms }` 到内存环形缓冲，供诊断日志与阻塞策略数据。

**阻塞策略（拍板 v3 待决 1）**：v1 主进程同步直调。理由：op 是毫秒级结构操作；整文档渲染是唯一重操作且画板数受 spec 约束；环形缓冲的实测数据决定是否升 worker_thread——接缝接口不变，届时仅改内部实现。不预设阈值开关，P0 电池（§7）拿数据说话。

### 2.2 薄合同层 `actions/moonviz-contract.ts`（core）

职责：动作层与引擎之间的语义粘合 + prompt 材料供给。**校验主体永远委托引擎**，本层只做引擎不管的三件事：

1. **种子文档** `MOONVIZ_SEED_DOC`：最小 frontmatter + 一个空入口画板的常量（依据 selftest 最小合法文档缩减：`prototype(name="a", width=390, height=844)` 无子节点）。create 冷启动唯一入口；种子画板 id 固定 `entry`，`template` op 落实际页面后按需 `delete-artboard entry`。
2. **覆盖比对**（原 pageCoverageFindings 的接替，栈级薄校验）：spec 页面清单 ↔ canonical frontmatter `artboards` 比对；`flows` 数组存在性（≥1 条交互流）作为交互性下限；**在动作层落地为 `prototype.verify` 的自动检查项**，不进引擎。
3. **Prompt 材料**：`MOONVIZ_QUALITY_CONTRACT`（改写自 OPENUI_QUALITY_CONTRACT——活原型质量 bar 换成 moonviz 词汇：交互由 `interact/set-state` op 表达、状态由组件状态标记表达）、`MOONVIZ_PLATFORM_CONTRACTS`（原 OPENUI_DEVICE_CONTRACTS 三端句原样迁入：desktop 1200×800 侧栏导航 / mobile 390×844 底部 tab / tablet 768×1024 分栏——**尺寸从句子约束升级为 create 时画板 w/h 实参**）、组件/模板速查片段（52 preset 的分类清单 + 8 模板 id，从引擎 SKILL.md 生成的**临时静态片段**——上游全量面 wasm 落地后切换为运行时 `list_components`，切换点仅在合同层，动作层无感，见 §6 决策 5）。

### 2.3 vendor 脚本 `scripts/vendor-moonviz-wasm.js`（desktop）

沿用 `vendor-download.js` download-marker 模式（同 uv/granite 一族）：固定 `engineVersion` 从 moonviz GitHub release（或 npm `moonviz-engine-wasm@<v>` 解包）拉 `dist/moonviz.wasm` → `packages/desktop/vendor/moonviz/`；`.vendored-version` marker 记录版本与字节哈希。electron-builder 经既有 extraResources 进安装包。**不进 package.json 依赖**（wasm 是资产；避免 esbuild 对 `import.meta.url` 定位的破坏，加载一律 `getBytes → createEngine(bytes)`）。

CI 对拍（§7.2）所需的原生 CLI 由 CI 临时下载引擎 release 产物，不进 vendor。

## 3. 数据流与工件模型

### 3.1 动作时序

**`prototype.materialize`（create）**：

1. `MOONVIZ_SEED_DOC` 起步 → 子代理（设计技能，经 `callSubagentStable`）收到 spec + pm-design + 契约材料 + op 语法说明，产出**结构化 op 计划**（JSON：`{ ops: string[], notes? }`——op 语法本身就是行式文本，JSON 只做外层结构防跑偏）。
2. 动作层逐批提交 `applyOp(current, op)`：每批 1–8 条（批量降低往返；Gate 拒绝只回滚感知，canonical 推进是幂等的——失败前已提交的 op 不需要重放）。
3. `ok:false` → Gate 回灌（§5）：错误 + 剩余 op + 最近 canonical 发回子代理修复重发。
4. 全量通过 → 覆盖比对（合同层）→ `exportHtml` → 落盘工件 → 返回每画板 SVG 摘要给 Agent。

**`prototype.revise`（独立动作保留，只换内核）**：输入工件 id + 修订指令；读现有 `doc.mbt.md` 起步（跳过种子），其余与 create 的 2–4 步相同——修订指令 → 子代理产出增量 op 计划 → 逐批提交 → Gate 回灌。

**`prototype.verify`**：canonical → `validate` + 覆盖比对 + flows 检查 → 检查项列表（沿用现有 `PrototypeVerificationCheck` 形状：`passed/failed/healed`）；healing 轮改为「按 Gate/覆盖结果生成 op 计划再提交」。

**`prototype.moonviz_export_ddp`（新 id，P3）**：进程内调 `common/ddp-codec.ts`（TS 自建，§5.3；空密码 → DDP2，带密码 → DDP1，密码 UX 见 §6 决策 7）；与 DeepOrca 自家 `.ddp` 分发包并存，语义见该节。

### 3.2 工件与载荷类型变更

`.deeporca/designs/<id>/`：`spec.md`、`pm-design.md`、`arch.md` 不变；`content.openui` → **`doc.mbt.md`**（canonical，事实源）；新增导出缓存 `prototype.html`（export_html 产物，预览直读，避免每次打开重导）。每画板 SVG 不落盘（渲染确定性 + 成本低，预览层按需从 doc 重渲）。

`PrototypeSuiteContent`：`openui`/`openuiVariants` 字段删除，新增：

```
moonviz?: { doc: string }            // canonical .mbt.md 全文
previewHtml?: string                 // export_html 缓存（落盘 prototype.html 的镜像）
```

**三端变体（原 openuiVariants 结构性分程序）拍板**：moonviz 单文档多画板承载——desktop/tablet/mobile 是同一文档内三个画板（1200×800 / 768×1024 / 390×844），由 op 计划里的画板清单表达，平台契约句约束各画板结构。不再维护三个独立程序字段；套件版本 payload 单 `moonviz.doc`。`design-store.ts`/`design-ipc.ts`/`shared/ipc.ts` 同构类型随之调整（沿 specs/prd-theme-layer 的同步纪律）。

### 3.3 存量工件

替换提交合入即 `content.openui` 作废（不迁移、不渲染）。合入前跑一次 designs 存量清单，需留样的手工处理。

## 4. 修复循环与质量门映射

### 4.1 Gate 回灌协议（对齐引擎「单阻断」现实）

引擎每次只报第一个阻断（`mbt_gate_block:<画板>:<谓词>:<节点>`），因此循环设计为**推进式**而非全量清单式：

- 回灌消息模板：当前 canonical 末 N 行 + 阻断解析（「画板 `prof` 的节点 `signup_btn` 违反谓词 `overflow`」）+ 剩余未提交 op + 指令「只输出修正后的剩余 op 计划」。
- 每轮上限（沿用 2 轮的经验值）；两轮未过 → 动作失败并附 GateBlock 诊断，不静默降级。
- `apply_human_op`（视觉债放行）v1 不对 Agent 开放——Agent 必须过 AgentGate；人类画布通道是 v2+ 渲染进程直嵌的事。

### 4.2 质量门映射

| 原 OpenUI 门 | 新实现 | 层 |
|---|---|---|
| 结构合法性（fence 提取 + 自写校验） | 引擎 AgentGate 随每次 op 提交内建 | 引擎 |
| 交互性（openuiInteractivityFindings） | `flows` 数组存在性 + 交互流断裂随 op 内建拒 | 引擎 + 合同层 |
| 页面覆盖（pageCoverageFindings） | spec 页面清单 ↔ frontmatter artboards 比对 | 合同层 |
| 三端平台契约（句子约束） | 契约句迁入 prompt + 画板尺寸实参化 | 合同层 |
| 视觉质量（无） | `lint_design/critique/auto_fix`——随上游全量面 wasm 落地后接入（§6 决策 5），到位前 verify 的视觉项标注 pending | 引擎（待上游导出） |

## 5. 预览与交付接缝处置

### 5.1 交互预览（替代 render_openui 物化链）

- 主路径：工件 `prototype.html`（export_html 产物，自包含交互 HTML：节点级绑定表/CSS 状态变体/导航栈/toast）→ **sandboxed iframe srcDoc**——`DesignPreview.tsx`/`PrototypeWorkspace.tsx` 已是 iframe 宿主模式，新增一个 moonviz 预览分支读 `previewHtml` 即可，CSP 按 `media-src 'none'; script-src 'unsafe-inline'` 收敛评估（引擎已断 XSS 链，仍按不受信内容对待；P0 电池含 CSP 冒烟）。
- 静态缩略：动作返回的每画板 SVG 进聊天/工作区（复用现有附件挂载）。
- A2UI 只保留其基础设施与 DeepOrca 自身 UI 用途；OpenUI 物化四件套（§1.1 desktop 表）删除。

### 5.2 聊天内嵌（App.tsx inline 链）

`openuiInlineMode`/`extractOpenuiFence` 删除；不设等价 inline fence——原型预览统一收敛到动作事件与工作区（子代理在聊天里直接发 openui 文本本就是待消灭的反模式）。

### 5.3 交付包与 DDP（两个 `.ddp` 消歧）

- **DeepOrca `.ddp` 分发包**（`dd-package.ts`，zip：manifest+源+viewer）：pipeline 枚举换 `"moonviz"`，包内 `source.openui.txt` → `doc.mbt.md` + `index.html`（export_html 产物作 viewer）。此为产品交付物，P2 落。
- **MoonViz DDP 认证容器**（单一加密 `.mbt.md`）：`prototype.moonviz_export_ddp` 动作输出，用于加密分享。文档与 UI 命名区分：前者「导出设计包」，后者「DDP 加密分享」。

**DDP 编解码 TS 自建（拍板：不依赖 Rust 产物）**——core 新建 `common/ddp-codec.ts`，按 `moonviz/ddp/src/lib.rs` 的二进制格式进程内实现：

| 能力 | TS 实现 | 备注 |
|---|---|---|
| CRC32-IEEE | `zlib.crc32`（Node ≥22.2 原生） | 与 Rust 无查表实现同标准 |
| zstd 压缩/解压 | `zlib.zstdCompressSync`/`zstdDecompressSync`（Node 24 zlib 原生，Electron 主进程实测 Node 24.18） | 压缩级别设 8 对齐参照（级别不影响互操作性，解压只认帧） |
| Argon2id（m=19MiB,t=2,p=1,out=32B,v=0x13） | `node:crypto` 特性探测，缺失则 `@noble/hashes`（纯 JS、exact-pin） | 19MiB 在纯 JS 可承受 |
| XChaCha20-Poly1305（AAD=头部） | `@noble/ciphers`（纯 JS、exact-pin、MIT） | Node 原生只有 12B nonce 变体，XChaCha 需 noble |
| 上限/错误码 | 对齐 Rust：明文 ≤8MB、密文 ≤16MB、错误串 `ddp_*` 同名 | 错误码同名保证动作层与引擎错误语义一致 |

依赖纪律：`@noble/*` 是在 Electron 主进程执行的包，按仓库规则 **exact-pin**（无 `^`/`~`），升级时重新审计。

**兼容性验证（黄金向量，进 P0 电池）**：① DDP2——`examples/login-demo.ddp` 用自建 codec 解密，逐字节等于 `login-demo.mbt.md`；② 自建加密（空密码）产物回灌 wasm `render_mbt` 可加载渲染；③ DDP1——用 Rust 参照实现本地一次性生成固定密码样本作为测试夹具（盐/nonce 固定），自建实现解密一致 + 密码错误失败路径；④ 引擎侧（Rust codec 或 wasm 载入路径）能解自建 DDP1 产物（互操作性双向锁定）。

## 6. 已拍板决策记录（v3 待决 6 → 全部闭环，遗留仅 DDP 密码 UX）

| # | 决策 | 依据 |
|---|---|---|
| 1 | 主进程同步直调；接缝内置计时观测；worker_thread 仅在实测超阈值后无感切换 | op 毫秒级；渲染唯一重操作且受 spec 约束 |
| 2 | 三端变体 = 单文档三画板（尺寸实参化），删除 openuiVariants 三程序结构 | 引擎多画板原生；平台差异由契约句+尺寸表达 |
| 3 | 运行时 vendor 仅 wasm 资产；原生 CLI 仅 CI 对拍临时下载 | §2.3 |
| 4 | 预览 = iframe srcDoc 承载 export_html；A2UI 物化链删除；inline fence 链删除 | §5.1/5.2，iframe 已是既有宿主模式 |
| 5 | **wasm 全量工具面由上游 moonviz 仓库直接导出**（lint/critique/list_components/list_tokens/list_themes/export_react 等），DeepOrca 升 vendor marker 即接入；到位前合同层静态词汇片段 + verify 视觉项 pending 顶替 | 产品输入（2026-09-16）：上游由本方维护，直接从仓库补全导出 |
| 6 | **DDP 编解码 TS 自建进程内实现**（`common/ddp-codec.ts`，格式对齐 Rust 参照），不消费 `ddp_codec` 二进制——平台产物缺口不复存在；`export_ddp` 仅剩密码 UX 待定 | 产品输入（2026-09-16）：同加密方式可自建；格式与黄金向量见 §5.3 |
| 7（遗留） | DDP1 密码 UX：密码输入/存管交互（DeepOrca 有无既有密钥环）——**仅阻塞 export_ddp 动作 UI，不阻塞 codec 实现与 P1/P2** | 产品输入待定 |

## 7. 验收电池（Phase 0，命令级）与路线

1. **宿主就绪**：Electron 主进程（已实测 ✅）与渲染进程各实例化一次；**打包形态**（extraResources 路径）加载验证
2. **黄金对拍（核心判据）**：`examples/login-demo.mbt.md` + 固定 op 序列，wasm `apply_agent_op` 输出（canonical+SVG）与原生 CLI `apply-agent-mbt-op-b64` 逐字节比对；CI 常驻快照层（对 `login-demo.render.json` 黄金），发版层跑原生对拍
3. **载荷形状**：构造溢出文档 → `mbt_gate_block` 四段解析；`render_mbt` 错误路径；`export_html` 结构断言（绑定表/CSS 变体/导航栈）+ 真浏览器点击冒烟（login_btn→prof、pressed 切换，复用引擎实测场景）
4. **种子闭环**：`MOONVIZ_SEED_DOC` → `template login` → `delete-artboard entry` → 交互 op → canonical 落盘 → 重载渲染一致
5. **性能与阻塞**：多画板（≥3 端）+ 大文本 worst-case 单调用耗时分布 → 定 worker_thread 阈值
6. **生命周期**：trap 后实例重建、内存曲线、重复实例化成本
7. **CSP 冒烟**：previewHtml 在 renderer iframe 内加载（§5.1 策略）
8. **版本探针**：marker 哈希 + `version_info()` 可用性（不作版本判据）
9. **DDP 黄金向量**（P3 前，§5.3）：自建 codec 对 `examples/login-demo.ddp` 逐字节解密、自建加密回灌 wasm、Rust 参照生成的 DDP1 夹具双向互解、错误码同名断言

| 阶段 | 内容 | 出口 |
|---|---|---|
| **P0** | 上述电池；marker 锁定 | 报告全绿 |
| **P1 接缝周** | vendor 脚本 + `moonviz-engine.ts` + `moonviz-contract.ts` + CI 对拍 | 接缝单测全绿（引擎 mock/fixture 驱动，无 UI） |
| **P2 替换周** | materialize/revise/verify 换 moonviz 路径 + 预览 iframe 分支 + `.ddp` moonviz 管线；**同提交删除 §1.1 全部清单** | 一句话→三画板可交互原型；`git grep -i openui -- packages/` 零命中 |
| **P3 闭环** | `export_ddp`（自建 codec + 密码 UX，决策 6/7）+ 交互预览全量 + 上游全量面 wasm 落地后接 `lint/critique` 评审步骤与运行时 `list_components`（决策 5） | 日常完整走 moonviz 栈 |

**回滚**：git revert 替换提交（P0 意义即压低此概率）。**回归防线**：§1.1 测试清单重写时保留原断言语义（devices→画板尺寸断言、repair→Gate 回灌断言、coverage→合同层比对断言），P2 出口以「断言等价迁移」复核。

---

*对接材料：`moonviz/wasm/main.mbt`（边界权威）、`moonviz/SKILL.md`（op 语法权威）、`moonviz/sdk/wasm/test/selftest.mjs`（最小合法文档/种子依据）、`moonviz/examples/`（黄金）、`packages/core/src/actions/{prototype,design-gates,openui-contract}.ts`（替换对象现状）。*
