# Motion for React 调研：桌面端动画增强方案

> 日期：2026-09-03 · 类型：外部依赖预研（UI 动画） · 消费状态：**⬜ 未消费（纯调研，代码零落地）**
> 调研对象：[Motion for React](https://motion.dev/docs/react-quick-start)（中文镜像 motion.net.cn/docs/react-quick-start），npm 包 `motion` 13.2.0
> 本仓对位模块：`packages/desktop/src/renderer/`（App.tsx、ui-css/、components/）
> 总口径遵循 research/README.md：**本文仅供参考，正式实现以 `specs/` 为准**。

---

## §1 结论摘要（TL;DR）

**建议引入，但定位为"编排层"增量依赖，不替换现有纯 CSS 动画体系。**

| 维度 | 判断 |
| --- | --- |
| 兼容性 | ✅ 零障碍：peer `react ^18\|\|^19`（本仓 19.2.5）；Electron 43 / esbuild `target: chrome150` 下混合引擎（WAAPI+JS）全可用；纯 ESM、无原生依赖 |
| 收益 | ① 补齐本仓最大动画缺口——**退出动画为零**（React 条件渲染直接卸载）；② `layout`/`layoutId` 用 transform 替代现状的 `left`/`padding`/`top` 布局属性过渡（合成器友好）；③ `MotionConfig reducedMotion="user"` 一行统一无障碍基线 |
| 成本 | 首渲染增量 **< 6KB gzip**（`m` + `LazyMotion` 路线）；功能包 `domAnimation` +15KB / `domMax` +25KB，可走动态 import 拆 chunk（本仓 renderer 已开 `splitting: true`）。相对现 renderer 主 bundle 428KB（raw）增量可控 |
| 风险 | 低：MIT、renderer-only（不触发主进程 exact-pin 政策）、可逐表面回滚；jsdom harness 已具备 motion 需要的 matchMedia/rAF/ResizeObserver 三类 stub |
| 边界 | **循环装饰动画（呼吸/脉冲/流光/SVG 边流动）继续走 CSS**——零运行时成本，Motion 无收益；编排类（进出场/布局/级联/手势反馈）才交给 Motion |

一句话方案：`npm i motion` → 建一个 ~60 行的 `ui/motion.tsx`（LazyMotion strict + MotionConfig reducedMotion + 缓动 token）→ P0 先给 sheet/modal/toast/quickdock 补退出动画 → P1 用布局动画替换 hub/PiP 的 left/top 过渡 → P2 级联与滚动触发。

---

## §2 Motion for React 是什么

- **出身与维护**：Motion 是 Framer Motion 的更名延续（作者 Matt Perry，motion.dev），当前统一品牌为 Motion。npm 包 `motion` 是 `framer-motion` 的薄壳（`motion@13.2.0` 直接依赖 `framer-motion@^13.2.0`），两者代码同源。
- **License / 版本**：MIT；latest 13.2.0（2026-09 查询），peer deps `react/react-dom ^18.0.0 || ^19.0.0`。运行时依赖仅 `tslib`，无原生模块。
- **渲染引擎**：**混合引擎（hybrid engine）**——优先走浏览器原生 Web Animations API（硬件加速、合成器线程），复杂场景（spring 物理、布局动画、motion value 链）回退 JS 主线程。这正是它相对"纯 JS 逐帧改 style"的旧方案（react-spring v8 时代）的核心卖点。
- **Motion+ 付费部分**：`AnimateNumber`、`Cursor`、部分示例/课程为付费订阅。**本仓不涉及、不购买**，以下所有结论均基于免费开源部分。
- **文档**：motion.net.cn 为官方文档中文镜像（实测部分子页 302 到 motion.dev 原站，内容一致）。

## §3 能力清单 × 本仓相关度

按对本仓价值从高到低排序（体积数字来自官方 reduce-bundle-size 页，gzip / Rollup 口径）：

| API | 作用 | 本仓对应场景 | 相关度 |
| --- | --- | --- | --- |
| `AnimatePresence` + `exit` | React 卸载组件前先播完退出动画；`mode="wait"/"popLayout"` | **sheet/modal/toast/quickdock 全部没有退出动画**（条件渲染直接卸载）——最高价值单点 | ★★★ |
| `layout` / `layoutId`（`domMax`） | FLIP 式布局动画，全部走 transform；`layoutId` 跨元素 morph + 自动交叉淡化 | Hub flyout 展开收起现在靠 `left`/`padding` transition（shell.css:413/560）；PiP 层叠卡靠 `top`/`left` 0.26s（activity-rail.css:307-336）；右栏 tab 指示器 | ★★★ |
| `MotionConfig reducedMotion="user"` | 站点级无障碍：自动禁用 transform/布局动画、保留 opacity/颜色 | 本仓 reduced-motion 覆盖不齐（见 §4 缺口③） | ★★★ |
| variants + `staggerChildren`/`delayChildren` | 声明式编排、父子级联错峰 | skill-cards 芯片级联、welcome chips、消息入场——现状手写 `animation-delay` | ★★☆ |
| `m` + `LazyMotion`（strict） | 把 `motion` 组件的 34KB 预载成本压到首渲染 <6KB，功能包按需加载 | 体积控制的**必选项**（见 §6） | ★★★（基础设施） |
| `whileHover`/`whileTap`/`whileFocus` | 手势状态动画，tap 自带键盘可达性 | 卡片 hover 抬升、按钮按压反馈——现状 CSS :hover 够用，**仅在新交互里顺手用** | ★☆☆ |
| `whileInView` / `useInView`（`viewport.root` 可指定滚动容器） | 入视口触发 | knowledge-views 长列表项懒入场 | ★☆☆ |
| `useScroll` + `useSpring`/`useTransform` | 滚动进度绑定为 MotionValue（进度条/视差） | wiki-reading 阅读进度条（若后续加） | ★☆☆ |
| `Reorder`（`domMax`） | 拖拽重排列表 | task-hub 任务列表排序（可选，产品未要求） | ★☆☆ |
| `useAnimate`（mini 2.3KB / hybrid 17KB） | 命令式动画 | 现状仅 2 处 rAF+classList flash（ReviewWorkspace.tsx:290、RiskGraphView.tsx:227），CSS 类切换已够 | ★☆☆ |
| `useMotionValue`/`useSpring`/`useTime` 独立使用 | 单 hook 可独立 tree-shake（~1KB 级） | 如 orb 呼吸改交互式时的备选 | ★☆☆ |

## §4 本仓动画现状（2026-09-03 代码走查，量化）

渲染层动画 100% 纯 CSS 实现，**零动画库、零 WAAPI 调用**：

| 指标 | 数值 | 说明 |
| --- | --- | --- |
| `@keyframes` | 68 处 / 66 唯一名（ui-css/ 内 59） | 命名高度模式化：`ui-*-in` 入场 + 少量循环态（`ui-pulse`、`ui-composer-breathe`、`ui-taskhub-pulse`…），统一 `cubic-bezier(0.16,1,0.3,1)` + `both` |
| `transition` | ~170 处（ui-css/ 162） | hover/聚焦 + **布局属性过渡**（shell.css:560/1084 的 `left 0.3s`、activity-rail 的 `top/left 0.26s`） |
| `animation` 引用 | ~160 处 | 同上 |
| `requestAnimationFrame` | 3 处 | ReviewWorkspace flash、TaskHubWorkspace SVG 重绘、command-palette 聚焦；均非补间 |
| `element.animate`（WAAPI） | 0 | — |
| 动画库依赖 | 0 | framer-motion/motion/react-spring/gsap/auto-animate 全部 0 命中 |
| `prefers-reduced-motion` | 26 处 media query，双轨制 | 7 个 ui-css 文件**未覆盖**：activity-rail、editor-panel、primitives、settings、task-hub、vscode、wiki-reading |
| 测试环境 | jsdom harness（dom-harness.ts） | 已有 `matchMedia` stub（恒 false）+ rAF + ResizeObserver/IntersectionObserver noop；**无** `Element.animate`/`getAnimations` stub（因为从未需要） |

**三大缺口**（Motion 的价值全部对着这三条）：

1. **退出动画为零**——所有浮层（`ui-sheet`/`ui-modal`/`ui-toast`/`ui-quickdock`/hub flyout）都是 React 条件渲染挂/卸，关闭是"瞬间消失"。CSS keyframes 做不了退出（卸载时机不归 CSS 管），这是纯 CSS 路线的结构性天花板。
2. **布局属性过渡**——flyout 宽度、stage 重流、PiP 层叠用 `left`/`padding`/`top` 过渡，每帧触发布局重算；transform 合成器路径才是 60fps 正解。
3. **reduced-motion 覆盖不齐**——双轨制（no-preference 包裹式 vs reduce 关闭式）混用 + 7 文件裸奔，缺一个全局策略位。

## §5 逐表面映射方案

| 表面 | 现状（file:line） | Motion 方案 | 优先级 |
| --- | --- | --- | --- |
| 工作区 sheet（settings/knowledge/task-record…） | App.tsx:2121-2225 条件渲染；入场 `ui-sheet-in 0.32s`（shell.css:1085/1181）；scrim 淡入 0.2s（shell.css:138）；**无退出** | `AnimatePresence mode="wait"`（或 sync）包住 sheet + scrim，`exit={{opacity:0, y:8, scale:0.985}}`；**顺带把这段从 App.tsx（已 2536 行，超 2500 标准）抽成独立组件，反而减行** | **P0** |
| Toast | Toast.tsx（setTimeout 自动关，瞬间消失） | `AnimatePresence mode="popLayout"`（多条堆叠时退出的让位、其余即时回位） | **P0** |
| QuickDock / modal | quick-dock.css `ui-quickdock-in`；ui/modal.tsx `ui-modal-in` | 同上，`exit` 反向 | **P0** |
| Hub（左栏两级 flyout） | HubSheet.tsx + shell.css:413/560/567-660：`.panel-open.hub-expanded` 变量切换 + `left/padding 0.3s` transition | `<m.div layout>` 让宽度/位移变化走 transform spring；flyout 内容用 variants 级联 | **P1** |
| 活动画中画 PiP | ActivityRail.tsx:221 `.pipwin p0..p3`；activity-rail.css:307-336 `top/left 0.26s + opacity` | 单扇收缩/展开改 `layout` spring（transform 路径），层叠切换天然可中断（CSS transition 中断是跳变，spring 中断是从当前速度续接） | **P1** |
| 右栏 tab / companion 面板 | side-panels.css（36 animation/14 keyframes 卡片入场）| tab 指示器 `layoutId` 共享布局；面板切换保留现有 CSS 渐变即可 | **P1** |
| skill-cards 芯片级联 / welcome chips | skill-cards.css、primitives.css:725（手写 animation-delay） | 父 variants `staggerChildren: 0.03` 替代逐项 delay | P2 |
| knowledge-views | KnowledgePanel + knowledge-views.css：view 切换 `ui-view-fade` | 列表项 `whileInView`（`viewport={{ root: 滚动容器ref, once: true }}`）；view 切换维持 CSS | P2 |
| task-hub | TaskHubWorkspace.tsx:278 rAF 全量 SVG 重绘；task-hub.css 徽标脉冲 | **脉冲保留 CSS**；列表重排若产品需要再评估 `Reorder` | 观察 |
| risk-board（rb-flow 边流动、rb-node-flash） | risk-board.css 2 keyframes | **全部保留 CSS/SVG 方案**（Motion 布局动画不支持 SVG；路径流动 CSS 更省） | 不动 |
| 循环装饰（orb 呼吸 shell.css:1230-1248、streaming-glow、composer-breathe） | 各 CSS | **全部保留 CSS**：无限循环动画放 JS 引擎里纯浪费电 | 不动 |
| reduced-motion 补齐 | 7 个未覆盖 ui-css 文件 | 双轨归一：CSS 侧补齐 reduce 块（**这步不依赖 motion，无依赖也能先做**）+ JS 侧 `MotionConfig reducedMotion="user"` | **P0** |

## §6 技术可行性核查

| 检查项 | 结论 |
| --- | --- |
| React 19.2.5 | ✅ peer `^18\|\|^19`；AnimatePresence 官方维护活跃，React 19 为一等公民 |
| Electron 43 / esbuild `target: chrome150` | ✅ WAAPI、`matchMedia`、IntersectionObserver 全量可用；混合引擎的浏览器特性要求远低于 chrome150 |
| 打包 | ✅ 纯 ESM；`LazyMotion` 路线不依赖 tree-shaking 品质——`domMax`/`domAnimation` 走 `import("./motion-features")` 动态导入，renderer 已开 `splitting: true`（build.mjs:104-119），功能包天然落独立 chunk、首屏渲染后才加载 |
| 体积 | 首渲染 <6KB gz（m+LazyMotion）；+domAnimation 15KB / +domMax 25KB（gzip，Rollup 口径；esbuild 实际以 metafile 实测为准）。对照现 renderer.js 428KB raw：全量功能包约 +6% raw，可接受；建议 P0 先 domAnimation，P1 需要布局动画时再升 domMax |
| 依赖政策 | ✅ AGENTS.md 的 exact-pin 规则只约束"在 Electron **主进程**执行的依赖"（如 @tlibnx/tokenizer）；motion 仅进 renderer，与 react 同级对待用 `^` 即可。MIT、单运行时依赖 tslib |
| 测试 | ✅ dom-harness 已具备 motion 依赖的三类全局（matchMedia 恒 false / rAF / Observer noop）。约束：测试继续"只断言 wiring 与生命周期"——AnimatePresence 的卸载延迟在 jsdom 里表现为 DOM 短暂残留，涉及退出的断言用 `waitFor` 或断言 `onExitComplete` 回调，不对视觉断言 |
| 文件长度标准（2500 行） | ⚠️ 唯一硬约束点：App.tsx **已 2536 行**。方案要求所有 motion 封装进新文件（`ui/motion.tsx` ≤80 行、variants 目录、sheet 抽组件），App.tsx 净行数为**减不增** |
| 与 CSS 架构共存 | ✅ `ui.css` + `ui-css/` 分层不动；建议缓动 token 对齐：现有 `cubic-bezier(0.16,1,0.3,1)` 在 Motion 里对应 duration-based spring `{type:"spring", duration:0.32, bounce:0}`，视觉连续、心智统一 |

## §7 采用边界规范（防止双体系失控）

引入后立两条规矩，写进实现 spec：

1. **编排归 Motion，装饰归 CSS**：进出场、布局位移、级联、手势反馈、可中断交互 → Motion；无限循环、纯视觉氛围（呼吸/脉冲/流光/扫描线）、SVG 路径动画 → CSS。同一元素不允许两者叠加控制同一属性。
2. **`m` 组件 + `LazyMotion strict`**：全仓禁用直接 `import { motion }`（34KB 预载，strict 模式会抛错兜底），统一从 `ui/motion.tsx` 取 `m`。

## §8 备选方案对比

| 方案 | 体积 | 退出动画 | 布局动画 | 可中断 spring | 评估 |
| --- | --- | --- | --- | --- | --- |
| **维持纯 CSS + 修补** | 0 | ❌ 结构性做不到（卸载时机不归 CSS） | ❌ 只能继续 left/top 过渡 | ❌ transition 中断即跳变 | 三大缺口一个都补不了 |
| **CSS View Transitions API**（`document.startViewTransition`，Chrome 111+，本仓 Chromium 全支持） | 0 | ✅ 免费 | ✅ 截图式 morph | ❌ 官方明确：不可中断、阻塞指针事件、一次只允许一个、多元素时测量性能差 | **最值得尊重的零依赖备选**：sheet 开合、视图切换够用；但 PiP 层叠这种高频交互态切换不适合。若未来想"零依赖先补 sheet 退出"，可单独评估，与本方案不冲突 |
| **Motion（本方案）** | 6-31KB gz 分档 | ✅ | ✅ transform FLIP + layoutId | ✅ 物理弹簧、速度续接 | 编排能力/体积控制/维护活跃度综合最优 |
| @formkit/auto-animate | ~3.5KB | 部分（仅列表增删） | 仅列表 | ❌ | 只解决一个点，装两个库反而更糟 |
| react-spring | ~30KB+ | 需自建卸载编排 | ❌ | ✅ | API 偏命令式、维护节奏不如 motion |
| GSAP | ~24KB core（React 集成为 GSAP 层手写） | ✅ | Flip 插件 | ✅ | 强大但重、React 生命周期耦合要自己写；本仓场景性价比低 |

## §9 分阶段落地方案（草案，正式实现以 specs/ 为准）

**P0 · 地基 + 退出动画（~1 天量级）**

1. `npm i motion`（desktop workspace）；新建 `renderer/ui/motion.tsx`：`LazyMotion strict features={loadFeatures}`（动态 import domAnimation）+ `MotionConfig reducedMotion="user"` + 导出统一 `springToken`（duration 0.32 / bounce 0 对齐现有 cubic-bezier）。
2. App.tsx 的 `ui-sheet` 条件渲染抽成 `components/WorkspaceSheet.tsx`（内含 AnimatePresence），App.tsx 行数净减。
3. Toast / QuickDock / modal 接 `exit`。
4. 无依赖可先行项：7 个 ui-css 文件补 `prefers-reduced-motion: reduce` 块，双轨制归一。
5. 验收：`npm run check && npm test` 绿；esbuild metafile 记录 bundle delta；jsdom 下新增一条 AnimatePresence wiring 回归测试（onExitComplete 触发即断言，不碰视觉）。

**P1 · 布局动画（需升 domMax，+10KB gz → 改为动态 chunk 不进首屏）**

6. Hub flyout/stage：`left/padding` transition → `layout` spring（shell.css 两处布局过渡退役）。
7. PiP 层叠：`top/left` → `layout` spring，获得可中断连续交互。
8. 右栏 tab 指示器 `layoutId`。

**P2 · 编排与滚动（可选增强）**

9. skill-cards / welcome chips 改 `staggerChildren`；knowledge-views 长列表 `whileInView`；task-hub 若要拖拽排序评估 `Reorder`。

**回滚设计**：每个表面独立 commit；motion 只在 `ui/motion.tsx` 与各表面 props 出现，摘除 = 按表面 revert，CSS 基线（入场 keyframes）在对应表面迁移前保留，P0 阶段任何时刻可整体退回纯 CSS。

## §10 风险清单

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| bundle 增量超预期（esbuild tree-shake 劣于 Rollup 口径） | 低 | LazyMotion 路线不依赖 tree-shake；metafile 实测闸门（P0 验收项） |
| 双动画体系心智负担 | 中 | §7 两条边界规范写进 spec + code review 口径 |
| App.tsx 继续膨胀 | 中 | P0 第 2 步顺带抽组件减行；motion 封装全部新文件 |
| AnimatePresence 使用坑（条件卸载自身、key 不稳定、popLayout 偏移父级） | 低 | 官方文档五坑已列（§2 快速开始/AnimatePresence 页）；sheet 抽组件后结构固定，坑面小 |
| 供应链 | 低 | MIT、motion↔framer-motion 同源互备、无原生模块、仅 renderer 上下文 |
| Motion+ 付费能力误依赖 | 低 | 本方案全部基于免费 API，已核对 |

## §11 开放问题

1. 具体 spring 参数（stiffness/damping 或 duration/bounce）需真机视觉调优，本报告 token 值仅为对齐现状的起点。
2. domAnimation（P0 够用）与 domMax（P1 布局动画）分档加载 vs 一步到位，待 P0 实测 bundle delta 后定。
3. sheet 退出动画若想零依赖先行，可单独立项评估 View Transitions API 兜底线（§8），与主线不冲突。

## §12 参考链接

- 快速开始：https://motion.net.cn/docs/react-quick-start （原站 motion.dev/docs/react-quick-start）
- 减小 bundle：https://motion.dev/docs/react-reduce-bundle-size
- AnimatePresence：https://motion.dev/docs/react-animate-presence
- 布局动画（含与 View Transitions 对比）：https://motion.dev/docs/react-layout-animations
- 过渡/spring：https://motion.dev/docs/react-transitions · 可访问性：https://motion.dev/docs/react-accessibility
- npm：`motion@13.2.0`（MIT，peer react ^18||^19，deps framer-motion ^13.2.0 + tslib）
