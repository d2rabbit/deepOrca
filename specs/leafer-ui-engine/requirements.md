# leafer-ui-engine — 需求（EARS）

> Phase 1 of spec-workflow。问题陈述、引擎选型证据与技术方案见 [design.md](./design.md)；任务分解见 [tasks.md](./tasks.md)。本文件只锁验收口径。
> 立项依据：[docs/research/2026-09-10-leaferjs-stitch-ui-engine.md](../../docs/research/2026-09-10-leaferjs-stitch-ui-engine.md)（user 2026-09-10 拍板：UI-Design 引擎换掉，选型 LeaferJS，npm lib 引入）。

## 范围

UI-Design 子域（`design.materialize → lint/review/revise → 导出`）的渲染引擎替换：生成产物从 OpenUI Lang 程序切换为 **Leafer JSON 场景树**，预览从 `OpenuiRenderer`（DOM 组件）切换为 **leafer-editor 画布**（可编辑微调），`.ddu` 导出从 viewer stub 升级为真实可播放 HTML，质量闭环（lint/review/revise）同标准移植。**不含**：PM-Design 原型模块（继续 OpenUI Lang 全链路）、Stitch 借鉴项（自动补缺失屏等，独立评估）、服务端离屏渲染、富文本就地编辑、HTML-in-Canvas。

## 用户故事

- 作为用户，我用一句话描述需求后得到的是**精致化 UI 视觉稿**（图元级画布：绝对定位 + 自动布局 + 渐变/阴影/圆角），而不是组件库的流式拼贴；
- 作为用户，生成后我可以**在画布上直接微调**（拖拽/缩放/删除/编组），改动落为新版本快照，不必重新生成；
- 作为用户，我在切换历史版本时画布渲染对应版本，可回退可比对；
- 作为评审者，`design.lint / design.review / design.revise` 对 Leafer 产物以与 OpenUI 时代**同标准**工作（确定性规则 + 单轮 review + 修复环）；
- 作为交付方，我导出的 `.ddu` 双击 `index.html` 即可在**可交互画布**上查看设计稿（平移/缩放/选中微调，不再是"需要回 DeepOrca 才能看"的源码 stub）；
- 作为持有旧产物的用户，历史 OpenUI 版本的 UI-Design 套件仍可打开查看，不被新引擎判死。

## 验收标准（EARS）

### WP0 — 生成协议与修复环

1. When `design.materialize` 生成新 UI-Design 套件版本, the system shall 产出并通过契约校验的 **Leafer JSON 场景树**（受 `LEAFER_CREATE_CONTRACT` 约束：图元白名单、画布尺寸规范、design system tokens 注入），持久化为 suite content 的 `leafer` 字段（落盘 `design.leafer.json`）。
2. When 子代理返回的内容不是合法 JSON、或违反契约（未知图元/缺 root/越界）, the system shall 进入修复环（携带结构化错误回喂重试，有限次数），修复成功才持久化，与 prototype 线的 `repairOpenuiProgram` 同标准。
3. When 修复环耗尽仍失败, the system shall 返回结构化错误（含最后一次错误明细），不落盘损坏产物。
4. When 生成 prompt 组装, the system shall 注入所选 design system（9 套内置之一）作为 tokens 契约，与 OpenUI 时代同源（`readDesignSystem` 复用）。

### WP1 — 渲染与画布编辑

5. When `DesignWorkspace` 打开含 `content.leafer` 的套件版本, the system shall 以 leafer-editor 画布渲染 JSON（选择/视图缩放/适配可用），入口与迭代 composer 保持现有交互不变。
6. When 用户在画布上完成一次编辑操作（移动/缩放/删除/属性修改等）, the system shall 将画布 JSON 序列化写回并创建新版本快照（design-store versions FIFO 20 不变），版本轨可见。
7. When 用户切换到历史版本, the system shall 画布渲染该版本 JSON。
8. When 引入 leafer-editor, the systemshall 以 npm 精确版本 pin（不带 `^`，v2.2.x 线）安装 `leafer-editor`（web 版）与按需 `@leafer-in/flow`，不使用源码级 vendor。

