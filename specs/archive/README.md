# specs/archive — 已收官 spec 归档

> **归档原则（2026-09-02 立，2026-09-03 扩展）**：终判 ✅ 且**无未决项**（无待人工 / 待实施 / 待验证）的 spec 目录整体 `git mv` 移入此处，内容原样保留——它们仍是已交付能力的实现依据与历史记录，只是不再活跃。2026-09-03 起：人工走查项统一移交预生产测试清单后即可归档；主体落地但有待复核项的入 [`review/`](./review/README.md)；已在未合并 `next/*` 分支实现的入 [`branch-implemented/`](./branch-implemented/README.md)；拍板废弃的入 [`deprecated/`](./deprecated/README.md)。部分实现（🟡）且待复核项未清的 spec 留在 `specs/` 原位。
>
> **引用约定**：全仓引用已随归档改写为 `specs/archive/<name>/`；活 spec 引用归档件用 `../archive/<name>/`；归档件引用活 spec 按层级用 `../../`（本目录）或 `../../../`（review / branch-implemented / deprecated 子目录）。
>
> **回归**：若归档 spec 重新开工（如 redesign 唤醒），`git mv` 移回 `specs/<name>/` 并同步改写引用。

## ✅ 收官归档

| spec | 终判 | 归档日期 | 备注 |
| --- | --- | --- | --- |
| [a2ui-integration](./a2ui-integration/design.md) | ✅ | 2026-09-02 | A2UI 全链路（后续演进边界见 design-systems-advance 附录 B） |
| [activity-frames](./activity-frames/design.md) | ✅ | 2026-09-02 | 行为记忆双管线 + 9 MCP 工具 |
| [deep-design](./deep-design/design.md) | ✅ | 2026-09-02 | .dd 管线（.dd v2 演进在 design-systems-advance） |
| [define-action](./define-action/design.md) | ✅ | 2026-09-02 | action 原语 LLM/MCP/IPC 三面到达 |
| [task-tree](./task-tree/design.md) | ✅ | 2026-09-02 | 任务树 P0–P2；UI 形态后被 task-tree-hub 推翻，TaskTreeService 仍是会话域数据源 |
| [text-embedding](./text-embedding/design.md) | ✅ | 2026-09-02 | Granite 97M + 路由/记忆双消费方 |
| [memory-remediation](./memory-remediation/design.md) | ✅ | 2026-09-02 | 记忆管线四阶段修复 tasks 20/20 落地；TDAI 上游策略为活文档 |
| [skill-routing](./skill-routing/design.md) | ✅ | 2026-09-03 | G1/G2/M4/R1-R4 + 目标表 G3 分片召回全落地，无未决项 |
| [token-local-accounting](./token-local-accounting/design.md) | ✅ | 2026-09-03 | usage-ledger / token-counter / tokens-summary 落地；T7 打包实测移交预生产清单 |
| [mcp-sdk-migration](./mcp-sdk-migration/design.md) | ✅ | 2026-09-03 | 官方 SDK 全切换；§8-3 外部 server 实机验证移交预生产清单 |
| [gitmcp-local-module](./gitmcp-local-module/design.md) | ✅ | 2026-09-03 | 任务 1-11 全勾；任务 12 手测移交预生产走查批 |
| [ui-domain-regroup](./ui-domain-regroup/design.md) | ✅ | 2026-09-03 | tasks 10/10；真机 UI 实测移交预生产走查批 |
| [review-module](./review-module/design.md) | ✅ | 2026-09-03 | 审查模块主体 + G1-G10 修复落地，理论完备收官（用户拍板） |
| [sandbox](./sandbox/design.md) | ✅ | 2026-09-03 | P0–P2 主体 40/45 收官；5 项未决项延伸为 [specs/sandbox-next/](../sandbox-next/design.md) |
| [index-knowledge-rework](./index-knowledge-rework/design.md) | ✅ | 2026-09-03 | R2 全部任务落地标记结束（用户拍板），tasks 全量勾选 |

## 🔍 审查归档（复核通过后转正）

见 [review/README.md](./review/README.md)——task-tree-hub（收尾清单+真机走查待复核）· skill-eval（T2.3 对拍待真实 LLM）。

## 🌿 分支实现归档（分支合并后转正）

见 [branch-implemented/README.md](./branch-implemented/README.md)——coord-chain（OC1–OC2 已在 `next/coord-chain` 实现，未合并主线）。

## ❌ 废弃归档（保留供溯源）

见 [deprecated/README.md](./deprecated/README.md)——pre-production（2026-09-03 出口门槛毙掉）。
