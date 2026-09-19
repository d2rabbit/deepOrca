---
id: spec-graph-adoption
type: design
status: active
depends-on: []
covers:
  [
    spec-graph,
    spec-domain,
    design-chain,
    link-independence,
    navigating-specs,
    specs-panel,
    arch-writer-migration,
    drift-detection,
  ]
tags: [spec-graph, thinkrail-adoption, design-track]
---

# Spec 图谱与前置设计轨（spec-graph-adoption）

> **状态**：**实施落地（2026-09-19 一步到位）**——P0 读模型（core `src/specs/`：frontmatter 解析/SpecIndex (mtimeMs,size) 增量重校验/getSpecGraph·listSpecs·validateSpecs）+ P1 `navigating-specs` 技能（writing-skills 纪律命名，T1.3 验收走查待真实使用）+ P2 Specs 面板与独立 `specs-ipc`（registered-root 守卫 + 未注册降级空图 + specs:open 包含性检查）+ P4 drift 三门（机械级、各门独立、unknown 诚实路径）+ P3 **降级路线**（T3.0 核对：arch/PRD 为套件版本 content 字段非独立文件，深度耦合——落**登记锚点**：save_suite_arch 成功后 best-effort 播种 product-design + architecture 指针锚点，无 artifacts 免误触 gate B，权威留套件存储，双权威零产生）。验证：core 1041 / desktop 826 全绿 + specs 新套件 12+3 例、关键路径 mutation-check（SpecIndex 重解析 ×2、面板 drift 徽标）。上游输入：JetBrains ThinkRail 仓库研究（2026-09-18；**借思想不引代码**）。
> **加固批（2026-09-19/20 两轮 bug-hunt 复审）**：ok 态 drift finding 不再进徽章排序（原会画空徽章并掩盖真实漂移）；`safeSpecsPath` 增 **markdown-only 门槛**（大小写与索引器对齐）+ `..` 前缀精确化；specs:open 未注册 root 拒绝 + 失败 surface；`SpecIssue.data` 结构化参数 + 面板结构校验区（M1 闭环）；writer no-clobber + 状态回报；t() 插值改替换函数（`$&` 类值不再损坏文案）；parentless tasks 死分支激活。验证：core 1045 / desktop 851（迭代3 补聚合测试后；提交 6df246d7a 实测） 全绿。
> **命题**：在目标项目 `.deeporca/specs/` 建立**前置设计事实源（spec 图）**——以「产品设计 → 技术设计」设计链为主轴，agent 动工前可导航、动完可对账，UI 有只读 Specs 面板，并有机械级 drift detection（文档债告警）。知识轨（arch-scan → `.deeporca/prototypes/` → Knowledge panel）与产品原型轨的流程、门控、栏目**零改动**（drift detection 对知识轨**只读消费**）。
> **六方拍板**（2026-09-18 对话定稿，本 spec 的不可推翻前提）：
> ① **三轨道边界**——原型设计轨（设计管线各阶段与栏目）/ 知识轨（arch-scan 等，运行时 agent 知识增强）/ spec 轨（新建，前置事实源）三者分家，spec 图**不进**知识库；
> ② **单一事实源**——设计链文档（PRD 与技术架构）当前有效版落 spec 域，产品栏目保持为流程入口与读写面（同一来源），**不留第二份权威拷贝**（双拷贝必然漂移，ThinkRail doc-adoption 设计明确反对的「平行节点漂移」）；
> ③ **产品侧保持**——各栏目交互、验收门（`archLocked`）、生成流程入口全部不动；
> ④ **设计链成链**——很多时候是先有产品设计、才有技术设计：PRD（产品设计）与技术架构（技术设计）**同入 spec 域并以 `parent` 链接**；成链由**生成流**保证（管线门控：arch-writer 必须在 PRD 验收后运行——既有门，不动），链式关系从流程顺序升格为图上可见的边；
> ⑤ **spec 域 = 目标项目 `.deeporca/specs/`**——deepOrca-agent 执行任务产生的所有内部规范性文件与产物都在目标项目 `.deeporca/` 下（知识、设计、审查产物皆然），spec 也不例外；**本仓库根的 `specs/` 目录是开发流程目录，与本功能无关**；
> ⑥ **drift detection 直接纳入本 spec**（§1.6，机械级先行）；
> ⑦ **全链路为核心、各环节独立可用**——**链完整性是生成流（管线门控）的规则，不是图结构的规则**：spec 图只校验链接完整性（parent/depends-on 指向存在节点），不强制链走完；管线生成 / agent 或人手工撰写 / 未来动作，任何来源的节点只要文件带合法 frontmatter 即入图；任一环节前置缺失时该环节如实降级（skip/unknown/info），**不阻断其他环节**（独立执行矩阵见 §1.7）。
> **姊妹 spec**：[design-stage-gates](../archive/design-stage-gates/design.md)（设计管线落点迁移对账，§0.2；已归档收官——门与失败分层域沿用其定稿）；[arch-map-reinforce](../archive/arch-map-reinforce/design.md) / [arch-visual-readback](../archive/arch-visual-readback/design.md)（Archify 线零改动对账，§0.3；均已归档收官）。

