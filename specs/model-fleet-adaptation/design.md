# 模型舰队收官适配 — GLM5 / Kimi-K3 / MiniMax-M3 / Qwen-3.8（model-fleet-adaptation）

> **日期**：2026-08-21 立稿（未实施）；同日路线定稿；**同日深化：§二 抽象设计详案落盘（基于现状代码逐点调研，本稿为实施基准）**，并补 [requirements.md](./requirements.md)。**同日实施 G0 通用改造 + S0 DeepSeek 基线登记**（命令行门禁全绿，留痕见 [tasks.md](./tasks.md)；真机 e2e 待桌面环境）。
> **2026-09-17 吸收合并 + 移区**：独立立项的 [ai-sdk-experimental-adapter](./ai-sdk-experimental-adapter/design.md)（实验性 AI SDK 传输线，同日用户拍板三项：① 保留 DeepSeek 专属优化 ② 引入实验性 SDK 适配 ③ 持久化转译不迁移）并入本 spec 为 **§七 / X 系列任务**（requirements 增 R9–R12），工件保留于 `./ai-sdk-experimental-adapter/`；本 spec 同日自 `next-version/` 规划区 **git mv 至活跃区**（转入当前版本实施序列）。上游调研（含 `@ai-sdk/openai-compatible` dist 源码级契约实证）：[models.dev × AI SDK prestudy](../../docs/research/2026-09-17-models-dev-ai-sdk-prestudy.md)。
> **2026-09-17 二次拍板（范围重构）**：**除已适配的 deepseek 与 stepfun 外，S1–S4（GLM5 / Kimi-K3 / MiniMax-M3 / Qwen-3.8）原生登记路线取消，全部转入 X 系列承接（X4）；后续所有新模型一律依托 X 线接入**（models.dev 数据增强 + 实验通道验证清单）。注册表原生登记仅保留 deepseek/stepfun 两家族与「实证语义缺口」例外（须拍板）；X 线定位由实验性旁挂升级为**新模型接入的正式路径**——其中传输通道本身仍保持实验性默认关（拍板②不变），数据轨 X3 与接入 SOP X4 为正式机制。
> **定位**：版本**收官计划**——harness 从 DeepSeek 单系列走向多模型系列深度适配。
> **最终系列名单（用户拍板 2026-08-21）**：**DeepSeek V4 系列（含当日新发布的 "version" 新 variant，确切 model 串实施时核对）**、**GLM 5 系列**、**Kimi 2.5 → K3 系列（全区间型号）** = P0；**MiniMax M3**、**Qwen 3.8** = P1。**（2026-09-17 修订：后四系列不再原生登记，转 X4 经 X 线接入；优先级序保留在 X4 内——GLM/Kimi 先、MiniMax/Qwen 后。）**
> **协议范围**：**仅 OpenAI chat-completions 兼容格式**。Claude（Anthropic）消息格式与各家"新 reasoning 模式"（非 OpenAI-chat 形态的推理协议）**待定，不在本收官范围**（Backlog，见 §六）。
> **路线决策**：双后端方案（外部 agent 如 pi/San 承接非 DeepSeek 会话）**已否决**（2026-08-21）——主循环换后端 = 放弃权限/记忆/技能路由/计划模式全部差异化机制，且 UI 协议桥的工作量大于 G0 原生适配；外部 agent 逃生舱 action 亦不做。**按 G0 原生路线执行。**
> **原则**：本 spec 落在**真实适配面**上；各系列的具体 API 参数（思考开关参数名、上下文窗口、reasoning 字段名、工具调用格式差异）**实施时按厂商当日文档核填**，spec 只列"待核填点"，不臆造。

---

## 一、现状适配面盘点（代码证据）

DeepOrca 目前是 DeepSeek-only 调优，模型相关知识集中在以下位置——这就是全部改动面：

