# 问题台账：CodeBrain / MemBrain 理念借鉴落地项（CMB 系列）

> 建档日期：2026-09-04
> 来源：[2026-09-04-codebrain-membrain-philosophy.md](./2026-09-04-codebrain-membrain-philosophy.md)（理念层第二轮调研）§四个真发现 + Part V 落地建议表
> 性质：**CMB-1/2/4/5 为四个真发现**（本仓侧逐行核证，可开工）；其余为 Part V 全量收录（P2 观察项 / P3 观念种子）
> **文件定位：落地项追踪台账，非缺陷审计**（区别于 `2026-08-05-audit-issues.md` 那类 Critical/High 代码缺陷清单）。11 条中仅 **CMB-1 / CMB-5 具缺陷性质**——且都属于"误导性输出"类（模型被告知错误信息），**无崩溃、无数据错误、不阻塞发布**；其余为增强项（CMB-2/3/4/7）、纯文档项（CMB-6）、观念种子（CMB-9/10/11）。逐条性质见总览表"性质"列。
> 硬约束：全部**零新依赖、不引上游代码**（MemBrain 无 LICENSE 文件，禁止拷贝——08-17 预研许可红线）
> 总口径：**实现一律以 `specs/` 为准**；P1 项开工前按总口径落 spec 或在本文档跟踪验收回写。

## 状态图例

- ⬜ **未开工**（默认）
- 🟨 **进行中**
- ✅ **已落地**（回写提交号 + 验收证据）
- ❌ **否决**（写明理由，保留决策痕迹）

## 总览

| ID | 事项 | 性质 | 优先级 | 成本 | 状态 | 来源哲学 |
| --- | --- | --- | --- | --- | --- | --- |
| CMB-1 | 诊断桥 leg 状态入带（区分 clean 与 unavailable） | **缺陷**（行为层·误导输出：没跑成被当成通过） | **P1 · 真发现** | 半天 | ⬜ | CodeBrain C2 |
| CMB-2 | L1 抽取提示词三式（分界线 / final sweep / 逐字保留清单） | 增强（提示词层，零 schema 变更） | **P1 · 真发现** | 半天-1 天 | ⬜ | MemBrain M10 |
| CMB-3 | edit/write 后单文件即时校验提示 | 增强（工具结果面新增提示） | P1 | 1 天 | ⬜ | CodeBrain C3/C4 |
| CMB-4 | 辅助 LLM 调用契约（schema 校验 + 重试预算 + 示范模板化） | 增强（架构健壮性，现有代码可跑） | **P1 · 真发现** | 1-2 天 | ⬜ | MemBrain M8 |
| CMB-5 | LSP 桥依赖就绪探测（防假阳性诊断回灌） | **缺陷**（条件触发·假阳性：deps 缺失时主动误导） | **P2 · 真发现** | 半天 | ⬜ | CodeBrain C5 |
| CMB-6 | C6 失败模式七项独立对账（session 循环，不锚外部台账） | 纯文档（对账表） | P2（文档级） | 半天 | ⬜ | CodeBrain C6 |
| CMB-7 | 记忆注入相对时间预解析 + 事件/获知时间分离 | 增强（记忆渲染） | P2 | 半天-1 天 | ⬜ | MemBrain M5 |
| CMB-8 | agentic recall 充分性检查（二轮 follow-up） | 增强（待数据门） | P2 | 待数据 | ⬜ | MemBrain M4 |
| CMB-9 | 结构债调度蓝本（任务树/技能库/L3 自组织） | 观念种子（纯存档） | P3 | 仅存档 | ⬜ | MemBrain M3 |
| CMB-10 | 检索即维护遥测（lane 命中 + recall 命中记录） | 观念种子（纯存档） | P3 | 待排期 | ⬜ | MemBrain M7 |
| CMB-11 | L3 晚绑定渲染（人格在注入时叠加） | 观念种子（纯存档） | P3 | 观念种子 | ⬜ | MemBrain M2 |

**开工顺序**：CMB-1 + CMB-5 同批（同一入带通道）→ CMB-2 + CMB-7 同批（同一文件族）→ CMB-3 → CMB-4 → CMB-6（对账）→ CMB-8/9/10 等观察期。

---

# P1 · 四个真发现（可开工）

## CMB-1. 诊断桥复刻了第一轮批过 CodeBrain 的缺陷：两腿 catch 静默，clean 与"没跑成"带内不可区分 ⬜

