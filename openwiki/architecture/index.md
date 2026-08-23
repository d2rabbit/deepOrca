# 文件

- [消息转换与工具调用修复](message-conversion.md) - OpenAIMessageConverter 如何把 SessionMessage[] 转为 ChatCompletionMessageParam[]，以及弱模型工具调用截断修复与思考模式请求选项。
- [系统架构总览](overview.md) - DeepOrca 整体架构：为 DeepSeek 调优的编码 agent harness，四包 npm workspaces 分层、layer rules、端到端数据流与分支/发布策略。
- [权限系统](permission-system.md) - 基于副作用分类的作用域权限引擎：10 个权限作用域、computeToolCallPermissions 决策、Plan Mode 强制 ask、quarantine 收紧、路径级始终允许与 ToolExecutionGate。
- [提示词系统](prompt-system.md) - core 的提示词工程：系统提示链构建顺序、工具文档 EJS 模板、Skills 注入、Plan Mode 提示、运行时上下文与 OS-Link 命令字典。
- [沙箱体系（P1–P3）](sandbox.md) - 副作用审计总线、Sans-IO 策略引擎与 macOS sandbox-exec 后端：链式 hash JSONL 审计、10 作用域策略矩阵、generation fencing、bash 沙箱接线与降级必报。
- [会话生命周期与 LLM 工具调用循环](session-lifecycle.md) - SessionManager 完整生命周期：会话创建/回复/激活、LLM 工具调用循环、自动恢复、压缩、持久化与 undo 文件历史，以及 session-index 防抖不变式。
