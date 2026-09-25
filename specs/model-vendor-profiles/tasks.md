# 模型厂商画像与专属优化 — 任务清单（tasks）

> 对应需求：[requirements.md](./requirements.md)（R1–R14）/ 设计：[design.md](./design.md)。
> 上游：[v5.1 方案](../../docs/research/2026-09-22-model-optimization-plan.md) + [四期调研报告](../../docs/research/2026-09-22-vendor-code-agent-model-optimizations.md)（599 断言复核，26 证伪已修正）。
> **P0 可独立交付**（纯数据通路 + 试探骨架，不含手写厂商知识，不依赖 R13 修订收尾）。

## P0 数据通路 + 试探骨架（1.5–2 天）

### 目录解析扩展

- [x] P0.1 `model-catalog.ts`：`CatalogModelEntry` 增加 `npm` / `api` / `interleavedField` / `reasoningOptions` / `temperature` / `structuredOutput` / `family` 七字段；沿用既有 fail-open（缺失=undefined，绝不抛错）；vendor 快照刷新（223 providers / 8003 models，2026-09-22 已拉取）
  - _Requirement: R8, R12_
- [x] P0.2 目录派生函数（`model-capabilities.ts` 门面层）：`thinkingMandatoryFromCatalog`（values 无 none/off ⇒ 不可关；三源印证）与 `catalogEffortValues`；接线 `openai-thinking.ts`（不可关永不发关闭态）与档位菜单校验
  - _Requirement: R8, R12_
- [x] P0.3 `reasoningReadFields` 改目录 `interleaved.field` 驱动（无目录回退现有双字段链），支持 `reasoning_details` 数组形状（取 summary）；接线点实际为 `session-manager-base.ts`（`effectiveReasoningReadFields`，流式读取链消费 profile——converter 不感知家族差异）
  - _Requirement: R8_
- [x] P0.4 temperature 门控读目录 `temperature`（无目录维持现状条件发送）——接线于 session-manager-lifecycle 主循环发送点（`catalogTemperatureBlocked`）
  - _Requirement: R8_

### 画像与命中

- [x] P0.5 新建 `common/model-profile.ts`（零依赖）：`ModelProfile` 类型（wire/local 两包 + evidence）+ `resolveModelProfile` **五段命中**（⓪别名 → ①具名 → ②子家族 → ③家族 → ④UNKNOWN）；注册**白名单**（requirements 支持矩阵的显式型号表；白名单外一律 matchedBy=fallback）+ 七家族条目（**M3.1 不入单**；qwen3.8 官方端点 flash/max/plus/max-preview；step-5-preview 1M 登记）；别名表 `kimi-for-coding|kimi-code|kimi-coding` → 目录元数据解析，目录不可用落家族默认+全维试探；`FAMILY_MODEL_SUGGESTIONS` 按白名单更新
  - _Requirement: R1, R2, R3, R13, R14_
- [x] P0.6 `isFirstPartyChannel`（hostname 后缀主 + catalog provider id 辅；不可判定=false）——仅作试探加速预置，不参与正确性
  - _Requirement: R4_

### 试探与两段式

- [x] P0.7 请求构造两段式改造——落地形态与立稿略异：两段式收敛为「构造期探针否决」（`openai-thinking.ts` 经 `shouldApplyWireOptimizations` 在 builder 内决定是否叠加 patch；`session-manager-base.ts` 流式读取链经 profile 决定字段）——patch 整体可丢弃语义由 openai-thinking 的条件分支承载，语义等价（patch 不可用时回到 caller 形状）
  - _Requirement: R9_
- [x] P0.8 端点试探机制：可归因拒绝识别（§design 五）→ `(通道,模型)` 禁用记账（会话内存；**通道键=规范化 baseURL 全串**——同 host 不同路径入口如 stepfun `/v1` 与 `/step_plan/v1` 是不同网关栈；拒绝随新用户轮次过期重试）→ 同轮默认态重发一次 → 结构化降级日志；**归因精确性测试**（auth/quota/限流/溢出不触发禁用）。维度级记账（同一通道只禁被拒维度）列 backlog
  - _Requirement: R4, R5_
- [x] P0.9 spec 合并（2026-09-22 用户拍板）：model-fleet-adaptation 已加「已被合并取代」横幅（以本 spec 为主）；X 线五红线与已落地基建由本 spec 继承；README 两处已更新
  - _Requirement: R13（model-fleet）_

### P0 测试与门禁

- [x] P0.10 单测：解析矩阵（别名/具名/子家族/家族/UNKNOWN × 七家；minimax M2 拿 204K 非 1M、M3.1 不走 M3 补丁路径、kimi-k2.7 always-thinking）；deepseek golden 逐字节；目录 fail-open；mutation-check
  - _Requirement: R1, R2, R7, R11, R12_
- [x] P0.11 门禁：`npm run check` + `npm test` 全绿

