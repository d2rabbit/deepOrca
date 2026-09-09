# prototype-reliability — 原型生成链路根治：真实可靠 · 遵循 PRD

> 立项：2026-09-09（用户要求：从根源迭代审查原型设计模块，确保生成的交互原型**真实可靠**、**遵循 PRD**；原型设计可参考墨刀、Axure、Pixso、Figma、OpenDesign、Penpot）。
> 状态：**方案定稿，未实施**。审查证据来自三个并行只读探索（core action 链 / renderer / skill·质量闭环），全部根因带文件+行号。
> 关联：平台变体机制（2026-09-09 `4afa702c1` 已落地：三端结构化变体、`openuiVariants` 存储、设备定向修订入口）——本 spec 是该机制的可靠化收口。

## 1. 背景与目标

当前原型模块（`prototype.spec → materialize → verify → revise/arch`）已具备：标准化 PRD、OpenUI Lang 生成 + 官方解析器修复环、三端平台变体、版本化套件存储、交互播放模式。但真机走查与代码审查证实：**链路存在功能性断链**（三端生成在真实持久化语义下第二端必失败），且**「真实可交互 / 遵循 PRD」基本停留在 prompt 文案层**，机械验证只覆盖 schema 与接线。

成功标准：

1. `devices:["desktop","mobile","tablet"]` 的 materialize 在真实持久化下**三端全部落盘**（当前第二端必失败）；
2. 设备定向修订改的是**该设备的变体**（当前拿桌面版杂交覆盖手机变体）；
3. verify 能机械证明：**每个 `@Set($page,…)` 导航目标存在**（交互连线闭环）、**无孤儿页面**、**无死按钮**（含 `Action([])` 与 bare-string）；
4. PRD 页面清单与程序页面集的覆盖度被检查（Axure 页面树理念的最小机械化）；
5. 三端变体随 `.ddp` 导出与投影文件交付（当前只有桌面版）。

## 2. 现状审查结论（根因分级，文件+行号为证）

### 2.1 🔴 P0 — 功能性断链

**A. 多设备 materialize 第二端必触发 "suite head has moved"**
`packages/core/src/actions/prototype.ts:526-587`：设备循环内每次 `render_openui` 都传**最初的** `versionId`（:582），从不推进。第一端（desktop）落盘后 `appendDesignSuiteVersion` 追加新版本、head 前移，第二端携带旧 versionId 被 `readSuiteBase` 的 head 守卫拒绝（`a2ui-mcp.ts:544-550`）。同款坑在 fix-all 循环修过（head 线程化，`prototype-fix-all.test.ts` 头注即此回归），materialize 的设备循环漏修。
**测试为何没抓到**：core 侧 `prototype-devices.test.ts` mock 了 `executeMcpTool`（全部返回成功）；desktop 侧 `a2ui-device-variant.test.ts` 每次 render 前手动取 `currentVersionId`——两边各自正确，真实接缝零覆盖。

**B. 设备定向修订基线取错 → 桌面杂交产物覆盖手机变体**
`prototype.ts:807`：`current = input.part === "spec" ? content.spec : content.openui`——即使 `device:"mobile"`，喂给子代理的待修订程序是**桌面本体**，再把「桌面程序+手机平台契约」的杂交产物写进 `openuiVariants.mobile`（`a2ui-mcp.ts:1226-1232`），**覆盖真正的手机变体**。`openuiVariants` 全文只在类型/注释/verify 出现，revise 路径从不读它。
连带：renderer 修订后 diff 的 `after` 读 `next.openui`（`PrototypeWorkspace.tsx:593`）而非 `next.openuiVariants[device]`，设备修订永远显示两份不同程序的伪 diff。

**C. action JSON schema 漏声明新参数**
`prototypeMaterializeDefinition.parameters`（`prototype.ts:479-488`）缺 `devices`；`prototypeReviseDefinition`（:751-763）缺 `device`。两者均 `additionalProperties:false`，且 `toToolDefinitions` 把 schema 原样发给 LLM——模型侧工具契约里这两个参数**非法**，模型自发调用三端生成/定向修订的通道在契约层关死。

### 2.2 🟠 P0 — 验证层「宣称但未执行」（真实可靠/遵循 PRD 的根缺口）

