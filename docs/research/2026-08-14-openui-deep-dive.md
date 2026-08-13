# OpenUI 深度调研：能力盘点、集成残缺、补全方案与 Designer 选型

> 日期：2026-08-14 · 分支：tmp/openui-research（临时 worktree）
> 调研对象：[thesysdev/openui](https://github.com/thesysdev/openui)（MIT，monorepo 1.0.1，`docs/content/docs` 全部文档 + packages 源码结构）
> 对照审计：DeepOrca 现有 OpenUI Lang / A2UI / DeepDesign(.dd) / PM-Design V2 集成现状
> 结论先行：**OpenUI Lang 是被我们严重低估的管线——目前只用了它 20% 的能力（静态渲染 + 手写 prompt），而它真正的杀手锏（流式解析、editMode 增量、Query/Mutation 运行时自治、toolProvider 本地取数、官方维护的 Renderer）全都闲置。对 Designer 模块，建议「.dd 保留为可交付设计稿 + OpenUI Lang 取代 A2UI 成为交互原型主管线」，A2UI 冻结维护不再扩展。**

---

## 一、OpenUI 能力盘点（我们没用上的 80%）

OpenUI 的定位是 "The Open Standard for Generative UI"——LLM 不生成代码，而是生成**对预注册组件库的组合描述**（紧凑行式 DSL，比 JSON 省 52.8%~67.1% token，官方 benchmark）。四大构件：Library（Zod schema + React renderer 的组件契约）→ Prompt Generator → 流式 Parser → `<Renderer>`。

### 1.1 已被 DeepOrca 使用的能力

| 能力 | 用法 |
| --- | --- |
| `createLibrary` + `defineComponent` | 11 个自研组件（`packages/desktop/src/renderer/openui/library.tsx`） |
| `<Renderer>` | 静态渲染一次性到达的代码（`OpenuiRenderer.tsx`） |
| `useTriggerAction` / `useStateField` | Button 点击 / TextField 输入回流 |

### 1.2 完全闲置的关键能力（按价值排序）

| # | 能力 | 价值 | 官方出处 |
| --- | --- | --- | --- |
| 1 | **`library.prompt()` / `generateSystemPrompt()`** — SDK 从 Zod schema 自动生成组件签名 prompt（含 examples、componentGroups、reactive 标记） | 我们手写组件表在 SKILL.md 里，schema 与 prompt 双源漂移 | `defining-components.mdx`、`system-prompts.mdx` |
| 2 | **`editMode` 增量编辑** — LLM 只输出变化语句，parser 按语句名 merge（同名替换/新名添加/未提保留/移除即 GC），省 ~85% token | `update_openui` 工具描述声称支持、SKILL.md 也教 LLM 只发增量，**但 renderer 端无任何 merge** —— LLM 守约发 delta 会导致原型残缺 | `incremental-editing.mdx` |
| 3 | **`inlineMode`** — LLM 在解释文本中夹带 ` ```openui-lang ` 代码块，parser 自动提取 | **可以绕过工具调用**：直接从 assistant 对话流中实时提取代码块流式渲染原型，不需要等 MCP 工具完成 | `renderer.mdx` |
| 4 | **流式 parser**（`createStreamingParser` + `isStreaming` + root-first 设计） | 目前硬编码 `isStreaming={false}`，生成完才渲染 | `OpenuiRenderer.tsx` L54 |
| 5 | **`Query()/Mutation()` + `toolProvider`** — 生成的 UI 运行时直接调本地工具取数/提交，**不再消耗 LLM token**（"OpenUI separates generation from execution"） | DeepOrca 的本地能力（工作区文件、索引、GitMCP、记忆）可以包成 function map 喂给原型——原型变"活" | `queries-mutations.mdx`、`how-it-works.mdx` |
| 6 | **响应式 `$variables` 双向绑定 + `onStateUpdate`/`initialState`** | 表单状态可持久化、可水合——补持久化的官方路径 | `reactive-state.mdx`、`interactivity.mdx` |
| 7 | **结构化 `onError` 错误码**（unknown-component/missing-required/parse-failed…）可回喂 LLM 自纠错 | 目前只弹错误面板，没接 correction loop | `api-reference/react-lang.mdx` |
| 8 | **`ThemeProvider`**（`--openui-*` CSS 变量、light/dark、嵌套主题） | 与 DeepOrca 多主题系统对齐的官方机制 | `packages/react-ui/ThemeProvider/README.md` |
| 9 | **Artifact 双表面思想**（同一 renderer 驱动对话内 preview + 工作台 actual） | 正是 PM-Design V2 工作台需要的形态 | `core-concepts/artifacts.mdx` |
| 10 | **`@openuidev/browser-bundle`**（单 js + 单 css、无运行时网络请求，专为 iframe 沙箱设计） | 若要把生成 UI 隔离进 iframe（安全/样式隔离），官方有现成产物 | `packages/browser-bundle/README.md` |

### 1.3 需要注意的坑（官方明示）

- **Zod 版本陷阱**：zod@3.25.x 必须 `import { z } from "zod/v4"`，否则报 "Component was defined with a Zod 3 schema"
- **Query/Mutation 必须顶层语句**，不能内联进组件参数
- **改 z.object key 顺序必须重新生成 prompt**（又一个"手写 prompt 必漂移"的论据）
- 全部包仍是 **0.x**（react-lang 0.2.11 / react-ui 0.13.6），有近期破坏性迁移记录，升级要跟 changelog
- `lang-core` 含 postinstall 与 CLI 遥测（`--no-telemetry` / `DO_NOT_TRACK=1` 关闭）
- `openuiChatLibrary` 不含 Stack；多余位置参数被静默丢弃；无效输出被丢弃而非报错

---

## 二、DeepOrca 集成现状审计

### 2.1 三管线数据流对比（现状）

| 环节 | A2UI | OpenUI Lang | DeepDesign (.dd) |
| --- | --- | --- | --- |
| 生成 | `render_surface`/`render_prototype`（7 模板）/ `update_surface` delta | LLM 手写 DSL → `render_openui`/`update_openui` | LLM 手写 .dd → `render_design`/`update_design`（全量） |
| 载体 | 消息数组 JSON（EmbeddedResource + `metadata.a2ui`） | 行式文本（`metadata.openui`） | YAML front-matter + HTML（`metadata.design`） |
| 服务端状态 | **有**（surfaces Map + merge + GC） | 无 | 无 |
| 渲染 | 自研 processor + 自研 A2uiSurface（官方 SDK 已弃） | SDK `<Renderer>` + 自研 library，**非流式** | 自研 parse/compile → iframe srcDoc |
| 持久化 | **有**（`.deeporca/prototypes/`） | **无** | **无** |
| 交互回调 | **双向闭环**（onAction → IPC → `a2ui_action` 工具回 agent） | 单向转述（ActionEvent → 自然语言 prompt） | 无 |
| 更新模式 | delta merge | **声称 delta、实际全量替换** | 全量替换 |

### 2.2 残缺点清单（按严重度分级）

**A 级：数据正确性 bug（文档与实现不一致，会产出残缺原型）**

1. **`update_openui` 增量语义是假的** —— 工具描述（`a2ui-mcp.ts` L662-665）与 SKILL.md 都约定"只发变化语句，renderer merge；置 null 删除"，但 `use-preview.ts` L73 直接 `setPrototypeOpenuiCode()` **全量替换**，无任何 merge。LLM 按约定发 delta → 原型只剩 patch 片段。**这是三管线里唯一的"文档说谎"型 bug。**
2. **工具结果检测是脆弱的字符串匹配** —— `use-preview.ts` 用 `content.includes("render_openui")` 判定管线，工具名出现在普通文本中会误触发。

**B 级：能力闲置（见 §1.2）**

3. 手写 prompt 与 Zod schema 双源漂移（未用 `library.prompt()`）
4. `isStreaming={false}` 硬编码；inlineMode 未用（无法从对话流实时渲染）
5. `toolProvider` 未接（原型无法自主取数）
6. `onError` 未接 correction loop；`onStateUpdate`/`initialState` 未用于状态持久化

**C 级：架构缺失**

7. **OpenUI 与 .dd 产物零持久化** —— 只存 React state，关会话即丢（A2UI 已有 `.deeporca/prototypes/` 先例）
8. **PM-Design V2 零落地** —— spec 设计的 `design.materialize`、pm-analyst、`designs/` 工作台 grep 全仓库无命中，连空壳 rail item 都没有
9. OpenUI 管线**零测试**（A2UI 有 processor GC 测试、.dd 有 parser 测试）
10. 独立窗口只有 A2UI 有（`?view=prototype`），OpenUI/.dd 无第二表面

### 2.3 A2UI 的 18 个 bug 教会我们什么

v3.12/v3.14 两轮审计的教训核心：**全局可变单例 + 无作用域的事件广播**是反复出事的根因（surface 跨污染 C1/C2、内存泄漏 M1）；**交互回流回路**是最脆弱环节（M3/M4/M5）。此外我们弃用了官方 `@a2ui/web_core` 与 `@a2ui/react`，A2UI 的 processor/renderer 全部是**自研维护**——这是持续的维护负担（组件映射 switch、`${path}` 绑定语法、merge/GC 逻辑）。

---

## 三、补全方案（P0 → P2）

### P0 —  correctness 与免费午餐（1~2 天）

| # | 改动 | 落点 |
| --- | --- | --- |
| 1 | **实现 `update_openui` 真增量**：renderer 端维护 statements Map（或直接用 SDK streaming parser 的 editMode 语义），merge 规则对齐官方（同名替换/新增/移除 GC/置 null 删除）；或者干脆把工具语义改为"全量替换"并同步文档——二选一，推荐前者 | `use-preview.ts` + `OpenuiRenderer.tsx` |
| 2 | **用 SDK 生成 prompt 替代手写组件表**：`deeporcaLibrary.prompt({ additionalRules, examples })` 产物注入 pm-designer-openui SKILL.md（构建期生成或运行期拼接），组件签名单一事实源 | `library.tsx` + SKILL.md 生成脚本 |
| 3 | **检测逻辑改为精确匹配**：用 tool_call 的结构化结果（`metadata` 存在性）替代 `content.includes("render_openui")` | `use-preview.ts` |
| 4 | **接 `onError` → correction loop**：解析错误码组织成反馈消息回喂 agent 重试一次 | `OpenuiRenderer.tsx` |

### P1 — 能力解锁（PM-Design V2 前置）

| # | 改动 | 说明 |
| --- | --- | --- |
| 5 | **inlineMode 对话流渲染**：在 assistant 流式消息中检测 ` ```openui-lang ` fence，边到达边喂 `<Renderer isStreaming>`——**真正的流式原型渲染，无需改造 MCP 工具协议**。这是 OpenUI 相对 A2UI 的最平滑升级路径 | renderer 消息渲染层 + PrototypePanel |
| 6 | **`toolProvider` 本地取数**：把只读能力包成 function map（`workspace.listFiles`、`index.search`、`gitmcp.search` 等，经 IPC 转发），原型的 `Query()` 直接取数；Mutation 首批只放安全写（如 `prototype.feedback`） | `OpenuiRenderer.tsx` toolProvider prop + desktop main IPC |
| 7 | **产物持久化对齐 PM-Design V2 spec**：`.deeporca/designs/<uuid>/`（meta.json + requirement.md + prototype.openui.txt / prototype.dd + versions[]）；`onStateUpdate` 定期落 formState，`initialState` 水合 | `design-store.ts`（spec §8 既定设计） |
| 8 | **测试**：update merge 规则、prompt 生成快照、检测逻辑、Query/Mutation mock | desktop tests |

### P2 — 工作台与多表面

| # | 改动 |
| --- | --- |
| 9 | **PM-Design V2 落地**：`design.materialize` 复合 Action（pm-analyst 拆解 → 管线路由 → 调用现有工具 → saveDesignArtifact），左 SidebarView "design" rail + 工作台面板（artifacts 列表 + actual 渲染面）——编排层零改动复用三管线 |
| 10 | **OpenUI 独立窗口**：复用 A2UI 的 `?view=prototype` 通道，把 OpenUI actual 表面挂进去（Artifact 双表面思想） |
| 11 | **ThemeProvider 对齐多主题**：把 DeepOrca `--ui-*` token 映射到 `--openui-*`，light/dark 跟随 app 主题 |

---

## 四、PM-Design 与 Designer 模块的用法设计

### 4.1 PM-Design（需求具现化工作台）

OpenUI 是三条管线里唯一有"运行时自治"能力的，应成为工作台的**默认交互管线**：

```
需求 → pm-analyst 拆解
      → 路由：
        ├─ 纯展示/可打印交付 → .dd（DeepDesign，保留）
        ├─ 交互原型/表单/看板/仪表盘 → OpenUI Lang（默认）
        └─ 已有 A2UI 模板精确命中（login-form/kanban…） → A2UI render_prototype（过渡期内保留的快捷路径）
      → 生成（inlineMode 对话流 + render_openui 双通道）
      → 原型用 Query() 直接读项目数据（toolProvider）
      → 用户反馈 → update_openui 增量 patch（省 85% token）
      → 持久化 .deeporca/designs/ + 版本快照
```

工作台面板借鉴 Artifact 双表面：列表页（所有 designs）+ actual 渲染面（同一份代码，完整交互）+ 对话内 preview（轻量只读）。

### 4.2 Designer（UI 设计稿模块）

关键判断：**设计稿的核心诉求是"可脱离宿主独立交付的自包含文件"**——这正是 .dd 的定位（自包含 HTML，可发给别人直接打开），而 OpenUI 生成的是"组件组合"，依赖宿主 library + React runtime 才能渲染，**不可独立交付**。两者不冲突：

- **.dd 保留**：纯展示设计稿（落地页/海报/品牌页），DeepDesign 管线唯一改动是接 `designs/` 持久化
- **OpenUI 补"交互设计稿"空位**：带表单、筛选、图表、真实数据的 dashboard 类设计——.dd 做不了的（无运行时），OpenUI 正好补上（Query/Mutation）
- Designer 面板可以给两类产物分 tab：展示稿（.dd）/ 交互稿（OpenUI）

---

## 五、OpenUI vs A2UI：Designer 模块选型

### 5.1 硬对比

| 维度 | A2UI（现状） | OpenUI Lang |
| --- | --- | --- |
| 协议效率 | JSON 消息数组，冗长 | DSL，**省 52.8%~67.1% token**（官方 benchmark） |
| 增量更新 | merge delta + GC（自研，已踩 O(n²) 坑） | editMode（官方，省 ~85%） |
| 渲染器 | **自研**（官方 SDK 不兼容弃用），组件映射 switch 持续维护 | **官方 `<Renderer>`** + 自研 library，SDK 持续演进 |
| 运行时自治 | 无——任何数据都要 agent 往返 | **Query/Mutation 直接调 toolProvider，零 token** |
| 容错 | 自研 processor 静默吞错 | parser 丢弃无效 + 结构化错误码可回喂 |
| 状态/持久化 | **有**（surfaces + prototypes/，双向 action 闭环） | 需自补（onStateUpdate + designs/，官方给了全部零件） |
| 多表面 | 对话内/面板/独立窗口（已建成） | 仅面板（独立窗口可复用 A2UI 通道） |
| 流式 | 无（工具完成后一次性） | **有**（inlineMode 对话流） |
| 生态风险 | 协议演进被动跟随 + 自研分叉 | 官方 0.x 快速迭代、近期有破坏性迁移；zod v4 绑定 |
| 历史包袱 | **18 个审计 bug**（单例/跨污染/回流回路） | 1 个文档不一致 bug（update 假增量） |

### 5.2 结论

**对 Designer 模块：OpenUI Lang 更合适，建议渐进取代 A2UI 的交互原型位。** 理由：

1. **维护成本**：A2UI 的渲染层已全部自研（processor + surface + merge/GC + 绑定语法），每一次组件新增都是 switch-case；OpenUI 的渲染层是官方维护的 SDK，我们只剩 library 定义（声明式、带 prompt 自动生成）
2. **生成成本**：DSL 省一半以上 token，editMode 再省 85%——对 DeepSeek 按量计费 + cache-first 策略是直接收益
3. **能力上限**：Query/Mutation 让原型"生成即自治"，这是 A2UI 架构里不存在的维度，也是 PM-Design 工作台最想要的能力
4. **风险可控**：A2UI 的差异化资产（持久化、独立窗口、action 闭环、7 模板）都有明确移植映射：

| A2UI 资产 | OpenUI 对应/迁移方案 |
| --- | --- |
| surface + prototypes/ 持久化 | artifact + `.deeporca/designs/`（PM-Design V2 既定设计） |
| `a2ui_action` 双向闭环 | `onAction` + `Mutation()`（官方运行时通道，更直接） |
| `update_surface` merge delta | editMode parser merge |
| 独立窗口 `?view=prototype` | 复用同一 IPC 通道，挂 OpenUI actual 表面 |
| 7 个原型模板 | 转成 OpenUI DSL 模板（一次性翻译工作量小） |

**建议节奏**：P0 先修 OpenUI 假增量（correctness）→ P1 解锁 inlineMode/toolProvider/持久化 → P2 PM-Design 工作台以 OpenUI 为默认管线；**A2UI 冻结**（保留现有模板与闭环，不再新增组件/不再写新管线代码），待 OpenUI 持久化与独立窗口补齐后评估退役。Designer 的 .dd 交付稿不受此选型影响，独立保留。

---

## 附录 A：OpenUI 关键 API 速查

```ts
// library 定义（zod v4 导入路径！）
import { z } from "zod/v4";
const lib = createLibrary({
  root: "Stack",
  components: [defineComponent({ name, props: z.object({...}), description, component })],
  componentGroups: [{ name, components, notes }],
});

// prompt 生成（替代手写 SKILL.md 组件表）
lib.prompt({ additionalRules, examples, toolExamples, editMode: true, inlineMode: true });

// 渲染（含全部我们没用上的 props）
<Renderer
  response={code} library={lib}
  isStreaming={true}                    // 流式
  toolProvider={{ "workspace.listFiles": async (a) => ... }}  // Query/Mutation 取数
  onAction={(e) => ...}                 // ActionEvent
  onStateUpdate={(s) => persist(s)}     // 状态持久化
  initialState={hydrated}               // 水合
  onError={(errs) => feedBackToLLM(errs)}  // 自纠错回路
/>
```

DSL 速记：`root = Stack([...])`；`$var = default`；`data = Query("tool", {args}, {defaults}, refresh?)`；`result = Mutation("tool", {args})`；action 组合 `Action([@Run(m), @Set($v, x), @ToAssistant("done")])`；内置 `@Count/@Filter/@Sort/@Each`。

## 附录 B：落地清单（文件级）

| 改动 | 文件 |
| --- | --- |
| update_openui 真增量 merge | `packages/desktop/src/renderer/hooks/use-preview.ts`、`packages/desktop/src/renderer/openui/OpenuiRenderer.tsx` |
| prompt 自动生成 | `packages/desktop/src/renderer/openui/library.tsx` + `packages/core/templates/plugins/design/skills/pm-designer-openui/SKILL.md`（改为生成物） |
| inlineMode 流式渲染 | renderer 消息层（A2uiMessage 同级）+ `PrototypePanel.tsx` |
| toolProvider function map | `OpenuiRenderer.tsx` + `packages/desktop/src/main/`（IPC 转发只读能力） |
| designs/ 持久化 | 新增 `packages/desktop/src/main/tools/design-store.ts`（对齐 specs/pm-design-v2 §8） |
| 测试 | `packages/desktop/src/tests/`（merge 规则 / prompt 快照 / 检测逻辑） |
| PM-Design V2 工作台 | `packages/core/src/actions/design.ts`（design.materialize）+ `DesignPanel.tsx` + rail 注册 |