| # | 位置 | 现状 | 多系列问题 |
|---|---|---|---|
| A1 | `packages/core/src/common/model-capabilities.ts` | `DEEPSEEK_V4_MODELS` Set、`COMPACTION_MODEL`/`LIGHTWEIGHT_TASK_MODEL` **硬编码** `deepseek-v4-flash`、`NON_MULTIMODAL_MODELS`、`defaultsToThinkingMode`/`supportsMultimodal` | 新系列无处登记；**硬编码副模型是最大雷**：用户端点若是 GLM/Kimi-only，compaction/技能匹配/记忆抽取仍会调 deepseek-v4-flash → 直接 404 |
| A2 | `common/openai-thinking.ts`（`buildThinkingRequestOptions`） | 单一思考开关形状（`_baseURL` 参数已预留未用——现成接缝） | 各家思考协议不同（GLM/Kimi/Qwen/MiniMax 各有开关参数与默认值），需按 family 分派 |
| A3 | `common/openai-message-converter.ts:148-156` | `reasoning_content` 按 DeepSeek 契约回显空串 | 各家 reasoning 字段名/回显规则不同，需 per-family 转换 |
| A4 | `session.ts:243,266` 压缩阈值（`DEEPSEEK_V4_COMPACT_PROMPT_TOKEN_THRESHOLD` 512K / 其他 128K 二分） | 二分法窗口假设 | 四个新系列窗口各异，需 per-model 表 |
| A5 | `common/llm-error.ts` | 错误分类"calibrated against DeepSeek/OpenAI-compatible error texts"（结构化字段 status/code/type 为主，已较厂商中立） | 新系列错误文案需要补充校准样本 |
| A6 | 端点体系（settings `endpoints[]` + `primaryEndpointId`/`secondaryEndpointId`/`visionEndpointId`；`EndpointConfig.models?: ModelRegistration[]` 已带 `thinking`/`vision` 用户声明） | **已是多端点结构**（每端点独立 baseURL/apiKey/models） | 基础好：适配 = 按"端点→模型家族"解析能力，不需要推翻设置模型 |
| A7 | 前缀缓存纪律（稳定 system 前缀、`getStableRuntimeContext` 字节稳定、日期拆 tail） | 按 DeepSeek prefix cache 设计 | 各家缓存机制不同但"稳定前缀"原则普适；逐系列核对缓存命中即可 |
| A8 | 桌面设置（model/secondaryModel/visionModel 为自由文本 + 端点选择） | 无硬编码模型清单 | 只需在能力表登记后自动生效；可选做常用模型下拉建议 |
| A9 | **渲染层复制副本**：`desktop/src/renderer/lib/model-utils.ts:20-64` 与 `token-usage.ts:94-98` 各自复制了 `DEEPSEEK_V4_MODELS`/`NON_MULTIMODAL_MODELS`/窗口阈值（注释言明为避免从 core 拖入 Node 内置） | 双副本与 core 手工同步 | 注册表化后必须收敛为单一事实源，否则家族表加新系列时渲染层静默漂移 |
| A10 | `common/openai-client.ts`：`createSecondaryClient()` 已实现但**无生产调用方**（注释言明 reserved）；`secondaryModel/secondaryEndpointId` 设置已解析未接线 | 保留态基础设施 | 后台任务选型链可直接启用它作为"用户显式副模型"一环 |

## 二、抽象设计详案（深化稿，实施基准）

### 2.0 设计目标与检验（深模块口径）

本改造的实质是**把散落在 ≥6 个文件的 per-厂商知识，收敛为一个深模块**：

- **Module**：`common/model-capabilities.ts`（重塑）——家族注册表 + 能力解析。文件名不变 = 接缝位置不动，现有 import 路径零 churn。
- **Interface**（调用方需要知道的一切）：`resolveModelSpec({ model, baseURL? }) → ModelSpec` 一个解析函数 + 三个门面函数（签名与今天完全相同）+ `createBackgroundClient()`。不变量：解析是纯函数（无 IO、无状态）；未知模型 fail-open 到保守默认（R2）。
- **Depth**：一个解析入口背后隐藏三层合并——精确型号覆盖 → 家族 pattern 匹配 → baseURL host 提示 → 未知默认。调用方每学 1 个函数，获得全部家族维度的能力查询。
- **Seam**：① session.ts 的 5 个后台任务调用点；② `openai-thinking.ts` 的请求构造；③ message-converter 的 reasoning 回显。三处接缝背后换实现，调用形状不变。
- **Adapters**：注册表条目（deepseek/glm/kimi/minimax/qwen/unknown 六条）+ per-family 思考参数构造器表。
- **Leverage / Locality**：新增系列 = 1 条表项 + 1 张验证清单，5 个调用点 + 2 处渲染副本零改动；今天加一个系列要同步改 ≥4 文件常量，之后只改表。
- **删除测试**：删掉注册表 → pattern 匹配、覆盖合并、回退链的复杂度将在 5 个调用点 + 2 个渲染文件里各自重现实 → 非透传，模块成立。
- **依赖方向**（硬约束）：`openai-client.ts → model-capabilities.ts`（纯）成立；`model-capabilities.ts` **不得** import openai-client/undici/Node 内置——它要同时进 renderer bundle（R7）。

### 2.1 唯一事实源：家族注册表（重塑 A1，对应 R1/R2/R8）

`model-capabilities.ts` 从 32 行常量改为注册表 + 解析：

