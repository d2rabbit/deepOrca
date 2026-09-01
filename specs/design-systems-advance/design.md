# deepOrca 设计系统进阶方案 — 产品原型设计模块 × UI 视觉稿设计模块

> **状态**：方案稿（只出方案，不改代码）· **日期**：2026-09-01
> **性质**：对既有 `prototype.*`（产品原型设计）与 `design.*`（UI 视觉稿）两大模块的**强化 / 优化 / 进阶**设计。
> **输入**：① 本仓库设计域全部既有规格与实现（deep-design / pm-design-v2 / prototype-companion / a2ui-integration / ui-domain-regroup / design-audit 等）；② 四个开源设计项目的一手仓库研究（open-design / open-pencil / open-codesign / penpot，详见 `docs/research/2026-09-01-design-systems-comparative-study.md`）。
> **交付**：本文档为唯一方案；不含任务分解（tasks.md）与代码改动。

---

## §0 执行摘要

deepOrca 的设计域在 2026-08 完成了一次重要的真机驱动的模块拆分（"一句话→原型"被证明对两个学科都不成立），形成：

```
产品原型设计模块（prototype.*）         UI 视觉稿设计模块（design.*）
  需求(一句话) → spec.md 需求文档         需求/已有原型 → .dd 视觉设计文档
  spec → OpenUI Lang 交互原型             .dd = tokens + HTML body + section 标记
```

两条管线共享一套内核（进程内设计 MCP 服务器、design-store 持久化、taste 纪律、design.audit 机检、dembrandt 品牌摄取/漂移闸门、9 套设计系统 + 10 宏结构）。**方向正确、骨架完整、纪律先进**，但对照四个开源项目的机制与哲学，存在五类系统性差距：

| # | 差距 | 现状 | 进阶方向（本文 §5-§8） |
|---|------|------|------------------------|
| G1 | **原型无"可验证的交互"** | 原型是 OpenUI Lang 静态程序，面板内 action 单向触发，无 agent 双向往返（a2ui_action 只在 A2UI 面） | 交互回路接入原型模块：行为契约（action 声明）→ 运行期回传 → agent 感知 → 界面更新；原型从"画"变"验" |
| G2 | **视觉稿是"单页文档"而非"设计系统"** | .dd 一页一文件，组件复用靠复制；无 token 规范化、无变体/状态、无跨页共享 | .dd 文档模型升级为"设计系统包"：DTCG 对齐 tokens + 组件原子库 + 页面清单 + 变体；多页设计稿共享一套 token |
| G3 | **质量闸是"提示词纪律"而非"可执行机制"** | taste 19 条 P0 靠模型自觉；五维自评无强制门；design.audit 只查三轴；eval 仅 1 例 | 双回路质量门：静态 lint（规则引擎化，open-design 的 anti-slop lint 思想）+ 渲染后机检（对比度/断点/溢出实测）+ LLM 五维复查（加权门 + 有限轮次收敛） |
| G4 | **产物无"留存与回退"体验** | versions FIFO 20 在磁盘，无版本切换 UI（拍板不做）；无 direction 选择、无草图阶段 | 中间产物留存（0.14"灵感时光机"思想 + 已有 file-history 基建）：方向选择 → 骨架确认 → 版本 diff/回退，全部在工作区 UI 内 |
| G5 | **无设计记忆与评估体系** | 用户偏好不沉淀；无 benchmark；无开放数据面 | 设计记忆（品牌/风格/常用模板的跨会话沉淀）+ eval 扩充 + 设计资产开放面（可查询/可 lint/可导出） |

**方案总纲（§4）**：以"**契约 + 载体 + 回环**"三要素重构两大模块——

1. 一份**统一设计 token 契约**贯穿两模块（DESIGN.md 品牌契约 ↔ tokens 包 ↔ 渲染期 CSS 变量），借鉴 open-design 的品牌契约分层注入与 penpot 的 token 工具化；
2. 两种**互补载体**各司其职：原型 = 可运行的交互程序（OpenUI Lang + 交互回路），视觉稿 = 结构化的设计系统文档（.dd 升级版）；
3. 一条**可执行的质量回环**：生成 → 双回路校验 → 审计打分 → 版本留存 → 记忆沉淀，让"设计质量"从 prompt 依赖变成机制保证。

**分期（§9）**：P0 交互回路 + 文档模型升级（核心价值）→ P1 质量机制 + 留存体验 → P2 资产与评估 → P3 协同与记忆。全部复用既有 Electron + Agent 基础设施，**零新增守护进程、零新增重型依赖**（延续 deep-design 的既定原则）。

---

## §1 现状盘点：两大模块的实现与逻辑

> 本节为 2026-09-01 对仓库现状的一手核实；证据路径标注在条目尾部。

### 1.1 模块边界（2026-08 拆分后的定位）

依据真机反馈，"一句话需求自动路由生成原型"把两种不同学科混为一谈，已拆分（`packages/core/src/actions/prototype.ts:1-16`）：

| 模块 | 入口 Action | 两步方法论 | 受众 |
|------|------------|-----------|------|
| **产品原型设计** | `prototype.spec` → `prototype.materialize` | 需求 → 结构化需求文档（spec.md）→ OpenUI Lang 交互原型 | PM（非技术） |
| **UI 视觉稿设计** | `design.materialize`（+`design.extract`/`design.drift`） | 需求/已有原型 → .dd 视觉设计文档（UI/UX 层，不重定范围） | 设计与产品 |

边界纪律：原型模块不产出视觉稿，视觉稿模块不重定义产品范围；A2UI 面（surface 协议）按三层定位**不介入** designer（`design-a2ui-boundary.test.ts` 三条 guard 锁死）。

### 1.2 两模块的载体与逻辑

**原型模块**（`actions/prototype.ts`）：

- `prototype.spec`（L83-107）：需求（一句话即可）→ `spec-writer` skill 展开为 7 节结构化文档（背景与目标/用户与场景/功能需求/页面清单/非功能需求/验收标准/待确认），经 `render_spec` MCP 工具持久化为 spec artifact。**页面清单是原型的契约**——"页面名即原型页面"。
- `prototype.materialize`（L142-176）：读取 spec artifact → `pm-designer-openui` skill 严格按页面清单生成 OpenUI Lang 程序，经 `render_openui` 持久化。**禁止超出文档发明范围**。
- 载体：**OpenUI Lang**——紧凑行式声明语言（`id = Component(args)`，11 个组件：Layout 5 / Content 3 / Interactive 3），hoisting + 流式渐进呈现（root 先行），全量替换迭代（`update_openui`），语义 ID 保持版本 diff 可读（`pm-designer-openui/SKILL.md`）。
- 渲染：`OpenuiRenderer.tsx`（官方 SDK + `deeporcaLibrary` 组件库，`--ui-*` CSS 变量与桌面主题同源）+ `tool-provider.ts` 7 个只读 `design.*` 工具（prototype 内 `Query()` 直连本地数据，零 LLM token）+ `correction.ts` 结构化错误码回喂纠错回路（同错去重，防死循环）。

**视觉稿模块**（`actions/design.ts`）：

- `design.materialize`（L74-148）：需求（一句话即可）或**已有原型 artifact**（读 `prototype.openui.txt` 作为交互依据）→ `deep-design` skill 生成 .dd 文档，经 `render_design` 持久化。原型是交互基础，.dd 将其提升为视觉设计，**必须覆盖原型全部页面与流程**。
- `design.extract` / `design.drift`（L243-444）：dembrandt 品牌摄取（URL → DTCG 形 tokens，SSRF 预校验，**离线**：Electron 内置 Chromium 经 CDP）与确定性漂移闸门（`--compare`，0-100 分，零 LLM）。持久化经 agent 的 `write` 工具（刻意保持唯一特权写路径），含 Provenance（来源/日期/版权声明）。
- 载体：**.dd（OrcaDesign）**——YAML front-matter（name/system/style/macrostructure/version/**tokens**/sections）+ HTML body（`<!-- dd:section -->` 标记）。编译器将 tokens 注入 CSS `:root` 变量 + seed CSS + 内联 vendored Tailwind JIT，输出自包含 HTML（`renderer/dd/`，`sanitizeDdBody` 消毒，防 CSS/脚本注入）。
- 渲染：`DesignPreview.tsx` iframe `sandbox="allow-scripts allow-modals"` srcDoc + **内联迭代 composer**（引导 `update_design` section 级补丁）+ PDF 导出（iframe 打印对话框，无 PDF 库）+ `.ddu`（可独立打开的编译渲染）/`.ddp`（原型交付包）特殊 ZIP（`main/tools/dd-package.ts`）。注意：.dd 的 Tailwind 是**运行期 JIT 脚本注入**（非编译期内联）。

