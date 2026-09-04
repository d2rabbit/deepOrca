# CodeBrain / MemBrain 理念采纳（cmb-adoption）· 供给侧工程落地 — 技术设计

> **状态**：**设计定稿待实现（2026-09-04）**——上游调研已全部定稿：理念层 [`docs/research/2026-09-04-codebrain-membrain-philosophy.md`](../../docs/research/2026-09-04-codebrain-membrain-philosophy.md)（Part V 建议动作表）、问题台账 [`docs/research/2026-09-04-codebrain-membrain-issues.md`](../../docs/research/2026-09-04-codebrain-membrain-issues.md)（CMB-1~11，开工顺序与验收标准的唯一跟踪点）。本 spec 是台账中 **CMB-1/2/3/4/5/7 六项的实施依据**（总口径："实现一律以 `specs/` 为准"）。
> **对应实现域**：`core/`（诊断腿状态机、edit/write 提示、辅助 LLM 原语契约）、`desktop/`（LSP 桥依赖就绪探测）、`memory/`（L1 提示词、记忆行渲染）。**活跃 spec，不属 `next-version` 规划区。**
> **硬约束**（台账总约束，全程有效）：① **零新依赖**——不引 zod/ajv/上游任何包；② **不引上游代码**——MemBrain 无 LICENSE 文件，禁止拷贝（08-17 预研许可红线），只借鉴理念自写实现；③ 全部改动为**模型面/日志面**文案与行为，**无 renderer 面文案，不进 i18n 6 目录**。

---

## 0. 背景与结论

### 0.1 提案是什么（一句话）

把 CodeBrain / MemBrain 两仓调研提炼的"供给侧工程"哲学中已判定的**六处真差距**落成代码/提示词/契约：诊断降级诚实入带、LSP 桥依赖就绪前置、L1 抽取提示词补三式、edit/write 后即时校验提示、辅助 LLM 调用工件化契约、记忆时间渲染锚定——全部零新依赖、不引上游代码。

### 0.2 范围判定（TL;DR）

| 台账项 | 事项 | 批次 | 优先级/成本 | 判定 |
| --- | --- | --- | --- | --- |
| CMB-1 | 诊断桥 leg 状态入带（区分 clean 与 unavailable） | **A** | P1 · ~0.5d | ✅ 采纳（缺陷性质，误导输出类） |
| CMB-5 | LSP 桥依赖就绪探测（防假阳性诊断回灌） | **A** | P2 · ~0.5d | ✅ 采纳（缺陷性质；与 CMB-1 同批，共享入带通道） |
| CMB-2 | L1 抽取提示词三式 + 软校验 | **B** | P1 · ~0.5-1d | ✅ 采纳（纯提示词层） |
| CMB-7 | 记忆注入相对时间预解析 + 事件/获知时间分离 | **B** | P2 · ~0.5-1d | ✅ 采纳（与 CMB-2 同批，同一文件族） |
| CMB-3 | edit/write 后单文件即时校验提示 | **C** | P1 · ~1d | ✅ 采纳 |
| CMB-4 | 辅助 LLM 调用契约（schema 校验 + 重试预算 + 示范模板化） | **D** | P1 · ~1-2d | ✅ 采纳（调研判定"最有价值的可落地项"） |
| CMB-6 | C6 失败模式七项独立对账 | — | P2 文档级 | ❌ 不进本 spec（Part V 明确"不新立 spec"，对账表落台账本身） |
| CMB-8 | agentic recall 充分性检查 | — | P2 | ❌ 不进本 spec（待 depth-lane P0 观察数据门；仅先回写其 design 补 MemBrain 论据，见 §5） |
| CMB-9/10/11 | 结构债调度 / 检索即维护遥测 / L3 晚绑定 | — | P3 | ❌ 不进本 spec（观念种子，只在台账存档，各有触发条件） |
| Part V #11 | M1 固化为工程规则 | — | 0 | ✅ 以本 spec §6 作为规范载体（零代码，一句话立场） |

**开工顺序**（继承台账）：批次 A → B → C → D；批次 A 是缺陷修复优先级最高，且 CMB-5 的输出通道依赖 CMB-1 先落。