---

## 0. 背景与对账

### 0.1 方向来源：为什么是 spec 图，以及三条轨道怎么分

ThinkRail（JetBrains 孵化，`pi` coding agent 的薄宿主）把「规约驱动开发」做成三位一体：spec 目录带 frontmatter 构成图、agent 经 `spec_*` 工具导航（ground truth：动工前读、动完对账）、UI 只读 viewer 与 agent 共用同一个 pi-free 读模型。其 `SpecIndex` 为派生读索引——文件系统唯一事实源，`(mtimeMs, size)` 增量重校验。

本仓要修的核心概念错位：**设计链（产品设计 → 技术设计）是设计期事实源（前置），今天却有两处各自错位**——技术架构文档作为产品流程 step 4 的附属产物落在套件存储里，且与它的上游（PRD）不在同一个可导航的结构里：

| 轨道                | 真身                                                                                                       | 定位                                                 | 处置                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| **原型设计轨**      | 设计管线（spec-writer PRD → pm-design → ui-design → 原型 → 验收 → arch-writer 技术架构 → 程序）及其栏目    | 设计期、前置，但产物散落套件存储，无链式结构         | 流程/门控/栏目**保持**；设计链当前有效版升格进 spec 轨（§1.5） |
| **知识轨**          | arch-scan 动作 → `.deeporca/prototypes/arch-*` → Archify 渲染 → Knowledge panel                            | 运行时知识增强（架构级索引，扫已有代码，可重建快照） | **零改动**（§0.3 硬约束；drift detection 只读消费）            |
| **spec 轨（新建）** | `.deeporca/specs/` frontmatter 设计链图 + SpecIndex + navigating-specs 技能 + Specs 面板 + drift detection | 前置事实源，agent ground truth                       | 本 spec 主体                                                   |

补充事实澄清（2026-09-18 对话确认）：图类绘制引擎从头到尾只有一个（vendored Archify）；fireworks-tech-graph **从未引入代码**，只以「强化输入」出现两次——arch-visual-readback 吸收「评估而非断言」三件套、arch-writer 方法论基线引用其图形质量契约（见 `docs/research/2026-09-17-fireworks-tech-graph-prestudy.md` 拍板）。MoonViz 为原型设计引擎，与本 spec 无关。

### 0.2 与 design-stage-gates 的对账（设计管线落点）

design-stage-gates 管辖设计管线各阶段的门与失败分层，spec-writer / arch-writer 均为其纯文本生成子代理。本 spec **不夺其管辖权**：