- **优先级/成本**：P1 · 半天
- **现象与证据**：`session-manager-diagnostics.ts:84-101` 两腿（Serena + LSP bridge）对每次调用的 `catch` 均静默 best-effort（注释自述 *"the bridge failing (missing language server, budget, timeout) degrades to silence"*）；`buildDiagnosticsSystemMessage` 在 `totalErrors === 0` 时返回 null（当作 clean）。后果：**"检查通过"与"检查根本没跑成（语言服务器缺失/超时/预算耗尽）"带内不可区分**——与 08-17 预研 §1.2 批过 CodeBrain 的"超时被静默吞掉返回 `[]`——与文件干净不可区分"同构。
- **建议修法**：`DiagnosticsLegResult` 增每腿状态（`ok | unavailable`）；消息构造在"存在 unavailable 腿"时注入一行降级说明（如 `⚠️ 诊断检查不可用：LSP bridge 未连接（trigger=manual 或语言服务器缺失）`）；**clean 语义收紧为"两腿可用且零错误才返回 null"**。
- **验收标准**：`buildDiagnosticsSystemMessage` 纯函数真值表测试（clean / 单腿 unavailable / 双腿 unavailable / 有错误混 unavailable）；clean 路径回归（有错误且全可用时行为不变）。
- **来源**：调研文档 C2；08-17 #2 三态入带（`analysis-status.ts`）的延伸，无重复。

## CMB-2. L1 抽取提示词还差三式：上下文分界线、输出前 final sweep、逐字保留清单 ⬜

- **优先级/成本**：P1 · 半天-1 天（纯提示词层，零 schema 变更）
- **现象与证据**：`manifests/fact-generator/system.md`（MemBrain）五个技法中，本仓 08-17 #3 已覆盖时间源精度 + 原子性两条，尚缺三条：① **上下文分界线**——`--- EXTRACT BELOW ---` 之上只解析指代、不许抽取，*"do not re-extract facts already established in the context"*（增量批式抽取不重复）；② **终检扫查（final sweep）**——Reasoning Steps 最后一步强制"重读每条输出、专查漏标的时间表达"，校验做成输出前程序而非输出后祈祷；③ **逐字保留清单**——具体名目（书名/品牌/物种/数量/序数）*"preserve them verbatim… Do NOT generalize them into a summary phrase"*，频率表达逐字保留（"every Tuesday and Thursday" 不得改写成 "twice a week"）——**可检索性是抽取的第一约束，泛化即丢召回**。
- **建议修法**：`memory/src/tdai/core/prompts/l1-extraction.ts` 增三条规则（分界线语义按管线形态落：增量批式标注"上方仅解析"；单次全量则并入"禁再抽取"）；配套软校验：抽出的专有名词在源文本中不存在 → `logger.warn` 可观测不丢弃（与 08-17 #3 的 fabricated 日期告警同款处置）。
- **验收标准**：SYSTEM_PROMPT 字符串断言含三条规则（08-17 #3 同款验收形态）；软校验告警路径测试；既有 L1 用例零回归。
- **来源**：调研文档 M10。

## CMB-3. edit/write 后单文件即时校验提示（第一轮 §1.3-3 漏项补上）⬜

- **优先级/成本**：P1 · 1 天
- **现象与证据**：edit/write 工具结果不携带校验提示（grep 证实，`edit-handler.ts` 的 metadata 均为文件元数据），唯一反馈通道是回合末诊断桥——粒度差一档。CodeBrain 的节奏是**每文件一个循环**（edit → validate → 修干净才动下一个文件），其 hook 也只是"提醒"不是"替它跑"。
- **建议修法**：edit/write 成功且目标文件属于代码类扩展名时，工具结果 metadata（或追加说明）附一行：`（已修改 <file>，建议立即运行诊断检查；回合末将自动复核）`。与回合末桥互补不冲突。
- **边界说明**：工具结果是模型面而非 UI 面，**无需 i18n 6 目录**（无 renderer 文案）。
- **验收标准**：handler 测试断言 metadata 字段在代码类扩展名时存在、非代码扩展名时不存在；回合末诊断桥行为不变。
- **来源**：调研文档 C3/C4；08-17 §1.3-3 提过但未进 §6 落地清单。

## CMB-4. 辅助 LLM 调用缺逐调用约定：schema 校验与重试预算未工件化 ⬜