| 宣稱                       | 出处                                                                                            | 实际                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 页面清单是 source of truth | spec-writer SKILL.md:95-96、pm-designer SKILL.md:21-24、render_spec 描述（a2ui-mcp.ts:950-952） | verify 只查标题正则（`hasPageList`，prototype.ts:643-648），**不比对程序页面**。全仓唯一机读页面清单表的解析器在 `prototype-brief.ts:250-282`（extractPageListScreens），只服务于简报，未接 verify |
| 单应用 `$page` 结构        | `OPENUI_CREATE_CONTRACT`（openui-contract.ts:17-20）                                            | 堆叠多屏（无 `$page`、root 直排所有 view）**完全通过**官方 parser verdict                                                                                                                          |
| 无死按钮                   | pm-designer SKILL.md:123（"Action([]) is a dead button"）                                       | `action-audit.ts:132-160` 只在**渲染后**警告（advisory），不进持久化前 gate；且不查 `Action([])`，单引号字面量漏检                                                                                 |
| 三端结构化不同             | `OPENUI_DEVICE_CONTRACTS`                                                                       | verify 的 `variant-distinct` 仅做**字节全等**（prototype.ts:691-695）——重命名变量即可绕过                                                                                                          |
| design.lint 三规则         | design.ts:303-342                                                                               | `tiny-font`/`hardcoded-color` 是 **CSS 正则，在 OpenUI DSL 上永不命中**（死规则）；nodePath 抽取期待 HTML 属性，恒为 "document"。唯一能命中的是 emoji-glyph                                        |
| design 线同样可靠          | —                                                                                               | `design.materialize/revise`（design.ts:182-200, 565-594）**不跑修复环**，未验证程序直接持久化；提示词也不含 QUALITY_CONTRACT——两条管线标准不一                                                     |

### 2.3 🟡 P1 — renderer 高置信 bug

1. **specTodos 无节边界**（`PrototypeWorkspace.tsx:212-222`）：从首个含「待确认」的行一路吞到文件尾，不在下一个 `## ` 停；「待确认」字样若早现于正文/表格，验收标准节的 `- [ ]` 全被当待确认 → :837 把生成按钮锁死。附带 `[ ]` 前缀噪点未清理。
2. **仅变体无本体套件整画布判死**：画布门控（:945）、verify（:908）、播放（:920, :464-466）只看 `content.openui`；`render_openui(device:"mobile")` 在 spec-only 版本上可产出只有变体的版本——设备切换器认为 mobile 有变体（无橙点），画布却渲染空态，**变体永远不可见**。
3. **播放模式可触发修订**：`onIterate`（:961）不看 `playing`；播放中点 official Button 默认动作（auto `@ToAssistant(label)`）→ 派发 `prototype.revise` 生成新版本，「播放=冻结编辑」承诺只对工具栏/AI 悬浮窗成立。
4. **slides 失败整页错误化**（:247-249）：marp 渲染失败把错误写进 workspace 级 error，frame 在 error 非空时整体隐藏 children。
5. **表单状态全局单键**（`PrototypePanel.tsx:157-184`）：`designSaveFormState("openui",…)` 不分 suite/设备/版本，desktop 输入注进 mobile 画布；卸载时 clearTimeout 丢弃未落盘输入（注释却声称 flush）。
6. **SpecDocumentView 不感知代码围栏**（`SpecDocumentView.tsx:40-44`）：围栏内 `##` 截断节；与主进程 slides 的围栏不透明分页（spec-slides.test.ts:69 pin 过）不一致。`parseSpecDocument` 当前**零测试**。

### 2.4 🟡 P1 — 交付断链

- `syncSuiteProjections`（design-store.ts:642-663）只投影 `prototype.openui.txt`；`.ddp` 导出（dd-package.ts:102-106）只含本体——**三端生成是一等能力，交付物只有桌面端**。
- 类型四重复制：`OpenuiDevice`（openui-contract）/`PrototypeDevice`（prototype.ts）/design-store 字面量/ipc.ts 字面量——四个必须手工同步的 union。

## 3. 方案 — 四个工作包

### WP1 修复三端链路断链（先行，其余工作包依赖它）