```ts
export type ModelFamilyId = "deepseek" | "glm" | "kimi" | "minimax" | "qwen" | "unknown";
export type ReasoningReplayMode = "empty-field" | "omit" | "content";   // DeepSeek = empty-field（现行为）
export type ThinkingProtocolId = ModelFamilyId;                          // → §2.4 builder 表的键

export type ModelFamilySpec = {
  id: ModelFamilyId;
  modelPatterns: RegExp[];        // model 串 → 家族（主解析规则，如 /^deepseek-/、/^glm-/i）
  baseURLHostHints?: RegExp[];    // baseURL host → 家族（辅解析：model 未命中时的聚合网关兜底）
  contextWindowTokens: number;    // 家族默认窗口 → 压缩阈值（§2.6）
  defaultsToThinking: boolean;
  multimodal: boolean;
  lightweightModel?: string;      // 家族 flash 等价物（后台任务，§2.3）
  thinkingProtocol: ThinkingProtocolId;
  reasoningField: string;         // 流式读取/持久化字段（§2.5）；deepseek = "reasoning_content"
  reasoningReadFields: string[];  // 读取回退序列；现值 ["reasoning_content", "reasoning"] 全家族保持
  reasoningReplay: ReasoningReplayMode;
};

// 家族内 per-variant 差异（如 Kimi 2.5 与 K3 窗口不同）：精确 model 串 → 部分覆盖
const MODEL_OVERRIDES: Record<string, Partial<ModelFamilySpec> & { family: ModelFamilyId }> = { ... };

export type ModelSpec = ModelFamilySpec & { model: string; familyResolved: boolean };
export function resolveModelSpec(input: { model: string; baseURL?: string }): ModelSpec;
```

**解析算法（4 步，纯函数）**：

1. `MODEL_OVERRIDES[model]` 精确命中 → 覆盖值合并进所属家族条目；
2. 各家族 `modelPatterns` 逐条匹配 model 串 → 家族默认 spec；
3. 仍未命中且给了 `baseURL` → `baseURLHostHints` 按 host 提示解析（聚合网关上一条 baseURL 服务多家族，故只作兜底不作主判）；
4. 落入 **UNKNOWN spec**——保守默认必须与今天未知模型的行为**逐项等价**：`defaultsToThinking: false`（今天非 V4 即 false）、`multimodal: true`（今天 `supportsMultimodal` 对未登记模型返回 true）、`contextWindowTokens: 128K`、思考请求体维持现状形状、reasoning 双字段读取。UNKNOWN 是一等注册表条目而非隐式 else——它把"现状语义"显式文档化并锁定进测试（R2）。

**门面（签名不变，调用点零改动）**：

- `defaultsToThinkingMode(model)` / `supportsMultimodal(model)` 内部改查 `resolveModelSpec`；
- `getCompactPromptTokenThreshold(model)` 从 `session.ts:266` **迁入本模块**（session.ts 改 import）——阈值知识归位注册表；
- `DEEPSEEK_V4_MODELS` / `NON_MULTIMODAL_MODELS` / `COMPACTION_MODEL` / `LIGHTWEIGHT_TASK_MODEL` 常量删除（`index.ts:297` 的 re-export 同步清理）；deepseek 家族条目按现值登记，`lightweightModel: "deepseek-v4-flash"` 即原两常量的等价物。

### 2.2 用户登记 × 家族表：合并优先级（对应 R5）

现状已有两层模型知识，改造后合并规则为：

```
最终能力 = 家族表（厂商知识：默认思考/多模态/窗口/协议/轻量等价物）
         ⊕ 端点 models[] 登记（用户声明：ModelRegistration.thinking / vision）
用户显式登记存在 → 覆盖对应布尔位（网关可能阉割或增强了能力）；
未登记字段 → 回退家族表；两者皆无 → UNKNOWN 保守默认。
```

实现位置：`resolveModelSpec` 保持纯函数（不读 settings），合并入口放在调用侧已有的 settings 读取点（如 message-converter 已持有 model + 可传入登记位；`supportsMultimodal` 门面加一个可选 `registration?: {thinking?: boolean; vision?: boolean}` 参数，默认行为不变）。**不把 settings 依赖渗进注册表模块**——保持其可进 renderer bundle。

### 2.3 后台任务选型：`createBackgroundClient()`（G1.2 深化，对应 R3/R4，P0 中的 P0）

**位置（实施落点）**：纯决策函数 `resolveBackgroundLlm()` 落在注册表模块（零依赖、可测）；组合层为 SessionManager 私有方法 `createBackgroundLlm()`——经既有 `createOpenAIClient` 注入缝取主 client、经新增可注入 `createSecondaryClient`（默认接 `openai-client.ts` 保留设施）取副 client，端点/副模型信息来自注入的 `getResolvedSettings`。注册表解析依赖方向合法（session → 纯注册表），且测试可全量注入假件。

**回退链（设计更正：尾环从立稿的"现常量"改为"主会话模型"）**：