- **不动**：验收门（`verification must pass before the technical architecture document can be generated`，`prototype.ts:1799`）、`ARCH_SKELETON` 文档骨架、各阶段落盘门（`looksLikeArchDoc` → `archSectionsAudit` 演进线）、修复轮、子代理 seam 重试——全部留在 design-stage-gates 域内；
- **只动**：设计链文档（PRD + 技术架构）**当前有效版的持久化落点**（保存目标迁入 `.deeporca/specs/`，§1.5）与对应栏目的**读写源**。

### 0.3 与 arch-map-reinforce / arch-visual-readback 的对账（Archify 线零改动）

两 spec 分别管辖 Archify 产物质量（叙事用满/成品质感）与视觉回读闭环（三道门 + 定向修订 ≤2 轮），均以「零管线改动、vendored 树零改动」为硬约束落地。本 spec 沿袭同一纪律：**不改 arch-scan 一行、不改 vendored Archify、不动 `.deeporca/prototypes/` 产物与 Knowledge panel 渲染路径**。drift detection 对 `.deeporca/prototypes/` 快照**只读消费**（§1.6）。spec 侧未来若需架构图渲染（仓库级 root 节点，§4），复用引擎、独立新建入口，不碰现有管线。

### 0.4 与知识轨安全不变量的对账（IPC 面）

AGENTS.md 安全不变量：root 参数化 IPC 必须经 `resolveRegisteredRoot()`（`main/knowledge-ipc.ts`）/`isKnownRoot` 守卫，未注册 root 降级空结果。本 spec 的 Specs 面板读取走**新文件 `main/specs-ipc.ts`**——复用同一守卫机制（spec 域 `<root>/.deeporca/specs/` 与 reviews/designs 等 store 同律），但**绝不进 `knowledge-ipc.ts`**：机制共享，语义分家。spec 图不是知识库的第 N 个 store，是另一条轨道。

### 0.5 现状与证据（全部已核对宿主代码，2026-09-18）

| #   | 事实                                                                                                                                                                                                                                                                                                   | 出处                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| E1  | **`.deeporca/` 是 agent 任务执行的内部规范性文件与产物的统一家园**：designs（设计套件）/ prototypes（架构图产物）/ deepwiki / codegraph / crg / reviews / task-trees / audits 均在其中——spec 轨同律落 `.deeporca/specs/`（拍板⑤）。**本仓库根 `specs/` 为开发流程目录，与本功能无关**                  | `.deeporca/` 目录实测；`actions/prototype.ts:32`（`DESIGNS_DIR = ".deeporca/designs"`）                                        |
| E2  | skill 扫描六个根（项目 `.deeporca/.deepcode/.agents` + home 三根）**无条件加载**，不看信任级                                                                                                                                                                                                           | `session-manager-skills.ts:479-484`                                                                                            |
| E3  | `WorkspaceTrustLevel` 已存在且已门控 MCP project servers（`quarantine` → `{}`）与 LSP 诊断桥——skill 信任门可搭现成体系（本 spec 不做，记 §4）                                                                                                                                                          | `settings.ts:891,899,263`；`main/index.ts:1119-1123`                                                                           |
| E4  | arch-scan 自我定位「architecture-level index…shown in the Knowledge panel」，产物 `.deeporca/prototypes/arch-<slug>.<type>.json`，被 index-build 折入知识索引——**今天的技术架构图长在知识轨**（描述性快照）                                                                                            | `actions/arch-scan.ts:6,58`；`actions/index-build.ts:60,128`                                                                   |
| E5  | 设计管线：spec-writer 产 PRD（需求文档）→ 原型 → 验收门 → arch-writer 从**已批准 PRD** 推导标准技术架构文档（系统架构/数据模型/核心流程/模块拆分，Mermaid + 对照表），`save_suite_arch` 持久化，套件存储 `.deeporca/designs`——**PRD 与技术架构的链式关系只存在于流程顺序中，不存在于任何可导航结构里** | `i18n/locales/zh.ts:1770-1779`；`templates/plugins/design/skills/arch-writer/SKILL.md`；`actions/prototype.ts:32,77,1799,1848` |
| E6  | arch-writer 方法论基线直接引用 fireworks-tech-graph 图形质量契约（分层容器/语义节点/零交叉优先/每图对照表）——「再次加强」而非引入                                                                                                                                                                      | `design/skills/arch-writer/SKILL.md`；`docs/research/2026-09-17-fireworks-tech-graph-prestudy.md`                              |
| E7  | IPC 契约 `shared/ipc.ts`（~1871 行）：类型 + `IpcRequest`/`IpcEvent` 通道常量，结构同构 ThinkRail contracts；无 `PROTOCOL_VERSION`（本 spec 不做，记 §4）                                                                                                                                              | `desktop/src/shared/ipc.ts`                                                                                                    |
| E8  | 知识轨安全模型成熟：`resolveRegisteredRoot()` 守卫 + 未注册 root 降级空结果                                                                                                                                                                                                                            | `main/knowledge-ipc.ts`；AGENTS.md 安全不变量                                                                                  |
| E9  | 工程纪律：renderer 测试 mutation-check；i18n 每个 `MessageKey` 6 语种全量（typecheck 强制）；core 无 UI 依赖                                                                                                                                                                                           | AGENTS.md                                                                                                                      |