> **P0 落地记录（2026-09-22/23）**：P0.7 的两段式以「构造期探针否决 + runWithRecovery 可归因分支同轮重跑」形态落地（`openai-thinking.ts` 构造期经 `shouldApplyWireOptimizations` 否决 patch；`session-manager-lifecycle.ts` runWithRecovery 对可归因 400 记账后重跑整轮 = 默认态重发）。新增 `common/model-probe.ts`（归因判定 + (通道,模型) 记账 + 事件缓冲）。测试：`tests/model-profile.test.ts` 17 例（含 R5 归因精确性与双 mutation-check：thinkingMandatory 派生反转 → 4 fail；归因放宽 → 2 fail）。全 core 套件 1073 pass / 0 fail；`npm run check` 全绿（87 条 warning 均为存量，与本变更无关）。
> FAMILY_MODEL_SUGGESTIONS 已按白名单对齐（M3.1 不入、step-5-preview 置顶、六家族填满），golden 测试同步更新并加白名单断言。

## P1 压缩与缓存（3–4 天）

- [x] P1.1 压缩三档阶梯 `{warn, auto, hard}`（在既有两级触发+0.9 预检上演进）+ 摘要副查询输出预算 + **输出预留从分母扣除**（ZCode 口径：否则请求预算与压缩窗口两套常量）；**C32 刚需化**——新代统一 1M 窗口下不落本项则 ~900K 才压缩；「跟随窗口比例 vs 经济上限」经 `settings.compactTokenThreshold` 暴露为产品可配置项（文档注明触发值≠窗口）。**复审语义修正（S2-F4）**：覆盖值口径=精确触发阈值（loop-top `> 覆盖值`、预检 `≥ 覆盖值×0.9`，沿用旧精确语义不做输出预留二次折减）；阶梯仅在**无覆盖**时生效（auto 驱动预检、hard 兜底 loop-top）
  - _Requirement: R6_
- [x] P1.2 microcompact 增强：既有 Stage-A 上加保 N 组、媒体保护、**256-token 最小节省门槛**（不够省整体回滚）；**rapid-refill 熔断**（压缩后 3 工具回合又满×3 次 → 停止+「分块读取」提示）
  - _Requirement: R6_
- [x] P1.3 工具结果落盘指针 + **续读协议**（`continuation_hint` 原参续读）
  - _Requirement: R6_
- [x] P1.4 技能注入评估：**结论=现状已合规，无需改动**。证据（session-manager-lifecycle.ts:288-294 注释即设计意图）：① 系统前缀按稳定度 MOST→LEAST 排序构建（专为 DeepSeek 前缀缓存共享最大稳定头）；② 日期/模型行刻意走每轮 transient user-message tail 而非烤进前缀；③ 技能经 appendSkillMessages **追加式**进入历史（append-only = 缓存安全，无改写）。MiMo 的「改写 system prompt 破坏缓存」顾虑在 DeepOrca 现状下不成立；「端点接受中途 system」维度的残留风险由 P0.8 试探承接
  - _Requirement: R4, R6_
- [x] P1.5 装配指纹：system+tools 的 sha256（排除消息历史、保留空白敏感、键序规范化）+ 变更结构化日志
  - _Requirement: R6_
- [x] P1.6 测试：压缩触发点实测（判别式：输出预留扣除后触发点右移）；指纹不变性；mutation-check

## P2 工具面与循环（3–5 天）

- [x] P2.1 循环干预阶梯：kimi 3/5/8/12 文案采纳 + 同 key 同步去重空占位；工具语义化判定（归一化命令重试计数）
  - _Requirement: R6_
- [x] P2.2 工具面收窄：MCP 披露（估算 > 15%×contextWindow → 代理工具）+ 模态压制（原生模态删除回退上传工具）。**2026-09-23 backlog 落地**——挂 `computeRoutedMcpTools` 同链后置阶段（先路由后收窄、一起会话冻结），见「五项 Backlog 落地记录」#2；真机兜底行为并入 V.4
  - _Requirement: R6, R8_
- [x] P2.3 兜捞意图守卫：`scavengeToolCalls` 加 `proseRatioGuard`（qwen 0.8 同构：显式区域扣除后散文占比过高则放弃）
  - _Requirement: R6_
- [x] P2.4 退化输入守卫：`minImageEdgePx` 双向防线（生产者守卫+消费端末道网）
  - _Requirement: R6_
- [x] P2.5 read→edit 失败自愈层：行号前缀剥离（全前缀形状才剥、只重试一次、二次失败重抛）+ Unicode 归一（智能引号/连字符/特殊空格）——与 snippet_id 互补
  - _Requirement: R6_
- [x] P2.6 配额 vs 限流分流：`llm-error.ts` 增配额/TPM/余额类别（不可重试）；四家实证模式采纳
  - _Requirement: R5_

## P3 表达层与锚点（2–4 天）

- [x] P3.1 静态 patch 表 + **路径冲突检测**（ZCode merge-patch 语义：null=删除、重叠路径抛错）；受限表达式 DSL 完整移植 **2026-09-23 落地**（`common/option-map.ts`，见「五项 Backlog 落地记录」#3）
  - _Requirement: R14_
