# DeepOrca 模型专属优化 · 最终综合方案（v5.1 定稿）

> 2026-09-22 定稿。**待审核，未实施。**
> 汇总基础：三期调研（7 家 × 12 维度）+ 二期专项（token 消耗 / 缓存命中分家调研）+ 三期双角度复核（599 条断言核对：554✅/26❌，全部证伪已修正）。
> 结构：**① 厂家专属优化 → ② token 消耗优化 → ③ 缓存命中优化 → ④ 全方位整合架构 → ⑤ 通用兜底方案 → ⑥ 命中与兜底的智能方案**
> 证据与审计线索：[调研报告](./2026-09-22-vendor-code-agent-model-optimizations.md)（3341 行，每条结论附 `仓库/文件:行号`）
>
> 版本沿革：v1（画像+匹配）→ v2（协议/能力交 AI SDK+models.dev）→ v3（第一方生效门）→ v4（端点试探）→ v5（三期收编+六段定稿）→ **v5.1（四期：子家族/代际断层 + 别名层 + 前瞻默认，§1.0 与 §6.1 已升级）**

---

# ① 厂家专属优化（协议与契约层，按厂牌）

> **收录标准**：换了别家模型就不成立/会退化的适配；每条经三期双角度复核。分 **A 类（wire 可见，可试探）** 与 **B 类（纯本地，直接生效）**。

## 1.0 七家族总表（v5.1：含子家族分层——四期补测）

> **★ 四期补测结论**：家族内部存在**代际/架构断层**。models.dev 的 `family` 字段已把四组拆成两个子家族（数据已分层，无需我们发明）；kimi 另有**稳定别名层**（`kimi-for-coding` 背后 K2.7→K2.8 换模型而 id 不变——同 id 换模型是真实运营模式）。

| 家族 | pattern | 子家族（目录 `family` 实证） | 第一方域名 | 传输 | 证据强度 |
| --- | --- | --- | --- | --- | --- |
| `deepseek` | `^deepseek-` | **`deepseek-flash`**（flash/V4.1-Flash：attach=true 原生视觉）vs **`deepseek-thinking`**（v4-pro：纯文本）；V4 与 V4.1 架构两代（V4.1=Causal Encoder-Decoder、KV cache 压缩）但 wire 契约趋同；**同模型双拼写**：官方 `deepseek-flash` = DashScope `deepseek-v4.1-flash`（qwen-code tokenLimits 官方注脚） | `deepseek.com` | openai-compatible | ✅ |
| `stepfun` | `^step-` | **子家族断层（四期三次增补）**：`^step-5`（前瞻默认 **1M/1M**、~600B/27B 新架构、仅 Step Plan 通道）vs `^step-3\.7`（256K、多模态）vs `^step-3\.5`（**档位仅 [low,high]**、纯文本）；Step-Code 仓库默认已是 `step-5-preview` 但 wire 协议沿用（零新分支）——**DeepOrca 现条目是 3.7 时代的：家族级 256K 会让 step-5 用户提前 4 倍压缩，需按子家族重写能力层（wire 层保留）** | `stepfun.com` | openai-compatible | ✅ |
| `kimi` | `^kimi-` | **`kimi-k2`** vs **`kimi-k3`**，且 k2 内部再断层：**k2.7-code 是 always-thinking**（`thinking:{type:'disabled'}` 被官方拒绝——stepfun `generate-models.ts:952` + qwen-code moonshot 预设 `canDisable:false`/`disableField:'thinking'`）；k2.6 可关且 opencode-go 渠道下『on/off 非档位』；k3 = 1M/128K/effort[low,high,max]（KDA/LatentMoE 新架构）；**别名层**：`kimi-for-coding`/`kimi-code`/`kimi-coding` → 代际由服务端目录元数据定（K2.8 经此别名上线，id 不变） | `moonshot.ai`/`.cn` | openai-compatible | ✅ |
| `minimax` | `^minimax-` | **三分**：**`minimax-m2*`**（M2 全系：204K/纯文本/无档位）vs **`MiniMax-M3`**（精确匹配：1M/视觉/on-off 二元/专用补丁路径）vs **`MiniMax-M3.1`**（第一方仓库实证：**forced_on 不可关 + effort[low,high,max] + 离散上下文档位[512K,1M] + 走通用 effort 路径**；v2 runtime 默认模型；models.dev 尚未收录） | `minimax.io`/`minimaxi.com` | @ai-sdk/anthropic | ✅ |
| `qwen` | `^qwen` | 单层 `qwen`；**同模型多 id**：官方 `qwen3.8-flash` = 第三方 `qwen3.8-flash-next`（Qwen4 架构开放权重预览：125B MoE + 51B n-gram 嵌入表） | `aliyuncs.com` | openai-compatible | ✅ |
| `mimo` | `^mimo` | 单层 | `xiaomimimo.com` | openai-compatible | ✅ |
| `glm` | `^glm` | **`glm`**（5.3：纯文本）vs **`glm-flash`**（5.3-flash/flashx：**GLM-5 系首个原生多模态**——无 `-v` 后缀而含视觉是智谱新一代命名决定，第一方主证为 ZCode modelRules 后置补 supportsImage 规则；320B/18B、注意力 -3.01× KV -4.44×）；两代窗口断层（5-5.1=200K，5.2+=1M） | `bigmodel.cn`/`z.ai` | openai-compatible | ✅ |