### 0.3 设计总立场（M1 规则，Part V #11）

> **新增任何 LLM 步骤前，先问：这一步能否由一个预算化的确定性机制承担？只有真正的语义判断才允许 LLM 参与，且必须带预算与失败回退。**

本 spec 六项全部是该规则的实例：CMB-1/5 是确定性状态机与路径探测（零 LLM），CMB-3 是确定性提示注入，CMB-7 是确定性日期换算，CMB-2 是提示词约束 + 确定性软校验，CMB-4 是给**已有**的 LLM 参与点上预算与校验。后文设计均不再重复援引。

---

## 1. 现状与证据（代码取证，2026-09-04 全部一手核实）

### 1.1 CMB-1 · 诊断桥两腿静默（`packages/core/src/session-manager-diagnostics.ts`）

- `DiagnosticsLegResult`（:16）只有 `{ file, source?, errors }`——**没有每腿状态**；
- `maybeRunDiagnosticsCheck`（:80-104）两腿的 `catch` 均静默：Serena（:90-92 *"Best-effort — a Serena hiccup must not block the turn."*）、LSP 桥（:98-101 *"the bridge failing (missing language server, budget, timeout) degrades to silence"*）；
- `buildDiagnosticsSystemMessage`（:28-55）在 `totalErrors === 0` 时返回 null（:44）——**"零错误"与"没跑成"在带内不可区分**。与 08-17 预研 §1.2 批过 CodeBrain 的"超时被静默吞掉返回 `[]`"同构，属于在自己桥上复刻了别人的缺陷。

### 1.2 CMB-5 · 桥不查依赖就绪（`packages/desktop/src/main/tools/lsp-bridge/controller.ts`）

- `isAvailable(): boolean { return existsSync(this.opts.serverEntry); }`（:26-28）——只查桥自身 bundle 存在；语言服务器（tsserver/pyright/gopls…）拉起前**不查项目依赖**。TS 项目 `node_modules` 缺失时 typescript-language-server 稳定产出假阳性 import 错误，经诊断桥回灌为"发现 N 个错误"。
- **关键陷阱（本 spec 新识别，台账未写）**：若桥对 deps-missing 以**正常结构化返回**（`{ok:false, …}` 无异常）应答，`extractErrorDiagnostics` 会解析为零错误——**又落回 CMB-1 要修的"静默当 clean"**。因此 deps-missing 必须走 MCP isError/异常通道（§2.2），让 CMB-1 的腿状态机接住。

### 1.3 CMB-2 · L1 抽取提示词（`packages/memory/src/tdai/core/prompts/l1-extraction.ts`）

- 已有（08-17 #3 落地）：规则 4 时间保真（:36，含"不要虚构"）、规则 5 原子但有叙事（:37）；
- `formatExtractionPrompt` 的骨架（:138-145）**已经有分界形态**：`【背景对话】（仅供理解上下文推断关系/时间，严禁从中提取记忆）` + 分隔线 + `【待提取的新消息】（只从这里提取记忆！）`——**差的是语义没写满**：① 没有"不得重复抽取上文已确立的事实"（增量批式去重）；② 没有 final sweep（输出前终检扫查漏标时间）；③ 没有逐字保留清单（专有名词/频率表达不得泛化）；
- 消费方：`record/l1-extractor.ts:379-403`（SYSTEM_PROMPT 直传 LLM）；既有验收范式：`src/tests/l1-validation.test.ts` 的 SYSTEM_PROMPT 字符串断言。

### 1.4 CMB-3 · edit/write 结果无校验提示

- `core/tools/edit-handler.ts:361-373` 成功结果的 metadata 纯文件元数据（`file_path/replaced_count/…`）；`write-handler.ts:141` 同；`output` 字段只有 `Replaced N occurrence(s) in <file>.`。模型从工具结果得不到"该跑诊断了"的任何提示——唯一反馈通道是回合末诊断桥（粒度差一档）。

### 1.5 CMB-4 · 辅助 LLM 原语（`packages/core/src/session-manager-base.ts`）