- [x] P3.2 cache_control 三锚点（system/tool/user.last）+ per-anchor TTL（ephemeral|'1h'）+ 单调归一 + skipCacheWrite（摘要锚点前移）
  - _Requirement: R6_
- [x] P3.3 流式重试提交边界：「可见增量=提交边界」+ 缓冲重放（对调用方透明）；**执行层 2026-09-23 落地**（接入 createChatCompletionStream，见「五项 Backlog 落地记录」#4）
- [x] P3.4 观察式窗口学习：413 探针 → per-(模型,通道) 观察值 → 阈值 min(目录,观察)；恢复原地重试+上限
  - _Requirement: R10_

## 真机验证（每家族两轮：第一方 + 第三方；收官门）

- [ ] V.1 会话+对话+工具调用（第一方）；档位菜单与目录 `reasoning_options[].values` 一致
- [ ] V.2 不可关模型（qwen3.8-max-preview / kimi-k2.7-code / MiniMax-M3.1 / glm-5.3）：关闭不产生 400；派生判定与真机一致
- [ ] V.3 压缩触发点实测（百分比与阶梯一致；熔断可触发）；缓存命中（指纹不变不失效）
- [ ] V.4 **试探降级**（第三方样本：minimax-m3@ollama-cloud / requesty / opencode）：被拒维度精确禁用、其它保留、同轮重发成功
- [ ] V.5 **归因精确性**：人为 auth/quota 错误 → 零禁用
- [ ] V.6 **窗口学习**：人为小窗 → 一次 413 后阈值收敛
- [ ] V.7 MFJS（kimi 模型）；多模态与目录 attachment 一致；记忆四链路零跨厂商 404
- [ ] V.8 deepseek 真机零回归（golden 补充）

## Backlog（三期候补，不在本 spec）

流式错误法学完整移植（qwen 分类器）、AUTO 模式 LLM 权限分类器、max-mode propose-only、bash 输出形状清洗（MiMo Token Efficient）、omni reactive-degrade、持久化重试投影、sandbox 拒绝即教学。

---

# 实施落地记录（2026-09-23）

## 门禁终验

- `npm run check` 全绿（typecheck + lint 0 error + format + license）
- 全 core 套件 **1128 pass / 0 fail**（原 1073 → 新增 55 例：profile 17 + ladder 8 + patches 7 + window 6 + anchors 5 + stream 5 + selfheal 7）
- **mutation-check 全部通过**：thinkingMandatory 派生反转(4 fail)、归因放宽(2)、prose 守卫禁用(1)、worthTrimming 门槛(1)、装配指纹 diff 禁用(1)、patch 冲突检测删除(3)、TTL 单调归一删除(3)、窗口 min 语义删除(3)——每项突变后对应测试转红，恢复后全绿

## 模块清单（新增 8 / 接线 5）

| 模块                                                                                                                               | 行数级 | 职责                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `common/model-profile.ts`                                                                                                          | 新     | 白名单五段命中 + 目录派生 + 第一方判定 + proseRatioGuard（零依赖）   |
| `common/model-probe.ts`                                                                                                            | 新     | (通道,模型) 试探记账 + 可归因拒绝判定 + 事件缓冲                     |
| `common/compaction-ladder.ts`                                                                                                      | 新     | 三档阶梯公式 + 输出预留扣分母 + rapid-refill 熔断状态机              |
| `common/optimization-patches.ts`                                                                                                   | 新     | 静态 patch 表：null 删除 + 深合并 + **路径冲突检测**                 |
| `common/assembly-fingerprint.ts`                                                                                                   | 新     | 装配指纹（排除历史/空白敏感/键序规范化）+ 变更 diff                  |
| `common/repeat-breaker.ts`                                                                                                         | 新     | 循环干预阶梯 3/5/8/12 + canonical key + 四级文案                     |
| `common/edit-selfheal.ts`                                                                                                          | 新     | read→edit 自愈：行号前缀剥离 + Unicode 归一（NFKC/引号/连字符/空格） |
| `common/input-guard.ts`                                                                                                            | 新     | 退化图片守卫（PNG/GIF/JPEG 魔数读尺寸，8px 下限）                    |
| `common/window-observation.ts`                                                                                                     | 新     | 观察式窗口学习（413 探针 → min(目录,观察)）                          |
| `common/cache-anchors.ts`                                                                                                          | 新     | 三锚点 + TTL 单调归一 + skipCacheWrite 前移                          |
| `common/stream-commit-boundary.ts`                                                                                                 | 新     | 流式提交边界（可见增量=提交）+ 重试判定                              |
| 接线：model-catalog / openai-thinking / session-manager-base / session-manager-lifecycle / tools/edit-handler / tools/bash-handler | 改     | 见 tasks 各条目                                                      |

## 白名单落地（requirements 支持矩阵 → 注册表）

