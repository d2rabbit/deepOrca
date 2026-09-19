# clay-ui-runtime — UI-Design 的并行渲染/导出运行时（Clay）· 技术设计

> 立项：2026-09-15（user 拍板出 spec；选型证据：[docs/research/2026-09-15-clay-ui-engine-prestudy.md](../../../docs/research/2026-09-15-clay-ui-engine-prestudy.md)）。
> 定位：**UI-Design 的并行渲染/导出运行时**，与 LeaferJS 创作引擎互补并行——Clay 是布局/渲染命令引擎而非编辑器引擎（研究文档核心判定），不做第三生成栈、不做 EARS 17 第三路由。
> 关联：三层定位红线（PM-Design = OpenUI Lang、A2UI 全域交互层不动）沿袭 `specs/archive/leafer-ui-engine/design.md` §2 纪律。
> 状态：**已收官（2026-09-19 复核改判归档）**——WP0–WP4 全落地（`e6ad4ecf5`：spike kill gate **PASS** 放行 / vendor+wrapper / 确定性编译器 / `.ddu` preview.html 集成 / 收编；新增 clay 15 例全绿，guard 测试锁定 PM-Design 与 A2UI 零触碰）+ E2E 实测加固批（`1bc8ed372` 五处致命缺陷 + wrapCJK 全面重写）+ vendor 指纹防漂移维护（`910a938d7`）；唯一未勾任务 4.2 端到端走查已移交预生产清单（符合归档口径）。实施状态与勘误详见 §6。
> 版图（2026-09-19）：原型生成栈 = OpenUI Lang → MoonViz wasm（[moonviz-engine-replacement](../../moonviz-engine-replacement/design.md)，已立项）；UI-Design 创作引擎 = LeaferJS（[leafer-ui-engine](../leafer-ui-engine/design.md)，已收官）；UI-Design 渲染/导出运行时 = Clay（本 spec）。三线互不替代、各归各的子域。

## 1. 背景与动因

`.ddu` 现行交付形态（leafer-ui-engine WP3）：`index.html` 内嵌 leafer web 运行时 + `design.leafer.json`——双击得可交互画布（平移/缩放/选中微调）。它解决了"需要回 DeepOrca 才能看"，但交付物仍是 **canvas 应用**：文字不可选中/复制/搜索、缩放模糊、运行时携带整个编辑器能力。

Clay（nicbarker/clay，Zlib，18.1k★）提供了一个形状精确匹配"轻交付"的能力组合：**15KB wasm 布局引擎 + 渲染命令数组契约 + 官方 HTML 渲染器（retained 模式，命令带稳定 id、逐帧最小 diff）**，且官网自身就是 clay-in-wasm 浏览器运行的活例子。把它放到导出侧，`.ddu` 可以多交付一个**真 DOM 形态**：文本可选中、缩放不糊、单文件离线。

## 2. 关键决策

### 2.1 派生编译，不做第三生成栈（拒绝记录）

备选方案 A：LLM 直出 `content.clay`（第三生成栈，EARS 17 扩展三栈路由）。**拒绝**：需要完整复制 Leafer WP0（生成契约/修复环）+ WP2（lint/revise/review 路由）+ WP5（自检 gate/大纲编译）全套建设，而 Clay 无编辑器，创作能力增量为零；且三栈路由让字段守卫、SKILL.md、防漂移测试全部翻倍。

采用方案 B：**clay 树是 `content.leafer` 的导出期派生物**。源真理仍是 leafer JSON；生成协议、修复环、自检 gate、lint/review/revise、版本快照**全部原样复用零改动**；Clay 只出现在 `.ddu` 导出构建器与 vendor 资产两处（guard 可锁）。EARS 17 双栈路由**不变**。

### 2.2 wasm base64 内嵌，不做 file:// fetch