## 1. 设计

### 1.1 Spec 域与 frontmatter 规范（`.deeporca/specs/`）

- **扫描根**：`<workspaceRoot>/.deeporca/specs/`（单一根，拍板⑤——与 designs/prototypes/reviews 等 agent 产物同律；终端用户项目与开发机行为一致）。
- **frontmatter schema**（YAML，置于文档头部）：

  | 字段                                                                                                    | 出现于                                      | 语义                                                                                                                                                                                                                                 |
  | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `id`                                                                                                    | product-design / architecture / design 文档 | 节点唯一 id，kebab-case，**约定 = 所在目录名或显式命名**                                                                                                                                                                             |
  | `type`                                                                                                  | 全部                                        | 封闭词表：`product-design`（产品设计，PRD 当前有效版）/ `architecture`（技术设计，arch-writer 产物）/ `design`（通用设计节点，预留）/ `tasks`（任务清单）                                                                            |
  | `status`                                                                                                | product-design / architecture / design      | `draft` \| `active` \| `done` \| `stalled`                                                                                                                                                                                           |
  | `parent`                                                                                                | 可选；**管线生成的架构节点必填**            | 单链接，指父节点 id。管线生成的 `architecture` 节点由生成流写入 `parent` → 同套件 `product-design`（拍板④，链由门控保证）；**独立产出的架构节点可无 parent**（拍板⑦：独立入口，validate 给 info 级提示「无产品设计上游」，非 error） |
  | `depends-on`                                                                                            | 可选                                        | id 列表，跨套件/跨节点硬依赖边                                                                                                                                                                                                       |
  | `covers` / `tags`                                                                                       | 可选                                        | 自由标签（非图边）                                                                                                                                                                                                                   |
  | `artifacts`                                                                                             | 可选                                        | 相对路径列表（实现产物、架构图快照等），登记产物归属，drift detection 的对照锚点（§1.6）                                                                                                                                             |
  | tasks.md 仅需：`{ type: tasks, parent: <同目录设计节点 id> }`——节点 id 派生为 `<dir>#tasks`，不独立命名 |                                             |                                                                                                                                                                                                                                      |

- **目录形态**：`.deeporca/specs/<suite-slug>/`——一个设计套件一个目录，内含 `product-design.md` 与 `architecture.md` 成链（命名映射待 T3.0 核对定稿）；跨套件通用设计节点可平铺目录。
- **节点来源开放（拍板⑦的结构基础）**：管线生成 / agent 或人手工撰写 / 未来动作（如仓库级 root 节点）——文件系统是唯一事实源，任何来源只要文件带合法 frontmatter 落进 `.deeporca/specs/` 即自动入图，不需要「走完链」的入场券。
- **机读层新建，人读层不动**：frontmatter 供机器（SpecIndex/面板徽标/drift），文档正文的人读结构（标题、章节、Mermaid）完全沿用现状。
- 本 spec 自身文件携带 frontmatter 仅作**规范示例**——注意本仓库根 `specs/` 不在本功能扫描根内（拍板⑤），不存在对本仓存量 spec 的回填问题。