| 家族     | 白名单（27 型号 + 3 别名）                                                        |
| -------- | --------------------------------------------------------------------------------- |
| deepseek | flash / v4-flash / v4-pro / v4-flash-vision-exp                                   |
| stepfun  | step-5-preview / step-3.7-flash / step-router-v1                                  |
| kimi     | kimi-k3 / kimi-k2.7-code(-highspeed) + 别名 kimi-for-coding/kimi-code/kimi-coding |
| minimax  | MiniMax-M3（**M3.1 隐藏**）                                                       |
| qwen     | qwen3.8-flash / -max / -plus / -max-preview                                       |
| glm      | glm-5.3 / -flash / -flashx / -highspeed                                           |
| mimo     | mimo-v2.5 / -v2.5-pro / -v2.5-pro-ultraspeed / v2.6-pro(-ultraspeed/-flash)       |
| agnes    | agnes-2.5-flash / agnes-3.0-flash（**2026-09-24 新增**，官方 wiki 增补）          |

白名单外 → matchedBy:'family'（保守默认）或 'fallback'（兜底）——**全部与升级前逐字节一致**。

## agnes 家族落地记录（2026-09-24，用户指令「模型适配增加 Agnes 家族的 2.5f 和 3.0f」）

- **证据**（第一方官方文档，wiki.agnes-ai.com）：`agnes-2.5-flash` /
  `agnes-3.0-flash`，端点 `https://apihub.agnes-ai.com/v1`（OpenAI 兼容
  chat completions + Anthropic 兼容 messages + responses 三协议）；上下文
  512K / 最大输出 65,536；输入文本 + 图像 URL；工具调用 OpenAI 形状；
  **思考开关 = `chat_template_kwargs.enable_thinking` 布尔**（无 effort
  阶梯、无 thinking.type 信封——OpenAI 兼容协议下独此一家）。
- **落地形态**（全部走既有机制，零新概念）：vendor id `agnes` 入
  `ModelVendorId`/`ModelFamilyId`；白名单 ×2；家族 pattern `^agnes-/i`
  （2.5-pro 与 image/video 型号落家族兜底）；第一方 host `agnes-ai.com`；
  `FIRST_PARTY_PROVIDER_IDS` 补 `agnes`/`agnes-ai`；`FAMILY_MODEL_SUGGESTIONS`
  补 agnes 行。**思考形状是 P3.1 DSL 的第一个纯数据落地家族**——
  `WIRE_POLICIES.agnes.optionMaps.reasoningLevel =
'{"chat_template_kwargs":{"enable_thinking": input != "disabled" && input
!= "none"}}'`，经 openai-thinking 既有 map 缝隙生效，P0.8 试探看守
  （carriesThinkingWirePatch 对 map 形态即刻生效——swarm round-2 F1 修复
  保证了新家族从第一天就有完整记账/同轮重发语义）。能力面（窗口/多模态）
  不入 FAMILIES 注册表，走 models.dev 目录 fail-open（R8 数据外置，与
  glm/kimi/qwen 同例）。
- **测试**：白名单解析 ×2、思考形状（开/关布尔）、试探后回落通用 builder、
  家族兜底（2.5-pro / image / video）、第一方通道判定；套件全绿。

# Backlog（四期实施后的明确延后项）

> **2026-09-23 更新**：前五项已全部落地（见「五项 Backlog 落地记录」），仅剩真机验证 V.1–V.8。

| 项                              | 原任务    | 状态                                                                        |
| ------------------------------- | --------- | --------------------------------------------------------------------------- |
| 工具结果落盘指针（spill 工件）  | P1.3 后半 | **已落地**（`common/tool-spill.ts`，bash 截断 + Stage-A 双钩子）            |
| 工具面收窄（MCP 披露/模态压制） | P2.2      | **已落地**（`common/mcp-surface.ts`，挂 `computeRoutedMcpTools` 同链）      |
| 受限表达式 DSL 完整移植         | P3.1 后半 | **已落地**（`common/option-map.ts` + glm 四拼写 map，openai-thinking 消费） |
| 流式重试缓冲/重放执行层         | P3.3 后半 | **已落地**（接入 `createChatCompletionStream`，提交边界静默重试 ×1）        |
| 试探维度级记账                  | P0.8 后半 | **已落地**（归因字段匹配：thinking/unrelated/unknown 三态）                 |
| 真机验证 V.1–V.8                | 收官门    | 待办：需桌面环境 + 各厂商 key                                               |

# 五项 Backlog 落地记录（2026-09-23）

**同链原则（用户红线）的落实**：工具/MCP/skill 面的一切收窄都挂在既有
`getRoutedMcpTools → RoutingFacade.decideToolRoute → 会话冻结` 这**一条链**
里作为后置阶段（`computeRoutedMcpTools` 内先路由、后收窄、一起冻结）——
没有第二套路由器；落盘续读复用既有 `read` 工具（不新增工具/协议）；
DSL patch 应用复用 `optimization-patches.applyPatches`（不重写 merge/冲突检测）。

1. **工具结果落盘指针（B1）**：`common/tool-spill.ts`——超阈值工具输出原文
   落盘 `<projectRoot>/.deeporca/spill/`（保留最新 20 件，失败 fail-open），
   消息留摘录 + 指针，模型用 read 工具按 path 续读。钩子：bash
   `truncateOutput`（截断时 spill）与 Stage-A 压缩（trim 时 spill）。
