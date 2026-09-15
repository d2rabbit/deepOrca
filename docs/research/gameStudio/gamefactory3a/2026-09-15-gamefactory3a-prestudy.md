# 预研：OpenDCAI/GameFactory-3A —— 把"3A 游戏生成"做成多引擎 Skill 框架，它到底编码了什么

日期：2026-09-15 · 分支：`feat/modern-ui-redesign` · 性质：预研（无代码变更，不启动 spec）

## 定位声明（先读这个）

GameFactory-3A 是本次"游戏开发"调研的第二站。它与 VibeGame 不是同量级的对标对象，
而是**一整条更宽的产品线**：

| 维度 | VibeGame | GameFactory-3A |
| --- | --- | --- |
| 定位 | "自然语言 → 可玩 2D 网页游戏"的垂直 harness（自研 Phaser 引擎 + 对抗式 7 agent 团队） | **"自然语言 → 3A 游戏资产 + 引擎代码"的多引擎 Skill 框架** |
| 资产 | 2D 美术管线（Python） | 图片、3D 物体、3D 场景、动作、音频、CG 视频 |
| 引擎 | 自研 Phaser 3 封装 | **UE5 / Unity / Godot 4 / three.js / Blender（中性资产生成）** |
| 规模 | ~90 个文件（本调研下载量） | **1777 个文件** |
| 热度 | 238★ / 18 commits | **571★ / 持续更新** |
| 成熟度信号 | 9 个自报 demo，无定量评估 | 多段实机录屏（Unity/UE5/Godot/Blender/three.js 各一套）+ 可跑的测试 harness |

**本文的核心问题**：一个把"3A 游戏生成"做成多引擎 Skill 框架的项目，
**究竟在仓库里编码了什么"游戏开发能力"**？这些能力里，哪些是**真正能降低难度的工程**，
哪些只是**看起来像**？它与 VibeGame 是**互补还是竞争**？

> **总口径**：调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现；
> 正式实现一律以 `specs/` 为准。**本文不另立 spec、不启动代码、不给落地方案。**

### 调研材料（全部一手）

| 类别 | 材料 |
| --- | --- |
| 入口 | `README_zh.md`（中文 README）|
| Agent 主入口 | `agent_skills/setting_overview.md`(14KB) — 任务路由、端到端工作流、验收纪律 |
| 资产 QA | `agent_skills/asset_qa/README.md`(9.6KB) — 资产 Skill 地图、付费后端策略、review 工作流 |
| 资产 Skill | `agent_skills/asset_qa/{image,3d_object,3d_scene,motion,audio,cg_video}/SKILL.md` 目录 |
| CG 导演 | `agent_skills/asset_qa/cg_video/game-cg-director/`（含 SKILL/models/modes/schemas/scripts/templates）|
| 玩法生成 | `agent_skills/code_gen/mechanic/game_generation.md`(10.8KB) — Mechanic 契约、工作流、所有权边界 |
| UI 生成 | `agent_skills/code_gen/ui/game_ui_generation.md`(11.2KB) — 原生 UI + Browser Play 两段式 |
| 引擎路由 | `agent_skills/engine_context/engine_overview.md`(8KB) — 五引擎选择、层间所有权、Browser Boundary |
| 引擎 API | `agent_skills/engine_context/{ue5_api,unity3d_api,godot_api,three_js_api,blender_api}.md`（目录存在，本次未全量读取）|
| 开发 harness | `agent_skills/develop_harness/README.md`(6.9KB) — models→operators→pipeline 三层契约、CPU smoke |
| 仓库结构 | GitHub API `git/trees?recursive=1`（1777 文件全量列举）|

---

## TL;DR