### 1.2 SpecIndex —— core 内 pi-free 派生读模型（`packages/core/src/specs/`）

- **文件系统是唯一事实源**；索引为派生、只读、驻内存，**读取时按 `(mtimeMs, size)` 增量重校验**：未变文件复用缓存解析，变更/新增文件重解析，消失文件逐出；spec 集合实际变化才重建图。每 root 一个实例（按 cwd 键控），跨调用摊平缓存成本。（直接吸收 ThinkRail SpecIndex 设计；其已声明的理论盲区——同 mtime tick 内等长编辑——同样接受，内容哈希为既定升级路径。）
- **公共面**（barrel 导出，core 无 UI 依赖，合规于分层铁律）：`listSpecs(root)` / `getSpecGraph(root)`（节点 + parent/depends-on 边 + status + drift 徽标数据）/ `validateSpecs(root)`（id 唯一、**链接完整性**——parent/depends-on 必须指向存在节点、status/type 枚举、tasks 的 parent 指向同目录设计节点、`artifacts` 路径存在性；**独立 architecture 节点合法**——info 提示「无产品设计上游」，非 error，拍板⑦）。
- **消费方双入口同源**：desktop（§1.4 面板）与 agent（§1.3 技能引导）读同一模型——**agent 视图 = UI 视图**（ThinkRail 一致性原则：两套读模型必然漂移）。
- 单测：索引增量重校验（改/增/删三态）、链接校验、设计链规则、frontmatter 容错（坏 YAML 不炸索引，降级为散文节点）；按仓库纪律对关键路径做一次 mutation-check。

### 1.3 Agent 侧：skill 化，不新增内置工具（`meta-skills` 插件）

遵循 AGENTS.md「内置工具刻意极简，外部能力走 MCP/技能」铁律，第一版**不造 `spec_*` 工具族**（ThinkRail「workflow 系统无运行时机制」同款精神：先规范后工具，实测不够再议，记 §4）：

- 新增 `templates/plugins/meta-skills/skills/navigating-specs/SKILL.md`（2026-09-19 实施时依 writing-skills 纪律与 ThinkRail 元规则 15 由 `spec-navigator` 更名——动名词动词优先；教 agent 用现有 `read`/`grep`（grep frontmatter 字段）按图导航 `.deeporca/specs/`——**动工前**沿 `parent`（设计链上游）与 `depends-on` 找产品设计决策与技术设计边界，**动完后**核对所动边界对应的 spec 节点是否需要回写、`artifacts` 是否漂移；gate 配反合理化注记（「先码后补」即本规则要阻止的失败本身）；
- 常驻规则（「spec 是 ground truth」）写进技能文档正文，不进系统 prompt 组装（「喂养不拼装」）；
- 验收：一次真实特性工作中 agent 能按技能指引定位设计链上游与对账锚点（人工走查级，不设自动门）。

### 1.4 Renderer：Specs 面板 + 独立 IPC 面（`main/specs-ipc.ts`）

