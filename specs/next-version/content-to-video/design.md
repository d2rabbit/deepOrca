# 内容→视频动态讲解（content-to-video）· 技术设计

> **状态**：**方案稿（只出方案，不改代码）** · **日期**：2026-09-14 · 分支 `feat/modern-ui-redesign` · **2026-09-14 立项入 next-version 规划区（储备项，启动时 `git mv` 回 `specs/content-to-video/` 转活跃）**。
> **上游调研**：[`docs/research/2026-09-14-tmem-hyperframes-prestudy.md`](../../../docs/research/2026-09-14-tmem-hyperframes-prestudy.md) §3（HyperFrames 一手取证 + 与 09-11 Remotion 预研的引擎对照）；管线方法论参照 [2026-09-11-code2video-remotion-prestudy.md](../../../docs/research/2026-09-11-code2video-remotion-prestudy.md)（Code2Video 三段式/stage-gate/分级修复）。
> **用户定调**：实现一个**额外的**能力——将部分内容转换为 HTML 再转换为视频动态讲解。**用户显式触发，不自动生成**。
> **对应实现域**：`packages/core/templates/plugins/`（bundled skills）+ `scripts/vendor-*.js`（阶段 B）+ agent 经 bash 驱动 CLI。**不新增内置工具、不新增 IPC、主进程零新依赖**（与"内置工具保持克制"与"主进程依赖精确 pin"两条既有规则对齐）。

---

## §0 执行摘要

把会话产物、文档、PR diff、设计说明等**部分内容**转换为 HTML 合成，再渲染为动态讲解视频（MP4）。创作媒介采用 **HyperFrames**（HTML + `data-*` 时间属性，无构建步骤，headless Chrome 逐帧 seek + FFmpeg 确定性编码，Apache-2.0）——它是 09-11 预研中 Remotion 的 **Apache-2.0 替代项**（拆掉许可证红线，agent 产出物为纯 HTML）。能力分三阶段递进：技能先行（零集成验证）→ vendor 化（离线产品化）→ 程序化（可选）。

| 阶段 | 内容 | 集成成本 |
|------|------|----------|
| A 技能先行 | 4 个 bundled skills + agent 经 bash 跑 `npx hyperframes`，产物落工作区 | 近零（技能改写） |
| B vendor 化 | `vendor-hyperframes.js` + FFmpeg + chrome-headless-shell，离线渲染 | 中（新 vendor + 体积评审） |
| C 程序化（可选） | producer 受控子进程 + 后台任务进度面 | 高，按需再议 |

## §1 引擎决策

- **基准引擎：HyperFrames**。理由：Apache-2.0 无商用门槛（Remotion 双层许可，>3 人营利公司需 Company License——09-11 §5.4 红线）；纯 HTML 创作媒介与本仓 agent（会写 HTML）零适配；Node 22+ 与本仓一致；20 个 SKILL.md 技能与本仓技能方言同构；确定性渲染适配 CI/回归。
- **重开条款**：正式开工时按调研 §3.3 对照表复核一次引擎选型（HyperFrames vs Remotion 的生态成熟度与 Lambda 路径）；若改选 Remotion，须先过 09-11 §5.4 许可证两问。**Code2Video 管线方法论（三段式落盘断点续跑 / stage-gate 机械门 / 分级修复 / VLM 评审回写）与引擎选择正交，始终适用**（§3.3）。

## §2 三阶段架构

### 2.1 阶段 A：技能先行（P0）

改写 HyperFrames 上游技能为 bundled skills（`packages/core/templates/plugins/<域>/skills/`，SKILL.md + YAML frontmatter，随既有技能发现分发）：

| 技能 | 来源 | 改写要点 |
|------|------|----------|
| `content-to-video`（router） | `/hyperframes` | 能力图 + 意图确认（时长/画幅/语气/素材清单）；路由到 explainer 工作流 |
| `video-explainer` | `/faceless-explainer` | 任意文本→概念讲解视频：brief→分镜→HTML 合成→lint→preview→render 全流程；**本能力的默认工作流** |
| `video-hf-core` | `/hyperframes-core` | 合成契约：`data-*` 时间属性、clip/tracks/子合成、确定性规则 |
| `video-hf-cli` | `/hyperframes-cli` | `init/lint/check/preview/render` 命令纪律（非交互默认） |

- 渲染执行 = agent 经 **bash 工具**跑 `npx hyperframes render`（阶段 A 依赖网络拉包；离线是阶段 B 目标）。**不新增内置工具、不新增 MCP server、不新增 IPC**。
- 动画默认约束在 CSS + GSAP 两个可 seek 适配器内（技能中写明白名单，收敛 agent 自由度与排查面）。

### 2.2 阶段 B：vendor 化（P1）

- 新增 `scripts/vendor-hyperframes.js`（照 `vendor-dembrandt.js` 的 npm pin 模式：pinned 版本装到 `packages/desktop/vendor/hyperframes`，隔离 node_modules）+ FFmpeg 静态二进制（照 `vendor-download.js` 下载模式，按平台 pinned）+ `chrome-headless-shell`（同上）。
- vendor root 走既有 `configure*` 宿主注入接缝模式（照 `configureDembrandtVendorRoot` / `configureUvVendorRoot` 先例；core 侧仅存 seam，解析在 desktop `main/index.ts`）。
- 技能中的命令改指 vendor 路径（宿主注入的绝对路径），离线可渲染。
- **打包评审前置**：FFmpeg ~80MB + chrome-headless-shell ~150MB，合计 ~230MB（对照 Granite ~118MB 先例）；`electron-builder.yml` extraResources 增量需过体积评审。上游 Git LFS 基线（~240MB mp4）**绝不进安装器**——vendor 脚本只取 npm 包运行时。

