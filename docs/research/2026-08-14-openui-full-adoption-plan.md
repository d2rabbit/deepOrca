# 全域落地计划：三层定位（A2UI 全域交互层 × PM-Design × UI-Design）→ 模块设计 → Batch 6-10

> 日期：2026-08-14 · 分支：fix/stabilize-data-loss-and-test-suite（designer 批次挂续）
> 前置文档：[2026-08-14-openui-deep-dive.md](2026-08-14-openui-deep-dive.md)（原方案，其 §五选型结论已被本文 §〇 三层定位取代）、复审结论（本文 §〇）
> 约束：延续原方案"不影响 designer 产品线推进"的总约束；每个 Batch 独立可 revert；全程无新 npm 依赖（OpenUI SDK 已在依赖树内）。
> 方法论：模块设计统一采用深模块词汇（Module / Interface / Depth / Seam / Adapter / Leverage / Locality），见各 §一 ModuleDesign 工件。

## 〇点五、Batch 6-10 落地记录（2026-08-14 执行完毕）

全部批次已在工作区落地并全量验证（`npm run check` 绿；core 390 / desktop +30 新测试 / memory 12 / embedding 10；desktop 构建含防漂移钩子 + 负向验证通过）。与计划的偏差与超计划项：

- **Batch 6 全部完成**：SKILL.md 增量语义修正 + 生成表替换（哨兵注释包裹、幂等、裁掉 standalone 前导段）；`library-schema.ts` 抽取（React-free 单一事实源，脚本 tsx/cjs 加载真实 schema）；`detectPrototypeArtifact` 纯函数抽取；决策回写（deep-dive §5.3）。
- **超计划发现并修复——迭代产物血缘**：`render_openui` 每次调用都新建 artifact、`update_openui` 完全不落盘、`update_design` 每次新建——versions[] 永远累积不起来。新增 `saveArtifactWithLineage`（render 建档记 id / update 复用同 id），版本快照自此真正生效。
- **Batch 7**：versions[]（内容 diff 触发、上限 20 FIFO）+ requirement.md（`render_openui` 新增可选 `requirement` 入参透传）+ formState（IPC 2 通道、按 pipeline 解析最新产物、2s 节流落盘 + 水合）。7-3 DesignPanel 版本列表 UI **缓期**（时间盒规则）。
- **Batch 8**：correction loop（`correction.ts` 纯函数 + 800ms 去抖 + 同 code 同错只回喂一次）；inlineMode 以**完整 assistant 消息 fence 提取**落地（`inline-extract.ts`，`settings.openuiInlineMode` 默认关灰度）——真·逐 delta 流式需新增内容增量事件通道，列为后续增强；popout 映射修复（design 模式不再伪 a2ui 兜底，改空态）。
- **Batch 9**：路由升级为 `ctx.judgeViaLlm` 接缝（ActionContext/RegistryHost 新增可选注入，SessionManager 用 flash 模型 json_object 实现并 fail-open），用户显式 pipeline > LLM 判定 > 启发式；`artifactId` 不再 `String(result)` 臆测（返回 null，DesignPanel 列表为准）。
- **Batch 10**：三条边界 guard 测试落地（注：design 清单 `mcp: [a2ui]` 是共享进程宿主而非管线越界，guard 断言瞄准技能列表/工具集/类型，见 `design-a2ui-boundary.test.ts`）；a2ui-annotation skill 定位更新为"全域交互层（主动追问 + 批注）"并写入增量原则与红线。
- **附带基建**：build.mjs 新增 `DEEPORCA_SKIP_VENDORS` 逃生门（离线/快速构建跳过网络校验）与 SKILL.md 防漂移钩子（生成前后内容比对，负向验证：篡改→构建失败→自动复原）。

---

## 〇、复审结论速览（2026-08-14，对照 Batch 1-5 实施后代码）

原方案 11 项落地清单的当前状态：