| 层 | GameFactory-3A 编码了什么 | 是真工程吗 |
| --- | --- | --- |
| **端到端工作流** | 五步强制顺序：澄清简报 → 可测试计划 → 资产生产+QA → 选定引擎构建 → **验证-游玩-迭代**（第五步"不是可选项，也不能用编译通过代替"） | ✅ **真，且是全文最有价值的纪律**：把"能跑 ≠ 可玩"写成了验收规则 |
| **资产生成 Skill 地图** | 6 类资产（图片/T-pose、3D 物体、3D 场景、动作、音频、CG 视频）各有 SKILL.md；**付费云 API 必须先问用户再花钱**的硬流程 | ✅ 真。SKILL.md 是给 agent 的工作手册，不是给人读的文档 |
| **资产 QA** | 视觉 QA 被明确定义为"格式/结构检查回答不了的问题"（对称网格朝向、不可见重建是否可用、附着点、动画是否自然）| ✅ 真。显式要求"渲染预览 + 游戏画面 + 视觉模型/人审" |
| **Mechanic 契约** | 玩法层只产出**呈现无关的公共契约**（state/events/commands），强制 `UI → Mechanic → runtime` 依赖方向，**禁止反向** | ✅ 真。把"游戏逻辑怎么与 UI 解耦"变成了可检查的契约 |
| **多引擎公共 Client 边界** | 五引擎各有 `engine_adapters/<engine>/<EngineClient>`，所有宿主侧操作走公开 Client；生成代码只使用原生公开边界 | ✅ 真。"不混引擎 API"被写成 stop condition |
| **Browser Play 二段式** | UI = engine-native 原生 UI + browser-play 交付源；**禁止 browser 端复制 HUD / 消费 Mechanic 绑定 / 实现游戏命令** | ✅ 真。把"web 预览怎么不污染游戏"写成了边界 |
| **开发 harness** | models→operators→pipeline 三层只能向下依赖；`test/harness/smoke.py` 用 stub 模型在 CPU 毫秒级验证输出布局 | ✅ 真。**无 GPU 也能验证管线契约** |
| **输出不可变运行** | 发布 runs 不可变，修复必须新建 run 并记录 `parent_run_id`/`repair_of`；状态分 `generation_status` / `assembly_status` / `verification_status` 三段 | ✅ 真。把"生成≠组装≠验证"三态显式化 |
| **CG 视频导演** | 含 models（H3/Seedance）、modes（t2va/fl2va/i2va/ref2va）、schemas、scripts、templates（开场/剧情/宣传片/大招）的子框架 | ✅ 真。但**强依赖付费/本地大模型** |

**一句话**：GameFactory-3A 的真正价值不在"能生成 3D 模型"（那只是调用云 API），
而在它把**"从需求到可玩游戏"这条链路上的每一跳该怎么衔接、该怎么验收、该怎么隔离"**
编码成了 agent 可直接执行的 Skill。

---

# Part I 端到端工作流：五步强制顺序与"验证不是可选项"

## 1.1 五步工作流

`setting_overview.md` 规定每个游戏请求**必须**按以下顺序执行，
**"Do not jump directly to code or asset generation before the game has a plan."**：

| 步 | 做什么 | 关键约束 |
| --- | --- | --- |
| **1. 澄清简报** | 识别目标引擎、游戏类型、玩家循环、目标平台、交付物、视觉风格、参考、预算、验收标准 | 缺引擎或视觉风格**必须先问**；只缺一项则给合理默认并请用户确认 |
| **2. 可测试计划** | 写简洁可测试的计划：核心循环；操控；镜头；玩家/敌人/车辆角色；关卡流；UI；资产清单；动作/音频/VFX/光照需求；引擎集成；验证场景 | **每个计划资产必须命名用途、风格、来源路线、验收标准**；计划须与用户指定风格对齐 |
| **3. 资产生产 + QA** | 按计划生成资产，集成前先跑适用资产 QA；成熟类型（尤其 3D 物体）优先用能力强的闭源/云 API（需用户批准）；不成熟类型（动作、3D 场景）优先用引擎资产库的授权资产 | 记录来源与许可信息；**不得绕过登录或授权来源爬取** |
| **4. 在选定引擎中构建** | 先读 `engine_context/engine_overview.md` 路由到对应 CodeGen Skill，再读匹配的引擎 API。只用该 API 与最小相关参考代码创建场景/玩法/UI/材质/动画/特效/引擎特定项目结构 | **不混引擎 API**；任务包拥有规范引擎 |
| **5. 验证、游玩、迭代** | 构建、启动、实际游玩、录制、评审、修复、重复。**这一步不是可选项，也不能用"编译通过"代替** | 见 §1.2 |

**Required Reading by Task** 表把每类工作路由到必须先读的 Skill，
例如"3D 物体"先读 `asset_qa/3d_object/SKILL.md`，
"玩法"先读 `engine_context/engine_overview.md` → `code_gen/mechanic/game_generation.md` → 选定引擎 API。

## 1.2 "验证-游玩-迭代"：本文认为最有价值的单条纪律

`setting_overview.md` 用一整节定义第五步，并开篇定调：

> "Step 5 of the workflow, **the only stage that produces playability evidence**.
> 'It compiles', 'it launches', or 'no errors in the log' is **not** validation."

并给了一个**6 维评审表**（每个维度都是"编译 + 结构资产检查发现不了的失败模式"）：

