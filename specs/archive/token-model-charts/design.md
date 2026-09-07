# token-model-charts — Token 面板「模型热力图」弹窗（热力图 + 速度对比）· 设计稿 v2

> 状态：**设计稿 v2（已按用户裁决收敛，待开工）** · 2026-09-04 · 上游：用户「Token 面板加弹窗：①模型热力图（像素热力图、按模型着色、一天为基础）②模型速度对比图（横向、调用时更新）」
> v2 裁决：①入口改为面板上**一枚按钮**（不逐行挂入口）；②热力图**只做单模型视图**（砍掉「全部」混合着色模式）；③速度图**只显示前五**，其余收缩；④弹窗与面板互不打扰。
> 视觉稿：[`designs/model-detail-mockup.html`](./designs/model-detail-mockup.html)（自包含，浏览器直接打开）

---

## 0. 一句话

Token 面板头部加一枚「模型热力图」按钮 → 弹出一个独立 Modal（覆盖层，面板原样不动）：上半是**以天为基础的像素热力图**（chips 切换模型，一次看一个），下半是**横向 token 速度对比**（Top 5 条形 + 其余收起，流式调用时实时跳动）。

## 1. 入口与壳（v2）

- 入口：Token 面板（`TokenStatsPanel`）头部区域加一枚**「模型热力图」按钮**（`ui-token-heat-btn`，图标 + 文案，与现有头部信息并列）——**不在模型行上挂入口**。
- 壳：`Modal` 组件族弹出（`ui-token-heat-*` 新类），宽 ~560px，覆盖层——**面板与弹窗互不打扰**：弹窗开关不改变面板布局/滚动，Esc / ✕ / 遮罩关闭（现有交互）。
- 弹窗标题 = 「模型热力图」+ 工作区徽章；不再是单一模型名（模型由 chips 切换）。

## 2. 图一 · 模型热力图（日为基础的像素热力图，单模型视图）

```
        00 01 02 03 04 ... 21 22 23
  08-29  □  □  ■  □  □      ▢  ▢  □     ■=高峰  ▢=进行中
  08-30  □  ■  ▪  □  □      □  □  □
   ...
  09-04  □  □  □  □  ▪      ▣  □  ·      ·=当前小时
```

- **数据**：usage-ledger 现有字段（`ts` + `model` + `prompt+completion`）即可完整支撑，**零采集改动**。
- **网格**：列 = 24 小时（一天为基），行 = 近 7 天（最旧→最新，今天恒在底行）；单元格 = 该小时 token 总量。
- **着色（单模型视图，v2）**：chips 一排（每模型一枚，hue 由模型名哈希映射固定 10 色调色板，全局稳定），**一次只画一个模型**；明度 5 档阶梯编码该模型的小时量级。**无「全部」混合模式**（v2 砍掉）。
- **悬停 tooltip**：`08-29 周五 14:00–15:00 · ≈12.3k tokens · 5 次请求`（本地计数沿用 "≈" 纪律）。
- **边界**：今天底行最后一格 = 当前小时，该模型有进行中流式时挂呼吸点；无数据天整行空档。

## 3. 图二 · 模型速度对比（横向条形，Top 5 + 收缩）

```
模型速度（tok/s · 最近 20 次中位数）
▸ 生成中标记 ▸
deepseek-v4       ████████████████████  86.2
deepseek-v4-flash █████████████░░░  74.1 ⟋ 生成中
glm-5             ████████              38.4
qwen-max          ██████                22.6
gpt-x             ████                  15.1
  其他 3 个模型 ▾（收起状态，点开展开）
```

- **指标**：tok/s = completion tokens ÷ 生成秒数，逐请求计算；条长 = 该模型**最近 20 次的中位数**（抗抖），条尾数值随最新请求滑动更新。
- **Top 5 + 收缩（v2）**：按中位 tok/s 降序只画**前 5 条**；其余模型收进一行「其他 N 个模型 ▾」，点击就地展开完整列表（弹窗内滚动），再点收起。
- **实时性**：
  - 流式中：当前请求每秒重算瞬时速度（复用 Renderer 既有 streamProgress 心跳），该模型条挂 `▸` 呼吸标记 + 数字实时跳动；
  - 请求落账：新增 `IpcEvent.UsageRecorded`（记账点 emit）→ 弹窗刷新；面板重挂兜底轮询。
- **采集扩展（唯一写侧改动）**：`UsageRecord` 增可选 `elapsedMs`（`createChatCompletionStream` 记账点测量：请求发出 → 流结束）；tok/s 分子优先 API `completion_tokens`（真值），无则本地估算（带 "≈"）。旧账本行无此字段自然不参与速度统计，无需迁移。

## 4. IPC 与落点

| 件 | 落点 |
| --- | --- |
| `UsageRecord.elapsedMs?: number` | `core/common/usage-ledger.ts` + `createChatCompletionStream` 记账点测量 |
| `IpcRequest.TokensModelDetail`（`tokens:modelDetail`，参数 `{days=7}`） | 返回 `{heatmap:[{day,hour,model,tokens,reqs}], speeds:[{model,tokS,reqs,active}], window}` — `main/tools/tokens-summary.ts` 扩展（heatmap 带全模型，前端 chips 过滤） |
| `IpcEvent.UsageRecorded` | 记账点 emit，弹窗订阅刷新 |
| 按钮 + 弹窗 `TokenHeatmapModal.tsx` | renderer/components/；热力图纯 div 网格（零图表依赖）；速度条沿用 bar 族样式 |
| 样式 | `ui-css/` 新 `token-detail.css` |

## 5. 实施切片

| 切片 | 内容 | 量级 |
| --- | --- | --- |
| T1 | `elapsedMs` 采集 + `UsageRecorded` 事件 | 小 |
| T2 | `tokens:modelDetail` IPC（小时桶 + 速度窗口聚合） | 中 |
| T3 | 面板按钮 + 弹窗壳 + 热力图（chips/网格/tooltip/空态） | 中 |
| T4 | 速度条（Top5 + 收缩）+ 流式实时更新 | 小 |
| T5 | 测试（聚合纯函数 + 弹窗 dom-harness 回归） | 小 |

## 6. 边界与非目标

- 只统计**当前工作区**（registered root，沿用既有 tokens-summary 通道）。
- 账本旋转 shard 暂不回读（活跃账本 + 最新 1 个 shard 足够 7 天窗口）。
- 非目标：成本估算、多工作区对比、按 source 拆分、「全部模型」混合热力着色（v2 砍）、设置项。
- 速度窗口取「最近 20 次请求」而非固定时长（低频模型更稳，已拍板）。
