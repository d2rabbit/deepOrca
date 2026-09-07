# 预研：tettethu/VibeGame —— Prompt-to-Game AI 原生工具链对本仓游戏层面的启示

日期：2026-09-03 · 分支：`feat/modern-ui-redesign` · 性质：预研（无代码变更）

## 定位声明（先读这个）

本仓"游戏层面"现状只有一项已立项物件：**Orca Pet 桌宠**
（`specs/next-version/desktop-pet/design.md`，2026-08-16 调研定稿、未实现）——定位
"锦上添花"、**铁律是 core 零改动、交互边界写死、明确不做小游戏**。VibeGame 与桌宠
不是同量级的直接实现对象；它是一整套 **"自然语言 → 可玩 2D 网页游戏"的垂直 harness**
（自己造 AI 原生引擎 + 自进化对抗式 agent 团队 + 美术/音频管线 + bot 自动化验收）。
对本仓的价值分两层：①桌宠（及未来一切"可玩层"）的宏观参考与机制迁移源；②若本仓
将来把"生成可玩游戏"作为能力线（A2UI 是"网页 UI 全域动态化"，VibeGame 是"游戏
运行时数据驱动化"，二者思路同构），本文就是该能力的全景预研。

## 命题映射

| 模块线 | 仓库 | 在本线中的角色 |
| --- | --- | --- |
| 游戏层（桌宠 Orca Pet 及未来可玩能力） | tettethu/VibeGame | 端到端参照：agent 编排 / AI 原生引擎 / 美术管线 / 自进化 / 对抗式评审 / bot 证据协议 |
| 技能自进化线 | 同上 | 其 self-evolve（项目 → 骨架/模块/契约/错误四目的地提升）与本仓 skill-up / book-distill / hallmark 宏结构线同思路，是第二独立实现 |
| 视觉验收线 | 同上 | 其 VLM 独立视觉门 + rastermap 脚对齐，与本仓 review 模块（OCR/CRG）与 designer taste 三轴机检形成"主观像素/确定性规则"对照 |

调研材料：`README.md` 全文、`config/context.json`（角色→注入文件映射）、`src/CLAUDE.md`
（引擎词汇表与工作流约定）、`src/agents/reviewer.md` 全文（对抗式终审 + 证据协议）、
`src/skills/self-evolve/SKILL.md` 全文（自进化四目的地与门槛）、`docs/IMAGEGEN.md`
（图片 provider 扩展 API）、仓库目录结构（zread 一手核证）；GitHub API（热度/许可）。
本仓侧依据 `specs/next-version/desktop-pet/design.md` 与既有台账（skill-up、hallmark、
A2UI、cad-3d）。

## TL;DR

| 项目 | 本质 | 成熟度 / 许可 | 建议继承方式 | 集成深度 | 与现有冲突 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| tettethu/VibeGame | "Vibe Your Dream Game"：Claude Code / Codex 驱动的多 agent 游戏开发 harness。自研 Phaser 3 CE 之上的 AI 原生引擎（数据驱动场景树 scene.json/node.json，内容即配置）；agent 团队（常驻 designer/artist/reviewer + 每任务 architect/programmer/auditor/player）；Python 美术管线（t2i/i2i 多 provider 抽象、抠图、切帧、spritesheet、像素归一）；自进化（骨架/模块/契约/错误四目的地）；bot 自动化验收 + VLM 独立视觉门 | 新项目：189★（2026-08-12 创建，2026-08 发布，10 天前最后 push），11 forks，0 issues；9 款跨类型 demo（HK 冲刺/拳皇式/roguelike/水果忍者/空洞骑士 boss slice 等）；**Apache-2.0**（GitHub API 确认；README 附一条非约束性"商用部署通知"请求，明示不要求批准/不收费/不改动 Apache 权利） | 机制与模式移植为主（Phaser/Claude Code 栈与本仓 Electron/TS 不同；但其 JS 引擎与 TS renderer 同为 ES 生态）；Agent Skill 方言（`.claude/agents` 式）与本仓 skills 发现路径天然兼容 | **L0 为主 + 概念性 L3 模式移植**（先验蒸馏分类法、数据驱动节点/场景、bot 证据协议、VLM 验收分离、静态 self-check） | 与本仓桌宠线"不做小游戏"边界冲突仅存在于**立意层面**——VibeGame 是"整条游戏生成工具链"，桌宠是"陪伴装饰"；不冲突的用法是将其当宏观参照与机制迁移源 | **重点参考 + 桌面宠物规格修订与"未来游戏生成能力"双读**：桌宠 §五（资产管线）与 §八（验收）可直接吸收其 VLM 校验与静态检查思路；若未来立项游戏生成能力，本文作为全景预研底座 |

