# DeepOrca 架构

npm workspaces monorepo（4 包）：Electron 桌面端 + 共享核心引擎 + 记忆/嵌入流水线，面向 DeepSeek 模型的编码 Agent 框架。

## Overall Architecture 整体架构

四包分层：desktop 依赖 core 与 memory，core/memory 按需动态加载 embedding（进程级单例，持有 onnxruntime 句柄）。

```mermaid
flowchart TD
  subgraph Desktop["Electron 桌面端 (packages/desktop)"]
    R["Renderer — React 组件树（无 Node 访问）"]
    M["Main — SessionBridge / IPC 注册 / vendored 工具"]
  end
  CORE["@deeporca/core — 会话引擎 + 8 内置工具 + MCP + 权限"]
  MEM["@deeporca/memory — L0-L3 记忆管线"]
  EMB["@deeporca/embedding — Granite 97M 本地嵌入"]

  R -->|"typed window.deeporca (preload)"| M
  M -->|"会话循环 + 工具执行"| CORE
  M -->|"MemoryProvider 注入"| MEM
  CORE -.->|"路由: 动态 import"| EMB
  MEM -.->|"向量召回: 动态 import"| EMB

  classDef entry stroke:#3b82f6,stroke-width:2.5px
  class R,M entry
```

## Data Flow 数据流

一轮会话的循环：用户输入 → SessionManager 组装前缀稳定的消息链 → DeepSeek 流式补全 → tool_calls 执行 → 结果回写再循环，直到无工具调用。

```mermaid
flowchart LR
  U["用户输入"] --> SM["SessionManager<br/>buildMessages + 前缀缓存友好排序"]
  SM -->|"流式补全"| LLM["DeepSeek API<br/>(OpenAI 兼容)"]
  LLM -->|"tool_calls"| TE["ToolExecutor<br/>8 内置 + MCP 工具"]
  TE -->|"工具结果消息"| SM
  SM -->|"记忆召回 / 捕获"| MEM[("memory<br/>L0-L3 + sqlite 向量")]
  TE --> FS[("文件系统 / 子进程 / MCP 生态")]

  classDef entry stroke:#3b82f6,stroke-width:2.5px
  class U entry
```

## Dependency Map 依赖方向

分层红线：core 不得反向依赖 desktop；UI-free（不 import react/electron、不直接 console）。

```mermaid
flowchart TD
  DESK["desktop"] --> CORE["core"]
  DESK --> MEM["memory"]
  CORE -.-> EMB["embedding"]
  MEM -.-> EMB

  classDef external stroke-dasharray: 4 3
```
