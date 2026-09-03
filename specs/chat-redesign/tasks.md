# chat-redesign 任务清单 — 分期落地（design §十）

> 对应 [design.md](./design.md)；实施分支 `feat/modern-ui-redesign`。进度口径 2026-09-03，随落地滚动勾选。

## P1 三栏骨架 + 指令目录 + 输入框对齐

- [x] 三栏骨架（指令目录 / 会话列 / 常驻活动区，唯一滚动层 + 全局无感滚动）（`735849a` 车道模型）
- [x] 指令目录（InstructionToc，无边框隐形容器；`41cdb34` 有真实指令后才出现）
- [x] 输入框泊定会话列底部、与中列同宽

## P2 会话流重构 + Message.tsx 拆分

- [x] 会话流渲染对齐 demo-flow 设计稿（AI 去气泡 / 用户卡 / AI 名牌行 / 时间线 / 画中画逃逸修复）（`1930f5d`）
- [x] 行为流缩略行（FlowEventRow）+ 思考缩略行（ThinkingRow）
- [ ] Message.tsx 拆分六文件（UserMessage / AssistantMessage / ThinkingRow / FlowEventRow / SystemNote / ReferenceSegments）

## P3 常驻活动区

- [x] ActivityRail（思考瞬态卡 + 活动小窗 240×292 堆叠 + 子代理组）
- [x] 浮动 Tab 联动收缩（tab-open → 活动列细条，关闭恢复）
- [ ] 15 封顶 FIFO / 最新置前 / +N 清单交互的 DOM 断言测试

## P4 计划卡双态 + 引用芯片收尾

- [x] 钉住计划条（PinnedPlan，UpdatePlan 驱动：段点 + 进度 + N/M 步，点击展开完整卡）
- [x] 引用芯片五类独立标识（消息侧 + 输入框侧遮盖层方案）
- [ ] 计划卡提案态/执行态完整交互（审批 → 执行态推进、段三态折叠）DOM 断言

## P5 i18n + 测试收口 + 真机走查

- [ ] i18n 新增键 ×6 locale（design §七 键表：`activity.*` / `plan.*`）
- [ ] 真机走查清单（design §九：明暗两态 × CJK IME 芯片编辑 / 15 活动连发 / 窄窗折叠 / 权限拒绝路径 / 旧会话回放 / 主题逐套截图）
