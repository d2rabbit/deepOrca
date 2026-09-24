# 专题深化（第二轮）：游戏开发 —— 学术定量验证、3D 技能包与工作室治理，补全六项目全景

日期：2026-09-24 · 分支：`feat/modern-ui-redesign` · 性质：专题深化报告（无代码变更，不启动 spec）

> **总口径**：调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现；
> 正式实现一律以 `specs/` 为准。**本文不另立 spec、不启动代码、不给落地方案。**

## 定位声明（先读这个）

本文是 `gameStudio/` 档案的**第二轮专题报告**。它不是重做第一轮，而是把第一轮的
结论往前推三步。第一轮台账（全部在本档案内，本文不重复其内容）：

| 第一轮报告                                                                   | 层            | 一句话结论                                                                               |
| ---------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| [VibeGame 预研 09-03](./vibegame/2026-09-03-vibegame-prestudy.md)            | 机制层        | 证据协议 / VLM 门 / 先验蒸馏 / 数据驱动场景树，机制迁移为主                              |
| [VibeGame 深潜 09-15](./vibegame/2026-09-15-vibegame-game-dev-deepdive.md)   | 游戏开发层    | 价值重心从"多 agent"移到"约束设计"：四条产品约束 + errors.md 失败记忆 + placeholder 枢纽 |
| [GameFactory-3A 09-15](./gamefactory3a/2026-09-15-gamefactory3a-prestudy.md) | 资产/引擎宽度 | "验证不是可选项"6 维评审 + 付费 API 6 步 + Mechanic 契约 + 运行不可变                    |
| [Sprite Studio 09-15](./sprite-maker/2026-09-15-sprite-maker-prestudy.md)    | 2D 资产前段   | "AI 只画源画，绑定与动画必须确定性渲染"                                                  |
| [Aseprite 09-15](../2026-09-15-aseprite-asset-pipeline-prestudy.md)          | 素材加工导出  | 「加工→导出」段 100% 补齐；生产段另立调研；EULA 分发红线                                 |

第一轮的三段链（资产前段 → 资产+引擎 → 运行时/验收）**维持成立**，但只覆盖了
"端到端生成"这一种形态。本轮加入三个新对象 + 一次增量核对，回答三个升级问题：

| #   | 升级问题                                                                     | 新对象                                                            | 一句话答案（详见正文）                                                                              |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | 第一轮"约束设计/骨架库/失败记忆有价值"的判断，有**定量证据**吗？             | **OpenGame**（CUHK MMLab，arXiv 2604.18394，Apache-2.0，2955★）   | **有**：消融实验逐项量化了骨架库与活协议的独立贡献；且"框架 > 模型"                                 |
| 2   | 换到 **3D 网页游戏**（three.js）这个更宽的技术面，结论复现吗？               | **threejs-game-skills**（majidmanzarpour，MIT，2120★）            | **复现且工程化更深**：把"验证不是可选项"做成了四本账本 + 闭集跳过理由                               |
| 3   | **长周期人机协作开发**（非一次性生成、商业引擎、几周到几月）的治理长什么样？ | **Claude-Code-Game-Studios**（Donchitos，MIT，25384★，下称 CCGS） | 七阶段门禁 + 8 节 GDD + ADR/TR-ID + story 生命周期 + **技能测评框架**——第一轮全景完全缺失的"治理段" |
| 附  | VibeGame 自 09-15 后有架构变化吗？                                           | 增量核对（git log + 项目主页）                                    | 无架构变化；但主页揭示**出品方为南京大学模式识别实验室**，修正第一轮"独立项目"判断                  |

### 调研材料（全部一手）

| 对象                | 材料                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenGame            | `README.md` 全文、`agent-test/docs/debug_protocol.md` 全文、`agent-test/docs/asset_protocol.md` 全文、仓库结构（zread，22.5MB/TypeScript）、arXiv 2604.18394 **v2 HTML 全文**（评测数字、消融、GameCoder-27B 训练管线）、GitHub API 元数据 |
| threejs-game-skills | `README.md` 全文、`skills/threejs-game-director/SKILL.md` 全文（路由/账本/门禁核心）、仓库结构（9 技能目录）、GitHub API 元数据                                                                                                            |
| CCGS                | `README.md` 全文、`docs/WORKFLOW-GUIDE.md` 全文（七阶段管线）、`CCGS Skill Testing Framework/quality-rubric.md` 全文、仓库结构、GitHub API 元数据                                                                                          |
| VibeGame 增量       | GitHub API（250★）+ 2026-09-15 之后全部 6 条 commit + 项目主页 vibegame.tettet.org                                                                                                                                                         |

---

## TL;DR

| 层                 | 判断                                                                                                                                                                                                                                                                                           | 证据强度                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **定量验证**       | OpenGame 用 150 prompt 基准 + 消融证明：**骨架库（Template Skill）与活协议（Debug Skill）各自独立有效，合用最强**；全套框架 + Claude Sonnet 4.6 = 72.4/67.2/65.1（BH/VU/IA），超最强基线 Cursor+Claude +5.6/+5.8/+6.2；**专用模型 GameCoder-27B 的增益是增量的（62.8→63.9 BH），大头来自框架** | 论文级（含消融），但均为作者自评      |
| **复现性**         | threejs-game-skills 在 3D 网页域独立收敛到同一套纪律（证据链/门禁/评分卡/资产账本），且把 GameFactory 的"付费 API 先问"工程化为**凭证探测字面输出 + 五条闭集跳过理由**                                                                                                                         | 一手 SKILL.md 全文                    |
| **新大陆：治理段** | CCGS 证明"游戏开发 AI 化"还有第一种轮未覆盖的形态：**不是生成器，是流程治理**——七阶段门禁、8 节 GDD、ADR→control manifest→story 的引用链（"引 TR-ID 不引正文，保持新鲜"）、**人未玩即 FAIL 的 vertical slice 硬门**、以及**给技能本身定 PASS/FAIL 指标的技能测评框架**                         | 一手文档全文；25.4k★ 为本档案最高热度 |
| **谱系确认**       | VibeGame README 授勋名单里的 OpenGame 就是本轮对象——**OpenGame（2026-04，CUHK）→ VibeGame（2026-08，南京大学 PR Lab）** 的学术传导链成立；两者是同一命题（骨架库/失败记忆/运行时验证）的两个独立实现，VibeGame 增加了自进化与对抗评审                                                          | 双方 README 交叉                      |
| **天花板**         | 即便 SOTA 系统，**34.9% 的机械性需求仍未满足**；最弱在 puzzle/UI（52.6 IA）与 strategy（58.2）——"生成可玩游戏"远未解决                                                                                                                                                                         | 论文自报                              |

