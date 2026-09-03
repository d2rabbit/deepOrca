# 桌宠小助手（Orca Pet）— 调研与设计

> 日期：2026-08-16 · 状态：调研定稿（未实现）
>
> 定位：**锦上添花**。默认开启但可一键全局关闭；不阻塞、不修改任何核心链路。
> 铁律：**core 零改动**（core 无 UI），全部落在 desktop renderer + 至多 1 个只读 IPC 新增。
> 集成点证据：`packages/desktop/src/shared/ipc.ts`（`IpcEvent:182`、`memory:* :141-146`）、`packages/desktop/src/renderer/components/`。

---

## 一、调研结论

### 1.1 渲染技术选型

| 方案 | 体积/依赖 | 能力 | 判定 |
| --- | --- | --- | --- |
| **SVG（SMIL/CSS）** | 零依赖 | 静态态 + 微动态（睡觉 Zzz、饥饿表情、眨眼） | ✅ **基础层**：所有状态的兜底，reduced-motion 降级目标 |
| **@lottiefiles/dotlottie-web** | 播放器按需懒加载（主包零增量）；WASM（thorvg）渲染，纯 JS/WASM 依赖、无原生构建 | `.lottie` 单文件打包多动画 + 主题 + **内置状态机**；渲染性能优于 lottie-web | ✅ **主选**：复杂动画态（吃、庆祝、思考） |
| lottie-web | ~334KB（84KB gzip），成熟但偏大 | Lottie JSON 播放 | ⚠️ 备选（dotlottie 集成遇阻时降级） |
| Rive | 状态机最强，但资产需换生态重做 | — | ❌ 本期不引入 |
| live2d / shimeji 式帧图 | 重/维护成本高 | — | ❌ |

> 注：dotlottie-web 用 WASM 渲染——这是渲染层第三方库，与沙箱方案里"WASM 不能隔离原生进程"的结论不冲突；此处 WASM 恰好是优势（小、快、无原生构建，不违反仓库约束 4）。

### 1.2 同类产品

| 产品 | 做法 | 启示 |
| --- | --- | --- |
| vscode-pets | GIF sprite + 极简状态机 | 价值在**陪伴感**，不在玩法深度；轻交互即足够 |
| shimeji | 桌面爬窗、丰富交互 | 维护成本高，交互边界不清 → 不做 |
| live2d 桌宠 | 高表现力、重资产 | ❌ 超出"锦上添花"定位 |

**差异化结论**：别家宠物的状态是随机演出；Orca Pet 的状态**全部映射真实产品状态**（会话/工具/错误/记忆管线）——宠物 = agent 状态的人格化可视化 + 记忆系统的"回闪"出口。这是它区别于纯装饰品的唯一理由，也是设计的核心约束（§三、§四）。

---

## 二、形态分期

| 期 | 形态 | 说明 |
| --- | --- | --- |
| **P0** | 主窗口角落伙伴 | renderer 内浮层（默认右下，可拖开、可最小化成一枚 SVG 头像），不遮挡 Composer；零窗口管理复杂度 |
| **P1** | 独立无边框透明悬浮窗 | 经典桌宠形态（always-on-top、可选 click-through、跨桌面拖动），另立项；涉及窗口管理与 IPC 转发，P0 验证价值后再做 |

---

## 三、状态机与事件源（核心设计）

**不做假状态** —— 每个状态都有真实事件源。事件全部来自既有 IPC channel（`shared/ipc.ts:182-199`），renderer 订阅即可：

| 状态 | 触发（真实事件源） | 表现资产 |
| --- | --- | --- |
| `sleeping` | 无活动会话且空闲超时（默认 10min） | SVG 微动态（Zzz） |
| `idle` | 有打开项目、无 running 会话 | SVG/Lottie 呼吸 |
| `thinking` | 会话 status=running（`event:sessionEntryUpdated`）+ `event:llmStreamProgress` 进行中 | Lottie 循环 |
| `working` | assistantMessage 含 tool_calls（`event:assistantMessage`） | Lottie 循环（与 thinking 可合并为一个"忙碌"态，资产先行合并） |
| `celebrating` | 会话完成（running→completed/waiting_for_user） | Lottie 一次播放 |
| `oops` | 会话 failReason 非空 / status=error | Lottie 一次播放 |
| `hungry` | 饥饿计时到期（§四） | SVG 表情 + 气泡提示 |
| `eating` | 进食触发（§四） | Lottie 一次播放 + 记忆气泡 |