集成深度定义（沿用 2026-08-17 prestudy）：L0 = 知识/提示词层；L1 = 用户可选外挂；
L2 = 内置 builtin；L3 = 源码级继承（移植模式或引纯函数库）。

**许可红线（一条过）**：Apache-2.0 干净可 vendor（保留 NOTICE/版权声明即可），是
继 MIT（DeepCode）之后又一个无合规障碍的外部参考；其"商用部署通知"是软性请求、
README 自证不构成义务。代码本体基于 Phaser 3（MIT）与 Python，无 GPL 传染。

---

# Part I VibeGame 是什么

## 1.1 基本盘与结构

| 维度 | 事实（一手核证） |
| --- | --- |
| 出品方 | tettethu（独立项目，2026-08 发布 technical report + 开源 Phaser 实现） |
| 定位 | Prompt-to-Game Development with AI-Native Engine and Self-Evolving Adversarial Agent Team |
| 运行时 | Python ≥ 3.12 CLI + Claude Code / Codex 作为 agent 运行时（两个都支持） |
| 热度 | 189★ / 11 forks（2026-09-03 API）；创建 2026-08-12，pushed 2026-08-30，无 open issue——**低热度但极新鲜**，机制成熟度高于热度所暗示 |
| 目录 | `src/engine/`（Phaser host + 运行时桥）、`src/agents/`（7 个 markdown persona）、`src/artist/`（美术管线）、`src/skills/`（vibegame-build/edit/start + self-evolve + artist-self-evolve）、`src/skeletons/`（5 类子类型基线）、`src/modules/`（12 个即插模块 + `check/` 静态检查）、`src/cli/`（lead/mate/play/run/evolve/vlm/check 等）、`config/context.json`（角色注入映射）、`docs/`（imagegen/qwen/setup）、`technical_report.pdf` |
| 授勋 | GameDevBench / OpenGame / GameCraft-Bench / Trellis / agent-sprite-forge 启发来源 |

## 1.2 两套运行：任务工作流 + 常驻评审

**任务工作流**（`src/CLAUDE.md`）：每个 bounded 任务在 `.vibegame/tasks/<name>/`
下运行：orchestrator 写 `prd.md`（产品契约，面向用户可见结果）→ `architect` 产
`plan.md`（技术契约）并配置任务级 `context.json`（补充注入文件）→ `programmer`
写码 → `auditor` 静态审查 → `player` 运行时验证（状态断言 + 截图）→ orchestrator
接受。`log.md` 是追加式工作记录，每阶段追加一个 H1 区段（多轮返工追加不覆盖）。
任务默认在独立 git worktree 中隔离运行。

**角色分工**（`config/context.json` + `src/agents/`）：常驻 `designer`（玩法设计）、
`artist`（资产、常驻）、`reviewer`（最终质量门，常驻）；每任务新建 `architect` /
`programmer` / `auditor` / `player`。**上下文注入是显式契约**：`context.json` 按角色
声明注入文件（如 designer 注入 GDD + 设计理论索引 + MDA/Core Loop/Magic Circle +
玩家动机 + UI/HUD 模式 + Boss 设计模式 + 引擎 UI 路由规则 + 项目级设计理论 jsonl），
reviewer 注入引擎指南 + 运行时文档 + rastermap 契约 + VLM CLI + 回归套件契约。
每个"该角色必须先读的知识"都被点名，不允许凭记忆猜游戏状态或资产清单。

