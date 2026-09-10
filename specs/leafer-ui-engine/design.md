# leafer-ui-engine — UI-Design 引擎替换为 LeaferJS · 技术设计

> 立项：2026-09-10（user 拍板：OpenUI 做简单原型尚可，精致化 UI 视觉稿不合理；不介意替换整个 UI-Design 底层。候选走廊 HTML-in-Canvas vs LeaferJS，**选型 LeaferJS，npm lib 引入**）。
> 状态：**方案定稿，未实施**。选型证据：[docs/research/2026-09-10-leaferjs-stitch-ui-engine.md](../../docs/research/2026-09-10-leaferjs-stitch-ui-engine.md)。
> 关联：三层定位（`docs/research/2026-08-14-openui-full-adoption-plan.md` §〇）——本 spec 只动 **UI-Design 子域的引擎**，PM-Design（OpenUI Lang）与 A2UI 全域交互层不动；boundary guard 沿用三层定位红线纪律。

## 1. 背景与动因

UI-Design 当前实现（源码事实）：`design.materialize`（`packages/core/src/actions/design.ts`）→ deep-design skill 产出 OpenUI Lang 程序 → `render_openui` 持久化 `content.openui` → `DesignWorkspace` 用 `OpenuiRenderer`（官方 `@openuidev/react-lang` Renderer + DOM 组件库）渲染 → `.ddu` 导出（manifest + `source.openui.txt` + viewer stub）。

OpenUI 的结构性短板（`specs/prototype-reliability/design.md` §4.1）：自由画布/绝对布局 ❌、母版/实例 ❌、组件表达力受库约束——**对"精致化 UI 视觉稿"是硬伤**：视觉稿要的是图元级控制（x/y/宽高/渐变/阴影/圆角/图层）、生成后可人工微调、高保真导出，而不是组件组合的流式布局。

LeaferJS（v2.2.x，MIT，70KB 零依赖）正面覆盖全部缺口：场景树图元模型 + 原生 Flex（`flow`）+ **内置 Figma 风格编辑器**（leafer-editor：选择/变换/编组/层级/历史）+ JSON 导入导出（`toJSON()` / `app.tree.set({children})`，LLM 直出路径）+ PNG/SVG/PDF 导出 + 官方 AI 支持（ai-docs 知识库 / Context7 MCP）。已知短板（文本就地编辑、维护者单点）见调研文档 §1.2/§1.3，均有规避策略（首版不启用文本编辑、npm 精确 pin）。

## 2. 引擎边界（双栈共存，guard 锁定）

| 子域                            | 引擎                | 产物字段                            | 渲染器                    |
| ------------------------------- | ------------------- | ----------------------------------- | ------------------------- |
| PM-Design 原型（`prototype.*`） | OpenUI Lang（不动） | `content.openui` / `openuiVariants` | `OpenuiRenderer`          |
| **UI-Design 新栈（本 spec）**   | **LeaferJS**        | `content.leafer`（JSON 字符串）     | **`LeaferPreview`**（新） |
| UI-Design 旧栈（兼容只读）      | OpenUI Lang         | `content.openui`                    | `OpenuiRenderer`          |

路由规则（EARS 17）：suite content 按**字段存在性**路由——`leafer` 字段 → Leafer 栈；仅 `openui` 字段 → 旧栈只读。同一 suite 版本不混写两种字段。guard 测试：① `prototype.ts` 不 import leafer 相关模块；② `design.ts` 新栈路径不 import `render_openui`（改为 leafer 落盘通道）；③ `DesignPipeline`/suite kind 枚举不扩散。

## 3. 方案 — 四个工作包

### WP0 生成协议与修复环（core）

| #   | 改动                                                                                                                                                                                                                                                                                                                                                | 落点                                                             | 测试                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0.1 | **`LEAFER_CREATE_CONTRACT` / `LEAFER_PRESERVE_CONTRACT`**（`core/src/actions/leafer-contract.ts` 新建）：图元白名单（Rect/Ellipse/Text/Image/Path/Group/Frame + flow 布局属性）、画布规范（root 尺寸 = designSystem 画布档）、tokens 注入规则（design system 的色板/字阶映射为 fill/stroke/font 约束）、JSON-only 输出（单 json fence，禁工具调用） | 新模块，仿 `openui-contract.ts`                                  | 契约测试：prompt 含白名单与 tokens 段；JSON fence 口径 pin                          |
| 0.2 | **`repairLeaferProgram`**：`JSON.parse` → 结构校验（root/children 形状）→ 图元合法性（未知 type/必填缺失/坐标越界画布）→ 失败组装结构化错误回喂子代理重试（有限次，对齐 `repairOpenuiProgram` 的节奏与进度事件）                                                                                                                                    | `core/src/actions/leafer-repair.ts`（或并入 design.ts 同文件族） | 单测：非法 JSON/未知图元/越界三类用例修复成功；耗尽返回结构化错误                   |
| 0.3 | **`design.materialize` 切换产物**：deep-design skill prompt 改为产出 Leafer JSON（注入 CREATE_CONTRACT + design system）；持久化通道从 `render_openui` 改为 `save_suite_result`/等价通道写 `content.leafer`；落盘 `design.leafer.json`                                                                                                              | `design.ts:117-237`                                              | core 集成测试：materialize 产出 `leafer` 字段套件；不再调用 `render_openui`（断言） |
| 0.4 | **`design.revise(part="design")` 切换**：基线取 `content.leafer`，注入 PRESERVE + CREATE 契约，修复环后落盘（WP2.5 同标准）                                                                                                                                                                                                                         | `design.ts:569-605`                                              | 单测：修订走 leafer 基线与修复环                                                    |