| #     | 原方案项                | 状态                    | 复审发现                                                                                                                                                                 |
| ----- | ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0-1  | update_openui 真增量    | ⚠️ 半完成               | 工具描述/`use-preview.ts` 已改全量替换口径，**但 SKILL.md 仍有 3 处教 LLM 发增量**（L23-24 / L94 段 / L107·L110），"renderer merges them" 是活谎言——残缺原型路径仍通     |
| P0-2  | prompt 自动生成         | ⚠️ 假完成               | `scripts/generate-openui-prompt.mjs` 已建但**从未 `--write` 执行**（SKILL.md 组件表仍是手写表格）；脚本用 stub 重建 library 而非导入真实定义，引入第三份拷贝；未挂 build |
| P0-3  | 检测精确匹配            | ✅ 基本完成             | 判定已依赖 `metadata.*` 存在性；但三段 if/else 风格不一（design 先 parse、openui/a2ui 先 includes），应收敛                                                              |
| P0-4  | onError correction loop | ❌ 未做                 | `onError={setErrors}` 仅本地错误面板                                                                                                                                     |
| P1-5  | inlineMode 流式         | ❌ 未做                 | `isStreaming={false}` 硬编码                                                                                                                                             |
| P1-6  | toolProvider            | ✅ 完成（比方案更保守） | 7 个 `design.*` 只读工具；Mutation 全未放（正确的收紧）                                                                                                                  |
| P1-7  | designs/ 持久化         | ⚠️ 部分完成             | `design-store.ts` 有 meta+产物落盘；**requirement.md / versions[] 快照 / formState 三项缺**                                                                              |
| P1-8  | 测试                    | ❌ 未做                 | desktop tests 无 openui/design 用例                                                                                                                                      |
| P2-9  | PM-Design V2 工作台     | ✅ 主体完成             | materialize+DesignPanel+rail+IPC 全在；路由降级为关键词启发式；`artifactId: String(result)` 依赖 runSubagent 末条文本短板                                                |
| P2-10 | OpenUI 独立窗口         | 🟡 部分                 | popout 透传 `prototypeMode`；`App.tsx:1362` 的 `design→a2ui` 映射存疑，待核                                                                                              |
| P2-11 | ThemeProvider 对齐      | ✅ 变体完成             | 直接改用 `--ui-*` 变量（Batch 5），未用官方 ThemeProvider——效果等价，接受                                                                                                |

### 三层定位（2026-08-14 钦定，取代原方案 §五的"OpenUI 取代 A2UI"结论）

| 层                             | 职责                                                   | 管线 / 设施                                                                                                          | 红线                                               |
| ------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **A2UI — 全域渲染层**          | agent 交互表面：**主动式追问（新增场景）+ 批注式交互** | `render_surface`/`update_surface`/`close_surface` + `a2ui_action` 回流闭环 + a2ui-annotation skill（meta-skills 组） | **永不进入任何 design 子域主流程**；不生成设计内容 |
| **PM-Design — 交互原型子域**   | 产品交互原型（表单/看板/仪表盘）                       | OpenUI Lang 管线（`render_openui`/`update_openui`、pm-designer-openui skill、specs/pm-design-v2）                    | 产物不入 A2UI 通道                                 |
| **UI-Design — 视觉设计稿子域** | 可独立交付的自包含设计稿（落地页/品牌/海报）           | DeepDesign .dd 管线（`render_design`/`update_design`、deep-design skill、specs/deep-design）                         | 同上                                               |

- 两子域共享 `designs/` 持久化与 DesignPanel 工作台（filter tabs 原型/设计稿即子域视图）；design.materialize 是两子域的共同入口（Batch 9 升级为 PM-Design vs UI-Design 二选一路由）。
- **增量原则（用户决策）**：QuestionCard、权限询问卡片等**存量交互组件不迁移、不改动**；A2UI 只承载**新增**的交互表面。
- 现状已天然满足边界的三处事实：design 组无 a2ui 工具/skill 引用（ecc01fd5）、`DesignPipeline` 类型只含 `"openui" | "design"` 不含 a2ui、a2ui-annotation 挂在 meta-skills 组。
- 其余实施偏离（相对原方案）：editMode merge 放弃、选全量替换语义；pm-analyst 拆解降级为启发式路由（Batch 9 升级）；ThemeProvider 以 `--ui-*` 变量变体完成。

### 术语正名（显示层，不动落盘值）

落盘的 `pipeline: "design"` 实指 **UI-Design** 子域，与"design 域"撞名。处置：

- 落盘值（`.deeporca/designs/*/meta.json`）与 materialize 参数枚举（`auto/openui/design`）**保持不变**——避免存量产物迁移；
- 文档、DesignPanel 标签、i18n 文案统一用"PM-Design（原型）/ UI-Design（设计稿）"表述；
- 标注为长期术语债，未来 major 版本再评估落盘正名。

