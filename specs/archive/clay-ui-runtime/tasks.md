# clay-ui-runtime — 任务清单

> 对应 [design.md](./design.md) §3 四个工作包。勾选即完成；每项验收标准以测试为准。依赖顺序：WP0（kill gate，先行）→ WP1 → WP2 → WP3 → WP4。**WP0 未通过前，WP1 及之后一律不开工。**

## WP0 Spike（kill gate，scratch 环境，不进代码库）

- [x] 0.1 CJK 断行三策略对比：ZWSP 预插入（编译期）/ 逐字符度量手断行（measureText 桥内）/ Clay 原生空白换行——同版式中文卡片流样张并排评审
  - 验收：spike 报告（样张 + 书面结论）；三策略均不可接受 → 本 spec 作废归档（kill gate）；EARS 1
  - **结论（2026-09-15）：通过。** A 原生空白换行溢出（分词只认 ' '/'\n'，中文=单词）；B ZWSP 非分词字符同样溢出；C 逐字符度量 + '\n' 手断行**正确折行**。断行器自建成本计入 WP2。报告：scratch `D:\others\clay-spike\SPIKE-REPORT.md`
- [x] 0.2 wrapper 最小原型：clay.wasm base64 内嵌单 HTML，file:// 双击完成建树 → 布局 → HTML DOM 渲染一屏中文卡片流
  - 验收：零网络/零 CORS 可开；首帧耗时有数据；EARS 2
  - **结论（2026-09-15）：通过。** base64 内嵌 wasm（136KB b64）纯浏览器实例化成功；另发现**上游 clay.h 缺陷**：`Clay_GetLayoutDimensions` 前导出注记误写为 `Clay_SetLayoutDimensions`（L4077），wasm 构建下同名导出 ×2 导致实例化失败——WP1 vendor 脚本须带单行补丁（scratch `patch-clay-header.mjs`），并可向上游提 issue。**附注**：官方 `renderers/web/html` demo 的命令结构定义落后于当前 clay.h（现版为 renderData union 44B + zIndex + commandType，stride 72），WP1 wrapper 按现版实现。

## WP1 vendor 与 wasm wrapper（desktop）

- [x] 1.1 `scripts/vendor-clay.js`：git clone pin 显式 commit + clang 构建 `clay.wasm` + 版本指纹；产物入库 `packages/desktop/vendor/clay/`；`NOTICE.md` Zlib 归属与来源记录
  - 验收：脚本幂等重跑一致；pin hash 与 NOTICE 一致；extraResources 随包；EARS 3/14
  - **完成（2026-09-15）**：https 克隆失败自动回退 SSH；header 上游缺陷补丁内置（上游修复后自动 no-op）；构建链探测 host clang → WSL distro（`CLAY_WSL_DISTRO` 可指定）；产物 = clay.wasm + clay-patched.h + version.json + .vendored-head；ThirdPartyNotices.txt 已登记 Zlib 条目
- [x] 1.2 wrapper（TS，同构零 Node API）：元素树写入 + `measureText` 桥（注入式度量）+ flush + `Clay_RenderCommandArray` 遍历
  - 验收：Node WebAssembly 单测布局矩形/文本命令断言；EARS 4/5
  - **完成（2026-09-15）**：`packages/desktop/src/main/tools/clay/clay-wrapper.ts`——bind_* 扁平 setter 协议 + `frame()` 回调式 API + `ClayCommandView` 类型化命令读取；同步实例化规避 Node 退出句柄断言；单测 3 例（实例化+根矩形 / 元素树背景与文本命令 / 两帧确定性）

## WP2 leafer→clay 确定性编译器（desktop，纯 TS）

- [x] 2.1 映射降级表定稿（WP0 契约勘探结论）：Rect/Text/Image/Group/Frame + flow 属性 → clay 元素；Ellipse→圆角矩形近似；Path/旋转/渐变类 → 降级或跳过计数
  - 验收：映射表逐行单测；EARS 7
- [x] 2.2 `compileLeaferToClayTree` 纯函数：固定遍历序、键序不敏感、跳过/降级计数返回；零运行时依赖（main/浏览器同构）
  - 验收：同输入两次编译字节级相同；键序翻转输出不变；降级计数断言；EARS 6/7/8
- [x] 2.3 tokens 色值直译（leafer 文档内已物化的 fill/stroke 不做二次解析）
  - 验收：色值直译断言

## WP3 `.ddu` 集成（desktop main + build）

- [x] 3.1 `buildDduClayPreview`：`preview.html` 自包含单文件（clay.wasm base64 + wrapper minify + 编译树 JSON + 降级计数横幅 + wasm 失败错误卡片 + transform 缩放容器，只读）
  - 验收：dd-package 测试四件套断言；wasm 失败分支 HTML 断言；EARS 9/10/11
- [x] 3.2 导出路由：leafer 栈导出 = `index.html`（现状零改动）+ `preview.html`（附加资产，manifest 记 `assets.clayPreview` 元数据）；不新增 suite content 字段、EARS 17 不变
  - 验收：既有 dd 导出测试全绿回归；EARS 12
- [x] 3.3 guard 测试三条：`prototype.ts` 零 clay；`design.ts` 主流程零 clay；clay 编译器/wrapper 不 import `render_openui`/`render_leafer`/leafer 运行时
  - 验收：guard 入 CI；EARS 13

## WP4 兼容、边界与收尾

- [x] 4.1 既有 `.ddu` 回归（index.html/manifest 全绿）+ `npm run check && npm test` 全绿 + `desktop:build` 冒烟（vendor 资产拷贝 + renderer guard）
- [ ] 4.2 端到端走查：导出 → 双击 `preview.html` → 中文文本选中/复制 → 缩放 → 降级横幅计数与画布对照 → `index.html` 原功能不受影响——**移交预生产清单**
- [x] 4.3 按 WP 分批提交（WP0 spike 报告 / WP1 vendor+wrapper / WP2 编译器 / WP3 集成 / WP4 收编）

## P2 备位（非本 spec 首版，独立评估）

- 无头 PNG/SVG 快照：clay 可在 Node WebAssembly 跑布局，栅格化需另接 canvas 后端（native 依赖）——单独立项评估
- 上游 Transition API / shared elements 动画跟进（上游成熟度观察项）
