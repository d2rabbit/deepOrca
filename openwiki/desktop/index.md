# 文件

- [Activity-Frames 行为记忆（specs/activity-frames）](activity-frames.md) - 进程内 MCP 服务器采集文件/Git/Shell/会话活动为行为帧：实体模型、sessionization、活动数据库、五采集器与 core seam。
- [构建与 vendoring](build-and-vendoring.md) - desktop 构建（esbuild 三个 bundle）、13 个 vendor 脚本的 vendoring 机制、electron-builder 打包与发布流程。
- [设计系统（DeepDesign / A2UI / OpenUI Lang / dembrandt）](design-system.md) - 三大设计能力——DeepDesign .dd 文档、A2UI 交互原型、OpenUI Lang 渲染——及其共享的进程内设计 MCP 服务器、design-store 与 dembrandt 品牌摄取。
- [IPC 契约（shared/ipc.ts）](ipc-contract.md) - main/preload/renderer 共享的 IPC 契约：IpcRequest 通道、IpcEvent 事件、序列化类型与特权通道策略。
- [知识索引（CodeGraph / CRG / OpenWiki / arch-scan）](knowledge-indexing.md) - 知识仪表盘与索引构建：CodeGraph 符号库、CRG 风险图、OpenWiki 文档、AGENTS 就地读取、arch-scan 架构图与 BuildJobManager 后台构建。
- [主进程组合根（main/index.ts）](main-process.md) - Electron 主进程的启动序列、模块级单例、IPC 注册分组、窗口安全策略、控制器注入与生命周期清理。
- [主进程工具控制器](main-tools.md) - main/tools/ 下的外部能力控制器：OCR 评审、OpenWiki、Serena、CRG、SkillSpector、Vision MCP、WebFetch 提供器、GitMCP 工具与编辑器处理。
- [@deeporca/desktop 总览](overview.md) - Electron 桌面客户端的三分层架构（main/preload/renderer）、共享 IPC 契约、构建产物与依赖关系。
- [插件系统](plugins.md) - 插件管理器（技能搜索/文档/MCP 增删）、内置插件模板（8 包）、技能发现优先级与插件中心 UI。
- [Preload 桥](preload.md) - contextIsolation 下暴露类型化 window.deeporca 的 preload 实现，以及 A2UI 原型窗口的受限 preload（prototype.cjs）。
- [渲染层组件](renderer-components.md) - components/ 目录按领域分组：对话、设置/插件、知识、设计、任务、工作台组件及其职责与数据流。
- [渲染层（renderer）](renderer.md) - React 渲染层架构：App 状态机、hooks、i18n、lib 工具、markdown 渲染与 UI 组件库。
- [SessionBridge](session-bridge.md) - desktop 与 core 的边界对象：按项目根包装 SessionManager、转发引擎事件、委托桌面服务（git/gitmcp/mcp-store/插件/归档/activity-frames）、权限中继与序列化。
- [技能评估与升级 harness（specs/skill-eval）](skill-evals.md) - 技能质量可回归的评估体系：skill-up 固定版本二进制、eval 运行器、deeporca 评估引擎与 CI 接线。
