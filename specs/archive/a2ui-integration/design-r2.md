# A2UI 重构 R2 — 升级官方协议 v0.9.1 + 官方 React 渲染器（设计稿）

> 状态：**已实施（2026-08-24 终判回写）** · 日期：2026-08-24
> 落地：官方 `@a2ui/react@0.10.2` + `@a2ui/web_core@0.10.6`，协议 v0.9.1。渲染层门面（`renderer/a2ui/processor.ts` + `A2uiSurface.tsx` 重写为官方内核，调用方零改动）；生产侧 `a2ui-mcp.ts` 全部工具改产官方 v0.9 消息（双方言宽容：旧 parentId 树自动转换，转换器在 `src/shared/a2ui-legacy.ts`）；arch-scan SKILL.md 重写为官方 18 组件词汇表；构建控制台/知识面板/设计预览检测全部适配。终判细节见文末 §8。
> 取代关系：本文取代 `design.md` 中 2026-08-17 拍板的「弃官方 `@a2ui/react` 改自建 processor」决策；其余定位边界（A2UI 锁定全域动态 UI、不介入 designer 模块、三层定位 guard 测试）继续有效。
> 调研依据（2026-08-24 实查）：
> - 渲染器生态总览：<https://a2ui.org/ecosystem/renderers/>（用户指定参考）
> - 规范版本：<https://a2ui.org/>（v1.0 Candidate / v0.9.1 Current / v0.9 Stable / v0.8 Legacy）
> - 消息协议参考：<https://a2ui.org/reference/messages/>
> - npm 实况：`@a2ui/react@0.10.2`、`@a2ui/web_core@0.10.6`（registry 元数据直查）

---

## 1. 背景：自建渲染器的问题清单（为什么必须换）

现状是 **621 行手写实现**（`renderer/a2ui/processor.ts` 220 行 + `A2uiSurface.tsx` 338 行 + `A2uiMessage.tsx` 63 行 + a2ui.css），零 npm 依赖，协议是自创变体。实测暴露的问题：

| # | 问题 | 实证 |
|---|------|------|
| 1 | **私有协议，与生态零互通** | 消息是 `{type, surfaceId, ...}` 平铺判别式，非规范的 `{version:"v0.9", createSurface:{...}}` 包装；A2UI Composer/Theater 产出的 JSON 无法直接消费 |
| 2 | **组件词汇表漂移** | 自建渲染器支持 15 个组件，SKILL.md 曾描述 panel/graph/direction 等渲染器根本没有的概念（arch-scan 会话中模型花了 15 条消息自行发现文档与渲染器不符再纠偏） |
| 3 | **邻接表语义非标** | 用 `parentId` 反向引用 + 「孤儿恢复」hack；规范是 `children` 正向数组（v0.9），增量更新/GC 语义有明确定义 |
| 4 | **数据绑定是 `${path}` 字符串模板** | 自创语法，代码注释里自己记录了误报（"$12.50" 之类字面量误判）；规范是 `{path:"/x"}` 类型化动态值 + JSON Pointer |
| 5 | **无表单/校验/双向绑定/客户端函数** | v0.9 的 `checks`、Generic Binder、注入 setter、`createFunctionImplementation` 全部缺失 |
| 6 | **私有组件** | kanbancolumn/kanbancard/metriccard 非规范组件，模型只能靠 SKILL.md 特殊记忆 |
| 7 | **无流式渲染保证** | 增量更新行为自行猜测实现（merge by id + GC unreachable），与规范的 progressive rendering 语义不保证一致 |
| 8 | **演进断头路** | 规范已到 v1.0 Candidate（actionResponse RPC 等），自建实现每跟进一个特性都是手工重造 |

## 2. 调研结论

### 2.1 规范版本：目标 **v0.9.1**（当前生产版）