`.ddu` 双击打开走 file:// 协议，fetch wasm 会被 CORS 拦截。`preview.html` 把 clay.wasm **base64 内嵌**（15KB → ≈20KB 文本）与 glue/树 JSON 一起做成单文件，双击即开、零网络零 CORS。代价是导出物 +20KB——可接受。

### 2.3 编辑留在 leafer 侧

`preview.html` 只读（缩放容器 + DOM 文本选择）；画布微调走 `index.html`（leafer，EARS 12 口径不变）。两文件并存于包内，交付方按需打开，互不替换。

## 3. 导出数据流

```
content.leafer (JSON, 源真理)
        │  export 构建期（desktop main，无 wasm）
        ▼
compileLeaferToClayTree        ← 纯 TS 纯函数：图元映射降级表 + 确定性遍历
        ▼
design.clay.json（派生物，随 .ddu 附带）
        │  浏览器（preview.html，file:// 双击）
        ▼
clay.wasm(base64 内嵌) ── wrapper(TS) ── canvas measureText 桥
        ▼
Clay_RenderCommandArray → HTML DOM（retained：稳定 id、逐帧 diff）
        ▼
真 DOM 交互稿：文本可选中/复制/搜索 · transform 缩放 · 只读
```

lint/review/revise/版本快照：**不经过此链路**（leafer 文档派生导出，源真理侧零改动）。

## 4. 方案 — 四个工作包

### WP0 — Spike（kill gate，先行，不进 DeepOrca 代码库）

| #   | 改动                                                                                                                                                                    | 产出/测试                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0.1 | **CJK 断行三策略对比**：ZWSP 预插入（编译期）/ 逐字符度量手断行（measureText 桥内）/ Clay 原生空白换行——同版式中文卡片流样张并排，人工评审可接受度                    | spike 报告（样张 + 结论）；三策略均不可接受 → **本 spec 作废归档**（requirements EARS 1） |
| 0.2 | **wrapper 最小原型**：clay.wasm base64 内嵌单 HTML，file:// 双击完成"建树 → 布局 → HTML DOM 渲染"一屏；验证零网络/CORS、首帧耗时                                        | 原型 HTML + 结论；EARS 2                                                                   |

> spike 独立于 DeepOrca 代码库（scratch 目录），不 vendor、不进 CI。kill gate 触发即全线归档，无沉没成本泄漏。

### WP1 — vendor 与 wasm wrapper（desktop）

| #   | 改动                                                                                                                                                                                                | 落点                                        | 测试                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1.1 | **`scripts/vendor-clay.js`**（仿 vendor 家族）：git clone（pin 显式 commit，记录于脚本与 NOTICE）+ clang/emscripten 构建 clay.wasm + 版本指纹；产物落 `packages/desktop/vendor/clay/`（extraResources 随包） | `scripts/vendor-clay.js` + `NOTICE.md`      | 脚本可重跑幂等；pin hash 与 NOTICE 一致；EARS 3/14                                    |
| 1.2 | **wrapper**（TS，`desktop/src/main/tools/clay/` 或 renderer 同构位置）：元素树写入（arena/内存布局）+ `measureText` 桥（canvas measureText + 字体档映射 + 缓存）+ flush + 命令数组遍历；零 Node API        | 新模块                                      | Node（WebAssembly 全局）单测：布局矩形/文本命令断言；EARS 4/5                          |

### WP2 — leafer→clay 确定性编译器（desktop，纯 TS）

