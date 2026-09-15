# clay-ui-runtime — UI-Design 的并行渲染/导出运行时（Clay）· 技术设计

> 立项：2026-09-15（user 拍板出 spec；选型证据：[docs/research/2026-09-15-clay-ui-engine-prestudy.md](../../docs/research/2026-09-15-clay-ui-engine-prestudy.md)）。
> 定位：**UI-Design 的并行渲染/导出运行时**，与 LeaferJS 创作引擎互补并行——Clay 是布局/渲染命令引擎而非编辑器引擎（研究文档核心判定），不做第三生成栈、不做 EARS 17 第三路由。
> 关联：三层定位红线（PM-Design = OpenUI Lang、A2UI 全域交互层不动）沿袭 `specs/leafer-ui-engine/design.md` §2 纪律。

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

- （空——立项时点无预研勘误；后续按 leafer spec 先例在此累计）