## 1.1 deepseek（官方 harness 实证，复核 67/68）

| 类 | 优化 | 内容 | 证据 |
| --- | --- | --- | --- |
| A | **reasoning 回放契约** | 工具轮必须回传完整 `reasoning_content`，缺省即 400（`reasoningReplay: "content"`） | llm-deepseek/README；DeepOrca 已实现 |
| A | **effort 四档** | `off/low/high/max` → `output_config.effort`；`off` 发 `thinking.type:"disabled"`；不支持值**网络 I/O 前失败** | `model-info.ts` REASONING_EFFORTS（带 UX 文案） |
| A | **temperature quirk** | 思考模式下接受但忽略其值（显式记录，不猜测） | llm-deepseek/README:101 |
| A | **未目录化 = text-only** | 声明未验证的图片能力会让坏输入持久化、每轮复发——保守按纯文本 | `model-info.ts` 注释 |
| A | **systemPromptUpdate: in-history** | 变更追加在缓存历史之后而非重写 node 0（**仅 deepseek-flash 声明**） | `llm/src/types.ts:390-397` |
| B | **压缩公式** | `floor(min(W×0.8, W−O−65536))`，retain 16%，`modelPolicies` 逐模型覆盖，摘要可路由便宜模型 | compaction-basic/config |
| B | **摘要副调用热前缀** | 逐字节重放 system+tools+被遮蔽消息，仅尾部指令未命中缓存 | `summarizer.ts:71-76` |
| B | **视觉 token 网格** | 14px patch × 3:1 降采样 × ≤1024 token/图；low=512×512；≥15 图时 4096px 上限 | llm-deepseek/README:93 |
| B | **图片编码阶梯** | alpha→WebP effort 0；opaque→JPEG 85/75/60 取最小 | 同上 |
| B | **Files API** | 上传字节发 file-id（`anthropic-beta: files-api-2025-04-14`）；一次请求不混 file-id 与 inline；配额失败删最旧一批重试一次 | defaults + README |
| B | **KV Cache effect 文档纪律** | 每包 README 必答「是否改动模型输入前缀」 | adding-a-package.md（编译期强制） |

## 1.2 stepfun（复核 75/84，7 处已修正）

| 类 | 优化 | 内容 | 证据 |
| --- | --- | --- | --- |
| A | **思考不可关** | API 唯一控制是 `reasoning_effort`；off 投影为 `low`（诚实最低档） | `openai-thinking.ts` stepfunBuilder（DeepOrca 已实现） |
| A | **顶层 reasoning_effort** | 无 `thinking` 信封（那是 DeepSeek 形状；嵌套形式到不了 wire） | 同上 |
| A | **reasoning 读取字段** | 流式在 `delta.reasoning`（OpenAI 风格默认 wire） | providers/api |
| A | **maxTokensField** | `max_tokens`（非 `max_completion_tokens`） | detectCompat |
| A | **assistant content 纯字符串** | 数组形状会被部分模型（DeepSeek V3.2@NIM）在输出里镜像 | `openai-completions.ts:1306-1311` |
| B | **7 档 thinkingLevelMap** | `off/minimal/low/medium/high/xhigh/max`，值可为 null（该档不可用） | `model-config.ts:55-64` |
| B | **会话亲和三格式** | openrouter→`x-session-id`；openai→三头；openai-nosession→双头 | `types.ts:531` |
| B | **100MB 图片预算** | 「Step 后端接受的 inline 图远大于 Anthropic 5MB」（别家 20 倍）；四层再编码永不丢图；给模型的坐标缩放提示 | `image-resize-core.ts:19-72` |

## 1.3 kimi（复核 94/96，零实质错误——七家中最精确）