**一句话**：第二轮把第一轮的定性判断（约束设计 > agent 班底）升级成了
**带消融的定量结论（框架 > 模型）**，把"验证纪律"升级成了**可执行的账本与闭集规则**，
并补上了第一轮全景缺失的第三种形态——**面向长周期人机协作的流程治理（CCGS）**。

---

# Part I OpenGame：把第一轮的定性判断变成定量证据

## 1.1 基本盘与谱系

| 维度   | 事实（一手核证）                                                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 出品   | CUHK MMLab（Yilei Jiang 等 11 人，通讯 Xiangyu Yue），arXiv 2604.18394（v1 2026-04，v2 2026-09）                                                                                          |
| 定位   | "first open-source agentic framework explicitly designed for end-to-end web game creation"，从 prompt 到可玩网页游戏                                                                      |
| 运行时 | **qwen-code fork**（其自身承认为 qwen-code + Gemini CLI 架构的延伸；配置目录仍叫 `.qwen` 计划迁 `.opengame`）；headless 模式自动把审批级别升到 `auto-edit`，shell 默认关（`--yolo` 打开） |
| 热度   | 2955★ / 430 forks（2026-09-24 API），创建 2026-04-20，pushed 2026-09-03                                                                                                                   |
| 许可   | Apache-2.0                                                                                                                                                                                |
| 交付物 | CLI（`opengame -p "..." --yolo`）+ agent-test 全套技能资产 + 论文 + 6 个可玩 demo（含源码 zip）                                                                                           |

**谱系确认**：VibeGame README 的"授勋名单"（GameDevBench / **OpenGame** /
GameCraft-Bench / Trellis / agent-sprite-forge）中的 OpenGame 即本项目。
时间线：OpenGame 2026-04 发布 → VibeGame 2026-08 开源。两者共享同一命题——
**项目骨架库（对抗跨文件失配）+ 失败记忆协议（对抗集成错误）+ 运行时验证**，
VibeGame 在其上加了自进化四目的地与对抗式 reviewer。这解释了为什么第一轮在
VibeGame 里看到的机制"像学术系统"——它本来就是学术传导的下游。

## 1.2 Game Skill = Template Skill + Debug Skill

论文核心主张（README 摘要逐字）：

> "At its core lies **Game Skill**, a reusable, evolving capability composed of a
> _Template Skill_ that grows a library of project skeletons from experience and a
> _Debug Skill_ that maintains a living protocol of verified fixes—together enabling
> the agent to scaffold stable architectures and systematically repair integration
> errors rather than patch isolated syntax bugs."

两个组件对应第一轮档案里两件"最值钱单件"：

- **Template Skill ≈ VibeGame `skeletons/`**——但从"5 套自选骨架"升级为**从经验中长出的 5 个原型族（archetype family）**：重力侧视（gravity side-view）/ 俯视运动（top-down motion）/ 网格逻辑（grid logic）/ 路径与波次（path/wave，塔防）/ UI 驱动（UI-driven）。
- **Debug Skill ≈ VibeGame `errors.md`**——但从"按项目归档的失败记忆"升级为**跨项目维护的活协议（living protocol）**：每条 = （错误签名，根因，已验证修法），并附**预执行检查**（pre-execution checks，跑之前就能挡住的错，如资产 key 不匹配）。

**关键升级：分类学**。OpenGame 不按"游戏类型"（platformer/RPG/…）分类，而是
**"Physics-First Classification"——按物理/运动规则分类**（`classify-game-type`
工具）。重力侧视与俯视运动共享"刚体移动+碰撞"的物理形状，而 UI 驱动类没有物理
循环——物理形状决定骨架选型。这是一个可直接迁移的分类学原则。

## 1.3 六阶段工作流

| 阶段           | 内容                                                                                                                                                                         | 第一轮对应物                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1 分类         | `classify-game-type` 按**物理优先**选 5 原型族之一                                                                                                                           | VibeGame 无显式分类；本仓 SkillRouter 短名单同构                                                                |
| 2 脚手架 + GDD | 拷贝共享 core + `modules/<archetype>` + 该原型的 API 文档；`generate-gdd` 产**受原型 API 约束的技术型 GDD**；todo 清单按文件级跟踪                                           | VibeGame 的 prd→plan 四契约件；CCGS 的 8 节 GDD（见 Part III）                                                  |
| 3 资产合成     | `generate-game-assets`（背景/tileset/精灵动画/静态图/音频）；`generate-tilemap` ASCII 布局→Tiled JSON（47-tile blob 自动拼接）；**asset-pack.json 记录全部 key，防引用幻觉** | VibeGame 美术管线 16 动词；Sprite Studio rig 源画                                                               |
| 4 代码实现     | GDD 参数合并进 `gameConfig.json`；**三层阅读**（API 摘要 → 目标模板文件 → 实现指南）；**Template Method 模式**——agent 只覆写钩子（如 `setupCustomCollisions`）而非从零写     | VibeGame 模块 `this.config` 参数化同构                                                                          |
| 5 验证         | 读 `debug_protocol.md` 静态审查 → headless 跑 `npm run build`/`test` → 解析错误 → 迭代修复；Debug Skill 在此**累积**新条目                                                   | VibeGame "不算证据"清单 + bot 三件套（OpenGame 论文未覆盖 bot 自玩，验证以 headless 浏览器执行 + 错误解析为主） |
| 6 迭代         | 修复循环 T 次直到可玩                                                                                                                                                        | GameFactory "验证-游玩-迭代"第 5 步                                                                             |

## 1.4 Debug Protocol 深潜（`agent-test/docs/debug_protocol.md` 全文核证）

这份文档就是"活协议"的实例——**全部条目都是"AI 一定会犯、且犯了能在构建前挡住"的错**：

- **预构建清单（Pre-Build Verification Checklist）**：动画系统三层链
  （`asset-pack.json → animations.json → Character.ts animKeys`，逐层验证 key 存在）、
  配置键对齐、变量名一致性、瓦片图层名**大小写敏感**、TS `import { type X }` 规则、
  场景注册、UI-heavy 专属 ~30 条（如"覆写 `executeEnemyTurn()` 必须
  `completeEnemyTurn()` 否则游戏冻结"、"FloatingText 是静态类，禁止 `new`"）。