**规则**：一次性动画（celebrating/oops/eating）可打断循环态，播完回到按当前事件源应处的态；`oops` 优先级最高但 5s 后自动回落；任何状态切换都写 debug 日志，状态机为 renderer 内纯 TS 模块、可单测。

---

## 四、"饿了吃记忆（假吃）"机制

这是桌宠与产品唯一的功能性闭环，按"假吃"字面语义设计：

1. **饥饿计时**：距上次进食 > 4h（设置可调/可关）→ 进入 `hungry`：角落换饥饿表情 + 低频气泡（每 30min 最多一次，**绝不弹系统通知**）。
2. **进食**：用户点击喂食（主路径）或允许自动进食（设置项，默认关）。
3. **吃什么**：通过既有 `memory:search`（`ipc.ts:144`）随机取一条 L1/L2 记忆 → 播 `eating` 动画 + 气泡展示该记忆的摘要 —— 即"**记忆回闪**"：把 memory pipeline 的历史上下文以人格化方式浮现给用户，有真实召回价值。
4. **假吃铁律**：**默认零 mutation** —— 不删、不改、不消化任何记忆。唯一可选写入是记忆条目的 `lastSurfacedAt`（设置项默认关），作为记忆系统间隔重复排序的输入；开启时 UI 必须明示"进食会影响记忆排序"。
5. **无记忆可吃**（记忆系统关闭/为空）：吃"空气零食"彩蛋动画，不报错、不提示开启记忆系统（不借桌宠做功能推销）。

---

## 五、资产管线

```
packages/desktop/assets/pet/
  manifest.json            # state → { asset, loop, durationMs, fallbackSvg }
  svg/   *.svg             # 全部状态的基础态（先行，占位即可）
  lottie/*.lottie          # 复杂态渐进替换，不阻塞工程
```

- **资产约束**：仅本地静态文件，禁远程 URL；Lottie 资产只用内部制作/已审核来源，**禁用 expressions**（Lottie 表达式可执行 JS，供应链口子）；单动画 ≤ 200KB，首批总量 ≤ 3MB，按需加载。
- **制作路径**：orca 品牌形象；SVG 占位先跑通全部工程，Lottie 资产随设计资源渐进补齐——工程不依赖设计排期。

---

## 六、交互清单（刻意克制）

| 交互 | 行为 |
| --- | --- |
| 点击 | 状态气泡（当前 agent 状态的一句话人格化播报）；hungry 时 = 喂食 |
| 悬停 | 当前状态 tooltip |
| 右键 | 菜单：喂食 / 睡觉 / 隐藏 / 设置 |
| 拖拽 | P1 悬浮窗才支持 |

**不做**：对话能力、养成数值、小游戏、随机打扰、系统通知。交互边界写死，防止 scope creep 成电子宠物游戏。

---

## 七、性能与降级

- 窗口 `visibilitychange` hidden / blur 时暂停动画与计时器；dotlottie 播放器 `import()` 懒加载，主包零增量。
- `prefers-reduced-motion` 或设置里"低端模式"→ 纯 SVG 静态层。
- 同一时刻仅一个动画实例；状态高频抖动时 300ms 防抖。
- 桌宠全局开关 + 饥饿机制独立开关（settings，桌面端 schema，不动 core）。

---

## 八、隐私与安全

- 无新增网络请求；资产全本地。
- IPC：只订阅既有事件 channel；进食读取走既有 `memory:search`；若确需"随机一条"语义，至多新增 1 个只读方法（`memory:snack`），不写任何记忆数据（`lastSurfacedAt` 选项若实现，走独立显式方法并默认关）。
- 不收集任何行为数据；饥饿计时等状态仅存本地 settings。

---

## 九、任务清单

> 已抽离至 [`tasks.md`](./tasks.md)（2026-08-18 文档整顿：P1–P9 任务 + P0 4–6 天估算 + 开工前置条件）。

## 十、成本收益的诚实评估

- **收益**：陪伴感（vscode-pets 已验证）；agent 状态的人格化可视化（差异化）；记忆回闪给 L0-L3 memory pipeline 一个轻量、好玩的出口。
- **成本/风险**：约一周工程量 + 设计资产依赖（已用 SVG 占位解耦）；最大风险是交互 scope creep —— §六已把边界写死；其次是性能，已用懒加载 + 降级层兜底。
- **不做它的代价**：零。这是纯增量，任何时候砍掉都不影响主产品。
