# clay-ui-runtime — 需求（EARS）

> Phase 1 of spec-workflow。技术方案见 [design.md](./design.md)；任务分解见 [tasks.md](./tasks.md)。本文件只锁验收口径。
> 立项依据：[docs/research/2026-09-15-clay-ui-engine-prestudy.md](../../../docs/research/2026-09-15-clay-ui-engine-prestudy.md)（Clay：nicbarker/clay，Zlib，单头文件 4.8k LOC 零依赖，wasm 15KB，渲染命令数组契约 + 官方 HTML 渲染器 retained 模式）。
> 定位：**UI-Design 的并行渲染/导出运行时**——Clay 是布局/渲染命令引擎而非编辑器引擎，与 LeaferJS 创作引擎互补并行，不作替代（user 2026-09-15 拍板出 spec）。

## 范围

`.ddu` 交付形态扩展：由 `content.leafer` **确定性编译**出 Clay 元素树，`.ddu` 包附加自包含 `preview.html`（clay.wasm base64 内嵌 + wrapper + 树 JSON，file:// 双击即渲染）——**真 DOM 交互稿**：文本可选中/复制、浏览器缩放不糊、逐帧最小 diff 的 retained 渲染。**不含**：Clay 直出生成栈（`content.clay` 契约/修复环/lint——见 design.md §2 拒绝记录）、无头 PNG/SVG 快照（P2，阻塞于栅格化后端）、任何编辑能力、PM-Design 原型模块与 A2UI 全域交互层的任何改动、EARS 17 字段级双栈路由变更（Clay 不是渲染栈，是导出形态）。

## 用户故事

- 作为交付方，我导出的 `.ddu` 里多一个**轻量真网页** `preview.html`：发给产品/客户后，文字可直接选中复制、浏览器任意缩放不糊、单文件离线可开——不用"回 DeepOrca 或开 canvas 画布"；
- 作为持有旧交付物的用户，`index.html`（leafer 交互画布，可平移/缩放/选中微调）保持原样可用，新形态是**附加**而不是替换；
- 作为质量负责人，leafer 文档到 clay 树的编译是**确定性纯函数**——同一文档两次导出字节级一致，可作为布局回归的对照证据；
- 作为维护者，clay 来源（commit/协议/构建指纹）在 NOTICE 可追溯，构建可复现，上游 API 漂移被 pin 锁住。

## 验收标准（EARS）

### WP0 — Spike（kill gate，先行）

1. When WP0 中文断行 spike 执行, the system shall 对三种策略（ZWSP 预插入断点 / 逐字符度量手断行 / Clay 原生空白换行）产出同版式对比样张并形成书面结论；**三策略均不可接受 → 本 spec 整体作废归档**（kill gate，research 文档 §五既定门槛）。
2. When spike wrapper 原型完成, the system shall 在纯浏览器 file:// 环境跑通最小闭环（clay.wasm base64 内嵌 → 布局 → HTML DOM 渲染一屏卡片流），验证零网络、零 CORS 依赖可双击打开。

### WP1 — vendor 与 wasm wrapper

3. When vendor clay, the system shall 以 git clone **pin 显式 commit**（hash 记录于 vendor 脚本与 `NOTICE.md`，Zlib 归属声明随包），构建产物 `clay.wasm` 与版本指纹落 `packages/desktop/vendor/clay/`（`electron-builder.yml` extraResources 随包）。
4. The wrapper（TS）shall 提供：元素树写入、`measureText` 回调桥、布局 flush、`Clay_RenderCommandArray` 遍历读取；TS 类型完整；**零 Node API 依赖**（浏览器与 Node 同构可载）。
5. When Clay 回调 `measureText`, the system shall 使用 canvas `measureText`（按字体档映射）并对度量结果做缓存（对齐上游 SIMD 缓存语义，避免热路径抖动）。

### WP2 — leafer→clay 确定性编译器

6. `compileLeaferToClayTree` shall 为**纯函数**：同输入字节级同输出、键序不敏感、固定遍历序（方法论对齐 `describeLeaferDocument`，M3E #2）。
7. When 遇到 Clay 无对应物的 leafer 图元/样式（Ellipse、Path、旋转、渐变类效果等——映射表以 WP0 契约勘探为准定稿）, the system shall 按映射降级表近似呈现（如 Ellipse→圆角矩形）或跳过；跳过/降级计数写入导出页顶部横幅与 manifest，**不静默丢失**。
8. The compiler shall 零运行时依赖（纯 TS），desktop main 与浏览器同构执行；编译在**导出构建期**完成（main 进程无需加载 wasm）。

### WP3 — `.ddu` 集成

9. When 导出 `.ddu`（leafer 栈）, the system shall 附加自包含 `preview.html`：clay.wasm **base64 内嵌**（规避 file:// fetch 限制）+ wrapper + 编译树 JSON，零网络依赖双击即渲染。
10. `preview.html` shall 呈现真 DOM 文本（可选中/复制/搜索）与整稿缩放（transform 容器）；交互仅只读，不提供画布编辑。
11. When clay.wasm 实例化失败（损坏/环境不支持）, `preview.html` shall 显示本地化错误卡片并引导回 `index.html`（leafer 交互画布），不白屏、不静默。
12. When 导出包构建, the system shall 保持 `index.html`（leafer 可交互画布，EARS 12 既有口径）与 manifest schema **不变**——clay 产物为附加文件；不新增 suite content 字段、不改 EARS 17 路由、`DesignPipeline`/枚举不扩散。

### WP4 — 兼容与边界

13. When PM-Design 原型链路（`prototype.*`）与 design 主流程（materialize/revise/lint/review/版本快照）运行, the system shall 零 clay 引用（guard 测试锁定：clay 只存在于 `.ddu` 导出构建器与 vendor 资产；对齐 leafer 立项时的三层定位红线纪律）。
14. When clay 上游更新引发重 vendor, the system shall 更新 NOTICE 来源记录并通过编译器全量 golden 对照（确定性基线不被上游漂移静默破坏）。

## 非目标

- **Clay 直出生成栈**：`content.clay` 契约/修复环/lint/版本快照（拒绝理由见 design.md §2——重复 Leafer WP0/WP2 全套建设而创作能力为零）；
- 无头 PNG/SVG 快照（P2：clay 可在 Node WebAssembly 跑布局，但栅格化需另接 canvas 后端，独立评估）；
- 动效（上游 Transition API）、任何编辑/交互增强、双栈路由（EARS 17）变更；
- PM-Design 原型模块、A2UI 全域交互层、design.extract / design.drift 的任何改动。