- **15 条快速验证命令**：全部是 grep 形态——"搜 `this.ultimate` 数赋值 vs 使用"、
  "搜 `createLayer("` 对比 tilemap JSON 图层名"、"搜 `override` 验证每个覆写
  方法在基类存在且可见性不收窄"。**把"审查"变成可机械复核的命令清单**。
- **FORBIDDEN 表**：`npm install`（依赖已装，浪费 30s+）/ `npm audit fix` /
  删 node_modules / 随机改码 / **前台跑 dev server（agent 失去终端控制，必须
  `is_background: true`）**——最后这条对任何长跑进程的 agent 纪律都成立。
- **诊断顺序**：`build → test → dev`（每阶段修完再进下一段）；错误模式→类别→修法
  对照表；"错误信息提到 FILE:LINE 就先去那里"。

与 VibeGame `errors.md` 的差别：**errors.md 是"症状→根因→修法→Spec update"的
叙事档案，debug_protocol 是把同类知识压成 checklist + grep 命令的操作协议**。
前者利于沉淀，后者利于执行。理想形态是两者互转（协议条目可追溯回案例）。

## 1.5 资产协议（`agent-test/docs/asset_protocol.md` 全文核证）

与 VibeGame `sprite.md`（第一轮"全文最硬的一手材料"）同族但**按原型分化**：

- **联合类型工具面**：一个 `generate_game_assets` 调用收 5 类资产
  （background 1536*1024 不抠背景 / tileset 3*3→自动扩 7*7 抠背景 /
  animation 386*560 / image 386*560 / audio WAV 8-bit chiptune——**ABC 记谱法 →
  symusic 合成**，音频零外部模型）。维度字符串强制 `*`不许`x`（API 会报错）。
- **按原型的角色图规则**：platformer=侧视朝右 2 帧；top_down=**三方向各 1 帧**
  且明文"方向覆盖优先于帧数（3 视角 × 1 帧 >> 1 视角 × 2 帧）"；tower_defense=
  俯视单方向 + 塔槽/弹道/障碍物/防御目标四类专用资产命名；ui_heavy=正面半身像
  **按表情拆分独立图**（`hero_neutral/happy/angry`）。
- **双 tileset 规则**：俯视 tilemap 类必须 `{theme}_floor` + `{theme}_walls` 两张
  （地板"纯色/极简——地板是背景，花哨会跟角色抢焦点"，墙体"与地板强对比"）；
  arena 模式则**禁止** tileset（用背景图）。
- **key 一致性链**（Common bug 的根治法）：`generate_game_assets.key →
generate_tilemap.tileset_key → asset-pack.json.key → 场景代码 addTilesetImage`
  四点一线，协议里画了完整链路图。
- **action_desc 质量表**：好/坏对照（"standing still, relaxed pose, holding weapon
  at side" vs "idle"）——与 VibeGame idle 四帧写法同族的 prompt 工程学。

## 1.6 OpenGame-Bench：第一轮判断的定量版

三指标（150 条多样 prompt，headless 浏览器执行 + VLM 评审，0-100 分）：
**BH**（Build Health，构建健康）/ **VU**（Visual Usability，视觉可用性）/
**IA**（Intent Alignment，意图对齐）。

| 系统                                                         | BH        | VU        | IA        |
| ------------------------------------------------------------ | --------- | --------- | --------- |
| 直连 LLM 最强（DeepSeek V3.2 / Claude Sonnet 4.6 / GPT-5.1） | 39.7–58.5 | 35.5–52.9 | 31.2–50.8 |
| Agentic 基线最强（**Cursor + Claude**）                      | 66.8      | 61.4      | 58.9      |
| **OpenGame + GameCoder-27B**                                 | 63.9      | 57.0      | 54.1      |
| **OpenGame + Claude Sonnet 4.6**                             | **72.4**  | **67.2**  | **65.1**  |

**消融（论文最有价值的一段，逐字引用数字）**：

| 配置                                | BH/VU/IA               |
| ----------------------------------- | ---------------------- |
| 静态骨架 + 静态 checklist           | 60.5 / 54.8 / 51.2     |
| 静态骨架 + 完整活协议               | 65.4 / 59.2 / 56.3     |
| 完整骨架库（5 族） + 静态 checklist | 66.3 / 60.7 / 57.9     |
| 完整骨架库 + 仅执行后修复           | 69.5 / 63.8 / 61.4     |
| **完整骨架库 + 完整活协议**         | **72.4 / 67.2 / 65.1** |

三条读数：

1. **骨架库与活协议各自独立有效且可加**（60.5 → 65.4 / → 66.3 → 72.4）。
   这把第一轮"骨架 + errors.md 是最值钱资产"的定性判断变成了**有消融支撑的
   定量结论**。
2. **框架 > 模型**：同一框架下 Claude Sonnet 4.6（72.4）> GameCoder-27B（63.9）；
   GameCoder 相对自家底座 Qwen-3.5-27B 的增益（62.8→63.9 BH）远小于框架增益
   （Qwen 裸 agent 62.8 → 全框架 63.9 仅计模型列；同框架换 Claude 直接 72.4）。
   论文自述大头来自框架。
3. **工作流消融**：去掉钩子驱动实现（hook-driven implementation）BH -10.1、
   IA -11.6；去掉三层阅读 IA -8.6。**调试迭代**：T=0 时 BH 58.4，收益集中在
   T=0→3，**T=5 后平台化**——修复循环该有预算上限。

**诚实的边界**：全套系统仍有 **34.9% 机械性需求未满足**；按类型强弱分明
（platformer IA 76.8 / top-down shooter 71.4 最强；puzzle/UI 52.6、strategy 58.2
最弱）。全部数字为作者自评，v2 论文含 150 prompt 集但评测管线"will be released
soon"（截至本调研时点仓库尚未带 Bench 执行代码）。

## 1.7 GameCoder-27B：专用模型是增量不是主角

三阶段训练（Qwen3.5-27B 底座）：① CPT（GitHub Phaser/JS/TS 游戏仓库+文档+教程）
② SFT（合成 QA：gpt-codex5.1 策题、minimax2.5 生成解答）③ RL（单文件玩法模块的
执行反馈 vs 单元测试）。**结论保守引用**：训练增益集中在 IA/VU（SFT 补 IA 最多、
RL 补 VU/IA），量级小于框架增益。对本仓的含义：\*\*DeepSeek 专属调优路线（模型画像

- 端点试探）与"技能/骨架/协议层投资"不冲突，后者的边际收益在论文口径下更大\*\*。

---

# Part II threejs-game-skills：3D 网页游戏的 director–specialist 与账本纪律

## 2.1 基本盘

| 维度 | 事实                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 出品 | Majid Manzarpour 个人，MIT，2120★ / 215 forks，创建 2026-06-14，pushed 2026-09-05                                                                                                                                                                                                                      |
| 形态 | **9 个自包含 agent 技能**（Codex / Claude Code 双宿主，`npx skills add` 安装），无运行时代码——技能即产品                                                                                                                                                                                               |
| 结构 | `threejs-game-director`（总路由）+ 8 个专家：gameplay-systems / aaa-graphics-builder / game-ui-designer / debug-profiler / qa-release / 3d-generator / image-generator / audio-generator；每个技能自带 SKILL.md + references + scripts + assets（**Vite+TS+Three.js 脚手架打包在 gameplay 技能内部**） |
| 实证 | 5 款可玩网页 demo（netlify 在线）+ 每技能打包脚本（如 `inspect-threejs-canvas.mjs` canvas 检查器）                                                                                                                                                                                                     |

与本档案既有对象的坐标：**它是"GameFactory-3A 的宽度纪律 × VibeGame 的网页运行时
× 纯技能形态"**——不自带引擎（直接用 Three.js 生态）、不带 agent 班底（宿主是
Codex/Claude）、把全部智能编码在 SKILL.md + 参考文件 + 打包脚本里。

## 2.2 四账本纪律（本文认为最有价值的单件）

director SKILL.md 的核心机制是**四本账本**，agent 必须边干边记、最终报告必须携带：

| 账本                               | 记什么                                                                                                                                         | 对抗什么               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Skill-loading ledger**           | 每个 sibling 技能 yes/no + 路径或失败原因                                                                                                      | 声称用了某技能但没读   |
| **Reference ledger**               | 每份阶段必读参考文件 yes/no + 路径或失败原因                                                                                                   | 跳过阶段前置知识       |
| **External asset sourcing ledger** | 凭证探测输出、七类资产面（hero/enemy/props/world/materials/GUI/audio）各自来源（procedural / image-gen / 3d-gen / hybrid）、生成产物或阻塞证据 | "生成了资产"的无据断言 |
| **Phase ledger**                   | 每阶段 pending/running/done/skipped + 证据；**"阶段完成 = 实现 + 验证证据"**                                                                   | 把"写了码"当"做完了"   |

配套硬规则：

- **参考文件是"阶段进入门"（phase-entry gates），不是可选阅读**："A phase cannot
  be marked `done` until its required references are loaded or the final answer
  explicitly reports the reference as unavailable and the phase as blocked/fallback."
- **凭证探测闭集**：`probe_asset_credentials.sh` 先 source 用户 shell 配置再打印
  `TRIPO_API_KEY=SET|MISSING` 三行**字面输出**；SKILL.md 明文
  **"`key unavailable` is not a valid skip reason unless this probe output is shown"**。
  跳过外部生成的合法理由只有五条（用户明确离线 / 探测输出 MISSING / 真实 API 错误
  附命令与报错 / 低价值重复面用程序化 / 已 2+ 分的面且账本解释了为何外生不会更好）。
  ——这是 GameFactory"付费 API 6 步硬流程"的**工程化落地版**，且更严：把"理由"
  做成了闭集 + 字面证据。
- **Premium Completion Rule**：premium/AAA 声明的完成判据是 10 类视觉记分卡
  **固定类目**（Art direction / Hero / Obstacles / Rewards / World / Materials /
  Lighting / VFX / UI/HUD / Performance evidence），**"Do not substitute a personal
  rubric"**（禁止自拟评分标准）；"截图被图元/平路/通用卡片主导 = 未完成"。
- **反幻觉措辞纪律**：Claude Compatibility Rule 定义 **invoked ≠ loaded**——
  "invoked 指 slash/工具技能调用发生；loaded 指 SKILL.md 或参考文件被读入上下文"，
  最终报告必须精确区分。这是对"声称读过"类幻觉的直接防御。
- **报告审计脚本**：`audit_reference_report.py --premium/--physics/--audio` 机检
  终报的必备章节，不过就退回补齐。

## 2.3 证据链（Expected Evidence）

README + SKILL.md 合并的证据清单：`npm run build` / 本地浏览器跑 / console 与
page error 检查 / Playwright 截图 / **canvas 非空像素检查** / 桌面+移动双视口 /
主操控路径交互检查 / 图形变更时性能快照 / UI 文本溢出-重叠-安全区-触控目标检查 /
premium 声明的记分卡 / 资产与音频来源账本。**与 VibeGame"不算证据"清单、
GameFactory"验证不是可选项"完全同源**——三种独立实现收敛到同一张证据清单，
且本项目把它变成了"最终报告必须携带"的格式。

---

# Part III CCGS：长周期人机协作的"工作室治理"层

## 3.1 基本盘

| 维度 | 事实                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 出品 | Donchitos 个人，MIT，**25384★ / 3622 forks**（本档案最高热度），创建 2026-02-12，pushed 2026-09-23，60 open issues                                                                        |
| 形态 | Claude Code **项目模板**（clone 即用）：49 agents + 73 skills（slash 命令）+ 12 hooks + 11 path-scoped rules + 41 文档模板                                                                |
| 定位 | **不是自动生成器**——"Turn Claude Code into a full game dev studio"；明文"Collaborative, Not Autonomous"（问题→选项→**用户拍板**→草稿→批准，写文件前问 "May I write this to [filepath]?"） |
| 引擎 | Godot 4 / Unity / UE5 三套专家 agent 集（15 个引擎子专家）；Windows/Git Bash 为主开发测试平台                                                                                             |

第一轮全景的空白：VibeGame / GameFactory / OpenGame 都是"一次 prompt → 生成可玩
物"；**没有一个回答"人 + AI 协作做几周到几月的真实游戏项目时，流程怎么治理"**。
CCGS 补的就是这一段——而且它对本仓的意义不在游戏域知识，在于**治理机制的纯度**：
全部机制（门禁/引用链/审计/测评）都不含游戏特有假设，可直接对照本仓的
specs/任务树/技能体系。

## 3.2 三层层级与冲突上交

Tier 1 导演（**Opus 档**）：creative-director / technical-director / producer；
Tier 2 部门主笔（Sonnet）：game-designer / lead-programmer / art-director 等 9 人；
Tier 3 专家（Sonnet/Haiku）：含 15 个引擎子专家。协调规则：纵向委派不跳层、
横向只能咨询不能跨域拍板、**冲突上交给共同父节点**（设计冲突→CD、技术冲突→TD、
范围冲突→producer）。**按模型档位分配角色**（导演用 Opus、专家用 Haiku）是
多 agent 成本分层的直白示范。

## 3.3 七阶段管线与门禁

Concept → Systems Design → Technical Setup → Pre-Production → Production →
Polish → Release。每阶段一个 `/gate-check <phase>`，裁决三值
**PASS / CONCERNS / FAIL**（CONCERNS = 带已知风险放行）；**`production/stage.txt`
只在 gate 通过时才写**（状态推进不靠自觉）。审阅强度三档 full/lean/solo
（solo 连导演评审都不开，供 jam/原型），单次可 `--review` 覆盖。

各阶段的关键设计（只列对本仓有对位价值的）：

- **Concept**：`/brainstorm` 6 相构思（10 个概念种子带 MDA 分析 → 选 2-3 深挖 →
  玩家动机映射 → 概念文档含 **pillars 与 anti-pillars**（"有意不做什么"）；
  `/setup-engine` **检测"引擎版本比 LLM 训练数据新"的知识缺口**并落版本钉住的
  engine-reference 文档；`/map-systems` 产 systems-index（全系统+依赖+优先级分层
  MVP/Vertical Slice/Alpha/Full Vision）——其文档引用"155 份游戏 postmortem 研究
  证实跳过系统枚举的返工成本 5-10 倍"。
- **Systems Design**：`/design-system` **逐节创作 8 节 GDD**——Overview / Player
  Fantasy / Detailed Rules / **Formulas（每个公式带变量定义与取值域）** / **Edge
  Cases（每个怪情况显式裁决）** / Dependencies（双向） / **Tuning Knobs（哪些值
  设计师可安全调 + 安全区间）** / Acceptance Criteria（可测）——外加 Game Feel 节
  （输入响应 ms/帧、动画 startup/active/recovery、打击感时刻）。**每节批准后立即
  写盘**（崩溃/压缩后已完成节不丢）。`/review-all-gdds` 两阶段交叉评审：
  一致性（依赖双向性/规则矛盾/陈旧引用/所有权冲突/公式值域衔接）+ **设计理论
  holism**（竞争性成长环/活跃系统认知负载 >4/支配策略/经济源汇平衡/难度曲线
  一致性/pillar 对齐）。
- **Technical Setup**：ADR 生命周期（Proposed→Accepted→Superseded，≥3 个地基 ADR）
  - **TR-ID 注册表** + `/create-control-manifest`（把 Accepted ADR 压成
    Required/Forbidden/Guardrails 的**扁平程序员规则表**；story 内嵌 manifest
    版本日期以检测过期）。`retrofit` 模式：对既有文档**只补缺失节、绝不重写**
    （MIGRATION not REPLACEMENT）。
- **Pre-Production**：UX 规格（读 Phase 3 的无障碍等级与输入配置，**不逐屏重复
  声明**）；**vertical slice 硬门**——"人未引导地玩过至少 3 局，`/gate-check`
  自动 FAIL"；裁决 PROCEED/PIVOT/KILL。`/create-stories` 产 story 时**引 GDD 的
  TR-ID 而非引文**（"stays fresh"——GDD 改了 story 不会携带陈旧文本）、只引
  Accepted ADR（Proposed 则 story 置 Blocked）。
- **Production**：story 生命周期 readiness→implement→`/story-done` 8 相完成评审
  （验收核验→GDD/ADR 偏差分 BLOCKING/ADVISORY/OUT-OF-SCOPE→代码评审→完成报告→
  状态回写→**自动浮出下一条 READY story**）；`/propagate-design-change` 对 GDD
  git-diff → 找受影响 ADR → 影响报告；tech debt 发现入登记表。
- **Polish/Release**：3 份 playtest 报告（新玩家/中期/难度曲线）为硬门；
  `/launch-checklist` 13 部门逐项 Go/No-Go；`/patch-notes` 把开发者语言翻译成
  玩家语言。

## 3.4 12 hooks + path-scoped rules（治理的执行面）

hooks：`validate-commit`（硬编码值/TODO 格式/JSON 合法性/设计文档章节）、
`validate-push`（保护分支告警）、`validate-assets`（资产命名）、
`session-start`（分支+近期 commit+**检测 active.md 供恢复**）、`detect-gaps`
（空项目→建议 `/start`；**有代码没设计文档→告警**）、`pre/post-compact`
（压缩前把状态倾入对话/压缩后提醒从 active.md 恢复）、`session-stop`
（归档 active.md 入会话日志）、`log-agent(-stop)`（**子 agent 调用审计轨迹**）、
`validate-skill-change`（改了 `.claude/skills/` 就提示跑 `/skill-test`）。

path-scoped rules（11 条按路径生效的编码标准）：`src/gameplay/**`=
数据驱动/增量时间/禁 UI 引用；`src/core/**`=**热路径零分配**/线程安全/API 稳定；
`src/networking/**`=服务器权威/消息带版本/安全；`src/ui/**`=**不拥有游戏状态**/
本地化就绪/无障碍；`design/gdd/**`=8 节齐+公式格式+边界情况；
`prototypes/**`=**放宽标准但必须 README + 假设记录**。