| 评审维度 | 查什么 |
| --- | --- |
| **图像质量** | 网格剪影与拓扑瑕疵、贴图分辨率、材质响应、接缝、LOD 跳变；场景：构图、地/墙连续性、孔洞、缺碰撞地板、绘制距离、雾 |
| **光照** | 曝光、阴影过硬或缺失、光穿过几何体泄漏、lightmap/GI 瑕疵、死黑或过曝面、角色与环境光向不一致 |
| **风格匹配** | 调色板、对比度、后处理、情绪**必须**匹配请求的风格（赛博朋克霓虹 / 低多边形写实 / 照片级）；**"风格不对的干净画面也是失败"** |
| **动态特效** | VFX 在正确事件触发并正确停止（无卡死循环、单帧闪烁、死后残留）；合理的缩放/密度/强度；在正确 socket 生成并跟随物体；冲击/脚步/引擎/UI 反馈与动画音频同步 |
| **移动朝向** | 角色面朝移动方向——不走火/不朝反方向开火；动画前轴向与控制器和镜头相对输入一致；武器口/刀尖朝前且远离身体；**每重定向/重导入/改轴后必须重检，在资产/导入元数据里修正，禁止在游戏玩法代码里补偿旋转** |
| **组合与可游玩性** | 武器握在握把、**在角色前方/身侧**而非嵌进躯干或漂浮；车轮**在底盘下方**四轮拱着地、绕正确轴转、前轮转向；脚踩地不下陷/不浮；头盔背包盾炮跟骨骼；角色/武器/车辆/门/房间的相对比例合理；**动画过程中不穿插，不只是 idle pose**；碰撞物理（不坠地、不卡死、不抖动）；镜头不穿墙/不穿角色；操控响应无不反转轴；UI 可读、锚定、绑定真实玩法状态；无不卡顿到影响操作 |

**修复纪律**也写明了：
"Log each finding as: **symptom in the video → owning layer (asset, import metadata,
mechanic, UI, scene, lighting, VFX) → fix → re-verified in a new recording.**
Fix the cause in its owning layer; **never patch an asset problem inside gameplay code.**"

## 1.3 完成规则（Completion Rules）—— 给 agent 的硬门槛

| 规则 | 内容 |
| --- | --- |
| 不替换 | 保留任务的验收标准，**不得因为更容易跑就换成不同的游戏或引擎** |
| 路径规范 | 生成的产物路径走 `pipeline/common/paths.py`，禁手拼 |
| 分离交付物 | 生成的资产/玩法/UI/引擎集成通过各自要求的验证前，保持为独立交付物 |
| **不因代码写了就声称可玩** | "Build, launch, representative player-operation checks, and visual review are separate evidence" |
| 凭证不落库 | API key / token / 私人媒体走环境变量或本地密钥存储，**禁提交** |

---

# Part II 资产生成：6 类资产的 Skill 地图

## 2.1 Skill 地图

`agent_skills/asset_qa/README.md` 的 Skill 地图：

| 资产任务 | 先读 SKILL | 再读 |
| --- | --- | --- |
| 图片 / T-pose | `asset_qa/image/SKILL.md` | — |
| 3D 物体 | `asset_qa/3d_object/SKILL.md` | `asset_qa/3d_object/orientation_review.md`（导入网格朝向与缩放）|
| 3D 场景 | `asset_qa/3d_scene/SKILL.md` | 选定引擎 API |
| 动作（绑定/生成/抓取/重定向）| `asset_qa/motion/SKILL.md` | 选定引擎 API（导入前）|
| 对话/音效 | `asset_qa/audio/SKILL.md` | 选定引擎 API（集成前）|
| CG 视频 | `asset_qa/cg_video/SKILL.md` | 选定引擎 API（视频被游戏内使用时）|

**环境配置表**（每类资产一条安装命令）与**付费后端策略**见 §2.3。

## 2.2 视觉 QA 为什么必须

`asset_qa/README.md` 明确定义了视觉 QA 的必要性：

> "The adapter can validate format, hierarchy, triangle count, bounding box, and
> animation structure. **It cannot determine whether a symmetric mesh faces the correct way,
> whether an unseen reconstruction is usable, whether wheel or weapon attachments are
> positioned correctly, or whether an animation looks natural.**
> A vision model or human review of rendered previews and gameplay capture is therefore
> required before a visual asset is accepted."

## 2.3 付费后端策略：必须先问用户再花钱

这是本文见过对"agent 调用付费 API"最诚实的流程设计：

> "For the mature asset types — **3D object, image/T-pose, audio, CG video** — the
> closed-source cloud APIs are the recommended first choice, because they are materially
> more reliable than the local/open routes. **They also spend the user's money, so the
> agent must stop and ask rather than assume a key exists.**"

| 资产任务 | 推荐付费后端 | 环境变量 |
| --- | --- | --- |
| 3D 物体 | Tripo，其次 Meshy | `TRIPO_API_KEY`, `MESHY_API_KEY` |
| 图片 / T-pose | Seedream via Volcengine Ark | `ARK_API_KEY` |
| 音频 | Seed Audio via Volcengine | `SEED_AUDIO_API_KEY` |
| CG 视频 | Seedance via Ark，其次 MiniMax Hailuo | `ARK_API_KEY`, `MINIMAX_API_KEY` |

调用前必须走六步：**暂停 → 一次性发送推荐方+原因+购买/API-key URL+当前定价页+本次批量估算成本+请求用户购买 → 等明确答复 → 若批准则让用户自己导出 key（否则只设在会话环境）→ 若拒绝则走本地/open 兜底 → 无任何路线能产出可交付资产时报告缺口而非静默降级质量。**
"Never put a key in a JSONL, task metadata, cache key, log, or commit."

