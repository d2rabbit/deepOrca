# X4 新系列接入 SOP（specs/model-fleet-adaptation §七 / R13）

> 2026-09-17 定稿（X4.0）。**所有非原生登记家族**（GLM / Kimi / MiniMax / Qwen 及未来任一新厂商）一律经本 SOP 接入；`model-capabilities.ts` 原生登记仅保留 deepseek / stepfun 与「实证语义缺口」例外（见 §4）。

## 1. 接入流程（每系列一轮，估 0.5 天 + 真机 e2e）

### 步骤一：models.dev 目录覆盖核对（桌面端已内置）

1. `node scripts/vendor-models-dev.js --force` 刷新快照（marker 记录 sha256/条目数）。
2. 核对该系列在目录中的 provider 条目：型号串 / 窗口 / 输出上限 / 多模态 / 工具调用 / 价格 / reasoning `interleaved` 字段。
   - 快速核对：设置面板 → 端点卡 → 添加模型输入框的下拉（registry 家族建议在前，目录建议在后）应列出该系列型号；输入目录中的确切型号串后 thinking/vision 勾选被自动预填（X3.3 能力建议）。
   - 目录缺失/该厂商未被收录 → 手工登记型号 + 手工勾选能力（登记永远优先于目录）。

### 步骤二：能力默认验证（无需代码）

- 压缩阈值：未登记家族经 UNKNOWN 兜底，`getCompactPromptTokenThreshold` 自动取目录 `limit.context`（X3.2；无目录回退注册表 200K 默认）。
- 多模态门控：`supportsMultimodal` 自动取目录 `attachment + input 含 image`。
- reasoning 解析：UNKNOWN 家族默认双字段链 `reasoning_content ?? reasoning`（openai-compatible 原生同构，无需登记）。
- effort 档位：UNKNOWN 家族恒等透传（`THINK_LEVEL_FAMILY_MAPS` 无条目即透传）。

### 步骤三：X 通道真机验证清单（每系列逐项留痕于 tasks.md X4.x）

| # | 核对点 | 通过判据 |
| --- | --- | --- |
| 1 | 会话创建 + 普通对话 | 回复正常、流式进度条走动 |
| 2 | 工具调用（bash/read 至少一轮） | 结构化 tool_calls 到达并执行（无 dirge 兜捞日志） |
| 3 | thinking 开关 + effort 档位 | 请求体形状被该厂商接受（无 4xx；开启后 reasoning 增量到达） |
| 4 | 压缩触发（长会话或临时调低 `compactTokenThreshold`） | 按目录窗口触发，压缩本身成功 |
| 5 | 多模态（若该系列支持） | 图片进入 user 消息且不被剥离；不支持时被剥离且无 4xx |
| 6 | 缓存对齐 | 服务端缓存命中统计（若厂商回报）不为零（长前缀复用轮次后） |
| 7 | 错误样本 | 限流/鉴权错误各收集一份样本 → 补 `llm-error.ts` G5 模式（仅当现有分类错判时） |
| 8 | 记忆四链路 + 跨会话召回 | 后台任务（压缩/技能匹配/记忆抽取）零跨厂商 404（G1.4b 链已落地，复跑冒烟） |

实验通道开关（`experimentalSdkTransport`，默认关）与传输通道无关地参与本清单：**默认（关）通道即当前权威通道，步骤 1–8 全部先在默认通道通过**；开启开关后复跑 1–3 作为传输线灰度数据（B 电池之外的连续证据）。

## 2. 系列排期（承接原 S1–S4 优先级）

X4.1 GLM 5（先）→ X4.2 Kimi 2.5→K3（先，全区间型号目录核对；窗口差异经目录数据而非 MODEL_OVERRIDES）→ X4.3 MiniMax M3 → X4.4 Qwen 3.8（核对点：Qwen thinking 开关历史惯例与 GLM 不同——先确认 UNKNOWN 透传形状可用）。

## 3. escape hatch 判据（唯一允许新增注册表条目的路径）

同时满足以下全部条件才提请拍板加 `model-capabilities.ts` 家族条目：

1. **实证语义缺口**：真机验证中该厂商契约与 UNKNOWN 默认不兼容——典型为 deepseek 式「工具轮强制回放 reasoning 且空缺即 400」（replay 模式）、或 effort 档位语义不兼容（如服务端拒绝透传档位值）。
2. 缺口可复现（请求/响应样本留痕），且非传输通道（experimentalSdkTransport）特有——通道特有问题回 X2 传输线修。
3. 提请项目所有者拍板后：加**一条**家族条目（pattern/窗口/协议键），随附 G2c effort 映射（若适用）+ golden 测试；不允许顺手登记其他家族。

## 4. 明确不做

- 不因「目录没有」而登记注册表条目——目录缺失走手工登记模型 + 手工能力勾选（用户层，非代码）。
- 不做厂商专有增值特性（context caching API 显式管理、batch 接口等，fleet spec §六）。
- 不为单厂商引入官方 SDK（R13；传输层厂商中立）。