## 3.5 技能测评框架：给"技能本身"定 PASS/FAIL（对本仓最锋利的一段）

`CCGS Skill Testing Framework/` 里的 `quality-rubric.md` 定义了 **7 类技能 × 4-5 条
二元指标**的测评标准，由 `/skill-test <category>` 执行：

- `gate` 类 5 条（G1 读 review-mode 再决定评审班底 … G5 **无用户确认绝不写
  stage.txt**）；
- `review` 类 5 条（只读强制 / 8 节全查 / **裁决词汇表精确三值** / 分析期禁导演
  门 / 结构化发现表先行）；
- `authoring` 类 5 条（逐节循环 / 每节 May-I-write / retrofit 检测 / 正确档位门 /
  **骨架先行防中断丢稿**）；
- `team` 类 5 条（点名 agent 清单 / **无依赖即并行** / BLOCKED 立即浮出**绝不静默
  跳过** / 收齐全部裁决再进依赖阶段 / 缺参给用法并停）；
- 另有 readiness/pipeline/analysis/sprint/utility 类与 **6 类 agent 指标**
  （director 四条含"Opus 档位核对"；engine 专家三条含"引用 engine-reference 版本、
  标注训练截止后风险"）。

**PASS = 指令清晰满足判据；FAIL = 指令缺失/含糊/自相矛盾；WARN = 部分满足**。
这是"**用一套二元指标测提示词资产本身质量**"的完整实例——与本仓
skill-eval / skill-up CI 是同一命题的独立实现，且**指标写法**（每条都是
"指令必须做到 X"的可判定陈述）可直接参照。