**对抗式终审**（`src/agents/reviewer.md`，全文核证）：reviewer 是独立于实现方的
最后一道门，**只审一次、审全套**（orchestrator 只告诉"何时审"不告诉"审什么"），
且**遇到第一个 reject 级问题立即上报、不走完清单**。三维度验收（基础→进阶）：
①**Functionality**（能跑通目标核心循环；无控制台错误；**必须跑完 `tests/` 全部
回归**；长流程自己写 5 行 `decide()` bot 用 `vibegame run --bot` 一把跑出
`video.webm + trace.jsonl + result.json`；逐条审 player 的证据类型是否匹配验收项）；
②**Visual Quality**（从**运行时截图**而非代码/清单推断；无占位资产——grep scene
实体 node 的 `"type": "rect|circle"` 交叉比对 assets.md/GDD；无重叠/裁剪/错位；
**对称布局镜像同尺寸**；**VLM 作为独立视觉门**做全屏视觉 QA 并逐对追问
"nameplate 是否压住 HP bar"——因为"VLM 倾向于对整体 looks ok 答 YES"，约束来自
逐项二元提问）；③**Playability**（手感：跳跃高度 ≤ ~1× 角色身高、攻击节奏自然、
命中反馈可见、镜头跟随舒适）。

**"不算证据"清单**（最锋利的一段）：帧在动 ≠ 可运行（粒子/tween 维持帧熵）；"已
eval 验证"不算（绕过游戏循环）；"上一轮 reviewer 通过了"不算（代码已变即过期）；
"为过测试改引擎"（生产代码开测试开关）是 workaround 不是修复。可运行的最低证据 =
bot 目录下的 `result.json(status: done, ok: true)` + `trace.jsonl`（决策状态确实
变化）+ `video.webm`。

## 1.3 AI 原生引擎：内容即配置

Phaser 3 CE 之上的一层数据驱动封装（`src/engine/`：PhaserHost、SceneTree、Node、
VisualFactory、Animator、ColliderFactory、InputMap、PivotResolver、RuntimeBridge/
RuntimeController、UiLayer + `src/modules/` 12 个盒装模块：侧视格斗、磁力球、小地图、
视差、状态栏、滑屏斩击、升级选择、DOM 卡牌管理、掩膜 HUD、定时特效……）：

- **scene.json / node.json**：场景树与节点模板都是 JSON，运行时 `instantiate()`
  从 `.node.json` 模板生成动态内容（子弹/敌人/拾取物必须走模板，禁止裸对象拼装）；
- **pivot 级联**：视觉 pivot 与碰撞体 pivot 各自有清晰的级联覆盖规则（clip 级 >
  sprite 级 > group 级 > 默认 `[0.5,1]` 脚锚），脚锚角色天然得到脚对齐碰撞体——
  这是 AI 生成时代最容易被搞乱的"跨帧原点漂移"问题的正解；
- **collider 语义化**：block/trigger 按对选择、one-way 平台、hitbox 作为子
  Collider 节点、tag 优先于硬编码名字、input-map 把物理键映射语义动作；
- **runtime bot 协议**：`vibegame run --bot` 用脚本驱动游戏循环（decide() 每 tick
  决策），产出 video/trace/result 三件套——AI 可以"自己玩自己做的游戏并留下证据"；
- **UI 路由规则**：HUD/菜单文本禁 `Phaser.Text`，一律走 CSS/网页字体/DOM（防
  像素糊字），引擎 spec 明令。

## 1.4 美术管线（Python）：从一句话到可用资产

`src/artist/`（analyze/decompose/gen/rmbg/cut/compose/animation/perfectify/pixel/
video）：t2i/i2i 多 provider 抽象（`docs/IMAGEGEN.md`：auto 发现 providers 目录、
GenResult 结构化返回、MODEL_MAP 规范名映射、共享工具 encode/save/download）、
分层出图（Qwen 分层管线 `qwen_image_layered.py`）、抠图（rmbg）、切片成帧（cut）、
spritesheet 拼装（compose）、像素归一（pixel）、perfectify 美化、动画帧校验
（analyze）、视频参考（video/videogen）。`agent-sprite-forge` 是 sprite prompt
设计的灵感来源。

