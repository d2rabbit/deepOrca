# T-Mem × HyperFrames 预研：记忆触发器强化 与 HTML→视频动态讲解

> 日期：2026-09-14 · 状态：调研完成（纯留档，无代码变更；总口径：调研仅供参考，正式实现一律以 `specs/` 为准）
> 来源：[Sherlockwz/T-Mem](https://github.com/Sherlockwz/T-Mem)（arXiv [2606.15405](https://arxiv.org/abs/2606.15405)，EMNLP 2026 Main，MIT）· [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)（Apache-2.0，npm `hyperframes`）
> 取证方式：arXiv 摘要页 + T-Mem GitHub 仓库页一手取证（zread 未收录该仓库）；hyperframes 经 zread 一手取证（README 全文 + 仓库树，2026-09-14 时点）。
> 目的：两条独立调研线——① **T-Mem** 用于记忆模块（`@deeporca/memory`）的召回侧强化；② **HyperFrames** 用于实现「将部分内容转换为 HTML 再转换为视频动态讲解」能力。

---

## §1 结论摘要（TL;DR）

| 项目 | 是什么 | 与 DeepOrca 相关度 |
| --- | --- | --- |
| **T-Mem**（EMNLP 2026 Main，2026-06） | 学术研究 + 官方实现：长期对话记忆的**写入时触发器（Trigger）**机制——写入时预演"这段记忆未来会在什么上下文被需要"，生成 4 族 × 2 粒度的检索线索，让**联想性召回**（查询与记忆无表面共现、仅靠潜在语义弧相连）可达；LoCoMo / LoCoMo-Plus 双 SOTA。MIT，Python 3.10+，仓库早期（9★/14 commits） | **中高**（思想可移植性高，代码不宜直接依赖） |
| **HyperFrames**（HeyGen 开源，2026） | 工程级「**HTML 即视频**」框架：HTML + `data-*` 时间属性定义合成 → headless Chrome 逐帧 seek + FFmpeg 编码 → **确定性 MP4**。无构建步骤、agent 友好（20 个 SKILL.md 技能）、**Apache-2.0**、Node 22+。HeyGen 生产在用（tldraw/TanStack 等在 ADOPTERS） | **高**（直接回应 09-11 Remotion 预研的许可证红线；`/faceless-explainer` 与「内容→视频动态讲解」需求完全同构） |

**核心判断**：两条线互不阻塞，且都落在既有调研链的延长线上——
1. **T-Mem 是记忆链的「召回侧」增量**。本仓记忆能力已由腾讯持久化记忆（`@deeporca/memory`，vendored TDAI Core L0–L3 管线）承接（MemOS 线 2026-08-17 作废）；此后的 memory-audit / cmb-adoption 都在打磨**写入侧**质量。T-Mem 补的恰是**召回侧**的盲区（联想性召回），且其对象模型（Scene/Item/Persona/Topic）与 TDAI 高度同构，**唯一真正的新概念是 Trigger**——建议只移植思想与 prompt 模式进 vendored TDAI 管线，不引 Python 代码。
2. **HyperFrames 是视频链的「引擎替代项」**。09-11 预研将 Remotion 定为未来视频引擎首选、但把双层许可证（>3 人营利公司需 Company License）列为红线。HyperFrames 以 Apache-2.0 + 纯 HTML（无 React 构建）直接拆掉这条红线，且其 20 个技能与本仓 SKILL.md 方言同构、Node 22+ 与本仓工具链一致——**若视频能力启动，应将 HyperFrames 与 Remotion 并列为候选引擎重新评估**。

三条速记：
1. **T-Mem 的可移植内核只有一件事**：写入时对「事实/场景」两个粒度各生成「描述性 + 联想性」触发器，触发器与记忆同库索引（BM25 + 向量各一份条目）、检索时扩充候选但**永不进入答案上下文**。这与 TDAI 现有 L1 抽取/L2 场景管线的衔接面很小，新增一层「trigger-gen」即可挂进现有 `byLayer` 计费统计。
2. **HyperFrames 的渲染三角 = Node 22（已有）+ headless Chrome（有先例）+ FFmpeg（全仓缺失，需新 vendor）**。仓库克隆需 `GIT_LFS_SKIP_SMUDGE=1`（约 240MB 回归基线 mp4），打包只带运行时。
3. **两线的技能形态都已就绪**：HyperFrames 的 `/faceless-explainer`（任意文本→概念讲解视频）+ `hyperframes-core/animation/cli` 领域技能改写为 bundled skill 即可零集成验证产品价值；T-Mem 开源了四族触发器的完整 `prompts/`，可直接作 L1/L2 抽取提示词的增补素材。

---

## §2 T-Mem：写入时触发器的图记忆

### 2.1 论文层（arXiv 2606.15405）

- **作者/出处**：Weidong Guo, Dakai Wang, Zixuan Wang, Hui Liu, Yu Xu；2026-06-13 提交，v2 更新于 2026-09-08；仓库页声称 EMNLP 2026 Main 接收。
- **问题定义**：现有长期对话记忆系统（词法 BM25 与稠密向量皆是）的可达性**受限于查询与存储内容之间的相似度**。这对**描述性（descriptive）**用例有效——查询与记忆共享措辞、命名实体等表面特征；但对**联想性（associative）**用例集体失效——查询与记忆无任何表面共现，仅由一条"潜在语义弧"相连。
- **核心主张**：受认知科学**情景未来思维（episodic future thinking）**启发——"为未来被找到的上下文预演过去的经验"。写入时不只是归档，而是预先生成**预期性检索线索（Trigger）**，把"一段记忆如何被够到"与"够到的是什么"解耦。
- **结果**：LoCoMo 与 LoCoMo-Plus 两个长对话记忆基准 SOTA。

### 2.2 实现层（仓库一手取证）

- **形态**：Python 3.10+ 研究代码（MIT），Pydantic 类型 + BM25 + 向量索引；LLM 走 OpenAI 兼容端点（`T_MEM_LLM_BASE_URL`/`T_MEM_LLM_API_KEY`，vLLM/Ollama/Azure 皆可）。仓库规模小（9★/14 commits），benchmark 导向，**无服务化接口**。
- **记忆图五类对象**：

| 对象 | 作用 | 是否进 QA 证据 |
| --- | --- | --- |
| Scene（场景） | 内聚的完整交互片段 | ✅ |
| Item（条目） | 锚定到 scene 的原子事实 | ✅ |
| Topic 标签 | 检索前**预过滤** | ❌（只在过滤通道） |
| Trigger（触发器） | **仅检索**的预期线索 | ❌（永不进证据） |
| Persona（人设） | 每说话人特质，作环境上下文注入 | ✅（环境通道） |

- **触发器 4 族 × 2 粒度**：Entity / Bridge（联想族）、Scene / Horizon（描述族）×「单条事实 / 完整交互」两个粒度——保证每条记忆既能被表面相似查询够到、也能被语义相关但表面无关的查询够到。触发器在 Build 管线 stage 4/4b（"写入时预演"）生成，存为 JSON + NPZ 工件。
- **两段工作流**：Build（分段 → 打标 → 条目抽取 → 触发器生成 → BM25+向量索引）与 Evaluate（topic→scene→item 分层检索 → 答案生成 → LLM-as-judge 打分）。可调参数如 `T_MEM_FINAL_KEEP_SCENE`（默认 5）/ `T_MEM_FINAL_KEEP_ITEM`（默认 15）。
- **目录**：`T_mem/`（config/types/structure + extractors/index/llm/main(0-8 阶段)/persona/prompts/retrievers/utils）+ `benchmark_eval/`（LoCoMo、LoCoMo-Plus）+ `scripts/`。

### 2.3 与 `@deeporca/memory` 的对位

本仓记忆栈：进程内 TS `MemoryManager` 包装 vendored TdaiCore，L1 抽取 / L2 场景 / L3 人设，对外 `recall()` / `capture()` 两入口；LLM 计费按 `byLayer: l1|l2|l3|other` 归账（`memory/adapter.ts`）。

| T-Mem 概念 | TDAI 现状 | 增量判定 |
| --- | --- | --- |
| Scene（场景） | ✅ 已有（L2 / `tdai/core/scene/`） | 同构，无增量 |
| Persona（人设） | ✅ 已有（L3 / `tdai/core/persona/`） | 同构，无增量 |
| Topic 预过滤 | ⚠️ 部分（语义路由 `core/routing/` 是技能/工具短名单，非记忆预过滤） | 小增量，可选 |
| **Item（原子事实）** | ⚠️ 需对照 `tdai/core/record/` 与 L1 抽取产物确认粒度是否等价 | **待核实** |
| **Trigger（写入时触发器）** | ❌ 完全没有 | **核心增量** |
| topic→scene→item 分层检索 | ⚠️ TDAI 有自有召回，分层形态不同 | 跟随触发器一并考虑 |

**关键对位**：T-Mem 补的是**召回侧**，与既有投入互补不重叠——memory-audit（`specs/archive/memory-audit/`）与 cmb-adoption 的 L1 提示词打磨都在**写入侧**； MemOS 线作废时确立的"记忆能力由 @deeporca/memory 承接"边界不受影响，T-Mem 不引入第二套记忆系统，只强化现有管线。

### 2.4 整合路径建议

- ✅ **推荐：概念移植进 vendored TDAI 管线**（全程收敛在 `packages/memory/` 内，不碰 core 的 UI-free 边界）：
  1. `capture()` 落库阶段对「事实 / 场景」两粒度各生成「描述性 + 联想性」触发器（复用 T-Mem `prompts/` 的四族提示词模式）；
  2. 触发器与记忆同库写入，BM25 与向量索引各建一份触发器条目（打上"仅检索"标记，渲染上下文时过滤）；
  3. `recall()` 时触发器命中用于扩充召回候选（触发器本身不进系统上下文——这是论文刻意设计，防止触发器文本污染答案）；
  4. 触发器生成的 LLM 调用挂进 `byLayer` 计费（新增 `trigger-gen` 层），沿用 best-effort 审计日志。
- ❌ **不推荐：Python sidecar 直跑 T-Mem 仓库**。虽有 uv/Serena 的 Python vendor 先例，但 T-Mem 是 benchmark 研究代码（评测导向、无服务接口），接进来等于维护第二套记忆管线与存储，双写必然漂移——与 MemOS 线作废的同一逻辑。
- **风险与节奏**：仓库早期（9★/14 commits）且论文 v2 刚更新（2026-09-08），实现细节仍在动。建议：先以 spec 形式落「Item 层核实 + 触发器层设计」（进 `specs/` 流程），prompt 模式可即时取用，代码结构不绑定；观察仓库稳定度后再决定是否深参考其 stage 编排。

---

## §3 HyperFrames：HTML 即视频

### 3.1 定位与渲染模型

- **一句话**："Write HTML. Render video. Built for agents."——视频就是一个带 `data-start` / `data-duration` / `data-track-index` 时间属性的 HTML 文件（`class="clip"` + tracks + 子合成 + 变量），动画经 **可 seek 适配器**（GSAP / CSS / Lottie / Three.js / Anime.js / WAAPI / 自定义）驱动；渲染时 headless Chrome 逐帧定位 + FFmpeg 编码，**同输入必得同输出**（确定性，适配 CI 与回归测试）。
- **无构建步骤**：`index.html` 在浏览器直接可预览（`npx hyperframes init → preview → render`）。与 Remotion 的对照是官方主打的卖点：Remotion 押注 React 组件（需 bundler），HyperFrames 押注**人与 agent 都能直接写的纯 HTML**。
- **许可证**：**Apache-2.0**，无渲染次数费、无商用门槛。

### 3.2 工程事实（一手取证）

- **包结构**（npm `hyperframes` 为 CLI 入口）：`@hyperframes/core`（类型/解析/lint/运行时/帧适配器）、`@hyperframes/engine`（Puppeteer + FFmpeg 逐帧捕获）、`@hyperframes/producer`（捕获→编码→混音全管线）、`@hyperframes/studio`（浏览器编辑器）、`@hyperframes/player`（可嵌入 web component）、`@hyperframes/shader-transitions`（WebGL 转场）、`@hyperframes/aws-lambda`（分布式渲染）。
- **运行时依赖**：Node 22+（✅ 与本仓 `.nvmrc` 一致）+ **FFmpeg**（❌ 本仓全仓 grep 无引用，需新增 vendor）+ headless Chrome（⚠️ 本仓有 offscreen Chromium provider（web-fetch）与 `dembrandt-browser.ts` 先例，但 HyperFrames 用 Puppeteer 自行拉起；首发建议 vendor `chrome-headless-shell`，长期可探索 CDP 复用 Electron 自带 Chromium——可行但有坑，不建议首发）。
- **仓库卫生**：Git LFS 托管约 240MB 回归基线 mp4（`packages/producer/tests/**/output.mp4`），克隆用 `GIT_LFS_SKIP_SMUDGE=1`；**打包只带运行时，基线不进安装器**。
- **agent 技能面**：20 个 SKILL.md 技能（router `/hyperframes` + 10 个创作工作流 + 领域技能 + `/figma`），非交互安装 `npx hyperframes skills update`（装核心集，从 main 拉）。与本仓技能发现（SKILL.md + YAML frontmatter，bundled/project/user 四级路径）**同构**。
- **与本仓既有资产的衔接**：创作工作流含 **`/faceless-explainer`（任意文本→概念讲解视频，视觉全由 LLM 构造）**——与本次需求「内容→HTML→视频动态讲解」完全同构；另有 `/pr-to-video`（PR diff→变更讲解）、`/slideshow`（演示文稿）、catalog 组件（`data-chart` 动画图表、转场、社交叠层）可按需 `hyperframes add`。`frame.md` 机制（把 web 设计规范"反转为镜头用规范"的 DESIGN.md 超集）可对齐本仓 UI 设计 token——本仓已 vendor 的 design-md 集合（`vendor-design-md.js`）正是同族资产，风格体系可直接接轨。

### 3.3 与 09-11 Remotion 预研的衔接（关键）

[2026-09-11-code2video-remotion-prestudy.md](./2026-09-11-code2video-remotion-prestudy.md) 的结论是"若启动视频能力，引擎取 Remotion"，红线是"任何集成 spec 先过许可证两问"（双层许可，>3 人营利公司需 Company License）。HyperFrames 逐条回应：

| 维度 | Remotion（09-11 结论） | HyperFrames（本次取证） |
| --- | --- | --- |
| 许可证 | 双层许可，营利公司 >3 人需付费 **← 红线** | **Apache-2.0，无商用门槛** |
| 创作媒介 | React 组件（bundler 必须） | 纯 HTML（无构建，`index.html` 直接播） |
| agent 亲和 | 官方 Skills 2.0（SKILL.md router-first） | 20 个 SKILL.md（router-first 同构） |
| 确定性 | 帧精确（wall-clock 动画需注意） | 可 seek 适配器 + 逐帧确定性（regression 基线入库） |
| 分布式渲染 | Remotion Lambda（成熟） | 本地 / Docker / AWS Lambda（可用） |
| 生态成熟度 | 23k+★，行业事实标准 | HeyGen 生产在用 + tldraw/TanStack 采用，较新 |

**修订建议**：若视频能力立项，引擎决策应在 **Remotion vs HyperFrames** 之间重开（HyperFrames 拆掉许可证红线，Remotion 保有生态与 Lambda 成熟度）；管线方法论仍按 09-11 结论借鉴 Code2Video（三段式落盘断点续跑 / stage-gate 机械门 / 分级修复 / VLM 评审回写），与引擎选择正交。

### 3.4 与本仓的对位与整合路径（三档递进）

1. **技能先行（低成本验证，建议先动）**：将 `/faceless-explainer` + `hyperframes-core` / `hyperframes-animation` / `hyperframes-cli` 领域技能改写为 bundled skills（注意技能内的 CLI 调用需走 `npx hyperframes`，本地无 vendor 时依赖网络拉取）。agent 写 HTML 合成 → lint/preview/render 出 MP4。产品价值验证几乎零集成成本。
2. **vendor 化（产品化）**：按 `scripts/vendor-*.js` 家族模式新增 `vendor-hyperframes.js`（npm 包 pin 版装到 `packages/desktop/vendor/hyperframes`）+ FFmpeg 静态二进制 + `chrome-headless-shell`，vendor root 走既有 `configure*` 宿主注入接缝；打包体积预估（FFmpeg ~80MB + headless shell ~150MB）需过 `electron-builder.yml` extraResources 评审（Granite 模型 ~118MB 已有先例）。
3. **程序化集成（远期）**：`@hyperframes/producer` 以受控子进程调用（**不进主进程依赖**——与"主进程依赖精确 pin"供应链规则的谨慎精神一致）；`@hyperframes/studio` / `player` 可选嵌入 renderer 做合成预览。

**产品切入点**（供 spec 立项参考）：设计目录（designs）产物→讲解视频、审查报告→变更讲解（对位 `/pr-to-video`）、会话总结→可分享演示；风格经 frame.md 对齐本仓设计 token 保证出片统一。

---

## §4 优先级与下一步

| 线 | 建议动作 | 前置 |
| --- | --- | --- |
| HyperFrames | ① 技能先行验证（改写 4 个核心技能为 bundled）；② 视频能力立项时按 §3.3 重开引擎决策（Remotion vs HyperFrames） | FFmpeg vendor（② 需要）；许可证两问（09-11 §5.4）对 HyperFrames 已天然通过 |
| T-Mem | 落 spec：Item 层核实（对照 `tdai/core/record/`）+ 触发器层设计（capture 生成 / recall 扩充 / byLayer 计费）；prompt 模式即时取用 | 观察 T-Mem 仓库稳定度；spec 经 `specs/` 流程评审 |

两条线均**不阻塞彼此**，也均不改变既有边界：记忆能力仍由 `@deeporca/memory` 单一承接（MemOS 线作废决议不变），视频能力仍是全新能力面（09-11 预研"不急功能化"的定调是否解除，由项目所有者拍板）。
