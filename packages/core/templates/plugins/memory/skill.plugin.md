---
name: memory
description: "记忆沉淀插件 — 跨会话长期记忆与行为记忆采集"
category: memory
icon: memory
mcp:
  - activity-frames
external:
  - name: TencentDB-Agent-Memory
    description: "跨会话长期记忆 — 四层记忆架构（L0原始→L1原子事实→L2场景→L3画像）"
---

# 记忆沉淀插件

跨会话记忆与行为分析能力。记住用户偏好、项目上下文、历史决策。

## 包含能力

### MCP 服务器

- **activity-frames** — 进程内 MCP 服务器。多源行为记忆采集，整合 session/git/shell/file 数据源，提供 `get_context`、`get_hotspots`、`get_workflows` 等工具。

### 外部服务

- **TencentDB-Agent-Memory** — 跨会话长期记忆系统（HTTP 侧车）。四层记忆架构：
  - L0：原始对话数据
  - L1：原子事实提取
  - L2：场景级关联
  - L3：用户画像

  会话开始时自动 recall 相关记忆注入系统提示；每轮对话后自动 capture 存储。默认关闭，需用户手动启用。