- `judgeViaLlm`（:640-682）：flash 模型 / JSON mode / `max_tokens: 64` / fail-open——**已有最小 shape 校验**（`parsed?.choice` + `choices.includes(choice)`，:679-681），但无统一 schema 入口、无重试预算、提示词内联；
- `completeTextViaLlm`（:690-722）：主模型 / temp 0.2 / 无上限 / fail-open——除空串检查外无输出校验；
- 调用点清单（台账口径 8 处）：`lifecycle:478/768`、`mcp:212`、`skills:105/279`、`tasks:625` 等；`session-manager-skills.ts:100-130`（`identifyMatchingSkillNames`）为最典型 router 形态：内联拼 prompt / temp 0.1 / `max_tokens: 256` / JSON mode / fail-open；
- 瞬态错误分类已在 `common/llm-error.ts`（dsh P0 落地），可直接复用；`createChatCompletionStream` 以 `{ source: "auxiliary" }` 记账（:662/:707）——重试即再调用，天然入账，无需新增记账面。

### 1.6 CMB-7 · 记忆行渲染（`packages/memory/src/tdai/core/hooks/auto-recall.ts`）

- `formatMemoryLine`（:746-786）：三时间字段（`timestamp`/`activity_start_time`/`activity_end_time`）已是绝对 ISO 且结构化渲染（活动时间括注）——**结构优于 MemBrain 原型**；
- 缺口：① `content` 内的相对时间表达（"上周/昨天/3 天前"）**不换算**——L1 抽取规则 4（l1-extraction.ts:36）明确"模糊表达保持模糊"，故换算只能做在**消费侧渲染期**，两规则不冲突（抽取保真、渲染锚定）；② 无"获知时间"概念——无时间字段的行无法防 LLM 把注入时间误读为事件时间；
- 注意：**呈现序重排（选样按分数/呈现按时间）不在本 spec 范围**——台账 CMB-7 只锁定时间两件事，召回排序改动等 CMB-8 观察期（见 §7 拍板项 5）。

---

## 2. 设计（四批次）

### 2.1 批次 A · CMB-1 诊断腿状态机（`session-manager-diagnostics.ts`）

**类型扩展**：

```ts
export type DiagnosticsLegStatus = "ok" | "unavailable";
export type DiagnosticsLegResult = {
  file: string;
  source?: "serena" | "lsp";
  status: DiagnosticsLegStatus;        // 新增
  unavailableReason?: string;          // 新增，≤120 字符，透传失败摘要
  errors: string[];
};
```

**期望腿语义**（决定谁有资格" unavailable"，避免制造噪音）：

| 腿 | 计入期望的条件 | 不满足时 |
| --- | --- | --- |
| Serena | `serenaConnected`（:75 既有判定） | 不期望——整个诊断能力未接，属环境状态，不逐回合告警 |
| LSP 桥 | `lsp.enabled && lsp.trigger === "auto" && lspConnected`（:78 既有判定） | 不期望——`trigger: "manual"` 是用户显式配置，回合末不跑是**设计**而非降级 |

**状态记录**：两处 `catch` 从静默改为 `legs.push({ …, status: "unavailable", unavailableReason: e.message 摘要 })`；正常返回 → `status: "ok"`。

**消息构造**（`buildDiagnosticsSystemMessage` 重写真值语义）：

- **真 clean（返回 null 的唯一条件）**：期望腿全部 `ok` 且 `totalErrors === 0`；
- **有 unavailable 腿**：构造消息——若同时有错误则错误正文照旧，末尾追加一行：
  `⚠️ 部分诊断检查不可用：<leg>（<reason>）；"无错误"不等于"检查通过"，本轮结论按部分检查理解。`
  仅 unavailable 无错误时也**必须注入**（这正是本项要消灭的静默场景），消息体只含降级行；
- 截断预算 `MAX_MESSAGE_CHARS = 2048` 不变，降级行优先保留（截断时置于错误正文之前或豁免——实现取"先拼降级行再拼正文"，截断只削正文）。