| #   | 改动                                                                                                                   | 文件                            | 测试                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | materialize 设备循环 **head 线程化**：每端持久化后用返回的 `artifactRef.versionId` 更新下一端 base（fix-all 同款模式） | `prototype.ts:526-587`          | desktop 新集成测试：直连真实 `buildA2uiServer`+design-store 跑完整三端 materialize；core 测试改为模拟 head 推进（第二次 render 断言入参 versionId = 第一次返回值） |
| 1.2 | revise 设备基线：`current = device ? content.openuiVariants?.[device] ?? content.openui : content.openui`              | `prototype.ts:807`              | core：device=mobile 时子代理收到的是变体程序（prompt 断言）                                                                                                        |
| 1.3 | renderer diff `after` 取 `next.openuiVariants?.[device] ?? next.openui`                                                | `PrototypeWorkspace.tsx:593`    | renderer 测试：mobile 修订 diff 两端同源                                                                                                                           |
| 1.4 | schema 补 `devices`（materialize）/`device`（revise）声明                                                              | `prototype.ts:479-488, 751-763` | 契约测试 pin schema 字段                                                                                                                                           |

### WP2 「遵循 PRD / 真实可交互」机械 gate

| #   | 改动                                                                                                                                                                                                                                     | 落层依据                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2.1 | 新建 core 纯模块 `openui-pages.ts`：移植 `extractPageListScreens`（prototype-brief.ts:250-282）+ DSL 侧提取（`$page` 声明值 / root 三元引用 / `@Set($page,…)` 目标）                                                                     | 只有 core 同时持有 spec 与 openui                                                           |
| 2.2 | verify 增三项确定性检查：**导航闭包**（@Set 目标 ∉ $page 值 → failed）、**无死页面**（$page 值未被 root 三元引用 → failed）、**页面覆盖度**（程序页面数 vs 清单行数不等 → warning 观察项）。变体每端各跑                                 | Axure 交互连线 + 页面树理念的最小机械化；名称中英不可直比，覆盖度先做数量级，id 化映射列 P2 |
| 2.3 | dead-button 审计**前置**：`auditButtonActions` 并入 `openui-validate.ts` 的 verdict（新增 warning 类别）→ 修复环自动消费（持久化前）；补 `Action([])` 与单引号检测；core verify 加独立确定性检查（不依赖 validator）；渲染器保留事后警告 | audit 本就是零依赖纯函数；fail-open 语义免费继承                                            |
| 2.4 | design.lint 修死规则：删 `tiny-font`/`hardcoded-color`（DSL 永不命中）与 HTML nodePath 抽取，替换为 `Action([])` / 未引用 `$page` 值 / bare-string action；保留 emoji-glyph                                                              | design.ts:303-342；补零基础测试                                                             |
| 2.5 | `design.materialize/revise` 对齐跑 `repairOpenuiProgram`（从 prototype.ts 导出）                                                                                                                                                         | design.ts:182-200, 565-594                                                                  |

### WP3 预览一致性

| #   | 改动                                                                                                              | 文件                              |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 3.1 | specTodos：停在下一个 `## ` 标题；仅从「待确认」**标题**行起算；剥 `[ ]` 前缀                                     | PrototypeWorkspace.tsx:212-222    |
| 3.2 | 仅变体套件可达：画布/verify/播放门控改为 `activeDeviceCode ?? 任意变体存在`；版本轨徽标反映变体                   | :945, :908, :920, :464-466        |
| 3.3 | 播放冻结画布动作：`onIterate` 检查 `playing`（本地 @Set 导航照常，ToAssistant 类不派发）                          | :961 + PrototypePanel.tsx:134-141 |
| 3.4 | slides 失败局部化：局部提示 + 回退 doc 视图，不写 workspace 级 error                                              | :247-249                          |
| 3.5 | 表单状态作用域：按 suite+device 存取（优先复用已有 per-suite IPC 通道 preload/index.ts:184-186），修 unmount 丢弃 | PrototypePanel.tsx:157-194        |
| 3.6 | SpecDocumentView 围栏感知（分节扫描跳过 fence 内 `##`）；补 parseSpecDocument 单测                                | SpecDocumentView.tsx:40-44        |

### WP4 交付完整

| #   | 改动                                                                                                                 | 文件                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 4.1 | 变体投影：`syncSuiteProjections` 写 `prototype.openui.<device>.txt`；`.ddp` 导出含全部变体；`suiteProjection` 读变体 | design-store.ts:642-663 / dd-package.ts:102-106 / design-ipc.ts:188-195 |
| 4.2 | 变体 distinct 升级：字节全等 → 语句名集合 Jaccard 相似度阈值（换名同构被拦）                                         | prototype.ts:691-695                                                    |

## 4. 开放决策 — 原型绘制引擎重规划（user 2026-09-09：另行重新规划）