## 1.5 自进化：项目经验 → 框架先验（四目的地）

`src/skills/self-evolve/SKILL.md`（全文核证）：项目收尾时用户显式触发，把"这
个项目里证明有效的东西"提升为框架级先验，让**未来项目从更高起点开始**。四类
目的地 + 严格的资格门槛：

| 目的地 | 内容 | 门槛 |
| --- | --- | --- |
| `skeletons/<slug>/` | 子类型可运行占位基线（非文件捆；保留场景流/尺寸/碰撞/调参/HUD 布局，真实资产换占位；可打开可玩） | 只能由任务工作流产生并由 check 验证；不比他项目更优则不覆盖旧骨架，而是加后缀另建 |
| `modules/` | 可复用封装运行时行为（视觉/手感优先于纯逻辑——纯玩法逻辑容易重写，视觉+collision+行为耦合最难复刻） | 必须真实参数化（一切调参走 `this.config`）+ 由真实项目证明 + 提交前自检 |
| `contracts/*`（`.vibegame/spec/contracts/`） | 跨角色协作规则（如 tilemap 脸/顶分离为什么）——有 Artist 章节，正文由 artist 直接写入 | 只收"能在其他子类型复用 or 该子类型每个项目必需"；`When to use` 仅写已验证能力，禁推演类别 |
| `skeletons/<slug>/errors.md` | 可复用失败记忆 | 按修复分类归档：Implicit Framework Behavior（改框架文档）/ Constraints Ignore（进 errors 或契约 Common mistakes）/ Technical Error（进 errors 或自动化检查）/ Best Practices（优先提升为模块/契约）/ Do Not Preserve（不收）；每条记 symptom/cause/fix + `**Spec update**` 闭环行 |

**关键纪律**：提升先验是**用户审批门**（每目的地列清单等批）；项目特有内容绝不
泄漏进先验（角色名/项目引用/绝对路径清零，用中性标识符 `p1/p2/fighter`）；共享
输出必须刚从仓库即可复现；宁可少收不收编 -- "只提升真实任务里承重的，不发明没用
过的先验"；`errors.md` 面向未来行动而非存档追责。

## 1.6 静态自检（模块 self-check）

模块两层自检：运行时 `_selfCheck()`（`ready()` 里查物理体/animator/配置，打
`console.error/warn`，不生成图片）+ 静态 `modules/check/XxxModule.check.py`
（`vibegame check xxx.node.json` 自动发现，消息前缀分级 ERROR/WARN/PREVIEW/PASS）。
原则："能直接断言的不要生成图让人猜"；必须目检的（碰撞对齐、动画帧窗、hitbox
覆盖）生成 **PREVIEW 图**，且**预览必须复刻真实运行时坐标逻辑**（视觉/碰撞/锚点/
帧序同引擎规则），"用近似坐标让预览更好画"是禁止项。

---

# Part II 对照本仓现状

## 2.1 能力对位表