| 版本 | 状态 | 说明 |
|------|------|------|
| v1.0 | **Candidate** | 新增 `actionResponse`（client→server RPC）、action IDs、theme→surfaceProperties 改名。**尚无渲染器切版跟进** |
| **v0.9.1** | **Current（生产）** | v0.9 微调：标准化 `application/a2ui+json` MIME、放宽 surfaceId 约束。**官方 React 渲染器 0.10.x 线即 v0.9 协议实现** |
| v0.9 | Stable | Prompt-First 转折点：createSurface、客户端函数、自定义 catalog、模块化 schema |
| v0.8 | Legacy | 结构化输出优先，旧消息名（surfaceUpdate/beginRendering） |

**决策：锁 v0.9.1。** 依据：官方 `@a2ui/react@0.10.2` 的 `./v0_9` 导出即 v0.9 协议的稳定实现；v1.0 仍是候选且渲染器未跟进，等官方发布 v1.0 渲染器线再评估（对应旧 design.md 风险 R5 的延续策略）。

### 2.2 渲染器选型（按用户指定的生态页逐一评估）

| 渲染器 | 平台 | v0.8 | v0.9 | 判定 | 理由 |
|--------|------|------|------|------|------|
| **`@a2ui/react`（官方）** | React Web | ✅ | ✅ | **✅ 选定** | A2UI 团队维护（Google，Apache-2.0）；0.10.2 为 v0.9 原生实现；peer `react ^19.2.7`（本仓库 React 恰为 19.2.7）；signals 驱动 Generic Binder（细粒度响应式）；自带 basicCatalog 18 组件；支持自定义 catalog/客户端函数；`./v0_9` 版本化导出隔离协议演进 |
| `@a2ui-sdk/react`（easyops） | React Web | ✅ | ❌ | ❌ | 生态页注明「最全功能社区渲染器」但**只支持 v0.8**，与「升级到最新版本」目标直接冲突 |
| `@boteai/a2ui-render` | React Web | ✅ | ✅ | ❌ | 0.0.x beta；peer 限 React ^17（本仓库 React 19）；个人维护 |
| `@yessglory/generative-mui-react` | React+MUI | ❌ | ✅(0.9.1) | ❌ 备选 | 实现最认真（store/校验/流式骨架/安全过滤），但渲染进宿主 `<ThemeProvider>` —— 与本仓库 ui.css 设计体系冲突，等于引入整套 MUI 主题 |
| `@lynx-js/genui/a2ui` | Lynx | ❌ | ✅ | ❌ | Lynx 运行时，非 Web/Electron 直接形态 |
| `a2ui-vue` | Vue | ✅ | ✅ | ❌ | 技术栈不符（desktop 是 React） |
| `@evanyu/a2ui-ink` | Terminal | ❌ | ✅ | ❌ | CLI 场景 |
| `BBC6BAE9/a2ui-swift` | Apple 原生 | ✅ | ✅ | ❌ | 桌面端是 Electron/React，非原生 SwiftUI |
| `AGenUI` | iOS/Android/鸿蒙 | ❌ | ✅ | ❌ | 移动原生 |
| **`@a2ui/lit`（官方）** | Lit WebComponents | — | ✅ | **⚠️ 兜底方案** | 见 §5 风险 R1：若 React 集成咽喉（CSS Modules）验证失败，用官方 Lit 渲染器包一层 React 挂载（自定义元素对 bundler 零要求） |

**npm 实查（2026-08-24）**：
- `@a2ui/react@0.10.2`：peer `react ^19.2.7 / react-dom ^19.2.7 / zod ^3.25.76`；依赖 `@a2ui/web_core ^0.10.5`；解包 1.0MB / 40 文件
- `@a2ui/web_core@0.10.6`：依赖 `zod ^3.25.76`（**直接依赖，npm 会嵌套装 zod3，不与本仓库 zod 4.4.3 冲突**）、`@preact/signals-core`、`date-fns`；导出 `./v0_9`、`./v0_9/basic_catalog`
- basicCatalog 组件（18 个，官方 README）：**Layout** `Row/Column/List/Card/Tabs/Modal/Divider` · **Content** `Text/Image/Icon/Video/AudioPlayer` · **Input** `Button/TextField/CheckBox/ChoicePicker/Slider/DateTimeInput`

