# Clay 预研：UI 设计模块的并行布局/渲染引擎可行性

> 日期：2026-09-15 · 状态：调研完成（纯留档，无代码变更；总口径：调研仅供参考，正式实现一律以 `specs/` 为准）
> 来源：[nicbarker/clay](https://github.com/nicbarker/clay)（Nic Barker，"C Layout"；Zlib 协议）
> 取证方式：官方 README（2026-09-15 时点）+ 官网 [nicbarker.com/clay](https://www.nicbarker.com/clay) + HN/社区讨论与 Simon Willison 评测交叉核对。本文为文档级调研，未做源码一手取证、未跑编译 spike。
> 目的：回答「Clay 能否作为 UI 设计模块的引擎，与现行 LeaferJS 引擎并行」。立项基线：`specs/leafer-ui-engine/design.md`（LeaferJS 选型已定稿，WP0-WP5 已落地）。
> **用户定调：调研落地文档即可，与现有 UI 设计引擎并行评估。**

---

## 〇、TL;DR / 核心判定

**Clay 是布局/渲染命令引擎，不是编辑器引擎——它与 LeaferJS 是互补层，不是同类竞品。** "并行"成立，但并行的位置在**渲染运行时/导出/无头快照**，不在创作画布。

一句话对位：UI-Design 引擎职责链 = 生成协议 → **创作画布（选择/变换/编组/历史）** → 渲染预览 → lint → `.ddu` 导出。LeaferJS（leafer-editor）独占第二环且不可替代（Clay 没有编辑器、没有拖拽/变换/选区/文本编辑）；Clay 能补的是第三、五环的另一种实现——**确定性布局 + 15KB wasm 运行时 + HTML DOM 输出**，恰好是「可交互 `.ddu` 导出」「无头快照渲染」想要的形状。

**核心判定：不能替代 LeaferJS 做创作引擎；能作为并行的渲染/导出运行时候选。** 三前提（见 §五）：自写 wasm→TS wrapper（无官方 JS 绑定）、CJK 断行策略 spike（空白换行短板）、双栈变三栈的路由/守卫成本（EARS 17 扩展）。均为可控工程量，无许可证/再分发红线（Zlib）。

---

## 一、Clay 是什么（取证事实）

| 维度 | 事实 | 备注 |
| --- | --- | --- |
| 定位 | "High performance UI layout library in C"——**只做布局计算**，渲染完全外包 | 官网一句话：flex-box style layout library |
| 形态 | 单头文件 `clay.h`，**4.8k LOC，零依赖**（不链 stdlib，无 malloc，arena 内存，8192 元素 ≈3.5MB） | vendor 成本极低 |
| 协议 | **Zlib**（宽松，可再分发可商用） | 注意不是 MIT，含义等价宽松 |
| 成熟度 | 18.1k★ / 717 fork / 434 commits；2024-12 发布（HN/Simon Willison 评测），**无语义化版本 release/1.0 声明**，README 明文记录过 padding 等语义 breaking change 与"抱歉提前说"条款 | API 仍在动（2026 新增 Transition API、shared elements 动画）；vendor 必须 pin commit |
| WASM | clang 编译 → **15KB 未压缩 .wasm**；Clay 官网本身就是 clay-in-wasm 跑在浏览器里的活例子 | 浏览器路径被官方亲测 |
| 渲染契约 | 布局产出排序的 **`Clay_RenderCommandArray`**（RECTANGLE / BORDER / TEXT / IMAGE / SCISSOR_START·END / OVERLAY_COLOR / CUSTOM），渲染器随便换 | 官方渲染器：raylib 渲染器 + **HTML 渲染器**（把布局编译成持久 HTML DOM，逐帧最小 diff——命令带稳定 uint32 id，支持 retained 模式与脏检测） |
| 交互 | 仅 hover/click 检测（`Clay_PointerOver`/`OnHover`）+ 滚动容器；**无拖拽/变换/选区/文本编辑** | 这是它不能当创作引擎的根本原因 |
| 文本 | 用户注入 `measureText` 函数（热路径，SIMD 缓存）；**空白分词换行**——CJK 连续文本被当单 token，中文断行弱；无 harfbuzz 级 shaping（度量是调用方的责任，浏览器侧可用 canvas measureText 桥接） | 中文 UI 视觉稿的实打实短板 |
| 绑定 | 官方 Odin、Rust；社区 Go 1:1 重写；**无官方 JS/TS 绑定**——浏览器路径=自己包 wasm | 集成成本的主要构成 |
| 线程 | 多实例支持；**非线程安全** | 无头批渲染单线程即可 |

---

## 二、对位分析：Clay × LeaferJS（现 UI-Design 栈）

`specs/leafer-ui-engine/design.md` 的引擎边界：UI-Design 新栈 = LeaferJS（`content.leafer` JSON → `LeaferPreview`），PM-Design = OpenUI Lang（不动），字段存在性路由（EARS 17）+ boundary guard。逐环对位：

| 职责环 | LeaferJS 现状 | Clay 能力 | 判定 |
| --- | --- | --- | --- |
| 生成协议（LLM→JSON） | `LEAFER_CREATE_CONTRACT` 白名单 + 修复环 + 确定性 lint | Clay 元素模型更简单（container/text/image/border），JSON→元素树可直译 | 平手偏 Clay，但重构合同无增量收益 |
| **创作画布** | leafer-editor：选择/变换/编组/层级/历史（Figma 式，官方内置） | **无**。零编辑能力 | **Clay 不可替代此环** |
| 渲染预览 | Leafer web 渲染（canvas 场景树） | 布局计算 + 渲染命令 → canvas/DOM 皆可 | Clay 可行，但无编辑需求时收益=确定性+体积 |
| lint/review | `lintLeaferDocument`（越界/空文本/未引用 tokens/遮挡） | 布局纯函数，理论可离线 lint | 等价 |
| **`.ddu` 交互导出** | leafer web 运行时内嵌（双击可交互画布） | **clay wasm 15KB + HTML 渲染器 → 真 DOM**（文本可选中、SEO 级静态、逐帧 diff 的 retained 模式） | **Clay 差异化价值点** |
| 无头快照渲染 | 需起完整 leafer 环境 | C 级无头布局 + 命令数组 → 任意后端（PNG 栅格化需另接 skia/canvas） | Clay 差异化价值点 |
| 文本 | 完整场景文本（就地编辑首版未启用） | 空白换行短板，CJK 需自定义度量+断行策略 | Leafer 胜 |
| 图元表达 | 场景树图元：Rect/Ellipse/Text/Image/Path/Group/Frame + 渐变/阴影类样式 | 图元/样式子集较窄（矩形/圆角/边框/图片/裁剪/滚动/浮动），**无自由变换/旋转**一类创作语义 | Leafer 胜（视觉稿要的图元级控制） |

结论：**并行=第三栈（渲染/导出运行时），不是第二创作引擎。** 若把 Clay 当"引擎"替换 leafer 的位置，第一天就会撞上"没有编辑器"的墙——那正是 leafer 选型的核心论据（对 OpenUI 短板的修正）。

---

## 三、能力边界（不能补什么）

1. **无编辑器**：没有选择/拖拽/变换/编组/历史——UI 视觉稿"生成后人工微调"的刚需环缺失。
2. **无官方 JS/TS 绑定**：wasm wrapper 要自写（声明桥 + `measureText` 回调桥 + 内存/命令数组遍历），估数百行 TS + emscripten 构建脚本。
3. **CJK 断行弱**：空白分词换行；中文长句不断行。缓解=浏览器侧逐字符度量+手工插入断行点（spike 验证），或 Clay 层接受不完美换行（视觉稿场景不可接受）。
4. **API 未定版**：无 1.0/语义化 release，README 记录过 breaking change；vendor 必须 pin commit + 锁定验收。
5. **文本 shaping 缺位**：混排/复杂 script 度量全靠调用方 measureText；对中文视觉稿是持续税。
6. **维护者单点**：主要作者一人（与 LeaferJS 同款风险；缓解同为 pin + 隔离层）。

---

## 四、集成路径与成本（若立项）

Electron renderer（浏览器环境）路径最短：

1. **vendor**：`scripts/vendor-clay.js` 仿既有家族——git clone（pin commit）+ emscripten/clang 编译 `clay.wasm`（≈15KB）+ 生成 JS glue；产物进 `packages/desktop/vendor/clay/`，`electron-builder.yml` extraResources 自动随包。Zlib 无再分发红线（对比：Aseprite EULA 禁二进制再分发——Clay 无此问题）。
2. **wrapper（自写，主要成本）**：TS 侧元素树构建 → 内存写入 → `Clay_Relayout`/`Clay_FlushLayout` → 遍历 `Clay_RenderCommandArray` → 接 Leafer 之外的渲染后端（a. HTML 渲染器移植 → 真 DOM；b. canvas2D 直接绘制）。`measureText` 桥到 canvas measureText。
3. **CJK spike（先决）**：中文断行 demo——逐字符度量 + 自绘断行点 vs 接受单 token，验证视觉稿可接受度；不达标则此线搁置。
4. **栈路由**：`content.clay` 第三字段 + EARS 17 扩展 + boundary guard 三条（同 leafer 落地时的纪律）；`.ddu` 导出加 clay 分支。

成本估计：wrapper + spike ≈ 一个小型 WP（1-2 天人日级）；三栈路由与 guard ≈ 中型 WP。**不建议**为"预览确定性"单独立项——那是渲染细节，不是引擎级差异，除非 `.ddu` HTML 化/无头快照被拍板为目标。

---

## 五、规划落点（未启动）

| # | 落点 | 说明 |
| --- | --- | --- |
| 1 | **本线定位：渲染/导出运行时候选**，与 LeaferJS 创作引擎互补并行 | 不动 PM-Design（OpenUI Lang）与 A2UI——三层定位红线沿用 |
| 2 | 先决 spike：CJK 断行 + wasm wrapper 原型（一个 HTML 页：clay.wasm 渲染中文卡片流） | spike 不达标（中文断行不可接受且无 workaround）→ 本线作废 |
| 3 | spike 通过 → `specs/clay-ui-runtime/` 立项：`.ddu` clay 导出分支 + 三栈路由 + guard | 与 leafer spec 同款 WP 结构；`.ddu` 交互导出是唯一拍板级目标候选 |
| 4 | vendor：`scripts/vendor-clay.js`（pin commit + clang→wasm） | 等第 3 步立项后再做，避免空 vendor |

**对位红线**：Clay 线全程不触碰 `prototype.ts`（PM-Design）；`design.ts` 若引入 clay 分支，guard 测试同 leafer 先例（不混写路由字段）。

---

## 六、消费判定

⬜ **纯调研留档，无代码变更。** 核心产出是一句定位话术：**Clay = UI-Design 的"导出/渲染运行时"候选，与 LeaferJS"创作引擎"互补并行；不是替代品。** 触发条件：`.ddu` 交互导出升级为 HTML-DOM 形态、或需要无头确定性快照渲染时，重开本线并从 §五 spike 起步。

参考：Clay 官网（自身即 wasm 活例子）[nicbarker.com/clay](https://www.nicbarker.com/clay) · HN 讨论（wasm 布局 + HTML/Canvas 渲染实测）[news.ycombinator.com/item?id=42463123](https://news.ycombinator.com/item?id=42463123) · Simon Willison 评测（[simonwillison.net/2024/Dec/21/clay-ui-library/](https://simonwillison.net/2024/Dec/21/clay-ui-library/)） · 社区 Go 1:1 移植（佐证 API 可移植性）