2. **工具面收窄（B2）**：`common/mcp-surface.ts` 纯模块两阶段——①模态压制
   （目录 `multimodal: true` → 剔除 vision 代理服务器工具，全 vision 面不剔）；
   ②MCP 披露（schema 估算 > 15%×窗口 → 每服务器折叠为 `mcp__<server>` 代理
   工具，`{tool, arguments}` 参数 + 工具名 enum）。执行侧
   `asDisclosureProxyCall` 在 executor 的 MCP 分发旁路解析，且对**解析后的
   真实三段名**做 `isMcpTool` 守卫（畸形调用无法伪装成代理）。
3. **受限表达式 DSL（B3）**：`common/option-map.ts`——ZCode
   `@zcode/model-option-map` 的完整移植（tokenizer/parser/compiler/evaluator +
   进程级 memo + 深冻结 + 三元分支对象结果校验；词法含 `< <= > >= %` 一元 `+`）。
   消费缝隙：`ProfileWire.optionMaps`，声明了 `reasoningLevel` map 的家族由
   **数据形态替代**代码 builder（同一能力两种形态，只走其一，绝不叠加写同名
   字段）；编译/求值失败 fail-open 回 builder。glm 家族登记 ZCode 内置
   openai-chat 四拼写默认规则（D9.5 原型），受 P0.8 试探看守。
4. **流式重试执行层（B4）**：`createChatCompletionStream` 消费循环——提交前
   缓冲原始 chunk（`canSilentlyRetry` 以缓冲区为唯一事实来源），瞬态类别
   （TIMEOUT/RATE_LIMIT/SERVER/TRANSIENT）失败且未提交/未外发 onDelta →
   丢弃物理请求**原样重发一次**（对调用方透明；失败尝试按「字节已发出」
   口径记账）；已提交 → 保持原尝试抛错，走上层恢复通道。`commitsOutput`
   补齐 wire chunk（choices[0].delta）形状识别。
5. **试探维度级记账（B5）**：`model-probe.ts`——拒绝消息**点名思考族字段**
   → 只禁 `thinking` 维度；**点名无关字段**（tools/temperature/max_tokens…）
   → 不记账不同轮重发（S1-F2 误禁消除——那是补丁的锅之外的原因，原样重发
   必然再 400）；认不出 → 通配保守禁全部。维度/通配键都随新用户轮次过期。

**门禁**：core 套件 **1157 pass / 0 fail**（+28 例）；mutation-check ×6 全部
转红后恢复（DSL 结果校验禁用 / 模态压制禁用 / spill 清理禁用 / 维度记账退化
通配 / wire chunk 形状识别删除 / option map 消费禁用）。

## 反 dsh 截断语义审查（2026-09-23 用户拍板：不学 dsh「超长截断留在上下文」的毛病）

审查判据：截断摘录必须带**唯一、无歧义**的恢复杠杆，且不得让模型在残缺
数据上无感推理；同链红线复查（无重复工件/平行能力）。四处修正：

1. **bash 截断文案单一杠杆化**：spill 落盘 + read 续读是唯一建议动作；
   「重跑命令 + tail」降级为 spill 不可用时的兜底——重跑有副作用
   （make/部署被再执行）、非确定性命令重跑输出发散，正是「截断导致意图
   不完整」的放大器。指针附行数（read 的 offset/limit 是行号口径）。
2. **后台命令去双写**：后台完整输出本就落盘
   `BACKGROUND_OUTPUT_DIR/<taskId>.log` 且路径已告知模型——后台路径不再
   走 spill（重复工件消除）。
3. **Stage-A 阈值缝隙闭合**：spill 下限支持按调用方对齐——Stage-A 以
   8192（其裁剪门槛）为 spill 下限，「凡被裁的都可找回」，消灭 8K–16K
   「被裁但无处找回」缝隙带。
4. **披露代理意图保真**：折叠丢的是参数 schema，不丢「工具是干什么的」
   ——代理描述带每个工具的首句（截 120 字符）+ 名称 enum，模型仍能选对
   工具、构造接近正确的参数，错误回包负责其余校正。

复查后判定不动项：B4 静默重试的「reasoning 计入提交边界」保守语义保留
（推理流对用户可见，静默换请求会造成可见内容重复）；内置工具
（bash/read/edit）永不参与收窄，意图关键面不受 B2 影响。

**门禁**：core 套件 **1158 pass / 0 fail**；`npm run check` 全绿。

# 复审闭合记录（2026-09-23，bug-hunt-swarm 四路调查 S1–S4）

