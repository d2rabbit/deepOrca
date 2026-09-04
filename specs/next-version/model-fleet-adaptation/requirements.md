# 模型舰队收官适配 — 需求（requirements）

> 对应设计：[design.md](./design.md) / 任务：[tasks.md](./tasks.md)。
> 2026-08-21 立稿（随抽象设计深化稿一并补齐，未实施）。

## 1. 问题与范围

DeepOrca 目前为 DeepSeek 单系列调优：模型知识散落在能力常量、思考开关构造、reasoning 消息转换、压缩阈值与 5 处硬编码副模型调用点。用户端点一旦切换到 GLM / Kimi / MiniMax / Qwen，后台任务（压缩、技能匹配、动作分类、提示增强、记忆抽取）仍会向非 DeepSeek baseURL 发送 `deepseek-v4-flash`——必然 404；思考协议与 reasoning 字段也按 DeepSeek 契约写死。

**范围**：五个系列（DeepSeek V4 / GLM 5 / Kimi 2.5→K3 / MiniMax M3 / Qwen 3.8），**仅 OpenAI chat-completions 兼容格式**，按已拍板的 **G0 原生路线**实施（双后端方案已否决）。

**系列优先级**：DeepSeek V4 基线复核、GLM 5、Kimi 2.5→K3 = P0；MiniMax M3、Qwen 3.8 = P1。

## 2. 用户故事

- 作为配置了 GLM/Kimi 端点的用户，我希望主循环与**所有**后台任务都在我配置的厂商上运行，不再出现跨厂商 404。
- 作为 DeepSeek 用户，我希望升级本版本后行为**零变化**（请求字节、压缩时机、思考模式、副模型选择）。
- 作为使用非五系列模型（自建网关、其他 OpenAI 兼容厂商）的用户，我希望得到与今天完全一致的保守兼容行为（fail-open）。
- 作为在端点上按模型登记了能力（`ModelRegistration.thinking/vision`）的用户，我希望我的显式登记优先于内置家族默认值。
- 作为维护者，我希望新增一个模型系列只改**一处注册表条目**加一张验证清单，不触碰任何调用点代码。

## 3. 验收标准（EARS）

- **R1 单一注册表解析**：When 任一 core 代码路径拿到一个已登记家族的 model 字符串，the harness shall 从唯一注册表解析其全部能力（思考默认 / 多模态 / 上下文窗口 / 轻量等价物 / 协议分派键），且调用点不携带任何 per-厂商模型知识。
- **R2 未知模型 fail-open**：When model 字符串无法命中任何注册表条目，the harness shall 施加与重构前语义逐项等价的保守默认（思考默认关、允许多模态、128K 压缩阈值、思考请求体维持现形状、reasoning 读取保留 `reasoning_content ?? reasoning` 双字段回退）。
- **R3 后台任务零跨厂商调用**：While 会话端点解析为非 DeepSeek 家族，every 后台 LLM 任务（压缩 / 技能匹配 / 动作分类 / 提示增强 / 技能分解 / 记忆抽取）shall 使用某个已配置端点实际服务的模型，且不得向非 DeepSeek baseURL 发送 DeepSeek 专属 model 字符串。
- **R4 DeepSeek 零回归**：While 会话使用 DeepSeek 家族模型，the harness shall 产生与重构前逐字节相同的请求（思考开关参数、reasoning 回显、压缩阈值、后台任务 model 选择）。
- **R5 用户登记优先**：When 用户在某端点的 `models[]` 中为某 model 显式登记了 `thinking`/`vision`，该声明 shall 覆盖家族表默认值；未登记字段回退家族表。
- **R6 协议分派**：When 已登记家族定义了自己的思考开关参数或 reasoning 字段契约，请求构造与消息回显/读取 shall 遵循该家族契约；未登记家族 shall 维持现状形状。
- **R7 渲染层单一事实源**：When 渲染层展示模型能力标记或基于上下文窗口的用量条，it shall 从与 core 相同的注册表模块取值，desktop 代码中不再存在复制的模型集合常量。
- **R8 系列可扩展性**：When 新增一个模型家族，改动 shall 局限于一条注册表条目及该系列的验证清单，调用点零改动。

## 4. 业务规则与约束

- core 保持 UI-free；注册表模块必须**零依赖**（不 import Node 内置、不 import openai/undici），以同时供 main 进程与 renderer bundle 引用。
- 不引入厂商 SDK，保持裸 OpenAI 兼容 client；不改变现有多端点设置结构（`endpoints[]` + primary/secondary/vision 角色）。
- 不做模型自动选择/智能路由——家族解析只服务能力查询与后台任务选型，不改变用户显式选型。
- 各系列确切 API 参数（思考开关参数名、reasoning 字段名、窗口数值）**实施时按厂商当日文档核填**，spec 与代码不臆造。

## 5. 非目标

见 [design.md §六](./design.md)：Claude/Anthropic 消息格式、各家非-OpenAI-chat 新 reasoning 协议（Backlog 另行立项）；双后端/外部 agent（已否决留档）；厂商专有增值特性；嵌入改造；厂商 SDK。