### 2.2.1 三方终选对比（2026-08-24 用户要求，Lit 兜底已获批）

| 维度 | `@a2ui/react`（官方） | `@a2ui/lit`（官方） | `a2ui-vue`（社区） |
|------|----------------------|---------------------|-------------------|
| 版本 / 发布 | 0.10.2 | 0.10.3 | 0.9.4（2026-07-04） |
| web_core 对齐 | ^0.10.5（现行 0.10.x 线） | **^0.10.6（最新，与官方线同步）** | **^0.9.1（落后一条版本线，锁死在 0.9.1-era API）** |
| 维护方 | A2UI 团队（Google，Apache-2.0） | A2UI 团队（同左） | 个人（shawnwang15，MIT），生态页列为社区渲染器 |
| 与宿主框架关系 | React 原生组件，与 desktop renderer 同构 | WebComponents 自定义元素 `<a2ui-surface .surface=…>`；React 侧需 ~30 行命令式薄包装（ref 设 property） | **Vue 3 island**：`createApp()` 挂进 React 组件、provide/inject、React↔Vue 双框架状态桥与生命周期管理 |
| 运行时增量 | 仅包本身（共享 web_core） | lit 3.3 全量约 +6KB gzip（最小增量） | **+整个 Vue 3 运行时（~40KB+ gzip）与第二套框架并存** |
| esbuild 兼容 | ⚠️ CSS Modules 咽喉（T0 验证） | ✅ 零要求（Shadow DOM 自带样式，bundler 无关） | ✅ dist 预编译 CSS 全局引入（无 CSS Modules 问题） |
| 样式/主题 | `--a2ui-*` CSS 变量 + CSS Modules | Shadow DOM + **CSS 变量穿透 shadow 边界**，主题桥最干净 | theme 对象 + dist CSS，自定义需覆写其样式表 |
| 双向绑定/校验/客户端函数 | Generic Binder（signals）+ Zod，官方主线 | 同一 web_core 内核，同等能力 | 基于 0.9.1-era web_core 自实现，功能等价但随官方演进一步滞后 |
| 自定义 catalog | 官方模式（createComponentImplementation） | 官方模式（A2uiLitElement + tagName） | 支持（DEFAULT_CATALOG 定制），社区自有模式 |
| v1.0 演进跟随 | 版本化导出，官方同步切 | 同左 | 取决于社区作者个人节奏 |
| 判定 | **首选**：同构、能力最全、DX 最好；唯一风险是 CSS Modules | **兜底（已获批）**：若 T0 咽喉验证失败即切换；也是"最小运行时"路线的正当选择 | **否决**：为拿到渲染器却引入第二套 UI 框架运行时与 island 桥接的永久复杂度；且社区单人维护 + web_core 版本线落后，对「升级到最新」目标是倒退 |

### 2.3 为什么推翻 2026-08-17 的「弃官方」决策

当时无留档理由，推断是 CSS Modules/esbuild 集成风险 + 时间压力（旧 design.md R1 标注为「技术咽喉」）。条件已实质变化：

1. **版本化导出**：0.10.x 提供 `@a2ui/react/v0_9` 干净入口，不再混装 v0.8/v0.9 两代 API
2. **peer 就位**：React peer 收敛到 ^19.2.7，与本仓库安装版本精确一致
3. **内核成熟**：signals 驱动的 Generic Binder + Zod schema 类型推导，功能远超自建 621 行能达到的天花板
4. **代价被实证**：这一个月自建路线的返工（SKILL.md 词汇表纠偏 ×3 轮、绑定语法误报、组件缺失）已超过当年预估的集成成本
5. CSS Modules 咽喉**仍然存在但可解**（§5 给出三档方案），且有官方 Lit 兜底

