# 理念借鉴（第二轮）：CodeBrain / MemBrain 的设计哲学与本仓映射

日期：2026-09-04 · 分支：`feat/modern-ui-redesign` · 性质：**纯调研（无代码变更）**

> **与第一轮的关系。** [2026-08-17-hallmark-codebrain-membrain-prestudy.md](./2026-08-17-hallmark-codebrain-membrain-prestudy.md) 是可行性轮：逐文件核证两仓成熟度/许可，并把三个可移植模式（降级三态入带、诊断分桶采样、多查询改写）落到代码（§6 四主题提交，全部在树：`common/analysis-status.ts`、`common/bucket-sample.ts`、memory `query-variants.ts`、`actions/design-audit.ts` 等已 grep 证实）。本篇**不重复该清单**，回答的是更高一层的问题：这两个仓库**相信什么**（设计哲学），其中哪些信念本仓已经同源拥有、哪些是真差距、哪些应当作为工程纪律固化下来。

## 0. 命题与取证范围

命题（用户给定）：**不是直接接入，而是借鉴理念与哲学**——本仓已具备两者的基础能力（CodeBrain 的代码智能 ≈ CodeGraph 持久索引 + CRG + serena + LSP 诊断桥；MemBrain 的记忆 ≈ `@deeporca/memory` L0–L3 进程内管线），缺的是把它们的哲学吃透。

取证范围（zread 一手读取，README 只作参考不作结论）：

- **MemBrain**：`docs/tech_blog.md`（理念自述）、`docs/layered-architecture.md`（域×层二维纪律）、`docs/concurrency.md`（引擎分层与连接预算）、`memory/core/entity_tree/{routing,audit,tree_ops}.py`（树算法三件）、`retrieval/core/budget_pack.py`（打包）、`agents/{manifest,retry}.py`（清单与重试）、`manifests/fact-generator/system.md`（抽取提示词全文）。
- **CodeBrain**：`README.md`（七项 harness 失败模式自述 + 成本主张）、`docs/claude-md-snippet.md`（SOP 全文 + PostToolUse hook）、`src/codebrain/bootstrap.py`（引导生成器全文）。

本仓走读（映射锚点核证）：`session-manager-diagnostics.ts`（回合末双路诊断，全读）、`desktop/main/tools/lsp-bridge/controller.ts`（可用性判据）、`session-manager-base.ts` 辅助原语（`judgeViaLlm`/`completeTextViaLlm`）、辅助调用点分布、循环内失败模式检索（consecutive/identical 零命中）。

---

## TL;DR

两仓合起来教的是同一件事，可称**供给侧工程**：*不试图把 agent 变聪明，而是把喂给它的东西做得更便宜、更结构化、更诚实、更有预算，并把"怎么用"与能力一同出厂。*