---

## 一、模块设计（ModuleDesign 工件）

> 设计目标：把 Batch 1-5 落地时形成的"浅模块 + 散落逻辑"收敛为深模块。判断标准：小 Interface、大 Implementation；**两个 Adapter 才算真实 Seam**（一个 Adapter 只是假设）。

### M1. DesignerLibrarySchema —— 组件契约单一事实源

```
ModuleDesign:
  module: packages/desktop/src/renderer/openui/library-schema.ts（新建，React-free）
  interface:
    methods:
      - DESIGNER_COMPONENT_DEFS: ComponentDef[]（name/description/props-zod-schema/componentGroups）
      - buildDesignerLibrary(bind: (def) => ReactComponent): DesignerLibrary
    invariants:
      - schema 变更 ⇒ prompt 必须重新生成（由 Batch 6 挂进 build 强制，违反即构建失败）
      - zod 一律 `import { z } from "zod/v4"`（官方陷阱，见原方案 §1.3）
  depth: deep
  seam_location: library-schema.ts 的导出面（zod 定义所在处）
  adapters:
    - library.tsx（React 组件绑定 → 渲染用 library）
    - scripts/generate-openui-prompt.mjs（stub 绑定 → library.prompt() 生成 SKILL.md 组件表）
    - 契约测试（见 T1）
  leverage: 一次 schema 定义驱动渲染/prompt/测试三处；组件新增只改一个文件
  locality: 消灭"schema ↔ 手写 SKILL.md ↔ 脚本 stub"三源漂移——漂移在定义处不可能发生
```

**删除测试**：删掉该模块，三处各自重新描述组件契约 → 复杂度重现 ×3 → 模块在创造价值。

### M2. detectPrototypeArtifact —— 管线检测纯函数

```
ModuleDesign:
  module: packages/desktop/src/renderer/openui/detect-artifact.ts（新建）
  interface:
    methods:
      - detectPrototypeArtifact(toolContent: string): { mode: "a2ui"|"openui"|"design"; payload: string } | null
    invariants:
      - 判定只依据工具结果的 parsed.metadata（a2ui/openui/design 键），文本 includes 仅作快路径；includes 命中但 metadata 缺失 ⇒ 返回 null（不误触发）
      - 纯函数：无 React、无副作用
  depth: deep（调用方学一个函数，驱动三管线判定 + 未来新管线只加一个 metadata 键）
  seam_location: use-preview.ts 对它的调用点
  adapters: usePreview（现 Hook）、DesignPanel 回放、测试
  leverage: 三段 60 行 if/else 收敛为 1 个可测函数；Hook 只剩 setState
  locality: 新管线/新 metadata 键只改此一处
```

### M3. DesignStore —— 产物持久化（补全 spec §8）

```
ModuleDesign:
  module: packages/desktop/src/main/tools/design-store.ts（已存在，扩 Interface 但保持 4 方法）
  interface:
    methods:
      - saveDesignArtifact(root, { pipeline, content, title?, requirement? }) → { id }
      - listDesignArtifacts(root) → DesignArtifactMeta[]
      - readDesignArtifact(root, id) → { meta, content, requirement?, versions[] }
      - removeDesignArtifact(root, id) → boolean
    invariants:
      - 版本快照由 save 内部自动触发（内容变更 ⇒ versions[] 追加，上限 20 条 FIFO）——版本是 Implementation 细节，不进 Interface
      - formState 独立小入口：saveFormState(root, id, state) / readFormState(root, id)（节流由调用方做）
      - index.json 仅轻量 meta；完整数据在 <id>/meta.json
  depth: deep（调用方 4+2 方法拿到 CRUD+版本+水合全部行为）
  seam_location: design-store.ts 导出面（IPC registrar 是其唯一 Adapter）
  adapters: main IPC（DesignList/DesignRead/DesignDelete + 新增 DesignSaveFormState）
  leverage: materialize action / render 工具落盘 / DesignPanel 三方共用
  locality: 目录结构演进（如加 analysis.json）不影响任何调用方
```

### M4. DesignerToolProvider —— 已成型，补契约测试

Interface 维持 function map 形状（好形状，不动）。补两件：

- `DESIGNER_TOOL_WHITELIST` 常量单点（tool-provider.ts 内），IPC 转发层按白名单校验——白名单即 Interface 的一部分；
- 契约测试（T3）：每个工具 mock `api.*` 断言返回形状与只读性（无 write 调用）。