**验收**（台账原文 + 细化）：`buildDiagnosticsSystemMessage` 纯函数真值表——真 clean / 单腿 unavailable / 双腿 unavailable / 有错误混 unavailable / 期望腿为空（全不期望 → null，不注入）五格；clean 路径回归（有错误且全可用时输出不变）。

### 2.2 批次 A · CMB-5 桥内依赖就绪探测（`desktop/src/main/tools/lsp-bridge/`）

**落点**：桥 server 侧新 helper（`deps-readiness.ts`，与 `routing.ts` 同目录），在 `get_diagnostics` 按语言族路由（`resolveSpecForFile`）之后、spawn 语言服务器之前执行。

**判据表**（只拦"有依赖声明且未安装"，无声明零干扰，fail-open）：

| 语言族 | 依赖声明 | 就绪判据 | missing 判定 |
| --- | --- | --- | --- |
| TS/JS | `package.json` | `<root>/node_modules` 存在 | 有 package.json 且 node_modules 缺失 → missing |
| Python | `pyproject.toml` / `requirements.txt` | `<root>/.venv` 或 `<root>/venv` 存在 | 有声明文件且两者皆缺 → missing |
| Go | `go.mod` | `<root>/go.sum` 存在 | 有 go.mod 且 go.sum 缺失 → missing |
| 其余八族 | — | — | 不适用（本轮只做三族；C#/Java/Kotlin/Swift/Dart 的依赖形态各异，等观察期） |

**回报通道（本 spec 关键设计）**：missing 时 `get_diagnostics` **以异常/isError 通道**返回 `LSP_UNAVAILABLE(deps-missing): <family> dependencies not installed — run npm install / python -m venv .venv`，**禁止**以 `ok:false` 正常结构返回（§1.2 陷阱：会被 `extractErrorDiagnostics` 当 clean）。core 侧 catch 接住后走 CMB-1 的 `unavailableReason` 入带——一次缺陷修复打通两条链。

**工程约束**：路径判断用 `node:path` 生产助手（`join(root, "node_modules")` 等），**不做手搓分隔符替换**（AGENTS.md 跨平台路径策略）；探测不缓存（单次 `existsSync` 成本，npm install 后立即自愈）；探测仅在该族判据命中时发生，其余路径零行为。

**验收**：三族真值表单测（有声明+就绪 / 有声明+缺失 / 无声明，跨平台 tmpdir 构造）；deps-missing 时消息含原因与补救指引；deps 齐全路径零行为变化。

### 2.3 批次 B · CMB-2 L1 提示词三式 + 软校验（`memory/tdai/core/prompts/l1-extraction.ts` + `record/l1-extractor.ts`）

**SYSTEM_PROMPT 增三条规则**（编号顺延为 6/7/8，措辞与既有规则同风格）：

1. **分界语义补全**：在既有"背景对话严禁提取"骨架上，补"**亦不得把背景对话中已确立的事实当作新消息重新抽取**"——增量批式滑动窗口不重复入库。骨架（`formatExtractionPrompt` :138-143）不改结构，只补语义行；
2. **final sweep**：Reasoning/输出约束段新增"输出前重读每条记忆，专查漏标/错标的时间表达，发现即修正后再输出"——校验做成输出前程序；
3. **逐字保留清单**：具体名目（书名/品牌/项目名/物种/数量/序数）与频率表达**逐字保留**，不得概括改写（"每周二和周四"不得写成"每周两次"）——可检索性是抽取第一约束。

**软校验**（`record/l1-extractor.ts` 输出解析处）：抽出的记忆 content 中形如专名的 token 在源消息文本中不存在时 `logger.warn`（可观测、**不丢弃**、不阻断）——与 08-17 #3 的 fabricated 日期告警同款处置，落点即该告警所在文件。

**验收**：`l1-validation.test.ts` 同款 SYSTEM_PROMPT 字符串断言扩展三条规则关键词；软校验告警路径测试（命中→warn 且记录保留）；既有 L1 用例零回归。

### 2.4 批次 B · CMB-7 记忆行渲染时间锚定（`memory/tdai/core/hooks/auto-recall.ts`）

