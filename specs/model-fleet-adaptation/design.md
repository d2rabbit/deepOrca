# 模型舰队收官适配 — GLM5 / Kimi-K3 / MiniMax-M3 / Qwen-3.8（model-fleet-adaptation）

> **日期**：2026-08-21 立稿（未实施）；同日路线定稿
> **定位**：版本**收官计划**——harness 从 DeepSeek 单系列走向多模型系列深度适配。
> **最终系列名单（用户拍板 2026-08-21）**：**DeepSeek V4 系列（含当日新发布的 "version" 新 variant，确切 model 串实施时核对）**、**GLM 5 系列**、**Kimi 2.5 → K3 系列（全区间型号）** = P0；**MiniMax M3**、**Qwen 3.8** = P1。
> **协议范围**：**仅 OpenAI chat-completions 兼容格式**。Claude（Anthropic）消息格式与各家"新 reasoning 模式"（非 OpenAI-chat 形态的推理协议）**待定，不在本收官范围**（Backlog，见 §六）。
> **路线决策**：双后端方案（外部 agent 如 pi/San 承接非 DeepSeek 会话）**已否决**（2026-08-21）——主循环换后端 = 放弃权限/记忆/技能路由/计划模式全部差异化机制，且 UI 协议桥的工作量大于 G0 原生适配；外部 agent 逃生舱 action 亦不做。**按 G0 原生路线执行。**
> **原则**：本 spec 落在**真实适配面**上；各系列的具体 API 参数（思考开关参数名、上下文窗口、reasoning 字段名、工具调用格式差异）**实施时按厂商当日文档核填**，spec 只列"待核填点"，不臆造。

---

## 一、现状适配面盘点（代码证据）

DeepOrca 目前是 DeepSeek-only 调优，模型相关知识集中在以下位置——这就是全部改动面：

| # | 位置 | 现状 | 多系列问题 |
|---|---|---|---|
| A1 | `packages/core/src/common/model-capabilities.ts` | `DEEPSEEK_V4_MODELS` Set、`COMPACTION_MODEL`/`LIGHTWEIGHT_TASK_MODEL` **硬编码** `deepseek-v4-flash`、`NON_MULTIMODAL_MODELS`、`defaultsToThinkingMode`/`supportsMultimodal` | 新系列无处登记；**硬编码副模型是最大雷**：用户端点若是 GLM/Kimi-only，compaction/技能匹配/记忆抽取仍会调 deepseek-v4-flash → 直接 404 |
| A2 | `common/openai-thinking.ts`（`buildThinkingRequestOptions`） | DeepSeek 风格思考开关 | 各家思考协议不同（GLM/Kimi/Qwen/MiniMax 各有开关参数与默认值），需按 family 分派 |
| A3 | `common/openai-message-converter.ts:150` 附近 | `reasoning_content` 按 DeepSeek 契约处理 | 各家 reasoning 字段名/回显规则不同，需 per-family 转换 |
| A4 | `session.ts` 压缩阈值（`activeTokens` 检查：DeepSeek 512K / 其他 128K） | 二分法窗口假设 | 四个新系列窗口各异，需 per-model 表 |
| A5 | `common/llm-error.ts` | 错误分类"calibrated against DeepSeek/OpenAI-compatible error texts" | 新系列错误文案需要补充校准样本 |
| A6 | 端点体系（settings `endpoints[]` + `primaryEndpointId`/`secondaryEndpointId`/`visionEndpointId`） | **已是多端点结构**（每端点独立 baseURL/apiKey/model） | 基础好：适配 = 按"端点→模型家族"解析能力，不需要推翻设置模型 |
| A7 | 前缀缓存纪律（稳定 system 前缀、`getStableRuntimeContext` 字节稳定、日期拆 tail） | 按 DeepSeek prefix cache 设计 | 各家缓存机制不同但"稳定前缀"原则普适；逐系列核对缓存命中即可 |
| A8 | 桌面设置（model/secondaryModel/visionModel 为自由文本 + 端点选择） | 无硬编码模型清单 | 只需在能力表登记后自动生效；可选做常用模型下拉建议 |

## 二、通用改造（系列无关，先行）

### G1. 能力注册表化（重构 A1）

`model-capabilities.ts` 从散落常量改为**家族注册表**：

```ts
interface ModelFamilySpec {
  family: "deepseek" | "glm" | "kimi" | "minimax" | "qwen";
  models: Set<string>;              // 该系列已验证型号
  contextWindowTokens: number;      // 主力型号窗口（压缩阈值用）
  defaultsToThinking: boolean;
  multimodal: boolean;
  lightweightModel?: string;        // 该家族的 flash 等价物（compaction/技能匹配/记忆抽取）
  thinkingProtocol: "deepseek" | "glm" | "kimi" | "minimax" | "qwen"; // → A2 分派
  reasoningField: "reasoning_content" | string; // → A3 分派
}
```

- `defaultsToThinkingMode`/`supportsMultimodal` 改查注册表（保持现签名，调用点零改动）。
- **`COMPACTION_MODEL`/`LIGHTWEIGHT_TASK_MODEL` 从常量改为 `resolveLightweightModel(endpoint)`**：按当前会话端点的家族取该家族 lightweightModel；家族未登记或未配置时回退 `settings.secondaryModel`，再回退现状常量。这是 P0 中的 P0——不改这个，任何非 DeepSeek 端点的后台任务全部打崩。