### 1.3 共享内核

| 内核 | 实现与逻辑 |
|------|-----------|
| **进程内设计 MCP 服务器** | `main/tools/a2ui/a2ui-mcp.ts`（server `deeporca-a2ui`），**实为 11 工具**三族：A2UI surface 族（render_surface/render_prototype/list_templates/update_surface/close_surface/**a2ui_action**）+ OpenUI Lang 族（render_openui/update_openui）+ .dd 族（render_design/update_design）+ render_spec（save_archmap 已退役、navigate_to 已移除，文档"12 工具"口径待同步）。模板 7 个（login-form/dashboard/list-detail/wizard/kanban/data-table/**multi-page**，a2ui-templates.ts 注册表） |
| **design-store** | `.deeporca/designs/`：index.json + `<uuid>/{meta.json, prototype.openui.txt \| prototype.dd \| spec.md, requirement.md, formState.json}`；版本快照 **FIFO 20**（内容变更才快照）；血缘 id 复用（修过"versions 累积不起来"的活 bug）；`isSafeArtifactId` 防目录穿越；formState 2s 节流落盘 + 重启水合 |
| **taste 纪律** | 19 条 P0（标题≠正文/4-8px 间距系统/单一强调色/对比度 ≥4.5:1/hover 必有/占位图/移动重排/无孤标题/圆角一致/**anti-slop 三轴机检**/1fr-minmax/大写行高/触点 ≥44px/无横向溢出/sticky 预算/viewport 诚实/正文 ≥14px/min-width:0）+ 排版阶梯 + 颜色/动效纪律 + **五维自评**（门限：每维 ≥3 且总分 ≥20） |
| **design.audit** | 三轴机检（paper 亮度带 / display 字族 / accent 色相带），自动门前端（显示字体禁用即 auto-fail），与近期产物碰撞判 high finding；产物必须在 `.deeporca/designs` 内 |
| **模板资产** | 9 套设计系统（dark-tech/modern-minimal/editorial/brutalist-contrast/swiss-international/terminal-mono/glass-morphism/soft-neumorphic/warm-handcrafted）+ 10 宏结构（landing-flow 是默认 slop 形状、选它须说明理由；bento-grid/long-document/manifesto/type-specimen/editorial-spread/dashboard-cockpit/product-gallery/pricing-table/documentation-hub）+ web-prototype seed.html + layouts.md |
| **品牌契约** | `.deeporca/DESIGN.md`（deep-design Step 0 读取，无则选内置系统）；dembrandt Provenance 块 |
| **工作区 UI** | DesignPanel（左侧 rail：一键具现化 / 按 pipeline 静态分区的产物列表（openui 产物进「设计基础」下拉）/ drift 闸门区）+ PrototypeDesignPanel（两步流） + PrototypePanel/PrototypeWindow（弹窗预览，受限 preload + `A2uiRequestPayload` 握手） |
| **交付** | .ddp/.ddu ZIP（manifest + source + 查看器/index.html） |

### 1.4 交互回路与更新哲学的现状（关键事实）

- `a2ui_action` 双向往返（用户点击 → IPC `a2ui:action` → MCP `a2ui_action` → **agent** → surface 更新回推）目前**只在 A2UI surface 面**（`A2uiMessage.tsx`/`A2uiSurface.tsx` → `processor.ts` forwarder → `main/index.ts:1936-1959`）。原型模块（OpenUI Lang）的面板内 action（`PrototypePanel.tsx` `handleOpenuiAction`）是**单向**的 UI 事件，不回传给 agent。**即：产品原型目前不可被 agent"感知与响应"**——这是 G1 的根源。
- **两套更新哲学并存**：A2UI surface = 增量 patch + 幂等重放（update_surface 返回全历史 messages 供重放态水合）；OpenUI/.dd = 全量替换（update_openui/update_design）。roadmap 另有 A2UI delta-only 增量补丁（P0，省 70%+ token）与 OpenUI Lang（P1，省 3-4x token）的既定 token 经济方向——redesign 必须明确原型模块走哪套语义。
- 边界三条 guard（`design-a2ui-boundary.test.ts`）：design 插件技能清单不得含 A2UI 技能；`DesignPipeline` 类型（`"openui"|"design"|"spec"` 三成员）不得含 a2ui；design.materialize 只引用 render_design、prototype.materialize 只引用 render_openui/render_spec，两模块路由不得出现 A2UI 工具族。

### 1.5 已挂起 / 已拍板不做（方案边界内的既有决策）

- **prototype-companion 挂起**（2026-08-31 拍板，并入本 redesign）：PrototypeDialog 工作区悬浮对话框、sessionless 动作落任务树、需求文档左侧分轨、侧栏滚动审计。
- **已拍板不做**：版本切换 UI（快照在磁盘）、React/代码导出、tweaks manifest（观察清单）、A2UI 交互层介入 designer（三层定位）、OpenDesign daemon 级集成（deep-design 明确"去掉 daemon 复用内核"）。
- **既有进化建议**（2026-08-17 研究）：内置设计系统扩充（已部分落地 3→9 套）、taste 五维自评（已落地）、anti-slop 多样性（已落地为三轴）、大页面两段式生成（已落地 Step 2b）、tweaks 观察。

---

## §2 问题诊断：五大差距（G1-G5）

> 诊断依据：现状盘点 + 四项目对照（详见研究纪要）。每条给出"证据 → 影响 → 进阶层"。

### G1 原型无"可验证的交互"——原型是画出来的，不是验出来的

- **证据**：原型载体 OpenUI Lang 是声明式 UI 程序，`Button(label, action)` 的 action 仅是渲染期事件；PrototypePanel 的 `handleOpenuiAction` 单向，不回传 agent（§1.4）。spec 的验收标准无法在原型上验证。A2UI 官方协议已有 `a2ui_action` + checks 机制（processor 提供 schema 校验/动态值绑定/checks/client functions），但被三层定位排除在 designer 之外。
- **影响**：PM 拿到的原型"能看不能验"——关键交互路径（登录、提交、跳转、状态切换）没有可执行的验证回路；"验收标准"停留在文档。这是原型模块作为**产品工具**的最大短板（对照 penpot 的交互原型与 A2UI 协议的设计意图）。
- **进阶层**（§5.2）：把交互回路引入原型模块——OpenUI Lang 增加 action 契约（声明化），面板 action 事件经既有 `a2ui:action` 通道回传 agent，agent 以"行为验证官"身份响应（更新状态/导航/校验结果），形成**人-AI 协同可操作原型**；spec 验收标准 → 可勾选验证清单，支持"走查模式"。

### G2 视觉稿是"单页文档"而非"设计系统"——无 token 规范化、无复用、无变体

- **证据**：.dd 一页一文件；tokens 是自由 YAML 键（bg/surface/accent/text/muted/fontDisplay…），无 schema 校验、无语义分组（color/typography/spacing/radius/shadow/motion）；组件复用 = 复制 HTML；无变体/状态概念（hover 之外无 pressed/disabled/loading/error）；多页设计稿（如完整产品 UI 稿）无共享 token 机制。对照：open-design 的 design-systems 包有 `design-tokens.json` + `tokens.css` + schema（`_schema/tokens.schema.ts`）；penpot 有 DTCG token 工具化 + 组件/variants + 库共享；open-pencil 有 token 审计/聚类提取。
- **影响**：设计稿的"写一次、处处一致"能力缺失；手写多页 UI 稿时 token 漂移；交付给开发的是"一张图"而非"一套规范"（.ddu 只有查看器 + HTML，无 token 表/组件规范页）。
- **进阶层**（§6.2）：.dd v2 文档模型——tokens 规范化（对齐 DTCG 语义分组 + schema 校验 + 渲染期强制）、组件原子库（sections 引用组件而非复制）、变体/状态声明、多页共享 token 的设计系统包（`.dds` 概念：Design System 包 + 多页 .dd 引用）。

### G3 质量闸是"提示词纪律"而非"可执行机制"——模型自觉 ≠ 机制保证

