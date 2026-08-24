# 文件

- [设计工作流（DesignPanel → 设计 action → A2UI/.dd → 交付包）](design-pipeline.md) - 设计面板驱动 design materialize/extract/audit action，产出 A2UI surface 或 .dd 文档，经 design-store 打包 .ddp/.ddu 并可在原型窗口运行。
- [知识构建（CodeGraph → OpenWiki → arch-scan 架构图）](knowledge-build.md) - 一键构建串行流水线：BuildJobManager 驱动 core action 依次完成 CodeGraph 索引、OpenWiki 文档与架构图扫描（Mermaid 文档），含阶段可观测、取消传播与失败降级。
- [用户提示 → LLM 工具循环端到端](llm-tool-loop.md) - 从 renderer 发送提示到工具结果回写的完整链路：IPC、SessionBridge、SessionManager 激活循环、消息转换、ToolExecutor 与权限门。
- [记忆流水线（L0–L3 捕获/召回/注入）](memory-pipeline.md) - 会话结束捕获、L0→L3 蒸馏、创建会话时的召回注入（2s race）与记忆工具的端到端流程。