```
createBackgroundClient(projectRoot):
  spec = resolveModelSpec({ model: 主会话 model, baseURL: 主端点 baseURL })
  ① spec.lightweightModel 存在，且主端点 models[] 清单未排除它（无清单视为不约束）
       → { client: 主 client,  model: spec.lightweightModel }
  ①' 跨端点动态激活（2026-08-21 补）：lightweight 未在主端点，但其他已配置端点
     （有 apiKey 且登记 models[]——如内置 opencode-zen / opencode-go 预设分开
     登记 flash 与 pro）的登记表命中它
       → { client: createEndpointClient(该端点), model: spec.lightweightModel }
  ② settings.secondaryModel 已配置且 secondary client 可建（有 apiKey）
       → { client: secondary client, model: settings.secondaryModel }   ← 首次接线 A10 保留设施
  ③ { client: 主 client, model: 主会话 model }   ← 安全尾：主模型必然被端点服务
```

更正理由：立稿尾环"回退现常量 deepseek-v4-flash"在非 DeepSeek 端点上是**必然 404**；改为主会话模型后尾环永远可服务。**DeepSeek 端点行为零变化**——它在 ① 即解析为 `deepseek-v4-flash`，与现常量逐字节等值（R4 成立）。`createSecondaryClient` 由此获得其第一个生产调用方，注意其头部"reserved, no production caller"注释同步更新。

**五个调用点切换表**（session.ts，每处 2 行改动：取 client 的解构 + 硬编码 model 行 → 一次 `createBackgroundClient()` 调用）：

| 调用点 | 函数 | 现状 |
|---|---|---|
| `session.ts:1276` | `judgeViaLlm`（动作分类） | `createOpenAIClient()` + `LIGHTWEIGHT_TASK_MODEL` |
| `session.ts:1513` | `createSkillDecomposer`（技能分解） | 同上 |
| `session.ts:2279` | `identifyMatchingSkillNames`（技能匹配） | 同上 |
| `session.ts:2456` | `enhancePrompt`（提示增强） | 同上 |
| `session.ts:3823` | `compactSession`（压缩） | `createOpenAIClient()` + `COMPACTION_MODEL` |

记忆管线（`@deeporca/memory`）副模型经 `settings.secondaryModel` 解析——链路 ② 天然兼容；其抽取调用若另有硬编码，实施时按同一链切换（核对点，见 tasks G1.5）。

### 2.4 思考协议分派（G2 详案，对应 R6/R4）

`buildThinkingRequestOptions(thinkingEnabled, baseURL?, reasoningEffort?)` **加第 4 个可选参 `model?: string`**（`_baseURL` 形参本就预留未用，接缝现成）。内部：

```
spec = resolveModelSpec({ model, baseURL })
builder = THINKING_BUILDERS[spec.thinkingProtocol]   // per-family 请求参数构造器表
return builder(thinkingEnabled, reasoningEffort)
```

- `deepseek` 条目返回**与今天完全相同的对象**（golden 测试锁字节，R4）；
- `unknown` 条目同样返回今天的形状——**只有新登记家族才允许偏离现状**，这是全改造的兼容总纲；
- glm/kimi/minimax/qwen 条目形状**实施时按厂商当日文档核填**（S1–S4 清单逐项留痕）。

**effort 等级映射方案（2026-08-23 三次定稿，G2b/G2c）**：独立常量文件 **`common/think-level.ts`** 承载统一刻度与各家族映射——统一五档刻度 `low / medium / high / xhigh / max`（UI 与 settings 全程只存统一档）。**菜单档位按家族真实能力派生**（`familyThinkLevels(familyId)`，2026-08-23）：deepseek 家族实际服务 `low/high/max` 三档（medium 服务端折叠为 high，**菜单不展示"中"档**），未登记家族回退通用可见刻度（low/medium/high，极高/至高默认隐藏、settings/env 仍合法）。**DeepSeek V4 家族映射**按官方 thinking_mode 的请求→生效表登记：`low→low、medium→high、high→high、xhigh→high、max→max`。未登记家族走恒等透传。新家族适配 = 在 `THINK_LEVEL_FAMILY_MAPS` 加请求映射 + 在 `THINK_LEVELS_BY_FAMILY` 登记真实档位，零调用方改动；UI 选项由家族档位派生。CJK 标签为纯本地化档名（不带英文括注；en 目录即英文档名）。

### 2.5 reasoning 消息转换分派（G3 详案，对应 R6/R4）

converter 的 `convertMessage(message, thinkingEnabled, model)` **本就持有 model**——分派无需改签名，内部 `resolveModelSpec(model)` 后按三档处理：

| `reasoningReplay` | 行为 | 归属 |
|---|---|---|
| `empty-field` | 回显 `spec.reasoningField = ""`（今天 `openai-message-converter.ts:155` 的行为） | DeepSeek（契约要求字段在场但内容不上传） |
| `omit` | 不添加该字段 | 待厂商核填（部分兼容端点拒绝未知字段） |
| `content` | 回显持久化的 reasoning 内容 | 待厂商核填（要求回传思考的协议） |