| 能力维度 | VibeGame | 本仓现状 | 差距判断 |
| --- | --- | --- | --- |
| 多 agent 编排 | 常驻 3 + 每任务 4 角色，context.json 按角色注入，prd→plan→audit→player 流水线 | `actions/registry.ts` RegistryHost.runSubagent + defineAction 生态 | 本仓已有等价骨架；其"角色级注入映射 + 任务目录四契约件"是编排细节参考 |
| 上下文注入 | 角色→文件显式映射（设计理论/引擎规范逐条点名） | `prompt.ts` 6 知识源 + AGENTS.md + skills XML 块 | 同思路；其“先读哪几份再动手”的强制性与评审注入的对称性值得学习 |
| 经验蒸馏 | self-evolve 四目的地 + errors 五分类 + 用户审批门 | skill-up CI（8 包 14 用例）、book-distill、dsh 理念深化 | **同向的第二独立实现**；其"先验只收承重的+中性化+Spec update 闭环"纪律可直接进 skill-up 评审标准 |
| 视觉验收 | VLM 独立视觉门 + rastermap 脚对齐 + 逐对二元提问 | review 模块（OCR/CRG 组合）、designer taste 三轴机检（确定性零 LLM） | 互补：本仓机检"可复算"，VLM"主观像素";"独立评审视角防上下文污染 + 逐项二元提问防 VLM 讨好"是 prompt 层现成经验 |
| 证据协议 | bot 三件套 + 不算证据清单 + 证据类型匹配验收项 | 真机验证人审 + review-full 语义组合 | 其"自动玩+留下可复核证据+明确反例清单"对任何"AI 交付可运行物"的验收都有迁移价值 |
| 静态自检 | 模块 .check.py 分级消息 + PREVIEW 图 + 预览复刻真实坐标 | 测试体系（node:test/jsdom/dom-harness） | 其"能断言则断言、必须目检则生成可复核预览"的二分法适配 AI 生成绩效 |
| AI 原生运行时 | 数据驱动场景树/节点模板 + bot 协议 | A2UI（全域动态 UI，`.dd`/designer） | **同构思维的两端**：A2UI 网页 UI、VibeGame 游戏运行时；若将来要做"可玩物生成"，引擎封装形态可整体借鉴 |
| 美术生成 | t2i/i2i provider 抽象 + 分层/抠图/切片/拼装管线 | cad-3d 线（img2threejs）、designer 视觉资产 | 其 provider 抽象层（auto 发现 + GenResult + MODEL_MAP）是现成的多后端集成模式 |
| 骨架/模板 | skeletons 5 类子类型可玩基线（占位资产可玩） | `templates/design/macrostructures/`（10 骨架，hallmark 线） | 同思路；"占位资产可运行基线 + When to use 能力优先"是模板工程的完成态 |

## 2.2 与桌宠线（`specs/next-version/desktop-pet/design.md`）的关系

桌宠铁律"不做小游戏、不做对话、不做养成"**维持不变**——VibeGame 不是桌宠的实现
来源，两者范围刻意错开。但桌宠规格有三处可吸收 VibeGame 的机制（建议后续修订
`design.md` 时参考，均不影响其 core 零改动铁律）：

1. **§五 资产管线**：桌宠资产验收可补一条"VLM 独立视觉门 + 先预览后入库"的做法
   （桌宠 Lottie/SVG 资产的风格一致性检查），替代纯人工目检；
2. **§七 状态机**：桌宠状态机"任何切换写 debug 日志"可升级为 VibeGame 的
   static self-check 二分法——能断言（事件源存在、资产存在）的做确定性检查，
   必须目检的状态动画做 PREVIEW 输出；
3. **§四 记忆回闪**：桌宠"喂食 = 随机取一条记忆"的验收可沿用其证据协议思路
   （这条是锦上添花级建议，不阻塞）。

深层关系：VibeGame 证明"AI 生成的游戏/动画物可以到可玩、可验收、可复算"；
桌宠的"麻雀虽小"闭环（状态=真实事件源、资产本地、零 mutation）与其是同一哲学
（不做假状态）的两端——桌宠文档 §三"不做假状态——每个状态都有真实事件源"与
VibeGame reviewer"状态断言证据"完全同源。

## 2.3 可借鉴候选清单（⚠️ 调研仅供参考，实现一律以 specs/ 为准）

按价值排序，标注集成深度与落点：

1. **L0｜证据协议 + "不算证据"清单**（落点：review 模块/任务验收 template）：
   对任何"AI 交付可运行物"（A2UI 原型、桌宠资产、将来游戏），把"帧在动≠可运行、
   eval≠证据、过期证据不算、测试开关 workaround 不算"写成验收反例清单；要求
   trace/快照/视频三件套式证据。