- **thinkingMandatory toggle 勘误（R11）**：`reasoning_options` 含 `{type:"toggle"}` ⇒ 可关（models.dev 实证：deepseek=[toggle,effort]、MiniMax M3=[toggle]）；仅纯 effort 阶梯且全档不含 none/off/disabled 才判不可关。`wireFor` 对目录实证条目显式落布尔（含 false），「实证可关」与「目录不可知」三态可区分。
- **目录第一方优先**：`buildModelIndex` 同 id 冲突时 `FIRST_PARTY_PROVIDER_IDS` 优先，消除聚合源声明漂移。
- **P1.1 覆盖语义**：恢复旧精确语义（见 P1.1 条目注），阶梯仅无覆盖时生效。
- **rapid-refill 熔断改 per-session**：`Map<sessionId,state>` + `Set<sessionId> tripped`——manager 级共享会让无关会话互相污染，且一次熔断永久锁死整进程。
- **openai-thinking 消费 offEffort**：stepfun「off→low」代发恢复（mandatory 探针否决态下以低档代关）。
- **窗口学习接真值**：溢出恢复路径以 `session.activeTokens` 为观察样本（declared-as-estimate）；`effectiveWindowTokens` 的主循环消费点随 P2.2 一起观察真机效果后接入。
- **console 违规清除**：装配指纹日志改走 host 注入的 `logOpenAIChatCompletionDebug`；限流/探针恢复提示走 `session-prompts` 双语目录（新增 `rateLimited`/`probeFallback` 键，替代误用的「compacting」文案）。
- **探针通道键路径粒度**：`hostname` → 规范化 baseURL 全串（同 host 不同路径入口隔离；尾斜杠等价）。
- 复审后门禁：core 套件 **1129 pass / 0 fail**；`npm run check` 全绿。

# swarm round-2 审查记录（2026-09-23，bug-hunt-swarm S1–S4 对 89daffde + 2106ffc6）

四路只读调查（复现边界/代码接缝/回归面/证明计划）对五项 Backlog 落地与
反 dsh 闭合做断言级审查。**查后判净**：Stage-A 无孤儿工件（spill 在
worthTrimming 门内，8192 算术自洽）、DSL 语义与 fail-open 闭合、熔断
per-session 隔离正确、披露预算 `<=` 边界正确、executor 分发无影子效应、
冻结路由三处失效路径齐全、测试无弱化、i18n 双语齐备。**确认成立并已修**：

- **F1【高】glm optionMaps 补丁的记账死缝**：lifecycle 记账门只认
  `thinkingMandatory === true`，而 glm map 形态（无目录条目时 mandatory
  缺失）的补丁照发 wire——400 后不记账不同轮重发，会话对该端点持续失败。
  修复：新增 `carriesThinkingWirePatch(profile)`（镜像 wire 应用谓词：
  mandatory **或** optionMaps 任一在 wire 上即算携带补丁），lifecycle 改用。
- **F2【高】spill 工件污染用户 git 工作树**：`.deeporca/spill/` 无
  gitignore 覆盖，`git add -A` 会把含敏感输出的工件收进历史。修复：spill
  目录自 gitignore（目录内写 `.gitignore`=`*`，不碰用户文件、幂等）；
  本仓 .gitignore 同步补行。
- **F3【中高】混合措辞 400 楔死**：归因 unrelated 先判使「enable_thinking
  … with tools」类混合措辞不记账不重发——补丁明明在拒绝面内却永不自愈。
  修复：思考字段先判（混合措辞归 thinking 维度、禁用后重发）；仅**纯**
  无关措辞才跳过。最坏情形代价有界（一次必败重试后错误照常上抛）。
- **F4【中】字段匹配词干误伤散文**：`\b(think|reason)` 把 "no valid
  reason given" 判成 thinking 维度。修复：精确词形两端 \b
  （enable_thinking/thinking/reasoning_effort/reasoning）。
- **F5【低中】静默重试的二次 create 失败零日志零记账**：与首次 create
  失败「按字节已发」契约不一致。修复：重建 openStream 包 try/catch，
  appendAccounting(0,null) + logApiError 后上抛。
- **F6【低】重试非流式回退丢 usage**：合成 chunk 不带 usage → apiUsage
  恒 null。修复：usage 随 chunk 带入消费循环（含缓存字段合并路径）。
- **F7【低】RATE_LIMIT 零退避静默重发**：mid-stream 429 立即重发是对
  已限流端点的连发。修复：RATE_LIMIT 移出静默重试集合（导出
  `SILENT_STREAM_RETRY_CATEGORIES` 供测试钉住），交上层限流通道。
- **F9【中】模型切换继承冻结收窄快照**：narrowToolSurface 的模态门/披露
  预算是模型感知的，冻结面却不含模型维度——热切模型后新模型继承旧快照
  （多模态→纯文本会丢唯一视觉通道）。修复：冻结条目带 `{model, tools}`，
  模型变更即重算（同模型仍字节稳定，R1 前缀缓存语义不受影响）。
- **F10【低】probe 事件缓冲无界 + drainProbeEvents 零生产消费**：修复：
  事件缓冲封顶 64（环形丢最旧）；探针降级经 `logRoutingEvent({stage:
"probe", outcome: "fallback"})` 进入 host 注入的 routing logger（新增
  stage 值，可观测性落地）。