**本地/open 兜底**：3D 物体有 TRELLIS.2（`trellis2_install.sh`）；
CG 视频有 MiniMax H3（本地 720P，见中文 README 的演示）。

## 2.4 Review 工作流

| 步 | 内容 |
| --- | --- |
| 1 | 从批准的游戏计划及其风格/角色/验收标准出发 |
| 2 | 按计划生成或获取资产。成熟类型优先付费云 API（先获批准）；不成熟类型优先引擎资产库授权资产 |
| 3 | 跑任务特定结构检查 + 选定 Skill 的视觉 QA |
| 4 | 用选定的引擎 API 契约导入资产 |
| 5 | 在目标游戏中运行资产，执行相关玩家动作，审低分辨率捕获的**朝向/附着/动画/穿插/缩放/材质/VFX/光照/风格**问题 |
| 6 | 迭代直到资产满足计划验收标准；**保留外部资产的来源与许可信息** |

---

# Part III 代码生成层：玩法与 UI 的契约化

## 3.1 Mechanic 契约：玩法层只产"呈现无关的公共契约"

`code_gen/mechanic/game_generation.md` 给玩法层划了一条清晰的线：

**依赖方向**（唯一允许的方向）：

```text
UI -> Mechanic -> runtime framework
```

"The reverse dependency is forbidden. Mechanic must compile, test, and be evaluated
**without a UI module, HUD, widget, menu, renderer, or screenshot**."

**必须产出的契约**：`mechanic_contract.json`（schema `gamefactory3a.mechanic_contract.v1`）：

| 字段 | 要求 |
| --- | --- |
| `contract_version` | 正的公共契约版本 |
| `gameplay_module` | 生成的游戏所属模块名 |
| `state` | **非空**——暴露给 UI 的可观测值 |
| `events` | **非空**——玩法转换/通知 |
| `commands` | **非空**——UI 或运行时可调用的动作 |
| `public_api_paths` | **非空**——生成的适配器源码的工作区相对路径 |

"Entries must represent **real generated behavior, not placeholders**."
适配器必须支持状态查询、事件订阅、命令调用，**且不得暴露私有 Pawn/Character/Controller/实现类型**。

**所有权三段分离**：

| 层 | 拥有 | 不得拥有 |
| --- | --- | --- |
| **Agent** | 游戏所属 Mechanic 源码、生成测试、契约、修复改动 | 执行/评估/引擎启动/基准分 |
| **Code Generation Pipeline** | 任务/上下文组合、Prompt 渲染、边界、包、快照、定稿、元数据 | 生成的玩法规则 |
| **Execution/Evaluation** | 引擎准备、资产导入、权威构建/测试、运行时证据、截图、基准评分 | — |

**修复纪律**："identify the smallest root cause, modify only game-owned source/tests,
preserve the canonical Engine, contract, provenance, unrelated working behavior, and
failure evidence, and **do not weaken tests**."

## 3.2 UI 生成：engine-native + Browser Play 两段式

`code_gen/ui/game_ui_generation.md` 把 UI 拆成两个阶段，**按顺序生成**：

### 阶段 1：engine-native

在 `generated_ui/` 下生成真实的 HUD/屏幕/Widget/资源/布局/焦点与输入处理/反馈/绑定/夹具/原生测试。
关键约束：**通过公共 Mechanic 运行时适配器查询状态、订阅事件、调用命令**；
UI 不得复制 Mechanic 契约、不得发明绑定、不得转型到具体玩法类。

### 阶段 2：Browser Play

在 `generated_ui/browser_play/` 下生成交付源。关键约束：

> "The Engine stream already contains the native gameplay UI. Browser Play must not
> duplicate the HUD, consume Mechanic bindings, implement gameplay commands, own
> transport, branch on Engine names, or generate/modify an `EngineBackend`."

**Visual Rules**：检查每个参考图；**先满足任务要求与禁止 UI，再追求视觉相似**；
参考图用于层级/密度/间距/颜色/字体/风格；**"生成完整的交互状态，而非仅截图壳"**。

Browser 端产物：`browser_play_manifest.json`（schema `gamefactory3a.browser_play_manifest.v1`）+
一个**瘦启动脚本**（可设环境变量并调用 `python -m engine_adapters.browser_serving`）。

## 3.3 多引擎公共 Client 边界

`engine_context/engine_overview.md` 给五引擎各配一份 API 文档与一个公开 Client：

| 引擎 | API 文档 | 公开 Client 入口 |
| --- | --- | --- |
| `ue5` | `engine_context/ue5_api.md` | `from engine_adapters.ue5 import UEClient` |
| `unity3d` | `engine_context/unity3d_api.md` | `from engine_adapters.unity3d import UnityClient` |
| `godot` | `engine_context/godot_api.md` | `from engine_adapters.godot import GodotClient` |
| `three_js` | `engine_context/three_js_api.md` | `from engine_adapters.three_js import ThreeClient` |
| `blender` | `engine_context/blender_api.md` | 文档化的 `bpy` 解释器边界 |

