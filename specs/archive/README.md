# specs/archive — 已收官 spec 归档

> **归档原则（2026-09-02 立）**：终判 ✅ 且**无未决项**（无待人工 / 待实施 / 待验证）的 spec 目录整体 `git mv` 移入此处，内容原样保留——它们仍是已交付能力的实现依据与历史记录，只是不再活跃。部分实现（🟡）或有未决项的 spec 留在 `specs/` 原位。
>
> **引用约定**：全仓引用已随归档改写为 `specs/archive/<name>/`；活 spec 引用归档件用 `../archive/<name>/`；归档件引用活 spec 用 `../../<name>/`。
>
> **回归**：若归档 spec 重新开工（如 redesign 唤醒），`git mv` 移回 `specs/<name>/` 并同步改写引用。

| spec | 终判 | 归档日期 | 备注 |
| --- | --- | --- | --- |
| [a2ui-integration](./a2ui-integration/design.md) | ✅ | 2026-09-02 | A2UI 全链路（后续演进边界见 design-systems-advance 附录 B） |
| [activity-frames](./activity-frames/design.md) | ✅ | 2026-09-02 | 行为记忆双管线 + 9 MCP 工具 |
| [deep-design](./deep-design/design.md) | ✅ | 2026-09-02 | .dd 管线（.dd v2 演进在 design-systems-advance） |
| [define-action](./define-action/design.md) | ✅ | 2026-09-02 | action 原语 LLM/MCP/IPC 三面到达 |
| [task-tree](./task-tree/design.md) | ✅ | 2026-09-02 | 任务树 P0–P2；UI 形态后被 task-tree-hub 推翻，TaskTreeService 仍是会话域数据源 |
| [text-embedding](./text-embedding/design.md) | ✅ | 2026-09-02 | Granite 97M + 路由/记忆双消费方 |
| [memory-remediation](./memory-remediation/design.md) | ✅ | 2026-09-02 | 记忆管线四阶段修复 tasks 20/20 落地；TDAI 上游策略为活文档 |