## 3. 目标架构

```
┌─ core（UI-free，不变）────────────────────────────┐
│ a2ui-seam / MCP 工具名 / arch- 前缀 flush / stamp │  ← 接口面全部保留
└───────────────────────────────────────────────────┘
                    │ application/a2ui+json（v0.9.1 JSONL）
┌─ desktop main ────▼────────────────────────────────┐
│ a2ui-mcp.ts：工具名不变（render_surface/…），      │
│   payload 重写为规范 v0.9.1 消息序列               │
│ persistSurfaces(arch- 前缀 + stamp 限定) 不变      │
└───────────────────────────────────────────────────┘
                    │ IPC（现有通道不变）
┌─ desktop renderer ─▼───────────────────────────────┐
│ A2uiSurface 门面（同名组件，props 兼容过渡期）      │
│   └ 官方 MessageProcessor(@a2ui/web_core/v0_9)     │
│      + A2uiSurface/basicCatalog(@a2ui/react/v0_9)  │
│   └ --a2ui-* CSS 变量桥接 ui.css 设计令牌          │
│ 自定义 catalog（后续）：符号树/架构图专属组件       │
└───────────────────────────────────────────────────┘
```

要点：
- **agent 可见面（MCP 工具名、a2ui_action 回流、arch- 前缀协议、persist/restore 语义）不变**，只换 payload 格式 → 对 LLM 提示词的扰动集中在 SKILL.md 文档层
- **渲染层用官方组件替换自建**，但保留 `renderer/a2ui/A2uiSurface.tsx` 作为同名门面（props `messagesJson/surfaceId/onAction` 不变），调用方（A2uiMessage / PrototypePanel / KnowledgeArchPreview / BuildConsolePanel / detect-artifact）零改动或极小改动
- 主题：官方组件消费 `--a2ui-*` CSS 变量；在门面容器上映射我们的暗色令牌（一次性变量桥，不做组件级样式覆写）

## 4. 协议映射（旧自建 → v0.9.1 规范）

| 维度 | 旧（自建） | 新（v0.9.1 规范） |
|------|-----------|------------------|
| 消息包装 | `{type:"createSurface", surfaceId, title, catalog}` | `{version:"v0.9", createSurface:{surfaceId, catalogId, theme?, sendDataModel?}}`；catalogId 用 basicCatalog 导出的规范 id（形如 `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json`，以 web_core `basic_catalog` 导出为准） |
| 组件树 | `{id, type:"column"(小写), parentId, ...props}` | `{id, component:"Column"(PascalCase), ...props 平铺}`；容器用 `children:[...]` 正向数组（根节点约定 `id:"root"`） |
| 数据绑定 | 属性字符串里 `${path}` / `$path` 模板 | 类型化动态值：字面量直传或 `{path:"/a/b"}`（JSON Pointer）；官方 CommonSchemas 校验 |
| 数据模型 | `updateDataModel` 全量替换 | `{version:"v0.9", updateDataModel:{surfaceId, path:"/", value}}` 支持 JSON Pointer 局部更新 |
| 组件词汇 | 自建 15 个（含 kanban*/metriccard 私有件） | basicCatalog 18 个官方组件；kanbancolumn→`Card`+`List`、kanbancard→`Card`、metriccard→`Row`+`Text`+`Button` 组合（自定义 catalog 留作后续扩展点） |
| 标题 | createSurface 顶层 `title` 字段（私有） | 规范无 title；surface 标题用 surface 内首个 `Text`(usageHint 标题级) 表达，宿主侧展示名走自有元数据（prototypes JSON 侧栏字段保留） |
| 交互回流 | `a2ui_action(surfaceId, actionName, {formState})` | 官方 Action props 解析为可调用函数并携带深上下文；门面把调用桥到现有 `a2ui_action` MCP 工具（**回流通道名不变**） |
| 传输 | MCP EmbeddedResource `application/a2ui+json` | 同 MIME（v0.9.1 恰好标准化了这个 MIME），内容为 JSONL 规范消息 |