### M5. CorrectionLoop —— onError 回喂

```
ModuleDesign:
  module: packages/desktop/src/renderer/openui/correction.ts（新建）
  interface:
    methods:
      - buildCorrectionPrompt(errors: RendererError[], code: string): string | null（null = 不值得回喂）
      - shouldRetry(errors, lastFedCode, currentCode): boolean（同 code 同错不二次回喂）
    invariants:
      - 纯函数；回喂走现有 sendPrompt 通道（不新增 IPC/工具）
      - 每个原型版本最多回喂 1 次（防 LLM↔renderer 死循环）
  depth: deep（两个小函数封装"错误码→自然语言反馈"的组织与去重策略）
  adapters: OpenuiRenderer 的 onError → App 层 sendPrompt
  leverage: OpenUI 结构化错误码（unknown-component/missing-required/parse-failed）一次接线，全部错误类型受益
```

### M6. InlineExtractor —— 对话流 fence 提取

```
ModuleDesign:
  module: packages/desktop/src/renderer/openui/inline-extract.ts（新建）
  interface:
    methods:
      - extractOpenuiFence(text: string): { code: string; complete: boolean } | null
    invariants:
      - 纯函数；complete = fence 是否闭合（未闭合 ⇒ isStreaming 喂入，闭合 ⇒ 最终态）
      - 与 render_openui 工具结果去重：同一会话内工具已落地同一 code ⇒ 不重复切面板
  depth: deep
  adapters: 消息渲染层（assistant 流式文本）→ PrototypePanel
  leverage: OpenUI 相对 A2UI 的流式优势最小代价兑现（不动 MCP 协议）
```

### M7. design.materialize 路由 —— 启发式 → flash 判定

- Interface 不变（`{requirement, pipeline} → {ok, pipeline, artifactId}`）。
- Implementation：`routePipeline` 从关键词计分升级为 flash LLM 单选（复用 `identifyMatchingSkillNames` 的 json_object 模式与 LIGHTWEIGHT_TASK_MODEL），启发式保留为 LLM 不可用时的 fail-open fallback（与路由模块同款纪律）。
- `artifactId` 获取：不依赖 runSubagent 末条文本——subagent 完成后在 design-store 内按 `updatedAt` 时间窗（±30s）查最新同 pipeline 产物；查不到返回 `artifactId: null` + `ok: true`（面板以列表兜底）。

---

## 二、批次计划（Batch 6 → 10）

### Batch 6 — P0 收尾 + 接缝固化（0.5~1 天，`fix/openui-p0-closure`）

| #   | 子域       | 任务                                                                                                                                                                                                                                                      | 落点                                                                                                           | 类型                |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| 6-1 | PM-Design  | **SKILL.md 增量语义修正**：L23-24、§"Incremental editing"整段、L107、L110 改为全量替换口径（"resend the complete program; copy previous code and modify"）                                                                                                | `packages/core/templates/plugins/design/skills/pm-designer-openui/SKILL.md`                                    | 文档（活 bug 收口） |
| 6-2 | PM-Design  | **M1 阶段一**：抽取 `library-schema.ts`；`library.tsx` 与 `generate-openui-prompt.mjs` 都改为 import schema（脚本删 stub 拷贝）；执行 `--write` 更新 SKILL.md 组件表；`desktop:build` 前置执行该脚本并 `git diff --exit-code` 校验（CI 环境放宽为仅生成） | `openui/library-schema.ts`、`library.tsx`、`scripts/generate-openui-prompt.mjs`、`build.mjs`                   | 重构                |
| 6-3 | 共享工作台 | **M2**：`detectPrototypeArtifact` 抽取 + `usePreview.applyToolMessage` 改造为"检测函数 + setState"两行式（检测覆盖三管线，含 A2UI 交互表面的面板切换——只识别，不入库）                                                                                    | `openui/detect-artifact.ts`、`hooks/use-preview.ts`                                                            | 重构                |
| 6-4 | 共享工作台 | **T1-T3 最小测试**：T1 prompt 生成快照（防 schema↔SKILL.md 再漂移）、T2 检测函数全分支（含 includes 误触发负例）、T3 design-store CRUD + toolProvider 白名单契约                                                                                          | `packages/desktop/src/tests/`（新增 `openui-detect.test.ts`、`design-store.test.ts`、`openui-prompt.test.ts`） | 测试                |
| 6-5 | 全域       | **决策回写**：原方案 §五结论区改写为三层定位（A2UI 全域交互层 × PM-Design × UI-Design），注明修订依据与日期；删除"冻结/取代 A2UI"表述                                                                                                                     | `docs/research/2026-08-14-openui-deep-dive.md`                                                                 | 文档                |

