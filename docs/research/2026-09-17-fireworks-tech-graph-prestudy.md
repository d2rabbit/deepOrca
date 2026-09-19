# fireworks-tech-graph 绘图哲学预研 — 「评估而非断言」（不引入，只吸收设计哲学）

> 状态：⬜ 纯调研留档（2026-09-17，零代码变更）。调研仅供参考，正式实现以 `specs/` 为准（本目录总口径）。
> 缘起：项目所有者指定作为**技术架构图绘制能力**的强化输入——**明确不引入代码**，只吸收设计哲学。
> 上游：[yizhiyanhua-ai/fireworks-tech-graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)（MIT，11.4k★，Agent Skill 形态的自然语言→生产级技术图：几何校验 SVG / 1920px PNG / 动图 / 离线交互 HTML）。
> 方法：README/仓库结构一手抓取；与本仓架构图线（Archify 引擎 / arch-scan 技能 / arch-map-reinforce spec / CRG 架构图）逐项对位。

---

## TL;DR

1. **核心哲学一句话**：「**Evaluate, don't assert**」——图的「完成」由验证器/渲染证据证明，而非模型的自称。这与本仓机械门哲学（design-stage-gates、Archify 9 项 showcase 检查、memory-audit 确定性扫描）完全同构，验证了我们已有的路线，并给出三块**可吸收的具体机制**。
2. **最有价值的单件**：**PNG 视觉回读**（visual readback）——把渲染结果导出成位图再「看回去」检测裁切/重叠。本仓已有全部零件（离屏 Chromium + vision MCP 的 vision_chat），却从没把它们串成架构图的质量闭环。
3. **第二件**：**组合契约作为机器门**（零交叉/每边 ≤2 折/节点间距 ≥40px/标签净空预算）——Archify 已有结构校验门，但**几何层**的交叉/间距/标签契约是缺口。
4. **第三件**：**有界修订 + 诚实报告**——定向修复默认 ≤2 轮（与本仓 Gate 回灌两轮上限独立同源）；视觉审阅不可用时如实标 skipped，绝不冒充通过。
5. **不引入的理由**：其为通用 Python CLI 技能栈（cairosvg/rsvg/Puppeteer/FFmpeg），与本仓 Archify（TS、类型化 JSON→交互 HTML）职责重叠；吸收哲学即可，引入即冗余。

---

## 1. 上游机制拆解

### 1.1 管线（「Loop Engineering」有界反馈环）

```
Prompt → 图契约(Diagram Contract) → 语义 IR → 风格规格 → 路由规划
      → SVG 构建 → 结构校验(确定性) → PNG 视觉回读(感知性)
      → 定向修订(默认 ≤2 轮) → 验证过的 SVG + PNG
```

分层验证是灵魂：**确定性检查在前**（XML 合法性、marker、几何、碰撞——便宜且精确），**感知验证在后**（导出 PNG 读回，检测裁切/重叠——只有前者过了才花这个钱）。

### 1.2 组合契约（Composition Contract，机器可查）

- 正交布线 + 精确路径点 + 独立端口；
- 「**零交叉、零桥接、每边至多两折**」+ 节点间距 ≥40px + 容器留缝 + 标签净空预算；
- **语义形状词汇**：LLM=双线框矩形、Agent=六边形、向量库=环纹圆柱——形状即语义；
- **箭头语义**以颜色+线型编码（写/读/异步/循环）；
- **版本化 IR + schema 归一化**：畸形几何、悬空引用、重复 ID 在渲染**前**失败（fail-closed before rendering）。

### 1.3 工程评审风格契约

风格 9–12 各带「工程语义契约」（C4 分层、部署归属、事件轨拓扑、golden signals）——**每种风格先过语义契约再渲染**，而非渲染出来再说好不好。

### 1.4 诚实报告