- **证据**：taste 19 条 P0 全靠 SKILL.md 约束模型（`pm-designer-openui/SKILL.md` 末行"Follow the taste skill's design discipline"）；五维自评是模型自报分数（无独立复查、无证据约束）；design.audit 仅三轴 + HTML 子集检查；渲染后无**像素级/结构级机检**（对比度实测、断点溢出实测）；eval 仅 1 例正例、**无负例**、rule_based 字符串断言（不验证 render_design 是否真实调用）；**口径漂移严重**（taste 19 条 vs 插件清单 11 条 vs roadmap 10 条；"12 工具"实为 11；DesignPipeline 注释 2 管线实为 3；seed.html 注释 6 变量实为 12；compiler getSeedCss 与 seed.html 有 ≥5 处数值不一致）——文档与代码脱节本身就是质量机制的缺口。对照：open-design 的 `lint-artifact.ts`（anti-slop 七宗罪 P0 强制、`AI_DEFAULT_INDIGO` 常量同步）、五维 critique（强制证据引用）、Design Jury 加权门槛；open-codesign 的 preview/done 双验证门 + 自愈 ≤3 轮；open-pencil 的 17 条 lint 规则（defineRule 架构）。
- **影响**：同一模型不同温度下质量方差大；"没报错但丑"与"报了错也丑"都缺乏机制拦截；质量改进只能靠改 prompt，无法量化。
- **进阶层**（§7.2）：**双回路质量门**——① 静态 lint 引擎（把 taste 可机检条目 + open-design 七宗罪思想做成 core 内置校验器，作用于 .dd 与 OpenUI Lang 产物）；② 渲染后机检（对比度计算、断点溢出、触达尺寸，在 iframe 预览内执行）+ LLM 五维复查（强制证据、加权门、有限轮收敛）。

### G4 产物无"留存与回退"体验——设计工作流的中间产物留不住

- **证据**：versions FIFO 20 在磁盘但无切换 UI（已拍板不做，2026-08-18）；无方向选择（每次从零定风格）；无骨架确认归档；file-history（轻量 git）已有但未接到设计产物。对照：open-design 0.14 "Inspiration Time Machine"——"灵感来得便宜，留住却昂贵"：草图阶段、HTML 版本回退、上下文来源可见；方向选择题（内置 5 方向，一键确定性调色板）。
- **影响**：迭代到第 10 版想退回第 3 版只能重生成；用户无法"先选风格方向再生成"；不同方向尝试不可对比。
- **进阶层**（§7.3）：方向选择（3-5 个预置产品方向，确定性 token 映射）+ 版本 diff/回退 UI（复用 design-store 快照 + file-history）+ 草图/骨架阶段产物留存。

### G5 无设计记忆与评估体系——每次会话都是"第一次见到这个用户"

- **证据**：用户偏好（品牌/风格/常用模板/常用语气）不沉淀；design-store 只有产物，无偏好档案；eval 仅 1 例正例；设计产物无开放数据面（不可被外部程序 lint/查询/对比）。对照：open-design 的"截图/字体/调色板/确认产物积累为下次默认"（README:375）；open-pencil 的 token 聚类提取；open-codesign 的 BENCHMARKS 意识。
- **影响**：同一用户反复生成同类设计时风格漂移（taste 三轴只防"近期雷同"，不防"符合用户品牌"）；无法回归测试 prompt/模板改进。
- **进阶层**（§7.4）：设计记忆（用户档案：品牌契约来源、常用系统/宏结构、偏好记录）+ eval 体系扩充（正反例用例、多模型矩阵、回归门禁）+ 设计资产开放面（lint/查询/对比 API 打到既有 design-store）。

---

> 以下章节基于四项目研究（`docs/research/2026-09-01-design-systems-comparative-study.md`）：

## §3 外部研究结论（摘要）

> 完整研究见 `docs/research/2026-09-01-design-systems-comparative-study.md`（四项目一手仓库核对）。本节只列对本方案产生结构性影响的三条结论。

### 3.1 四个项目分属两个阵营，deepOrca 的进阶方向是两者之间

| 阵营 | 项目 | 核心主张 | 对 deepOrca 的含义 |
|------|------|---------|-------------------|
| **生成式** | open-design（CLI 即设计引擎，产物即 HTML）· open-codesign（agent 工作台，产物即 App.jsx 源码） | 设计稿是 LLM 写的**代码**，浏览器即画布；质量靠"模板经济 + 纪律 + 校验门" | deepOrca 现有方向正确（LLM 直写 OpenUI Lang/.dd），应**深化而非更换** |
| **编辑器式** | penpot（SVG 文档模型 + tokens + 组件变体）· open-pencil（矢量画布 + 程序化操作） | 设计稿是**结构化文档模型**：可查询、可复用、可 lint、可版本化 | deepOrca 的短板恰好在此：产物"文档化程度"不足 |

**结论**：进阶方向 = 把"生成式产物"升级为"**半结构化设计资产**"——保留生成式的轻量（零守护进程），吸收编辑器式的结构化（token 契约、组件复用、可机检、可留存的版本与中间产物）。

### 3.2 质量机制是 opensource 阵营最成熟的资产（可直接迁移的思想）

- **强制证据的五维评审**（open-design critique：无证据的分数被拒绝、取最差 band 不平均、Keep/Fix/Quick-wins 输出；open-codesign 12 项**布尔**判分替代浮点自评，确定性、可跨运行比较）。
- **双门验证**（open-codesign preview/done：渲染器返回 console 错误 + DOM outline + 截图（按模型能力降级）→ 静态 lint + 运行时验证 → **自愈重试 ≤3 轮**）。
- **加权评审门 + 有限轮收敛 + ship_best 兜底**（open-design Design Jury：critic 0.4/brand 0.2/a11y 0.2/copy 0.2、阈值 8.0、≤3 轮、同会话多 turn 实现、`.ndjson` 可回放）——适配 deepOrca 单进程引擎为 opt-in。
- **anti-slop 可执行化**（open-design 七宗罪 + `AI_DEFAULT_INDIGO` 常量 lint；open-codesign 12 条禁止模式 + 正向手法清单）——把"惩罚清单"与"正向手法"同时给模型。
- **"没有交付物不算完成"**（open-design 0.15 run-deliverable-validation；open-codesign done 门）——LLM 回复 ≠ 任务完成。

### 3.3 留存、方向与记忆：设计工作流区别于编码的体验增量

- **中间产物留存**（open-design 0.14"Inspiration Time Machine"：草图/来源/旧版/线索；"灵感来得便宜，留住却昂贵"）。
- **方向选择题**（open-design 5 内置方向 = 确定性调色板 + 字体栈 + 现实参照，"一键选择，禁止模型即兴"；open-codesign `ask()` 的 **svg-options** 题型：SVG 图形让用户点选视觉方向）。
- **可调参数协议**（open-codesign EDITMODE/TWEAK_DEFAULTS：AI 声明参数 → CSS 变量 → 滑杆**无重渲染**更新——open-design 自己也尚未实现的 tweaks 面板 UX 的可落地形态）。
- **品牌即数据**（open-codesign："品牌 hex 色不得凭记忆编造"、26 个带 attribution 的品牌参照 DESIGN.md；open-design：DESIGN.md 品牌契约分层注入）。
- **渐进披露**（open-codesign：资源清单索引进 prompt、正文按需 `skill()`/`scaffold()` 加载——替代全量注入，直指 token 经济）。

## §4 总纲：V3 设计哲学

两大模块的进阶统一在一条主线上：**把"AI 画出来的产物"升级为"可运行、可验证、可留存、可复用的设计资产"**。四条原则（每条对应一个借鉴来源）：

1. **契约驱动（Contract-driven）**——原型与视觉稿都从"自由生成"走向"契约约束"：需求文档是原型的契约（已有），DESIGN.md 是视觉的契约（已有），**本方案新增**：token 契约贯穿两模块（§7.1）、行为契约进入原型（§5.2）、验收标准成为验证契约（§5.4）。
2. **回环保证（Loop-enforced）**——质量不靠模型自觉，靠机制回环：生成 → 渲染后机检 → 加权评审 → 自愈重试 → 版本留存（open-design lint/Design Jury、open-codesign preview/done 双门）。
3. **中间产物即资产（Artifacts, not answers）**——方向选择、骨架确认、版本快照、走查报告都是可留存的中间产物（open-design 0.14"灵感时光机"、deepOrca 已有 file-history 与 versions FIFO 20 的基建）。
4. **轻内核、多载体（Lean core, rich carriers）**——零新增守护进程与重型依赖（延续 deep-design 原则）；一切增强落在既有 Electron + Agent + MCP 基础设施上；载体（OpenUI Lang / .dd）各司其职，不做大而全的画布引擎。