- **优先级/成本**：P1 · 1-2 天（**Part V 表中最有价值的可落地项**）
- **现象与证据**：辅助原语已立且质量不低——`judgeViaLlm`（判断型：flash/JSON 模式/max_tokens=64/fail-open）与 `completeTextViaLlm`（翻译型：无 JSON/低温/无上限/fail-open），消费点 `lifecycle:478/768`、`mcp:212`、`skills:105/279`、`tasks:625`（共 8 调用点）。差距：① 逐调用**输出 schema 校验**无统一入口（各调用点自行 parse，宽严不一）；② **重试预算**无逐调用约定（失败即 null 走 fail-open 正确，但试几次/间隔/错误类型区分未约定）；③ 辅助调用提示词**未工件化**，散在调用点字符串里。MemBrain 对照物：manifest 四件套（manifest.json + system.md + context.md + schema.py）+ `ModelRetry` 输出校验器 + 分层重试（瞬态 429/5xx 退避、content-filter 快试、错误日志 JSONL 归因）。
- **建议修法**（不引入新依赖、不加新层）：① 两原语增**可选 schema 校验参数**（纯函数校验器：形状/枚举/必需字段），校验失败计一次"内容级失败"，与传输级失败共用 fail-open 语义；② 重试预算常量化（如内容级失败 ≤2 次，瞬态由 `llm-error.ts` 既有分类决定——dsh P0 已落地，直接复用），写进原语 JSDoc 契约；③ 选**一个示范点**把提示词抽成模板文件：首选 `session-manager-skills.ts:105` 技能匹配（最像 MemBrain 的 router agent：轻量模型/低温/JSON/缓存/fail-open，且 depth-lane 的复杂度评分扩展排期在同一点上，模板化先行为其铺路）。
- **验收标准**：校验器真值表测试；重试预算测试（内容级失败计次、预算耗尽 fail-open 返回 null）；既有调用点回归 + **mutation-check**（临时破坏校验器确认测试失败后还原，按 AGENTS.md 要求做一次）。
- **来源**：调研文档 M8。

---

# P2 · 真发现 1 条 + 观察/对账 3 项

## CMB-5. LSP 桥不查依赖就绪：node_modules 缺失时假阳性 import 错误回灌对话 ⬜

- **优先级/成本**：P2 · 半天（**与 CMB-1 同批实施**，共享入带通道）
- **现象与证据**：`desktop/main/tools/lsp-bridge/controller.ts:27` `isAvailable(): boolean { return existsSync(this.opts.serverEntry); }`——只查桥自身二进制存在，**不查项目依赖就绪**。TS 项目 `node_modules` 缺失时 typescript-language-server 稳定产出假阳性 import 错误，经诊断桥回灌为"编辑后诊断发现 N 个错误"，污染 agent 自我修正方向。CodeBrain bootstrap 的对应信念：*"Without these steps, validate() may report false-positive import/dependency errors"* + 逐子项目就绪告警（.venv / node_modules / go vendor）。
- **建议修法**：桥侧按语言族做轻量就绪探测（TS：`node_modules` 存在；Python：`.venv`/site-packages 线索；Go：`go.sum` 存在），不就绪 → 该腿报 `unavailable(deps-missing)` 并带一句补救指引（"run npm install"），走 CMB-1 的入带通道。
- **边界说明**：路径判断按 AGENTS.md 跨平台路径策略**复用生产路径助手**，不做手搓分隔符替换。
- **验收标准**：就绪判据单测（三语言族真值表，跨平台）；deps-missing 时诊断消息含降级原因与补救指引；deps 齐全路径零行为变化。
- **来源**：调研文档 C5。

## CMB-6. CodeBrain 失败模式七项独立对账（session 循环）⬜

- **优先级/成本**：P2 · 半天（文档级）
- **背景**：原方案"并入 dsh-consolidated 台账对账"——**2026-09-04 dsh 线经用户拍板封闭**，本项改独立形态：七项直接对照本仓 session 循环逐条判定，不锚任何外部台账。
- **内容**：README 自述七项（premature stop recovery / 结构化前置勘察 / dynamic reasoning effort / tool-call 格式自动纠错 / stuck-detection / 上下文压缩早期 pin / per-model 提示词）逐条对照本仓现状判定"已有/候选/否决"：
  - **已有对应物**：上下文压缩（compaction 中间 2/3 摘要 + 预发送阈值）、per-model 差异化（per-family reasoning 读字段契约）、瞬态错误处理（`llm-error.ts` 分类 + 溢出 compact-and-retry + 流 idle 看门狗）；
  - **候选（未检索到）**：premature stop（"未验证停止"续推）、stuck/重复同参调用检测、per-phase reasoning effort（规划/验证高档、实现中档）、tool-call 格式自动纠错、结构化前置勘察；
  - **premature stop 须先与 `waiting_for_user`/`ask_permission` 显式状态边界辨析**（本仓的"停止"常是有意设计，判据应是"任务未验证却停下"而非"见消息无工具就续推"）。