- **F8【文档】R7「逐字节一致」范围澄清**：该承诺约束画像/请求形状层；
  B1/B2/B4 是模型无关的 harness 层行为（对所有模型一致生效），不在此面。
  requirements.md R7 补范围注；AGENTS.md 工具路由段补披露代理解析一行。

**门禁**：core 套件全绿（0 fail）；`npm run check` 全绿。遗留观察项（不
阻塞）：narrowToolSurface/exec 代理分发的集成级测试仍以纯函数测试 +
typecheck 覆盖（G2 缺口，真机 V.4 承接）；静默重试双 ledger 记录为既定
「按物理请求计费」口径（UI 聚合如需折叠逻辑轮次属产品决策）。

# swarm round-3 审查记录（2026-09-24，bug-hunt-swarm 对 89108cae..0f35898e 六笔全链）

四路只读调查（语义正确性/同链接缝/回归面/证明实跑）对画像 P0–P3 → 五项
Backlog → 反 dsh → round-2 → agnes 六笔做全链断言级审查。**查后判净**：
agnes 思考形状双态安全、frozenToolRoutes 新形状全触点适配、静默重试循环
复位语义、executor 分发顺序无影子、deepseek R11 golden 在锁、测试无恒真。
**确认成立并已修**：

- **G1【高】veto 语义反转**：探针记账后 `mandatoryStillProbed=false`，
  mandatory 模型用户关思考回落发目录已证伪的 disabled 形状，同轮再 400
  后整轮死。修复：mandatory 是**目录实证的保护**，不随 veto 解除（veto
  只作用于 map/补丁应用层）。
- **G2【高】map 家族 veto 回落形状**：agnes/glm 的思考形状是端点唯一文档
  形状，通用 builder 形状从未被其验证。修复：map 被 veto（或求值失败）
  时回落「不发任何思考键」（服务端默认），非 mandatory 模型绝不发未验证
  形状。
- **G3【高】目录碰撞抢占**：第一方间 first-wins 使 kimi-k3 的 mandatory
  派生取自 alibaba-cn 转售条目（effort-only）而非 moonshotai 自家
  （toggle+effort）——用户关思考被强制打开。修复：碰撞解析加**自有序**
  （model id 前缀 → 厂商自家 provider，rank 2 > 第一方 rank 1 > 聚合 0）。
- **G4【高】探针错键**：catch 处用主客户端坐标记账，失败可能来自压缩/
  后台的跨模型请求——veto 记到无辜模型。修复：create 错误路径给 error
  盖章本次请求自身的 (model, baseURL)（symbol 附加），lifecycle 优先读章。
- **G5【中】记账进程级全清**：任一会话的用户轮清掉其它会话的坏端点记账，
  该会话逐请求重燃必败补丁。修复：per-session Map 隔离 +
  resetWireProbe(sessionId)（同 S2-F3 熔断先例）。
- **G6【中】temperature 门控越界**：对任意模型生效（586 个非白名单被静默
  剔除），违反 R7 画像层承诺。修复：门加 matchedBy==="model"（与 P0.3 同
  口径）。
- **G7【中】目录大小写不对称**：白名单 toLowerCase 比对 vs 目录精确键，
  minimax-m3 小写拼写丢全部目录派生。修复：精确 miss 后全表大小写不敏感
  回退（条目缓存消化，非热路径）。
- **G8【中】三态盖章**：reasoning:true + 空 reasoning_options 被落成
  「实证可关 false」（kimi-k2.7 生产形态，文档 always-thinking）。修复：
  thinkingControlKnowledge 三态——无控制形状 → undefined（不可知），
  绝不盖章。
- **G9【低】白名单计数勘误**：28 → 27 型号 + 3 别名。
- **G12【低】代理守卫空转**：isMcpTool 是前缀判定，恒真于三段名。修复：
  mcpManager.hasMcpTool 真实存在性检查。
- **G10/G11 记录不修**（低危/既定口径）：双记账跨面不一致（spec 已承认为
  产品决策项）；spill 20 件滚动对存活指针无感知（ENOENT 可自愈——read
  报标准 file-not-found，repeat-breaker 兜底；按会话分子目录留待真机观察）。

**门禁**：core 套件全绿（0 fail）；`npm run check` 全绿。V.x 真机清单追加：
agnes 官方端点对 `thinking.type` 信封的容忍度（G2 回落路径的真机面）。

# round-4 审查记录（2026-09-25，code-bug-analyzer 四维并行对 90a76753）

四路分析（静态/逻辑/安全/质量）审查 round-3 修复本身——「修 bug 的代码也会
引入 bug」。安全组判净（五条攻击链全部不可达，本链是净安全增益）；其余三
组确认**修复自伤四条高危**并全修：

- **H1【高】G5 修复在主入口复活**：`resetWireProbe(activeSessionId ?? undefined)`
  在新会话首条消息（activeSessionId=null，desktop 新建聊天的常态）落
  undefined → 进程级全清。修复：无 active 会话时跳过（新会话桶本就为空）。
