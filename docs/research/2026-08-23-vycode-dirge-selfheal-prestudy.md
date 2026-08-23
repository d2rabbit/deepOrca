# vycode / dirge 自愈与工具调用修复机制研究 — DeepOrca 吸收方案

> 2026-08-23。研究对象：[MuhammadLutfiMuzakiiVY/vycode](https://github.com/MuhammadLutfiMuzakiiVY/vycode)（Rust TUI coding agent）、[dirge-code/dirge](https://github.com/dirge-code/dirge)（Dynamic Intent Resolution Grounding Engine，Rust）。目标：吸收两者的自愈（self-healing）与错误格式工具调用修复机制，使性能较弱的模型（小参数开源模型、量化模型）在 DeepOrca 的 LLM 工具回路中稳定工作。

## 一、vycode 的相关机制（较薄）

| 机制           | 位置                     | 做法                                                                     | 对 DeepOrca 的价值                                                    |
| -------------- | ------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `/heal` 命令   | `app.rs:762`             | 抓取编译器诊断 → 若有错误则把诊断全文回传 LLM 要求"只返回修复后的代码块" | 编译错误→LLM 修复回路。DeepOrca 已有 review.full/CRG 类似编排，不吸收 |
| SSE 容错解析   | `providers/streaming.rs` | `from_utf8_lossy` 容错解码 + 坏帧静默跳过（`if let Ok(json)`）永不崩流   | DeepOrca 流解析已具备同等容错，不吸收                                 |
| 文本通道触发器 | Sovereign Agent 协议     | `[EXEC: cmd]` / `[WRITE: path\|content]` 文本内嵌执行标记                | 概念被 dirge 的 scavenge 更严谨地实现了，吸收 dirge 版                |

**结论：vycode 可吸收内容有限，主要价值是确认"容错解析 + 编译修复回路"是这类工具的标配基线。**

## 二、dirge 的核心机制（重点吸收对象）

dirge 的 agent loop 有 63 个模块，其中直接负责"弱模型稳定工作"的是一套**分层修复管线**（源自 DeepSeek-Reasonix 的设计，dirge 用 Rust 忠实重写并扩展）：

### 2.1 截断修复 `repair_truncated_json`（tool_input_repair/truncation.rs，209 行）

**问题形状**：弱模型撞 `max_tokens` 上限，参数字符串停在中途——开着的字符串、悬空的 `"key":`、未闭合的 `{`/`[`、尾逗号。

**算法**（纯字符串级，零 schema 依赖）：

1. 空输入 → `{}`；可解析 → 原样返回（快路径）
2. 单趟扫描维护开栈 `{ / [ / "`（`"` 入栈使 EOF 路径能闭合未终结字符串；转义追踪）
3. 截到最后一个有效字符 → 修剪尾逗号 → 悬空键补 `null` → 闭未终结字符串 → 逆序弹出全部开结构
4. 修复后再验证；全部失败 → 硬兜底 `{}`（`fallback: true`，原始参数保留 500 字符预览供审计）

每步产出人类可读 notes（"closed unterminated string" 等），回显给模型让其后续调用自适应。

### 2.2 文本通道拾荒 `scavenge_tool_calls`（scavenge.rs，905 行）

**问题形状**：模型把工具调用写进了**文本/推理内容**而不是结构化 `tool_calls` 字段（DeepSeek R1 写进 reasoning_content 忘记结构化；Qwen/Hermes 走 `<tool_call>` 标签；llama.cpp 未开 `--jinja` 时泄漏；还有模型学会 ```json 围栏写法）。

**三种模式**（按精度递降）：

- **Pattern A**：DSML invoke 块（`<｜DSML｜invoke name="...">…`）
- **Pattern B**：`<tool_call>…</tool_call>` 标签 + ` ```json `/` ```tool ` 围栏——**先于裸扫描执行，并把已识别区域从裸扫描的输入中切除**（防同一调用被计数两次）。标签的价值：`iterate_json_objects` 只吐**平衡**对象，截断调用根本成不了候选；标签显式定界，才能让截断修复器去闭合它；且"对显式标签内做宽松修复"不会伤精度（对散文里的每个花括号串做修复才是鲁莽的）
- **Pattern C**：裸平衡 JSON 对象扫描（手写扫描器，未匹配花括号跳过防 O(n²)），识别三种形状：`{name, arguments}` / `{type:"function", function:{name, arguments}}`（OpenAI 式）/ `{tool_name, tool_args}`（R1 自由体）

**安全门**（这是能放心吸收的关键设计）：

- **名字门**：候选调用必须带一个**本轮已注册工具名**（或别名表命中）才晋升为调用——"修复永不发明名字，门永不放宽到不存在的工具"
- **数量帽**：默认最多 4 个（防失控提取）
- **尺寸帽**：输入超 100KB 跳过（防正则 O(n²)）
- 未知名字有记录帽（防一回合四位数日志行）

`call_syntax.rs`（1015 行）把"调用区域在哪开始结束"做成**唯一定义**，拾荒器与用户显示过滤器共用——被拾荒执行的调用绝不会再原样打印给用户（避免用户看到的"回答"就是模型写的调用文本）。

### 2.3 验证-修复编排 `validate_and_repair`（validate.rs，266 行）

validate-then-repair 语义（合法输入永不触碰）：

1. 内容规范化（无论验证结果都跑）：null 值可选键剥离、路径字段 markdown 自动链接解包（`[text](path)` → `path`）
2. 关系默认值（schema 的 `dirge-hints.relational`：声明"这些字段应同在"，部分在场时补缺 + Note 回显）
3. JSON Schema 验证；失败则**按失败路径做靶向形状修复**（JSON 字符串→数组、对象→数组、裸串→数组）
4. 复验；仍失败 → 结构化错误（error_fmt.rs 按 schema 位置格式化，路径字段名识别让错误对齐人类直觉）

依赖 jsonschema 库与 schema 注解扩展——**本轮不吸收**（DeepOrca 工具 schema 无注解层，收益/成本比低），记录为后续可选项。

### 2.4 会话加载自愈 `heal_loaded_messages`（heal.rs，722 行）

恢复会话时、**第一次 API 调用前**修复破损历史（否则下轮请求直接 400）：

1. **超大工具结果收缩**（40K 字符帽；且是"地板不是天花板"——正在编辑中的 read 摘录保留更高帽）
2. **工具调用配对修复**：assistant.tool_calls 与 tool 响应配对。关键演进（LOOP-6）：早期版本丢弃不完整的 assistant+结果（丢失模型已见过的真实结果）；现版本**保留全部已有结果 + 为每个缺失 id 合成 error 形状的合成 tool result**（`is_error: true` + "调用被中断"文案），让 provider 看到 N 调用/N 结果的完整对

DeepOrca 的 `validateCompactionPairing` + converter 配对已覆盖压缩路径的完整对断言，但**没有**"加载时合成缺失结果"与"超大结果收缩"两步——列为后续项。

### 2.5 能力评分与修复预算（capability.rs / failure_tracker.rs / storm.rs）

- `repair_invalid`（修复失败，权重 4 最强信号）/ `repair_successful`（权重 1）/ `scavenged_calls` 计入模型能力评分；`repair_invalid=4`、`max_failure_streak=3` 等约 14 个行为阈值
- 工具风暴（同工具连发）检测与抑制
- 用于"这个模型是否适合当前任务"的动态判断

启发：DeepOrca 可在遥测中记录 repair/scavenge 命中率作为弱模型信号。本轮先做计数埋点。

## 三、DeepOrca 吸收决策

| dirge 机制                                                     | 决策                                                           | 理由                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| repair_truncated_json                                          | **本轮吸收**                                                   | 纯函数零依赖，直击 max_tokens 截断；TS 移植直白      |
| 文本通道拾荒（围栏/标签/裸 JSON 三模式 + 名字门 + 双计数切除） | **本轮吸收**（DSML 模式略去——DeepSeek 走结构化通道时无此泄漏） | 弱模型最高频的"格式错误工具调用"形态                 |
| 环绕文本剥离（前导散文中的 {...} 提取）                        | **本轮吸收**（裸 JSON 扫描的自然副产品）                       | "Here are the args: {...}" 形态常见                  |
| 验证-修复（schema 靶向）                                       | 不吸收（记录）                                                 | 需 schema 注解层 + jsonschema 依赖；先拿无依赖的 80% |
| 会话加载自愈（合成缺失结果/超大收缩）                          | 不吸收（记录）                                                 | 独立回路，另行立项                                   |
| 能力评分/修复预算                                              | 只做命中计数埋点                                               | 评分体系是独立大工程                                 |

实施：`packages/core/src/common/tool-call-repair.ts`（修复器 + 拾荒器，纯函数）+ executor/session 接线 + 弱模型形状测试矩阵。

## 四、许可核查

- vycode：仓库根 LICENSE（研究时未见 COPY 左强限制；吸收为机制思想，非代码移植）
- dirge：根目录 COPYING + LICENSE，AGPL 系概率高（含大量 Reasonix/opencode 移植声明）。**本吸收为机制重实现（clean-room 按 TS 语义重写，非代码逐行翻译），且 DeepOrca 为 MPL-2.0**——机制层面的算法思想（栈式闭合、平衡对象扫描、名字门）不受版权约束；实现从零编写。
