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

| 能力                           | 状态          | 证据                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 声明式组件树 + $state + Action | ✅            | 60+ 官方组件，schema 与渲染器锁步（generate-openui-prompt.mjs + build 漂移检查）                                                                                                                                                                                                                                                                                                                                    |
| 页面间导航                     | ✅ 带内字符串 | `$page` 三元 + `@Set`——无类型检查、无可视化（WP2.2 补闭包检查）                                                                                                                                                                                                                                                                                                                                                     |
| 定时器/tick（番茄钟倒计时）    | ⚠️ 已修正     | **Query 第 4 参 `refreshInterval`（秒）就是定时器**（reactive：变更即重建 interval，官方文档 19-reactive-bindings-and-tool-calls / 11-runtime-evaluator-and-store）——我们的 SKILL.md 早已收录此参数。缺的不是定时器，是「tick → 递减 $state」的通用原语；但 **clock 工具 + refreshInterval=1 组合即可在工具层实现真倒计时**（工具持有起始时间戳，每次刷新返回剩余秒，绑定表达式渲染）——见 §4.4 路线 A-1，零上游依赖 |
| 自由画布/绝对布局              | ❌            | 仅 Stack/Card 流式布局（row/column/wrap），无 x/y/约束                                                                                                                                                                                                                                                                                                                                                              |
| 组件实例/母版语义              | ❌            | 命名语句引用≈函数调用，无 instance 属性覆盖、无跨页面母版编辑传播                                                                                                                                                                                                                                                                                                                                                   |
| 响应式断点                     | ❌            | 靠三端独立程序（openuiVariants）替代，成本 = 3× 生成 token                                                                                                                                                                                                                                                                                                                                                          |
| 数据驱动                       | 部分          | Query 只读 design.\* 本地工具；Mutation 存在但原型场景基本伪                                                                                                                                                                                                                                                                                                                                                        |
| 自包含 HTML 导出               | ✅ 官方模式   | 官方 browser bundle + CDN：iframe `srcdoc` + postMessage 注入 Lang 代码即自包含可播放页（官方文档 17-browser-bundle-and-cdn）——`.ddp` 导出真机可播放 HTML 的现成路径                                                                                                                                                                                                                                                |

### 4.2 参考工具理念 → 当前架构映射

| 理念              | 墨刀/Axure/Figma/Penpot 共性      | 当前对应                                                 | 缺口落层                                                                       |
| ----------------- | --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 页面树（sitemap） | 层级页面面板                      | PRD 页面清单表 + Mermaid 图 + `$page` 平面枚举           | WP2 覆盖度检查起步；长期：suite content `pages` 注册表（render_spec 单点写入） |
| 交互连线          | 可视化 link + 目标校验            | `@Set($page,…)` 带内、无校验                             | WP2.2 导航闭包（本轮）；可视化后续                                             |
| 组件库/实例       | 拖拽组件 + instance 覆盖 + 库同步 | openuiLibrary 单一库，无实例层                           | 引擎层决策                                                                     |
| 母版/组件传播     | 改母版全站生效                    | 命名语句仅程序内；改壳=重发整程序（PRESERVE 只是提示词） | 引擎层决策                                                                     |
| 多端画板          | 同一页面多断点并排                | 三端独立程序 + 缺失回退提示                              | WP1/3 补可靠性；并排视图后续                                                   |
| 真机预览/播放     | 播放模式全屏交互                  | 交互播放模式（已落地）                                   | WP3.3 补冻结漏洞                                                               |

### 4.3 GenUI 生态选型调研结论（2026-09-09，用户给型清单后独立验证）

> 调研对象：A2UI（Google）、OpenUI（Thesys，**即现役引擎** `@openuidev/*`）、json-render（Vercel Labs）；AG-UI / MCP-Apps 作为传输层一并评估。基准数据（结构有效性 96.5%/95.7%/80.2%，空白屏 1/35/4 次）出自 OpenUI 官方 benchmark（1,104 次运行），**存在自证偏差**，但与各项目渲染器成熟度的独立证据方向一致，量级差可信。