读取侧（`session.ts:2091` 流式 delta）：`spec.reasoningReadFields` 按序回退——现值 `["reasoning_content", "reasoning"]` 保持全家族不变，新家族核填时若字段不同则改表不改代码。持久化字段名（`session.ts:5000`）同步用 `spec.reasoningField`（deepseek 值不变 → 存量会话文件兼容）。

### 2.6 压缩阈值 per-model（G4 详案，对应 R1/R4）

`getCompactPromptTokenThreshold(model)` 迁入注册表模块后改查 `spec.contextWindowTokens`：deepseek 家族 512K、unknown 128K（均现值），其余四家族核填入表。**阈值语义保持"满窗口触发"**（今天 `activeTokens > threshold` 的语义），"×0.85 提前量"留作后续独立调参，本轮不改（零回归原则）。

**用户自定义（2026-08-21 补）**：`settings.compactTokenThreshold`（正整数 tokens）在两处阈值检查点（主循环触发判断 + compactSession Stage-A 跳过判断）优先于注册表值——解析链 env `DEEPORCA_COMPACT_TOKEN_THRESHOLD` → project → user，非法值忽略、未设回退注册表按模型默认；设置面板提供输入项（temperature 同款保存路径），TopBar 用量条与 ContextProgress 进度计同步按覆盖值渲染。

### 2.7 错误分类扩充（G5，对应 R6）

`llm-error.ts` 分类以结构化字段（status/code/type）为主，本就较厂商中立——改造限于：新系列限流/超载/内容过滤文案样本进测试，模式按需增补。不动分类框架。

### 2.8 渲染层单一事实源（G6 详案，新增，对应 R7）

- `packages/core/package.json` 的 `exports` 新增零依赖子路径：`"./capabilities": { types: "./dist/common/model-capabilities.d.ts", import: "./dist/common/model-capabilities.js" }`（`scripts/rewrite-esm-imports.js` 已覆盖 dist 扩展名修补）；
- `renderer/lib/model-utils.ts` 与 `token-usage.ts` 删除各自复制的 `DEEPSEEK_V4_MODELS`/`NON_MULTIMODAL_MODELS`/窗口阈值，改 `import ... from "@deeporca/core/capabilities"`——该模块零 import，可安全进 browser bundle（渲染层当年复制常量的唯一理由"避免拖入 Node 内置"就此消除）；
- 验证点：`desktop:build` 后检查 renderer 产物无 `node:` 内置引用；`token-usage.ts:94-98` 的窗口阈值函数与 `model-utils.ts:63-64` 的 thinking/vision 推断全部改走门面。

### 2.9 测试策略（接口即测试面）

| 层 | 内容 | 锁定 |
|---|---|---|
| 解析矩阵（新增单测） | model 串 → 家族逐家族用例；精确覆盖优先级；baseURL 兜底；UNKNOWN 默认值逐项断言 | R1/R2/R5 |
| DeepSeek golden 回归 | `buildThinkingRequestOptions`/converter 回显/阈值/后台 model 选择，重构前后输出逐字节比对 | R4 |
| 门面等价测试 | 现有 `DEEPSEEK_V4_MODELS`/`NON_MULTIMODAL_MODELS` 全体成员重构前后 `defaultsToThinkingMode`/`supportsMultimodal` 输出相等 | R4 |
| 跨厂商冒烟 | GLM-only 端点 fixture → `createBackgroundClient` 全链不出现 deepseek 字符串（generation-log 断言） | R3 |
| 回退链单测 | ①命中/清单排除/②secondary 配置/③安全尾 三环独立用例 | R3 |
| 系列真机 e2e | §三 清单逐系列（会话→工具→权限→compaction→记忆四链路→跨会话召回） | R1–R6 |

### 2.10 文件改动地图

| 文件 | 改动 | 需求 |
|---|---|---|
| `core/src/common/model-capabilities.ts` | 常量 → 注册表 + `resolveModelSpec` + 门面 + 迁入阈值函数（零依赖约束） | R1/R2/R8 |
| `core/src/common/openai-client.ts` | 新增 `createBackgroundClient()` 回退链工厂；接线 secondary | R3/R4 |
| `core/src/common/openai-thinking.ts` | +`model?` 参，per-family builder 表分派 | R6/R4 |
| `core/src/common/openai-message-converter.ts` | reasoning 回显按 `reasoningReplay`/`reasoningField` 分派 | R6/R4 |
| `core/src/session.ts` | 5 调用点切 `createBackgroundClient`；阈值改 import；流式读取走 `reasoningReadFields` | R3/R4 |
| `core/src/index.ts` | 清理 `COMPACTION_MODEL` re-export，导出新解析接口 | R1 |
| `core/package.json` | `exports` 增 `"./capabilities"` 子路径 | R7 |
| `desktop/src/renderer/lib/model-utils.ts` / `token-usage.ts` | 删副本常量，改从 `@deeporca/core/capabilities` 导入 | R7 |
| `@deeporca/memory` 副模型调用（如另有硬编码） | 按 §2.3 链核对切换 | R3 |