### 2.3 阶段 C：程序化（P2，可选不排期）

`@hyperframes/producer` 以受控子进程调用（**仍不进主进程依赖**），后台任务徽标/进度条复用既有 background-task 体系；`@hyperframes/studio`/`player` 嵌入 renderer 做合成预览为远期选项。AWS Lambda 云渲染不排期（本地渲染已满足桌面场景）。

## §3 创作管线（video-explainer 工作流）

### 3.1 输入与 brief

输入三类：会话选区/总结（对话对象）、文档片段（编辑器/知识库）、PR diff（经 `gh`）。技能第一步产出 **brief**（一段固定结构）：主题一句话、目标时长（默认 30–60s）、画幅（16:9 默认）、逐场景要点清单——**用户确认 brief 后才进入生成**（意图前置，对齐上游 router 的 intent 纪律）。

### 3.2 HTML 合成

- 按分镜生成单个 `index.html` 合成（场景 = 子合成；每场景要点文本 + 简单图示/数据可视化；CSS/GSAP 白名单内做进场与转场）。
- 模板化起步：技能内置 2–3 个场景模板（标题卡/要点列表/对比图示），agent 填内容——降低首版自由度，质量稳定后再放开。
- lint → preview（浏览器人工过目）→ render 三步强制走完，lint 不过不渲染。

### 3.3 stage-gate（Code2Video 方法论承接）

| 门 | 机械检查 | 不过则 |
|----|----------|--------|
| G1 结构门 | `hyperframes lint`：时间属性合法、clip 无重叠越界、时长一致 | 修复重 lint |
| G2 渲染门 | `render` 成功产出 mp4 且时长 ≈ 预期 | 定位失败场景重渲染 |
| G3 走查门（人工） | preview 过目 + 成片抽看（文字可读/节奏/无烂尾帧） | 按 hunk 级反馈改对应场景 HTML（分级修复，不整片重来） |

产物与分镜 HTML 全部落盘工作区（天然断点续跑：改哪场重渲哪场）。

## §4 产物与风格

- **产物通道**：mp4 与合成 HTML 落工作区用户指定目录（默认 `<workspace>/.deeporca/outputs/video/`，沿用 .deeporca 存储约定与 registered-root 规则）；桌面侧打开 mp4 走既有产物预览通道（对齐 [specs/artifact-landing](../../artifact-landing/design.md) 的 open-file-viewer 路线，**本 spec 零改动、只对齐**——若其视频预览未就绪则降级为 reveal-in-folder）。
- **风格统一**：以 frame.md 机制把本仓设计 token（色板/字体/间距）反转为镜头用规范，随技能内置一份 `frame.md` 基线；与已 vendor 的 design-md 集合（`vendor-design-md.js`）同族衔接，保证出片风格与产品一致。
- **i18n**：阶段 A/B 无新桌面 UI 文案（全走技能与 CLI）；阶段 C 若加进度面，文案键 ×6 locale 全覆盖。

## §5 分期

| 批次 | 内容 | 验收 |
|------|------|------|
| **P0** | 4 个 bundled skills + `npx hyperframes` 在线流程 + brief 确认 + 三门走完 | 用一段真实会话总结产出 30–60s 讲解视频；lint 门拦截坏合成可复现；产物落 `.deeporca/outputs/video/` |
| **P1** | `vendor-hyperframes.js` + FFmpeg/chrome-headless-shell vendor + configure* 接缝 + 技能命令改 vendor 路径 + 体积评审 | 断网渲染成功；打包体积评审通过；vendor pin 升级流程文档化 |
| **P2（可选不排期）** | producer 子进程 + 后台任务进度面 + studio/player 预览评估 | 渲染可后台并行且可取消；进度面 i18n ×6 |

## §6 风险与对策

| 风险 | 对策 |
|------|------|
| FFmpeg/chrome-headless-shell 使安装器膨胀 ~230MB | P1 体积评审硬前置；不通过则维持 `npx` 在线模式（阶段 A 形态即为可交付态） |
| agent 生成的合成渲染烂尾（动画不可 seek / 越界 / 黑帧） | CSS+GSAP 白名单 + 模板化起步 + G1 lint 门 + 分级修复（不整片重来） |
| 首次渲染慢（逐帧编码） | 技能中写明预期（30–60s 成片的渲染耗时）；P2 后台化前建议短时长起步 |
| 引擎上游变动（HyperFrames 较新） | vendor pin 精确版本 + 升级走评审；重开条款保留 Remotion 备选 |
| 版权/素材风险 | 技能约定：媒体素材仅用用户工作区内资产或生成式占位（纯 CSS 图示），不引外部版权媒体 |

## §7 明确不做

不新增内置工具 / MCP server / IPC；主进程不引 `@hyperframes/*` 依赖（一律子进程 CLI）；不做在线视频编辑器 UI（studio 嵌入仅为远期选项）；不做 talking-head / 数字人 / TTS 配音（超范围，P0 静音或用户自备音频轨）；**不自动生成视频**（仅用户显式触发）；不做 Lambda 云渲染；不替换 09-11 预研的 Code2Video 方法论结论（其与引擎正交，始终适用）。