## §5 产品原型设计模块进阶设计

### 5.1 定位升级：从"原型生成器"到"可验证的交互原型工作台"

现状原型模块的能力链是：`需求(一句话) → spec 文档 → OpenUI Lang 原型 → 预览`。进阶后：

```
需求(一句话) → spec 需求文档(契约)
    → OpenUI Lang 原型(交互程序 + 行为契约)          ← 组件/模板生态扩充（§5.3）
    → 预览验证（渲染器 preview 契约 + 自愈）          ← 验证门（§5.4）
    → 行为走查（agent 响应回路 + 验收清单）            ← 交互回路（§5.2）★ 核心
    → 交付（.ddp / HTML）与留存（版本/走查报告）       ← 留存（§5.6）
```

**能力支柱与分期**：

| 支柱 | 内容 | 对应差距 | 分期 |
|------|------|---------|------|
| 交互回路 | 行为契约 + agent 响应回路 + 验收走查 | G1 | P0 |
| 生态扩充 | 组件库 11→24、多页导航模板、设备壳 | G1/G2 | P0-P1 |
| 验证门 | preview 契约增强 + prototype.verify 终检 + 自愈 | G3 | P1 |
| 品牌联动 | DESIGN.md token → 原型视觉变量 | G2 | P1 |
| 留存 | 版本切换 UI、方向选择、走查报告入 design-store | G4 | P2 |

### 5.2 交互回路设计（P0，核心）——原型从"能看"到"能验"

**现状事实**（§1.4）：`a2ui:action` 双向链路（渲染器 → IPC → MCP `a2ui_action` → agent → surface 更新回推）已在 A2UI 面完整可用；原型模块（OpenUI Lang）的面板 action 是单向 UI 事件，不回传 agent；三层定位的 boundary guard 禁止 designer 技能调用 A2UI surface 工具族。

**设计决策**：

1. **行为契约层（不改语言、不换渲染器）**：OpenUI Lang 语法与 11 组件 schema 保持不变（守住 `@openuidev/lang-core` 流式优势与防漂移机制），在 SKILL.md 中新增"action 命名约定"：`Button(label, "域名:动作")`，如 `auth:submit` / `nav:goto:orders` / `data:refresh` / `form:reset`。语义 ID + action 命名空间让 agent 在响应回路里能定位"发生了什么"。
2. **回传通道（复用而非新建）**：PrototypePanel 的 `handleOpenuiAction` 事件经既有 `IpcRequest.A2uiAction` 转发链（`main/index.ts:1936-1959` 已实现）回传 agent；契约层把通道名泛化为 `design:action`（旧名保持兼容别名），preload 暴露 `designAction(surfaceId, actionName, context)`。零新增主进程特权面。
3. **agent 响应模式（双模式）**：
   - **人工走查模式（默认）**：用户在原型上点击 → 事件经后台静默通道回传（`runSubagent({silent:true})` 既有通道，不产生主会话记录，守住 prototype-companion Issue 2 不变量）→ 响应者 agent 输出更新后的完整原型程序（全量替换语义 + 语义 ID 保证 diff 可读）→ 预览刷新。用户感知："原型会响应"，agent 附一句状态变更说明。
   - **验收走查模式**：spec 的「验收标准」→ 生成可勾选验收清单 → agent 自动派发合成 action 序列驱动原型 → 逐项记录 pass/fail 与观察 → 输出走查报告（存 design-store 的 `meta.verification` 字段）。该模式需要"agent → 原型"的派发通道：原型 iframe 内注入一个微型 action dispatcher（监听 `postMessage` 派发合成点击/事件），由渲染器宿主代理转发——纯前端，无新特权。
4. **状态模型（两代演进）**：
   - **v1（P0）**：无持久状态机——状态活在 agent 上下文；每次响应 = 读当前程序 + 事件上下文 → 写更新后程序。实现最简，token 成本靠"复制前一版增量修改"控制（已有语义）。
   - **v2（P2）**：OpenUI Lang 增加 `state` 声明（`session = State({user: null})`），渲染器持有状态空间，action 触发**客户端状态迁移**（表单校验、导航、显隐），agent 仅在数据获取/复杂校验时介入——"edge-triggered agent"模式，token 最省、响应最快。与 a2ui 的 dataModel/checks 机制同构，可复刻其校验思想而不引入 A2UI surface。
5. **边界纪律（守住三层定位）**：行为回路是原型模块自己的交互面（`design:action`），不调用 `render_surface` 族；`design-a2ui-boundary.test.ts` 更新为：designer 技能仍不得调用 A2UI 工具，但原型面板的 action 回传走 `design:action` 通道（guard 断言从"禁止 a2ui_action"调整为"禁止 designer 技能直呼 A2UI 工具族"）。

**验收口径**：① 人工走查：原型上点击 → 面板出现"agent 响应中" → 原型更新且 diff 可读；② 验收走查：跑通 spec 验收清单并输出 pass/fail 报告；③ 主会话零记录（silent 通道断言保持）；④ boundary 测试更新且全绿。

### 5.3 组件与模板生态扩充（P0-P1）

- **组件库 11 → 24**（分组扩展，schema 单一事实源 + `openui:prompt` 防漂移机制照旧）：
  - Interactive 族新增：`Select` / `Checkbox` / `RadioGroup` / `Tabs` / `Modal` / `Drawer` / `Toast` / `Pagination` / `Switch` / `Slider`
  - Data 族新增：`Table`（列 → 行数据模型）/ `Chart`（SVG 占位，零依赖）/ `Avatar` / `Progress` / `EmptyState` / `Loader` / `StatTrend`
  - 每个新组件同时产出：schema 定义 + React 实现 + **SKILL.md 组件表条目**（生成式，防漂移）+ 1 个原型用法示例（进 layouts）。
- **多页原型模板**：映射 spec「页面清单」的多页导航壳（侧边栏/顶部导航 + 页面容器），页面切换即 `nav:goto:<page>` action——与 §5.2 回路天然衔接。macrostructures 十个骨架给出各自的**原型节奏表**（如 dashboard-cockpit = sidebar + KPI strip + panel grid）。
- **设备壳**（open-codesign device-frames 思想）：纯 CSS 设备壳（桌面默认 / mobile 375px / tablet），移动端壳自动触发 taste 的 375px 断点检查——不引入任何依赖。
- **数据接入保持**：tool-provider 7 个 `design.*` 只读工具（原型内 `Query()` 零 token 取数）不变；SKILL.md 强化"mock 数据要真实结构"纪律。

### 5.4 验证门（P1）：preview/done 协议 + 验收走查

借鉴 open-codesign 的 preview/done 双门（`tools/preview.ts` / `tools/done.ts`）与 open-design 的 artifact lint：

- **preview 契约增强**：现有纠错回路（correction.ts 结构化错误码回喂）升级为完整 preview 返回契约——console 错误（≤50 条上限）/资源错误（≤20）/DOM outline（≤4 层，纯文本模型可用）/布局指标（节点数、宽高）→ agent 自愈重试 **≤3 轮**（同错去重护栏保留，防死循环）。
- **终检门 `prototype.verify`**（新 Action，纯编排）：对最新原型做两层终检——
  - 静态 lint：taste 可机检条目引擎化（触达尺寸 ≥44px、无 375px 横向溢出、对比度（token 可计算色值时实测）、表单 label 完整、无重复 id）；
  - 运行时验证：隐藏 BrowserWindow（或脚本化 preview 宿主）注入验收清单 action 序列，收集 console/资源错误与状态断言；
  - 输出 done report（pass/fail/原因/修复建议），**不通过则 agent 自愈重试 ≤3 轮**，仍失败则如实交付并注明（open-design"没有交付物不算完成"与诚实交付的平衡）。
- **验收标准可执行化**：spec-writer 输出已含「验收标准」（5-10 条可勾选）——`prototype.verify` 将其解析为清单格式，验收走查结果入 `meta.verification`（design-store 扩展字段，版本快照联动）。