| #   | 改动                                                                                                                                                                                                                     | 落点                                        | 测试                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2.1 | **映射降级表**（WP0 契约勘探定稿）：Rect/Text/Image/Group/Frame + flow 布局属性 → clay 元素（padding/gap/childAlignment/corner radius/border/aspect）；Ellipse→圆角矩形近似；Path/旋转/渐变类 → 降级或跳过                | `compile-leafer-to-clay.ts`（与 wrapper 同目录） | 映射表逐行单测                                                                                                    |
| 2.2 | **`compileLeaferToClayTree`**：纯函数、固定遍历序、键序不敏感（方法论对齐 `describeLeaferDocument`）；跳过/降级计数返回（横幅与 manifest 用）                                                                              | 同上                                        | 同输入两次编译字节级相同；键序翻转不变；降级计数断言；EARS 6/7/8                                                  |
| 2.3 | **tokens 约束**：design system 色板经编译器注入 clay 样式（leafer 文档内已物化的 fill 色直译；不做二次 token 解析——源真理是 leafer 文档本身）                                                                              | 同上                                        | 色值直译断言                                                                                                      |

### WP3 — `.ddu` 集成（desktop main + build）

| #   | 改动                                                                                                                                                                                                                                                              | 落点                                                    | 测试                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 3.1 | **`buildDduClayPreview`**：`preview.html` 自包含单文件——clay.wasm base64 + wrapper（构建期 minify）+ 编译树 JSON 内嵌 + 顶部降级计数横幅 + wasm 失败错误卡片（引导回 index.html）+ transform 缩放容器                                                              | `dd-package.ts` + `design-ipc.ts` 导出路由               | dd-package 测试：四件套（html/wasm base64/glue/树 JSON）断言；wasm 失败分支 HTML 断言；EARS 9/10/11/12 |
| 3.2 | 导出路由：leafer 栈导出 = `index.html`（现状不变）+ `preview.html`（新增附加）；manifest schema 不变（preview 作为附加资产，可记 `assets.clayPreview` 元数据）                                                                                                     | `dd-package.ts`                                          | 既有 dd 导出测试全绿回归；EARS 12                                                                 |
| 3.3 | **guard 测试三条**：① `prototype.ts` 零 clay 引用；② `design.ts` 主流程（materialize/revise/lint/review）零 clay；③ clay 编译器/wrapper 不 import `render_openui`/`render_leafer`/leafer 运行时（纯 TS 派生物，源真理隔离）                                        | guard 测试族（对齐 design-a2ui-boundary 先例）          | guard 入 CI；EARS 13                                                                              |

### WP4 — 兼容、边界与收尾

- 既有 `.ddu` 回归（index.html/manifest 全绿）；`npm run check && npm test` 全绿；`desktop:build` 冒烟（vendor 资产拷贝）；
- 真机走查：导出 → 双击 `preview.html` → 中文文本选中/复制 → 缩放 → 降级横幅计数与画布对照 → `index.html` 原功能不受影响——**移交预生产清单**；
- 按 WP 分批提交（WP0 spike 报告 / WP1 vendor+wrapper / WP2 编译器 / WP3 集成 / WP4 收编）。

## 5. 风险与缓解

| 风险                                                                 | 缓解                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CJK 断行不达标（空白分词是 Clay 层短板）                             | WP0 kill gate 前置：三策略对比不过即作废，零沉没成本泄漏进代码库                                                                  |
| 上游无 1.0/语义化 release，API churn（README 记录过 padding 语义变更） | pin 显式 commit + NOTICE 记录 + 升级走 EARS 14 golden 对照（确定性编译基线护栏）                                                  |
| 构建链依赖（clang/emscripten）不在常规开发机                          | vendor 脚本产出物（wasm+指纹）**入库**（Zlib 允许；体积 KB 级）；构建仅升级时需要；对齐 vendor 家族"产物可复现、失败可用存量"语义 |
| file:// 下 wasm 加载受限                                             | base64 内嵌决策（§2.2）从根上规避；WP0 原型先行验证                                                                              |
| 映射降级造成导出稿与画布稿视觉差                                     | 降级/跳过计数强制横幅 + manifest 元数据； WP2 映射表逐行单测；"不静默丢失"为 EARS 硬口径                                          |
| 维护者单点（Nic Barker 一人主导）                                    | 与 LeaferJS 同款：隔离层（wrapper/编译器）+ pin + golden 基线；上游失速时派生物仍可独立演进                                       |