- **IPC**（`shared/ipc.ts` 增通道常量 + 类型，两端接线）：`SpecsGraph`（返回 `SpecsGraphResponse` = 图快照（节点摘要 + 边 + status + drift 徽标）**+ `issues: SpecIssue[]` 结构校验明细**——2026-09 iter-2 闭环：`validateSpecs` 输出进 wire，`SpecIssue.data` 携带结构化插值参数，面板本地化渲染、core `message` 仅开发者面）/ `SpecsOpen`（打开节点 → `safeSpecsPath` 包含性检查后交 `shell.openPath`；**markdown-only 门槛**与索引器大小写对齐，非 `.md` 结构性拒绝；打开失败向面板 surface 而非静默）。handler 落**新文件** `main/specs-ipc.ts`，复用 `resolveRegisteredRoot()` 守卫（依赖注入 `resolveRoot`/`openPath`，可脱离 Electron 单测）；未注册 root / 无 `.deeporca/specs/` 目录降级空图（安全不变量天然满足）。
- **面板**：rail 侧栏 Specs 组（与 Knowledge 组并列、互不嵌套）：以设计链为主轴的树（product-design → architecture）+ status/drift 徽标（配色走既有语义 token）；空态（无 `.deeporca/specs/` 或无 frontmatter 节点）诚实显示引导文案。
- i18n：新增 `MessageKey` 全量落 6 语种（typecheck 强制）。
- 测试：dom-harness + api-stub 渲染测试（链式树渲染/空态/徽标），mutation-check 一次。

### 1.5 设计链落点迁移（单一事实源，拍板②④）

**目标模型**：`.deeporca/specs/<suite-slug>/` 持有设计链**当前有效版**——`product-design.md`（PRD 当前版）+ `architecture.md`（技术架构），成链（architecture.parent → product-design）。

- **链可部分存在（拍板⑦）**：套件只有 PRD、尚未生成技术架构 = **合法中间态**——面板如实呈现「未生成技术设计」，drift 门 A 跳过，不构成校验错误；反向（独立技术架构无 PRD）在管线内不存在（门控保证），手工/其他来源则合法入图。

- **权威划分（消灭双权威）**：spec 域文件是设计链当前有效版的**唯一权威**；`.deeporca/designs` 套件存储退为**append-only 版本归档史**（批准/新版本产生时归档快照入版本集，不再被读作当前版）。设计管线的「保存当前版」= 写 spec 域 + 归档旧版进版本集——没有第二份会被编辑的拷贝。
- **产品栏目保持为读写面**（拍板③）：需求文档栏目与技术架构栏目的交互、验收门、生成/重生成入口全部不动，读写源改为 spec 域文件；`.deeporca/designs` 内的存量当前版文档原地保留为归档（只读兼容，面板标注「存量·未入 spec 图」，不回填不搬迁）。
- **门不动**（§0.2）：各阶段落盘门与骨架仍按 design-stage-gates 域执行，仅 PRD 保存目标与 `save_suite_arch` 落点迁移、`ARCH_SKELETON`/PRD 骨架头部加 frontmatter 段。
- **映射与降级（阻塞门 T3.0）**：套件 slug 规则、版本批准钩子位置、PRD 保存路径的精确映射**核对定稿前不写代码**；若核对发现版本集与当前版读取深度耦合、读写迁移风险超预期，**降级方案** = 先做 tabArch 式只读迁移（技术架构先行入图），PRD 节点以 frontmatter 引用登记套件存储路径（链可见、暂不搬家），二期再迁。

### 1.6 Drift detection（拍板⑥：机械级先行，语义级留开放）

**原则**：便宜在前、感知在后（与 arch-visual-readback 分层验证同构）；一切判定机械可查（mtime/内容存在性），零 LLM；诚实报告——判不了就标 unknown，绝不冒充；**各门独立判定（拍板⑦）**——每门只依赖自己的前置，前置缺失该门 skip/unknown，不阻断其他门与面板。

