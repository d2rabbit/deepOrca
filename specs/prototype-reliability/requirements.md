# prototype-reliability — 需求（EARS）

> Phase 1 of spec-workflow。问题陈述、根因证据与技术方案见 [design.md](./design.md)；任务分解见 [tasks.md](./tasks.md)。本文件只锁验收口径。

## 范围

原型模块（`prototype.spec → materialize → verify → revise/arch`）的指令遵循与可靠性收口：PRD 驱动平台判定、页面逐页映射、多端循环断链修复、机械 gate 前置、预览一致性、变体交付。**不含**：绘制引擎迁移（design.md §4 已定调继续 OpenUI）、AG-UI/A2UI 传输层接入。

## 用户故事

- 作为产品经理，我在 PRD 里声明目标平台后，生成的原型**只包含我声明的端**——移动端产品不应该出现浪费的桌面端生成；
- 作为产品经理，PRD 页面清单里的每一页都能在原型中找到对应页面（按页面 ID 映射），漏页会被验收拦下；
- 作为评审者，我点击「验收」后能看到机械证据：导航连线闭环、无孤儿页面、无死按钮、生成端与 PRD 声明一致；
- 作为用户，我在多端原型上做定向修订时，改的是当前端的程序，diff 显示真实变更；
- 作为用户，播放模式下画布是纯演示——任何按钮不会悄悄产生新版本；
- 作为交付方，我导出的 `.ddp` 包含所有已生成端的程序，原型可脱离 DeepOrca 打开。

## 验收标准（EARS）

### WP0 — PRD 驱动的平台判定与页面映射

1. When spec-writer 生成新 PRD, the system shall 在信息表写入「目标平台」行（无法从需求推断时落「待确认」项而非编造值）。
2. When spec-writer 生成新 PRD 的页面清单, the system shall 为每页附英文 kebab-case 页面 ID（作为程序 `$page` 值的映射键）。
3. When materialize 被调用且未显式传 `devices`, the system shall 依据 PRD 目标平台声明决定生成端集合（如声明 mobile → 仅生成 mobile 端）。
4. When PRD 未声明目标平台, the system shall 仅生成 desktop 并在验收报告追加「平台未声明」观察项。
5. When verify 运行, the system shall 比对 PRD 声明端与实际生成端：缺端 → failed，多端 → warning 观察项。

### WP1 — 多端循环断链

6. When materialize 对多端循环生成, the system shall 每端持久化后以返回的新 head 作为下一端基线，全程无 "suite head has moved" 错误。
7. When revise 携带 `device:"mobile"|"tablet"`, the system shall 以该端变体程序为修订基线（而非桌面本体），并把修订写回该端变体。
8. When renderer 在非桌面端展示修订 diff, the system shall 以该端变体为前后口径。

### WP2 — 机械 gate

9. When verify 检查任一已生成端, the system shall 判定：每个 `@Set($page,…)` 导航目标存在于已声明页面集（否则 failed）；每个已声明页面被 root 三元引用（否则 failed）。
10. When 页面清单含页面 ID 列, the system shall 逐页比对 PRD 页与程序页面（PRD 页缺实现 → failed；程序多页 → warning）；无 ID 列的旧 PRD 降级为数量比对。
11. When 生成的程序含 bare-string 按钮动作或 `Action([])`, the system shall 在持久化前的验证 verdict 中报告为可修复问题（进入修复环）。
12. When `design.materialize` 或 `design.revise(design)` 持久化 OpenUI 程序, the system shall 先经过与 prototype 线相同的验证修复环。
13. When design.lint 运行于 OpenUI DSL, the system shall 只报告能在 DSL 上命中的规则（CSS 形状规则移除）。

### WP3 — 预览一致性

14. When 解析 PRD「待确认」项, the system shall 只采集「待确认」标题节内的列表项，不越节、不带 `[ ]` 前缀。
15. When 套件版本含任一端程序（本体或变体）, the system shall 画布、验收与播放入口可用（不再因「仅变体无本体」判空）。
16. When 交互播放模式激活, the system shall 冻结画布上的 agent 回传类动作（ToAssistant 不派发修订；本地 @Set 导航照常）。
17. When 幻灯片渲染失败, the system shall 局部提示并回退文档视图，而非整页错误化。
18. When 切换设备或版本, the system shall 表单状态按 suite+device 作用域隔离，互不注水。
19. When PRD 分节渲染遇到代码围栏内的 `##`, the system shall 不将其误判为节标题（与主进程幻灯片分页口径一致）。

### WP4 — 交付完整

20. When 套件含多端程序, the system shall 投影每端 `prototype.openui.<device>.txt` 且 `.ddp` 导出包含全部已生成端。
21. When verify 比对变体与本体, the system shall 以语句名集合结构距离（Jaccard）判定「结构化不同」，重命名式同构判 failed。
22. （引擎补丁 A-1）When 原型使用 `design.clock` 工具配合每秒刷新的 Query, the system shall 渲染真实倒计时。
23. （引擎补丁 A-2）When 导出 `.ddp`, the system shall 附每端可脱离宿主打开的 standalone HTML（官方 browser bundle 模式）。

## 非目标

- 引擎底座迁移、A2UI 序列化导出器（未来项）；
- 并排多端画板视图、交互连线可视化（P2 UI 层）；
- 页面清单→功能清单（P0 条目）的覆盖度机器检查（本轮仅页面级）。