### 5.5 品牌联动与视觉连续性（P1）

- **DESIGN.md → 原型视觉**：新增 token 映射层——`.deeporca/DESIGN.md`（或设计系统包 tokens）→ OpenUI 渲染器 `--ui-*` CSS 变量（library.tsx 已同源桌面主题，扩为"品牌 token 优先"）。原型的色彩/字体/间距从第一步就受品牌契约约束，**原型 → 视觉稿的视觉连续性**由此成立（视觉稿模块的 .dd 用同一份 token 契约，§6）。
- **方向选择（轻量版）**：原型走查前可选「原型方向」2-3 个预设（密度/语气两轴，如 compact-utility / airy-friendly），确定性映射到间距与字号 token——借鉴 open-design direction picker 的"禁模型即兴"思想，但不引入完整视觉方向体系（那是视觉稿模块的事）。

### 5.6 留存与工作区（P2，承接 prototype-companion 挂起项）

prototype-companion（2026-08-31 挂起、并入 redesign）的四个 Issue 在本方案中**全部承接**：

| Issue | 内容 | 本方案落点 |
|-------|------|-----------|
| 1+2 | 悬浮对话框 + 不占主对话 | PrototypeDialog 作为原型模块伴随操作面（悬浮、非模态、silent 通道零会话记录）——交互回路的人工走查模式正好复用同一悬浮面 |
| 3 | 操作落任务树 | `prototype.spec/materialize` + 新增 `prototype.verify` 成功后 appendStep（workspace 树活动分支，sessionless 落点） |
| 4 | 侧栏分轨 + 滚动 | spec 文档进左侧 markdown 侧栏；原型/视觉稿进 design 面板；滚动契约随任务树精致化联动（保持原挂起口径） |

**版本切换 UI（重估 2026-08-18"拍板不做"）**：design-store 已有 versions FIFO 20 与血缘 id——提供最小化「版本列表 + 各版预览 + 回退/另存为新版本」UI（不引入复杂 diff）。这是 G4 在设计域的最小闭环，与 file-history（undo）互补：版本 = 设计意图的里程碑，file-history = 编辑回溯。

### 5.7 交付与导出

- `.ddp` 保持现有规范（manifest + source.openui.txt + viewer stub），并按**附录 C** 进阶：① OpenUI Lang 轻量独立编译器 → index.html 升级为**可交互原型**（任意浏览器可走查）；② 走查报告随包（`verification.md` 第四个条目）；③ manifest 增强（contentHash/来源引用/verification）。
- **新增单文件 HTML 原型导出**：原型程序 + 运行时 → 自包含 HTML（内联渲染器产物），可脱离 DeepOrca 打开/分享（对齐 open-design"产物即真实代码，可导出 HTML/PDF"）。
- 走查报告随 .ddp 打包（`verification.md`）。

## §6 UI 视觉稿设计模块进阶设计

### 6.1 定位升级：从"单页文档生成器"到"UI 设计系统工作台"

现状视觉稿模块的能力链：`需求/原型 → deep-design 技能 → .dd 单页文档 → 预览 → 迭代`。进阶后：

```
需求/原型 → 方向选择（确定性 token 映射）→ .dds 设计系统包 + 多页 .dd
    → 组件原子库引用（组件/变体/状态，杜绝复制漂移）
    → 渲染后机检（lint 引擎 + 轴审计）→ LLM 评审门（opt-in，强制证据）
    → 版本漫游 / 来源可见 / 中间产物留存
    → 交付（.ddu 增强：token 表 + 组件规范页 + tokens.css 导出）
```

**能力支柱与分期**：

| 支柱 | 内容 | 对应差距 | 分期 |
|------|------|---------|------|
| 文档模型升级 | .dd v2：tokens schema + 组件原子库 + 多页 + 可寻址 | G2 | P0 |
| 质量机制 | design.lint 引擎 + 渲染后机检 + LLM 评审门（opt-in）+ 自愈 | G3 | P1-P2 |
| 留存与方向 | 方向选择 + 版本漫游 UI + 骨架留存 + 来源可见 | G4 | P1-P2 |
| 品牌闭环 | token 候选提取（与 dembrandt 互补）+ token 生命周期 | G5 | P1 |
| 连续性 | 与原型模块共享 token 契约 + 页面三方映射 | G2 | P1 |
| 交付 | .ddu 增强（token 表/组件规范页）+ tokens.css 导出 | G2 | P1 |

### 6.2 文档模型升级（.dd v2、P0）

**① tokens 规范化（对齐 DTCG 语义，分层渐进）**
- **schema 化**：新增 `tokens.schema`（color/typography/spacing/radius/shadow/motion 六组 + 必填/类型校验）。现状 parser 是扁平正则，升级为 schema 校验——**旧 .dd 降级兼容**（校验失败只警告不阻断，保住存量产物）。
- **引用语法**：采纳 penpot 的 `{组.名}` 引用（如 `accent: {brand.primary.500}`），编译器解析引用并校验环引用（防递归）。
- **按名应用**：sections 的 CSS 只引用变量名、不硬编码色值（taste 已有此纪律，增加 lint 强制——"token 外颜色 = 违例"，见 §6.3）。
- **token-set/theme 轻量版（P2）**：一个 .dds 可带多主题（light/dark/品牌变体），渲染期一键切换——"AI 只改 token 层、全稿联动"（penpot 借鉴 #2）。

**② 组件原子库（P0）**
- `.dds` 新增 `components` 声明：命名的 HTML 片段 + 参数插槽 + **变体/状态**（hover/pressed/disabled/loading/error——现状只有 hover 一条纪律）。
- sections **引用组件而非复制**：组件定义处修改 → 全部引用处联动（touched 组同步用 penpot 思想：实例覆盖显式记录，同步时按组回写，见 §6.2 注）。
- 组件库与原型组件库**同源映射**（§7.1）：原型（OpenUI Lang）组件 ↔ 视觉稿（.dd）组件语义一一对应——"原型是低保真品牌版，视觉稿是精装版"。

**③ 多页设计系统包（.dds，P0-P1）**
- `.dds` 包 = 1 份设计系统契约（tokens + 组件 + 品牌）+ N 页 `.dd`（页面清单 + 共享 token/组件）。
- DesignPreview 支持页切换与"设计系统页"（组件/变体/状态样本墙）——对齐 penpot"一个功能一块画板"组织法与 spec 页面清单三方映射（§6.5）。

**④ 可寻址与操作级 diff（P0-P1）**
- **节点地址协议**：给 .dd 的 section→元素补可逆地址（open-pencil `nodeToXPath` 思想：`//section[@data-dd-id=hero]//button[2]`），AI 编辑后报告"改了哪个地址"，预览可高亮。这是对现有 `<!-- dd:section -->` 标记的**任意层级**升级。
- **变更摘要契约**：`update_design` 返回 section 级操作摘要（新增/修改/删除），写入版本快照 note——penpot 44 种操作流思想的低成本版：不做对象表重构，只做"变更即日志"。

> 注：不把 .dd 重构成 penpot 式对象表 + 操作流（那是画布编辑器级投入）。".dd 是自包含 HTML 文档"的既有价值（可脱离宿主、任何浏览器可开）必须保留；对象表思想只落到"tokens/组件/地址/变更摘要"四个可协商的契约点上。

### 6.3 质量机制（P1-P2）：三层闸

参考 open-design（lint + 强制证据评审 + 加权门）、open-codesign（preview/done + 自愈）、open-pencil（defineRule 架构 + token 审计）：

