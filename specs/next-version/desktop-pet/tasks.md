# 桌宠小助手（Orca Pet）— 任务指引（规划中）

> 日期：2026-08-18 文档整顿建立 · 状态：**调研定稿（P0 未开工，属冻结期外 `next/*` 范畴）**
> 阶段模型：**预研 → 设计 → 任务**，三层在当前树内可查（无外部仓库依赖）：
>
> | 层 | 文档 | 现状 |
> | --- | --- | --- |
> | 预研 | [`design.md`](./design.md) §一（渲染技术选型 + 同类产品调研） | ✅ 定稿（调研与设计合一稿） |
> | 设计 | [`design.md`](./design.md) §二–§八（形态分期/状态机/吃记忆机制/资产管线/交互/性能/隐私） | ✅ 定稿 |
> | 任务 | **本文件**（2026-08-18 由 design.md §九 任务清单抽离） | ⏳ 待开工 |

## 预研结论摘要

渲染选型 = **SVG 基础态 + dotlottie 懒加载**（状态机驱动）；形态分期 P0 角落浮层 / P1 悬浮窗另立项；核心特色 = "饿了吃记忆（假吃）"——气泡触发时检索 memory 做回闪卡片。详见 design.md §一/§四。

## 任务清单（自 design.md §九 抽离）

- [ ] **P1** settings 开关 + 偏好（全局/饥饿/低端模式/自动进食）— desktop settings + SettingsPanel（0.5d）
- [ ] **P2** `pet-state-machine.ts` 纯 TS 状态机 + 单测（§三全状态 + 打断规则）— `renderer/lib/`（1d）
- [ ] **P3** 事件订阅接线（sessionEntryUpdated/assistantMessage/llmStreamProgress）— `renderer/api.ts` + 状态机（0.5d）
- [ ] **P4** `PetWidget.tsx` 角落浮层 + SVG 基础态全套 + 最小化 — `renderer/components/`（1d）
- [ ] **P5** dotlottie 懒加载集成 + manifest 加载器 — `renderer/lib/`（0.5-1d）
- [ ] **P6** 吃记忆机制（memory:search 复用；可选 `memory:snack` 只读 IPC）— renderer + `shared/ipc.ts` + main（1d）
- [ ] **P7** 气泡 UI（状态播报 + 记忆回闪卡片）— `PetWidget`（0.5d）
- [ ] **P8** 降级与性能策略（§七全项）— 状态机 + Widget（0.5d）
- [ ] **P9** 占位 SVG 资产一套（9 态）+ manifest — `assets/pet/`（视设计资源）
- [ ] **P10**（P1 悬浮窗）— 另立项

**P0 合计约 4–6 天**（不含设计资产）。建议单次 PR 交付 P1–P9，SVG 占位即可，Lottie 后续补。

## 开工前置条件

- 预生产冻结解除或 `next/*` 立项；隐私约束继承 design.md §八（宠物不采集新数据，只消费既有事件/记忆）。