**"Validated engine baseline"** 机制：每份 API 文档声明一个已验证的引擎版本基线，
签名与行为只在该基线版本保证；支持多版本时加 `@since`/`@changed` 注解。
**"Blender 是中性资产生成上下文，不是可交付游戏运行时"**。

**Public API Boundary**：
- 所有宿主侧项目/导入/绑定/构建/测试/playtest/编辑器/运行时/World/会话操作
  **走公开 Client**
- 生成的原生引擎代码只用原生公开边界，**不调用宿主侧 Python Client**
- **不导入 adapter 内部、不调用私有传输、不直接启动引擎二进制、不创建平行导入/构建/运行时实现**
- 所需能力缺失时 **"stop and report a public API gap"**，先扩展所属 adapter 契约

**Browser Boundary**：Browser Play 只用公开 Browser Serving API；
**不得导入 Engine Client / 构造具体后端 / 按引擎名分支 / 复制原生 UI 或玩法状态 /
从私有规则推导 stream URL**；**运行时准备好之前不得发布 browser URL**。

**层间所有权表**（engine_overview 原文）：

| 层 | 拥有 | 不得拥有 |
| --- | --- | --- |
| Mechanic | 玩法规则、模拟、状态、事件、命令、原生插件、公共契约 | UI、浏览器交付、资产导入、构建、测试、运行时启动 |
| UI | 原生引擎 UI、Mechanic 契约绑定、Browser Play 交付源 | 玩法规则、重复玩法状态、引擎后端、资产导入、构建 |
| Execution/Assembly | 项目准备、描述符解析、插件安装、导入、构建、测试、运行时证据、产品组装 | 生成的玩法规则、私有引擎内部、替换导入/构建路径 |
| Browser Serving | 浏览器会话/流/通用输入/注册的后端生命周期 | 玩法规则、原生 UI 重复、游戏特定浏览器命令 |

**Stop Conditions**（实现时必须停下报告的 7 条违规）：

| # | 违规 |
| --- | --- |
| 1 | 混用不同目标引擎的 API 或 Example |
| 2 | 把 UI 或执行职责放进 Mechanic 代码 |
| 3 | 把玩法规则或重复状态放进 UI 或 Browser Play |
| 4 | 绕过选定的公开 Client 或文档化的 Blender 边界 |
| 5 | 把引擎 Example 复制进生成项目作为运行时依赖 |
| 6 | 运行时未就绪就暴露 browser URL |
| 7 | 没有对应执行/评估阶段拥有的证据就声称构建/测试/运行时/可玩成功 |

## 3.4 CG 视频导演子框架

`agent_skills/asset_qa/cg_video/game-cg-director/` 是一个独立子框架，含：

| 子目录 | 内容 |
| --- | --- |
| `models/` | H3（MiniMax 本地）、Seedance（云）两模型文档 |
| `modes/` | `t2va` / `fl2va` / `i2va` / `ref2va` 四种生成模式文档 |
| `schemas/` | `output.schema.json` |
| `scripts/` | `validate_output.py` |
| `templates/` | `cutscene.md` / `opening.md` / `promo.md` / `ultimate.md` 四套模板 |
| `common/` | `camera.md` / `principles.md` / `sound.md` / `style-mapping.md` |

中文 README 里的四段 CG 演示（F1 赛车开场、奇幻 RPG 中段剧情、反恐 FPS 宣传片、
双人对战大招演出）使用 **MiniMax H3 本地 720P 生成**。

---

# Part IV 工程治理：harness、路径、运行不可变性

## 4.1 三层单向依赖 + CPU smoke

`develop_harness/README.md` 把资产生成链分成三层：

```
models/<family>/<model_name>_model.py      第 1 层——"如何跟一个模型对话"
        │ 只知道：权重/dtype/设备/自己的 API；不知道：任务/jsonl/输出路径/游戏
        ▼
operators/<task>/operator.py                第 2 层——"如何把一个任务字典变成产物"
        │  funcs/ 知道：任务语义/产物名/meta；不知道：哪个具体模型/argparse/jsonl
        │  metrics/
        ▼
pipeline/assets_gen/<task>/run.py + eval.py  第 3 层——"如何跑一批并打分"
           只知道：argparse/ckpt 解析/jsonl/汇总；不知道：模型内部/产物字节布局
```

**唯一规则**：依赖**只向下**。模型不 import operator；operator 不 import run.py。
跨层接线**只在 `run.py` 的 `make_operator()` 里发生一次**。

**CPU smoke 验证**：`test/harness/stubs.py` 提供假模型 + 夹具，
`test/harness/smoke.py` 用 stub 跑完整链，断言：产物落在 `paths.py` 承诺的位置、
`meta.json` 已写、遗留 flat 模式未变、汇总按游戏项目分组。
**"无 GPU、无模型权重即可验证管线契约"**。