| 闸 | 机制 | 内容 |
|----|------|------|
| 生成前 | taste 纪律（prompt 层，已有） | 19 条 P0 + 五维自评门槛（保留，见下） |
| 生成后 | **design.lint**（新 action，确定性） | 规则引擎：`defineRule({meta, match, check})` + `report(ruleId/severity/nodePath/suggest)`，preset 三套（taste-required / anti-slop / a11y）。规则来源：① taste 可机检条目（4/8px 间距扫描、单 accent、无外链图、section 标记完整、data-dd-id 唯一、`1fr` 无 minmax）；② open-design 七宗罪（默认 indigo、双停渐变、emoji 图标、编造指标、填充文案——`AI_DEFAULT_INDIGO` 常量法）；③ open-pencil 17 规则映射（no-hardcoded-colors（token 外颜色）、consistent-radius、touch-target、min-text-size、no-empty-frames、no-default-names）；④ a11y（对比度在 token 可解析为 RGB 时计算、label 完整性）。作用于 .dd 与 OpenUI 程序文本（轻量解析，零依赖） |
| 生成后 | **渲染后机检** | 在 DesignPreview iframe 内执行：375px 横向溢出、触达尺寸、视口 meta、字体缺失、断点折叠——输出实测定量（非模型自报） |
| 交付前 | **design.review**（新 action，opt-in） | 五维 critique 升级：**强制证据**（无证据的分数拒绝，open-design critique 纪律）+ **12 项布尔清单**（open-codesign parity 思想：可机检项先布尔化）为前门，浮点自评只留不可机检的维度 + **加权门**（critic 0.4 / brand 0.2 / a11y 0.2 / copy 0.2，composite ≥ 8/10）+ **≤3 轮收敛 + ship_best 兜底**（Design Jury 参数），同会话多 turn（静默通道，不另起进程） |

**自愈**：lint/机检失败 → agent 修复 → 重检（≤3 轮）；仍失败如实交付并附 findings（对齐"没有交付物不算完成"与诚实交付的平衡）。design.audit 保留并扩展：三轴 + HTML 子集之外增加 **token 合规轴**（硬编码颜色/间距计数）。

### 6.4 留存与方向（P1-P2）

- **方向选择（design.materialize 前置，P1）**：内置 5 个预置视觉方向（如 editorial-minimal / tech-utility / human-friendly / brutalist-mono / glass-modern），每个方向 = 确定性 OKLCH 调色板 + 字体栈 + 版式 posture + 现实参照（open-design directions.ts 思想：**"一键选择 → 确定性 palette，禁模型即兴"**）；可选 svg-options 题型（open-codesign `ask()`：SVG 图形让用户点选而非文字描述）。
- **版本漫游 UI（P1，重估"拍板不做"）**：版本列表 + 各版预览 + 回退/另存为新版本（复用 design-store versions FIFO 20 + 血缘 id；快照内容可直接编译预览）——G4 的最小闭环。
- **骨架与中间产物留存（P1）**：Step 2b 两段式生成的骨架确认 → 作为版本 note 留存（"中间产物即资产"）。
- **来源可见（P2）**：版本快照记录上下文来源（原型程序、DESIGN.md 版本、参考 URL、方向选择）——"这版为什么长这样"可追溯（open-design 0.14 composer 上下文来源可见）。

### 6.5 与原型模块的连续性（P1）

- **共享 token 契约**（§7.1）：原型与视觉稿同一份 token——视觉稿阶段不再"从零定风格"。
- **页面三方映射**：spec 页面清单 ↔ 原型页面 ↔ 视觉稿页面，缺页告警（design.materialize 提升流已存在，补映射校验）。
- **走查联动**：原型走查的验收结果作为视觉稿验收输入（`meta.verification` 跨产物引用）。

### 6.6 交付增强（P1）

- **.ddu 增强**（详见附录 C）：内嵌 token 表（tokens.json/tokens.md）+ 组件规范页（components.html 样本墙）+ 页面索引（pages.json）——视觉稿从"一张图"变"一套规范"。
- **tokens.css 导出**：.dds tokens → CSS 变量文件 + Tailwind theme 片段（penpot Inspect 思想轻量版）——开发交接的最小有用面；React/Tailwind 代码导出**维持拍板不做**（roadmap 口径不变）。
- 单文件 HTML 导出与 .ddp/.ddu 打包机制保持；P2 增 `design:importPackage` 往返导入（附录 C K3）。

### 6.7 品牌管线闭环（P1）

现有：dembrandt 摄取（URL→tokens，SSRF + 版权 deny-list 在 core）→ DESIGN.md（Provenance）→ deep-design Step 0 生成约束 → design.drift 漂移闸门。

**新增 token 候选提取**（open-pencil analyze colors/clusters 三步法，与 dembrandt 互补）：对既有 .dd 产物/用户页面反查"未规范 token 候选"——hex 频次统计 + 语义聚类（色距 ≤ 阈值相似合并）+ suggested 变量名 → 供沉淀进 DESIGN.md。dembrandt 管"从规范页面提取既定 token"，候选提取管"从未规范产物反查 token 候选"。

**token 生命周期**：摄取 → 规范化（schema）→ 冻结（Provenance）→ 应用（生成约束）→ 漂移检测（drift）→ 演进（候选合并）——DESIGN.md 增 tokens 版本字段。

## §7 共享内核设计

### 7.1 统一 token 契约与单一权威（P0）

**目标**：一份契约贯穿 DESIGN.md 品牌契约 ↔ .dds tokens 包 ↔ .dd front-matter ↔ OpenUI `--ui-*` 渲染变量 ↔ audit 机检 ↔ lint 引擎。

- **形态**：`tokens.schema`（六组 + 校验）+ 映射层（DESIGN.md 品牌段 → tokens 包 → 渲染期 CSS 变量；原型渲染器同源）。
- **口径统一（消化实证发现）**：
  - 多样性轴单一权威：taste 三轴（paper 亮度带/display 字族/accent 色相带）与 deep-design 把 macrostructure 也算可计算轴的表述**冲突**——统一由 design.audit 计算并唯一引用，SKILL.md 改为引用同一计算而非自行定义；
  - 全仓库口径审计清单（一次性修正）：11 工具（非 12）、DesignPipeline 三成员（非 2）、taste P0 19 条（非 11/10）、seed.html 12 变量（注释 6）、getSeedCss 与 seed.html 数值同步（≥5 处偏差）；
  - **防漂移机制扩展**：现有 schema→prompt 生成（openui:prompt 挂 build）扩展为"设计口径快照测试"（断言 SKILL.md 组件表/规则数/工具清单与代码一致，构建期失败即拦截）。

### 7.2 质量引擎（P1）

- **design-lint 模块（core）**：defineRule 注册表 + match 白名单 + LintNode 浅投影 + preset 三套（§6.3），作用于 .dd 文本与 OpenUI 程序文本；输出 findings（ruleId/severity/nodePath/suggest）——与现有 design.audit（三轴 + HTML 子集）合并为一个"design.knowledge"审计面，规则可插件式扩展。
- **渲染后机检（desktop）**：DesignPreview/PrototypePanel 注入机检脚本（375px 溢出/触达/对比度定量），结果随工具结果回传。
- **LLM 评审门（opt-in，默认关）**：design.review / prototype.review 共用（§6.3）；关 = 不影响迭代节奏，开 = 交付前把关。

### 7.3 留存、版本与记忆（P1-P2）

- **版本漫游 UI**（§6.4）两模块共用。
- **中间产物**：方向选择、骨架确认、走查报告 → `meta.json` 扩展字段（verification/review/direction）。
- **用户设计记忆（P2）**：`.deeporca/designs/preferences.json`——默认设计系统/方向/字体、常用宏结构、品牌来源、**拒绝记录**（"用户说过的不要什么"，如"不要紫色/不要圆角"）→ 组装语境时读取并注入 deep-design/pm-designer（与 DESIGN.md 同机制）。对齐 open-design"截图/字体/调色板/确认产物积累为下次默认"。
- **跨产物血缘**：prototype ↔ design ↔ spec 三方 artifactRefs 关联（design-store 扩展），视觉稿的修改可追溯到来源原型。

### 7.4 评估体系（P2）

现状：eval 仅 1 例正例、rule_based 字符串断言、无负例、不验证工具调用。
- **用例扩充**：负例（taste 违例、越界发明范围、anti-slop 触发、section 标记缺失）+ 多管线（prototype.spec→materialize 全链路）；
- **断言升级**：字符串断言 + **工具调用断言**（must_call: render_design）+ **机检结果断言**（lint findings 数 = 0）；
- **多模型矩阵**（deepseek-v4-flash 为主 + 备选）与**回归门禁**（build/CI 挂载）；
- **布尔判分基准**（远期）：稿图→实现视觉一致性 12 项清单（open-codesign BENCHMARKS 思想）。

### 7.5 开放面：design-as-asset（P3）

- 查询面：design-store list/read（已有）+ tokens/组件/页面级查询（dd 解析器 → 结构化元数据）；
- 操作面：操作级 diff 摘要（§6.2④）+ 预览截图（iframe → PNG）；
- 目标：**"agent 与设计稿之间有稳定协议，而不是提示词拼 HTML"**（penpot 借鉴 #6）——但以轻量契约实现，不做画布引擎。