---

# Part IV VibeGame 增量核对（2026-09-15 之后）

- 热度 238→**250★**，0 open issues；commit 增量仅 6 条：README 快速上手、
  dashboard 修复 ×2、artist 图像模型扩充、**agent reasoning effort 配置化
  （含 gpt-6-astra）**、微信群二维码。**无架构变化**——两份既有报告的全部结论
  维持有效。
- 项目主页新信息一条：**出品方为南京大学模式识别实验室（Pattern Recognition
  Laboratory, Nanjing University）**。这修正 09-03 报告"独立项目"的判断，并同时
  解释了 09-15 报告风险节记录的"18 commits 却有高密度沉淀物"疑点——**研究团队
  内部系统沉淀后一次性开源**是最合理解释。VibeGame 与 OpenGame（CUHK）构成
  **两个学术组对同一命题的独立实现**，本档案的跨项目一致性结论因此更强。

---

# Part V 六项目全景：第二轮合流图

```
        一次性生成（prompt → 可玩物）                          长周期协作（周/月尺度）
 ┌──────────────────────────────────────────────────────┐  ┌───────────────────────┐
 │ 资产前段        资产+引擎宽度        运行时/验收/自进化  │  │ 流程治理/门禁/story    │
 │ Sprite Studio  GameFactory-3A      VibeGame           │  │ CCGS                  │
 │ (2D 像素确定性) (UE5/Unity/Godot/   (Phaser 数据驱动    │  │ (49 agents + 73 skills│
 │                three.js/Blender)    + bot + VLM 门)    │  │  + 12 hooks + gates)  │
 │      OpenGame：学术骨架库+活协议+定量基准（2D 网页）      │  │                       │
 │      threejs-game-skills：3D 网页 director+账本纪律     │  │                       │
 └──────────────────────────────────────────────────────┘  └───────────────────────┘
   Aseprite（素材加工/导出段，2D 侧横切）
```