| # | 哲学 | 出处 | 本仓现状 | 判定 |
| --- | --- | --- | --- | --- |
| C1 | 工具面按 agent 意图收敛，不按 API 形态展开 | CodeBrain README「intent-oriented tools」 | 已同源（内置 8 工具刻意最小化 + 08-11 决策矩阵） | 已采纳 |
| C2 | 降级必须入带，clean 与 unavailable 不可混淆 | FallbackChain 三态 + header/footer 诚实 | 三态 status 已落地；**但诊断桥两腿失败静默吞掉，clean/挂了不可区分** | **真差距（小）** |
| C3 | 能力与使用纪律同步出厂（工具 + SOP + 钩子三件套） | bootstrap.py 生成 CLAUDE.md SOP + PostToolUse hook | 决策矩阵已有一半；**缺 edit 后单文件即时校验提示** | 真差距（中） |
| C4 | 编辑-验证闭环的粒度即产品（单文件即时 ≠ 全量 build） | SOP1 Step4「fix before next file」 | 回合末诊断桥已落地，粒度差一档 | 部分差距 |
| C5 | 环境就绪前置：缺依赖的语言服务器产出假阳性诊断 | bootstrap「Without these steps, validate() may report false-positive…」 | **桥的 `isAvailable()` 只查自身二进制，不查 node_modules/.venv** | **真差距（小）** |
| C6 | 榜单收益主要来自修循环级失败模式，不是换模型 | README 七项自述（agent-loop 未开源但分类学公开） | compaction 已有；premature stop / stuck 检测 / 分阶段推理强度无 | 独立对账（CMB-6） |
| M1 | 预定义结构管重复性组织，agent 只管语义判断 | tech_blog 核心句 | 确定性优先已有先例（bucket-sample / design-audit 零 LLM / 事件向变体） | 已同源，宜固化为规则 |
| M2 | 事实不可变 + 实体可演进，更新发生在渲染期（晚绑定） | tech_blog「renderable template」 | L1 原子事实同构；晚绑定渲染未做 | 观念种子（P3） |
| M3 | 结构是持续偿还的债：债调度 + 预算化审计 + 纯代码兜底 | tree_ops/audit（公式全文） | 无对应物（任务树/技能库/人格只长不剪） | 蓝本存档（P3） |
| M4 | agent 参与度随查询复杂度升降 | tech_blog「agent involvement scales with query complexity」 | 确定性事件向变体已落地；**与 depth-lane spec 哲学同构** | 已同源，升档等数据 |
| M5 | 上下文是组装出来的：选样按分数、呈现按时间；日期算术替 LLM 做掉 | budget_pack 全文 | formatMemoryLine 时间更结构化，但**相对时间不预解析** | 真差距（小） |
| M6 | 数据库是基础设施（可追溯/可审计/可隔离/可同步），决策积累为数据 | tech_blog Future Work + concurrency.md | usage-ledger / file-history git / sessions JSONL 已同哲学 | 已采纳 |
| M7 | 检索即维护：访问路径是重组结构的信号 | tech_blog Future Work | routing 闭环有冻结 Map/元数据契约，无访问遥测 | 观念种子（P3） |
| M8 | 每个辅助 LLM 调用都是版本化工件（清单 + schema + 校验器 + 重试预算） | manifest.py + retry.py | `judgeViaLlm`/`completeTextViaLlm` 两原语已立且 fail-open；**逐调用 schema 校验与重试预算未约定** | **真差距（最有价值）** |
| M9 | 分层纪律 + 「LLM 即算法」例外 + 已知妥协写进文档 | layered-architecture.md | layer 规则同源（core UI-free）；例外清单习惯可借鉴 | 已采纳大半 |
| M10 | 抽取提示词的分界线/禁再抽取/逐字保留/终检扫查 | fact-generator system.md | #3 已加两条硬规则；**分界线、final sweep、细节清单未吸收** | 真差距（纯提示词） |

---

# Part I CodeBrain 的哲学

CodeBrain 的开源部分是一个 LSP+tree-sitter 工具服务器（其 agent-loop 未开源，78 提交休眠），但它的**信念**全部写在工具面的形态、引导产物的内容和 README 的失败模式自述里，与代码是否开源无关。

## C1 工具面即产品面：按 agent 意图收敛