## §8 目标架构与数据流

### 8.1 目标架构（文本视图）

```
┌─ 产品原型设计模块（prototype.*）────────┬─ UI 视觉稿设计模块（design.*）────────┐
│ prototype.spec → spec.md（契约）         │ design.materialize(需求/原型)          │
│ prototype.materialize → OpenUI 程序      │   → 方向选择 → .dds + 多页 .dd         │
│ 交互回路：design:action 回传 → agent     │ 组件原子库引用（变体/状态）             │
│ 响应 → 预览刷新 / 验收走查               │ 可寻址 + 变更摘要 → 版本 note          │
│ prototype.verify（终检门 + 自愈）        │ design.lint + 渲染后机检 + review(opt) │
└──────────────────┬──────────────────────┴──────────────────┬────────────────────┘
                   │          共享内核（设计域）               │
                   ▼                                          ▼
┌─ 统一 token 契约（DESIGN.md ↔ .dds tokens ↔ 渲染变量）──────────────────────┐
│ 质量引擎（lint 注册表 / 轴审计 / 机检 / 评审门）                              │
│ design-store（产物 + 版本 FIFO 20 + 血缘 + verification/review/direction）   │
│ 留存（版本漫游 UI / 中间产物 / 设计记忆 preferences.json）                    │
│ 评估（evals 扩充 + 工具调用断言 + 回归门禁）                                  │
│ 开放面（查询 / diff 摘要 / 截图 / 导出 .ddp/.ddu/tokens.css）                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 新增资产清单（方案级，不实现）

| 层 | 新增 | 复用 |
|----|------|------|
| core actions | `prototype.verify`、`design.lint`、`design.review`（opt-in） | design.materialize/extract/drift、prototype.spec/materialize |
| core 模块 | design-lint 规则引擎、tokens.schema 校验器 | design-audit.ts（扩轴）、a2ui-seam |
| templates | 方向 preset（5 个）、组件原子库 schema 与示例、多页原型节奏表、lint 规则文档 | systems ×9、macrostructures ×10、seed/layouts |
| desktop renderer | 交互回路（action 回传 + dispatcher）、版本漫游 UI、方向选择 UI、机检脚本 | DesignPanel/PrototypePanel/DesignPreview、processor.ts |
| desktop main | `design:action` 通道泛化（兼容 a2ui:action）、design-store 扩展字段 | a2ui-mcp.ts、dd-package.ts、dembrandt-browser.ts |
| 技能 | deep-design（.dds/组件/地址协议）、pm-designer-openui（action 命名）、taste（口径统一）、spec-writer（验收清单） | SKILL.md 协议、openui:prompt 防漂移 |
| 测试 | boundary guard 更新（§5.2）、lint 规则单测、eval 负例、口径快照测试 | design-a2ui-boundary.test.ts、design-store.test.ts 等 |

### 8.3 数据流（四个闭环）

1. **生成流**：需求 → spec → 原型 / 方向 → 视觉稿（现状，加方向与映射校验）。
2. **交互回路流**（新）：原型 action → `design:action` IPC → 静默子代理 → update_openui → 预览刷新（§5.2）。
3. **验证流**（新）：渲染 → preview 契约（错误/DOM outline/机检）→ lint → 加权评审 → 自愈重试 → 存档。
4. **留存流**：版本快照 + 方向/骨架/走查 note + 来源可见 → preferences 记忆（§7.3）。

## §9 实施路线图（分期与验收）

> 全部为方案级分期；每期验收可测。延续"零新增守护进程、零新增重型依赖"原则。

### P0 — 文档模型与交互回路（核心价值）
- ① **原型交互回路 v1**：action 命名约定（SKILL.md）→ `design:action` 回传（兼容旧通道）→ agent 响应 → 预览刷新；boundary guard 更新。
- ② **.dd v2 文档模型**：tokens.schema 校验（旧稿降级兼容）、`{组.名}` 引用、组件原子库（组件/变体/状态）、节点地址协议、变更摘要契约。
- ③ **口径审计**：§7.1 清单一次性修正 + 防漂移快照测试挂 build。
- **验收**：原型点击可见 agent 响应且 diff 可读；.dds + 多页 .dd 全链路（生成→预览→迭代）；旧 .dd 产物可打开；`npm run check && npm test` 全绿。

### P1 — 验证门与留存
- ④ preview 契约增强（DOM outline/错误上限/机检）+ 自愈 ≤3 轮。
- ⑤ `prototype.verify`（静态 lint + 运行时验证 + 验收清单走查）。
- ⑥ `design.lint`（规则引擎 + 三 preset）+ design.audit 扩 token 合规轴。
- ⑦ 版本漫游 UI、方向选择 UI（5 preset + svg-options 可选）、.ddu 增强（token 表/组件规范页）、tokens.css 导出、token 候选提取（品牌闭环）。
- **验收**：lint 命中真实违例并可定位到节点地址；验收走查输出 pass/fail；版本列表可预览/回退；方向选择产生确定性 token 映射。

### P2 — 评审、记忆与评估
- ⑧ `design.review`（opt-in 加权门 + ≤3 轮 + ship_best + 12 项布尔前门）。
- ⑨ 设计记忆（preferences.json + 语境注入 + 拒绝记录）。
- ⑩ evals 扩充（负例 + 工具调用断言 + 机检断言 + 回归门禁）。
- ⑪ prototype-companion 挂起项落地（PrototypeDialog + 任务树落点 + 侧栏分轨）。
- ⑫ update_openui delta 补丁研究（token 经济，roadmap 方向；若 SDK 支持则实现）。
- **验收**：评审门在开启时拦截低于门槛的产物并给修复建议；记忆使第二次生成默认沿用用户品牌；eval 含负例且 CI 门禁生效。

### P3 — 开放面与生态
- ⑬ design-as-asset（查询/diff 摘要/截图）、svg-options 题型、组件库 11→24、多端设备壳预览。
- **验收**：设计产物可经查询面结构化访问；新增组件全部带 schema+示例+SKILL 条目。

## §10 不做清单与风险

### 10.1 不做（含维持既有拍板）

| 项 | 理由 |
|----|------|
| 画布编辑器（penpot/open-pencil 式场景图 + 操作流引擎） | 与"AI 生成式设计 + 浏览器渲染"定位冲突；投入不成比例（§6.2 注） |
| .fig Kiwi 解析 / .pen 格式 | 逆向成本巨大、无直接收益 |
| 实时多人协作（Yjs/Trystero/CRDT/WebSocket） | 桌面单机产品，无真实诉求 |
| Clojure/CanvasKit 技术栈迁移 | 与 Electron + TS 架构正交 |
| React/Tailwind 代码导出 | 维持 2026-08-18 拍板（.ddu + tokens.css 已是开发交接最小有用面） |
| A2UI 面合并进 designer | 维持三层定位；交互回路走 `design:action` 自有通道 |
| tweaks 滑杆面板 | EDITMODE 协议转**观察清单**（P3 可选，若验证门跑通后再评估） |
| open-design daemon / BYOK 代理 / 付费云 | 体量、安全面、离线原则 |

### 10.2 风险与缓解

| 风险 | 缓解 |
|------|------|
| OpenUI Lang DSL 扩展受限（action 语义、state 声明依赖上游 SDK） | v1 只用现有 action 参数 + 命名约定（零语言改动）；state 声明（v2）先做可行性验证再承诺 |
| 全量替换更新的 token 成本（与 roadmap delta-only 方向并存） | P2 研究 delta 补丁；语义 ID + 增量修改纪律先行 |
| 评审门自评造假（模型自报高分） | 强制证据引用 + 12 项布尔前门（确定性）+ 机检对照；opt-in 默认关 |
| 交互回路滥用（action 回传通道越权/死循环） | 复用既有权限面（silent 通道不外露）；同错去重护栏；boundary guard 更新 |
| 口径漂移复发 | §7.1 防漂移快照测试挂 build（机制而非自觉） |
| 快照体积膨胀 | FIFO 20 已有 + 快照仅内容变化时落盘（现状机制保持） |
| surface 持久化无 id 校验（实证发现） | 若扩展 Surface 持久化则补校验与 undefined 键清理（列入 P0 口径审计） |

## 附录 A 四项目借鉴矩阵

详见 `docs/research/2026-09-01-design-systems-comparative-study.md` §5（完整矩阵）与 §7（汇总清单）。核心一行版：

| 项目 | 吸收 | 不引入 |
|------|------|--------|
| open-design | 质量机制（lint/强制证据评审/加权门）、留存哲学、方向选择、模板经济、输出契约 | daemon、BYOK 矩阵、付费云、双 prompt 开关 |
| open-codesign | preview/done 双验证门、12 项布尔判分、资源清单渐进披露、anti-slop 提示词、品牌即数据 | 裸 JSX+Babel 渲染、Electron 壳 |
| open-pencil | token 提取/聚类管道、defineRule lint 架构、可寻址定位、快照 undo 闭环、语义描述层 | Tauri/CanvasKit、.fig 逆向、.pen 本体、100+ 工具粒度 |
| penpot | 结构化文档模型（对象表+操作流思想）、DTCG tokens、组件变体 touched 同步、多页组织、design-as-asset | Clojure 栈、自托管规模、协作引擎 |

## 附录 B 与既有规格的关系

| 既有规格 | 关系 |
|----------|------|
| `specs/deep-design/design.md` | 本方案的系统前身：四层文件系统（DESIGN.md/模板/SKILL/浏览器展示）与"零 daemon"原则**全部继承**；.dd 格式按 §6.2 升级 |
| `specs/pm-design-v2/design.md` | 本方案承接其统一工作台方向；design.materialize 管线路由（flash 判定）保留；管线集合"openui|design|spec"三成员口径修正 |
| `specs/prototype-companion/design.md` | 挂起项由本方案 §5.6 承接（对话框/任务树/侧栏分轨/滚动随任务树精致化）；其"主工作区隔离不变量"被 §5.2 交互回路继续遵守 |
| `specs/a2ui-integration/design.md + design-r2.md` | 三层定位与 v0.9.1 协议不变；本方案只在原型模块新增 `design:action` 自有交互面（不触碰 A2UI surface 面）；boundary guard 更新 |
| `specs/ui-domain-regroup/design.md` | drift 闸门在设计面板（现状保持）；本方案把 drift 扩为 token 生命周期一环（§6.7） |
| `specs/skill-eval/design.md` | 评估体系按 §7.4 扩充（负例/工具调用断言/机检断言/回归门禁） |
| `docs/research/2026-08-17-opendesign-openpencli-vs-designer.md` | 其"建议动作"（系统库扩充/五维自评/anti-slop/两段式生成）已全部落地；本方案进入机制级阶段 |
| `docs/research/2026-09-01-design-systems-comparative-study.md` | 本方案的研究底座（四项目一手核实 + 对比矩阵 + 借鉴清单） |

## 附录 C .ddp / .ddu 交付格式：现状规范与进阶设计

> 现状核实：2026-09-01 直读 `packages/desktop/src/main/tools/dd-package.ts`（226 行）+ `specs/deep-design/design.md` §0 + `specs/pm-design-v2/design.md` 头部（格式拍板 2026-08-18，P4-1 已实现）。

### C.1 现状格式规范（已实现）

两种格式均为**特殊 ZIP 压缩包**（任何解压工具可读），零依赖构建（`node:zlib` deflateRawSync(level 9) + 手写 CRC32/本地头/中央目录/EOCD；不可压缩数据回退 store；UTF-8 文件名标志）：

```
.ddp（pm-design 原型包，pipeline="openui"）        .ddu（ui-design 文档包，pipeline="design"）
├── manifest.json                                   ├── manifest.json
├── source.openui.txt  (OpenUI Lang 源码)            ├── source.dd        (.dd 文档)
└── index.html        (viewer 源码桩)                 └── index.html       (独立编译渲染)
```

`manifest.json` 字段（`DdPackageManifest`，formatVersion: 1）：

```json
{ "format": "ddp|ddu", "formatVersion": 1, "kind": "pm-design|ui-design",
  "title": "…", "artifactId": "…", "pipeline": "openui|design",
  "exportedAt": "…", "generator": "DeepOrca Desktop" }
