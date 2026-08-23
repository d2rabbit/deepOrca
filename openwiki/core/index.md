# 文件

- [Actions 能力层](actions.md) - defineAction/ActionRegistry 的「一次定义、多处调用」机制：注册、三面暴露（LLM 工具/IPC/组合执行）、进度与取消，以及全部内置 action 族。
- [公共工具库（common/）](common-utilities.md) - core 的公共工具按职责分组：OpenAI 客户端族、主机集成与运行时解析、文件与状态、错误与诊断、网络与安全、会话辅助。
- [MCP 生命周期与内置服务器](mcp.md) - McpManager 客户端管理、stdio JSON-RPC、工具发现缓存、崩溃处理，以及内置 MCP 服务器（codegraph/serena/skill-spector/dembrandt/a2ui/activity-frames/vision/gitmcp）与控制器 seam 模式。
- [@deeporca/core 总览](overview.md) - core 包的公共 API 导出面、目录布局、无 UI 依赖原则、ESM 构建注意与测试运行方式。
- [语义路由](routing.md) - 基于嵌入的技能/工具召回：SkillRouter.shortlist、ToolRouter.select、composeRoute 组合路由、RoutingFacade 会话冻结、技能分片、fail-open 降级与嵌入服务生命周期。
- [设置系统](settings.md) - DeepcodingSettings schema、用户/项目设置解析与合并、多端点模型注册、模型族能力注册表（五系列）、配置文件位置与产品自身配置目录。
- [任务轨迹树（TaskTreeService）](task-tree.md) - 工作区级任务轨迹：树/分支/节点、reflog、快照物化、merge/fork/switch/abandon、会话绑定、Plan 物化与记忆驱动 fork。
- [内置工具与 ToolExecutor](tools.md) - 8 个内置工具的契约与实现：bash/read/write/edit/AskUserQuestion/UpdatePlan/WebSearch/WebFetch，ToolExecutor 分发、别名、MCP 回退与 1:1 结果映射。