## 4.2 路径唯一来源

`pipeline/common/paths.py`(15.7KB) 是**所有输入输出路径的唯一来源**。
注册点在 4 张表：`TASK_LAYER`、`TASK_INPUT_DIR`、`TASK_JSONL`、`TASK_COLLECT_JSONL`。
文档要求 `grep -rn "outputs/" operators/ models/` **必须为空**——
任何在这些目录里硬编码输出路径都是 bug。

Anti-patterns 表（7 条）：

| 不要 | 要 |
| --- | --- |
| operator 里写 argparse | CLI 留在 run.py |
| operator 构造模型 | 注入已加载的模型 |
| model 写 `test_data/outputs/` | model 返回数据，operator 存 |
| `os.path.join("outputs", ...)` | `paths.task_output_dir(...)` |
| operator 顶层 import torch | 函数内 import |
| eval 里 import `run.generate()` 或加载生成模型 | 只解析并打分既有产物 |
| `except Exception: pass` 包住推理 | 让真实 traceback 暴露 |

## 4.3 运行不可变 + 三态状态

每个发布 run 是**最小的可复现发布单元**：

```
test_data/outputs/<game_id>/runs/<run_id>/
|-- run.json
|-- inputs.lock.json
|-- artifacts/{mechanic,ui}/<task_id>/
|-- products/<pipeline_task_id>/
|-- evaluation/<pipeline_task_id>/
`-- _pipeline/{packets,attempts,prompts,snapshots}/
```

**"Published runs are immutable. A content repair creates a new run and records
`parent_run_id`, `repair_of`, and the failure digest`."
未发布的重试留在 `_pipeline/attempts/`，只提升被选中的 attempt。**

每个产物附带 `manifest.json`（schema `gamefactory3a.artifact_manifest.v1`），
含：artifact_version、identity（game_id/run_id/task_kind/task_id）、
artifact path、`tree_sha256`、文件数、producer `git_sha` 与 `packet_sha256`。
`tree_sha256` 从排序的 POSIX 相对路径 + 每个文件的 SHA256 与字节大小计算。

三态状态跟踪：

```json
{
  "generation_status": "generated",
  "assembly_status": "not_run",
  "verification_status": "not_run"
}
```

"Mechanic generation **may set only generation status**.
Assembly alone sets `assembled`; execution/evaluation alone sets `verified`.
**Static generation or artifact-presence checks must not claim playability.**"

---

# Part V 与 VibeGame 的对照，及对本仓的对位

## 5.1 VibeGame vs GameFactory-3A：互补而非竞争

| 维度 | VibeGame | GameFactory-3A |
| --- | --- | --- |
| 解决的问题 | 2D 网页游戏从 0 到可玩的**端到端闭环**（含编排/验收/自进化） | **资产与引擎代码生成**（多引擎、多品类），不管编排与验收 |
| 强项 | 运行时控制 / 对抗式验收 / 自进化先验 / 失败记忆(errors.md) / 垂直深度 | 资产品类宽度 / 引擎覆盖 / 工程治理 / CG 视频 |
| 弱项 | 只做 2D / 单引擎 / 无 CG、无 3D、无商业引擎集成 | 不解决"从需求到可玩游戏的完整闭环"（缺 VibeGame 那种 agent 编排与验收） |
| 可组合性 | 作为**验收层/运行时层**接入 | 作为**资产生成层/引擎适配层**接入 |

**结论**：两者是**互补关系**。GameFactory-3A 的资产管线 + 引擎适配 +
VibeGame 的运行时控制/验收/自进化，理论上可以拼成一条更完整的"游戏生成"链路。
但现实中**两个项目的成熟度信号都很弱**（VibeGame 18 commits / 0 issues；
GameFactory-3A 虽 571★ 但无定量评估），组合价值取决于各自能否真正跑通。

## 5.2 与本仓（deepOrca）的对位

| 维度 | GameFactory-3A | 本仓现状 |
| --- | --- | --- |
| 资产生成 | 6 类（图片/3D 物体/3D 场景/动作/音频/CG 视频）+ 付费云 API + 本地兜底 | `imagegen` 技能存在；cad-3d 线走 img2threejs；**无 3D/动作/CG/音频管线** |
| 引擎适配 | 五引擎公开 Client + Adapter 层 | Electron 自有 harness；`browser.*` → vendored bsk；**无商业引擎集成** |
| 玩法/UI 生成 | Mechanic 契约 + UI 二段式（含 Browser Play）| 44 个 action 是开发工具（review/crg/design/task），**不是游戏逻辑单元** |
| 工程治理 | 路径唯一来源 + 运行不可变 + 三态状态 + CPU smoke | `specs/` 五区生命周期 + research 台账 + `file-history` git；**无产物不可变运行** |
| 验证 | "验证-游玩-迭代"是工作流第 5 步（强制），附 6 维评审表 | `review.full` 文本证据 + `design.audit` 确定性 + `prototype.verify` 重新计算式；**无游戏画面验证** |
| 付费 API 策略 | 6 步硬流程（暂停→发完整成本→等明确答复→环境变量→拒绝则兜底→报告缺口）| imagegen 技能有 provider 抽象；**无"先问再花"的 agent 纪律** |