### 六条产业趋同（三个新项目与第一轮的收敛点）

| #   | 趋同点                                               | 第一轮实例                                       | 第二轮实例                                                                                               |
| --- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | **证据协议**："能跑≠可玩"，完成=实现+验证证据        | VibeGame "不算证据"四反例 / GameFactory 6 维评审 | threejs-skills 证据链清单 + 记分卡 / OpenGame BH 用 headless 执行定义 / CCGS vertical slice 人玩硬门     |
| 2   | **失败记忆**：错误签名→根因→已验证修法，跨项目活协议 | VibeGame errors.md（Spec update 闭环）           | OpenGame Debug Skill 活协议（消融证明其独立贡献 +4~6 分）                                                |
| 3   | **骨架/模板库**：按"物理/能力形状"分类的可运行基线   | VibeGame skeletons 5 套 / macrostructures        | OpenGame 5 原型族（物理优先分类）+ 消融（+6 分）                                                         |
| 4   | **账本与闭集纪律**：跳过/声称必须有字面证据          | GameFactory 付费 API 6 步                        | threejs-skills 四账本 + 凭证探测字面输出 + 5 条闭集跳过理由 + invoked≠loaded                             |
| 5   | **资产 key 一致性链与按视图分化的生成规则**          | VibeGame sprite.md / Sprite Studio rig 契约      | OpenGame asset_protocol 四点一线 key 链 + 三方向覆盖优先于帧数                                           |
| 6   | **框架 > 模型**：能力投资在技能/骨架/协议层边际更大  | （第一轮为定性猜测）                             | OpenGame 消融定量（GameCoder 增量 1.1 分 vs 框架 +9.6 分）；threejs-skills 宿主无关（Codex/Claude 通吃） |

---

# Part VI 对照本仓（更新版对位）

## 6.1 第二轮新增的对位（第一轮对位表见 09-15 深潜 Part V，不重复）

| 外部机制                                                     | 本仓对应物                                                                           | 差距判断                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| OpenGame 三层阅读（API 摘要→模板文件→实现指南）              | SkillRouter G1 短名单 + skills XML 注入                                              | **同构已实现**；OpenGame 消融（去三层阅读 IA -8.6）反过来为本仓路由线提供定量论据                           |
| OpenGame Debug Skill 活协议（签名/根因/修法 + 预执行检查）   | `memory.audit`（失败学习）+ `skill-up`（蒸馏）+ repair-rule-memory（EMG 线，已收官） | **机制已备、形态不同**：本仓缺"checklist + grep 命令"形态的可执行协议层（知识在叙事档案里，不在执行路径上） |
| OpenGame 5 原型族物理优先分类                                | 无游戏域对应物；routing 的分类学思想同源                                             | 游戏域空白（与第一轮结论一致，新增的是"分类学按物理形状不按题材"这条原则本身）                              |
| threejs-skills 四账本 + 闭集跳过理由                         | review 工作流 + 权限链                                                               | **缺账本形态**："最终报告必须携带字面探测输出 + 逐项 yes/no 账本"是 prompt 层可零成本移植的纪律             |
| threejs-skills invoked≠loaded 措辞纪律                       | 无对应物                                                                             | 对"声称读过 X"类幻觉的直白防御，技能文档措辞层可借鉴                                                        |
| CCGS gate 三值裁决 + stage.txt 只在通过时写                  | specs 五区生命周期 + 任务树                                                          | 同构；CCGS 的"CONCERNS=带风险放行"三值比本仓二值更细                                                        |
| CCGS story 引 TR-ID 不引正文                                 | 任务树 artifactRefs/memoryRefs                                                       | **本仓已有等价物**（引用不复制）；CCGS 加了"manifest 版本日期检测过期"这一层                                |
| CCGS 技能测评框架（7 类 × 4-5 条二元指标）                   | skill-eval（8 包 14 用例）+ skill-up CI                                              | **同命题独立实现**；CCGS 的"指标=指令必须做到 X 的可判定陈述"写法 + WARN 中间态可直接对照补强本仓评测标准   |
| CCGS 引擎版本知识缺口检测（引擎比训练数据新→钉版本参考文档） | 模型画像/端点试探（模型域同构）                                                      | 本仓在**模型域**已做（模型厂商画像 spec），在**外部工具版本域**无对应物                                     |
| CCGS pre/post-compact + active.md 上下文韧性                 | compaction ladder + 任务树快照                                                       | 同构；CCGS "每节批准即写盘"是更激进的崩溃生存策略                                                           |
| OpenGame 修复迭代 T=5 平台化                                 | review-fix 循环                                                                      | 无预算上限对应物；"迭代收益 T=0→3 集中、T=5 平台"是设置上限的实证依据                                       |

