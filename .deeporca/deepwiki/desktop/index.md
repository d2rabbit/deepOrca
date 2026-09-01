# 文件

- [Activity-Frames 行为记忆](activity-frames.md) - 进程内 MCP 服务器采集文件/Git/Shell/会话活动为行为帧：实体模型、会话化、活动数据库、五类采集器与 core seam。
- [Build and Vendoring](build-and-vendoring.md) - Desktop build (three esbuild bundles), the vendoring mechanism for the 13 vendor scripts, and the electron-builder packaging and release flow.
- [Design System (DeepDesign / A2UI / OpenUI Lang / dembrandt)](design-system.md) - 三大设计能力（DeepDesign .dd 文档、A2UI 交互原型、OpenUI Lang 渲染）及其共用的进程内设计 MCP 服务器、design-store 持久化、dembrandt 品牌摄取；A2UI 官方 v0.9.1 协议与 Mermaid 架构图持久化。
- [IPC 契约（shared/ipc.ts）](ipc-contract.md) - 两端共享的 IPC 契约：IpcRequest/IpcEvent 通道清单、关键类型（含符号关系图/轨迹/构建阶段）、三档权限策略与 sender 校验、跨工作区任务树读取。
- [知识索引与知识模块（Knowledge / Index & Knowledge）](knowledge-indexing.md) - 四知识源（CodeGraph/OpenWiki/AGENTS/架构图）的聚合状态（内容权重守卫）、BuildJobManager 后台构建（3 阶段可观测、首坏阶段即停、arch 后置验证）、构建前置 git 引导（preflight/bootstrap）、知识 tab 四个子页签、符号关系图（R3-6）与架构图两代产物（Mermaid/JSON）及 KnowledgeReadArchmap 安全围栏。
- [Main Process Composition Root (main/index.ts)](main-process.md) - Electron main process startup sequence, module-level singletons, IPC registration groups, window security policy, controller injection, and lifecycle cleanup.
- [主进程工具控制器（main/tools/）](main-tools.md) - host 注入的外部能力控制器清单：OCR/Wiki/Serena/CRG/SkillSpector/CodeGraph/Vision/WebFetch/GitMCP/Dembrandt/DdPackage/Editor/A2UI 及安全降级红线。
- [@deeporca/desktop Overview](overview.md) - Three-layer architecture of the Electron desktop client (main/preload/renderer), shared IPC contract, build artifacts, and dependency relationships.
- [Plugin System](plugins.md) - Plugin manager (skill search/docs/MCP add/remove), built-in plugin templates (8 packages), skill discovery priority, and plugin center UI.
- [Preload Bridge](preload.md) - The preload implementation that exposes the typed window.deeporca under contextIsolation, plus the restricted preload for A2UI prototype windows (prototype.cjs).
- [渲染层组件](renderer-components.md) - components/ 目录按领域分组：对话、设置/插件、知识、设计、任务、工作台组件及其职责与数据流。
- [渲染层（renderer）](renderer.md) - React 渲染层架构：App 状态机、hooks、i18n、lib 工具、markdown 渲染与 UI 组件库。
- [SessionBridge](session-bridge.md) - desktop 与 core 的边界对象：按项目根包装 SessionManager、转发引擎事件、委托桌面服务（git/gitmcp/mcp-store/插件/归档/activity-frames）、权限中继与序列化。
- [技能评估与升级 harness（specs/skill-eval）](skill-evals.md) - 技能质量可回归的评估体系：skill-up 固定版本二进制、eval 运行器、deeporca 评估引擎与 CI 接线。