## 5. 构建集成与风险

| # | 风险 | 档位 | 对策 |
|---|------|------|------|
| R1 | **CSS Modules（.module.css）在 esbuild 渲染器构建中不受支持** —— 官方 basicCatalog 部分 组件（如 Text）以 CSS Modules 发布样式；旧设计已标记此为咽喉 | 高（技术咽喉，T0 必须先解） | 三档递进：① 实测 dist 是否附编译后 CSS 可全局引入 + 结构类名退化可接受；② esbuild 加 css-modules 插件（如 postcss-modules 预生成映射）；③ **兜底换官方 `@a2ui/lit`（2026-08-24 用户已批准）**：WebComponents 对 bundler 零要求，React 侧 ~30 行命令式薄包装挂载 `<a2ui-surface>`，lit 运行时仅 ~6KB gzip，且 web_core 对齐最新 0.10.6 |
| R2 | zod 版本：包内 peer/依赖 zod ^3.25.76，仓库根 zod 4.4.3 | 低 | web_core/react 均把 zod3 声明为直接依赖，npm 嵌套安装自洽；安装后 `npm ls zod` 验证无 dedupe 冲突 |
| R3 | renderer bundle 膨胀（react 解包 1.0MB + web_core 3.4MB，含两代协议与 schema 数据） | 中 | 仅 import `./v0_9` 子路径；esbuild bundle 后量体积对比（旧基线 renderer ~2.5MB 主 chunk）；`./v0_9/basic_catalog` 数据按需 |
| R4 | 旧产物不兼容（.deeporca/prototypes/*.json 旧格式） | 中 | 读取时转换器：旧 `{surfaceId,title,messages,components}` → 规范消息（parentId 邻接表 → children 数组、`${}` 绑定 → path 对象）；arch- flush 测试同步更新 |
| R5 | 官方组件视觉与 ui.css 体系不协调 | 中 | `--a2ui-*` CSS 变量桥接层集中映射；不改官方组件内部结构 |
| R6 | v1.0（Candidate）漂移 | 低 | 锁 0.10.x；版本化导出保证未来 `./v1_0` 可平行迁移 |
| R7 | BuildConsolePanel / a2ui-templates 均为消息生产方，需同步换格式 | 中 | 与 T2/T4 同批改造，golden fixture 测试锁行为 |

## 6. 实施分期（建议）

| 期 | 内容 | 验收 |
|----|------|------|
| **T0 咽喉验证（半天）** | 安装 `@a2ui/react@0.10.2 @a2ui/web_core@0.10.6`；esbuild 跑通 CSS Modules（三档依次尝试，记录命中档位）；bundle 体积测量；`npm ls zod` | 渲染器构建绿 + hello-surface 在 renderer 里真实渲染 |
| **T1 渲染层替换** | `renderer/a2ui/` 重写为门面 + 官方内核；`--a2ui-*` 变量桥；旧 a2ui-processor 测试改写为门面 golden fixture | A2uiMessage/PrototypePanel/KnowledgeArchPreview/BuildConsolePanel 四个调用点不改 props 全部正常渲染 |
| **T2 生产侧重写** | a2ui-mcp.ts 工具 payload 换规范 v0.9.1 JSONL；a2ui-templates 生成器重写；detect-artifact 的 parseSurfaceId 适配新包装 | MCP 工具回包通过官方 MessageProcessor 直渲染；openui-detect 测试更新 |
| **T3 文档与迁移** | arch-scan SKILL.md 重写为 basicCatalog 18 组件词汇表 + 规范消息示例；prototypes 旧格式读取转换器 | 泄漏会话类「文档≠渲染器」问题根除；旧 arch-*.json 能读 |
| **T4 回归与收尾** | 全量 check/test；desktop:build；实跑一次索引构建（arch 图经官方渲染器出图）；design-r2 文档回写终判 | 构建全绿 + 架构图端到端可视 |

## 7. 待拍板

1. **接受 `@a2ui/react + @a2ui/web_core` 进入 renderer 运行时依赖**（zod3 嵌套 + signals-core + markdown-it 传递依赖）
2. ~~T0 咽喉若落在兜底档（换 @a2ui/lit）是否接受~~ **已批准（2026-08-24）**：T0 若 React 线三档方案均不可行，直接切官方 `@a2ui/lit`，无需再次拍板
3. 自定义 catalog（符号树、架构图专用组件）是否列入本期范围（默认：不列入，留扩展点）


---

## 8. 实施终判（2026-08-24）

### 8.1 T0 咽喉的最终事实（修正 §5 R1 的第①档表述）

发布版 dist 确实是"编译期可读类名 + 单一 css"（无 .module.css 导入），**但包的 exports map 不暴露任何 css 子路径**——`@a2ui/react/v0_9/index.css` 静态导入在 esbuild 与 Node 下都无法解析。实际落地方案（第②档变体）：

- **结构样式**：build.mjs 从依赖安装位置拷贝 `v0_9/index.css` → `dist/renderer/a2ui-basic.css`（候选路径含根/工作区两级 hoist 位置），main.tsx 按既有惯例 `injectStylesheet("./a2ui-basic.css")` 注入；
- **主题变量层**：官方 `injectBasicCatalogStyles()`（运行时 adoptedStyleSheet，Node 自动 no-op，jsdom 无 CSSStyleSheet 时 try/catch 容错）；
- 深色主题桥：ui.css 的 `.ui-a2ui-theme` 把 `--a2ui-*` 映射到 `--ui-*` 语义令牌，随明暗切换自动跟随。

### 8.2 各期落地

| 期 | 结果 |
|----|------|
| T0 | @a2ui/react@0.10.2 + web_core@0.10.6 安装；zod@3.25.76 嵌套自洽（根 zod 4.4.3 不受影响）；CSS 方案如上 |
| T1 | `processor.ts` 重写为官方 MessageProcessor 单例（version:'v0.9.1'，全局 ActionListener 桥到 a2ui_action IPC）；`A2uiSurface.tsx` 同名门面（props 不变：messagesJson/surfaceId/onAction）；golden fixture 测试 6/6 |
| T2 | a2ui-mcp 工具全部 v0.9 原生产出：render_surface（input schema 即官方邻接表，LLM 可见的教学描述）、update_surface（全量快照语义，官方可达性 GC）、render_prototype（模板内部形态经共享转换器归一）、a2ui_action（官方 A2uiClientAction 形状）；navigate_to 移除；BuildConsolePanel v0.9 原生产出；detect-artifact/KnowledgePanel/restoreSurfaces 双方言兼容 |
| T3 | arch-scan SKILL.md Step3+ 整段重写官方词汇表（badge/flowstep/metriccard 等幻觉组件从文档消失，Node kinds 改字形前缀方案）；旧 prototypes 文件经渲染门面自动转换读取 |
| T4 | check 全绿；测试 core 661、desktop 198（含双方言 MCP 全链路 arch-flush）、memory 14、embedding 57；desktop:build 过；renderer bundle 仅 +4KB；应用重建重启日志干净 |

### 8.3 遗留

- v0.9 官方 Tabs 是"单 tab 项"（title+child），多 tab 由兄弟 Tabs 并排成栏——arch-scan 文档已按此教法；真实观感待用户复验
- 自定义 catalog（符号树/架构图专属组件）未做，留扩展点（官方 createComponentImplementation 通道已可用）
- a2ui-templates 内部仍产旧形态（经转换器归一，行为等价）；后续可直接改写为 v0.9 原生并删转换依赖