---

# Part VI 可借鉴清单（只记发现，不给落地方案）

> 集成深度沿用标度：L0 = 知识/提示词层；L1 = 用户可选外挂；L2 = 内置能力；L3 = 源码级继承。
> **全部以 ∥ 状态记账，不排序、不启动、不另立 spec。**

| # | 发现 | 深度 | 为什么值得记 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | **"验证不是可选项"写进工作流**：第 5 步强制"构建→启动→真玩→录制→评审→修复→重复"，明确"能跑 ≠ 可玩"，附 6 维评审表（含"风格不对的干净画面也是失败"）| L0 | 对任何"AI 交付可运行物"都适用；本仓 review 只覆盖文本层 | `setting_overview.md` §Validate, play, and iterate |
| 2 | **付费 API 6 步硬流程**（暂停→一次性发推荐方+URL+当前定价+批量估算成本+请求购买→等明确答复→环境变量→拒绝则兜底→报告缺口）| L0 | 本仓 `imagegen` 与 designer 线都有调用付费模型的场景，**无此纪律** | `asset_qa/README.md` §Paid cloud backend |
| 3 | **Mechanic 契约 schema**：`state/events/commands/public_api_paths` 必须非空且代表真实生成行为；`UI → Mechanic → runtime` 依赖方向**禁止反向** | L0/L1 | "游戏逻辑怎么与 UI 解耦"被变成了可检查的契约；与本仓 A2UI 的"声明式交互层"正交 | `code_gen/mechanic/game_generation.md` |
| 4 | **Browser Play 二段式 + 硬边界**：原生 UI 与 browser 交付源分开；browser 端禁复制 HUD/消费 Mechanic 绑定/实现游戏命令/按引擎名分支 | L1 | 本仓 `renderer/a2ui/` 是声明式交互层，**无"web 预览怎么不污染游戏"的边界纪律** | `code_gen/ui/game_ui_generation.md` |
| 5 | **视觉 QA 的定义**："格式/结构检查回答不了的问题"（对称网格朝向、不可见重建是否可用、附着点、动画是否自然）→ 必须视觉模型或人审 | L0 | 本仓 `vision-mcp` 已有工具但**未定义"何时必须用视觉 QA"** | `asset_qa/README.md` |
| 6 | **三层单向依赖 + CPU smoke**：models→operators→pipeline 只向下依赖；无 GPU 即可验证输出布局 | L1 | 本仓 `packages/` 是 core→desktop 依赖，但**无"无重依赖即可验证接口契约"的 harness** | `develop_harness/README.md` |
| 7 | **路径唯一来源 + grep 门禁**：`paths.py` 是所有产物路径的唯一来源；`grep -rn "outputs/" operators/ models/` 必须为空 | L1 | 本仓 `pipeline/common/paths.py`(15.7KB) 的规模说明路径治理已复杂到需要它 | `develop_harness/README.md` |
| 8 | **运行不可变 + 三态状态**（generation/assembly/verification）+ `tree_sha256` + `parent_run_id`/`repair_of` | L1 | 本仓 session 索引有 debounce 一致性难题；**产物不可变运行**是另一条路 | `code_gen/mechanic/game_generation.md` §Run And Publication Contract |
| 9 | **引擎公开 Client 边界 + baseline 版本机制**：所有宿主侧操作走公开 Client；API 文档声明已验证基线版本 | L1/L2 | 本仓若未来接入商业引擎（用于游戏开发场景），此模式可直接参考 | `engine_context/engine_overview.md` |
| 10 | **Stop Conditions（7 条必须停下的违规）**：混引擎 API / UI 职责进 Mechanic / 玩法规则进 UI / 绕过公开 Client / Example 复制进项目 / 运行时未就绪就暴露 URL / 无证据就声称成功 | L0 | 作为"agent 代码生成的负面清单"可直接裁剪使用 | `engine_context/engine_overview.md` |
| 11 | **CG 视频导演子框架**：4 模式（t2va/fl2va/i2va/ref2va）+ 4 模板（开场/剧情/宣传片/大招）+ schemas/scripts | L1 | 本仓 `specs/next-version/content-to-video`（Remotion/Code2Video 预研）与**内容→视频**同构 | `agent_skills/asset_qa/cg_video/game-cg-director/` |
| 12 | **修复纪律**："symptom in the video → owning layer → fix → re-verified in a new recording"；**在归属层修，禁止在游戏玩法代码里修资产问题** | L0 | 本仓 review-fix 的 `review-fix.ts` 把发现变成 agent 提示，但**无"归属层"概念** | `setting_overview.md` §Validate, play, and iterate |
| 13 | **"资产决策策略"**：先生成（优先付费云 API）→ 生成质量不佳再用授权来源 → 都不行则**报告缺口而非静默降级** | L0 | 本仓 designer/cad-3d 线各有路线，**无"报告缺口而非静默降级"的纪律** | `setting_overview.md` §Asset decision policy |

