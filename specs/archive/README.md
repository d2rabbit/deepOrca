# specs/archive — 已收官 spec 归档

> **归档原则（2026-09-02 立，2026-09-03 扩展）**：终判 ✅ 且**无未决项**（无待人工 / 待实施 / 待验证）的 spec 目录整体 `git mv` 移入此处，内容原样保留——它们仍是已交付能力的实现依据与历史记录，只是不再活跃。2026-09-03 起：人工走查项统一移交预生产测试清单后即可归档；主体落地但有待复核项的入 [`specs/review-ing/`](../review-ing/README.md)；已在未合并 `next/*` 分支实现的入 [`specs/branch-implemented/`](../branch-implemented/README.md)；拍板废弃的入 [`deprecated/`](./deprecated/README.md)。部分实现（🟡）且待复核项未清的 spec 留在 `specs/` 原位。
>
> **引用约定**：全仓引用已随归档改写为 `specs/archive/<name>/`；活 spec 引用归档件用 `../archive/<name>/`（review-ing / branch-implemented 等根级区同理 `../<区名>/<name>/`）；归档件引用活 spec 按层级回溯。
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
| [memory-audit](./memory-audit/design.md) | ✅ | 2026-09-04 | memory.audit action P0 扫描+P1 合成审核+P2 受控写回全落地（用户拍板跳过数据门）；P3 泛化另行立项 |
| [cmb-adoption](./cmb-adoption/design.md) | ✅ | 2026-09-04 | CodeBrain/MemBrain 理念采纳 CMB-1/2/3/4/5/7 六项四批次同日落地（提交 007d57e8/584440aa/95e0ac5d/1e5cdf95）；CMB-6 对账同步入台账，CMB-8/9/10/11 留台账观察；未决模块延伸为 [cmb-next](../next-version/cmb-next/design.md) |
| [sandbox](./sandbox/design.md) | ✅ | 2026-09-03 | P0–P2 主体 40/45 收官；5 项未决项延伸为 [specs/sandbox-next/](../next-version/sandbox-next/design.md) |
| [index-knowledge-rework](./index-knowledge-rework/design.md) | ✅ | 2026-09-03 | R2 全部任务落地标记结束（用户拍板），tasks 全量勾选 |
| [design-md-collection](./design-md-collection/design.md) | ✅ | 2026-09-18 | design-md 三源设计文档收集（本地目录 + vendored design-md + 复刻 design.extract）S1–S5 全落地（含真机走查修复批），收尾勾选提交 |
| [design-stage-gates](./design-stage-gates/design.md) | ✅ | 2026-09-18 | 设计管线五 stage 机械门 + OCR 分层失败语义 WP1–WP4 全落地（mutation ×5）；门与失败分层域由 spec-graph-adoption 对账沿用 |
| [prd-theme-layer](./prd-theme-layer/design.md) | ✅ | 2026-09-18 | PRD 级主题层：主题 CRUD / 继承注入 / 目录分组区 / 两工作台主题条；p-core 真机走查线收官（`222a1913d`） |
| [artifact-landing](./artifact-landing/design.md) | ✅ | 2026-09-18 | 产物落地三链（open-file-viewer 二进制兜底预览 / marp 幻灯片输出 / 落地简报防塌生成器）：tasks 19/19 + TD 供应链收尾 + 审查修复批；状态头「未实现」为过期残留 |
| [sop-extraction](./sop-extraction/design.md) | ✅ | 2026-09-18 | SOP 萃取通道：memory.distill P0+P1+P2 全落地，独立审查 3 项发现全部闭合（留痕 §4.4），tasks 21/21 |
| [arch-map-reinforce](./arch-map-reinforce/design.md) | ✅ | 2026-09-18 | 架构图强化层 v2：P0+P1+P2（R1–R6）代码面落地；真机走查移交预生产清单 |
| [repair-rule-memory](./repair-rule-memory/design.md) | ✅ | 2026-09-18 | 修复规则记忆：task-tree fork 谱系配对 + 确定性 diff + AskUserQuestion 审查回写；P0+P1 + T2 真机验证收官（`dedfda064`），tasks 10/10 |
| [arch-visual-readback](./arch-visual-readback/design.md) | ✅ | 2026-09-18 | 架构图视觉回读闭环：布局契约 / containment / vision 四问分层三门 + 定向修订 ≤2 轮；T2 真机两态收官 + 四处真机缺陷修复回写 §0.5（`dedfda064`），tasks 10/10 |
| [editor-copilot](./editor-copilot/design.md) | ✅ | 2026-09-19 | 编辑器结对与内核域：Monaco→CodeMirror 6 内核迁移 / AI 结对画布 / 编辑器智能体数字体 / LSP 裸帧中继 / 任务树集成已随 `feat/modern-ui-redesign` 落地（用户拍板收官） |
| [leafer-ui-engine](./leafer-ui-engine/design.md) | ✅ | 2026-09-19 | UI-Design 引擎替换为 LeaferJS：WP0–WP5 全落地（契约/修复环/画布微调/可交互 .ddu 导出/自检自修复/EARS 17 双栈路由）+ 两轮审查修复批；真机走查移交预生产清单；未勾 7 项为后续延伸/上游跟踪。**代码核实改判收官**（状态头「未实施」为立项残留，2026-09-19 修正） |
| [clay-ui-runtime](./clay-ui-runtime/design.md) | ✅ | 2026-09-19 | UI-Design 并行渲染/导出运行时：WP0 spike kill gate **PASS** + WP1–WP4 全落地（vendor+wrapper / 确定性编译器 / .ddu 自包含 preview.html / 收编，15 例全绿 + guard 锁界）+ E2E 加固批（五缺陷 + wrapCJK 重写 195s→117ms）+ vendor 指纹防漂移；端到端走查移交预生产清单。**复核改判收官**（审查区「WP0 未跑」登记不实，2026-09-19 修正，见其 §6 勘误） |