**验收**：SKILL.md 全文 grep 无 "incremental"/"merge" 残留；`generate-openui-prompt.mjs` 无组件 stub 拷贝；desktop tests +3 文件全绿。

### Batch 7 — 持久化补全（1 天，`feat/design-store-versions`）

| #   | 子域       | 任务                                                                                                                       | 落点                                                                      |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 7-1 | 双子域共享 | M3 扩展：`requirement` 落 `requirement.md`；save 自动版本快照 `versions[]`（内容 diff 触发，上限 20，对 .dd 产物同样生效） | `design-store.ts`                                                         |
| 7-2 | PM-Design  | formState：`OpenuiRenderer` 接 `onStateUpdate`（调用方 2s 节流）+ `initialState` 水合；IPC 两通道 + preload                | `OpenuiRenderer.tsx`、`design-store.ts`、`main/index.ts`、`shared/ipc.ts` |
| 7-3 | 共享工作台 | DesignPanel 版本列表（可选，时间盒 2h，超限砍）                                                                            | `DesignPanel.tsx`                                                         |

**验收**：改原型 3 次 → versions[] 长度 3、可回读首版；.dd 设计稿迭代同样入版本；表单输入 → 重启会话 → 水合还原；spec §8 目录结构逐项对齐（analysis.json 明确缓期并注释）。

### Batch 8 — 纠错回路 + 流式双通道（1~2 天，`feat/openui-streaming-correction`）

| #   | 子域       | 任务                                                                                                             | 落点                                                         |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 8-1 | PM-Design  | M5 correction loop：onError → `buildCorrectionPrompt` → sendPrompt 回喂一次（去重护栏）                          | `openui/correction.ts`、`OpenuiRenderer.tsx`、App 接线       |
| 8-2 | PM-Design  | M6 inlineMode：assistant 流式消息 fence 提取 → `<Renderer isStreaming>`；与工具通道去重                          | `openui/inline-extract.ts`、消息渲染层、`PrototypePanel.tsx` |
| 8-3 | 双子域共享 | 独立窗口核对：确认 `App.tsx:1362` `design→a2ui` 映射是否 bug，修正后两子域产物 + A2UI 交互表面 popout 各验证一例 | `App.tsx`、prototype window                                  |

**验收**：构造 unknown-component 错误原型 → 自动回喂 → 修正成功；流式生成中面板逐语句渲染；纠错不产生回喂死循环（同错第二次直接失败）。

### Batch 9 — 路由与编排深化（1 天，`feat/design-materialize-routing`）

| #   | 子域     | 任务                                                                                        | 落点                                  |
| --- | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| 9-1 | 共享入口 | M7 路由升级：**PM-Design vs UI-Design 二选一**由 flash LLM 判定 + 启发式 fail-open fallback | `packages/core/src/actions/design.ts` |
| 9-2 | 共享入口 | artifactId 结构化：时间窗查 design-store，查不到返回 null 由面板兜底                        | `actions/design.ts`                   |
| 9-3 | 双子域   | 混合需求回归用例（"带落地页的仪表盘"）×2 管线                                               | desktop tests                         |

### Batch 10 — 边界固化 + 子域隔离 + 全域回归（0.5 天，`test/design-a2ui-boundary`）

| #    | 子域 | 任务                                                                                                                                                                                               |
| ---- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10-1 | A2UI | a2ui-annotation skill 定位描述更新为**"全域交互层（主动式追问新增场景 + 批注式交互）"**，写入增量原则（存量交互组件不迁移）与"不生成设计内容、不进 design 子域主流程"红线                          |
| 10-2 | 边界 | **guard 测试三条**（把三层定位锁成不变量）：① 解析 design plugin manifest 断言无 a2ui 工具/skill 引用；② 断言 `DesignPipeline` 类型不含 "a2ui"；③ materialize 两条子域路由代码路径不触及 a2ui 工具 |
| 10-3 | 全域 | 全域回归：`npm run check && npm test`（Node 22）+ 手工冒烟三例（PM-Design 原型迭代 / UI-Design 设计稿 / A2UI 批注表面）+ design.materialize 全链路                                                 |

