# MoonViz P0 验收电池报告

- 日期：2026-09-30T03:46:14.765Z
- 引擎锚点：`engine-v0.1.7`（sha512 611c21e2681ed87b…）
- 运行时：`24.18.0 (v8 15.0.1240245-electron.0)`（ELECTRON_RUN_AS_NODE）
- 结果：**全绿**（24/24 项通过）

| 项 | 判据 | 结果 | 明细 |
| --- | --- | --- | --- |
| T0.1a | worker 内实例化 + 版本握手 | ✓ | engine 0.1.7 |
| T0.1b | 资产锚点（sha512 ↔ vendor manifest） | ✓ | 611c21e2681ed87b… |
| T0.1d | 组件快照 ↔ 引擎目录 drift（校准通道） | ✓ | 65 ids ⊆ engine |
| T0.1c | 版本不符拒绝路径 | ✓ |  |
| T0.2a | 批式 render ↔ 黄金快照逐字节 | ✓ | 3 artboards |
| T0.2b | 会话级 op 序列信封 canonical 回传 | ✓ |  |
| T0.2c | 重开 canonical 会话 SVG ↔ 批式 render 逐字节 | ✓ |  |
| T0.2d | project JSON 重水化（结构等价；byte 怪癖见注） | ✓ | handle=1, boards=t_login,t_home,t_prof |
| T0.3a | 同 canonical 命中复用 | ✓ | hits=2 |
| T0.3b | 变更后缓存键前移（新 canonical 命中） | ✓ |  |
| T0.3c | Gate 拒绝（四段串）+ 脏缓存弃置后原文档可用 | ✓ | live=2 |
| T0.4a | 超时 terminate（watchdog 真中断） | ✓ | 1218ms, rebuilds=2 |
| T0.4b | terminate 后主进程零副作用、重建可用 | ✓ |  |
| T0.5a | GateBlock 四段串形状 | ✓ | mbt_gate_block:t_login:contained_in_parent:oob |
| T0.5b | lint/critique/flows/spec 信封结构 | ✓ | flows=2 |
| T0.5c | export_html 结构 + 自包含（无外链资源） | ✓ | 12666B |
| T0.6 | 交互流逐条 session_tap 命中 | ✓ | t_login→t_home via login_btn · t_home→t_prof via activity_0 |
| T0.7 | 棘轮重建触发 + 重建后缓存恢复（canonical 重放零语义损失） | ✓ | rebuilds=2, mutatingOps=0, reopenHandle=0 |
| T0.3d-1 | 迟来 close 不动引擎会话计数 | ✓ | before=2 after=2 |
| T0.3d-2 | 迟来 close 后复用/共存句柄仍可用 | ✓ |  |
| T0.4c | 空闲 worker 死亡后下一次调用即时重建 | ✓ | 12ms |
| T0.8a | session_open("") = -1 契约 | ✓ | -1 |
| T0.8b | SEED → template → delete 种子板 → save → 重载一致 | ✓ |  |
| T0.9 | previewHtml 自包含（零外链资源） | ✓ | external=0, 12666B |

范围注记：打包形态（extraResources 路径）加载实测按计划移交预生产清单（tasks T9.2）；
T0.9 的渲染进程 iframe 冒烟由 jsdom 渲染测试（sandboxed srcDoc 属性断言）+ 真机走查覆盖。