## 三、各系列适配（每系列同一张验证清单）

> 优先级：**S0 DeepSeek V4 基线复核（含新 variant 登记）、S1 GLM5、S2 Kimi 2.5→K3（P0，先做）** → S3 MiniMax M3、S4 Qwen 3.8（P1）。
> **范围限定**：以下清单仅在 OpenAI chat 格式内核填；某系列若另推非-OpenAI-chat 的新 reasoning 协议，登记为 Backlog 不在本轮实现。

每个系列 = 注册表登记 + 按下表逐项核填（**参数以厂商当日 API 文档为准**）：

| 核填点 | 说明 |
|---|---|
| 型号清单 | 系列 内主力/轻量/多模态型号的确切 model 字符串（家族 `modelPatterns` + `MODEL_OVERRIDES` 条目） |
| 思考开关 | 开/关参数名与默认态（§2.4 builder 表该家族条目） |
| reasoning 字段 | 流式/非流式下 reasoning 内容的字段名与回显规则（`reasoningField`/`reasoningReplay`/`reasoningReadFields`） |
| 工具调用 | tools/tool_calls 格式差异、并行调用支持、strict 模式兼容性 |
| 上下文窗口 | 主力型号窗口与输出上限 → 家族表 + 覆盖表 |
| 多模态 | 图像输入支持与否 → 注册表 multimodal |
| 缓存对齐 | 该厂商 prompt 缓存机制核对（稳定前缀是否命中、计费口径） |
| 错误文案 | 限流/超载/内容过滤样本 → G5 |
| 真机 e2e | `desktop:startWin` + 该系列端点：会话创建→工具调用→权限门→compaction→记忆四链路（L1 抽取/工具回路/遥测）→跨会话召回 |

### S0 DeepSeek V4 基线复核（P0）✅ 2026-08-21 已实施
家族登记**三模型**（官方 pricing 页核对）：`deepseek-v4-flash` / `deepseek-v4-pro` / `deepseek-v4-flash-vision-exp`（图像理解实验版，**多模态**、思考默认开、1M 窗口——压缩阈值维持产品 512K 既有值）；`deepseek-chat`/`deepseek-reasoner` 已停用但保留 override 兼容存量设置。跨端点激活（flash 与 pro 分布于 opencode-zen / opencode-go 等不同端点）见 §2.3 环①'。

### S1–S4 GLM5 / Kimi-K3 / MiniMax-M3 / Qwen-3.8 —— 已转 X4（2026-09-17 二次拍板）

四系列**不再走注册表原生登记**（原 S1–S4 取消），转入 **X4「新系列经 X 线接入」**（§七）。上表验证清单保留为 X4 逐系列核对表，但「注册表登记 + 思考开关 builder 条目」两项替换为：**models.dev 目录覆盖核对**（型号串 / 窗口 / 输出上限 / 多模态 / 工具调用 / 价格 / reasoning `interleaved` 字段）+ **X 通道真机验证**；reasoning 解析依赖 UNKNOWN 默认（`reasoning_content ?? reasoning` 双字段，openai-compatible 原生同构——调研 §3.3 实证）。仅当发现**实证语义缺口**（厂商契约与 UNKNOWN 默认不兼容，如 deepseek 式 replay 强制）才提请拍板补注册表条目（escape hatch）。

## 四、实施顺序与工作量

| 阶段 | 内容 | 估时 |
|---|---|---|
| G0 通用改造 | §2.1–2.8 + 测试三层（解析矩阵/golden/门面等价）+ DeepSeek 全量回归（**零行为变化是硬门**） | 2-2.5 天 ✅ 已落地 |
| ~~P0/P1 双系列~~ | ~~S1–S4 原生登记~~ **已取消（2026-09-17 转 X4）** | — |
| X0–X2 实验传输线 | §七（port 类型 + 转译层 + 传输层 + 电池 B1–B7） | 4–5 天 + 真机半天 |
| X3 数据轨 | §七 models.dev 三消费点（vendor + catalog + 建议源/费用估算）；二次拍板后升为 **X4 前置**，原则上不再否决 | 2–3 天 |
| X4 新系列接入 | §七 X4：GLM5 / Kimi-K3（先）+ MiniMax-M3 / Qwen-3.8（后）逐系列 X 线验证（X3 为前置） | 1.5–2.5 天 |
| 收官核对 | X4 各系列回归 + 门禁 + 文档（README 模型支持表/CHANGELOG） | 0.5 天 |

