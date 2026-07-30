# html-in-canvas 调研报告

> 日期：2026-07-30 · 状态：调研完成
> 来源：[html-in-canvas.dev](https://html-in-canvas.dev) · [overview](https://html-in-canvas.dev/docs/overview/) · [demos](https://html-in-canvas.dev/demos/) · [browser-support](https://html-in-canvas.dev/docs/browser-support/)
> 目的：核实「Canvas UI」（roadmap §六 视觉特效画笔）的真实定位，评估 html-in-canvas 对 DeepOrca 设计生成的价值。

---

## 一、是什么

**html-in-canvas 是一个浏览器原生 API 提案（WICG），不是库/框架/polyfill。** 它让开发者把已布局好的 HTML 元素直接画进 `<canvas>`（2D / WebGL / WebGPU 三种 context），无需 `html2canvas` 这类第三方截图库。

三个原语 + 一个辅助：
- `layoutsubtree` 属性：加在 `<canvas>` 上，让其子元素参与布局/命中测试/无障碍树，但视觉不可见。
- `drawElementImage()`（2D）/ `texElementImage2D()`（WebGL）/ `copyElementImageToTexture()`（WebGPU）：把隐藏的子元素画进 canvas，返回 `DOMMatrix` 同步位置。
- `paint` 事件 + `requestPaint()`：每帧浏览器 Paint 后触发一次，高效重绘。
- `captureElementImage()`：可转移快照，支持 OffscreenCanvas + Web Worker。

## 二、视觉特效能力（关键发现）

**它不是"纯画 DOM 进 canvas"——demos 展示了丰富的视觉特效**，DOM 作为 shader/像素操作的输入：

| 效果 | demo 描述 |
|------|-----------|
| 液体玻璃 | HTML 卡片画进 WebGL canvas + 实时液体玻璃 refraction shader |
| CSS-to-Shader | DOM 在 shader 之下，打字/Tab/hover 仍工作；CRT/色差/半调/ASCII |
| 弹性凸起 | WebGL2 shader 把 HTML 内容做跟随指针的径向凸起 + 软阴影 |
| 像素瓦解 | UI 卡片点击后瓦解成数千色采样粒子（Thanos snap，`getImageData`） |
| 形变文字转场 | canvas 像素操作：crossfade/dissolve/wave wipe/pixel sort（CSS 做不到） |
| 3D 房间 | HTML 元素作纹理贴在 3D 表面（仪表盘显示器、播放 CSS 动画的 TV） |
| 毛玻璃面板 | 可拖拽 frosted glass + 高斯/方向/tilt-shift 模糊 |
| HTML→图片/视频 | 社交卡/OG 图生成、`html2canvas` 原生替代、`canvas.captureStream()` 录 WebM |

> 这些与 roadmap 原「Canvas UI」条目的"液体/火焰/玻璃/粒子"描述**高度吻合**——那条描述正是基于这些 demo 写的。

## 三、可用性现状（决定性约束）

**纯实验态，普通用户不可用：**
- 仅 **Chrome Canary**（`chrome://flags/#canvas-draw-element`）和 **Brave Stable 147+**（同样需手动开 flag）。
- **Firefox / Safari 完全无实现。**
- **无 polyfill。**
- 无正式发布时间表，WICG "living explainer" / "Developer Trial" 阶段。

**对 DeepOrca 的影响**：DeepOrca 是给真实用户用的 Electron 桌面 app。Electron 跟进 Chromium 稳定版有滞后（当前实验在 Chromium 147），即便 Chromium 稳定，还要等 Electron 升级到该版本。**现在或近期都不能依赖它**。

## 四、对 DeepOrca 的价值定位

| 维度 | 评估 |
|------|------|
| **设计生成的视觉升级路径** | 高——让 Agent 生成的 HTML 设计件（DeepDesign）获得 shader 级特效，远超纯 CSS |
| **A2UI 原型模块** | 中——原型 Surface 理论上可用它做视觉增强，但 A2UI 走声明式组件路线，与低层 shader 特效耦合度低 |
| **当前可用性** | 不可用（flag 实验态） |
| **集成形态** | **不可 vendor**——它是平台 API，等 Electron 内置 Chromium 支持后才能用，无需额外依赖 |
| **风险** | 提案可能变更/废弃；跨 context 行为细节（CSS transforms 绘制时被忽略需手动同步 matrix） |

## 五、结论与 roadmap 处置

- **html-in-canvas 不是可 vendor 的特效库**——roadmap 原「Canvas UI」条目写的"构建时 vendor 组件源码"是**错误**的，已修正为"浏览器原生 API，非库不可 vendor"。
- **描述基本正确**（特效能力吻合 demos），但**优先级从 P1 降到 P3**，因为阻塞于 Chromium/Electron 平台支持。
- **定位为远期视觉特效升级路径**：等平台稳定后，它是 DeepDesign / A2UI 设计件的 shader 级视觉增强方向。当前不做、不依赖、不 vendor。
- roadmap §六 已据此更新（intro / 表格行 / Phase 3）。

---

## 参考来源
- [html-in-canvas 主站](https://html-in-canvas.dev)
- [overview](https://html-in-canvas.dev/docs/overview/) · [demos](https://html-in-canvas.dev/demos/) · [browser-support](https://html-in-canvas.dev/docs/browser-support/)
- 提案追踪：WICG（Web Incubator Community Group）