| 维度（原型场景加权）     | A2UI v1.0（Google）                                                                                                                                                 | OpenUI（Thesys，现役）                                                                                   | json-render（Vercel Labs）                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **交互模型**（权重最高） | **agent-in-the-loop**：交互组件 `action` → 事件回传 agent，由 agent 决定下一步（官方文档 9-actions-events-and-functions）——与原型播放的**画布内自治状态机**根本错位 | **画布内自治**：`$state` + `@Set/@Reset` 本地执行，播放模式零 agent 依赖（我们已有真实点击换页回归测试） | 宿主中介 `emit` 事件 + directives 局部逻辑——介于两者，自治性弱于 OpenUI |
| 定时器                   | ❌ 无                                                                                                                                                               | ✅ Query `refreshInterval`（reactive 重建）                                                              | ❌ 无                                                                   |
| 结构有效性 / 空白屏      | 95.7% / **35 次**（渲染器 v1.0 刚发布，2026-07 InfoQ）                                                                                                              | **96.5% / 1 次**                                                                                         | 80.2% / 4 次                                                            |
| Token 效率               | JSON 体积大（官方承认）                                                                                                                                             | 最优（行式 DSL）                                                                                         | 中                                                                      |
| 组件目录                 | 18 核心（6 展示+6 布局+6 交互），扩展靠自定义 catalog                                                                                                               | 60+ 官方组件 + `library.prompt()` 生成提示词 + 多框架绑定（React/Vue/Svelte）                            | 36 shadcn/Radix 组件，与 React 生态深绑                                 |
| 自包含导出               | 无现成模式                                                                                                                                                          | ✅ 官方 browser bundle + iframe srcdoc 模式                                                              | 无现成模式                                                              |
| 治理/社区                | Google + 标准化路线（跨平台可移植是核心卖点——**我们双端自持，用不上**）                                                                                             | 商业公司主业（Thesys C1）+ 130k+ npm 下载 + 维修响应快（已知 issue 快修、LangChain 集成已合）            | Vercel **Labs 实验田**（非产品线）                                      |
| 我们已有的护城河         | 无                                                                                                                                                                  | 官方 parser verdict + 修复环 + schema 锁步脚本 + 交互测试 + legacy 库桥（扩展机制已验证）                | 无                                                                      |

**判定：绘制引擎继续 OpenUI，不做底座迁移。** 这不是迁移成本考量（用户明示不计），而是三条硬理由：

1. **换不掉短板**：三家声明式格式都没有自由画布/母版语义；定时器只有 OpenUI 有。换 A2UI/json-render 是用我们的两个真短板换一个更弱的交互模型；
2. **"只要稳定"直接否决 HTML 自包含路线**（montage/easy-prototype 模式）：自由度最高，但 96.5% 结构有效性的来源正是 schema+parser+修复环——HTML 路线全部推倒自建，稳定性最差；
3. **A2UI 的标准化价值（跨平台可移植）与我们的场景正交**：原型画布双端自持（生成端+渲染端都是我们），不需要中间标准。若未来要「原型投递第三方宿主」，届时加一个 **OpenUI→A2UI 序列化导出器**即可（两者都是组件树语义，转换层可行），不必换底座。

AG-UI/MCP-Apps 结论：**传输层，与绘制引擎正交**。我们的"传输"是进程内 suite 存储 + 工作区画布，不经过 chat 流；唯一可借鉴的是 MCP-Apps 的自包含沙盒理念——已被 OpenUI 官方 iframe srcdoc 模式覆盖（§4.1 末行）。

### 4.4 推荐路线：不换底座，四枚引擎层补丁（把「重规划」转化为可执行项）

| #   | 补丁                                                                                                                                                                                                          | 依据                                      | 层                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------- |
| A-1 | **clock 工具**：tool-provider 增加 `design.clock`（入参 startTimestamp/total，出参 remaining/elapsed），配合 `Query(..., {…}, defaults, 1)` 每秒刷新——番茄钟倒计时**今天就能真跑**，零上游依赖                | Query refreshInterval 已存在（§4.1 修正） | renderer/openui/tool-provider.ts |
| A-2 | **自包含可播放导出**：`.ddp` 增加每端 `standalone.html`（官方 browser bundle + iframe srcdoc + postMessage 注入），原型脱离 DeepOrca 可播放                                                                   | 官方文档化模式                            | desktop 导出链 + dd-package      |
| A-3 | **原型组件目录**（原型专用 custom library）：Timer 环、进度环、空态插画卡等原型件挂进我们自己的 library 桥（deeporcaLibrary 先例），提示词经 `library.prompt()` 自动生成——补「组件库/实例」理念缺口的最小落地 | library.prompt() 一等扩展点               | renderer/openui/                 |
| A-4 | **母版纪律机械化**：生成契约要求 shell/nav 为具名语句且被 root 树引用；WP2.2 的导航闭包检查天然覆盖一半；「改壳传播」长期靠 A-3 的组件化                                                                      | §4.2 映射表                               | skill + WP2                      |

A-1/A-2 并入 WP2/WP4 任务清单（见 tasks.md）；A-3/A-4 为 P2 跟进项。

## 5. 明确不做（本 spec 范围外）

- 不引入外部依赖（Figma/Penpot 等仅借鉴理念）；
- 不动 DSL 定时器原语（属 §4 引擎重规划）；
- 不做契约生成化防漂移、页面清单 id 列规范化（P2，待 WP2 落地后评估）；
- 不做并排多端画板视图、交互连线可视化（P2 UI 层）。

## 6. 验证与交付

- 每工作包配套测试（见 §3 表）；全量 `format:check` + 两包 typecheck + core/desktop 测试全绿后，按工作包分 3-4 个提交。
- 端到端验收：GVGL 工作区跑一次真实三端生成 + 每端修订 + verify 全绿 + `.ddp` 导出含三端。