G 线剩余（G2c/G5 收窄项 + G8.b 真机回归 + 收官核对）≈ 1–1.5 天；**X 线合计 8–10.5 天**（传输线 + 数据轨 + X4，含真机）。S1–S4 原生登记取消后，新模型接入成本从「每家族一条注册表条目 + builder 核填」降为「X4 验证清单一轮」。

## 五、验收

对齐 [requirements.md](./requirements.md) R1–R13：

- 任一系列端点配置后：主循环、思考模式、工具调用、compaction、技能匹配、记忆四链路全部正常，**后台任务不再出现跨厂商硬编码调用**（R3）。
- DeepSeek 现有行为回归零变化：golden + 门面等价 + 现有 session 测试全绿（R4）。
- 未知模型 fail-open 行为与今天逐项一致（R2）。
- 渲染层无复制模型集合，能力标记随注册表自动生效（R7）。
- 实验传输线：未开启时行为与现通道逐字节一致（R9）；开启时持久化形状不变（R10）、语义唯一来源既有模块（R11）；数据轨任何缺失/损坏回退现状且不进语义层（R12）。
- 新模型接入：非原生登记家族（GLM / Kimi / MiniMax / Qwen 及未来全部新厂商）一律经 X4 SOP 接入（目录核对 + 通道验证），注册表原生条目仅 deepseek/stepfun 与实证拍板的语义缺口例外（R13）。
- `npm run check && npm test` 全绿；每系列留真机 e2e 记录（tasks.md 勾选）。

## 六、不做（Non-goals）