---

## 三、验收口径（全域）

1. **无活谎言**：SKILL.md / 工具描述 / 实现三者口径一致（全量替换）；grep 校验入测试。
2. **单一事实源**：组件契约只在 `library-schema.ts`；prompt 生成挂 build 且 CI 校验不漂移。
3. **数据闭环**：生成 → 落盘（含版本）→ 重启 → DesignPanel 列出 → 打开预览 → 水合表单 → 迭代 → 新版本。全程无 LLM 参与的环节（读盘/渲染/水合）零 token。
4. **流式**：inlineMode 下原型随 assistant 输出逐语句出现。
5. **纠错自治**：renderer 错误自动回喂修正一次，无死循环。
6. **测试底线**：desktop 新增 ≥5 个测试文件（detect/store/prompt/correction/inline-extract），全部纯函数可直接测（可测性三原则：接受依赖/返回结果/小表面积）。
7. `npm run check && npm test` 绿（Node 22 环境跑；Node 20 的 memory/desktop 环境性失败与本计划无关，见 dsh 计划落地记录）。

## 四、风险与回退

| 风险                                                  | 缓解                                                         | 回退                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| OpenUI SDK 0.x 破坏性升级（zod v4 绑定、包 API 迁移） | 锁版本；M1 接缝使 SDK 升级只影响 `buildDesignerLibrary` 一处 | revert 单 Batch                                         |
| inlineMode 与工具双通道重复渲染/抖动                  | M6 去重不变量（同 code 工具优先）                            | 8-2 独立开关（settings `openuiInlineMode`），默认关灰度 |
| correction loop 回喂死循环 / token 消耗               | 每原型版本最多 1 次 + `shouldRetry` 去重                     | 8-1 开关化，失败不影响主链路                            |
| formState 落盘频率过高                                | 2s 节流 + 仅 `dirty` 状态写                                  | 节流参数进 settings                                     |
| **A2UI 越界进入 design 子域主流程**                   | Batch 10-2 guard 测试三条 + review 检查项（定位红线）        | guard 测试失败即阻断合并                                |
| flash 路由误判（Batch 9）                             | 启发式 fail-open fallback + 用户显式 pipeline 参数优先       | revert 9-1 不影响其余                                   |

## 五、定位红线与明确暂缓（防漂移）

**定位红线（违反即拒绝，guard 测试守护）**：

1. A2UI 进入 design 子域产物管线（PM-Design / UI-Design 的生成、持久化、路由、工作台主流程）的提案一律拒绝。
2. 存量交互组件（QuestionCard、权限询问卡片）不迁移、不改动；A2UI 只承载**新增**交互表面。

**明确暂缓**：

1. **editMode merge 回补**：全量替换语义已一致，token 代价可接受；仅当迭代 token 成本成为投诉点再评估（与 dsh 计划 P2 的 spill/tool-timeout 同一观察清单）。
2. **spec §8 的 `analysis.json`（pm-analyst 结构化分析）**：路由已降级为 flash 判定，分析产物无消费方；待工作台出现"按分析检索"需求再做。
3. **iframe 沙箱（browser-bundle）**：原方案 §1.2 #10 记录在案，无安全投诉不启动。
4. **落盘 pipeline 值正名**（`"design"` → `"ui-design"`）：见 §〇 术语正名，major 版本再评估。

---

## 附：与既有计划的关系

- 本计划是 `2026-08-14-openui-deep-dive.md` 的**执行续篇**；原方案 §三的 P0/P1/P2 编号在 §〇 对账表中逐项映射，不重复立项。
- Batch 6-5 的决策回写把原方案 §五结论替换为三层定位（A2UI 全域交互层 × PM-Design × UI-Design，含增量原则与定位红线）；此后以本文为 design 域与 A2UI 交互层的唯一活跃计划。
- 子域规格对应：PM-Design → `specs/pm-design-v2/`，UI-Design → `specs/deep-design/`；A2UI 交互层无独立 spec，定位红线由本文 §五承载。
- 与 dsh 落地计划（`2026-08-14-dsh-adoption-plan.md`）正交：那边是 core LLM 稳健性，这边是 desktop 设计管线与交互层；共享的唯一纪律是"配置不硬编码 + fail-open + 每 Batch 可 revert"。