**相对时间预解析**：渲染期新 helper（同文件或同目录 `relative-time.ts`）把 `content` 内相对表达换算为绝对区间并就地追加，格式仿既有括注：`（上周 → 2026-08-25 ~ 2026-08-31）`。

- 词表（首期中英各一组）：`今天/昨天/前天/上周/上上周/上个月/最近`、`today/yesterday/last week/last month/recently`；锚 = 该记忆记录的 `timestamp`（获知时刻）；
- **换算不了（词表外/无锚）保留原样**并追加 `（源未锚定）` 标注——宁可诚实也不虚构；
- 真值表覆盖：中文/英文各至少 5 例 + 无锚保留 + 词表外保留。

**事件/获知时间分离**：`formatMemoryLine` 对**两个活动时间字段（`activity_start_time`/`activity_end_time`）均空**的行——即无事件时间、仅有获知时刻——若有 `timestamp` 则追加 `（记录于 <timestamp>）`（获知时间），防 LLM 把"注入发生在何时"读成"事件发生在何时"；活动时间有值时行为不变（既有"活动时间"括注即事件时间语义）。

**验收**：中文/英文相对表达换算真值表（含"上周/昨天/3 天前/最近"）；不可锚定路径保留原样 + 标注；`formatMemoryLine` 渲染回归。

### 2.5 批次 C · CMB-3 edit/write 校验提示（`core/tools/edit-handler.ts` / `write-handler.ts`）

**注入位置**：成功结果的 `output` 字段**追加一行**（模型面直读 output，比 metadata 提示更可达）：

```
（已修改 <file>，建议立即运行诊断检查该文件。）
```

- **触发条件**：`ok: true` 且目标文件扩展名 ∈ 代码类集合（对齐 lsp-diagnostics 十族扩展名——集合常量落 core 侧 `tools/` 共享小模块，注释注明与 desktop `server-specs.ts` 对齐，**不允许 core→desktop 反向依赖**）；
- **措辞拍板**：不承诺"回合末将自动复核"——handler 层拿不到会话诊断配置（连接状态在 mcpManager），承诺了可能说谎（§7 拍板项 3）；"建议立即运行"与 `get_diagnostics` 工具面即可自洽；
- **i18n 边界**：工具结果是模型面非 UI 面，无需 6 目录（台账边界说明原文）；
- write-handler 同款处理；`metadata` 面不新增字段（避免结构面噪音）。

**验收**：handler 测试断言 output 追加行在代码类扩展名时存在、非代码扩展名（如 `.md`/`.txt`）时不存在；回合末诊断桥行为不变。

### 2.6 批次 D · CMB-4 辅助调用契约（`core/common/aux-llm-contract.ts` 新文件 + 两原语 + 一处示范模板）

**① schema 校验器**（`common/aux-llm-contract.ts`，纯函数，零依赖）：

```ts
export type AuxSchema<T> = { readonly describe: string; validate(parsed: unknown): T | null };
export const AUX_CONTENT_RETRY_BUDGET = 2;   // 内容级失败预算（写进 JSDoc 契约）
```

`judgeViaLlm` / `completeTextViaLlm` 各增可选 `opts.schema?: AuxSchema<T>`：传入则输出必须过校验，返回 `T`；未传维持现状（`judge` 保留既有 choices 校验作为内置 schema）。**校验失败 = 内容级失败，与传输级失败共用 fail-open 语义**（最终 null，调用方既有回退不变）。

**② 重试预算**：内容级失败（schema 校验不过 / JSON parse 失败）原语内重试 ≤ `AUX_CONTENT_RETRY_BUDGET` 次；传输级瞬态错误**不做新增重试**——由 `llm-error.ts` 既有分类与调用方既有处理管（调研中 MemBrain 的"瞬态退避/content-filter 快试"分层**不搬**：本仓辅助调用无 content-filter 场景证据，避免为不存在的场景建机制）。每次重试经 `createChatCompletionStream` 的 `auxiliary` 记账，天然入 ledger。