- **Claude（Anthropic）消息格式**与各家非-OpenAI-chat 的"新 reasoning 模式"协议——**待定 Backlog**，需另行立项，不在本收官范围。
- **双后端 / 外部 agent 承接**——已否决（2026-08-21，理由见头部路线决策），留档不排期。
- 不做厂商专有增值特性（如各家的 context caching API 显式管理、batch 接口）——只做 harness 兼容适配。
- 不做模型自动选择/智能路由（家族解析只服务能力查询，不改变用户显式选型）。
- 不改嵌入（本地 Granite，与厂商无关）；不引入 per-厂商官方 SDK。~~不引入厂商 SDK（保持裸 OpenAI 兼容 client）~~ **2026-09-17 修订**：Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible`，非厂商绑定的统一传输层）作为**实验性第二传输通道**例外引入（§七，exact-pin、默认关、只动传输层）——语义层（注册表/协议分派/本地计量）仍 100% 自有。
- 实验传输线的**全量切换**（退役 openai 通道）不在本 spec 首期——触发前提见 §七 C 段。

## 七、实验性 AI SDK 传输线（2026-09-17 吸收合并，X 系列任务）

> 完整设计、红线论据与电池细则见工件 [./ai-sdk-experimental-adapter/design.md](./ai-sdk-experimental-adapter/design.md)；本节为**实施基准摘要**。
> **实施状态（2026-09-17）**：X0–X3 代码面**全量落地**（`common/llm-transport.ts` port 类型、`common/model-message-adapter.ts` 转译层、`common/ai-sdk-transport.ts` 合成通道、settings 开关 + IPC + 面板 + i18n×6、`common/model-catalog.ts` + vendor 脚本实拉 220 providers/7842 models + 三消费点）；电池 B1–B3/B5/B6 fixture 全绿（含 off/on 分流端到端断言与 mutation-check），B4/B7 真机清单与 X4 接入 SOP 成文（[x-battery-manual.md](./x-battery-manual.md) / [x4-onboarding-sop.md](./x4-onboarding-sop.md)），真机执行待排期。门禁全绿（typecheck/lint/format/license/test core 1010 例/desktop:build）。

**三项拍板（2026-09-17，用户）**：① 保留 DeepSeek 专属优化与适配（SDK 路径不得绕开）；② 引入实验性 SDK 适配能力（默认关）；③ 持久化走边界转译、不迁移存储。

**五红线**：L1 家族语义权威性（本地计量 / reasoning 回放 / thinking 信封 / dirge 兜捞 / 多模态门控 / turn-tail 前缀纪律全部留在既有模块，通道**只消费、不复制、不旁路、不弱化**）；L2 持久化形状不变（`messageParams` 继续 OpenAI wire 形状，存量会话/索引/ledger 零改动）；L3 默认关闭（关态行为逐字节一致）；L4 `ai` + `@ai-sdk/openai-compatible` **exact-pin**（不引 `@ai-sdk/deepseek`）；L5 core UI-free / vendor 注入红线照旧。

**架构**（咽喉点 `createChatCompletionStream` 入口分流 ~10 行；off = 现通道零改动）：

- **port 类型** `common/llm-transport.ts`（type-only）——机制抽象落位，与 §2.0 注册表（语义抽象）分界：**注册表"指名"、port "定形"、通道"做事"**。不进 capabilities 子路径，不被注册表 import；两通道同 port 签名（`satisfies` 断言）。
- **转译层** `common/model-message-adapter.ts`（纯函数）：OpenAI ↔ ModelMessage 双向。出向 assistant `reasoning_content` → reasoning part 是**回放链第一跳**（openai-compatible 转换器 dist 实证：有则携带 `reasoning_content`、无则省键——与 deepseek 家族 `reasoningReplay: "content"` 契约一致，见 §2.5）；turn-tail 在转换前对 OpenAI 形状执行（前缀字节稳定性不受转换器实现影响）。
- **传输层** `common/ai-sdk-transport.ts`：`createOpenAICompatible`（undici Agent 经 `fetch` 注入 / `includeUsage` / metadataExtractor 骨架，`apiKey::baseURL` 工厂缓存）+ `streamText` fullStream 归约（语义对齐 `session-manager-base.ts:915-1304`：content/reasoning/refusal/工具缝合/最终消息重组/`onDelta` 透传）。thinking 信封经 providerOptions 透传（`extra_body` 嵌套保真是电池 B4 实测项，失真退路 `transformRequestBody`）；**本地计量继续对转换前 OpenAI 形状计数**（`countRequestPayloadTokens` 零改动——转译不迁移的直接红利）。
- **开关**：`settings.experimentalSdkTransport` 默认 false（env → project → user；项目文件开启项检疫忽略）；设置面板「实验」分区 + i18n ×6。
- **数据轨（X3，X4 前置）**：models.dev（MIT，220 provider/7843 模型）vendor `api.json` + `common/model-catalog.ts`（host 注入、零依赖、fail-open）三消费点——未登记模型 fail-open 增强 / 设置面板建议源与规格预填 / 费用估算乘数（本地 token 计数唯一统计源政策不变）。**目录数据不进家族语义层**（与 §2.1 手工核填原则对齐）。二次拍板后 X3 为 X4 的前置（原则上不再否决，仅技术证伪可砍——砍则 X4 回退手工清单核对）。
- **X4 新系列经 X 线接入（承接原 S1–S4，2026-09-17 二次拍板）**：GLM5 / Kimi-K3（先）、MiniMax-M3 / Qwen-3.8（后）及**后续全部新模型**的正式接入路径——① models.dev 目录覆盖核对（型号串/窗口/输出上限/多模态/工具调用/价格/reasoning `interleaved`）；② X 通道真机验证清单（§三 表保留：工具调用/缓存对齐/错误样本/e2e 四链路）；③ 能力默认经 UNKNOWN + catalog 数据增强（X3.2），reasoning 依赖双字段默认，effort 走 UNKNOWN 恒等透传；④ **escape hatch**：仅实证语义缺口（厂商契约与 UNKNOWN 默认不兼容）才提请拍板加注册表条目。X4 使 X 线从实验性旁挂升级为**新模型接入的正式路径**（传输通道本身仍默认关，拍板②不变）。

**电池 B1–B7（出口判据）**：B1 转译往返黄金（回放存在/省略边界、工具轮中断补写、图片门控、turn-tail）；B2 双通道归约对拍（同 fixture）；B3 前缀请求体字节快照（锁 SDK 版本）；B4 DeepSeek 非标字段真流（`prompt_cache_hit_tokens` 捕获 + `extra_body` 透传保真）；B5 错误分派全家桶（`classifyLlmError` 不退化）；B6 看门狗 × 背压组合；B7 性能对账（TTFO/吞吐/内存）。**B1–B6 全绿 → 允许灰度（默认仍关）；任一证伪且无退路 → 关闭实验线**（回滚 = 关开关，现通道零改动）。

**C 段（不在首期）**：全量切换 / 退役 openai 通道——触发前提 = 电池全绿 + 一个版本灰度数据 + **不弱化任何 DeepSeek/家族语义**（拍板①）；届时另立决策。`ModelSpec` 增加传输偏好字段（models.dev `npm` 字段的数据版思路）同为 C 段后演进，不提前固化实验状态进语义层。

**D1–D3 遗留集成修复（2026-09-17，集成探查后批准实施，方案见 [x-integration-followup-design.md](./x-integration-followup-design.md)）**：记忆配置指纹热重载（reconcile 对比重建）；编辑器数字体单飞行取消（EditorAgentCancel IPC 全链）；vision/edit-handler 纳入实验 flag（core 级 `runStandaloneChatCompletion` 非流式辅助，flag 语义升级为全部 LLM 流量）；同批修复 StepFun `reasoning_effort` 重映射（provider camelCase option）与记忆层 secondary 端点凭证配对 + thinking 信封（`requestExtras`）。全部门禁全绿。