```

生产链路：DesignPanel ⬇ 按钮 → `design:exportPackage` 特权通道 → 原生保存对话框；`.ddu` 的 index.html = `compileDdToHtml` 自包含产物（tokens + seed CSS + 内联 Tailwind JIT 脚本）；`.ddp` 的 index.html = 转义源码展示桩 + 回 DeepOrca 提示（OpenUI Lang 无独立 HTML 编译器，渲染依赖应用内 React 运行时）。`dd-package.test.ts` 已有单测。

### C.2 现状缺口（对照交付目标）

| # | 缺口 | 影响 |
|---|------|------|
| K1 | `.ddp` 的 index.html 是**源码桩**，不可交互、不可预览 | 原型包无法脱离 DeepOrca 演示——"交付给开发/客户"只剩源码进 DeepOrca 一条路 |
| K2 | `.ddu` 无 token 表、无组件规范页、无页面索引 | 视觉稿交付仍是"一张图 + HTML"，不是"一套规范"（G2 在交付端的体现） |
| K3 | 两个包**只导出不复导**（无 import 路径回 design-store） | 交付物无法回流为资产；跨机器/跨会话迁移只能靠手工 |
| K4 | manifest 无 contentHash、无来源（.dds/原型 artifactRefs）引用、无 verification/review 摘要 | 包不可校验、不可追溯"这版为什么长这样" |
| K5 | 格式无独立规范文档、manifest 无 JSON Schema | 格式契约只活在代码里，外部工具/未来版本无法对齐；formatVersion 升级路径未定义 |

### C.3 进阶设计（与 §5.7 / §6.6 联动）

**① `.ddp` 可交互化（P1，核心）**
- **单文件 HTML 原型导出**：为 OpenUI Lang 增加轻量独立编译器（或静态化现有 react-lang 渲染产物 + 内联运行时 bundle）→ index.html 从"源码桩"升级为**可交互原型**（保留 source.openui.txt 条目不变）。这是 §5.7"新增单文件 HTML 原型导出"在 .ddp 上的落点；对齐 open-design"产物即真实代码，可导出 HTML/PDF"。
- **走查报告随包**（P1）：`verification.md`（终检门输出：验收清单 pass/fail + 机检 findings）作为第四个 ZIP 条目——交付物自带质量证明。

**② `.ddu` 规范包化（P1）**——承接 §6.6：
- 新条目 `tokens.json`（规范化 tokens，schema 校验后导出）+ `tokens.md`（人类可读 token 表）；
- 新条目 `components.html`（组件/变体/状态样本墙，"设计系统页"独立可开）与 `pages.json`（页面清单 + 与原型/spec 的映射）；
- index.html 增加"规范入口页"（页面索引 + token 概览 + 组件跳转），从"单页渲染"升级为"小站点"。

**③ 往返导入（P2）**：`design:importPackage` 新通道（与导出对称）——.ddu 的 source.dd 经 schema 校验后入 design-store（保留 generator/exportedAt 血缘）；.ddp 的 source.openui.txt 同理。交付物重新成为资产。

**④ manifest 增强（P1，向后兼容）**：formatVersion 升 2 时新增字段全部可选、v1 字段语义不变——
`contentHash`（source 的 SHA-256，校验用）、`sourceArtifactIds`（来源 prototype/spec/.dds 引用）、`designSystemId`（来源设计系统包）、`verification`（走查摘要引用）、`preview`（preview.png 条目引用，iframe → PNG 截图随包，交付对象不开 HTML 即见内容）。

**⑤ 格式治理（P0 口径审计内）**：manifest JSON Schema（`packages/desktop/src/tests/dd-package.test.ts` 挂 schema 校验）；格式契约文档化（tasks 阶段落 `specs/` 下独立小节或将本附录提炼为 `docs/formats/dd-package.md`）；formatVersion 升级规则（新增可选字段不禁用旧读取器；语义变更必须升版本）。

### C.4 分期与验收

| 分期 | 内容 | 验收 |
|------|------|------|
| P0 | manifest JSON Schema + 契约文档化 | 任意 zip 工具可解析；schema 校验 false-negative 为 0 |
| P1 | .ddp 可交互化 + .ddu 规范包化 + manifest 增强 | 交付的 .ddp 可在任意浏览器交互走查；.ddu 含 token 表与组件规范页；manifest 校验通过 |
| P2 | `design:importPackage` 往返导入 | 导出的包重新导入后产物与血缘一致 |