## 6. 勘误记录

- **审查区登记误判（2026-09-19 修正）**：转入 review-ing 时登记的待复核项「WP0 kill gate 未跑」不实——提交记录证实 WP0 已跑且 **PASS**（`e6ad4ecf5`：三策略实证，原生空白换行/ZWSP 均溢出，逐字符度量 + 手断行正确折行），未勾任务仅 4.2 端到端走查（移交预生产清单）。教训同 leafer-ui-engine：**状态以提交记录与代码为准，spec 状态头可能滞后**。
- **上游 clay.h 缺陷（WP0 发现）**：`Clay_GetLayoutDimensions` 前导出注记误写（同名导出 ×2 实例化必炸）——vendor 构建内置单行补丁，可向上游反馈。
- **E2E 加固批回写（`1bc8ed372`，2026-09-15）**：① wasm 路径两级 `..` 改一级（bundled 形态此前必 ENOENT 且被静默吞，preview.html 永不生成，catch 补 `[design:export]` warn）；② GLUE init 调序 `bind_begin → walk → bind_end`（`Clay_BeginLayout` 重置 ephemeral arena，旧序整树白建渲染恒空白）；③ **wrapCJK 全面重写**——`Intl.Segmenter` 字素分段（ZWJ/组合符不劈裂）+ CJK 双向禁则（句读悬挂行尾/开口括号下移）+ 空白断点折叠 + 单字素宽度缓存单趟切分（20k 字符度量 91,825→20,000 次，200k 病态输入 195s→117ms）；④ CANVAS 采纳入参尺寸（原硬编码 1280×800，Leafer 预设无一命中）；⑤ 占位符单趟函数式替换 + `<` 转义（杜绝 `$&`/`$$` 展开与 `</script>` 提前终止）；⑥ manifest 先登记再序列化（附 unzip 解包断言）。
- **vendor 维护（`910a938d7`）**：重建 clay.wasm 补齐 `bind_set_floating` 导出 + bindings 指纹防漂移。
- **代码级复审加强批（2026-09-19）**：归档前对 wrapper/编译器/preview 三件套（1665 行）做代码级复审，落四处加强——① **GLUE 度量上下文提升**：`measureTextFunction` 与 `wrapCJK` 原先每次度量各建一个 canvas 2d 上下文，wrapCJK 重写把度量降到 ~20k 次但每次新建 canvas 的 DOM/GC 抖动直接吃掉收益——收敛为单个缓存 ctx（`measureCtx()`），顺带删除 `renderCommands` 死变量 `capacity`；② **wasm memory grow 防护（大声失败）**：`ClayLayoutRuntime.endFrame` 增加 DataView/detach 校验——arena 理应预分配不 grow，一旦发生旧 buffer 被 detach、命令读取将静默产出垃圾（NaN 布局/空文本），现在直接 throw 拒绝带病出命令；③ **`stats.nodes` 改全树计数**：原值只数根层 children，深层嵌套文档的「节点数」被低报一个量级（banner/manifest 语义失真），改为递归全树统计（合成根不计）+ 删除冗余双展开，新增嵌套文档回归测试并 mutation-check（破坏→红/还原→绿）；④ **断行职责头注纠偏**：wrapper 与编译器头注均声称「CJK 预断行在本文件/编译器」，实际实现在 preview GLUE 的 wrapCJK（浏览器侧 canvas 度量）——两处注释改为指向真实落点（状态漂移教训的又一实例，注释/文档与代码对不上时以代码为准并当场修正注释）。验证：clay 四套件 + ddu-leafer-export 27/27 绿，desktop 全量 823/827（4 skipped 条件跳过），desktop tsc 0 错误。leafer 侧（lint/repair/contract 572 行）同批复审**无缺陷**：确定性 lint 四规则、error-only 修复门槛、fail-closed 语义、有界树深均与 spec 承诺逐项吻合。