---

# Part VII 风险与不跟进

## 7.1 风险

- **无定量评估**：中文 README 只有演示视频，**无任何成功率/质量基准数字**。
  571★ 与"3A"定位之间缺乏可验证的桥梁。
- **强依赖付费/本地大模型**：3D 物体（Tripo/Meshy）、图片（Seedream/Ark）、
  音频（Seed Audio）、CG 视频（Seedance/MiniMax）全部是付费或大模型；
  演示视频里的人物/动作大量来自 Mixamo 等开源资产（而非生成）。
  **"生成"二字的含金量需打折。**
- **演示视频 ≠ 可复现流程**：README 的演示是"最终效果"，
  缺失"从需求到该效果的完整可复现路径"。`test/` 目录存在但本次未跑。
- **Agent Skill 的"可执行性"未经第三方验证**：19+ 份 SKILL.md 是给 agent 的工作手册，
  其质量取决于"agent 读完能否真的产出合格资产"，本项目无公开的第三方复现报告。
- **Apache-2.0 干净可 vendor**，但**第三方引擎/模型/资产库各有自己的许可**，
  中文 README 明示"用于正式产品前请先确认对应提供方的授权条款"。
  CG 视频的模型（MiniMax H3、Seedance）权重许可未在 README 细说。

## 7.2 明确不跟进

- **商业引擎适配层（UE5/Unity/Godot）全套照搬**：本仓是 Electron 桌面应用，
  与游戏引擎无交集；仅取"公开 Client 边界 + baseline 版本"的接口设计思想。
- **3D / 动作 / 音频 / CG 视频管线全套照搬**：游戏垂直资产；
  本仓若不做游戏生成，无消费场景。仅取"付费 API 先问后花"与"视觉 QA 必须"的纪律。
- **付费云 API 全套接入**：Tripo/Meshy/Seedream/Ark/Seedance/MiniMax
  全部需要用户自费 + API key；与本仓"本地优先"的倾向相悖。
- **把 SKILL.md 当模板直接复用**：SKILL.md 是给 agent 看的"工作手册"，
  本仓的 skills 发现路径与提示词格式不同（本仓用 frontmatter + body），直接套用会水土不服。
- **CG 视频导演子框架**：与本仓 `content-to-video` 预研重叠，
  但本仓该 spec 已在储备区，**不因本项目存在而重启**。

---

## 结论

**GameFactory-3A 与 VibeGame 解决的是游戏生成链路上的不同环节**：

- VibeGame = **运行时/验收/编排层**（2D 垂直，深度优先；强在"agent 怎么验收自己做的游戏"）
- GameFactory-3A = **资产/引擎/工程治理层**（多引擎水平，宽度优先；强在"资产怎么跨引擎生成与隔离"）

**GameFactory-3A 的真正价值不在"能生成 3D 模型"（那主要是调用付费云 API），
而在它把"从需求到可玩游戏"这条链路上的工程治理**编码成了可执行的结构：
**验证-游玩-迭代是强制工作流第 5 步、Mechanic 契约把玩法与 UI 解耦、
付费 API 必须先问用户再花钱、运行不可变 + 三态状态、CPU smoke 即可验证管线契约。**

**最值钱的三条发现**（与 VibeGame 互补）：
1. **付费 API 6 步硬流程**（`asset_qa/README.md`）——本仓 `imagegen` 与 designer 线
   都调用付费模型，但无此纪律。
2. **"验证不是可选项"的 6 维评审表 + 修复纪律**（`setting_overview.md`）——
   "symptom in video → owning layer → fix → re-verified in new recording" 与 VibeGame 的
   "不算证据清单"是同一原则的两面。
3. **Mechanic 契约 schema + 依赖方向禁止反向**（`code_gen/mechanic/`）——
   把"游戏逻辑怎么与 UI 解耦"变成了可检查的契约。

**与 VibeGame 的组合价值**（仅作为观察，不作为方案）：
理论上，GameFactory-3A 的资产+引擎层 + VibeGame 的运行时+验收+自进化层
可以拼成一条更完整的"游戏生成"链路。但**两个项目的成熟度信号都很弱**
（VibeGame 18 commits / 0 issues；GameFactory-3A 571★ 但无定量评估、
演示视频 ≠ 可复现流程），组合价值取决于各自能否真正跑通。

**建议动作**：全部候选以 `∥` 状态记账于本文与 research 索引，不另立 spec、不启动代码。
本文是本次"游戏开发"调研的第二站；与 VibeGame 的两份报告合起来，
构成对本仓"若要做游戏生成"这一能力线的完整外部参照。