## 6.2 本仓仍缺的三层（第一轮结论 + 第二轮修正）

第一轮：①可运行物基线 ②玩法设计知识 ③为 AI 生成物设计的声明式约束。
第二轮修正：**①③的 ROI 现在有消融数字背书**（OpenGame：骨架库+活协议合计
+12 分 BH，最大单项增益）；②新增"分类学原则"细节（物理优先）。治理段（CCGS）
暴露的是**另一个维度**的空白——不是资产而是**流程纯度**：本仓 specs/任务树/
评测已有骨架，缺的是"技能资产本身的质量二元指标"（CCGS quality-rubric 形态）。

## 6.3 本仓已更强、不需要对位的部分（增量）

- **语义路由**：OpenGame 三层阅读是固定顺序读文件；本仓 G1/G2/G3 是按需检索。
- **失败→修复记忆闭环**：repair-rule-memory（EMG）已真机收官，比三方"协议文档"更进一步（可检索注入）。
- **规格生命周期**：五区 + git mv 强制比 CCGS 的 stage.txt 单文件状态更完整（但其三值裁决更细）。

---

# Part VII 可借鉴清单（只记发现，全部 ∥ 观察记账）

> 集成深度标度：L0 = 知识/提示词层；L1 = 用户可选外挂；L2 = 内置能力；L3 = 源码级继承。

| #   | 发现                                                                                                                                                       | 深度  | 为什么值得记                                                                                                                        | 证据                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | **OpenGame 消融数字**：骨架库与活协议独立有效且可加（60.5→72.4）；框架增益 > 专用模型增益（+9.6 vs +1.1 BH）；钩子驱动实现去掉 BH -10.1                    | L0    | 本档案第一轮全部定性判断的**定量背书**；也是"投资技能/骨架/协议层 > 换更强模型"论据，可直接引用于 skill-eval/routing 线的 spec 讨论 | arXiv 2604.18394 v2 消融表        |
| 2   | **物理优先分类学**：按物理/运动规则（重力侧视/俯视/网格/波次/UI 驱动）而非题材分类骨架                                                                     | L0    | 任何"给生成物选基线"的场景（含非游戏：原型/设计稿）都适用"按结构形状分类"原则                                                       | `classify-game-type` + 论文       |
| 3   | **活协议双形态**：errors.md 叙事档案（沉淀）+ debug_protocol checklist/grep 命令（执行）；15 条 grep 验证命令把审查变成机械复核                            | L0/L1 | 本仓 memory/skill-up 产出的知识是叙事态；"可 grep 的操作协议"是缺失的执行态形态                                                     | OpenGame `debug_protocol.md`      |
| 4   | **修复迭代预算**：T=0→3 收益最陡，T=5 平台化                                                                                                               | L0    | review-fix / 任何纠错循环设上限的实证依据                                                                                           | 论文 debug iterations 消融        |
| 5   | **四账本纪律**（skill-loading / reference / asset-sourcing / phase）+ "阶段完成=实现+验证证据"                                                             | L0    | prompt 层零成本移植；对任何多技能协作的最终报告格式都适用                                                                           | threejs-director SKILL.md         |
| 6   | **凭证探测字面输出 + 闭集跳过理由**：`key unavailable` 不是合法跳过理由，除非贴出探测输出；跳过理由闭集 5 条                                               | L0    | GameFactory 6 步流程的工程化完成态；本仓 imagegen/designer 调付费模型即适用                                                         | 同上 External Asset Sourcing Gate |
| 7   | **invoked ≠ loaded 措辞纪律**：报告必须区分"技能被调用"与"SKILL.md 被读入"                                                                                 | L0    | 反"声称读过"幻觉的直白防御                                                                                                          | 同上 Claude Compatibility Rule    |
| 8   | **固定类目记分卡 + "禁止自拟 rubric"**：10 类视觉记分卡为 premium 完成的硬判据；图元主导的截图=未完成                                                      | L0    | taste 三轴机检的"类目固定"原则互证；记分卡类目可对照补强 design.audit 输出面                                                        | 同上 Premium Completion Rule      |
| 9   | **报告审计脚本**（audit_reference_report.py --premium/--physics/--audio 机检终报章节）                                                                     | L1    | "报告本身也要过门"的第二层验证；本仓 review 产出的报告无自检                                                                        | threejs-skills scripts/           |
| 10  | **三值门禁裁决**（PASS/CONCERNS/FAIL）+ stage 只在通过时写 + 审阅强度三档 full/lean/solo 可单次覆盖                                                        | L0    | CONCERNS=带已知风险放行，比二值更诚实；档位思想与本仓 depth-lane 同构                                                               | CCGS `/gate-check`                |
| 11  | **GDD 8 节结构**，尤其 Formulas（公式+变量域）/ Edge Cases（显式裁决）/ Tuning Knobs（可调值+安全区间）/ Game Feel（输入响应 ms、startup/active/recovery） | L0    | "意图与制作分层"的表格化完成态（VibeGame 同原则的文档结构版）；**逐节批准即写盘**防丢稿                                             | CCGS `/design-system`             |
| 12  | **交叉评审两阶段**：一致性（依赖双向/公式值域衔接/所有权）+ 设计理论 holism（竞争成长环/认知负载>4/支配策略/经济源汇）                                     | L0    | review 动作可对照的"评审维度目录"；holism 清单是"多个生成物互审"的维度库                                                            | CCGS `/review-all-gdds`           |
| 13  | **引用不引文**：story 引 TR-ID / ADR 只引 Accepted / 内嵌 manifest 版本日期检测过期                                                                        | L0    | 任务树 artifactRefs 已同构；"版本日期检测陈旧"是增量                                                                                | CCGS `/create-stories`            |
| 14  | **人玩硬门**：vertical slice "人未引导玩 3 局即自动 FAIL"                                                                                                  | L0    | "可运行物必须有人玩证据"的最硬表述；与 VibeGame 证据协议同源                                                                        | CCGS Phase 4 gate                 |
| 15  | **技能测评框架**：7 类技能 × 4-5 条二元指标（PASS/FAIL/WARN）+ 6 类 agent 指标（含模型档位核对、引擎版本风险标注）                                         | L0/L1 | 与 skill-eval 同命题；**指标写法**（"指令必须做到 X"的可判定陈述）与 WARN 中间态可直接对照补强                                      | CCGS quality-rubric.md            |
| 16  | **引擎/工具版本知识缺口检测**：版本比训练数据新→落版本钉住的参考文档并标注风险                                                                             | L0    | 本仓模型画像的同构物在"外部工具版本域"；vendored 工具（uv/CRG/Serena）升级场景适用                                                  | CCGS `/setup-engine`              |
| 17  | **上下文韧性三件套**：active.md 活检查点 + pre/post-compact 钩子 + 逐节写盘                                                                                | L0    | compaction ladder 的流程层补丁；"压缩前把状态倾入对话"本仓无对应钩子                                                                | CCGS hooks                        |
| 18  | **path-scoped rules**：按路径注入编码标准（gameplay=数据驱动/禁 UI 引用；core=热路径零分配；ui=不拥有状态；prototypes=放宽+README+假设）                   | L0    | 与本仓 AGENTS.md 分层同构；"prototypes 放宽但必须记录假设"是好设计                                                                  | CCGS rules/                       |
| 19  | **资产协议的按视图分化规则**：top-down 三方向各 1 帧 > 单方向多帧；ui_heavy 按表情拆独立图；地板极简/墙体强对比双 tileset                                  | L0    | 与 VibeGame sprite.md 合并为"生成资产规则库"的双源；方向覆盖>帧数是反直觉经验                                                       | OpenGame asset_protocol.md        |
| 20  | **ABC 记谱法→symusic→WAV 本地音频合成**（零外部模型出 8-bit chiptune）                                                                                     | L1    | 音频生成的零依赖本地兜底路线；与"本地优先"契合                                                                                      | OpenGame asset_pipeline           |
| 21  | **`npm run dev` 永远后台跑**（agent 失去终端控制=事故）+ FORBIDDEN 表（禁 npm install/随机改码）                                                           | L0    | 对本仓后台任务规范的一行印证                                                                                                        | OpenGame debug_protocol §1        |