> 注：deep-design SKILL.md 需同步产出格式章节（生成契约单一来源；若走 `library.prompt()` 类自动生成不可行，则契约手写 + 防漂移测试 pin，参照 OpenUI 的 SKILL.md 防漂移钩子先例）。

### WP1 渲染与画布编辑（desktop renderer）

| #   | 改动                                                                                                                                                                                                                    | 落点                                     | 测试                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1.1 | **依赖引入**：`leafer-editor`（web）+ `@leafer-in/flow`，**精确版本 pin（无 `^`，v2.2.x 线）**；renderer bundle 验证（esbuild 无 Node 依赖泄漏）                                                                        | `packages/desktop/package.json`          | typecheck + 构建冒烟；`npm ls` 断言版本无 range                                                           |
| 1.2 | **`LeaferPreview.tsx`**（新，`components/design-workspace/`）：`ref + new Leafer({view})` 初始化；`app.tree.set({children})` 导入 JSON；editor/view 插件启用（选择/缩放/适配）；主题色接 `--ui-*` 变量（背景/选中框色） | 新组件                                   | jsdom 冒烟（安装/导入/销毁生命周期）；JSON 非法时错误态局部化（不写 workspace 级 error，沿用 WP3.4 教训） |
| 1.3 | **`DesignWorkspace` 接线**：content 路由（EARS 17）——`leafer` → `LeaferPreview`，仅 `openui` → `OpenuiRenderer`（只读徽标）；迭代 composer 文案改指 Leafer 修订                                                         | `DesignWorkspace.tsx:661-666` 等         | renderer 测试：字段路由两分支；旧产物只读可达（EARS 15）                                                  |
| 1.4 | **画布编辑 → 版本快照**：editor 变更事件（防抖 2s，对齐 formState 节流先例）→ `toJSON()` 序列化 → 走 design-store 版本通道创建快照；版本切换 → 重新导入对应 JSON                                                        | `DesignWorkspace.tsx` + design-store IPC | renderer 测试：编辑产生新版本；切换版本画布随动（EARS 6/7）                                               |

### WP2 质量闭环移植（core）

| #   | 改动                                                                                                                                                                                    | 落点                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------- | ------------------- |
| 2.1 | `lintLeaferDocument(json)`：确定性规则——图元越界画布 / 空文本节点 / 未引用 tokens 色 / 遮挡性重叠（面积比阈值），替换 `lintOpenuiDocument` 在 leafer 栈的位（emoji 规则保留在文本值上） | `design.ts`（或 leafer-lint.ts） |
| 2.2 | `design.lint` / `design.review` / `design.revise(quality                                                                                                                                | tokens                           | components)` 按 content 字段路由到对应栈的 lint 输入/子代理输入 | `design.ts:348-515` |

### WP3 导出（desktop main）

| #   | 改动                                                                                                                                                                                                                                                                                                                             | 落点                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 3.1 | **`buildDduLeaferPackage`**：manifest（format ddu / kind ui-design / pipeline `leafer`）+ `design.leafer.json` + `index.html`（**真实可交互**：leafer web 运行时 + JSON 内嵌 `<script type="application/json">`，双击得可交互画布——平移/缩放/选中微调）；运行时文件构建期从 npm dist 拷贝（非源码 vendor）；`design-ipc` 导出路由按 content 字段选择 builder | `dd-package.ts` + `design-ipc.ts:160-180`             |
| 3.2 | ~~图片导出~~ **移出首版**（user 2026-09-10 裁决：只关注可交互 `.ddu`；预研勘误：v2.2.10 `toSVG` 声明未实装、PDF 走 `image/pdf` 伪 mime 静默回退 PNG——EARS 13 改为 shall-not，P2 重估）                                                                                                                                              | —                                                     |

### WP4 兼容与收尾

- 旧产物兼容（EARS 15/17）回归；guard 测试三条（§2）；`npm run check && npm test` 全绿；真机走查：一句话生成 → 画布微调 → 版本轨 → lint/review → `.ddu` 双击可看 → PNG 导出。

## 4. 风险与缓解

| 风险                                         | 缓解                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| LLM→Leafer JSON 生成质量（新协议无既有基准） | WP0 契约 + 修复环是首要投资；JSON 体积大 → 契约强制紧凑表达 + design system tokens 收窄自由度；修复环有限重试兜底 |
| Leafer 维护者单点                            | npm 精确 pin + package-lock；升级跟随 changelog（v2.2.x 活跃）；MIT 允许任何时点 fork 兜底                        |
| Canvas 文本编辑已知短板（issue #885 类）     | 首版**不启用**就地文本编辑（编辑=变换/删除/属性面板）；富文本渲染用免费 `leafer-x-richText`，编辑器付费插件不引入 |
| 双栈并存复杂度                               | 字段级路由单一规则（EARS 17）+ guard 测试；suite 级禁混写；旧栈只读不再演进                                       |
| 渲染主题不一致                               | LeaferPreview 接 `--ui-*` 变量（背景/选中色），暗色主题显式适配                                                   |
| `.ddu` 运行时体积                            | leafer-editor web 精简 dist 实测 **307KB**（min 未 gzip；70KB 官网口径是 leafer-ui 核心不含编辑器），单文件按需拷贝 |

## 5. 明确不做

- PM-Design 原型模块与 A2UI 交互层任何改动；Stitch 借鉴项（独立评估）；`@leafer-ui/node` 服务端渲染；富文本/文本就地编辑；**图片导出 PNG/SVG/PDF（P2 重估）**；HTML-in-Canvas；CanvasUI；design.extract/drift 改动。