| 类 | 优化 | 内容 | 证据 |
| --- | --- | --- | --- |
| A | **kimi-k3 回放契约（多网关）** | `requiresReasoningContentOnAssistantMessages` 除官方外，openrouter kimi 系/vercel-gateway 也置 true——**按「k3 多网关家族」登记** | `generate-models.ts:2092-2098,2127,2339-2354` |
| A | **reasoning 字段三态 + 方言观察** | `KNOWN_REASONING_KEYS = [reasoning_content, reasoning_details, reasoning]`；`ReasoningKeyDialect` 观察入站实际用哪个 key、出站用同一个 | `reasoning-key.ts:11-56` |
| A | **thinking 元数据五件套** | supportEfforts/defaultEffort/**offEffort**（关闭映射档）/**alwaysThinking**（不可关）/adaptiveThinking + 四错误码 | `thinking.ts:13-28` |
| A | **temperature=false** | 目录一致（k3 与 k2.7-code 均 false） | models.dev 实测 |
| B | **repeat breaker 3/5/8/12** | 连续重复：3 次「写一句预期新信息」→ 5 次三选一（反证/要输入/收敛）→ 8 次纯文本 → 12 次**拒绝执行+终止**；同 key 同步去重返回空占位 | `toolDedupeService.ts` |
| B | **CJK 双速估算器** | ASCII/4 + **非 ASCII 每字符 1 token**；measured/estimated 双轨 rebase | `tokens.ts:5-16` |
| B | **观察式窗口学习** | 真实 413 → `floor(估算×0.85)` 记入 per-model 观察值；阈值取目录与观察值**较小者** | `fullCompactionService.ts:305-331` |
| B | **encodeCacheKey trait 钩子** | 缓存键编码是 per-model 可覆写扩展点 | `openai/trait.ts:16` |

## 1.4 minimax（复核 52/58，图片管线已补正）

| 类 | 优化 | 内容 | 证据 |
| --- | --- | --- | --- |
| A | **传输包** | 官方通道是 **`@ai-sdk/anthropic`**（`api.minimax.io/anthropic/v1`）——models.dev 指名；已拍板跟第一方走 | models.dev provider 表 |
| A | **M3 只有 on/off** | 「Responses effort values do not change thinking depth」；`reasoning_options:[{type:"toggle"}]` 双源印证 | `thinking.ts` + models.dev |
| A | **同模型按协议三形状** | responses→`reasoning.effort minimal/none`；completions→`thinking.type` + **删 reasoning_effort**；anthropic→`thinking.type adaptive` + **删 output_config.effort** | `openplatform-thinking-patcher.ts`（通道差异实证） |
| A | **interleaved 字段两值** | `reasoning_content \| reasoning_details` | `config.ts:1097` |
| B | **thinking 签名两类** | provider 绑定（可跨兄弟模型复用，改写出站 model id）vs model 绑定（降级为 `<\|prior-thinking\|>` 文本） | `outbound-message-normalizer.ts` |
| B | **装配指纹** | system+tools 各一 sha256(16)；**排除消息历史**（增长≠churn）；保留空白（「prompt caches observe it even when humans do not」）；键序规范化 | `assembly-fingerprint.ts`（71 行） |
| B | **图片压缩阶梯** | 1920px/5MB + **JPEG `[82,72,62,52]`** + 512px 下限 + alpha 白底压平；纯 JS 可移植 | `model-image-preprocess.ts` |
| B | **MCP 渐进披露** | 估算 > `thresholdPct(0.15)×contextWindow` → MCP 工具换成 `tool_search`+`mcp_invoke` 两代理工具；三重门 fail-open | `mcp-disclosure/plan.ts` |
| B | **模态压制** | `support_image/video`=true 时**删除回退上传工具**（原生模态 vs 工具模拟二选一） | `matrix-tools/index.ts:317-327` |

## 1.5 qwen（复核 105/111）

| 类 | 优化 | 内容 | 证据 |
| --- | --- | --- | --- |
| A | **profile 体系** | dashscope-thinking（`enable_thinking`）/ dashscope-effort（`reasoning_effort`）/ qwen-chat-template / deepseek-openai（`thinking` 信封）/ openai-effort——**disableField 三态按 (auth,host,model) 解析** | `reasoning-overrides.ts:186-240` |
| A | **thinkingMandatory** | `qwen3.8-max-preview` 拒绝 `enable_thinking=false` 返回 400 → 永不发关闭态 | `contentGenerator.ts:186-188` |
| A | **effort 上限分档** | DashScope qwen3.8-max 封 `xhigh`；Gemini 封 `high`；Anthropic 按模型钳制 + 每 generator 警警一次 + baseURL 消歧 | 同上注释 |
| A | **splitToolMedia（默认 true）** | 工具消息只许 string/text-part；严格服务端（doubao/new-api/LM Studio）对图片 400「Invalid 'messages'」→ 拆成后续 user 消息（#4876/#3616） | `contentGenerator.ts` |
| A | **DashScope metadata 门控** | `metadata{sessionId,promptId,channel}` **仅 qwen 家族 wire 模型发送**（第三方后端当字符串直接 400，#11590） | `dashscope.ts:720-780` |
| A | **schemaCompliance** | 工具定义 `auto \| openapi_30` | 同上 |
| B | **四档压缩阶梯** | `{warn, auto, hard, effectiveWindow}`；`auto = min(0.85×W, (W−20000)−13000)`；摘要输出预算钳制 | `chatCompressionService.ts` |
| B | **三锚点 + per-anchor TTL + 单调归一** | `system/tool/user.last` 各自 `ephemeral\|'1h'`；**反向扫描把 '1h' 前的锚自动提升**（任何组合都合法） | `converter.ts:1005-1049` |
| B | **staticSystemPrefix 拆分** | 稳定前缀（可 global scope 跨会话）与易变尾段（git status 等）分 block 各带断点 | `converter.ts:1058-1110` |
| B | **微压缩护缓存** | 清到**半水位**（贴线会每轮再触发、打断 prompt-cache 前缀）；体积 500K chars + 时间 60min 双触发 | `microcompact.ts:547-551` |
| B | **omni reactive-degrade** | **服务端 400 是唯一可靠超限信号**（按采样帧计费，480p 降档不降账单）→ 降级 → 历史 fileUri 原位替换 → 重试 | `reactive-degrade.ts` |

## 1.6 mimo（复核 86/96）

| 类 | 优化 | 内容 | 证据 |
| --- | --- | --- | --- |
| A | **MFJS 工具 schema** | Moonshot Flavored JSON Schema（`anyOf` 与父级 `type` 同级会被拒）——与 ZCode `requiresMfjsToolSchema` **两家独立实现互证** | `sanitizeMoonshot` |
| A | **variants 方言** | effort→provider 方言由 `variants` 数据承载，**不发明映射表**；不支持档位 **400 并列支持项**（拒绝静默降级） | `completions.ts:93-118` |
| A | **temperature 能力位默认 false** | 转发调用方 temperature 给不支持的模型会出问题 | `capabilities.temperature` |
| B | **按模型 8 份系统提示** | `prompt(model.id ?? model.api.id ?? DEFAULT)` 子串匹配分发 deepseek/glm/kimi/minimax/gpt/gemini/anthropic/beast/trinity | `session/system.ts:35-49` |
| B | **usesLargeModelDefaults** | providerID∈{mimo,xiaomi} 或 id 含 claude/gpt/mimo → 输出上限 128K，否则 min(limit,32K) | `transform.ts:33-38` |
| B | **滚动双缓冲双锚** | `[-2]` 供下轮 READ、`[-1]` 本轮 WRITE——防重试/删消息把唯一尾锚带走 | `applyCaching` |

## 1.7 glm（ZCode 补测，复核 75/86）

| 类 | 优化 | 内容 | 证据 |
| --- | --- | --- | --- |
| A | **CEL map DSL** | 每模型两个表达式串（`reasoningLevel.map`/`maxOutputTokens.map`）→ 编译一次 → 每请求冻结值求值 → **JSON Merge Patch**（`null`=删除）→ 按序应用；**路径冲突检测**（两 map 写重叠路径即抛错） | `@zcode/model-option-map`（731 行） |
| A | **modelApiRules 二维匹配** | `(modelMatch 正则, apiTypeMatch 三方言)`；**大小写不敏感** | `zcode-builtin.json`（72 条） |
| A | **档位逐代演进** | glm-5 `[disabled,enabled]` → GLM-5.2 `[disabled,high,max]` → **glm-5.3 `[low,high,max]`（无 disabled=不可关）** | modelRules 级联 |
| A | **supportsMidConversationSystem** | per-model 能力位：支持→中途 system 投影；不支持→回退净化 user 文本 | `model-config.ts:77` |
| B | **per-model 输出上限表** | 1024（glm-4v-flash）～384000（deepseek-v4 系经 GLM 通道）；旗舰 128000–131072 | zcode-builtin.json |
| B | **默认档 = values.at(-1)** | 数组末位=最强档 | `model-selection-config.ts:65` |

---

# ② token 消耗优化（整合二期分家调研 + 三期增补）

## 2.1 七家横向收敛（每家最强项）

| 家 | 最强项 |
| --- | --- |
| MiMo | bash 输出双管线清洗（4 层通用 + 10 形状启发式，实测 -53%～-95%，never-worse 守门） |
| kimi | 掐无效请求链（repeat breaker）+ CJK 双速估算 + 图片压缩阶梯 |
| deepseek | 可审计剪裁（shadow-price 事件回放扣账）+ image-offload 永久占位 |
| MiniMax | MCP 披露（15%×窗口）+ 动态 maxTokens 钳制（**35% 窗口洞察**）+ 模态压制 |
| qwen | 微压缩（体积+时间双触发，半水位护缓存）+ CJK×1.5 |
| Step | deferredTools（工具定义延迟到首调点注入）+ 提示按活跃工具集逐段门控 |
| ZCode | per-model 输出上限规约表（数据驱动）+ microcompact 256-token 门槛 |

## 2.2 通用收敛（DeepOrca 应采用的机制，按收益排序）

| # | 机制 | 七家实证 | DeepOrca 现状（二期核对） |
| --- | --- | --- | --- |
| T1 | **压缩公式统一**：`阈值 = min(比例×W, W − 输出预留 − headroom)`，摘要副查询输出预算计入 | 7/7 | 已有两级触发+0.9 比例，但**未计摘要预算、无输出预留扣分母**（主请求不发 max_tokens 故暂不暴露） |
| T2 | **分层压缩**：microcompact（本地零调用）→ 摘要 → **rapid-refill 熔断**（压缩后 3 回合又满×3 次→停+提示分块读） | qwen/ZCode/MiMo/MiniMax/deepseek | 已有 Stage-A 工具裁剪（8192→1024+1024）≈微压缩雏形；**无熔断** |
| T3 | **工具结果预算三件套**：截断 + 落盘指针 + **续读协议**（`continuation_hint` 原参续读） | kimi 50K/spill、ZCode 30K inline+5GiB 落盘、MiniMax 头 45%/尾 55% | 有 Stage-A 裁剪，**无落盘指针与续读协议** |
| T4 | **工具面收窄**：MCP 披露（15%×窗口→代理工具）/ deferredTools / 模态压制 | MiniMax/Step | **每次全量下发** |
| T5 | **图片 token**：像素预算 + 质量阶梯（kimi `[80,60,40,20]` / MiniMax `[82,72,62,52]`）+ 计费网格（deepseek 14px / qwen 28px patch） | 4/7 | 无 |
| T6 | **token 计量**：usage 锚定优先（不满足条件退启发式宁大勿小）+ **系统提示与工具声明计入** + toolCalls 入参计入 + CJK 处理 | deepseek/kimi/MiniMax/ZCode | 本地计数已有（DeepSeek 精确 BPE）；需补工具入参与 CJK 校准 |
| T7 | **循环干预省请求链**：repeat breaker / try-best（diff Jaccard>0.8）/ runaway 六信号 / 每回合警告预算 | 5/7 | **无**（三期实证：三个调研 agent 同错误反复失败即真实样本） |
| T8 | **read→edit 自愈**：行号前缀剥离（全前缀形状才剥、只重试一次）+ Unicode 归一（智能引号/连字符/特殊空格）+ levenshtein 模糊 | MiniMax/Step/ZCode/MiMo | snippet_id 强约束（互补路线）；可加失败驱动自愈层 |

## 2.3 DeepOrca 已领先项（保留，不动）

- **G3 技能分片召回**（大 SKILL.md 只注入按 prompt 召回的分片，fail-open）——**七家无对应物**
- 工具参数修复链 `tool-call-repair.ts`（截断修复+围栏剥离+散文抽取）——强于多数家
- 兜捞安全门（白名单+区域切除+上限）——仅缺散文守卫（qwen 0.8）

---

# ③ 缓存命中优化（整合二期分家调研 + 三期增补）

## 3.1 七家横向收敛（每家最强项）

| 家 | 最强项 |
| --- | --- |
| deepseek | **体系化之最**：in-history 追加投影 + 每包 KV Cache effect 文档契约 + 摘要逐字节重放热前缀 + stepped 高水位图片 |
| MiniMax | **可观测闭环**：装配指纹归因（`pi_llm_assembly_stability_total`）+ cache_outcome 四指标 + bash 缺口×缓存交叉表 |
| qwen | **语义吃得最深**：三锚点 per-anchor TTL + 单调归一 + staticSystemPrefix 双 block + global scope |
| kimi | encodeCacheKey trait 钩子 + **fork 会话首 turn cache probe 遥测** |
| ZCode | system **三段锚**（stable/dynamic 分段各锚）+ skipCacheWrite 锚点前移 |
| Step | 副调用防污染 chokepoint（cacheRetention none+新 uuid）+ 会话头三格式 |
| MiMo | 尾部滚动双缓冲双锚 + 以缓存命中率为第一论据的注入位置决策 |

## 3.2 通用收敛（DeepOrca 应采用）

| # | 机制 | 七家实证 | DeepOrca 现状 |
| --- | --- | --- | --- |
| H1 | **前缀稳定性**：动态内容下沉 message 层（`<system-reminder>` 包装）；system 单一稳定 | MiMo/kimi/ZCode/qwen | 技能注入为**中途追加 system 消息**（append-only 前缀友好，二期核对修正了「污染前缀」的过强论据）——真正待评估点是端点接受性（ZCode 建成 per-model 位）与指令遵循率 |
| H2 | **system 更新策略**：in-history 追加（变更追加在缓存历史后）vs 原地替换 | deepseek/ZCode（能力位） | 无 |
| H3 | **锚点体系**：三锚点 `system/tool/user.last` + per-anchor TTL（`ephemeral\|'1h'`）+ 单调归一 + system 稳定/易变分段 | qwen/ZCode/MiMo/Step/kimi | **无任何 cache_control** |
| H4 | **装配指纹**：system+tools 的 sha256（**排除消息历史**、保留空白敏感、键序规范化）→ 变更检测 + stability 指标 | MiniMax/deepseek（canonicalHeader） | 无 |
| H5 | **副调用防污染**：摘要关缓存+新路由 id / **skipCacheWrite 锚点前移** / 逐字节重放热前缀 | Step/ZCode/deepseek | 无 |
| H6 | **会话亲和**：`prompt_cache_key`/`x-session-id` 等按 provider 格式 | Step/kimi/qwen/deepseek | 无 |
| H7 | **命中归因**：miss 三态标签（miss/换模型后/闲置 TTL 后）+ cacheHitRate 面板 + fork probe | Step/ZCode/kimi/MiniMax | 被动记录 cacheRead/Write，**无分析** |
| H8 | **微压缩护缓存**：半水位 + 最小节省门槛（不值得的清理=白碎缓存） | qwen/ZCode | 无 |
| H9 | **文档纪律**：每特性必答 KV Cache effect | deepseek（唯一） | 无 |

---

# ④ 全方位整合架构（DeepOrca 落地形态）

## 4.1 三层分工（不变式）

| 层 | 归属 | 载体 | 边界判据 |
| --- | --- | --- | --- |
| wire 协议实现 | **AI SDK** | `@ai-sdk/openai-compatible`（已 pin）+ `@ai-sdk/anthropic`（MiniMax，exact-pin） | 「换模型名，AI SDK 能回答的」不归我们 |
| 模型能力数据 | **models.dev** | `vendor/models-dev/api.json` → `model-catalog.ts`（**需扩展解析**：`npm/api/interleaved/reasoning_options/temperature/structured_output/family`） | 「换模型名，目录能回答的」不归我们 |
| 专属优化 + 命中/兜底 | **DeepOrca** | `model-profile.ts`（新增，零依赖） | 「换模型名答案会变、但两者都不知道」才写画像 |

## 4.2 画像数据模型（最终形）

```ts
resolveModelProfile(input: {
  model: string;                       // 家族匹配只看它
  catalogEntry?: CatalogModelEntry;    // 能力数据（注入，不写入画像）
  channel?: { baseURL?: string; catalogProviderId?: string };  // 仅用于试探记账与第一方加速
}): ModelProfile;

type ModelProfile = {
  vendor: ModelVendorId;               // 7 家 + unknown
  matchedBy: "model" | "fallback";
  // A 类：wire 可见（受端点试探约束）
  wire?: {
    thinking?: { envelope; effortValues?; mandatory?; offEffort? };
    reasoning?: { readFields?; replay? };
    output?: { maxTokensField?; caps? };
    tools?: { schemaDialect?; splitMedia?; deferred? };
    extraParams?: Record<string, unknown>;   // CEL patch 形态（P3）
  };
  // B 类：纯本地（模型匹配即生效，无试探）
  local?: {
    compaction?: { warnRatio; autoRatio; hardRatio; reservedTokens; keepRecent; circuitBreaker };
    cache?: { anchors; retention; assemblyFingerprint; skipCacheWriteOnSummary };
    prefix?: { skillInjection; midConversationSystem? };
    loopGuard?: { thresholds; textOnlyAt };
    toolSurface?: { disclosureRatio?; modalitySuppress? };
    toolTextFallback?: { enabled; proseRatioGuard };
    argRepair?: { chain };
    inputGuard?: { minImageEdgePx? };
  };
  evidence: readonly string[];
};
```

## 4.3 请求构造两段式（试探的架构前提）

```
buildBaseRequest(模型, 消息, 工具)          // 纯净形态（= 兜底形态）
  ↓
applyOptimizations(base, profile, probeState)   // 纯函数：base ∪ patches
  ↓                                              // 可丢弃、字段可枚举（供拒绝归因）
createChatCompletionStream(...)
```

## 4.4 实施分级（三期增补后的最终版）

**P0 — 数据通路 + 试探骨架（1.5–2 天）**
1. 扩展 `model-catalog.ts` 解析（7 个新字段，fail-open）
2. `resolveModelProfile` 骨架 + A/B 分类 + 保守默认
3. `thinkingMandatoryFromCatalog` 派生（`values` 无 none/off ⇒ 不可关）——**三源印证**（models.dev / ZCode / MiniMax 源码）
4. `reasoningReadFields` 改目录驱动（含 `reasoning_details` 数组形状）
5. temperature 门控读目录
6. **`isFirstPartyChannel`**（hostname 后缀主 + catalog provider id 辅；不可判定=false）——**降级为试探加速**（预置「已知接受」，省首轮试探成本）
7. **端点试探机制**（详见 §⑥）

**P1 — 压缩与缓存（3–4 天）**
1. 压缩三档阶梯 + 摘要副查询预算 + **输出预留从分母扣除**（ZCode 口径：「否则请求预算和压缩窗口按两套常量计算」）
2. **microcompact 增强**（在既有 Stage-A 上：保 N 组、媒体保护、**256-token 最小节省门槛**）+ **rapid-refill 熔断**
3. 工具结果落盘指针 + **续读协议**（`continuation_hint`）
4. 技能注入评估（端点接受性试探 + message 层 reminder 对照）
5. **装配指纹**（sha256、排除历史、保留空白、键序规范化）+ 变更日志

**P2 — 工具面与循环（3–5 天）**
1. 循环干预阶梯（kimi 3/5/8/12 文案直接采用 + MiMo try-best 的工具语义化判定）
2. 工具面收窄（MCP 披露 15%×窗口 + 模态压制）
3. 兜捞意图守卫（proseRatioGuard 0.8）
4. 退化输入守卫（minImageEdgePx 8 + 双向防线）
5. **read→edit 失败自愈层**（行号前缀剥离 + Unicode 归一，与 snippet_id 互补）
6. **配额 vs 限流分流**（C25：`llm-error.ts` 增配额/TPM/余额类别，不可重试）

**P3 — 表达层与锚点（2–4 天）**
1. 受限表达式层（或先做静态 patch 表 + **路径冲突检测**；ZCode DSL 的完整移植可选）
2. cache_control 三锚点 + per-anchor TTL + 单调归一 + skipCacheWrite
3. 流式重试提交边界（MiniMax「可见增量=提交边界」+ 缓冲重放）
4. **观察式窗口学习**（kimi：413 探针 → per-model 观察值 → 阈值取小）

---

# ⑤ 通用兜底方案

## 5.1 触发条件（任一即落兜底）

| # | 条件 | 说明 |
| --- | --- | --- |
| 1 | 模型串不命中任何家族 pattern | `matchedBy: "fallback"` |
| 2 | 家族命中但**端点试探被拒**（A 类某维度） | 该维度禁用，其它维度保留 |
| 3 | 家族命中但**无法判定第一方且试探不可用** | 保守全兜底 |
| 4 | 目录缺失/损坏/无该模型 | 能力派生回退（见 5.2 第 4 条） |
| 5 | 画像加载/表达式编译失败 | fail-open 到兜底（绝不让坏配置杀会话） |

## 5.2 兜底行为（= 今日行为，逐项）

| 关注点 | 兜底行为 |
| --- | --- |
| 能力（窗口/模态/档位） | 仍从 catalog 取（数据层与优化无关）；目录无 → 现有 UNKNOWN 默认（200K / multimodal:true / 双字段链） |
| thinking 信封 | `openAiCompatibleBuilder`（今日 UNKNOWN 形状） |
| reasoning 字段/回放 | 现有双字段链 + 家族 `reasoningReplay` 规则 |
| 压缩 | 现有两级触发（loop-top `>threshold` + 预检 `≥threshold×0.9`）+ `settings.compactTokenThreshold` 用户覆盖 |
| 全部 A/B 类策略 | 不启用 |
| temperature | 现有条件发送（env→project→user 链） |

## 5.3 兜底的安全保证

- **R-兜底等价**：`applied=false` 时请求与行为**与升级前逐字节相同**——第三方网关用户升级零风险。
- **不可降级到更差**：兜底即今日行为，不存在比今日更差的路径。
- **deepseek 零回归**：deepseek 家族在端点接受前提下请求逐字节不变（golden 测试锁定）。
- **坏配置 fail-open**：画像/表达式任何失败 → 兜底 + 一条结构化日志，绝不抛错杀会话。

---

# ⑥ 专属优化的命中与兜底的智能方案

## 6.1 命中算法（v5.1：五段，模型优先 + 别名/子家族层）

> **四期补测驱动的升级**：原三段（具名→家族→UNKNOWN）不足以承载代际断层——`kimi-for-coding` 同 id 换模型、`kimi-k2` 与 `kimi-k3` 是两个子家族、GLM 5.2+ 与 5-5.1 窗口差 5 倍。

```
resolveModelProfile(model):
  ⓪ 别名解析（alias tier）
     已知别名表：kimi-for-coding / kimi-code / kimi-coding → 别名标记
     → 命中别名时：子家族与能力由【运行时目录元数据】定
       （support_efforts / default_effort / always_thinking——第一方模式，kimi model-catalog.ts:45 实证）
       → 目录不可用 → 落家族默认 + 全维试探
  ① 具名模型覆盖表[model]（精确串）   ← 如 "qwen3.8-max-preview" {thinkingMandatory}
  ② 子家族 pattern                    ← 优先用目录 family 字段；无目录时用 pattern：
                                          ^kimi-k3 / ^kimi-k2 / ^kimi-
                                          ^glm-(5\.2|[6-9]|\d{2,}) vs ^glm-5(\.[01])?   ← 前瞻默认+显式钉旧
                                          ^glm-5\.3-flash vs ^glm-5\.3
                                          ^minimax-m3\.1 vs ^minimax-m3$ vs ^minimax-m2   ← 三分（M3.1=forced_on+档位+离散窗口，M3=on/off 补丁，M2=204K）
                                          ^deepseek-(v4|flash) vs ^deepseek-
  ③ 家族 pattern（trim 后正则）        ← 7 家 pattern 表
  ④ UNKNOWN 保守默认（全策略关闭）      ← 兜底
  全程不读 baseURL（channel 仅用于试探记账与第一方加速）
```

**三个新构件**（四期实证）：

| 构件 | 依据 | 说明 |
| --- | --- | --- |
| **别名层** | K2.8 Preview 用 `kimi-for-coding` 同 id 换模型（官方明示「客户端无需修改」）；第一方以服务端目录元数据（capabilities/default_effort/support_efforts）承载代际 | **同 id 换模型是真实运营模式**——纯模型串匹配对此失效，必须经运行时元数据或试探定代际 |
| **子家族键 = 目录 `family` 字段** | models.dev 已分层：kimi-k2/kimi-k3、glm/glm-flash、deepseek-flash/deepseek-thinking、minimax/minax-m3 | 数据已分层，**优先消费目录**；pattern 仅作无目录时的回退 |
| **前瞻默认 + 显式钉旧** | qwen-code `tokenLimits.ts`：「1M is the forward default for new GLM releases (GLM-5.2+…) **so they need no future code change**. Confirmed 200K families are pinned explicitly first」 | 子家族 pattern 的写法规范：新代用宽正则拿新默认，确认过的旧代显式钉住——**未来型号零改码** |

**镜像问题一并承接**：qwen 存在「同模型多 id」（官方 `qwen3.8-flash` = 第三方 `qwen3.8-flash-next`）——模型串不是稳定标识，**目录 family + 运行时元数据才是**；这也再次印证端点试探的必要性。

**目录辅助派生**（命中后叠加，不参与家族判定）：
- `thinkingMandatory` = reasoning && reasoning_options 非空 && 所有 effort.values 均不含 none/off
- `effortValues` = reasoning_options[].values（菜单与合法性校验）
- `reasoningReadFields` ← interleaved.field
- `temperatureSupported` ← temperature

## 6.2 生效规则（A/B 二分）

```
模型命中家族
  ├─ A 类（wire 可见）→ 乐观应用 → 端点试探 → 接受则保留 / 拒绝则按 (通道,模型,维度) 记禁用 → 同轮默认态重发
  └─ B 类（纯本地）  → 直接生效（端点无拒绝信号；且它们是模型属性驱动而非通道属性驱动）
```

## 6.3 端点试探完整设计（成败关键在「拒绝归因」）

| 设计点 | 方案 |
| --- | --- |
| **粒度** | `(通道键, 模型, 优化维度)` 三元组——一个维度被拒不连坐其它 |
| **触发** | **惰性**：仅当该优化确实改变本次请求才试探；**不做主动探测请求** |
| **★ 拒绝归因（最关键）** | 只认「可归因」拒绝：HTTP 400 且（错误信息**点名我们新增的字段** ∥ 请求与已知良好基线**仅差该优化** ∥ 结构化 code 命中 unsupported_parameter/invalid_request 类）。**绝不**把 auth/quota/限流/内容过滤/上下文溢出误判为「优化被拒」 |
| **记账** | 会话内内存 `(通道,模型,维度)→rejected`；**不做跨会话持久化**（首期；端点配置会变） |
| **重建** | 请求构造两段式（§4.3）：`applyOptimizations` 是纯函数，试探失败整体丢弃 patches |
| **重试** | 拒绝后**同轮**用默认态重发一次（复用 `llm-error.ts` 分类与自动恢复通道） |
| **诊断** | 每次降级写结构化日志（维度、拒绝证据、通道键）——「该优化是否值得保留」的数据基础 |
| **加速** | 第一方域名表预置「已知接受」，跳过首轮试探成本（唯一用途；不参与正确性） |

## 6.4 动态校准（窗口维度的试探，与 6.3 同构）

```
请求撞 413/CONTEXT_WINDOW_EXCEEDED 且通过谓词（估算 ≥ 0.5×effectiveMax，防图片过大误触）
  → observed[model@channel] = floor(估算 tokens × 0.85)
  → 此后该模型压缩阈值 = min(目录窗口, observed)
  → 恢复：压缩 → 原地 retry 失败请求（连续次数上限防死循环）
```

（kimi 实证：目录说 1M 但端点实际 128K 时，一次溢出即永久学会。）

## 6.5 全流程状态机

```
用户发消息
  → resolveModelProfile(model)                     [①命中]
  → 画像 + probeState 决定本轮生效集                 [②A/B 分流]
  → buildBaseRequest() → applyOptimizations()      [③两段式构造]
  → 发送
      ├─ 成功 → 记「已知良好基线」；B 类策略照常运行（压缩/循环/指纹）
      ├─ 可归因 400 → 记禁用(通道,模型,维度) → 默认态同轮重发 → 成功则继续
      ├─ 413 且过谓词 → 窗口学习 → 压缩 → 原地重试
      └─ 其它错误 → 走现有 llm-error 分类与恢复（不触碰优化状态）
```

## 6.6 验收标准（EARS）

- **R1 命中**：家族匹配 shall 只依据模型串；具名覆盖 > pattern > UNKNOWN。
- **R2 优化优先**：命中家族 shall 先按优化态构造请求（乐观），不得预先降级。
- **R3 试探**：可归因拒绝 shall 精确禁用该 (通道,模型,维度) 并同轮默认态重发一次。
- **R4 归因精确性**：auth/quota/限流/过滤/溢出 shall not 触发任何优化禁用。
- **R5 B 类无门**：纯本地策略 shall 随模型匹配生效，不参与试探。
- **R6 兜底等价**：`applied=false` 时 shall 与升级前逐字节相同。
- **R7 数据外置**：能力 shall 全部来自 catalog；画像不含能力常量与 wire 参数名（P3 表达层除外，且其输出受冲突检测约束）。
- **R8 零依赖**：画像模块 shall 不 import 任何模块。
- **R9 证据可溯**：每条策略 shall 携带 evidence；无第一方证据的家族策略全默认。
- **R10 deepseek 零回归**：deepseek 家族请求逐字节不变（端点接受前提下）。
- **R11 窗口学习**：413 过谓词后 shall 记观察值并取 min(目录, 观察) 为阈值。

## 6.7 真机验证清单（每家族两轮：第一方 + 第三方）

| # | 核对点 | 判据 |
| --- | --- | --- |
| 1 | 会话+对话+工具调用 | 正常流式；结构化 tool_calls 到达 |
| 2 | 档位菜单 | 与目录 `reasoning_options[].values` 一致 |
| 3 | 不可关模型 | 关闭不 400；派生判定与真机一致 |
| 4 | 压缩触发点 | 实测百分比与阶梯一致；熔断可触发 |
| 5 | 缓存命中 | 装配指纹不变时不失效；miss 归因正确 |
| 6 | 兜捞守卫 | 模型「讲解协议」不误执行 |
| 7 | **试探降级**（第三方样本：minimax-m3@ollama-cloud 等） | 被拒维度精确禁用、其它保留、同轮重发成功 |
| 8 | **归因精确性** | 人为触发 auth/quota → 不产生任何禁用 |
| 9 | **窗口学习** | 人为小窗 → 一次 413 后阈值收敛 |
| 10 | MFJS（kimi） | schemaDialect 生效不再 400 |
| 11 | 多模态 | 与目录 attachment 一致；splitMedia 生效 |
| 12 | 记忆四链路 | 后台任务零跨厂商 404 |

---

# 附：历史与审计线索

- v1–v4 演进与拍板记录：v1 画像匹配 → v2 数据外置（AI SDK+models.dev）→ v3 第一方门 → v4 端点试探（优化优先 + 被拒即弃）。
- 二期核对（方案 vs 仓库实测）：6 成立 / 3 修正（满窗口→两级 0.9、无条件温度→条件发送、技能注入论据过强）。
- 三期双角度复核：599 断言（554✅/26❌/19⚠），26 证伪全部就地修正；新增 ~155 项机制；新共性 C25–C31。
- 全部证据链：[调研报告](./2026-09-22-vendor-code-agent-model-optimizations.md)。