- **边界**：**每条过 P0 观察数据门再定**（与 depth-lane 决策纪律一致）；七项的实现在上游未开源，只取失败模式分类学；候选条目如启动，按总口径独立立项。
- **验收标准**：本台账出现七项对账表，每条标注"已有/候选/否决"与理由。
- **来源**：调研文档 C6。

## CMB-7. 记忆注入相对时间预解析 + 事件/获知时间分离 ⬜

- **优先级/成本**：P2 · 半天-1 天（**与 CMB-2 同批**，同一文件族）
- **内容**：MemBrain `budget_pack.py` 三个决定的残留：① 选样按分数、呈现按时间（两序分离）；② `_resolve_inline_dates` 在打包期把相对时间换算为绝对（动机 *"to avoid LLM date arithmetic errors"*——算术在代码里做完，不让消费方 LLM 做）；③ 事件时间与获知时间分离（无内联标记的事实附 `(known from message on DATE)`，防 LLM 把聊天时间误读为事件时间）。本仓 `formatMemoryLine` 时间语义更结构化但相对表达不预解析。
- **建议修法**：记忆行渲染期做相对→绝对换算（换算不了保留原样并标"（源未锚定）"）；区分事件时间与获知时间两个字段语义。
- **验收标准**：中文/英文相对表达换算真值表（含"上周/昨天/3 天前/最近"）；不可锚定路径保留原样；渲染回归。
- **来源**：调研文档 M5；与 08-17 #3 源精度规则同族。

## CMB-8. agentic recall 充分性检查（二轮 follow-up）⬜

- **优先级/成本**：P2 · **待数据**（等 `specs/next-version/depth-lane/` P0 观察数据）
- **内容**：MemBrain"agent 参与度随查询复杂度升降"的升档——标准检索零 agent（本仓已有：确定性事件向改写，08-17 #1 落地）；**首轮结果过低/空 → 充分性检查 → 少量 follow-up 查询二轮**。前置动作：把 MemBrain 作为 depth-lane 的**第二实现者论据**回写其 design（与 HKUDS DeepCode compaction 两段式之于 dsh P1-2 同款关系）。
- **验收标准**：depth-lane design 补论据一行；升档实现待 P0 数据门。
- **来源**：调研文档 M4（与 depth-lane 哲学同构）。

---

# P3 · 观念种子（只存档不排期）

## CMB-9. 结构债调度蓝本（任务树/技能库/L3 自组织）⬜

- **内容**：MemBrain 实体树维护调度器作算法蓝本存档：`debt = uncertainty + W_WIDTH·超宽 + W_DEPTH·(深度 − D_max(support))`，`D_max(n) = round(2 + 1.3·ln n)`；全树按债排序**只审 top-K**、审后复位；LLM 动作收窄三动词（GROUP/PROMOTE/RELOCATE）+ MERGE/WRAPPER 两模式；纯代码兜底（force_split 等分 + auto_dissolve ≤1 子溶解）。**适用对象**：任务树（嵌套失衡）、技能库（只增不减）、L3 人格（事实堆积）——都是只长不剪的结构。哲学一句话：**结构不是一次性设计出来的，是按债偿还出来的；LLM 参与"怎么还"，代码保证"总还得动"**。
- **边界**：理念级借鉴；若真做实体级实现，从 Graphiti 取并署名（08-17 许可红线）。**触发条件**：任一结构出现可观测的失衡/堆积再启动。

## CMB-10. 检索即维护遥测 ⬜

- **内容**：tech_blog Future Work："use retrieval as an opportunity to lightly reorganize memory along the accessed paths… each query is not just reading memory, but also helping maintain it." 检索路径暴露组织方式与查询分布的错配，是免费结构反馈。**落点**：depth-lane P0 观察面顺手扩展（记录 routing 决策 + recall 命中），未来喂给重组。**触发条件**：CMB-8 的观察期启动后顺手设计。

## CMB-11. L3 晚绑定渲染 ⬜

- **内容**：tech_blog："Each fact effectively acts as a renderable template: the fact itself remains stable, but the associated entity information is always up to date." 事实记录"什么发生了"，人格层记录"现在怎么看"，拼接发生在注入时（而非把结论写进历史事实）。**触发条件**：L3 人格继续演进的结构化讨论（与 CMB-9 同场）。

---

## 回写规则

- 任一项落地：本文件回写 ✅ + 提交号 + 验收证据；[README 索引](./README.md) 对应行同步消费状态。
- 否决：标 ❌ 并写明理由与取代者，保留决策痕迹。
- 全部实现以 `specs/` 为准；调研文档不作为实现依据（总口径）。
