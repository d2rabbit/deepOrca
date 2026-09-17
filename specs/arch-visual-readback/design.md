# 架构图视觉回读闭环（arch-visual-readback）

> **状态**：方案稿（2026-09-17 立稿，本计划周期内实施）。上游调研：[2026-09-17-fireworks-tech-graph-prestudy.md](../../docs/research/2026-09-17-fireworks-tech-graph-prestudy.md)（fireworks-tech-graph；拍板：**不引代码**，吸收「评估而非断言」哲学三件套）。
> **命题**：把 vendored Archify 已内建的视觉验收半成品（多视口截图 + containment 检查 + **"visual review pending"** 悬置态）接上感知读回（vision 模型四问），并以 `--layout-json` 的确定性几何检查为更便宜的第一道门——形成「布局契约 → containment → 视觉回读 → 定向修订 ≤2 轮」的分层验证闭环，全部搭在既有管线上，**零管线改动、vendored 树零改动**（沿袭 arch-map-reinforce 硬约束）。
> **实施状态（2026-09-17）**：P0+P1 代码面落地——门① `archify-layout-check.ts`（6 例 + mutation-check）、门②③ `arch-visual-verify.ts`（containment harness + vision 四问，诚实跳过全路径）、`ArchVisualVerifier` 第三接缝（core archify-controller + index 导出）、arch-scan.run 有界修订循环（≤2 轮，revise 载荷进 buildArchScanTaskPrompt REVISION 块，prompt 测试 13/13）、SKILL.md 语义箭头词汇表 + 修订运行节；门禁全绿 + vendor 树零改动（R5 以 git diff 为证）。真机两态（T2.1）待排期。
> **姊妹 spec**：[arch-map-reinforce](../arch-map-reinforce/design.md)（提示词层强化，已收官）；本 spec 是其 §0.4-4「不做审美评估器」决策的**对账型延伸**——见 §0.1。

---

## 0. 背景与对账

### 0.1 与 arch-map-reinforce §0.4-4 的对账（必须先读）

该决策原文：「不做渲染质量自动评估器……"好看与否"的闭环用 R4 golden 对拍**人工走查**，不新造评估器」。本 spec 不推翻它，而是划清界限：

- **不做**：审美/风格评估（好不好看、够不够高级）——仍是 golden 人工走查的领地；
- **做**：**事故性缺陷检测**（文字裁切、节点重叠、标签溢出、明显不可读）——这类缺陷有客观判据，且上游 visual-check 的联系表页头自己就写着 **"automated containment {status} · visual review pending"**：截图已产出、判定悬置等人。本 spec 用 vision 模型把这半边闭环接上，**复用上游截图与 containment，不新造评估器**——恰是该决策"不新造"精神的执行方式。

### 0.2 现状与证据（全部已核对 vendored/宿主代码）

