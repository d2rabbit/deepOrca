# Compositor 预研：把"图像编辑/平面设计"（真设计模块）的第一性接缝定在文件格式上

日期：2026-09-29 · 分支：`feat/modern-ui-redesign` · 性质：预研报告（无代码变更，不启动 spec）

> **总口径**：调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现；
> 正式实现一律以 `specs/` 为准。**本文不另立 spec、不启动代码、不给落地方案。**

## 定位声明（先读这个）

**对象**：[robbietilton/Compositor](https://github.com/robbietilton/Compositor)——
"The Photoshop alternative for Mac"，原生 macOS（Swift/SwiftUI/AppKit + Metal + C
像素核）全功能图像编辑器，MIT。创建 2026-09-16，**13 天 6006★ / 646 forks**，
20 个 release（v1.2.1→v1.4），100+ commits，单人开发，AGENTS.md 在库
（AI 编码代理深度参与构建的项目本体）。

**模块归属（用户拍板，先于一切结论）**：本次属**真设计模块**——图像编辑/平面设计
（compositing & post-processing），**不属于 deepDesign 概念**：既非产品原型设计、
也非 UI 设计（那两块由 designer 模块 / A2UI / OpenUI 线承担，与本报告无关）。
本仓在该域现状：**零落地**——现有规划中最接近的只有 roadmap P2 的
"pi-computer-use + ShowUI 操控 Photoshop/Figma 桌面 GUI"外挂路线。
Compositor 是这条空白能力域的第一个预研对象。

**与本档案其他对象的关系**：它是继 gameStudio 七对象（生成器×5 / 评测器×1 /
素材工具×1）之后的**第八种角色——"可被 agent 直接驱动的专业编辑器"**。
与 GamePhanes（评测器，GamePhanes 评 agent）不同，Compositor 与 DeepOrca 是
**同一食物链上的直接上下游**：DeepOrca 的 `write`/`bash` 工具今天就能按其
公开契约驱动它（macOS 侧）——不需要插件、不需要 API、不需要 vendor。

### 调研材料（全部一手）

| 材料                                                                                                                              | 核证方式            |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `README.md` 全文（功能全集 + PSD 互操作 + "Works with AI agents" 节）                                                             | raw 全文            |
| `docs/project-format.md` 全文（`.comp` 格式 v1–v11 逐版演进，11KB）                                                               | raw 全文            |
| `docs/writing-comp-files.md` 全文（**AI agent 写入契约**，7.9KB）                                                                 | contents API 全文   |
| `docs/brush-performance.md` 全文（Metal 笔刷管线 + 4K 基准数字 + 复现命令）                                                       | raw 全文            |
| `AGENTS.md` 全文（面向 AI agent 的仓库说明）                                                                                      | raw 全文            |
| 仓库全量文件树（260 文件：Document 58 / Rendering 37 / UI 45 / IO+PSD 27 / Tests 66）                                             | git trees API       |
| 源码核证两点：`ProjectWatcher.swift`（300ms 合并窗口 + 100ms 重臂）、`DocumentLimits.swift`（30,000px 边长 / 2 亿像素面预算）      | contents API 抓取   |
| GitHub API 元数据 + commit 历史（100+/页）+ 20 条 release + 18 条 open issues                                                     | REST API            |

---

## TL;DR

| 层                     | 判断                                                                                                                                                                                                                              | 证据强度                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **产品本体**           | Photoshop 核心工作流（合成+后期）的完整开源复刻：图层/文件夹/24 种混合模式/蒙版/剪贴蒙版/调整层/GPU 图层效果/选区全家桶（含对象选择与 content-aware fill）/仿制图章/修复画笔/Camera Raw/**PSD 导入保持可编辑**                                  | README 功能清单 + 66 测试文件     |
| **对 agent 的真正意义** | **`.comp` 工程格式被有意设计成 agent API**："A `.comp` is a folder of PNG layers and a manifest, and an open project updates live as it's written. No plugin or API is involved."——任何能写文件的 agent 都是合法客户端                             | README + writing-comp-files.md   |
| **契约工程质量**       | 11 个格式版本全部**加法式演进**（optional 字段 + 老构建拒新版本而非误渲染 + 老版本文件禁含新字段 + round-trip 测试）；严格校验 + **静默拒绝**；原子 manifest 替换；**内容感知**变更检测（不看 mtime）                                          | project-format.md + ProjectWatcher.swift |
| **人工优先**           | agent 改写打开的工程时，若用户有未保存修改，弹窗让用户选"恢复我的还是保留 agent 的"，**绝不静默覆盖人的工作**；reload 清会话级 undo（与重开文件同语义）                                                                                       | writing-comp-files.md             |
| **性能工程诚实**       | 4K/800px 笔刷 2.6–3.1ms 中位更新、mouse-up 8–11ms（自 1058ms 优化而来）；文档自带复现命令，且明示"这是同步 CPU 计时，不是 input-to-photon，也不是 Photoshop benchmark"                                                                          | brush-performance.md              |
| **硬约束**             | **macOS 26.0+ 且仅 Apple silicon**（Xcode 26 构建）；Windows/Linux 是 open issue #23/#19 且作者未表态；PSD 仅 8-bit RGB 非 CMYK；矢量钢笔/非破坏滤镜栈缺失（#115/#97）                                                                      | README + issues                   |

**一句话**：Compositor 对 DeepOrca 的价值不在"又一个图像编辑器"，而在它把
**"专业编辑器的工程文件格式 = agent 的编程接口"**这件事做成了完整范本——
格式即 API、文件系统即 IPC、打开的画布即实时预览、人类保有最终否决权。
这正是本仓"真设计模块"（图像编辑/平面设计）从未被定义过的第一性接缝。

---

# Part I 项目画像：13 天的 Photoshop 替代品

## 1.1 基本盘

| 维度    | 事实（一手核证）                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 出品    | Robbie Tilton（个人），MIT；动机自述："Photoshop costs too much and tools like GIMP don't feel familiar enough for me to stay in flow"                  |
| 热度    | 6006★ / 646 forks（2026-09-29 API），创建 2026-09-16，最后 push 2026-09-28，18 open issues                                                              |
| 节奏    | 100+ commits、20 个 release（2026-09-21→09-28 连发 v1.2.1–v1.4，含 09-27 单日 4 个 patch）；签名+公证+Sparkle 更新道（appcast.xml）+ Homebrew cask        |
| 规模    | 260 文件：`Document/` 58（编辑器会话+58 个能力单元文件）、`Rendering/` 37（Metal+9 个 C 像素核）、`UI/` 45（SwiftUI 面板）、`IO/` 27（含 6 文件 PSD 读取器）、`CompositorTests/` 66 |
| 协作方式 | 仓库根有 `AGENTS.md`；commit message 全部为朴素英文陈述句（"Draw every canvas frame on the GPU"）；brush-performance.md 直接引用 `/tmp/` 下的测试日志路径——**AI 编码代理作为一等开发者的项目本体**，本身就是"agent 能写多大软件"的时代样本 |
| 平台    | macOS 26.0+ / Apple silicon only；Xcode 26+；无跨平台计划（#23 Windows / #19 Linux 开放无回应）                                                          |

## 1.2 功能覆盖（对照 Photoshop 工作流，README 全集清点）

- **图层系统**：图层/文件夹（组不透明度乘入内部）、24 种 PS 混合模式（名称逐字对齐
  Photoshop 排序）、图层蒙版（可画/填充/反相/羽化/模糊，可解链独立变换）、剪贴蒙版
  （v5 `maskSourceID` 活蒙版）、**12 种调整层**（色相/色阶/曲线/曝光/渐变映射/颗粒/
  黑白/色彩平衡/反相/高斯模糊/动感模糊/杂色）、6 种图层效果（描边/投影/颜色叠加/
  内阴影/外发光/内发光，GPU 渲染随时可改）、合并三件套、跨工程复制粘贴图层。
- **变换**：非破坏移动/缩放/旋转/翻转（保持全分辨率）、自由扭曲、多图层/整组联合
  变换、画布与图层边缘吸附。
- **选区**：矩形/椭圆选框、自由/多边形套索、魔棒（按色）/对象选择（Tab 切换）、
  **选择主体**、扩展/收缩/羽化、加减选区、载入图层像素或蒙版为选区、
  **content-aware fill**（可外推出画布）。
- **绘画与修饰**：笔刷（尺寸/硬度/不透明度/平滑，Paint/Erase 双模式）、
  修复画笔（content-aware）、仿制图章（对齐可选/取样单层或全部）、模糊工具、
  渐变、形状（矩形/圆角/椭圆/直线，**保持可编辑不栅格化**）、文字（段落框内联
  多行编辑，v10/v11 支持 per-run 颜色/字体）、吸管。
- **调整与滤镜**：Camera Raw 面板（光/色/曲线/混色器/分级/细节/光学/几何）、
  色阶/曲线/高斯模糊/动感模糊（可溢出图层边缘）、杂色/暗角/辉光/色调对比/
  镜头校正/**移除背景**；实时预览且限制在选区内。
- **画布与文件**：多工程 tab、标尺+参考线+布局网格、裁剪（含 3:4/9:16 比例）、
  画布/图像尺寸/修整、高质量降采样+像素网格、**PSD/PSB 导入（8-bit RGB）**、
  相机 RAW（先经 develop 步）、JPEG 导出实时预览、保存不阻塞操作、
  Photoshop 式快捷键全量可映射、数值标签拖拽 scrub。

**PSD 互操作细节（README 逐字）**：文件夹、蒙版、混合模式、填充矩形/椭圆、
简单横排文本**保持可编辑**；其余矢量与竖排文本转像素；**转换前展示转换报告**。
超大 PSD 打不开时按画布裁切图层而非拒绝。

---

# Part II 深潜一：`.comp` 文件格式 = agent API（本报告最值钱单件）

## 2.1 格式形态

```text
demo.comp/                        ← macOS 文档包（目录）
├── manifest.json                 ← 格式标识 com.compositor.project，version 11
├── images/
│   ├── <UUID>.png                ← 图层像素（RGBA 8-bit PNG）
│   └── <UUID>.mask.png           ← 图层蒙版（8-bit 灰度，白显黑隐）
└── QuickLook/Preview.jpg         ← Finder 预览（agent 改动后应删除防过期）
```

manifest 为纯 JSON：画布尺寸/分辨率、图层列表**自底向上**、每层 UUID/名称/可见性/
transform（origin/size/rotation/flips/sampling）/opacity/blendMode/可选
imageFile/maskFile/adjustment/text/effects。空图层无图像文件。

## 2.2 十一版加法式演进（project-format.md 逐版核证）

| 版本 | 增量                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| v1   | 基础：画布、图层、transform；30,000px 边长 / 1 亿源像素 / 10,000 图层 / 4MiB manifest / 512MiB 单资产硬限                           |
| v2   | 文件夹（`parentID`+`isGroup`）：环检测、组不带图、64 层嵌套上限、子序即兄弟序                                                        |
| v3   | 每层 `opacity`+`blendMode`（组保持 pass-through）                                                                                    |
| v4   | 图层蒙版（`maskFile`/`maskEnabled`；灰度无 alpha；1×1 均匀蒙版合法以免先分配全分辨率像素）                                            |
| v5   | 活蒙版/剪贴蒙版（`maskSourceID` 引用他层 alpha：环/自链/256 链长拒绝；删除时可烘焙或断链，单一 undo 操作）                            |
| v6   | 文件夹蒙版（覆盖组自身 transform 矩形，乘入全部后代）                                                                                |
| v7   | **调整层**（有 `adjustment` 无 `imageFile`，影响其下全部合成结果；九种 kind 全参数带值域校验）                                        |
| v8   | 文件夹不透明度 + 顶层 `guides` 参考线数组（≤1000 条）                                                                                |
| v9   | 邻域采样类调整（高斯/动感模糊、杂色带 `noiseSeed`——**跨会话稳定**）                                                                  |
| v10  | 文字 `colorRuns`（UTF-16 定位的 per-run 颜色）                                                                                       |
| v11  | 文字 `fontRuns`（per-run 字体）                                                                                                      |

演进纪律三条（对任何文件格式都是模板）：**①新字段一律 optional 且老 reader 忽略**；
**②声明老版本的文件禁止携带新字段**（"Files declaring versions 1–3 cannot contain
mask metadata"——防止语义走私）；**③老构建拒收新版本文件而非误渲染**。
改格式必须同步 bump 文档版本号与 `ProjectManifest.current`（AGENTS.md 明文），
且"未来可编辑特性必须扩展 schema 并过 round-trip 测试"。

## 2.3 Agent 写入契约（writing-comp-files.md，逐字要点）

这是**仓库官方给 AI agent 的独立文档**，AGENTS.md 明确指示："If you've been asked
to make or change an image in a `.comp` project, you don't need the app's source
code. Read docs/writing-comp-files.md"。README 给的示例 prompt 直接让 Claude Code /
Codex "边写边看画布更新，一次一两层"：

- **原子写协议**：先写全部 PNG，再把 manifest 写成包内临时文件（`.manifest.json.tmp`）
  后 rename 覆盖——"A rename is atomic: Compositor sees either the old manifest or
  the new one, never part of one."
- **静默拒绝**：破坏任一规则（UUID 与文件名不一致/混合模式拼写不符/缺图/非法 JSON）
  → 整文件拒收**且无任何提示**，画布保持原样；文档随之给出"Rules that matter"
  检查清单作为 agent 的第一排查面。
- **内容感知变更检测**：从 manifest 内容与每个图像的**文件名和字节大小**判断变化，
  不看 mtime——"writing identical manifest bytes back isn't enough"（同字节替换
  图像须连带改 manifest 才触发）。
- **节流语义**：`ProjectWatcher.swift` 核证——300ms 合并窗口（`.milliseconds(300)`）
  + 100ms 重臂，"writes stop 后约 1/3 秒重载；连续多次写入合并为一次更新，
  想让人看到每步就在步间稍作停顿"。
- **人类优先覆盖保护**：用户有未保存修改时，Compositor 询问"恢复到 agent 版本
  还是保留人的版本"，**绝不静默替换人的工作**；reload 保留缩放/滚动/选区但清
  undo（会话级，与重开同语义）；加载失败的写入被忽略直到下次变更——**改错后
  修正仍会生效**。
- **失败可见性缺口（诚实标注）**：静默拒绝 + 仅靠名字/大小感知变化，意味着 agent
  的写入被拒时没有任何回执通道——省了实现成本，把调试成本转嫁给 agent 端
  （对照本仓工具结果的 `InputParseError:` 结构化错误前缀，本仓设计更优，见 Part IV）。

## 2.4 为什么这是"真设计模块"的第一性接缝

本仓 deepDesign 线（.dd 文档/designer 模块）的本质是"**声明式文档驱动生成**"；
Compositor 把同一哲学带进了图像编辑域：**编辑器的原生工程格式本身就是
声明式 API**——agent 不需要屏幕点击、不需要插件协议、不需要进程内集成，
`write` 工具 + 文件系统就是全部传输层；打开的画布就是免费的可视化验收面；
PNG 图层就是人与 agent 的**共同编辑媒介**（agent 写 manifest，人用笔刷改同一层，
互不排他）。这与本仓 read/snippet_id、task-tree artifactRefs、sessions-index
去抖写入是同一族机制在"专业创作工具"域的完整实现。

---

# Part III 深潜二：渲染与性能工程（简报）

- **架构分层**：SwiftUI/AppKit（UI 45 文件）→ Swift Document 层（58 文件，每能力
  一文件：`MagicWand.swift`/`CloneStamp.swift`/`SmudgeLiquify.swift`/`SubjectRemoval.swift`
  …）→ 渲染层 = **Metal compute**（`GPUCanvas`/`MetalLayerEffects`/`MetalWarp`/
  `MetalBrushCoverage`）+ **9 个 C 像素核**（`BrushPixels.c`/`HealPixels.c`/
  `WandPixels.c`/`ContentFill.c`/`AdjustPixels.c`/`LevelsPixels.c`/`NoisePixels.c`/
  `DitherPixels.c`/`LensPixels.c`）→ `TiledLayerRenderer` + `DownsampleCache` +
  `EffectsPreviewCache`（串行后台 worker + 共享像素预算）。
- **笔刷管线**（brush-performance.md）：连续圆头沿平滑指针路径扫掠（Metal kernel），
  256×256 tile 逐次处理；**软覆盖按行进距离积分**（等效 2.5% 直径间距 source-over
  叠加）根治自交折痕；永久覆盖与暂存尾部分缓冲防残影；mouse-up 落**不可变
  `RasterSnapshot`**（tile 共享 + 空间索引扁平化），undo 同步记录。
- **基准诚实度**：4K/800px 笔刷中位 2.6–3.1ms、mouse-up 8–11ms（优化前 1058ms）；
  文档自带单测复现命令，并三度声明计时口径边界（"非 input-to-photon、
  非 Photoshop benchmark、不承诺帧率"）——数字全部可复现、口径全部自限。
- 09-28 单日提交显示其正在做**全面 GPU 化**（"Draw every canvas frame on the GPU"/
  "Run every adjustment on the GPU canvas"/"Blend clipping stacks in every mode
  off the GPU canvas"）——13 天项目仍在架构级返工期。

---

# Part IV 对照本仓（DeepOrca）

## 4.1 关系判定：可直接驱动的上游编辑器 + 机制范本

| 关系面 | 判断 |
| --- | --- |
| **驱动可行性** | DeepOrca 的 `write`/`bash`（POS shell）在 macOS 上**今天就能**按公开契约产出 `.comp`——无需 vendor、无需插件、无需 MCP。约束只有一个：用户机器需装 Compositor（macOS 26+ Apple silicon）。 |
| **与 deepDesign 边界** | 无交集：designer/A2UI/OpenUI 管"生成 UI/原型"，Compositor 管"像素级合成与后期"——用户已拍板分属两个模块。 |
| **与游戏美术线关系** | 互补：Aseprite 线（2D 像素加工导出）+ 本线（合成/后期/PSD 互操作）共同覆盖"AI 生成素材之后的精修段"；gameStudio 报告的"素材前段"缺的正是这一段。 |
| **与 roadmap P2 桌面 GUI 操控线** | 平行替代：pi-computer-use+ShowUI 操控 Photoshop 是"GUI 驱动"路线；Compositor 是"文件契约驱动"路线——后者确定性高一个量级（无坐标脆性、无 OCR/无障碍树依赖），凡有文件契约时恒优先。 |

## 4.2 逐项对位

| Compositor 机制 | 本仓对应物 | 差距判断 |
| --- | --- | --- |
| 工程格式即 agent API（.comp + 官方 agent 文档） | .dd 设计文档（deepDesign 域）；图像域无任何格式 | **真设计模块的空白由本报告首次定义**；"给产物格式写一份 agent 视角的使用文档"是零成本动作 |
| 文件监听 + 300ms 合并窗口 + 内容感知变更 | sessions-index 250ms 去抖 + pendingIndex（AGENTS.md 已有洞见）；任务树轮询 15s | 同族机制第二实现者；其"看内容不看 mtime"对 file-history/外部变更检测是补充论据 |
| 原子 manifest 替换（tmp+rename） | sessions-index 原子交换（audit-issues 修复项） | 互证；"先写资产后写索引"顺序纪律同构 |
| 静默拒绝（无回执） | 工具结果结构化错误（`InputParseError:` 前缀等） | **本仓已更强**：对外契约必须有结构化失败回执，Compositor 的静默拒绝是反例教材，不可效仿 |
| 人类优先覆盖保护（绝不静默覆盖人的工作） | 权限系统 + file-history（undo Git 仓） | 同向；其"弹窗二选一"交互是权限 ask 语义在协作编辑场景的实例 |
| 11 版加法式格式演进 + round-trip 测试 | sessions-index/usage-ledger 演进（含一次性 legacy migration） | 其"老构建拒新版本而非误渲染 + 老版本文件禁含新字段"两条纪律可回写 .dd/ledger 演进规则 |
| PSD 转换报告先行 | CRG review 报告 / 任务转换的偏差报告（CCGS 对位） | "迁移前先报告什么会丢"是导入/升级 UX 的通用范本 |
| 性能文档自带复现命令与口径自限 | 预算口径（本仓 npm check/测试门禁） | "benchmark 必须自带 reproduce 命令 + 声明计时口径"可作性能类提交的惯例 |
| AGENTS.md 面向 agent 的仓库说明 | 本仓 AGENTS.md | 互证；其"agent 不需要读源码，读一份 docs 就能产出合法工程"的分层次文档结构值得本仓产物文档效仿 |

## 4.3 本仓已更强、不需要对位的部分

- **错误回执**（如上）；**跨平台**（DeepOrca 三平台，Compositor 单平台）；
- **权限与安全**（Compositor 直接信任文件写入者，无沙箱/审批概念——它是单机
  桌面应用，本仓是 harness，威胁模型不同）；
- **进程治理**（本仓 spawn 跟踪/退出码约定 vs Compositor 无子进程编排需求）。

---

# Part V 可借鉴清单（只记发现，全部 ∥ 观察记账）

> 集成深度标度：L0 = 知识/提示词层；L1 = 用户可选外挂；L2 = 内置能力；L3 = 源码级继承。

| #   | 发现                                                                                                                                                       | 深度 | 为什么值得记                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **".comp 契约"模式**：专业编辑器的原生工程格式被有意设计成 agent API——文件夹+manifest+官方 agent 文档+live 预览，零插件零协议                              | L0   | 真设计模块（图像域）的第一性接缝定义；对任何"agent 可编辑产物"（文档/工程/资产包）都是格式设计模板                                        |
| 2   | **Agent 专用使用文档**：`writing-comp-files.md` 独立于格式文档，只讲"什么能写、怎么写安全、坏了怎么排查"，README 直接给可复制的 agent prompt                | L0   | 本仓产物（.dd/任务树/会话格式）均无 agent 视角的"怎么写才合法"独立文档；成本一页纸                                        |
| 3   | **加法式格式演进三纪律**：新字段 optional 老端忽略 / 声明老版本禁含新字段（防语义走私）/ 老构建拒新版本而非误渲染 + round-trip 测试 + 改格式必 bump 两处版本号 | L0   | .dd/usage-ledger/sessions-index 未来任何 schema 演进的纪律清单                                                                            |
| 4   | **内容感知变更检测**（看内容与字节大小、不看 mtime）+ 300ms 合并窗口 + 100ms 重臂                                                                          | L0   | 外部变更检测的成熟参数；sessions-index 去抖洞见的第二实现者                                                                              |
| 5   | **原子写顺序纪律**：先资产后索引，manifest 走 tmp+rename                                                                                                   | L0   | 任何"多文件一致性别名"的通用解；与本仓审计修复互证                                                                                       |
| 6   | **人类优先覆盖保护**：检测到人的未保存修改时二选一弹窗，绝不静默覆盖；reload 清会话 undo 与重开同语义                                                      | L0   | agent 与人共写同一产物时的冲突语义范本；file-history/任务树并发场景适用                                                                  |
| 7   | **PSD 转换报告先行**：导入前明示什么保持可编辑/什么栅格化；超大文件降级（裁切到画布）而非拒绝                                                             | L0   | 一切"导入/迁移/升级"UX 的报告范式                                                                                                        |
| 8   | **性能文档规范**：基准数字 + 复现命令 + 三重口径自限（"非 input-to-photon/非 PS benchmark/不承诺帧率"）                                                    | L0   | 性能类提交的证据标准                                                                                                                     |
| 9   | **静默拒绝反例**：写入被拒无任何回执，调试成本转嫁 agent（靠"Rules that matter"清单补偿）                                                                  | L0   | **反例教材**：本仓工具错误结构化回执设计保持不变；未来做任何"监听外部写入"的功能时勿效仿                                                  |
| 10  | **Compositor 作为 DeepOrca 的外部执行端**（macOS 侧）：write/bash 直产 .comp，画布即验收面；与 Aseprite 线互补覆盖"AI 素材精修段"                          | L1   | 若"真设计模块"立项，这是最小可行路径（零集成成本）；前提=用户装 Compositor 且接受 macOS 26+ 限定                                          |
| 11  | **AGENTS.md 分层文档结构**："改图像不用读源码读 docs；改应用本体读另一节"——按 agent 任务而非按代码结构组织                                                 | L0   | 本仓 AGENTS.md 已同向；其"任务→最短文档路径"映射更彻底                                                                                   |
| 12  | **AI-built 桌面应用样本**：13 天/100+ commits/66 测试文件/20 release，AGENTS.md 在库                                                                       | L0   | "agent 可交付完整专业桌面软件"的当代实证；对 DeepOrca 能力边界叙事是引用素材                                                              |

---

# Part VI 风险与不跟进

## 6.1 风险

- **平台与生命周期**：macOS 26.0+ Apple silicon only（最激进的系统门槛，发布仅
  13 天即要求最新 OS）；单人项目；6000★ 是"Photoshop 替代品"叙事驱动的流量，
  长期维护与商业模式（README 无任何商业化说明）未知；Windows/Linux（#23/#19）
  无作者表态。
- **功能成熟度**：仍在架构级返工（09-28 单日全面 GPU 化）；PSD 仅 8-bit RGB
  不支持 CMYK；矢量钢笔工具/非破坏滤镜栈/RGBA 通道编辑均为 open issue
  （#115/#97/#31）；"对 agent 写入静默拒绝"对自动化场景是可靠性缺口。
- **热度时效**：13 天项目处于舆论高点，本快照 2026-09-29；功能与格式（v11）
  都在快速变动，引用具体版本行为时须注明快照日期。

## 6.2 明确不跟进

- **vendor/嵌入 Compositor 本体**：Swift/Xcode 26/macOS 26+ 单平台，与本仓
  Electron 跨平台架构根本不兼容；即使作为外挂工具分发也存在签名/公证/系统
  版本门槛，且其价值必须由用户手动装一份即可兑现（`brew install --cask`），
  无分发必要。
- **PSD 读取器移植**：本仓无图像编辑运行时，移植 6 文件 PSD 解析器无落点。
- **渲染架构吸收**（Metal/C 像素核/笔刷积分算法）：无对应域，纯欣赏。
- **操控 Compositor 的 GUI 自动化**（pi-computer-use 路线）：有文件契约时
  GUI 操控恒为下策，本对象恰好证明这一点。
- **任何形式的 spec 启动**：真设计模块尚无产品决策，本报告只定义问题空间
  与接缝形态，不提案排期。

---

## 结论

Compositor 用 13 天证明了一件事：**专业创作工具与 coding agent 的正确集成点
不是插件、不是 API、更不是 GUI 自动化，而是"把工程文件格式本身设计成
agent 的编程接口"**——文件夹+manifest 即 API，文件系统即传输层，live 监听
即回执，人类否决权即并发控制。它的 `.comp` 契约（加法式演进三纪律、原子写
协议、内容感知变更检测、官方 agent 文档、人类优先覆盖保护）是一套完整可抄的
格式设计规范。

对 DeepOrca：真设计模块（图像编辑/平面设计）此前是未定义的空白，本报告给出
其第一性接缝的参照系；最小可行路径（L1）是"用户自装 Compositor + DeepOrca
按公开契约直写 `.comp`"（macOS 限定），机制层可立即回引本仓的是格式演进
纪律（#3）、agent 专用产物文档（#2）与性能证据规范（#8）。

**建议动作**：全部候选以 ∥ 状态记账于本文与 research 总索引，不另立 spec、
不启动代码；待真设计模块有产品决策时，本文与 Aseprite 预研（素材加工段）、
gameStudio 素材前段报告共同构成完整外部参照系。