视觉审阅依赖图像读取能力；不可用时输出明确标注「视觉审阅 skipped」，绝不把未验证的图报成已验证——与本仓 v0.9.0「失败阶段如实标注 failed/skipped，不打印成功字样」的原则一字不差地同源。

---

## 2. 与本仓架构图线对位

| fireworks 机制 | 本仓对应物 | 判定 |
| --- | --- | --- |
| 「评估而非断言」总纲 | 机械门哲学全局（design-stage-gates 两级降级 / Archify 9 项 showcase 检查 + 原子提交 + 篡改回执） | **已同构**——路线互证 |
| 结构校验（确定性前置） | Archify 类型化 JSON + 校验门禁（v0.9.0 已落地） | 已有 |
| **PNG 视觉回读（感知后置）** | **无**——离屏 Chromium（web-fetch provider）与 vision MCP（vision_chat/vision_ocr）各自存在，从未串联成图质量闭环 | **吸收点 ①** |
| **几何组合契约**（交叉/折点/间距/标签净空） | Archify 校验偏结构（类型/引用/图序），几何层契约缺失 | **吸收点 ②** |
| **语义形状/箭头词汇** | arch-scan（oh-my-mermaid 12 视角）有语义类型→配色映射，无形状/线型语义层 | 吸收点 ③（部分） |
| 风格化工程契约（C4/部署/事件轨） | arch-map-reinforce 的「叙事用满/成品质感规约」 | 对齐，可细化 |
| 定向修订 ≤2 轮 | design-stage-gates Gate 回灌两轮上限 | **独立同源**，互证 |
| 诚实报告（skipped 如实标） | v0.9.0 失败阶段如实标注 | 已同构 |
| 版本化 IR fail-closed | Archify 类型化 JSON 前置失败 | 已同构 |

**定位**：本仓架构图线的「结构校验」半边已经很 fireworks；缺的是**「感知验证」半边**（视觉回读）与**几何层契约**。arch-map-reinforce spec（active，effective-html 调研承接：叙事用满/成品质感/聚焦单图）正是这两个缺口的预定落点。

## 3. 吸收建议（提案，实现以 spec 为准）

全部作为 **arch-map-reinforce spec 的增补提案**，不另立门户：

1. **视觉回读闭环（首选）**：Archify 产物（交互 HTML）离屏 Chromium 截图 → vision_chat 做「裁切/重叠/标签溢出/留白失衡」四问 → 不过则带证据回灌修订（≤2 轮，复用既有上限）。零件全在（web-fetch 的离屏渲染器 + vision 端点 + D3 的 `runStandaloneChatCompletion` 传输），只差编排。**诚实条款照搬**：vision 端点未配置时输出标注「视觉审阅 skipped」，不得冒充通过。
2. **几何组合契约入 Archify 门禁**：节点间距下限、标签净空、连线交叉计数（HTML/SVG 产物可静态计算）——新增 2–3 项确定性检查，排在视觉回读**之前**（便宜检查先行的分层原则）。
3. **语义形状/箭头词汇表**：arch-scan 的语义类型映射表增补「形状/线型」两列（服务类型→形状、调用语义→线型），一次表改全图受益；仅在 arch-map-reinforce 实施时顺手带入，不单独排期。
4. **不引入清单**：Python CLI 栈、SVG 直出管线、GIF 动效、品牌图标库——与 Archify 职责重叠或超出架构图域。

## 4. 参考

- 上游仓库：<https://github.com/yizhiyanhua-ai/fireworks-tech-graph>（MIT；README/目录结构一手抓取）
- 本仓对位：`specs/archive/arch-map-reinforce/design.md`（原活跃 spec，已收官归档，吸收落点）、Archify 引擎（v0.9.0 changelog：类型化 JSON→确定性门禁→交互 HTML）、`docs/research/2026-08-06-oh-my-mermaid-research.md`（12 视角方法论）、`packages/desktop/src/main/tools/vision-mcp.ts`（vision_chat，回读执行器候选）