- **H2/H3【高】veto 回落矩阵漏两格（统一修）**：mandatory+无map（qwen 系）
  veto 后重发**逐字节相同**请求（二连 400 整轮死，probeFallback 文案撒谎）；
  mandatory+map（glm-5.3 快照实测）veto 后落回「从未被验证」的通用信封
  （G1 豁免反噬 G2 原则）。修复：veto 生效一律返回 `{}`（不发任何思考键，
  非 disabled 不违 G1；重试形状保证可变；服务端默认兜底）。
- **H4【高】G7 的动机案例实际未修复**：大小写回退只在精确键**不存在**时
  触发，而 minimax-m3（小写）在聚合商下有精确键——排名从不介入，用户
  拿到聚合商 512K 而非厂商 1M。修复：建期**折叠视图**（lowerKey→同族
  最高 rank），lookup 统一经折叠解析。
- **H5【中】G5 覆盖回归**：辅助调用（技能/分解/depth/后台）无 sessionId
  → 只读 "" 桶 → 任何会话的 veto 对它们不可见，整会话重发已证伪形状。
  修复：无坐标查询读**全桶联合**（尊重任一会话学到的证据；各会话按轮
  过期/删除清桶语义不变）+ skills/mcp 两处手边 sessionId 直接透传。
- **H6【中】盖章缺口**：流中错误与静默重试 reopen 失败未盖章（网关
  200+SSE error 可携带可归因 400）。修复：两处补盖章。
- **M7【中】probe Map 泄漏**：deleteSession 不清桶 + 读路径物化空 Set
  （每个静默 subagent 永久占位）。修复：deleteSession 清桶 + 读不物化。
- **M8【中】厂商通道 id 家族化**：stepfun-ai（step 真实基 id）不在任何
  表被当聚合商；自有序改基 id + `-` 派生通道前缀匹配。
- **M9【中】坏 optionMap 静默退化**：编译/求值失败与 veto 同落 `{}` 但
  零痕迹。修复：catch 落 logRoutingEvent(stage:"option-map")。
- **M10【中】budget-only 三态**：options 仅 budget_tokens 非空被盖
  「known」→ mandatory 落 false（空真）。修复：无 toggle 无 effort →
  unknown。
- **L12【低】key-in-query 入日志**：通道键/日志 detail 改 origin+path
  （剥 query）。
- **L13【低】死代码清除**：events 环形缓冲 + drainProbeEvents 零消费者，
  移除（诊断走 logRoutingEvent）。

记录不修：minimax-m3 无第一方声明者（13 家聚合商互相矛盾，first-wins
今日取 ollama-cloud 的 toggle 声明——上游键序变更可翻转 mandatory；
spec 明文容忍聚合商兜底，真机 V 项观察）；resolveModelProfile 每请求
~3 次（微秒级 vs 网络百毫秒，判不值得 memo）；G1×G5 交互下 mandatory
模型 veto 后每轮 1 次必败 + 提示（H2 统一 `{}` 后重试可变，可自愈）。

**门禁**：core 套件 **1178 pass / 0 fail**；`npm run check` 全绿。
V.x 真机清单追加：GLM 官方端点缺省思考键行为（H2 统一回落的真机面）。

# 功能层面测试（2026-09-25，用户指令「你自己进行功能层面测试」）

新增 `tests/profiles-engine-functional.test.ts`（5 例，全套件内常驻）——
单测之上的引擎回路验证，全部用**真实组件**（SessionManager 完整
activateSession / 真实 bash+read 工具 / 真实 executor / 真实 vendored
models.dev 快照），只有网关是录制 mock：

1. **探针引擎回路**：glm-5.3（mandatory）+ 录制网关首调抛可归因 400 →
   引擎记账 → 同轮重发请求**零思考键**（round-4 统一矩阵的真机形态）→
   会话 completed；首请求断言四拼写补丁全量 + mandatory 抬升（用户关
   思考仍开）+ 温度字段保留。
2. **温度门控（G6 引擎面）**：kimi-k3（白名单+目录 temperature:false）→
   请求无 temperature；非白名单模型同声明 → 字段保留（R7 画像层承诺）。
3. **真实快照数据驱动**（文件缺席自动跳过）：生产数据上验证 G3（kimi-k3
   取 moonshotai toggle）、H4（minimax-m3 小写→厂商 1M）、glm-5.3
   mandatory、agnes 双子 ~512K、25 个白名单拼写逐 id matchedBy=model。
4. **spill→read 回环**：真实 bash 工具 40K 输出 → 截断+落盘+指针 →
   read 工具取回尾部标记；反 dsh 文案断言（无 re-run）；自忽略 .gitignore。
5. **披露代理经 executor**：`{tool, arguments}` 转发真实三段名；解析后
   真名不存在 → 结构化错误、零分发。

**过程发现**（mock 保真度问题，非产品缺陷）：录制网关必须带 baseURL 属性
（G4 盖章从 client 内省读，通道键一致性依赖它）；stub executeMcpTool 须
镜像真实管理器的未知名报错。这也反向验证了断言的有效性。

**门禁**：core 套件 **1183 pass / 0 fail**（+5 例）；`npm run check` 全绿。