### G2. 思考协议分派（A2）

`buildThinkingRequestOptions(thinkingEnabled, baseURL, model?)` 内部按注册表的 `thinkingProtocol` 分派到 per-family 请求参数构造；DeepSeek 分支保持现状字节不变（回归锁定）。

### G3. reasoning 消息转换分派（A3）

`openai-message-converter.ts` 的 thinking 消息配对/回显按 `reasoningField` 处理；DeepSeek 路径行为不变（现有 session 测试锁定）。

### G4. 压缩阈值 per-model（A4）

session.ts 的阈值判断改查 `contextWindowTokens`（`activeTokens > window * 0.85` 之类）；512K/128K 现值作为 deepseek 家族表项保留。

### G5. 错误分类扩充（A5）

为新系列补 llm-error 测试样本（各家限流/超载/内容过滤文案），分类函数按需增加模式。

### G6. 端到端接线核对

- 记忆管线（`@deeporca/memory`）副模型经 `settings.secondaryModel` 解析——G1 改造后同样按端点家族解析。
- 路由嵌入不受影响（本地 ONNX，与 LLM 厂商无关）。
- usage 统计按 model 字符串自然分桶，无需改。

## 三、各系列适配（每系列同一张验证清单）

> 优先级：**S0 DeepSeek V4 基线复核（含新 variant 登记）、S1 GLM5、S2 Kimi 2.5→K3（P0，先做）** → S3 MiniMax M3、S4 Qwen 3.8（P1）。
> **范围限定**：以下清单仅在 OpenAI chat 格式内核填；某系列若另推非-OpenAI-chat 的新 reasoning 协议，登记为 Backlog 不在本轮实现。

每个系列 = 注册表登记 + 按下表逐项核填（**参数以厂商当日 API 文档为准**）：

| 核填点 | 说明 |
|---|---|
| 型号清单 | 系列 内主力/轻量/多模态型号的确切 model 字符串 |
| 思考开关 | 开/关参数名与默认态（G2 的 per-family 构造） |
| reasoning 字段 | 流式/非流式下 reasoning 内容的字段名与回显规则（G3） |
| 工具调用 | tools/tool_calls 格式差异、并行调用支持、strict 模式兼容性 |
| 上下文窗口 | 主力型号窗口与输出上限 → G4 阈值表 |
| 多模态 | 图像输入支持与否 → 注册表 multimodal |
| 缓存对齐 | 该厂商 prompt 缓存机制核对（稳定前缀是否命中、计费口径） |
| 错误文案 | 限流/超载/内容过滤样本 → G5 |
| 真机 e2e | `desktop:startWin` + 该系列端点：会话创建→工具调用→权限门→compaction→记忆四链路（L1 抽取/工具回路/遥测）→跨会话召回 |

### S0 DeepSeek V4 基线复核（P0）
基线家族按现值入表即可，另核对**当日新发布的 "version" variant**：确切 model 字符串 / 窗口 / 思考默认 / 多模态 / 轻量等价物，补入 deepseek 家族表项。

### S1 GLM 5 系列（P0）
### S2 Kimi 2.5 → K3 系列（P0，全区间：2.5 / 3 / K3 型号一并登记）
### S3 MiniMax M3 系列（P1）
### S4 Qwen 3.8 系列（P1）

（五系列共用上述清单，差异只在核填结果；实施时每系列在 tasks.md 勾选留痕。）

## 四、实施顺序与工作量

| 阶段 | 内容 | 估时 |
|---|---|---|
| G0 通用改造 | G1-G5 + 回归（DeepSeek 行为字节不变） | 1.5-2 天 |
| P0 双系列 | S1 GLM5 + S2 Kimi K3（登记+核填+真机 e2e 各一轮） | 1-1.5 天 |
| P1 双系列 | S3 MiniMax M3 + S4 Qwen 3.8 | 1 天 |
| 收官核对 | 全系列回归 + 门禁 + 文档（README 模型支持表/CHANGELOG） | 0.5 天 |

合计 **4-5 天**。

## 五、验收

- 任一系列端点配置后：主循环、思考模式、工具调用、compaction、技能匹配、记忆四链路全部正常，**后台任务不再出现跨厂商硬编码调用**。
- DeepSeek 现有行为回归零变化（现有测试 + 新增家族表回归锁定）。
- `npm run check && npm test` 全绿；每系列留真机 e2e 记录（tasks.md 勾选）。

## 六、不做（Non-goals）

- **Claude（Anthropic）消息格式**与各家非-OpenAI-chat 的"新 reasoning 模式"协议——**待定 Backlog**，需另行立项，不在本收官范围。
- **双后端 / 外部 agent 承接**——已否决（2026-08-21，理由见头部路线决策），留档不排期。
- 不做厂商专有增值特性（如各家的 context caching API 显式管理、batch 接口）——只做 harness 兼容适配。
- 不做模型自动选择/智能路由（家族解析只服务能力查询，不改变用户显式选型）。
- 不改嵌入（本地 Granite，与厂商无关）；不引入厂商 SDK（保持裸 OpenAI 兼容 client）。