**③ 示范模板化**（单点，不铺开）：新增 `packages/core/templates/auxiliary/skill-matching.md.ejs`，`session-manager-skills.ts:100-130` 的内联 prompt 改为经 `getExtensionRoot()` 读取渲染（复用 prompt.ts 既有 EJS 加载模式，随既有 templates 管线打包，无新增 shipping 工作）。渲染参数：candidate pool / agent-instructions。**改提示词 = 审一个 diff**。其余调用点不迁移（等各自演进时顺带）。

**④ JSDoc 契约**：两原语 doc 注明——输入预算（max_tokens/温度）、输出 schema、内容级重试预算、fail-open 语义、auxiliary 记账义务。

**验收**：校验器真值表测试（形状/枚举/必需字段/nullable）；重试预算测试（内容级失败计次、预算耗尽返回 null）；既有 8 调用点回归；**mutation-check 一次**（临时破坏校验器确认测试失败后还原，AGENTS.md 要求）。

---

## 3. 分期与成本汇总

| 批次 | 内容 | 成本 | 依赖 |
| --- | --- | --- | --- |
| A | CMB-1 腿状态机 + CMB-5 deps 探测 | ~1d | 无（缺陷修复，最高优先） |
| B | CMB-2 提示词三式 + CMB-7 时间锚定 | ~1-2d | 无（memory 域独立） |
| C | CMB-3 edit/write 提示 | ~1d | 无 |
| D | CMB-4 辅助调用契约 | ~1-2d | 无（建议最后做，改动面最大） |

合计约 4-6d。各批次相互独立可并行，仅批次 A 内部 CMB-5 依赖 CMB-1 的通道先行。

## 4. 明确不做（决策留痕）

1. **CMB-6 不进 spec**：对账表落台账本身（Part V"不新立 spec"原文）；premature stop 须先与 `waiting_for_user`/`ask_permission` 边界辨析，且每条过 P0 观察数据门。
2. **CMB-8/9/10/11 不进 spec**：数据门未开 / 观念种子。唯一前置动作——CMB-8 的"MemBrain 作为 depth-lane 第二实现者论据"回写 `specs/next-version/depth-lane/design.md` 一行，随批次 B 顺带完成。
3. **呈现序重排不做**（§1.6）：排序属于召回策略面，等 CMB-8 观察期与 depth-lane 数据共同决策。
4. **MemBrain 代码零拷贝**：全部实现自写；若未来做实体级结构债实现（CMB-9），从 Graphiti 取并署名（许可红线，M3 节原文）。
5. **不引 zod/ajv 等校验库**：`AuxSchema` 纯函数即可覆盖辅助调用的窄形状需求（零新依赖红线）。

## 5. 回写规则（台账 ↔ spec）

- 任一批次落地：`docs/research/2026-09-04-codebrain-membrain-issues.md` 总览表对应行回写 ✅ + 提交号 + 验收证据；本文档状态行同步更新；`docs/research/README.md` 对应行消费状态按维护规则推进。
- 否决/改向：台账标 ❌ 写明理由，本文档 §4 增补决策留痕。

## 6. 拍板项（已定，实现时无需再问）

| # | 事项 | 决定 | 理由 |
| --- | --- | --- | --- |
| 1 | `trigger: "manual"` 是否算 LSP 腿 unavailable | **不算**（不期望腿） | manual 是用户显式配置，回合末不跑是设计而非降级；逐回合告警是噪音 |
| 2 | deps-missing 的 MCP 返回通道 | **异常/isError 通道** | 正常结构返回会被 `extractErrorDiagnostics` 当 clean（§1.2 陷阱） |
| 3 | CMB-3 提示是否承诺"回合末自动复核" | **不承诺** | handler 层无会话诊断配置可见，承诺可能为假 |
| 4 | CMB-7 是否含选样/呈现双序分离 | **不含** | 台账范围锁定时间两件事；排序等观察期 |
| 5 | CMB-4 是否搬 MemBrain 分层重试（瞬态退避/content-filter 快试） | **不搬** | 无 content-filter 场景证据；瞬态已有 `llm-error.ts` 分类 |