---

# Part VIII 风险与不跟进

## 8.1 风险

- **OpenGame 数字全部为作者自评**，Bench 执行代码"即将发布"（仓库尚无）；150
  prompt 集的构成不可复核；VLM 评审判定的稳定性未公开细节。
- **OpenGame 覆盖面窄**：2D 网页（Phaser 为主）+ 三引擎内含 three.js 模板；无 3A、
  无商业引擎、无桌面包体。
- **CCGS 是提示词资产，无运行时验证**：49 agents/73 skills 的实际效果依赖宿主
  模型；25.4k★ 反映的是模板热度而非已验证产出（其 README 无一款完整游戏实证）。
- **threejs-game-skills 单作者**，5 demo 为自报；技能质量依赖 Tripo/Gemini/
  ElevenLabs 可用性（无 key 时回退程序化资产，premium 声明打折）。
- **三方均为 2026 年新项目**（2-6 月创建），快速演化中；本快照 2026-09-24。
- 谱系重叠提醒：OpenGame 与 VibeGame 的机制高度同源，引用"两个独立实现互证"
  时应注明两者存在传导关系（VibeGame 授勋 OpenGame）。

## 8.2 明确不跟进

- **GameCoder-27B 模型线**：训练/部署成本高、论文自证增益为增量级；本仓
  DeepSeek 专属调优路线不因它改变优先级。
- **CCGS 全套 49 agents 照搬**：本仓 runSubagent/defineAction + depth-lane 已有
  等价骨架；CCGS 价值在治理机制纯度，不在班底规模。
- **OpenGame 的 qwen-code fork 运行时**：本仓自有 harness，换运行时零收益。
- **threejs-game-skills 的 Tripo/Gemini/ElevenLabs 商用 API 接入**：与本仓
  "本地优先 + 付费先问"既有倾向的关系已被账本纪律覆盖，不需要接其 SDK 层。
- **任何形式的代码 vendor**：三方均 MIT/Apache 干净，但本档案两轮结论一致——
  **价值在机制与纪律层，不在代码层**。

---

## 结论

第二轮把游戏开发专题从"三项目三段链"推进成"六项目三形态"全景：

- **生成形态**（prompt→可玩物）：Sprite Studio / GameFactory-3A / VibeGame /
  threejs-game-skills，按 2D 像素→多引擎→2D 网页运行时→3D 网页排开；
- **学术形态**：OpenGame 把第一轮全部定性判断（骨架库、失败记忆、验证纪律）
  变成**带消融的定量结论**，并给出"框架 > 模型"的最强论据；
- **治理形态**：CCGS 补上"长周期人机协作"这段空白，其门禁/引用链/上下文韧性/
  **技能测评框架**与本仓 specs/任务树/skill-eval 高度对位——是六项目中
  **对本仓既有能力线参照价值最高**的一个（其余五个的增量在游戏域知识，
  CCGS 的增量在治理机制纯度）。

第一轮的总结论（本仓缺可运行基线/玩法设计知识/声明式约束三层）**维持不变**，
但其中前两层的投资优先级获得了 OpenGame 消融数字的支撑；新增的第四个差距是
**"知识资产的执行态形态"**——本仓的失败记忆与先验在叙事档案里，三个新项目
共同指向"checklist + grep 命令 + 账本"这种**长在执行路径上**的形态。

**建议动作**：全部候选以 ∥ 状态记账于本文与 gameStudio/README.md，不另立 spec、
不启动代码。若未来游戏能力线立项，本文与第一轮五份报告共同构成完整外部参照系；
其中 CCGS 治理机制与 threejs-skills 账本纪律两条，对本仓**非游戏线**
（review/skill-eval/任务树）同样成立，可在对应 spec 修订时直接回引。
