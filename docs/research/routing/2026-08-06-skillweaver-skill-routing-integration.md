# SkillWeaver 技能路由 + 嵌入检索 + 技能工程工具链 集成评估

> 日期：2026-08-06
> 研究员：DeepOrca 技能体系预研（第三项研究）
> 资源：
>
> - 论文 [arXiv:2606.18051 SkillWeaver: Compositional Skill Routing for LLM Agents](https://arxiv.org/abs/2606.18051)
> - 报道 [VentureBeat: New Alibaba AI framework skips loading every tool, cutting agent token use 99%](https://venturebeat.com/orchestration/new-alibaba-ai-framework-skips-loading-every-tool-cutting-agent-token-use-99)
> - 嵌入模型 [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) · [BGE-base-en-v1.5](https://huggingface.co/BAAI/bge-base-en-v1.5)
> - 仓库 [virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill)（MIT，Python，约 17.2k star）
> - 仓库 [alibaba/skill-up](https://github.com/alibaba/skill-up)（Apache-2.0，Go）
>
> 关联模块：`packages/core/src/session.ts`（技能匹配/注入）、`packages/core/src/mcp/`（MCP 工具聚合）、`packages/memory/`（L0–L3 记忆）、`packages/core/templates/plugins/`（7 个内置插件包）

---

## 0. 先说结论

| 对象                    | 集成价值               | 集成难度                    | 建议                                                        |
| ----------------------- | ---------------------- | --------------------------- | ----------------------------------------------------------- |
| **SkillWeaver（思想）** | ★★★★★ 直击两个真实痛点 | 中（无论文代码，自行实现）  | **采纳其「检索先行」架构**：嵌入召回 → LLM 精排，分两期落地 |
| **all-MiniLM-L6-v2**    | ★★★★ 召回层候选        | 低（transformers.js 纯 JS） | **英文场景可用；中文主场景需换多语言变体**（见 §3.3）       |
| **BGE-base-en-v1.5**    | ★★★★ 召回质量更高      | 低-中（体积 3.8×）          | 同上；与 MiniLM 做 A/B 后二选一                             |
| **book-to-skill**       | ★★★ 技能生产力工具     | 低（产出即标准 SKILL.md）   | 作为**知识插件的一个技能**集成，不做内核改动                |
| **skill-up**            | ★★★ 技能质量保障       | 中（Go 二进制/引擎适配）    | **先用于 CI 评估内置技能**；引擎适配（engine.custom）后置   |

一句话：SkillWeaver 没有可下载的代码，但它验证的「**不要把全部技能/工具塞进上下文，先检索再加载**」正是 DeepOrca 当前架构的下一步；嵌入模型是这条路的地基；book-to-skill 和 skill-up 分别补齐「技能从哪来」和「技能好不好」两端。

---

## 1. 各项是什么

### 1.1 SkillWeaver（论文 2606.18051 + VentureBeat 报道）

注：论文与 VentureBeat 报道是**同一件事的两个来源**（报道即写这篇论文）。

- **问题形式化**：Compositional Skill Routing —— 真实任务往往需要**组合多个技能**，而不是单选一个。拆成三步：分解（Decompose）→ 检索（Retrieve）→ 组合（Compose）。
- **核心机制**：
  - LLM 任务分解器把查询拆成原子子任务；
  - **bi-encoder 技能检索器 + FAISS 索引**做子任务→技能匹配（不把所有技能喂给 LLM）；
  - 依赖感知的 DAG 规划器组装执行计划；
  - **SAD（Skill-Aware Decomposition）**：检索结果回流指导分解的迭代循环——分解器先看"手里有什么技能"再决定怎么拆。
- **关键数据**（CompSkillBench：300 条组合查询，技能池来自公开 MCP 生态的 2,209 个技能、24 类）：
  - 直接 LLM 分解的步骤级类目召回仅 34.2% —— **分解是最大瓶颈**；
  - SAD 一轮迭代把分解准确率 51.0% → 67.7%（+32.7%，Wilcoxon p < 10⁻⁶）；
  - 上下文占用降低 **>99%**（相对全量技能灌入）。
- **产物**：**无论文代码/数据发布**（arXiv 页面无仓库链接）。可迁移的是架构与 SAD 思想，不是实现。

### 1.2 all-MiniLM-L6-v2 / BGE-base-en-v1.5（HuggingFace 嵌入模型）

|          | all-MiniLM-L6-v2    | BGE-base-en-v1.5                          |
| -------- | ------------------- | ----------------------------------------- |
| 维度     | 384                 | 768                                       |
| 参数量   | ~22M                | ~109M                                     |
| 量化体积 | ~23 MB（ONNX int8） | ~90–100 MB                                |
| 特点     | 极快、内存友好      | 检索质量明显更强（MTEB 第一梯队 base 级） |
| 语言     | **英文为主**        | **英文为主**                              |
| 许可     | Apache-2.0          | MIT                                       |

两者都是 sentence-transformers 生态，transformers.js（ONNX Runtime Web/Node）有现成的 feature-extraction pipeline，**可以在 Electron 主进程纯 JS 运行，无需 Python 依赖**。

### 1.3 book-to-skill（virgiliojr94/book-to-skill）

把技术书籍（PDF/EPUB/DOCX/MD/HTML…）蒸馏成标准 Agent Skill：`SKILL.md`（心智模型+章节索引，约 4k token）+ 每章一个 md（按需加载，约 1k token/章）+ 词汇表/模式/速查表。卖点是「24×–51× 比整书灌上下文省 token」——与 SkillWeaver 的「按需加载」思想同源。产出写到 `~/.agents/skills/` 等标准位置，**DeepOrca 的技能扫描原生兼容**（`./.agents/skills` → `~/.agents/skills` 均在扫描链上）。

### 1.4 skill-up（alibaba/skill-up）

Agent Skill 的**评估与演化**工具（Go CLI）：声明式 YAML 用例（`eval.yaml` + `cases/*.yaml`）、多引擎（claude_code / codex / qodercli / qwen_code / 自定义 engine.custom）、rule/script/agent_judge 三种裁判、Anthropic evals.json 兼容、结构化报告 + CI 集成。配套的 `skill-upper` 技能能读失败报告自动补用例、迭代修复技能。

---

## 2. DeepOrca 现状与痛点（评估锚点）

### 2.1 技能匹配：每条用户消息一次 LLM 分类调用

`SessionManager.identifyMatchingSkillNames()`（session.ts:1063）把**全部候选技能的 name+description**连同 AGENTS.md 发给 flash 模型做 JSON 分类：

```
systemPrompt += "The candidate skills are as follows:\n\n" + JSON.stringify(simpleSkills)
```

- 成本随技能数线性增长：当前内置 ~15 技能 + 7 插件包时尚可（约 500–1500 token/次）；技能生态一旦上量（book-to-skill 这类生成器一天能产几十个），每次提问的固定开销和延迟都会变得不可忽视。
- 能力上限是**单标签匹配**：返回 skillNames 列表，无子任务分解、无组合规划——正是 SkillWeaver 论文证明"会崩"的用法（34.2% 步骤级召回）。

### 2.2 MCP 工具：全量常驻每轮请求

`getMcpToolDefinitions()` 把所有已连接 MCP 服务器的工具 schema 合入 LLM 工具列表，**每一轮对话都重复发送**。codegraph/serena/crg/skill-spector/gitmcp 同时挂上时，工具 schema 可达数十个、每个数百 token——这是比技能匹配大得多的隐性 token 税，也是 VentureBeat 标题里 "loads every tool" 的直指对象。

### 2.3 技能注入：全量 SKILL.md 进系统提示

匹配中的技能经 `buildSkillDocumentsPrompt()` 以 XML 块整体进系统消息。无章节级/片段级按需加载（book-to-skill 的 chapters 模式恰好是 DeepOrca 技能格式可以原生表达的，见 §4.3）。

### 2.4 记忆检索：SQLite FTS5，无向量召回

@deeporca/memory 的 L1 检索走 FTS 关键词匹配，对同义改写/跨语言查询弱。嵌入索引是记忆质量的直接加分项。

---

## 3. 集成评估

### 3.1 SkillWeaver 架构 → DeepOrca 技能路由（建议采纳，分两期）

**第一期（检索先行，低风险高收益）**：

```
用户消息
  ├─ 嵌入召回：cosine(prompt_emb, skill_desc_emb) → top-K 技能短名单（K≈5）
  └─ 仅把短名单交给现有 flash 分类器（identifyMatchingSkillNames）
```

- 不动现有 LLM 精排逻辑，只在其前加一道本地召回；技能数从 15 涨到 500 时，匹配开销恒定。
- 召回可在主进程常驻内存完成（384/768 维 × 数百技能 = 几十 KB，暴力点积即可，**无需 FAISS**）。
- 同一层召回可直接复用到 **MCP 工具路由**：每轮只注入「本轮相关服务器」的工具 schema（按工具描述嵌入 + 对话上下文召回），砍掉 §2.2 的常驻工具税——这是 99% 那个数字在 DeepOrca 上对应的真实落点。

**第二期（组合式路由，中期）**：

- 借鉴 SAD：第一次分解后把"可用技能清单摘要"回流给分解器再拆一轮（论文中 +32.7% 的来源），用于计划模式的多步骤任务拆解。
- DAG 组合规划：多技能任务（如"索引这个仓库并生成 wiki"）输出有序技能链。依赖 Plan Mode 的 `<proposed_plan>` 机制落地，不急于做。

**不采纳的部分**：论文无代码；bi-encoder 需要训练数据（我们没有），直接用预训练嵌入模型的 zero-shot 召回代替，不训练。

### 3.2 嵌入模型选型（MiniLM vs BGE）

| 维度             | all-MiniLM-L6-v2   | BGE-base-en-v1.5   |
| ---------------- | ------------------ | ------------------ |
| 冷启动加载       | ~1s 级             | ~3–5s 级           |
| 常驻内存         | ~90 MB             | ~400 MB            |
| 英文检索质量     | 够用               | 更好               |
| **中文检索质量** | **差**（英文训练） | **差**（英文训练） |

**关键约束：DeepOrca 用户提示以中文为主。** 两个候选都是英文模型，直接用于中文提示 ↔ 中文技能描述的召回会明显掉点。建议：

- 首选 **BGE 中英对应物** `BAAI/bge-base-zh-v1.5`（768 维，MIT）或 `bge-m3`（多语言，100+ 语言，MIT）；
- 轻量备选 `paraphrase-multilingual-MiniLM-L12-v2`（384 维，中文可用，Apache-2.0）；
- 落地姿势：transformers.js + ONNX int8 量化，主进程懒加载（首次技能匹配时才加载模型），模型文件走现有 vendor 机制（`scripts/vendor-*.js` + GitHub Releases 代理兜底），不进 git。

### 3.3 book-to-skill（低难度，插件化集成）

- 产出是标准 SKILL.md 生态，DeepOrca 扫描链原生兼容（`~/.agents/skills`）。
- 推荐形态：**作为知识（knowledge）插件包的一个技能**封装——`book-distill` 技能，调用其 Python CLI（经 vendored uv 运行，与 Serena/CRG/SkillSpector 同一通路），产出写入用户技能目录。内核零改动。
- 其「章节按需加载」结构可以反向贡献给 DeepOrca 技能规范：鼓励大技能拆 `references/` 分片，匹配后只注入相关分片（与 §3.1 第一期叠加，进一步压上下文）。

### 3.4 skill-up（先 CI，后产品内）

- **短期（零产品改动）**：在 CI 中对 7 个内置插件包的技能跑 eval 套件，技能变更 PR 出报告。它原生支持 claude_code/codex/qodercli 引擎——DeepOrca 不在其列，但引擎只影响"用哪个 agent 跑用例"，评估内置技能本身不受影响。
- **中期**：通过 `engine.custom`（local transport）把 DeepOrca 注册为被测引擎，用户技能在应用内获得"评估"按钮（插件详情页已有来源/说明，可加"质量报告"入口）。
- 注意：Go 单二进制，vendor 通路可复用（GitHub Releases + 代理兜底），但**不要**在启动路径做任何同步调用——2026-08-05 白屏事故（skill-spector 同步安装卡死主进程）就是前车之鉴，任何集成一律异步。

---

## 4. 风险与约束

1. **嵌入模型的中文短板**是本期最大技术风险；先用 bge-base-zh-v1.5 做召回准确率抽查（50 条中文查询 × 现有技能池），达标再换。
2. **模型体积**：桌面端 bundle 不想背 100MB——模型文件按需下载到 userData（像 uv/serena 的 vendor 做法），首用提示。
3. **MCP 工具路由有误伤面**：召回错把该用的工具漏掉 = 功能缺失。保守策略：召回只负责"排序与扩容"，小工具集（<N 个工具）时全量注入，超过阈值才裁剪；并保留 `alwaysInclude` 名单（如 bash/read/write）。
4. **SAD 迭代增加一轮 LLM 调用延迟**，仅建议在计划模式（用户对延迟有预期）启用。
5. 两个仓库的许可证（MIT / Apache-2.0）与现有第三方清单兼容；若集成需在「开源致谢」补条目（当前致谢区已支持双语+链接格式）。

---

## 5. 建议行动顺序

1. **P0｜嵌入召回前置**（技能匹配）：transformers.js + bge-base-zh-v1.5，top-K 短名单喂给现有分类器。验证指标：匹配准确率不降 + 单次匹配 token 降到 1/5 以下。
2. **P1｜MCP 工具按需注入**：同一召回层复用到工具 schema，配合阈值与白名单。验证指标：长会话平均每轮 token 下降幅度（对照 VentureBeat 口径做我们自己的测量）。
3. **P2｜book-distill 技能**（knowledge 插件包）+ 技能分片加载约定。
4. **P3｜skill-up 进 CI**（内置技能回归），engine.custom 适配后置。
5. **P4｜SAD 分解 + DAG 组合**，挂在计划模式。

---

## 附：资料核验记录

- arXiv 2606.18051 摘要页直接可读，核心数字（34.2% / 51.0%→67.7% / >99%）取自摘要+HTML 全文。
- VentureBeat 页面触发 429，报道要点（SkillWeaver、跳过全量工具加载、token -99%）经多源交叉确认（ground.news、progressiverobot 等转载）；**报道与论文为同一成果**。
- book-to-skill / skill-up 的 README 经 GitHub API 直取（2026-08-06）；star 数、许可证、语言为该时点值。
- SkillWeaver **未发布代码**，本文所有集成方案均为自行设计，与论文实现无依赖。