2. **L0｜VLM 独立视觉门**（落点：review 模块、designer taste 线）：独立评审角色 +
   全屏视觉 QA + **逐项二元提问**防 VLM 讨好；与 taste 三轴机检的"确定性"形成
   主/客观双门。
3. **L0｜先验蒸馏纪律**（落点：skill-up CI / book-distill 评审标准）：四目的地 +
   errors 五分类 + "只收承重的/中性化/Spec update 闭环 + 用户审批门"，签入
   skill-up 的提炼规范。
4. **L3｜模块静态自检二分法**（落点：编辑器诊断/模块系统 spec）：能断言→确定性
   检查（ERROR/WARN/PREVIEW/PASS 分级）；必须目检→生成**复刻真实坐标**的预览图，
   "近似坐标让预览好画"列为禁止项。
5. **L2/L3｜数据驱动节点/场景 + instantiate 模板语义**（落点：若未来立项游戏生成
   能力/A2UI 游戏化）：scene.json/node.json + `.node.json` 模板 + pivot 级联 +
   bot 协议，整套"内容即配置"封装是 A2UI 思路在游戏域的对应已完成形态。
6. **L1｜美术 provider 抽象层**（落点：cad-3d / designer 若需要多后端时）：auto
   发现 + GenResult 结构化 + MODEL_MAP，10 分钟内挂新 provider。
7. **L0｜骨架工程完成态**（落点：templates/design/macrostructures 演进）：占位
   资产可运行基线 + "When to use 仅写已验证能力" + 骨架收编走任务工作流并跑
   冒烟。

## 2.4 不建议跟进的部分

- **Phaser/Claude Code 技术栈整体吸纳**：本仓 Electron/TS + 自有 harness，换栈零
  收益；VibeGame 的价值在机制层不在代码层。
- **桌宠"升级成可玩游戏"**：违背桌宠规格 §六写死的边界（防 scope creep 成电子
  宠物游戏）；若想要"玩一下"，方向是"生成可玩物能力"而非桌宠变形。
- **对抗式多角色班底照搬**：本仓 runSubagent/defineAction 已够用；7 角色班底是
  游戏垂直域的规模，非通用 harness 所需。
- **美术管线全套照搬**：sprite 生成属游戏垂直资产；本仓 designer/cad-3d 线各自
  已有路线，仅取 provider 抽象与验收思想。

## 2.5 风险与注意事项

- **热度与成熟度倒挂**：189★ 但机制密度极高、无 issue、文档成体系——判断其为"小
  团队高质量作品"而非"验证过的社区方案"；引用其机制前应意识到样本 = 9 个 demo
  项目（自报）。
- **新鲜度**：2026-08 发布、2026-08-30 最后 push；本快照之后可能快速演化。
- **评审 agent 依赖 VLM 能力与 bot 基建**：其验收链的质量上限受 VLM 判读准确率
  与 `decide()` bot 覆盖度约束；文档自己也承认 VLM 的"讨好倾向"需靠二元提问抵消。
- **命名无关**：VibeGame 与本仓无同名/路径冲突（不共享 `.deepcode`/`.deeporca`
  目录语义），共存无干扰。

---

## 结论

VibeGame 是"AI 生成可玩游戏"这条产品线的**完成度最高的开源垂直样本**，与本仓
A2UI/"全域可生成物"的路线同构，验证了该方向的工程闭环可以走通（数据驱动运行时 +
bot 自玩自验 + VLM 独立门 + 自进化先验库）。对本仓的即期价值集中在**机制迁移**
而非代码：①证据协议与"不算证据"清单 → review/验收模板；②VLM 独立视觉门（逐项
二元提问）→ 视觉类验收的互补第二门；③先验蒸馏四目的地/五分类纪律 → skill-up 与
book-distill 的评审标准；④模块静态自检二分法 → 编辑器诊断。桌宠规格可顺带吸收
①②④的轻量版本，但**桌宠"不做小游戏"边界不变**。建议动作：全部候选以 ∥ 状态
记账于本文与 research 索引，不另立 spec、不启动代码；若未来立项游戏生成能力，
本文即为全景预研底座。