### WP2 — 质量闭环移植

9. When `design.lint` 运行于 Leafer 产物, the system shall 报告确定性规则发现（图元越界画布、空文本节点、未引用 tokens 色、遮挡性重叠超阈值），持久化到 `quality.lintFindings`。
10. When `design.revise(part="design")` 运行, the system shall 以 `content.leafer` 为修订基线（指令 + PRESERVE 契约），产出修订 JSON 并过修复环后经 `save_suite_result` 落盘。
11. When `design.review` 运行, the system shall 以 Leafer JSON 与既有 quality 为输入做单轮文本评审，schema 校验口径不变。

### WP3 — 导出

12. When 导出 `.ddu`（pipeline openui/ui-design 新栈）, the system shall 附**可脱离宿主打开**的 `index.html`（leafer web 运行时 + design JSON 内嵌，双击即得可交互画布：平移/缩放/选中微调；运行时文件取自 npm 包 dist 产物，构建期拷贝）。
13. When 导出 `.ddu`, the system shall **不提供** PNG/SVG/PDF 图片导出（user 2026-09-10 裁决：只关注可交互 `.ddu`；预研勘误：上游 v2.2.10 的 `toSVG` 声明未实装、PDF 走 `image/pdf` 伪 mime 会静默回退 PNG——见 research 文档预研勘误节）。
14. When 导出包构建, the system shall 保持 manifest schema 兼容（format ddu / kind ui-design / pipeline 标注 leafer 栈），旧 `buildDduOpenuiPackage` 通道对存量产物继续可用。

### WP4 — 兼容与边界

15. When 打开仅含 `content.openui` 的历史 UI-Design 套件版本, the system shall 仍以 `OpenuiRenderer` 渲染（只读查看），不误判、不白屏。
16. When PM-Design 原型模块（`prototype.*`）运行, the system shall 继续全链路使用 OpenUI Lang——Leafer 不进入原型管线（guard 测试锁定双向边界）。
17. When design 域动作解析 suite content, the system shall 按 `leafer` 字段存在性路由到 Leafer 栈、`openui` 字段路由到旧栈（字段级双栈共存，suite 级不混写）。

### WP5 — 自检自修复强化与 M3E 方法论内化

18. When materialize/revise 产出结构合法的 Leafer 文档, the system shall 在持久化前运行**确定性自检 gate**（结构校验 ∪ error 级 lint：越界/空场景），gate 未过进入有限次修复环且 fail-closed；warning/info 级发现不触发修复轮（防抖动）。
19. When 组装 leafer 修订 prompt, the system shall 以**确定性 UI→大纲编译**（`describeLeaferDocument`：几何→语义措辞、元素按稳定 `name` 指代、固定遍历序）与**规范化 JSON** 为基线——同一文档输入产出字节级相同的提示词；修订指令逐字引用（M3E 意图直通）。
20. When `render_leafer` 持久化, the system shall 规范化文档字符串并以**零 LLM** 方式自动运行确定性 lint、将发现写入 `quality.lintFindings`（review 状态不受影响）。

## 非目标

- Stitch 借鉴项：自动补缺失屏、设计能力 MCP 化、Agent Manager 式并排对比（P2 独立评估）；
- 服务端离屏渲染（`@leafer-ui/node`）、富文本就地编辑（付费插件）、Canvas 文本编辑器首版启用；
- **图片导出（PNG/SVG/PDF，user 2026-09-10 裁决移出首版，阻塞于上游 toSVG 未实装；P2 重估）**；
- HTML-in-Canvas（维持 P3 观察项）、CanvasUI、原型模块任何改动；
- design.extract / design.drift（dembrandt 链路）改动。