- **门 A 链内漂移（设计链自检）**：同套件 `architecture.md` 的 (mtime, hash) 旧于 `product-design.md` 当前版 → 「技术设计落后于产品设计」黄标。直接可查，零外部依赖。链只有一半（仅有 PRD 无架构）→ info「未生成技术设计」（链未走完的正常状态，非 drift 告警）。
- **门 B 实施漂移（设计 vs 实现）**：`artifacts` 登记的实现产物（程序/组件/代码路径）——存在性（设计有、实现无 → 「未实施」提示）+ 新鲜度（实现产物新于 architecture.md → 「实现已演进，技术设计可能滞后」黄标）。
- **门 C 跨轨对照（只读消费知识轨）**：`artifacts` 若登记了 `.deeporca/prototypes/` 的 arch-scan 快照，给出「描述性快照 vs 规范性设计」的新鲜度对照（快照新于设计 → 提示复核）；**不语义 diff**。
- **呈现**：SpecIndex 计算徽标数据 → Specs 面板节点黄标；`validateSpecs` 明细经 `SpecsGraph` wire 进面板**结构校验区**（`SpecIssue.code`→i18n 模板 + `data` 参数插值渲染，空图/散文件树同样可见——2026-09 iter-2）；navigating-specs 技能在对账步骤读同一徽标。
- **语义级 diff**（archify IR 与 Mermaid 结构对齐、模块级增删对照）列开放决策 R6，实测门 A/B/C 价值后再议。

### 1.7 独立执行矩阵（拍板⑦）

**定位**：全链路（产品设计 → 技术设计 → 实现 → drift 对账）是**金路径**——打通它是本 spec 的核心；但**每个环节必须可独立使用**，任何环节的缺席不降低其他环节的可用性。矩阵即验收口径：

| 环节                               | 可独立使用                                      | 前置缺失时的行为                                                                      |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| SpecIndex（读模型）                | ✅ 任意节点集合（含空目录、纯手工节点、部分链） | 目录缺失 → 空图，不报错                                                               |
| Specs 面板                         | ✅ 不依赖设计管线是否跑过                       | 无节点 → 空态引导；独立节点 → 独立入口呈现                                            |
| spec-navigator 技能                | ✅ 只要求 `.deeporca/specs/` 存在               | 域为空 → 技能如实说明并继续（不阻塞任务）                                             |
| 设计管线（PRD→原型→验收→技术架构） | ✅ 不依赖面板/技能/索引存在，照常跑             | 落点迁移只改变写哪，不改变能否跑                                                      |
| drift 门 A（链内）                 | ✅                                              | 链缺一半 → info「未生成技术设计」，非告警                                             |
| drift 门 B（实施）                 | ✅                                              | 无 `artifacts` 登记 → 该门跳过（unknown），链上其他门照常                             |
| drift 门 C（跨轨）                 | ✅                                              | 无知识轨快照登记 → 该门跳过                                                           |
| 图校验                             | ✅                                              | 只查**链接完整性**（悬空指向 = error）；**链不完整永不 error**（独立架构节点 = info） |

**推论**：链的「完整性」只在一个地方被强制——**生成流**（管线门控：无验收 PRD 不生成技术架构）；图、面板、索引、drift 对部分链一律如实呈现、绝不拦路。这与 ThinkRail 的入口分诊同构（空仓 / 存量代码 / 已有 spec 三种入口都合法，不强制从零走全流程）。

## 2. 硬约束（不做清单，实施与复核一律以此为准）

1. **知识轨零改动**：arch-scan、vendored Archify、`.deeporca/prototypes/` 产物、Knowledge panel 渲染路径——一行不改（drift detection **只读**消费）。
2. **产品原型轨流程保持**：设计管线各栏目交互、验收门触发条件、生成流程入口不动；只改设计链文档的持久化落点与读写源。
3. **不引任何 ThinkRail / pi / fireworks 代码**（均为哲学输入，已有研究留档）。
4. **不新增内置工具**（spec-navigator 走技能；`spec_*` 工具化留 §4）。
5. **不进 `knowledge-ipc.ts`**：spec 读取独立成 `specs-ipc.ts`，机制复用、语义分家。
6. **core 无 UI 依赖**：SpecIndex 为纯读模型；日志经既有 host 注入 seam。
7. **本仓库根 `specs/` 目录零触碰**（拍板⑤：开发流程目录，与功能无关）；`.deeporca/designs` 存量文档原地保留为归档，不回填不搬迁。
8. **不做** skill 信任门、IPC 协议版本化/封闭错误码、agent 两级终态、worktree workspace——均为姊妹后续 spec（§4）。

