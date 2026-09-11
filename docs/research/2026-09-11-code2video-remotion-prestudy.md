# Code2Video × Remotion 预研：代码生成视频（Code-to-Video）两条路线

> 日期：2026-09-11 · 状态：调研完成（纯留档，无代码变更；总口径：调研仅供参考，正式实现一律以 `specs/` 为准）
> 来源：[showlab/Code2Video](https://github.com/showlab/Code2Video)（arXiv 2510.01174，MIT）· [remotion-dev/remotion](https://github.com/remotion-dev/remotion)（源码可用，双层许可）
> 取证方式：zread 一手取证（Code2Video `src/agent.py` / `src/scope_refine.py` 全文，Remotion `packages/skills` 全目录 / `AGENTS.md` / `LICENSE.md` / `remotion-create` SKILL.md）+ 官方文档与第三方报道交叉核对（2026-09 时点）。
> 目的：评估「代码→视频」两条路线（学术方法论层 / 工程基础设施层）对 DeepOrca 的相关性与可借鉴价值。**用户定调：落地研究文档即可，不急功能化。**

---

## §1 结论摘要（TL;DR）

| 项目 | 是什么 | 与 DeepOrca 相关度 |
| --- | --- | --- |
| **Code2Video**（NUS Show Lab，2025.10） | 学术研究框架：三 agent（Planner/Coder/Critic）协作写 **Manim Python 代码**生成 3B1B 风格教学视频；贡献 = 流水线编排方法 + ScopeRefine 分级自动修复 + Grid 锚点视觉评审 + MMMC/TeachQuiz 评估体系 | **中**（方法论参考，不集成代码） |
| **Remotion**（23k+ stars，v4.0.52x） | 工程级「React 即视频」框架：React 组件定义每一帧，无头 Chrome 逐帧截图 + Rust 版 ffmpeg 合成；2026 年全面转向 agent 生态（官方 Agent Skills 2.0 / WebMCP / 弃用 MCP） | **中**（若未来做视频能力，引擎首选；skill 体系与本仓同构可直接分发；许可证是红线） |

**核心判断**：两者不在同一层，是互补关系——Code2Video 回答「agent 应该如何编排代码生成视频的流程」，Remotion 回答「代码渲染视频用什么引擎和生态」。若 DeepOrca 将来启动「原型→演示视频」或「教学视频」类能力：**引擎取 Remotion（React 通用性 + agent 亲和度全行业最高），管线方法论借鉴 Code2Video（分阶段落盘断点续跑 / ScopeRefine 分级修复 / 网格锚点约束布局 / VLM 评审回写代码）**。当前不排期、不落地。

三条速记：
1. **Remotion 官方 Agent Skills 与本仓 skill 体系完全同构**（SKILL.md + YAML frontmatter + router 式子技能按需加载），Remotion 自己也在 2026-05 把 agent skills 迁到了 `.agents/skills`——理论上放进本仓 skill 扫描路径即可让 agent 具备 Remotion 能力，零适配成本。
2. **Code2Video 的管线机制与刚落地的 `design-stage-gates` 高度同构**（机械门 + 分级降级 + 产物落盘），其三段式设计可直接作为未来 spec 的参照系。
3. **Remotion 许可证不是 MIT**：个人/非营利/≤3 人营利公司免费，超过即需 Company License——产品化集成前必须过这一决策点。

---

## §2 Code2Video：学术层——agent 编排「代码→教学视频」

### 2.1 定位与主张

- **来源**：Yanzhe Chen, Kevin Qinghong Lin, Mike Zheng Shou（Show Lab @ NUS），arXiv 2510.01174，2025-10-02 开源，NeurIPS 2025 DL4C Workshop 接收，**MIT**。
- **问题**：像素空间扩散模型（Veo3/Wan2.2）做不了教学视频——文字会花、图形不一致、没有教学叙事结构、无法精确控制元素位置。
- **主张**：以**可执行的 Manim 代码**为唯一生成媒介，代码同时承载**时间编排**（动画序列）与**空间组织**（元素布局），换来精确控制、可解释、可复现、可增量修改。
- **输入**：一个知识点字符串（如 "Linear transformations and matrices"）；**输出**：一部拼接完成的 mp4 教学视频。

### 2.2 三 Agent 管线（`src/agent.py`，单类 `TeachingVideoAgent` 五阶段）

```
知识点 ─→ Planner ─→ outline.json（大纲）
        └─────────→ storyboard.json（分镜：section×{lecture_lines, animations}）
                    └→ (+IconFinder 图标注入 → storyboard_with_assets.json)
             ─→ Coder ─→ <section>.py × N（ThreadPoolExecutor 6 并发生成）
             ─→ 渲染 ─→ manim -ql 480p15（ProcessPoolExecutor 6 进程，180s 超时）
             ─→ Critic ─→ VLM 看视频+网格锚点图 → JSON 反馈 → 按行回写代码 → 重渲染（默认 2 轮）
             ─→ ffmpeg concat 拼接成片
```

关键工程细节（一手取证）：

- **产物全落盘、天然断点续跑**：outline/storyboard/每个 section 的 py/各段视频/优化版视频/拼接清单全部写盘；每阶段启动先查文件，存在即跳过。研究脚本但架构上等价于「每步有落盘收据」。
- **base class 注入布局钩子**：Coder 被强制继承项目提供的基类，基类封装 `place_at_grid(obj, "B2")` / `place_in_area(obj, "A1", "C3")` 两个网格助手——这是 Critic 能「精准改布局」的前提（见 §2.4）。
- **并行度分层**：代码生成用线程池（LLM 调用 IO 密集），渲染用进程池（manim CPU 密集），互不抢占。
- **重试预算显式化**（`RunConfig` 默认值）：重生成 10 次 / 修 bug 10 次 / Critic 反馈改码 3 次 / Critic 修 bug 3 次 / 反馈 2 轮——每个环节的失败预算都是显式参数，超限跳过该 section 并继续（成功率优先于完备性）。
- **token/耗时全程记账**：所有 LLM 调用经统一包装器累计 usage，批次结束输出人均 token/分钟。

### 2.3 ScopeRefine：分级自动修复（最有迁移价值的方法）

`src/scope_refine.py`，按**修复作用域逐级放大**：

1. **错误解析**：正则抽取错误类型（NameError/AttributeError/TypeError…）、行号、出错代码行；按类型给出 fix_scope（单行 / 函数 / 动画块）和 Manim 专属修复建议（如未定义名 → 提示 `from manim import Circle`）。
2. **行级修复**：只把出错行 ±5 行上下文喂给 LLM，返回补丁块后字符串替换合并——**不重写全文件，省 token**。
3. **块级升级**：失败则扩到整个 lecture-line 动画块（按 `# === Animation for Lecture Line N ===` 注释边界切分）。
4. **全局重写**：再失败重写整个 section，且第 3 次尝试的策略 prompt 会主动**降级为"只用最简单可靠的 Manim API 重写"**（functionality over complexity）。
5. **每级修复过两道机械门才允许合并**：`compile()` 语法校验 → **dry-run**（向 `construct()` 注入 `self.wait(0.1); return` 快速退出后真跑一遍 Python import）→ 通过才落盘重渲染。

**与本仓的对应**：行→块→全局的升级链 ≈ `design-stage-gates` 的两级降级；语法门 + dry-run ≈ 机械门设计；错误分类先于修复 ≈ OCR 分层失败语义。这是同一套「机械可验证的失败处理」模式在另一领域的独立实现，可作为 stage-gate 引擎跨域泛化的第二个佐证案例。

### 2.4 Grid 锚点 Critic：让 VLM 的空间反馈可执行

VLM 看视频提布局意见的通病是**反馈不可执行**（"元素太挤了"→代码里怎么改？）。Code2Video 的解法：

- 画布离散化为 **6×6 网格锚点**（A-F × 1-6），Critic 评审时同时给它一张固定的 GRID.png 锚点参考图；
- 从代码中正则抽取所有 `place_at_grid`/`place_in_area` 调用生成**占用表**（对象|方法|位置|缩放|行号）一并喂给 VLM——模型看到的不是猜测而是结构化的当前布局；
- 反馈要求输出 JSON：`{has_issues, improvements: [{problem, solution}]}`，且 solution 必须是**具体行号 + 具体的 `self.place_at_grid(...)` 调用**；
- `GridCodeModifier` 直接按行号替换那几行代码（保缩进），重新渲染。正则解析失败才降级为「喂整个文件让 LLM 重写」。

本质：**用受控 DSL（网格调用）+ 结构化占用表 + 行级回写，把自由文本的视觉评审压缩成可机械执行的补丁**。对本仓 designer 的 taste/视觉评审线（VibeGame 预研 §"对抗讨好"同域）是直接的机制参照。

### 2.5 评估体系：MMMC / TeachQuiz

- **MMMC 基准**：117 个知识点 / 456 个视频单元 / 13 个学科，全部源自 3Blue1Brown 官方 Manim 教程（人工制作视频作为"上界"参照）。
- **TeachQuiz**（最 novel 的指标）：让 VLM 先「遗忘」目标概念（unlearn）做一次测验得 S1 → 观看生成的教学视频 → 再测验得 S2，**TQ = S2 − S1 即视频独立贡献的知识增量**。把"视频好不好"变成可测量的学习迁移。
- **VLM-as-Judge 美学五维**：Element Layout / Attractiveness / Logic Flow / Visual Consistency / Accuracy & Depth，各 100 分。
- **结果**：综合指标较「直接让 code LLM 一次生成 Manim 代码」baseline 提升 ~40%；TeachQuiz 与人工教程相当。代价侧：单知识点生成耗时数十分钟量级、token 消耗可观（论文按 topic 报告均值）。

### 2.6 工程现状与限制

| 维度 | 现状 |
| --- | --- |
| 代码形态 | ~1k 行研究级 Python 脚本 + prompt 模板目录，单文件偏长、无测试、无 UI，纯 CLI |
| 硬依赖 | Manim CE v0.19 + ffmpeg；Coder 用 Claude 4 Opus、Critic 用 Gemini 2.5 Pro（双 API key）；IconFinder API 拉图标（2025.10 已因 ICONFINDER 故障改用 HuggingFace 离线资产包） |
| 覆盖面 | 仅英文知识点；仅教学视频体裁；布局 DSL 与 Manim 强绑定 |
| 可复用性 | **代码本身不建议复用**；可复用的是三条机制：ScopeRefine、Grid 锚点评审、产物落盘断点续跑 |

---

## §3 Remotion：基础设施层——React 即视频

### 3.1 定位与规模

- 一句话：**用 React 组件写视频**。每个元素是 React 组件，动画 = `useCurrentFrame()` 的纯函数，`<Composition>` 定义时长/分辨率/fps；"React Code is the source of truth"（代码是唯一事实，可视化编辑会写回代码）。
- 2026 年定位语已改为 **"Video tools for the agent era"**：agentic（coding agent 生成）/ interactive（Studio 拖拽）/ programmatic（数据驱动批渲染）三种工作流随时切换。
- Bun + turbo 管理 **~150 包** 的 monorepo，23k+ stars，发版极高频（周级 patch）。

### 3.2 monorepo 全景（按层归组）

| 层 | 代表包 | 说明 |
| --- | --- | --- |
| 表达 | `core`、`shapes`、`three`、`lottie`、`gif`、`skia`、`tailwind(-v4)`、`gsap`、`transitions`、`effects`、`motion-blur`、`noise`、`captions`、`fonts`、`google-fonts` | React 组件 + 插值/spring/Sequence/TransitionSeries 动画原语；周边动效库官方维护 |
| 预览/编辑 | `player`、`player-a11y`、`studio`(+`studio-server`/`studio-protocol`)、`browser-studio` | Player 嵌入任意 React 应用实时播放；Studio 是浏览器版可视化编辑器（时间轴/拖拽/元素选择），**编辑写回代码** |
| 渲染 | `renderer` + `compositor-{darwin-arm64/x64, linux-arm64/x64-gnu/musl, win32-x64-msvc}`、`bundler`、`webcodecs`、`mediabunny`、`web-renderer` | Node API：无头 Chrome 逐帧截图 + **自研 Rust 版 ffmpeg**（每平台一个原生二进制，不依赖系统 ffmpeg）；`webcodecs`/`mediabunny` 支持纯浏览器客户端渲染 |
| 规模化 | `lambda`（AWS）、`cloudrun`（GCP）、`vercel`、`serverless`、`lambda-go/php/python/ruby` | 百万级批渲染的官方托管路径，多语言 client |
| 媒体底座 | `media-parser`、`media-utils`、`install-whisper-cpp`、`openai-whisper`、`whisper-web(-webgpu)`、`sfx`、`elevenlabs`、`rive`、`maptiler` | 解析/转写/音效/配音全家桶自研在仓内 |
| 模板 | 20+：`template-prompt-to-video`、`template-prompt-to-motion-graphics`、**`template-electron`**、`template-audiogram`、`template-tiktok`、`template-recorder`、`template-render-server` … | **`template-electron` 证明桌面集成有官方先例**；两个 prompt-to-* 模板即官方"一句话→视频"起点 |
| Agent | `skills`、`skills-evals`、`agent-plugin`、`mcp`（已弃用）、`claude-code-plugin`、`kimi-code-plugin` | 见 §3.4 |

### 3.3 渲染路径与部署形态

- **本地 Node**：`npx remotion render <comp-id>` 一条命令出 mp4；still 渲染单帧。
- **规模化**：Lambda/CloudRun/Vercel 托管渲染（按帧并行）。
- **客户端渲染**：webcodecs/mediabunny 在浏览器内直接合成——**不占服务器**，对桌面应用形态友好。
- **实时播放**：Player 组件直接嵌 React 应用（我们 renderer 是浏览器 bundle，理论可达）。
- 渲染底座需要**下载 Chrome Headless Shell**（首次运行自动获取，类似 puppeteer）+ Rust compositor 二进制——若 vendor 进 DeepOrca，体积负担与现有 vendor-* 家族（CodeGraph/Granite ~118MB）同类，需评估。

### 3.4 2026 年 agent 战略（其最大的近期变化）

- **官方 Agent Skills 2.0**（`packages/skills/`，版本随框架 v4.0.520）：13 个 SKILL.md——顶层 `remotion-best-practices` 做路由，按需加载 `remotion-create` / `remotion-markup`（含 timing/sequencing/audio/transitions/voiceover 等 30+ 子文档）/ `remotion-render` / `remotion-captions` / `remotion-maps` / `remotion-multimedia` / `remotion-interactivity` / `remotion-saas` / `remotion-studio` / `remotion-docs` / `remotion-upgrade`。**router-first + 按需加载**，严格控制上下文窗口；SKILL.md 内建行为约定（如"仅用户明确要求才渲染"）。
- **发布即现象级**：2026.01 上线后 8 周 15 万+ 安装，是 Remotion 近年最大增长事件，并触发 Vercel/Supabase/Prisma 跟进发布自家 skills 的连锁反应。
- **官方 MCP server 已弃用**（托管端 2026-08-31 起下线），官方理由：agent 调 MCP 不可靠 + 不愿承担 token 成本，全面转向 skills + `remotion-docs` 技能内查文档。**这个弃用决策本身值得记档**（与"skills 优于 MCP"的判断相互印证）。
- **WebMCP**（v4.0.518+）：Studio 页面原生暴露类型化工具给浏览器内 agent（读选区/构图/播放头/画布 HTML/元素几何；写播放/seek/参考线）——W3C 孵化草案，目前仅 ChatGPT Codex 实现，**观望即可**。
- 仓内自用同样 agent-first：`AGENTS.md`（bunx 惯例、turbo 构建、Studio 调试台）+ 数十个内部 skills（PR 流程/发版/skill 撰写规范）+ `skills-evals`（**技能效果评测**，与本仓 skill-eval 同域，可互参）。

### 3.5 许可证（采用红线）

**不是 MIT/Apache**。双层许可（LICENSE.md 一手取证）：

- **免费**：个人、非营利组织、**≤3 人的营利公司**（可商用出片）；
- **付费**：超过 3 人的营利组织需 Company License（remotion.pro）；
- 5.0 版许可证将微调（PR #3750）。禁止转售/再许可 Remotion 衍生品。

**对 DeepOrca 的含义**：如果作为产品能力集成分发（而非开发者用户自己装），license 义务随公司规模触发；这是任何"引擎选 Remotion"的 spec 必须前置确认的决策点。对比：Code2Video MIT 无此问题（但它只是方法参考实现）。

---

## §4 两条路线对比

| 维度 | Code2Video | Remotion |
| --- | --- | --- |
| 本质 | 学术管线（研究脚本） | 生产级框架 + 生态 + 商业化 |
| 目标媒介 | Manim/Python（数学动画，窄） | React/DOM/CSS/WebGL（通用动效，宽） |
| 视频体裁 | 长篇教学视频 | 短视频、数据可视化、字幕/播客视频、营销素材 |
| 质量控制 | 三 agent + 机械门 + VLM 评审环 | 技能文档约束 agent + Studio 人工微调 + （无内置 VLM 评审） |
| 渲染 | 本地 manim + 系统 ffmpeg | 本地/Lambda/浏览器客户端，Rust 合成器 |
| 与 agent 的亲和 | 论文即"agent 编排"示范，但无 agent 工程配套 | skills/WebMCP/plugin 全套，行业标杆 |
| License | MIT | 双层许可，>3 人公司付费 |
| 成熟度 | 论文复现级 | 持续高频发版的生产产品 |

互补结论不变：**引擎 Remotion、方法论 Code2Video**。Manim 路线仅在"数学推导类教学内容"这一个体裁上有不可替代性，通用性远逊 React/DOM。

---

## §5 与本仓的映射

### 5.1 skill 体系同构（零适配分发的可能性）

- 本仓 skills 发现顺序：`./.deeporca/skills` → `./.agents/skills` → `~/.deeporca/skills` → `~/.agents/skills` → bundled；Remotion skills 同为 `SKILL.md + YAML frontmatter(name/description) + 平铺子文档`，且 Remotion 自己 2026-05 已把 agent skills 迁至 `.agents/skills`（commit #7657）。
- 推论：将 `remotion-dev/skills`（或主仓 `packages/skills/skills/`）放入上述任一路径，DeepOrca 的 skill 扫描即可发现并加载；路由式"按需读子文档"恰好匹配我们的渐进读取习惯。**若未来启动视频能力，这是成本最低的第一步**（无需写任何集成代码）。

### 5.2 机制同构：Code2Video ↔ design-stage-gates / designer

| Code2Video 机制 | 本仓对应/启示 |
| --- | --- |
| outline/storyboard JSON 生成后 `json.loads` 校验、失败重试 | stage-gates 的 JSON 机械门 |
| `compile()` 语法门 + dry-run 注入快速退出 | 同构于"先机械验证再放行"；dry-run 思想可借鉴到原型/设计动作的"生成后快验" |
| ScopeRefine 行→块→全局分级修复 + 第 3 次降级简化重写 | 与 stage-gates 两级降级同构；**跨域第二佐证**，可作为"机械门 + 分级降级是通用模式"的论据回写 |
| 产物全落盘断点续跑（每步有收据） | 任务树/后台任务可借鉴的产物形态 |
| Grid 锚点 DSL + 占用表 + 行级回写 | designer taste/视觉评审线的机制参照：让 VLM 反馈落到受控 DSL 上才能机械执行 |
| Critic VLM 评审回写代码再渲染（2 轮预算） | review 模块"证据驱动"的又一独立实现（与 VibeGame 预研的 VLM 逐项二元提问同域互补） |
| RunConfig 显式重试预算 | 后台任务超时/重试参数化设计的参照 |

### 5.3 集成形态评估（仅记录，不排期）

| 形态 | 评估 |
| --- | --- |
| skills 分发（用户侧装 Remotion skill，agent 引导用户 `npx create-video`） | **最低成本路径**：DeepOrca 零代码，渲染发生在用户工作区；许可义务在最终用户 |
| 桌面内置渲染（vendor renderer + compositor 二进制 + headless chrome） | 成本最高：vendor 体积（6 平台原生二进制 + chrome headless shell，与 Granite 118MB 同量级问题）、跨平台打包矩阵扩展；收益是"原型→视频"一键化。有官方 `template-electron` 先例可参照 |
| 客户端渲染（webcodecs） | 中间态：renderer 侧免服务器，但浏览器 bundle 体积与兼容面需专项验证 |
| Manim/Code2Video 集成 | 不建议：依赖 Python 运行时 + 双 LLM API 约定，与"core UI-free、外部能力 MCP 化"的边界冲突；仅作方法参考 |

### 5.4 许可证决策点（前置）

若任何 spec 选择 Remotion 引擎路线，先过两问：① DeepOrca 团队/公司规模是否触发 Company License；② "把 Remotion 渲染作为产品能力打包分发给用户"在双层许可下属于哪一类使用（个人用户自装 vs 产品内置）——②建议在 spec 阶段咨询官方 FAQ/remotion.pro 后定论。

---

## §6 结论与建议

1. **本期处置：纯留档，零代码。** 登记于本索引，消费状态 ⬜；不排期、不建 spec、不写代码。
2. **若未来启动「代码→视频」能力**（触发条件另议：如"原型→演示视频"需求出现），推荐路径分三步：
   - 第一步（近零成本）：skills 分发引入 Remotion 官方 Agent Skills，让 agent 在工作区内具备建视频项目能力，跑通真实用户价值后再谈集成；
   - 第二步（按需）：以 `specs/` 立项"原型→视频"动作，管线参照 Code2Video 三段式（大纲→分镜→代码，产物落盘断点续跑）+ stage-gates 机械门（JSON/语法/渲染退出码）+ 分级修复 + VLM 评审环（Grid 锚点思想落到 designer DSL）；
   - 第三步（远期可选）：评估桌面内置渲染的 vendor 成本与许可义务后再决定是否产品化打包。
3. **两条立即可回收的旁支价值**：a) Code2Video 的 ScopeRefine 与 stage-gates 的同构性，可在后续 stage-gate 引擎泛化讨论中作为跨域论据引用本文 §2.3；b) Remotion "弃 MCP 转 skills" 的官方决策与 `skills-evals` 的存在，可作为本仓 skill 路线（skillweaver/skill-eval 线）的外部印证，收录进相关台账。
4. **红线备忘**：Remotion 双层许可——任何集成 spec 必须先过 §5.4 两问。

## §7 参考链接

- Code2Video：[arXiv 2510.01174](https://arxiv.org/abs/2510.01174) · [GitHub](https://github.com/showlab/Code2Video) · [项目站](https://showlab.github.io/Code2Video/) · [MMMC 数据集](https://huggingface.co/datasets/YanzheChen/MMMC)
- Remotion：[官网文档](https://remotion.dev/docs) · [Agent Skills 文档](https://www.remotion.dev/docs/ai/skills) · [WebMCP 文档](https://www.remotion.dev/docs/ai/webmcp) · [许可证](https://remotion.dev/license) · [skills 仓库](https://github.com/remotion-dev/skills)
- 本文一手取证对象：Code2Video `src/agent.py`、`src/scope_refine.py`；Remotion `README.md`、`AGENTS.md`、`LICENSE.md`、`packages/skills/` 目录树及 `remotion-best-practices`/`remotion-create` SKILL.md 全文