README「Key design decisions」最后一条：*"Intent-oriented tools — consolidated low-level operations into what agents actually need, such as `validate`, `explore_symbol`, `search`, `check_impact`, `debug_trace`, `rename_symbol"`。11 个工具没有一个对应裸 LSP 协议动词（`textDocument/definition` 这类），全部是**意图**（"我要知道改这里会坏什么" = `check_impact`；"我刚编辑完，快告诉我哪里坏了" = `validate`）。

**本仓对照**：同源信念已立——AGENTS.md「内置工具刻意最小化」+ 外部能力走 MCP + `prompt.ts` 决策矩阵（08-11 文档 P0-P3 落地）把 CodeGraph/CRG/serena/openwiki 的分工写进系统提示。**判定：已采纳，无需动作。** 唯一可复用的检验口径：新增任何 action/工具时先问"它对应哪个 agent 意图"——这句话值得写进 action 设计的评审习惯。

## C2 降级必须入带，clean 与 unavailable 不可混淆

FallbackChain 三态（`active → degraded → unavailable`）+ 降级态把事实以 header/footer 写进工具输出 + `check_health` 查询。第一轮已把 per-call 三态移植到分析层 action（`analysis-status.ts`）。**但哲学还有一处残留没吸收干净，且恰好落在最新落地的诊断桥上**：

`session-manager-diagnostics.ts:84-101` 的两腿（Serena + LSP bridge）对每次调用的 `catch` 都是静默 best-effort，注释写明 *"the bridge failing (missing language server, budget, timeout) degrades to silence"*。后果：`buildDiagnosticsSystemMessage` 在 `totalErrors === 0` 时返回 null（当作 clean）——**"检查通过"与"检查根本没跑成（语言服务器缺失/超时/预算耗尽）"在带内不可区分**。这正是第一轮 §1.2 批过 CodeBrain 的同款缺陷（"超时被静默吞掉返回 `[]`——与文件干净不可区分"），我们在自己的桥上复刻了它。

**建议（P1，半天）**：`DiagnosticsLegResult` 增加每腿状态（`ok | unavailable`），`buildDiagnosticsSystemMessage` 在两腿皆无结果但存在 unavailable 腿时，注入一行降级说明（如 `⚠️ 诊断检查不可用：LSP bridge 未连接（trigger=manual 或语言服务器缺失）`），并保持"两腿可用且零错误才返回 null"的 clean 语义。

## C3 能力与使用纪律同步出厂

`bootstrap.py` 的 `init_project` 一口气生成三件：`.mcp.json`（能力）、`CLAUDE.md`（SOP 使用纪律）、`.claude/settings.json` 的 PostToolUse hook（纪律的自动执行）。信念：**工具没有配套的 SOP 就会被误用，SOP 没有钩子就会被遗忘**。`claude-md-snippet.md` 的 SOP 写得极具体："Step 3 — Analyze impact before coding… Do not skip this step"、"4c. If errors: fix them and re-run validate. Do NOT move to the next file until clean"、"Sub-agents cannot access these tools. Always run them yourself"。

**本仓对照**：决策矩阵（prompt.ts）= 能力分工的 SOP，已落地一半；`karpathy-guidelines` 等默认技能也是出厂纪律。**真差距是"纪律的自动执行"那半**：编辑后的即时提醒不存在——edit/write 工具结果不携带校验提示（grep 证实），唯一的反馈通道是回合末诊断桥。第一轮 §1.3-3 提过"编辑后校验闸门（P1）"但未进 §6 落地清单，属漏项。

**建议（P1，1 天）**：edit/write 成功后在该文件属于代码类扩展名时，于工具结果 metadata 或追加说明附一行：`（已修改 <file>，建议立即运行诊断检查；回合末将自动复核）`——纯提示词级，与回合末桥互补不冲突（CodeBrain 的 hook 也只是"提醒"，不是"替它跑"）。

## C4 编辑-验证闭环的粒度即产品

SOP1 的节奏是**每文件一个循环**：edit → validate（单文件）→ 修干净才许动下一个文件；最后才 `validate(directory)` 收口。README 把这个写成了卖点：*"validate provides compiler-grade diagnostics immediately after edits… without running a full build every time"*。信念：**闭环成本发生在最细粒度上才最便宜**——单文件即时反馈能把错误的发现成本从"下回合"压到"下一秒"，从"全量构建"压到"单文件诊断"。

**本仓对照**：回合末诊断桥（Serena 语法级 + 桥类型级，合并去重 + 2KB 预算）已把"发现成本"从"用户跑构建"压到"回合末自动"，但仍是**回合粒度**。配合 C3 的编辑即提示，粒度就齐了：**编辑时知道 → 回合末汇总 → 用户构建前兜底**。无需新机制，是 C3 的连带收益。

## C5 环境就绪前置：假阳性诊断比没有诊断更糟

bootstrap 的 CLAUDE.md 专设 "Environment Preparation" 节：*"Without these steps, validate() may report false-positive import/dependency errors."* 并对每个子项目做就绪告警（`.venv` 缺失 / `node_modules` 缺失 / `go.sum` 有而 vendor 无）。信念：**语言服务器在依赖不全时的输出不是"没用"而是"有害"**——它会把 `import` 报成错误，污染 agent 的自我修正方向。

**本仓对照（已核证）**：`desktop/main/tools/lsp-bridge/controller.ts:27` `isAvailable(): boolean { return existsSync(this.opts.serverEntry); }`——只查桥自身二进制是否存在；桥内语言服务器（tsserver/pyright/gopls…）拉起前**不检查项目依赖就绪**。对 TS 项目 `node_modules` 缺失时，typescript-language-server 会稳定产出假阳性 import 错误，经诊断桥回灌为"编辑后诊断发现 N 个错误"。

**建议（P2，半天，可与 C2 合并实施）**：桥侧按语言族做轻量就绪探测（TS：`node_modules` 存在；Python：`.venv`/site-packages 线索；Go：`go.sum` 存在），不就绪则该腿报 `unavailable(deps-missing)` 并带一句补救指引（"run npm install"），走 C2 的入带通道。注意按 AGENTS.md 跨平台路径策略用生产路径助手判断，不做手搓分隔符。

## C6 harness 失败模式分类学（README 自述的七项增益）

CodeBrain README 的 Benchmark 一节逐条自述了它的收益来源：premature stop recovery（把"只发了消息没调工具"识别为**未验证停止**并续推）、结构化前置勘察工具（先看文件布局与资源态，省掉早期乱翻的回合）、dynamic reasoning effort（规划/验证用高推理、实现用中档）、tool-call 格式自动纠错（省一个废回合）、stuck-detection（降低重复同命令的判定阈值——"Agents love to get stuck in loops and run out the clock"）、上下文压缩（早期消息 pin 住防长会话跑偏）、per-model 提示词（按模型的失败模式分别定制）。核心句：*"most of our gains came from just fixing those"*。

**重要限定**：这七项的实现（agent-loop）**不在仓库里**（第一轮证据链闭合：无 LLM SDK、grep 零命中），72.3%/63.9% 数字在复现前只作方向性证据。但**失败模式的分类学本身是公开的、免费的、可对账的**。

**本仓对照**：compaction（中间 2/3 摘要）与 per-family reasoning 契约（读字段注册表）已有；premature stop 检测、stuck/重复调用检测、分阶段推理强度**未检索到**（`consecutive/identical` 在 session-manager-base.ts 仅命中无关注释）。

**建议（P2，独立对账不新立）**：把 C6 七项作为一份**外来失败模式清单**直接对照本仓 session 循环逐条判定（对账表落 CMB 台账 CMB-6，不锚任何外部台账）：premature stop 与 `waiting_for_user`/`ask_permission` 显式状态的边界要辨析（我们的"停止"常是有意设计，不能见消息无工具就续推——CodeBrain 判的是"任务未验证却停下"，判据是"是否有未验证的声明"而非"是否停"）；per-phase reasoning effort 与 per-family reasoning 契约不冲突，可作 settings 项。**每条过 P0 观察数据门再定**，与 depth-lane 的决策纪律一致。

---

# Part II MemBrain 的哲学

## M1 主哲学：责任切分——结构管重复，agent 管判断

tech_blog 核心句：*"predefined structure handles most of the repetitive organization work, while agents focus on the smaller set of decisions that require semantic judgment."* 树的层级/深度/分支上限是预定义的；**内容**（事实怎么聚、摘要怎么写、新信息放哪）才交给 agent。配套证据：路由零 LLM（`routing.py` 纯余弦，aspect 得分 = `alpha·sim(desc) + (1-alpha)·sim(子素质心)`）、溶解零 LLM（`auto_dissolve` 纯代码）、LLM 只出现在预算化的审计（GROUP/PROMOTE/RELOCATE）与摘要。

**本仓对照**：同源先例已经很多且都是近一年自己长出来的——`bucket-sample.ts`（分桶采样替代无脑截断）、`design-audit.ts`（零 LLM 确定性审计替代提示词祈祷）、`query-variants.ts`（确定性事件向改写替代 LLM 改写）、fail-open 路由（router 失败置 null 走全量候选）。

**建议（纪律化，零代码）**：把 M1 固化为一条可引用的工程规则写进 specs 模板/评审习惯：**"新增任何 LLM 步骤前，先问：这一步能否由一个预算化的确定性机制承担？只有真正的语义判断才允许 LLM 参与，且必须带预算与失败回退。"** 这与 fail-open 红线同列。它不是新能力，是把已经在做的事从巧合升格为立场。

## M2 事实不可变 + 实体可演进 + 渲染期晚绑定

tech_blog：*"Each fact effectively acts as a renderable template: the fact itself remains stable, but the associated entity information is always up to date."* 事实是带内联实体引用的原子自然语言（`[Caroline] started a new job at [Feeling-AI]`），**写入后不再改**；实体描述是唯一随时间演进的层（带版本史——文档声称）；**"更新"发生在输出时**：别名在呈现期解析成最新实体描述，事实文本本身不动。

**本仓对照**：L1 原子事实同构（TDAI L0→L1 抽取）；"晚绑定渲染"未做——记忆行召回后按原样呈现。对编码 agent 场景，晚绑定的对应物是：**事实记录"什么发生了"，人格/项目层记录"现在怎么看"，拼接发生在注入时**。

**建议（P3 观念种子）**：若 L3 人格继续演进，倾向"渲染期叠加"而非"把结论写进历史事实"。不排期，留作 L3 结构化讨论的输入（与 M3 同场）。

## M3 结构债调度：把"组织"变成"还债"

实体树最有原创性的部分不是树，是**维护它的调度器**（`tree_ops.py` / `audit.py`）：

- 债公式：`debt = uncertainty + W_WIDTH·max(0, 超宽) + W_DEPTH·max(0, 深度 − D_max(support))`，其中 `D_max(n) = round(2 + 1.3·ln n)`——深度上限随叶子数对数增长，宽阈值 `w_soft = W_SOFT_BASE + W_SOFT_LOG·log2(1+support)` 随支持度放宽。
- 预算化审计：全树非叶节点按债排序，**只审计 top-K**（`AUDIT_MAX_K`），审后 `uncertainty_score = 0.0` 复位——审计是一种按债排程的稀缺资源。
- LLM 的动作空间被收窄到三个动词（GROUP / PROMOTE / RELOCATE），且每组落地走 MERGE（有效子数 < `TREE_MERGE_THRESHOLD` 时摊平子结构）或 WRAPPER 两模式。
- 纯代码兜底：`force_split` 先试 LLM、失败或仍超宽则等分兜底（`group-1/2/…`）；`auto_dissolve` 收尾（≤1 子的切面溶解、双层薄链按 `S_floor(深度)` 溶解）——**LLM 永远不是结构的唯一守护者**。

哲学一句话：**结构不是一次性设计出来的，是按债偿还出来的；LLM 参与"怎么还"，代码保证"总还得动"。**

**本仓对照**：无对应物——任务树（task-tree）、技能库、L3 人格都是**只长不剪**的结构。三个都可能长债：任务树嵌套会失衡，技能库只增不减，人格事实堆积。

**建议（P3 蓝本存档）**：不立即实施，但把"debt 公式 + top-K 预算审计 + 纯代码溶解兜底"记为这三个结构未来自组织时的**算法蓝本**（此为只读理念借鉴；若真做实体级实现，许可红线仍适用——从 Graphiti 取并署名，见第一轮）。

## M4 agent 参与度随查询复杂度升降——与 depth-lane 哲学同构

tech_blog：*"agent involvement scales with query complexity"*——标准检索零 agent（确定性改写 → 三路并行 → 融合去重）；**不足时**才加 reflection 步（首轮检索后检查充分性 → 少量 follow-up 查询 → 二轮）。*"progressively refine its understanding, rather than relying on a one-shot lookup"*。

**本仓对照**：这是本仓 2026-09-03 的 `specs/next-version/depth-lane/`（轻轨/重轨复杂度仲裁）的**哲学原型**：轻轨零增量（flash 调用并出双 verdict），重轨全由原生机制组装，P0 纯观察、数据决策门。MemBrain 用另一个领域（记忆检索）独立收敛到了同一形状——**两个实现者**，与 dsh compaction 两段式之 HKUDS DeepCode 关系同款，建议在 depth-lane 的 design 里补一行外部论据。

升档（agentic recall 充分性检查）**建议（P2，等 depth-lane P0 数据）**：auto-recall 首轮结果过低/空 → 触发一次 follow-up 查询二轮。落地前提是 recall 使用量真实存在。

## M5 上下文是组装出来的：选样序 ≠ 呈现序，日期算术替 LLM 做掉

`budget_pack.py` 的三个决定都值得抄：

1. **选样按分数、呈现按时间**：按 `rerank_score` 贪心填预算（分数决定"谁进来"），随后**按时间重排**再输出（时间序决定"以什么顺序读"）——两个序各司其职，混用两头受损。
2. **相对时间在打包期解析**：`_resolve_inline_dates` 把 `[last week::2024-03-04/2024-03-10]` 直接替换成 `[2024-03-04/2024-03-10]`，注释写明动机 *"to avoid LLM date arithmetic errors"*——**"上周是哪天"这种算术在代码里做完，不让消费方 LLM 做**。
3. **事件时间与获知时间分离**：无内联时间标记的事实，把会话时间戳附成 `(known from message on 2023-05-08)`——LLM 不会把"聊天发生在 5 月 8 日"误读成"事件发生在 5 月 8 日"。

**本仓对照**：`formatMemoryLine` 的时间语义更结构化（点时间 + 段时间三字段），但**相对表达不预解析**、"获知时间"概念也没有；第一轮把 token 预算打包降为 P2 是对的（量还小），但"选样序/呈现序分离"与"日期算术前置"与量无关，是纯收益。

**建议（P2，半天～1 天）**：记忆注入的行渲染期做相对→绝对换算（换算不了就保留原样并标注"（源未锚定）"），区分事件时间与获知时间。与 8-17 #3 的"源精度"硬规则同一族。

## M6 数据库是基础设施：可追溯/可审计/可隔离/可同步

tech_blog Future Work：*"the more the system leverages database-level properties—traceability, auditability, isolation, and synchronization—the easier it becomes to iterate. Every operation is recorded, reversible, and inspectable"*；*"each decision made by agents during memory management naturally accumulates as data"*。配套物：per-task 物理 schema 隔离（`task_{pk}__{run_tag}`，实验互不污染）、checkpoint/resume 在 infra 不在 core、四类引擎各司其职 + 连接预算表、`concurrency.md` 里连 Known Issues Log 都完整成文。

**本仓对照**：同哲学已经在跑——usage-ledger append-only JSONL（任何请求都可追溯）、file-history git（可逆）、sessions JSONL（可审计）、projectCode 目录隔离。**判定：已采纳。** 可借鉴的是**写法**：把"连接/资源预算"写成明文档（他们的连接预算表 ≤35/150）——本仓若有并发预算（如 MCP 子进程上限、桥请求预算），值得同样落一份表进 `docs/architecture.md`，而不是散在注释里。

## M7 检索即维护（观念种子）

tech_blog Future Work 第二条：*"use retrieval as an opportunity to lightly reorganize memory along the accessed paths… each query is not just reading memory, but also helping maintain it."* 检索路径暴露"记忆组织方式"与"查询分布"的错配，是免费的结构反馈信号。

**本仓对照**：routing 闭环（R1-R4）有冻结 Map + 元数据契约 + LRU GC，但**没有访问遥测**——哪些技能/工具/记忆被真正选中过，选完之后的命中质量如何，无记录，自然也无"按访问路径重组"。

**建议（P3 观念种子，不排期）**：等 depth-lane P0 的观察数据落地后（它本来就要记录 lane 命中），顺手把"routing 决策 + recall 命中"作为遥测面设计进去，未来喂给重组。现在只立观念。

## M8 辅助 LLM 调用清单化：每个调用都是版本化工件

MemBrain 对"辅助 LLM 调用"的形态学：

- **清单四件套**：`manifest.json`（task_id / model / temperature / max_tokens / parameters / timeout / `output_schema` 指向 `schema.py`）+ `system.md`（模板）+ `context.md`（填参说明）+ `schema.py`（输出契约）。14 个提示词全部以纯文本工件提交在 `manifests/*/`——**改提示词 = 改一个被版本管理的文件，有 diff 可审**。
- **输出校验器**：`@agent.output_validator` 在违规时抛 `ModelRetry`（模型自己收到"为什么错"再试）；终极回退是无约束重试再过滤。
- **重试分层**（`retry.py`）：瞬态错误分类（429/5xx/超时/连接）、`Retry-After` 优先、content-filter 无睡眠快试最多 10 次（非确定性错误重试机制不同于确定性错误）、错误日志落 `output/api_errors.jsonl` 带 task 归因。

**本仓对照（走读结果）**：辅助原语已立且质量不低——`judgeViaLlm`（判断型：flash 模型/JSON 模式/max_tokens=64/fail-open 返回 null）与 `completeTextViaLlm`（翻译型：无 JSON 模式/低温/无上限/fail-open），消费点：`lifecycle:478/768`、`mcp:212`、`skills:105/279`、`tasks:625`。瞬态错误分类在 `llm-error.ts`（dsh P0）已落地。**差距收窄为两件事**：① 逐调用的**输出 schema 校验**没有统一入口（每个调用点自己 parse，宽严不一）；② **重试预算**没有逐调用约定（失败即 null 走 fail-open 是对的，但"试几次、间隔多少、要不要区分错误类型"未约定）；③ 提示词模板虽在 `prompt.ts`/EJS，但**辅助调用的提示词没有独立工件化**，散在调用点字符串里。

**建议（P1，1-2 天，本篇最有价值的可落地项）**：给辅助调用补一份轻约定（不引入新依赖、不加新层）：

1. `judgeViaLlm`/`completeTextViaLlm` 增加**可选的 schema 校验参数**（纯函数校验器：形状/枚举/必需字段），校验失败计一次"内容级失败"，与传输级失败共用 fail-open 语义；
2. 重试预算常量化（如内容级失败 ≤2 次、瞬态由 `llm-error.ts` 既有分类决定），写进两原语的 JSDoc 契约；
3. 选**一个示范点**把提示词抽成模板文件——首选 `session-manager-skills.ts:105` 的技能匹配（它最像 MemBrain 的 router agent：轻量模型/低温/JSON/缓存/fail-open，depth-lane 调研也点了它，且其复杂度评分扩展已在 depth-lane 排期，模板化先行为它铺路）。

## M9 域×层二维 + 「LLM 即算法」例外 + 已知妥协文档化

`layered-architecture.md` 的三层纪律（core 纯逻辑不碰 DB/HTTP、application 定顺序、infra 管真实世界）与本仓 layer 规则同源（core UI-free、宿主注入 logger、vendored 路径宿主注入）。两个额外的自觉值得记录：

1. **「LLM 即算法」例外被显式论证**：树审计/传播函数发起 LLM 调用却留在 core，因为"LLM 不是 I/O 源而是计算引擎（如同 numpy 之于矩阵）"——判据是*不写 DB、不管连接生命周期、进内存出内存*。本仓 core 允许 LLM 调用（session 循环本来就在 core），这条判据恰好解释了为什么这是合理的：**禁的是 I/O 与生命周期，不是计算**。
2. **「已知妥协」清单**：文档明列两处违背自身原则的妥协（pipeline.py 编排函数留在 core 因类型依赖倒置、retrieval.py 内嵌 SQL 因与 PG 方言耦合）并说明为何暂不修。本仓 AGENTS.md 的 gotcha 段已经很像，但"已知妥协"是**主动声明的债**，比"踩过的坑"高一层——建议架构文档遇到刻意违背自身规则的地方照此办理（现有例子：`usage-ledger` 故意绕开 sessions-index debounce 的说明已是这个形态，保持即可）。

## M10 抽取提示词的写法哲学

`manifests/fact-generator/system.md` 全文读下来，五个技法本仓 L1 抽取提示词（8-17 #3 落地两条硬规则之后）还差三个：

- **上下文分界线**：`--- EXTRACT BELOW ---` 之上只用于解析指代、**不许抽取**；之下才产事实——批量滑动窗口抽取时不重复抽取上文已确立的事实（*"do not re-extract facts already established in the context"*）。
- **终检扫查（final sweep）**：Reasoning Steps 最后一步强制"重读每条输出、专查漏标的时间表达"——把校验做成**输出前程序**而非输出后祈祷。
- **逐字保留清单**：具体名目（书名/品牌/物种种名/数量/序数）*"preserve them verbatim… Do NOT generalize them into a summary phrase"*，频率表达逐字保留（"every Tuesday and Thursday" 不得改写成 "twice a week"）——**可检索性是抽取的第一约束**，泛化即丢召回。

其余（时间源精度、原子性、代词替换、禁止编造）本仓 #3 已覆盖同构内容。

**建议（P1，半天～1 天，纯提示词层，零 schema 变更）**：`memory/src/tdai/core/prompts/l1-extraction.ts` 增三条：分界线语义（若管线是增量批式，标注"上方仅解析"；单次全量则可并入"禁再抽取"）+ final sweep 步 + 逐字保留清单；配套软校验（抽出的专有名词在源文本中不存在 → warn 可观测，与 #3 的 fabricated 日期告警同款处置）。

---

# Part III 联合元哲学：供给侧工程

两仓各自的领域不同（一个供给代码感知，一个供给记忆），但手法清单高度一致，合起来就是一套"如何围绕一个预算受限的 agent 做供给"的完整立场：

1. **预算无处不在**：token 预算（打包 4500+1500、诊断 ≤2KB）、审计预算（top-K）、BFS 预算（`reference_depth=2, reference_limit=8`）、重试预算（max_retries/content-filter 上限）——**没有无界的输入，也没有无界的 retry**。
2. **确定性优先，LLM 按预算参与**：路由零 LLM、溶解零 LLM、兜底零 LLM；LLM 只在语义判断处出现，出现即有 top-K、复位、回退三件套。
3. **带内诚实**：降级态写入输出（header/footer/status 字段）、截断留计数（"…and N more"、`_(truncated, limit=8)_`）、clean 与不可用必须可区分。
4. **提示词是版本化工件**：模板/schema/校验器/重试策略四件套随代码走，改提示词 = 审一个 diff。
5. **能力与纪律同步出厂**：给 agent 交付一个能力时，同时交付"什么时候用、按什么步骤用、用完怎么验证"的 SOP 与提醒机制。

本仓的 fail-open、刻意最小工具面、注册 root 安全边界、usage-ledger 可追溯等立场与之**大半同源**（独立收敛，非抄袭来源）；上表标"真差距"的六处（C2 残留、C3/C5、C6 对账、M5、M8、M10）是这份立场里我们还没走完的部分。

---

# Part IV 明确不借鉴

承接第一轮四条（append-only 无冲突消解 / ParadeDB+Postgres 硬依赖 / 2560 维嵌入 / 按榜单塑形产品提示词），另加两条本轮新增：

1. **文档承诺以代码为准（核证纪律重申）。** MemBrain 的文档-代码矛盾仍在：entity "versioned history" 无 version 列无历史表；`invalidate_facts` 只存在于 `concurrency.md` 流程图、函数全仓不存在。教训不是"别学 MemBrain"，而是**任何"它有 X"的结论必须落到 file:line**——本仓 8-17 的三轮递进核证（子代理逐文件 → 本仓走读 → 浅克隆一手）就是这个纪律，本篇全部沿用。
2. **榜单叙事不当能力依据。** CodeBrain 的 72.3%/63.9% 与 MemBrain 的 LoCoMo +0.20pt 都存在 backbone/复现口径问题；只取其**方向性结论**（harness 失败模式修复是收益主源；DB 级性质降低迭代成本），不取其数字。

---

# Part V 建议动作

> 均为理念→工程的映射项，**全部不引入新依赖、不引上游代码**；正式实现以 `specs/` 为准（总口径）。与既有台账的关系已逐条标注，避免重复立项。

| # | 事项 | 落点 | 成本 | 依据 | 与既有台账关系 |
| --- | --- | --- | --- | --- | --- |
| 1 | 诊断桥 leg 状态入带（区分 clean 与 unavailable） | `session-manager-diagnostics.ts`（`DiagnosticsLegResult` + 消息构造） | 半天 | C2 | 8-17 #2 三态入带的延伸；无重复 |
| 2 | L1 抽取提示词三式（分界线 / final sweep / 逐字保留清单）+ 软校验 | `memory/src/tdai/core/prompts/l1-extraction.ts` | 半天-1 天 | M10 | 8-17 #3 同族续作 |
| 3 | edit/write 后单文件即时校验提示 | `tools/edit-handler.ts` / `write-handler.ts` 结果 metadata | 1 天 | C3/C4 | 第一轮 §1.3-3 漏项补上 |
| 4 | 辅助调用契约：schema 校验参数 + 重试预算常量 + 技能匹配示范模板化 | `session-manager-base.ts` 两原语 + `session-manager-skills.ts:105` | 1-2 天 | M8 | 为 depth-lane 的 flash 扩展铺路；llm-error.ts 既有分类复用 |
| 5 | LSP 桥环境就绪探测（deps-missing → 降级原因入带） | `desktop/main/tools/lsp-bridge/` | 半天 | C5 | 与 #1 同批做，共享入带通道 |
| 6 | C6 失败模式七项独立对账（直接对照 session 循环） | 文档级（CMB 台账 CMB-6） | 半天 | C6 | **不新立 spec**；premature stop 需先与 `waiting_for_user` 边界辨析 |
| 7 | 记忆注入相对时间预解析 + 事件/获知时间分离 | memory 行渲染 | 半天-1 天 | M5 | 与 #2 同批 |
| 8 | agentic recall 充分性检查（二轮 follow-up） | `auto-recall.ts` | 待数据 | M4 | **等 depth-lane P0 观察数据**；先回写 depth-lane design 补 MemBrain 论据 |
| 9 | 结构债调度（debt 公式 + top-K 审计 + 纯代码溶解）作任务树/技能库/L3 自组织蓝本 | 仅存档 | — | M3 | P3 观念种子 |
| 10 | 检索即维护遥测（lane 命中 + recall 命中记录） | depth-lane P0 观察面顺手扩展 | 待排期 | M7 | P3；依赖 #8 的观察期 |
| 11 | M1 固化为工程规则（确定性优先 + LLM 预算化参与） | specs 模板/评审习惯，一句话 | 0 | M1 | 零代码，纯立场 |

**开工顺序建议**：#1 + #5 同批（同一入带通道）→ #2 + #7 同批（同一文件族）→ #3 → #4 → #6（对账）→ #8/#9/#10 等观察期。

## 结尾口径

本篇为纯调研留档，无代码变更；调研仅供参考，**实现以 `specs/` 为准**。若 #1-#4 中任何一项被采纳，按维护规则回写本索引消费状态，并以 spec 为唯一实现依据。