| # | 事实 | 出处 |
| --- | --- | --- |
| E1 | vendored `bin/visual-check.mjs` 已内建：CDP 驱动 Chrome（`ARCHIFY_CHROME` 可指）、4 视口 × 2 主题加载产物、**确定性 containment 检查**（scrollWidth/Height vs 视口溢出判定）、PNG 截图旁挂（2 视口 × 2 主题）、receipt JSON（含 containment.status 与截图清单）、**联系表 HTML**、退出码 pass/fail/**skipped**（Chrome 不可用即诚实跳过） | `vendor/archify/bin/visual-check.mjs`（EXIT :20、containment metrics :306-311、captureScreenshot :315-321、receipt :505-516） |
| E2 | 联系表页头硬编码 **"visual review pending"** ——截图的感知判读上游不做，留给人 | 同上 contactSheetHtml（:381） |
| E3 | `archify validate <type> --layout-json` 可输出布局几何（architecture 类图）——节点坐标可确定性检查 | `vendor/archify/bin/archify.mjs:21,1493-1504` |
| E4 | 交付门禁 = schema + layout + render 检查（9 项 showcase 0 warning），receipt/HMAC 链——本 spec 不触碰 | `archify-cli.ts:6-7` 及 arch-map-reinforce §1 |
| E5 | vision 调用面现成：`createVisionClient` + `runStandaloneChatCompletion`（D3 落地，flag-aware）；visionModel 未配置时 `createVisionClient` 返回 null（天然 skipped 判据） | `desktop/main/tools/vision-mcp.ts:84-87`、`core common/ai-sdk-transport.ts` |
| E6 | arch-scan 动作是编排宿主（110 行，arch-map-reinforce 已在此扩过参）——修订循环的正确落点 | `core/actions/arch-scan.ts` |
| E7 | 后台任务 skill 门：非 `arch-scan` skill 无 artifact 语义——本 spec 全部挂在 arch-scan 名下，不新增 skill | `session-manager-tasks.ts:216`（arch-map-reinforce §0.4-1 同款约束） |

## 1. 设计：三道门的分层验证（便宜在前，感知在后）

```
arch-scan 产出 IR → deliver（既有门禁，不动）
  → 门① 布局契约（确定性，零渲染成本）
       validate --layout-json → 节点 bbox 两两重叠检查 + 视口溢出
       （architecture 类图先行；无 layout-json 的类型跳过并如实标注）
  → 门② containment（确定性，上游内建）
       spawn vendored visual-check.mjs → parse receipt
       containment=fail 直接带证据进修订；pass 才进门③
  → 门③ 视觉回读（感知，唯一花 vision 的一步）
       receipt 的 2 视口×2 主题截图中取 1 视口×双主题（控成本）
       → vision_chat 四问契约（结构化输出）：
          1 文字是否有裁切/截断  2 节点是否重叠遮挡
          3 标签是否溢出容器      4 图例/连线标注是否可读
       每问 pass/fail + 一行证据（哪个区域）
  → 判定：全 pass → 通过；任一 fail → 定向修订反馈（失败问答 + 截图路径
       联系表路径回灌 agent）→ agent 改 IR → 重走 deliver+三门
  → 修订上限 2 轮（沿 design-stage-gates/Gate 回灌既有经验值）；
     两轮未过 → 图仍交付（deliver 门禁已过=结构合格），验收报告如实
     标注「视觉缺陷未收敛（第 N 轮失败问答）」——不静默降级
```

**诚实条款（fireworks 同款）**：visionModel 未配置 → 门③ 标 `visual review skipped`（receipt/contactSheet 照常产出供人工看），门①②照跑；Chrome 不可用 → 门② 上游自带 skipped 语义透传。任何 skipped 都出现在验收报告里，绝不冒充通过。

## 2. 实现落点（改动面清单）

| 件 | 落点 | 说明 |
| --- | --- | --- |
| 门① 布局契约检查器 | `desktop/main/tools/archify-layout-check.ts`（新，~120 行） | 消费 `validate --layout-json` 输出；节点 bbox 两两重叠（容差 1px）+ 越界；纯函数核心可单测 |
| 门②③ 回读编排 | `core/actions/arch-scan.ts` 加一段 verify 阶段（~150 行；必要时抽 `arch-visual-verify.ts`） | spawn visual-check（宿主经 configureArchifyPaths 既有解析）→ parse receipt → 门③ 调 vision（经 `runStandaloneChatCompletion` + vision client）；四问结构化契约走 aux schema |
| 修订循环 | arch-scan 动作内 | 反馈 = 失败问答 + contactSheet/截图路径；≤2 轮；报告如实标注 |
| SKILL.md | arch-scan 技能文档 + 提示词段 | 教 agent 消费回读反馈的修订动词（「按失败问答改 IR，不要重写全图」）+ 语义箭头词汇表（V3，见 §3） |
| 验收报告 | 沿 arch-scan 既有报告面扩展 | 三门状态 + 修订轮次 + skipped 项全部呈现 |

**零改动**：vendored 树（visual-check/archify.mjs 原样 spawn）、deliver 门禁与 receipt/HMAC、viewer 渲染器、IPC 形状。

## 3. V3 语义箭头词汇（最小化吸收）

fireworks 的「箭头语义 = 颜色+线型」对应到本仓 = **IR 链接类型的语义使用规约**（不是改渲染器）：SKILL.md 增一张「链接语义表」（同步调用/异步事件/数据读写/双向 → 各用哪个 IR link type + 标签动词建议），让模型的边落笔有语义锚。纯提示词层，一次表改，随 P1 落地。（形状语义不吸收——viewer 的视觉语言归上游渲染器，宿主不自创。）

## 4. 明确不做

1. 不做审美/风格评估（§0.1 对账；golden 人工走查不动）。
2. 不改 vendored 任何文件（含 visual-check.mjs）——它的 skipped 语义与 receipt 形状原样消费。
3. 不做 golden 像素对拍（上游截图是给人/模型看的验收材料，不是 diff 基准）。
4. 不新增 skill 名/IPC 通道（E7；反馈走动作报告面）。
5. 不把视觉回读塞进 deliver 门禁——它是**生成侧质量环**（agent 修订用），不是交付闸门（结构合格即交付的语义不变）。

## 5. 验收（EARS）

- **R1 分层顺序**：任一产物的验证 shall 依序执行 门①（可得 layout-json 时）→ 门② → 门③，且门③ 仅在门② pass 时消耗 vision 调用。
- **R2 诚实跳过**：visionModel 未配置时，验收报告 shall 标注 `visual review skipped`，门①② 照常执行与呈现。
- **R3 契约强制**：门③ 输出 shall 过 aux schema（四问各 pass/fail + 证据行），违约重试一次后以 `visual review inconclusive` 如实呈现。
- **R4 有界修订**：修订 shall 至多 2 轮；超限后产物照常交付，报告标注未收敛项与失败问答。
- **R5 零管线**：vendored 树、deliver 门禁、receipt/HMAC、viewer、IPC 形状 shall 全部零改动（以 git diff vendor/ 为空为证）。
- **门禁**：`npm run check && npm test` 全绿；layout-check 单测 + 四问契约单测（mock vision）含 mutation-check 一次。

## 6. 分期

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| P0 | layout-check 纯函数 + 单测（黄金：构造重叠/越界 layout-json） | 0.5 天 |
| P1 | 门②③ 编排进 arch-scan（verify 阶段 + 修订循环 + 诚实跳过）+ SKILL.md 词汇表 | 1 天 |
| P2 | 真机：任一项目 arch-scan 全链（vision 配置/未配置两态）+ 报告走查 | 0.5 天 |