> 本节为重规划准备的事实底座与选项，**不在本 spec 实施范围**。

### 4.1 当前引擎（OpenUI Lang DSL）的能力边界

| 能力                           | 状态          | 证据                                                                                                                                 |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 声明式组件树 + $state + Action | ✅            | 60+ 官方组件，schema 与渲染器锁步（generate-openui-prompt.mjs + build 漂移检查）                                                     |
| 页面间导航                     | ✅ 带内字符串 | `$page` 三元 + `@Set`——无类型检查、无可视化（WP2.2 补闭包检查）                                                                      |
| 定时器/tick（番茄钟倒计时）    | ❌            | 动作原语仅 @Set/@Reset/@Run/@OpenUrl/@ToAssistant；`$remaining` 类状态无法自减——**DSL 表达力硬边界**，PRD 核心功能不可实现即典型案例 |
| 自由画布/绝对布局              | ❌            | 仅 Stack/Card 流式布局（row/column/wrap），无 x/y/约束                                                                               |
| 组件实例/母版语义              | ❌            | 命名语句引用≈函数调用，无 instance 属性覆盖、无跨页面母版编辑传播                                                                    |
| 响应式断点                     | ❌            | 靠三端独立程序（openuiVariants）替代，成本 = 3× 生成 token                                                                           |
| 数据驱动                       | 部分          | Query 只读 design.\* 本地工具；Mutation 存在但原型场景基本伪                                                                         |

### 4.2 参考工具理念 → 当前架构映射

| 理念              | 墨刀/Axure/Figma/Penpot 共性      | 当前对应                                                 | 缺口落层                                                                       |
| ----------------- | --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 页面树（sitemap） | 层级页面面板                      | PRD 页面清单表 + Mermaid 图 + `$page` 平面枚举           | WP2 覆盖度检查起步；长期：suite content `pages` 注册表（render_spec 单点写入） |
| 交互连线          | 可视化 link + 目标校验            | `@Set($page,…)` 带内、无校验                             | WP2.2 导航闭包（本轮）；可视化后续                                             |
| 组件库/实例       | 拖拽组件 + instance 覆盖 + 库同步 | openuiLibrary 单一库，无实例层                           | 引擎层决策                                                                     |
| 母版/组件传播     | 改母版全站生效                    | 命名语句仅程序内；改壳=重发整程序（PRESERVE 只是提示词） | 引擎层决策                                                                     |
| 多端画板          | 同一页面多断点并排                | 三端独立程序 + 缺失回退提示                              | WP1/3 补可靠性；并排视图后续                                                   |
| 真机预览/播放     | 播放模式全屏交互                  | 交互播放模式（已落地）                                   | WP3.3 补冻结漏洞                                                               |

### 4.3 重规划时的候选方向（非决策）

1. **继续 DSL 路线**：给 lang-core 提原语（timer/tick、断点、instance）——上游依赖 `@openuidev/lang-core`，改造回合长但保留现有生态；
2. **HTML 自包含路线**（easy-prototype 模式）：AI 生成单文件 HTML + 运行时注入 + 机械校验——表达力自由（定时器/自由布局天然支持），失去 schema/修复环生态，需自建 lint/交互校验；
3. **混合**：DSL 做结构化界面 + 嵌入式自定义逻辑块（code component）逃逸舱——复杂度最高；
4. **结构化 IR 路线**（archify 同构）：中间表示 + 确定性渲染器——与架构图管线复用经验，但渲染器要自研。

决策依据事实：修复环/官方 parser/schema 锁步是 DSL 路线最大资产；自由度与真机保真（定时器、动画、绝对布局）是其最大短板。

## 5. 明确不做（本 spec 范围外）

- 不引入外部依赖（Figma/Penpot 等仅借鉴理念）；
- 不动 DSL 定时器原语（属 §4 引擎重规划）；
- 不做契约生成化防漂移、页面清单 id 列规范化（P2，待 WP2 落地后评估）；
- 不做并排多端画板视图、交互连线可视化（P2 UI 层）。

## 6. 验证与交付

- 每工作包配套测试（见 §3 表）；全量 `format:check` + 两包 typecheck + core/desktop 测试全绿后，按工作包分 3-4 个提交。
- 端到端验收：GVGL 工作区跑一次真实三端生成 + 每端修订 + verify 全绿 + `.ddp` 导出含三端。