## 🧊 冻结归档（用户拍板停止推进，保留供唤醒）

> 2026-09-19 立（design-systems-advance / prototype-reliability / prompt-doc-chain 三项用户拍板冻结迁入）。此前冻结先例（chat-redesign / editor-agent，2026-09-06 批次入档未单列）一并补登。回归同总则：唤醒时 `git mv` 移回 `specs/<name>/` 并同步改写引用。

| spec | 冻结日期 | 冻结时状态 |
| --- | --- | --- |
| [chat-redesign](./chat-redesign/design.md) | 2026-09-06 | 主会话重设计 P1/P3/P4 主体落地后冻结（补登） |
| [editor-agent](./editor-agent/design.md) | 2026-09-06 | 编辑器数字体 B3c 部分落地，域并入 editor-copilot 后冻结（补登） |
| [design-systems-advance](./design-systems-advance/design.md) | 2026-09-19 | 设计模块进阶唯一方案（含 pm-design-v2 / prototype-companion 并入工件）；suite/version v2 + OpenUI 生成链 + .ddp/.ddu 导出已落地，复审修复批中止冻结 |
| [prototype-reliability](./prototype-reliability/design.md) | 2026-09-19 | 原型生成链路根治四工作包：方案定稿未实施即冻结（§4 原型绘制引擎重规划开放决策底座随稿保留） |
| [prompt-doc-chain](./prompt-doc-chain/design.md) | 2026-09-19 | 设计链提示词文档轨：实施中（5/18）冻结；pd→pm 更名与旧数据读归一已落地生效 |

## 🔍 审查归档（复核通过后转正）

见 [../review-ing/README.md](../review-ing/README.md)——task-tree-hub（收尾清单+真机走查待复核）· skill-eval（T2.3 对拍待真实 LLM）。

## 🌿 分支实现参考（2026-09-08 起：不再走「分支合并后转正」流转）

见 [../branch-implemented/README.md](../branch-implemented/README.md)——coord-chain（OC1–OC2 已在 `next/coord-chain` 实现；**2026-09-08 用户拍板改为本阶段方案、不再经分支实现与合并**，该快照降级为协议底层实现参考，上层交互以活跃 spec 设计稿 v6 为准）。

## ❌ 废弃归档（保留供溯源）

见 [deprecated/README.md](./deprecated/README.md)——pre-production（2026-09-03 出口门槛毙掉）。