## 3. 风险与开放决策

| #   | 项                                                                                | 状态                                     | 处置                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 设计链迁移的**套件版本语义**核对                                                  | **已核对（T3.0，2026-09-19）**           | `save_suite_arch` 走 `appendDesignSuiteVersion`（版本 append + head-moved 契约），arch/PRD 均为**版本 content 的字段而非独立文件**，验证门在写入边界二次执行——深度耦合坐实，**定稿降级路线**（登记锚点，权威不动）                                                                                                                     |
| R2  | 终端用户项目无 `.deeporca/specs/` 目录                                            | 必然场景                                 | 面板空态引导（§1.4），SpecIndex 对缺失目录返回空图不报错                                                                                                                                                                                                                                                                               |
| R3  | spec 域当前版与套件版本集的一致性（归档时机）                                     | 设计已定                                 | 唯一权威 + append-only 归档（§1.5）；T3.2 回归用例钉住「归档后读当前版仍指 spec 域」                                                                                                                                                                                                                                                   |
| R4  | navigating-specs 依赖 LLM 遵循技能指引（无机械门）                                | 接受                                     | 与仓库既有技能同水位；drift 徽标（§1.6）提供机械对账锚点补位；T1.3 验收走查待真实特性使用                                                                                                                                                                                                                                              |
| R5  | PRD 栏目读写源迁移比 tabArch 只读迁移风险高一档（编辑面）                         | **已定稿：降级路线**（T3.0，2026-09-19） | 锚点不带 artifacts（套件文档是 content 字段非文件，假路径会误触 gate B）；权威转移立 T3.5 二期                                                                                                                                                                                                                                         |
| R6  | drift detection 语义级 diff（archify IR vs Mermaid 结构对齐）                     | 开放                                     | 门 A/B/C 机械级先行；价值实证后再立项语义层                                                                                                                                                                                                                                                                                            |
| R7  | specs:open 残余面：`.deeporca/specs` 自身符号链接重定基（攻击者需文件系统写权限） | **已接受残差**（2026-09 两轮复审）       | `.md` 门槛后 reach 收敛为「打开工作区内任意 markdown」，严格被既有 `EditorOpenSystem` 面（renderer 本可开根下任意文件）支配——零增量能力，不再收紧（收紧会误伤根内合法符号链接布局）                                                                                                                                                    |
| R8  | 登记锚点被手工接管后注册永久静默跳过                                              | 已缓解                                   | writer no-clobber 守卫（frontmatter 不可解析 + 正文含锚点标记 → 不覆写）+ 返回 `skipped-unparseable-anchor` 状态由动作层并入最终 saved 进度消息提示（`data.code` 切 `prototype.arch.anchorSkipped`，`data.file` 供 i18n `{file}` 插值——iter-4 复审 F1 闭环）；聚合契约 skip>write>unchanged、`file` 精确指向实际文件；恢复需人工修文件 |

## 4. 后续延伸（不进本 spec，落地后视需求各自立项）

- **仓库级技术架构 root 节点**：`.deeporca/specs/` 根级 architecture 节点（ThinkRail `architecture.md` 对应物），引擎复用 vendored Archify、**独立新建入口**（不改 arch-scan 一行）——与知识轨快照的语义级 drift diff（R6 升级形态）天然配套；
- **skill 信任门**：`WorkspaceTrustLevel` 延伸到 `session-manager-skills.ts` 六根扫描（E3 体系现成）+ trust 升级后新增 skill 的 re-confirm；
- **`spec_*` 工具化**（若技能导航实测不足）与 **IPC 契约加固**（协议版本 + 封闭错误码 + 跨线字段 allowlist，含 `EndpointConfig` 审计）——后者单独立 `ipc-contract-hardening` spec；
- **agent 两级终态**（尝试边界 vs 工作收敛）、**worktree workspace**（并行 agent 物理隔离，注册 root 体系天然覆盖）。
