# 文件

- [Message Conversion and Tool Call Repair](message-conversion.md) - How OpenAIMessageConverter converts SessionMessage[] to ChatCompletionMessageParam[], plus weak-model tool call truncation repair and thinking-mode request options.
- [系统架构总览](overview.md) - DeepOrca 整体架构：为 DeepSeek 调优的编码 agent harness，npm workspaces 四包分层、layer rules、端到端数据流与分支/发布策略。
- [权限系统](permission-system.md) - 基于副作用分类的作用域权限模型：10 作用域、决策优先级、quarantine、路径级始终允许与 bash 副作用声明。
- [提示词系统](prompt-system.md) - prompt.ts 构建全部提示模板：缓存稳定前缀、工具文档、Skills 注入、Plan Mode、运行时上下文与压缩提示。
- [沙箱体系（P1–P3）](sandbox.md) - 三级渐进实现：副作用审计总线、sans-I/O 策略引擎与 macOS sandbox-exec 后端，含降级必须显式报告的约束。
- [会话生命周期与 LLM 工具循环](session-lifecycle.md) - SessionManager 的会话状态机、创建/回复/激活循环、压缩/持久化/undo、finalization hooks、静默子代理与无会话后台任务（runBackgroundLlmTask）不变式。
