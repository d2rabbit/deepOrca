# 文件

- [Actions 能力层（defineAction / ActionRegistry）](actions.md) - defineAction 定义可组合的项目能力：注册表、三面暴露（LLM 工具/IPC/组合工作流）、内置 action 族、无会话后台任务通道（runBackgroundTask）与聚焦测试。
- [Common Utilities Library (common/)](common-utilities.md) - The common utilities of core are grouped by responsibility: OpenAI client family, host integration and runtime resolution, files and state, errors and diagnostics, networking and security, and session assistance.
- [MCP Lifecycle and Built-in Servers](mcp.md) - McpManager client management, stdio JSON-RPC, tool discovery caching, crash handling, and built-in MCP servers (codegraph/serena/skill-spector/dembrandt/a2ui/activity-frames/vision/gitmcp) along with the controller seam pattern.
- [@deeporca/core Overview](overview.md) - The core package's public API export surface, directory layout, no-UI-dependency principle, ESM build notes, and how tests are run.
- [语义路由](routing.md) - 基于嵌入的技能/工具召回：SkillRouter.shortlist、ToolRouter.select、组合路由、会话冻结、fail-open 降级与嵌入服务生命周期。
- [Settings System](settings.md) - DeepcodingSettings schema, user/project settings parsing and merging, multi-endpoint model registration, model family capability registry (five series), configuration file locations, and the product's own configuration directory.
- [任务轨迹树（TaskTreeService）](task-tree.md) - 工作区级任务轨迹树：内容寻址节点、分支/合并/归档、会话绑定、记忆 fork、桌面跨工作区读取与操作轨迹（taskTreeTrajectory）。
- [内置工具与 ToolExecutor](tools.md) - 刻意精简的内置工具集（bash/read/write/edit/AskUserQuestion/UpdatePlan/WebSearch/WebFetch）与 ToolExecutor 执行契约（含 snippet 编辑）。
