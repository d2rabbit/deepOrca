# 深潜：tettethu/VibeGame 游戏开发层 —— 它究竟把什么游戏开发能力编码进了仓库

日期：2026-09-15 · 分支：`feat/modern-ui-redesign` · 性质：预研（无代码变更，不启动 spec）

## 定位声明（先读这个）

本文与 `2026-09-03-vibegame-prestudy.md` 是同一对象的**两层**：

- **09-03 是"机制层 / 宏观层"**：VibeGame 是什么、有哪些可迁移的机制（证据协议、VLM 门、
  先验蒸馏、数据驱动场景树），落点指向本仓的**产品能力线**（review / skill-up / taste / 桌宠 /
  未来游戏生成）。
- **本文是"游戏开发层 / 落地层"**：09-03 的判断大多基于 README 与少数几份文档，
  本文把**游戏开发真正依赖的那批一手材料**拉下来逐份读透——引擎指南 9 份、
  设计知识库 19 份、美术规格 2 份与美术管线源码 8 个模块、模块目录与 11 份契约、
  5 套可运行骨架（含 `errors.md`）、以及它们的工程实现。

**核心问题换成了**：如果明天要让 AI 真的做出一款游戏，VibeGame 在仓库里
**具体准备了什么**？这些东西里，哪些是**真能降低难度的工程**，哪些只是**看起来像**？

**一句话结论**：VibeGame 的真正价值不在"多 agent"，而在它把**游戏开发里那些
"AI 一定会做错、且错了很难查"的地方，提前变成了声明式约束、可运行基线、
以及带 `Spec update` 闭环的失败记忆**。这三样是本仓完全没有的东西，
也是本次调研最值得记录的部分。

> **总口径**：调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现；
> 正式实现一律以 `specs/` 为准。**本文不另立 spec、不启动代码、不给落地方案。**

### 调研材料（全部一手，逐份读完）

| 层 | 材料 |
| --- | --- |
| **引擎指南** | `spec/engine/`：`index.md`(9KB)、`entity-guide.md`(451 行)、`collision-guide.md`(346 行)、`animation-guide.md`(402 行)、`ui.md`(92 行)、`project-setup.md`(299 行)、`script-rules.md`、`tilemap-guide.md`、`modules.md` |
| **设计知识库** | `spec/design/`：`index.md`、`patterns/boss-design.md`、`patterns/ui-conventions.md`、`theories/` 17 份（core-frameworks / player-motivation / mechanism-design / challenge-design / feedback-loops / game-fairness / player-types / player-personality / game-theory / multiplayer-design / social-systems / hidden-narrative / design-process / business-models 等） |
| **美术规格** | `spec/art/sprite.md`（含完整参数分类学与 prompt 规则）、`spec/art/slicable_sprite.md` |
| **美术实现** | `src/artist/`：`cli.py`(16 动词)、`cut.py`(499 行)、`rmbg.py`(555)、`compose.py`(735)、`decompose.py`(720)、`perfectify.py`(491)、`animation.py`(476)、`analyze.py`(425)、`pixel.py`(397)、`label.py`、`imagegen.py` |
| **模块与契约** | `modules/index.md` + 11 个 `*Module.js` 源码；`spec/contracts/` 全 11 份 + `index.md` |
| **骨架** | `skeletons/index.md` + `2d-action-boss-fight/` 全套（`index.md`/`errors.md`/`art-pack.md` 724 行/`main.scene.json`/`player.node.json`/`boss.node.json`/`PlayerController.js` 549 行/`BossController.js` 665 行） |
| **论文** | `technical_report.pdf` 18 页全文（用于核对主张） |

---

## TL;DR

| 层 | VibeGame 实际交付了什么 | 是真工程吗 |
| --- | --- | --- |
| **引擎** | Phaser 3 之上的声明式封装：`project.json → *.scene.json → NodeDef` 三层全文本；**四条为"AI 写码"设计的产品约束**——省略即继承、pivot 级联、UI 三路线禁 `Phaser.Text`、程序化实体必须走模板 | ✅ **真，且是全文最有价值的一段**：它不是在包装引擎，是在**把 AI 的坏习惯提前堵掉** |
| **设计** | 19 份设计理论与模式文档，含 boss 遭遇设计参数、UI/HUD 惯例表、正负反馈分析框架；**核心纪律是把"意图"与"制作"分层**（设计只写 action category，禁写帧数与像素） | ✅ 真。理论部分是**扎实的教科书摘要**（有表、有阈值、有反例）；模式部分是**可直接执行的生产规范** |
| **美术** | 16 个 CLI 动词的完整管线：生成 → 色键抠图（纯 OpenCV 泛洪，非模型）→ 轮廓切帧（可切可不切）→ 图集 bbox 标注 → 像素归一化 → 从深处填充修边；外加**一整套 sprite prompt 工程学** | ✅ 真。**`sprite.md` 是全文最硬的一手材料**——它不是"提示词技巧"，是把"如何稳定生成可切片的图集"变成了可复现的规则集 |
| **游戏能力** | 11 个即插模块（战斗控制器 / 滑屏斩击 / 状态条 / 卡片手牌 / 小地图 / 升级三选 …）+ 11 份跨角色生产契约（关卡布局 / 状态条 / 蓄力技能包 / 卡牌前端 …）+ 5 套**可打开可玩**的骨架基线 | ✅ 真。模块配置面极宽且全部走 `this.config`；契约带 `Basic Knowledge` 章节解释"为什么"；骨架带 **`errors.md`——7 条真实失败模式** |
| **可运行物** | 骨架**用 placeholder 美术就能跑**：`placeholder_atlas`（语义帧名映射到内置 8×8 占位图集）/ `placeholder_image`（`shape`+`color` 生成），polish 阶段只换 manifest 条目，node.json 与脚本不动 | ✅ **这是整套设计的枢纽**：让"代码先行、美术后到"真正成立 |

**最值得记的单条**：`skeletons/*/errors.md` 的七条失败模式，每一条都是
"症状 → 根因 → 修法 → `**Spec update**:` 闭环行"。
例如"Phaser 不会分离两个 immovable 体 → boss 掉穿地面"、
"薄视觉+厚碰撞体必须 `host: "separate"`"、
"`playAnim(同名)` 每帧调用会把动画冻在第 0 帧"。
**这是本仓完全没有的资产类型：从真实项目里蒸馏出来、面向未来行动的失败记忆。**

---

# Part I 引擎层：为"AI 写游戏"设计的四条产品约束

## 1.1 三层全文本结构

```
project.json      — 入口：画布/物理/起始场景/manifest 列表/runtimeDefaults
  └─ *.scene.json — 一个场景 = 一棵节点树
       └─ NodeDef — 一个游戏对象：visual + collider + script + config + children + animations + animator
```

配套：`manifest.json`（资产预载声明）、`config/input-map.json`（语义动作→按键）、
`*.node.json`（可复用节点定义，经 `src` 引用）。

`project-setup.md` 对这件事的定位写得直白：
**"The whole game structure is explicit data — it can be generated, diffed, and refactored by agents and editors."**
（整个游戏结构是显式数据——可被 agent 与编辑器生成、diff、重构。）

**Cross-File Dependencies 表**（5 条跨文件引用规则：startScene / inputMap /
texture key / src / script / animator.states.clip）是静态检查的依据，也是"改一个地方
要知道还有什么会跟着坏"的显式化。

## 1.2 四条约束：每一条都在堵 AI 的坏习惯

这是"AI 原生引擎"名副其实的地方。四条不是泛泛的"最佳实践"，而是**针对 LLM 生成代码的
具体失效模式**设计的。

### 约束一：省略即继承（对抗 AI 的防御性写码）

```
collider.width/height 省略 → 继承 visual 的 displayWidth/displayHeight（对 rect/circle/image/atlas/sprite 全部适用）
collider.pivot 省略     → 继承视觉精灵解析后的原点（级联终点 [0.5, 1]，脚锚）
```

文档里反复强化的措辞是：**"When in doubt, omit them; the inherited default is usually what you want."**
并对"什么时候才该显式写"给了判据：只有当需要**比视觉更小/更大**的碰撞体时才写
（紧凑 hitbox、放大 hurtbox、比原画小的落点）。

`programmer.md` 里对这条的**反面动机**有段精确描述（这是提示词工程的范本）：

> "The most common drift is 'I will just scale it in `ready()`' — the value ends up split
> between scene JSON and script, neither is the source of truth, downstream tuning gets confused."

配套的还有单位一致性规则：`collider.*` 一律 **world px**（与 `visual.width/height` 同单位，
即屏幕上看到的），引擎内部换算；**禁止在脚本里直接调 `body.setSize()`**
（那 API 收的是 pre-scale 纹理坐标，world px 会被缩放两次）。

### 约束二：pivot 级联（跨帧原点漂移的正解）

这是游戏开发里最经典、也最容易被 AI 搞乱的问题。引擎给出的答案：

```
级联（高→低）：
  1. animations.clips.<name>.pivot        — 剪辑级覆盖
  2. manifest <asset>.sprites.<frame>.pivot — 逐帧覆盖
  3. manifest <asset>.pivot                — 组级默认
  4. [0.5, 1]                              — 引擎默认（脚锚）

碰撞体侧：collider.pivot 显式 > 视觉精灵解析后原点 > [0.5, 0.5]（圆形恒为后者）
```

为什么重要，文档写得清楚：

> "When atlas frames vary in size between animation frames, a centered origin causes the
> character to 'float' mid-air because each frame's bbox center sits at a different world
> position. The pivot resolves to Phaser's `setOrigin(x, y)` and is re-applied on every frame
> change, keeping a stable reference point (e.g., feet center) across all frames."

**并且给了"何时覆盖"的判定表**：地面角色省略（默认就对）／居中 VFX 用 `[0.5,0.5]`／
空中单位 `[0.5,0.5]`／顶部锚定 `[0.5,0]`／同图不同剪辑用 clip 级。

还有一个**语义分层**的澄清，把三个"offset"概念彻底分清（这是最容易被混用的地方）：

| 概念 | 管什么 |
| --- | --- |
| `visual.pivot` / `manifest.pivot` | 锚点在**图像**上的位置（图像内在属性，驱动精灵原点） |
| `collider.pivot` | 锚点在**碰撞盒**上的位置（默认继承视觉原点 → 脚锚精灵天然得到脚对齐碰撞体） |
| `visualTransform.offsetX/Y` | 视觉相对变换/物理宿主的**显式额外偏移**（默认继承后多数情况为零） |
| `FrameRef.offset` | **单帧视觉修正**（只影响该帧出现，不动节点变换与碰撞体） |

并明确禁止："**Do not use `pivot` to fix per-frame drawing drift.**"（pivot 决定哪个点不动；
offset 决定这次出现画在哪。）

### 约束三：UI 三路线 + 禁 `Phaser.Text`

`ui.md` 全文只有 92 行，但立了两条硬规矩：

**① 游戏内文本一律 CSS + 网页字体，绝不用 `Phaser.Text`。** 三条路线：

| 路线 | 用于 |
| --- | --- |
| CSS + web font | 分数、HP 数字、菜单、按钮、计时器、暂停/结束文字、对话框、可 CSS 表达的面板 |
| manifest 图片 | 需要作者像素的外框：主题面板、心形图标、分段条、图按钮、武器图标 |
| 内联 SVG | 简单几何：箭头、加号、准星、升级符号 |

**"When in doubt, use CSS and web font."** 并且给了技术原因与边界：
UI 根用 `project.json.settings.width/height` 作逻辑尺寸、跟随画布缩放，
所以 CSS 的 `px`/`%` 与 Phaser 是同一套屏幕空间逻辑像素；
**禁用 `vw`/`vh`/`position:fixed`**（那指的是浏览器页面不是游戏画布）；
根是 `pointer-events: none`，交互元素必须显式 opt-in。

**② "UI 从第一版起就必须匹配美术"** —— 这条是针对"先出功能、以后美化"的常见妥协：

> "UI built with CSS instead of art assets is still art direction. Its first version must
> already match the style of the project's current assets and concept art — **at prototype
> stage too**, when the only reference is a concept image."
>
> "A panel is not done until each of these has a deliberate answer: palette sampled from
> the game's own art, silhouette and corner treatment that sit with that art, a defined edge,
> and type consistent with the game's identity. **An unstyled default rectangle is a
> placeholder and must not ship.**"

并显式约束到模块："UI supplied by a module is held to the same requirement.
**Modules are not editable; subclass and restyle what the module builds.**"

### 约束四：程序化实体必须走模板

> "**Procedural entities MUST use `.node.json` templates.** 'Procedural' means 'spawned at
> runtime via code' — it does NOT mean 'created without template files.'
> **The template IS the entity definition**; `instantiate()` is how you place it programmatically."

```js
const bullet = await this.instantiate('entities/bullet.node.json', { x: 100, y: 200 })
```

配套解决了一个真实陷阱：**运行时实例化的脚本必须先注册**，而注册有两条路——
脚本里手写 `sceneTree.scriptClasses['Bullet'] = Bullet`，或
**在场景里放一个 `enabled: false` 的占位节点**（`collectScripts` 在加载期就能发现它）。
后者还能顺带把 `.node.json` 预载进 `sceneTree.nodeDefinitions`：

```json
{ "name": "_BulletTemplate", "src": "entities/bullet.node.json", "enabled": false }
```

文档点明了为什么必须这样：

> "`instantiate(src)` throws if `src` was never preloaded. Boot discovers templates by
> scanning scene JSON for `src` references — **a path that only appears as a string in
> script code is invisible to that scan.**"

（`vibegame check` 会对未预载的 `instantiate()` 字面量报警。）

## 1.3 生命周期与"什么不该是 Node"

**顺序**（都写在文档里，因为顺序错了会产生难查的 bug）：

```
ready()  — 后序：子先父后（父可依赖子已初始化）；可 async，引擎会 await
update(dt) — 前序：父先子后（子可响应父的当帧状态）；仅 sceneTree.running 时调用
动画更新链：node.update(dt) → animator.update(dt)（选剪辑）→ animationPlayer.update(dt)（推进帧）
```

**"不是万物皆 Node"的判据**（这段是本仓最缺的一类知识：**什么该进引擎、什么该留纯逻辑**）：

> "The rule is not 'everything is a Node'.
> **The real rule is 'everything important must stay observable'.**"
>
> "If non-Node code controls user-visible or acceptance-critical state, expose that state
> back to the engine through a host Node."

推荐形态：逻辑留纯 JS，宿主 Node 管生命周期与接线，重要值从 `runtimeState()` 返回。
并给了应暴露状态的清单：激活的面板/模态、选中的实体或指令目标、当前教学步、
影响验收的 HUD 值、AI 模式/阶段/待执行动作。

## 1.4 AI 陷阱清单（pitfalls）—— 文档里显式标注的"会踩的坑"

这些是引擎文档里逐条写明的 `> **Pitfall**:`，全部是针对生成代码的失效模式：

| 陷阱 | 后果 | 正解 |
| --- | --- | --- |
| 有 `visual` 时又调 `this.scene.add.sprite()` | 重复创建 | 用 `getVisualObject()` / `getPhysicsObject()` |
| 每帧无条件 `playAnim('run')` | **动画冻在第 0 帧**（默认 `restart:true` 每帧重置索引） | 传 `{restart:false}`，或显式比 `getCurrentAnim()` |
| `sprite.width/height` 当渲染尺寸用 | 碰撞数学错 | 用 `displayWidth/displayHeight` |
| 用 `body.x/y`（顶左角）当游戏逻辑坐标 | 特效生成高度错 | 用 `physicsObject.x/y`（原点坐标） |
| `instantiate()` 的路径只出现在脚本字符串里 | 运行时抛错 | 场景里放 disabled 占位节点 |
| 调 `sceneTree._buildNode()` | 私有 API | 用 `instantiate()` / `addChild()` |
| `sprite.play(对象)` | 引擎只接受字符串（会自动加纹理前缀） | 传名字字符串 |
| `animator.setParam()` | 静默无效（不存在） | `setBool()` / `setTrigger()` |
| 圆碰撞体读 `body.radius` | 那是 pre-scale 坐标 | 用声明值，或 `body.width/2` |
| 静态体 resize 后不刷新 | 碰撞体错位 | `refreshBody()` / `body.updateFromGameObject()` |
| 一帧内 `=== n` 判帧事件 | 低帧率会跳帧漏判 | 记录上帧索引，判"跨过的帧" |

## 1.5 动画设计规则（真实工程知识，非泛泛而谈）

`animation-guide.md` 末尾有一节 "Animation Design Rules"，专门解决
**"图像生成模型往往每个动作只给一帧"** 这个现实：

| 动作类型 | 可用帧 | 剪辑设计 |
| --- | --- | --- |
| 连续动作（跑/走） | 1 帧 | **`[idle, action]` 两帧循环**（在 idle 与动作姿态间振荡制造运动感） |
| 连续动作 | 2+ 帧 | 全部用上，循环 |
| 一次性（攻击/跳/受伤/死亡） | 1 帧 | `[idle, action]` 或 `[action, idle]`，`loop:false` |
| 一次性 | 2+ 帧 | 全部用上，`loop:false` |

并解释了为什么：

> "A single frame representing a continuous, repeating motion should **not** be held static.
> Instead, alternate it with the idle frame to create a 2-frame loop... The oscillation
> between them creates visible motion — a character 'pumping' their legs or shifting weight.
> **Without this, the character appears frozen mid-stride.**"

`FrameRef.offset` 有个硬约束（也是静态检查的一条）：
**"If a node has a collider and any frame uses `offset`, set `collider.host: "separate"`.
Same-object collider plus frame offset is invalid and fails `vibegame check`."**
理由：offset 是纯视觉的，不该动碰撞体，而同体模式下二者绑在一起。

---

# Part II 设计层：把"意图"与"制作"分层

## 2.1 设计知识库的结构与注入机制

`spec/design/` 下 19 份文件，注入分三档：

| 档位 | 内容 |
| --- | --- |
| **总是注入** | `index.md` + `theories/core-frameworks.md`（MDA + Core Loop + Magic Circle）+ `theories/player-motivation.md`（四类乐趣 + Koster 学习理论） |
| **design.jsonl 注入** | designer **首轮读目录、按本游戏类型挑选**相关理论，写成 `.vibegame/design.jsonl`；此后 hook 自动注入 |
| **按需读取** | 未进 jsonl 的，designer 需要时自己读 |

这个"**首轮自选 → 落成 jsonl → 此后自动注入**"的机制很值得注意：
它把"这个项目需要哪些设计理论"变成了一个**显式、可审计的决策**，
而不是每次重新猜或者一股脑全塞进上下文。

## 2.2 理论清单（按文档自身的分组）

| 组 | 文件 | 覆盖 |
| --- | --- | --- |
| **高频** | `mechanism-design` | 谜题设计、循环克数（石头剪刀布）、情绪系统、奖励系统（斯金纳箱）、动态价值排序 |
| | `challenge-design` | 记忆型 vs 技能型挑战、辅助系统设计 |
| | `feedback-loops` | 正反馈（富者愈富）+ 负反馈（维持悬念）+ 分析框架 |
| | `game-fairness` | 游戏契约、随机性公平、难度曲线、Rabin 公平模型 |
| **玩家分析** | `player-types` | Bartle 四型（成就/探索/社交/杀手）+ 2D 坐标模型 |
| | `player-personality` | 大五人格→游戏偏好、多元智能→游戏元素映射 |
| **策略/多人** | `game-theory` | 纳什均衡、囚徒困境、志愿者困境、同时/序贯博弈 |
| | `multiplayer-design` | 对称/非对称、同步/异步、合作/竞争 |
| | `social-systems` | 邓巴数、网络效应、公地悲剧 |
| **信息/叙事** | `information-design` | 信息架构三类、透明度类型、自愿/非自愿披露 |
| | `hidden-narrative` | 隐藏叙事公式、空间/时间/机制/彩蛋设计 |
| **元方法** | `design-process` | 三种头脑风暴法、100 条设计原则索引、80/20 资源分配 |
| | `business-models` | 消费者剩余、免费游戏四档内购、付费平衡 |

**深度评估**：以 `feedback-loops.md` 为例（我完整读了）——它是**扎实的教科书摘要**：
正反馈定义 + 4 个经典例子表（大富翁/俄罗斯方块式 RPG/国际象棋/躲避球）+
3 条设计风险 + 4 种解法；负反馈定义 + 3 个例子表（马车/美式足球/8 球）+
2 条风险 + "**奖励而非惩罚**"核心原则 + 4 种实现法；
再给一个 4 元素分析框架（触发/强化/速度/终止）+ 4 维影响评估 + 6 条设计检查清单。

**这是可用的**——不是"要重视平衡"这种空话，而是能给 designer agent 一个
"诊断太简单/太难/无聊"的具体工具。但要诚实：**17 份理论总量有限，单份 3-8KB，
是"够用的摘要"而非"完整的游戏设计课程"。**

## 2.3 两个模式文件：可直接执行的生产规范

### `boss-design.md` —— 遭遇设计的可执行参数

| 维度 | 给的内容 |
| --- | --- |
| **视觉尺度** | 默认 **约屏幕高度一半**（玩家典型高度约屏幕 10-15%）；小于此读作"又一个敌人"，大于此吃掉活动空间。并说明这是启发式、可调，但**必须在设计简报名明**让美术与实现对齐 |
| **攻击三类** | Melee（前弧 180° 或落点 AOE）/ Ranged（从身体哪个部位出 + 直/弧/追踪 + 单发/3 扇/5 扇/连爆 + **必须指定名词类**如 `bullet`/`arrow`/`fire-orb`）/ Summon（空间来源四选一：从天而降/从地升起/定点/追玩家 + 名词类 + telegraph 有无） |
| **Telegraph** | 四类（动画预兆 / 地面警示圈 / 颜色闪烁 / 音效）与各自适用场景 |
| **可打断性** | 默认表：动作/近战游戏 boss 空闲时受创踉跄；狂暴/终阶段可覆盖为超级护甲 |
| **移动模式** | 5 种独立模式（静止/持续追击/保持距离/不规则节奏/多点瞬移）+ 3 种技能内嵌移动（突进/跳砸/击退后座） |
| **AI 节奏** | 两个反模式（"总是连着攻击"过度压迫、"无节奏随机"无法学习）；默认 **2-4 招轮转 + 各自冷却 + ±20% 随机化**；距离决定可用子集 |
| **阶段转换** | 默认 HP 阈值 → 超级护甲转换动画 → 解锁新招池 |

并给出**可直接抄进 GDD 的单行格式**，例如：

> `Boss AI: 3 attacks (melee slam, ranged shout, meteor summon); melee when player < 200px,
> ranged 200-500px, summon when > 300px; per-attack cooldown with ±20% randomization`

### `ui-conventions.md` —— 每个 HUD 决策的默认与覆盖条件

| 元素 | 默认 | 覆盖条件 |
| --- | --- | --- |
| 玩家 HP | 左上连续条（理由：动作游戏伤害浮动，需要精确读数） | 1-3 击限制→徽章行；氛围优先→无 HUD（仅在用户明确要求时） |
| Boss HP | 底部居中全宽条，仅遭遇期间显示（理由：这是"这是 boss 战"的视觉声明） | 街机/弹幕感→顶部居中；离散阶段→多段条；谜题 boss→无 HP UI |
| 杂兵 HP | **不显示**（理由：每个杂兵都显 HP 是视觉噪音） | 战术/RTS/刷宝→单位上小条 |
| 受击反馈 | 屏幕震动 + 短暂闪白 + 火花粒子 + 受创踉跄 | 见下表 |
| 死亡效果 | 专用 `death` 动画 + 可选粒子爆发 | 小型/抽象实体→仅粒子；无动画资源→仅淡出（罕见） |
| 暂停/结束 | 全屏半透明覆盖 + 标题 + 按钮栈（恢复/重开/退出） | 单局街机无暂停→无 |

**"受击是否踉跄"按类型给了完整判定表**：

| 类型 | 玩家 | 敌人/Boss |
| --- | --- | --- |
| 动作/近战（空洞骑士、魂系、只狼） | 受击踉跄 | 空闲时踉跄；攻击中保持承诺 |
| 射击/弹幕 | 通常**不**踉跄（边打边扛） | 小兵一击死；大型可能硬直 |
| 平台跳跃（马里奥、蔚蓝） | 受击击退 | 通常直接死，无硬直 |
| RPG/砍杀（暗黑） | 仅重击踉跄 | 分层级 |

**超级护甲**定义：**永不**踉跄（即使不在攻击中），用于狂暴阶段/终盘 boss，
**该实体直接不做 `hit` 动画**。并给一条闭环要求：
"Whenever an entity flinches, designer must include a `hit` animation in the asset list."

## 2.4 核心纪律：intent vs production 的分层

**这是本文认为设计层最有价值的单条。** 两个模式文件都以一段
"Reminder" 开头，并以一张"该写/不该写"对照表收尾：

> **Reminder**: write **intent and semantics** (action category, object class, spatial origin),
> never production specifics (frame counts, motion direction, exact poses, sub-frame phase
> divisions). Production specifics are programmer / artist's call.

| 该写（意图/语义） | 不该写（制作/运动） |
| --- | --- |
| Boss 有三招：近战猛击、远程咆哮、从天召唤陨石 | Boss 先上挑再旋踢再三段纵斩 |
| 陨石从战场上方落下 | 5 颗陨石以 90°/s 旋转、8px/帧下落 |
| Boss 空闲受创踉跄；阶段 2 进入超级护甲 | Boss 碰撞盒在猛击动画第 8-12 帧激活 |
| 猛击：近战、中 AOE、带地裂 VFX | 猛击：30f 前摇 → 6f 命中 → 60f 后摇，hitbox 200px 半径偏移 10px |

理由（原文）：

> "The 'Not this' entries are programmer / artist's job — designer writing them either
> **locks in a number that breaks on later tuning**, or asks for a **visual precision
> (specific motion, exact arc) that image-gen can't deliver**."

同时 UI 惯例文件还有一条更严的补充：**连实现形式都不该写**：

> "never production specifics (px sizes, frame counts, shake amplitudes) and
> **never implementation form (placeholder, CSS, or authored asset)**. Both are programmer /
> artist's call. **Whether a screen needs authored art is decided during implementation
> against `engine/ui.md`, not here and not in the GDD.**"

配套的**输出格式纪律**：每个决策落成**一行 GDD 声明**（如
`Boss movement: chases player when > 200px away, kites back when < 100px (range-keep)`），
让下游有唯一可引用的判据。

---

# Part III 美术层：从一句话到可用资产

## 3.1 完整管线（16 个动词）

`vibegame art` 是**扁平命令面**（不是嵌套子组），可直接访问：

| 动词 | 作用 |
| --- | --- |
| `gen image` / `gen video` / `gen list` | t2i/i2i 生成；视频生成；列 provider 与模型 |
| `rmbg` | 色键抠图（多模式：种子泛洪 / 全局替换 / 精确匹配 / 区域限定） |
| `cut` | 从图集切出精灵（轮廓检测） |
| `collate` | 多动作序列统一缩放拼装 |
| `decompose` | Qwen-Image-Layered 分层分解（远程服务） |
| `concat` / `canvas` | 精灵拼接 / 画布绘制 |
| `edit` | 图像编辑（**含 `-m hflip --inplace`**，用于朝向修正） |
| `animation` / `f2v` | 动画帧校验 / 帧转视频 |
| `analyze` / `tree` | 颜色分析、资产检查、目录树 |
| `label` | **提取精灵位置并写 manifest 的 atlas bbox** |
| `perfectify` | 抠图后修边（填洞、去白边） |
| `pixel process/encode/decode` | 像素画网格归一化、调色板量化、色矩阵编解码 |
| `v2f` | 视频转帧 |

## 3.2 生成：provider 抽象

`docs/IMAGEGEN.md` 与 `src/artist/providers/`：**文件系统自动发现**——
往 `providers/` 放一个导出 `PROVIDER_NAME` 的 `.py` 就注册了。
Provider 契约：`PROVIDER_NAME` / `BASE_URL` / `SUPPORTED_MODELS` / 可选 `MODEL_MAP` /
`t2i(...)` / `i2i(...)` → `GenResult`。

`MODEL_MAP` 把**面向用户的稳定别名**与**厂商上线的真实模型名**解耦
（如 `nano-banana-pro` → `gemini-3-pro-image-preview`）。
CLI 会**提前**拦截参数族不匹配（gpt 用 `--size`，nano-banana 用 `--resolution + --aspect`），
而不是让 provider 静默忽略。每次生成追加一行到 `logs/imagegen.jsonl`
（`{ts, provider, model, prompt, images, size, ..., output, error}`）——
**这个审计日志后来成了自进化回溯原始 prompt 的唯一依据**（见 Part IV）。

## 3.3 抠图：纯色标记 + 泛洪，不是模型

这是整套管线里最"土"但最可靠的一步：**生成时要求纯色背景（默认 `#FF00FF` 洋红），
抠图时用 OpenCV 色键 + 泛洪**。`rmbg.py` 的模式：

```bash
vibegame art rmbg <image> --tolerance 20 -o out.png          # 默认：角落种子
vibegame art rmbg <image> --seed tl --seed tr -t 15 -o out.png
vibegame art rmbg <image> -c 255,255,255 -t 10 -o out.png     # 全局替换
vibegame art rmbg <image> -c 255,0,255 --seed match:5 -t 40   # 松匹配种子
```

**为什么必须纯色**（`sprite.md` 全局规则）：

> "background is 100% solid flat pure-color marker (default `#FF00FF` magenta; switch to
> another saturated pure color such as `#00FF00` or `#00FFFF` if the subject contains magenta).
> Use the same marker color across the entire sheet." + "no gradients in the background"

并且给了**真实排障流程**——这是"生成模型不听话"的具体应对：

> "Some providers deliver the marker color slightly off from the prompted value —
> a prompt asking for `#FF00FF` may come back as `RGB(248, 13, 228)` or similar.
> Default `vibegame art rmbg -t 10` then leaves a visible halo around the subject.
> When that happens, **sample the actual corner pixel** and re-run with explicit color
> + wider tolerance"

```python
import numpy as np; from PIL import Image
bg = np.array(Image.open('raw.png'))[0, 0, :3]
print(bg)  # e.g. [248 13 228]
```
```bash
vibegame art rmbg raw.png -c 248,13,228 -t 50 --defringe 3 -o clean.png
```

## 3.4 切帧：轮廓检测，不是固定网格

`cut.py` 的做法（`SpriteCutter`）：**OpenCV 轮廓检测** →
`min_area`（默认 5000）过滤 → 按**行或列**聚类排序
（按中心点，阈值 = 平均尺寸 × 0.6）→ 逐个裁出。

可选参数：`--tight`（按 alpha 紧裁）／`--crop-edge`（强制各边裁 N 像素）／
`--name-order row|column`。

**还有一条 VLM 路径**：`--agent` 走 `cut_agent`，用视觉模型自动判定精灵边界
（可传 `--frames N` 提示期望帧数、`--tips` 追加提示词）。

**关键设计**：`cut --label` **不裁图，只把 bbox 写进 manifest**：

```python
manifest[prefix] = {"type": "atlas", "path": img_path.name,
                    "sprites": {f"{prefix}_c{idx}": {"bbox": [x,y,w,h]}}}
```

于是 **atlas 不需要单独的 atlas JSON 文件**——bbox 内联在 manifest 条目里，
运行时用名字引用（`sprite.setTexture('terrain', 'grass')`）。
manifest 的写入是**原子**的（tempfile + `os.replace`），且
**读失败会抛错而不是返回空对象**（注释写明：返回 `{}` 会让调用方把空 manifest 写回去，
抹掉所有已有条目）。

## 3.5 像素归一化与修边

**`pixel process`**：网格检测 + 重采样 + alpha 二值化。采样方法
`center|median|majority`；支持调色板量化（内置 `pico8` 16 色）；支持
`encode`/`decode` 到**色矩阵文本**（可 diff 的像素画表示）。

**`perfectify`**：抠图后的补救。`tile` 模式**从深处向外填充**——
"透明区附近的像素不可信（可能是残留白边），只有深处像素可信，
颜色从内部向外传播，同时覆盖空洞与不可信边缘"。
`sprite` 模式填内部空洞 + 用 KD 树做最近内部像素复制。

**`analyze`**：把透明类型分成四态——
`opaque` / `binary_alpha` / `pseudo_translucent`（有非零透明但无部分透明）/
`translucent`；并猜背景色、边缘像素采样、主色统计。这是"这张图能不能直接用"的体检。

## 3.6 Sprite prompt 工程学（全文最硬的一手材料）

`spec/art/sprite.md` 约 500 行，不是"提示词技巧集"，而是一套**参数分类学 + 生成契约**。

### 参数分类学

```
asset_type: player | npc | creature | character | spell | projectile | impact | prop | summon | fx
action:     single | idle | cast | attack | hurt | combat | walk | run | hover | jump | fall
            | dash | bounce | charge | charge_full | charge_release | projectile | impact
            | explode | death
view:       topdown | side | 3/4
sheet:      auto | 1x4 | 2x2 | 2x3 | 3x3 | 4x4
bundle:     single_asset | unit_bundle | spell_bundle | combat_bundle | pose_bundle | line_bundle
```

**sheet 尺寸与用途的映射是现成的经验值**：
`1x4`→弹道/简单循环 FX；`2x2`→标准 idle、攻击/受伤/冲击、紧凑侧视走；
`2x3`→施法序列、死亡序列；`3x3`→大型生物 idle、boss 光环循环；`4x4`→俯视四向走。

### 全局硬规则（每次生成都必须带）

```
- 背景 100% 纯色标记（默认 #FF00FF；主体含洋红则换 #00FF00 / #00FFFF），整张同一色
- 背景无渐变
- 无文字、无标签、无 UI、无对话气泡
- 精确网格数，不多不少
- 单元格之间无边框
- 跨帧同一资产身份
- 跨帧同一包围盒与同一缩放
```

### Containment 规则（**这是"可切片"的核心**）

> - the entire subject must fit fully inside each cell
> - **no body part, effect, weapon, tail, wing tip, orb, spark, or smoke trail may cross a cell edge**
> - leave marker-color margin on all four sides
> - use the same silhouette scale in every frame

### View 规则（含一条非常有用的工程约定）

| view | 相机 | 典型类型 | 规范朝向 |
| --- | --- | --- | --- |
| `topdown` | 正上方 90° | 俯视射击、双摇杆、经典 JRPG 大地图、战棋 | 无规范朝向；多向用 `4x4` |
| `3/4` | 约 45° 俯视 | 现代 JRPG 大地图、俯视 RPG、等距战棋 | 同 topdown |
| `side` | 正面 90° 侧廓 | 平台/银河城/横版格斗/清版/弹幕，**以及所有弹道与方向性 FX** | **一律朝右**；引擎水平翻转得到朝左 |

并给出**工程纪律**（重要）：

> "If image-gen returns a left-facing asset, **post-process with
> `vibegame art edit <path> -m hflip --inplace` — never re-prompt over direction alone.**"

（原因：重生成会连身份一起漂移，翻转是确定性操作。）

### 具名 IP 角色的反直觉规则

> "**Named / known-IP character: name it, do not hand-describe it.** For a well-known
> character, state the name and forbid substitution ('render `<Name>` from `<Work>`, keep the
> canonical recognizable look, do NOT substitute a generic `<archetype>`') plus 'use the
> canonical palette, do not improvise replacement colors'.
> **The model's built-in likeness is stronger and more consistent than any manual appearance
> description — spelling out hair / eyes / outfit fights the model and drifts.**
> Reserve manual appearance description for original (non-IP) characters."

（这条直接决定了 demo 里那批 IP 转换（空洞骑士→鬼灭、功夫熊猫）能不能稳定复现。）

### idle 四帧的写法（"单一连续微循环"）

这是本文见过对"如何让生成模型产出真正循环的 4 帧"最具体的规范：

> - 只选**一个驱动波**（呼吸 / 悬浮起伏 / 光环脉动）
> - 加 1-2 个**次级运动**（衣物/头发/雾），必须与驱动波同步，且**在第 4 帧反向**
> - **主体守恒**：每个运动主体（胸、斗篷、头发）必须出现在每一帧描述里，不得中途引入新主体
> - **相位递进**：同一主体跨帧走完一个连续物理过程的 4 个采样点
>   （如斗篷：`settled → drift → fully drifted → recoil`）
> - **反向收口**：末帧次级运动必须**反向**（不是"回到中立"），否则循环接不上
> - **每帧描述至少一个克制词**：`subtle / slight / gently / softly / faint / barely`
> - **用相对增量不用绝对状态**（`chest rises`，不是 `stands tall`）
> - **用解剖+动词，不用姿势标签**（`antlers tip forward`，不是 `alert pose frame`）

并给了一个可直接套用的模板：

```
Animation (4 idle frames, [driving wave] + [secondary], looping seamlessly):
- frame 1 (top-left): neutral standing, [body part] at rest, [secondary subject] settled
- frame 2 (top-right): subtle [driving wave verb], [body part] slightly [direction], [secondary] drifts gently to one side
- frame 3 (bottom-left): peak of [driving wave], body slightly raised, [secondary] fully extended
- frame 4 (bottom-right): [reverse driving wave], body sinks back toward neutral, [secondary] recoils the OTHER way
```

### 帧数的判据（cyclic loop vs held pose）

文档里把这条讲透了，因为它直接决定资源量与成本：

> "Frame count is decided by the state's **intrinsic body motion**, not by whether the engine
> moves the character through the world. **Position is engine / transform-driven for every
> state** (idle, run, jump — all get their world position from code), so 'the engine drives
> position' is NOT the discriminator."
>
> - **Cyclic in-place motion → multi-frame loop**：`idle`（呼吸）、`walk`/`run`（腿循环）、
>   `hover`（起伏）——身体在原地动，需要多帧
> - **One held characteristic pose → single frame**：`jump`/`fall`/`dash`/`bounce`——
>   身体保持一个可读姿态，由引擎平移过去，**一个代表帧就够**
>
> "Pack the held-pose states into one sheet (see `pose_bundle`) so scale, palette, and
> outline weight stay identical across all of them in a single generation."

### 变体行 × 动画列网格（一个很实用的批量技巧）

当同一动画需要多个换色/换皮变体时（红/蓝/金特效、元素法术变体、调色板互换的敌人死亡）：

> - **行 = 变体，列 = 共享动画帧**（如 `3x4` = 3 变体 × 4 帧）
> - 声明：第 N 帧在**每一行结构完全一致**（同剪影/同碎片布局/同时序），只有主导色逐行不同
> - 切割后命名 `<variant>_<n>`（如 `red_0..3`），引擎就能把一行的变体当一个剪辑播

### `slicable_sprite.md`：可切物体的三段式

针对水果/箱子/石头这类"能被切开"的物体，给了专门的生成契约：

**核心规则**：不要做"一张带烘焙特效的插画"，必须生成**干净的运行时可组合部件**：
`whole`（完整）+ `left`（左半）+ `right`（右半）+ **独立 VFX**（果汁/尘土/火花/纸屑——
**不得烘焙进本体**）。

**Raw 生成形态**：一张**水平三联图**，从左到右 `whole / left / right`，
纯色背景，三联之间留足色隙（否则自动切割会粘连）。
文档给了**完整的 prompt 模板**，其中关键约束包括：

> - The sliced halves must visually match the whole object: same outer colors, same material
>   style, same outline language, same interior material colors, matching cut angle, and
>   believable paired left/right halves.
> - **Do NOT include any hit VFX, liquid, splashes, droplets, dust, sparks, pulp, fragments,
>   motion streaks, trails, labels, UI, shadows, floor, table, hands, weapon, or background art.**
> - The body sprites must be clean and dry; feedback VFX will be separate assets.

**匹配规则**（交付前必须检查）：外剪影家族匹配／调色板与材质语言匹配／
切面色与内部材质匹配／左右两半像"一对"而非两个无关变体／
茎叶冠盖把手等细节保持附着（除非设计明确要分离碎片）／
**本体上没有任何烘焙的果汁尘埃火花**。

**常见失败**（文档直接列出）：果汁或冲击爆发被烘进本体／
左右半用了不同切角或不同材质风格／半块看起来像两个独立完整物体／
分离的叶子变成独立切割件／抠图后仍有色键光晕。

## 3.7 Placeholder 机制：整套设计的枢纽

**这是"AI 能真的做出游戏"的关键基础设施**——让代码先行、美术后到，且**替换时不用改一行代码**。

两种占位条目：

| 类型 | 机制 |
| --- | --- |
| `placeholder_atlas` | **无 `path`**；引擎把**语义帧名**映射到内置 `__placeholder_atlas__`（8×8 网格、64 个 32×32 命名单元）。于是 node.json 从第一天就用 `visual.type: "atlas"` 与真实帧名 |
| `placeholder_image` | **无 `path`**；引擎把语义 key 注册为生成的 Phaser 纹理，同时通过 `sceneTree.ui` 解析为生成的 PNG data URL。`shape`（`rectangle`/`circle`/`hex`）+ `color` 是**外观提示**，不是运行时尺寸 |

```json
"player_idle": { "type": "placeholder_atlas", "frames": ["idle_0","idle_1","idle_2","idle_3"], "pivot": [0.5,1] },
"sword_icon":  { "type": "placeholder_image", "shape": "circle", "color": "#ff3366", "pivot": [0.5,0.5] }
```

**Polish 阶段只做 manifest 条目的替换**（保留同一 key 与同一帧名，去掉 placeholder-only 的
`shape`/`color`），node.json 与脚本不动。骨架 `index.md` 对此的说明：

> "Every manifest entry ships as a runnable `placeholder_atlas` or `placeholder_image` entry
> so **the skeleton opens and plays with no real art**. Swap manifest entries to real
> `atlas` / `image` entries with the same keys and frame names to add real art;
> **node.json and scripts do not need to change.**"

`prototype_polish` 契约还处理了一个**真实的例外**：**帧耦合事件**。
架构师必须在原型阶段就把"剪辑 — 玩法相关帧 — 该帧该发生什么"列进 `plan.md` 的
`Frame-coupled events` 小节（攻击命中框开关、冲刺激活窗、蓄力释放提交），
**polish 必须保留这些**。审查者的判据也与此绑定：

> "**Does NOT penalize** 'the art looks like color blocks' — that is the expected prototype state.
> **DOES penalize** gameplay logic that reads raw frame indices **outside the declared
> `Frame-coupled events`**, because that breaks the polish swap."

---

# Part IV 游戏能力层：模块 / 契约 / 骨架

## 4.1 十一个即插模块

模块 = 继承 `Node` 的可复用脚本，**从 scene JSON 直接挂载**（`script: "XxxModule"`）。
约束是：**一切调参走 `this.config`**，公开方法写在文件头。

| 模块 | 提供的玩法 | 关键配置面（节选） | 公开接口 |
| --- | --- | --- | --- |
| `SideviewFighterModule` | **横版战斗控制器**：走/跑/跳/冲/防御/防御走/攻击连段/格挡/处决，全由 config + animator 驱动，**零游戏专属逻辑** | `moveSpeed, runSpeed, guardSpeed, jumpForce, dashSpeed, dashDuration, comboWindowRatio, deflectWindowMs, attacks:{state:{hitbox,activeFrames}}, deathblow*` | `enableDeathblow/disableDeathblow/tryDeflect`；属性 `facing` |
| `StatusBarModule` | 精灵背衬状态条（HP/魔力/耐力/护盾/boss 姿态），右端裁剪式填充 | `{icon?, slot, bar, bbox:{x,y,w,h}, x?, y?, scale?, depth?, iconGap?, leftRate?, scrollFactor?, slotSize?, label?}` | `setLeftRate(v)` 0-1 |
| `MaskHUDModule` | 离散 N 格图标计量（面具/心/pip），尾部变暗 | `{iconKey, slotCount?, size?, gap?, anchorX?, anchorY?, depth?, dimAlpha?}` | `setValue(n)` |
| `GameOverlayModule` | **DOM 暂停/死亡/胜利/自定义菜单**，正确联动 Phaser 场景暂停 | `{menus:[{id,title?,subtitle?,pausesGame?,toggleKey?,buttons:[{label,action}]}], style?:{panelTexture?,buttonIdleTex?,...,panelWidth?,panelHeight?,containerId?,hurtFlashColor?}}` | `showMenu/hideMenu/isMenuVisible/flashHurt` |
| `DomCardManagerModule` | **卡牌手牌前端**：平面/弧形手牌、悬停抬升、拖拽出牌、目标高亮、图集裁剪卡面、提示条、拖拽箭头 | `{cardAtlas?, logicalWidth?, logicalHeight?, scaleMode?, layout?, cardW?, cardH?, xSpread?, arcCenterX/Y?, arcRadius?, hoverScale?, hoverLift?, neighborShift?, hitboxPad?, snapBackDuration?, arrow*, enemyTargetEffects?, targets?}` | `setState({cards,energy,phase,locked})`、`refresh(...)`、`setCardPlayCallback(fn)`；事件 `card_play_requested` |
| `SwipeSlashModule` | **滑屏斩击**：发光矢量拖尾 + 连续线段-圆命中检测 + 每次滑动去重 + 连击计数 | `{hostTag?, minDistance?, hitPadding?, trailMs?, depth?, glow*, core*, groups:[{tag,method,category?,defaultRadius?,stopOnHit?}]}` | 宿主钩子 `canSlash/onSwipePointerDown/onSwipeStart/onSwipeHit/onSwipeEnd`；`activeSlashSummary()` |
| `MinimapModule` | **DOM 网格小地图**：自动绘制正交通道连接，房间状态（隐藏/相邻/已探索/当前）+ 角色（起点/boss）用 CSS 类暴露 | `{mountSelector, assetUrlForKey, assetKeys?, style?:{roomW,roomH,gapX,gapY,padding}, elementId?, className?}` | `setRoomData(roomData)`、`setCurrentRoom(idx, exploredSet)` |
| `UpgradeChoiceModule` | **DOM 三选一升级**：分类带（攻/防/辅）、键盘 1..N 或点击、入场动画 | `{buffPool:[{id,label,desc,category,icon}], onSelect(buff), onClose?, choiceCount?, mountSelector, strings?}` | `show()/hide()/isVisible()` |
| `MagnetOrbModule` | 磁吸拾取物：进入范围后向目标 tag 加速 | `{visual:{...}, value?, pickupTag?, targetTag?, magnetRange?, maxSpeed?, acceleration?, depth?, x?, y?}` | 属性 `this.value`；`destroy()` |
| `ParallaxModule` | **视差背景单层**：TileSprite + scrollFactor + depth + 可选自漂移；叠兄弟节点成天空/远/近 | `{texture, frame?, x?, y?, width?, height?, originX?, originY?, scrollFactorX?, scrollFactorY?, depth?, driftX?}` | `runtimeState()` |
| `TimedImageVfxModule` | **一次性瞬态特效**：生成后在 ttl 内自动移动/旋转/缩放/淡出，支持纹理序列 | `{texture?, textureSequence?:[{texture,at}], ttl?, width?, height?, velocityX?, velocityY?, spin?, alphaStart/End?, scaleStart/End?, depth?, angle?, flipX?, flipY?}` | `runtimeState()` |

**评估**：配置面确实**很宽且全部走 `this.config`**（不是"复制改改"），
`SideviewFighterModule` 尤其明显——它把一整套横版手感参数（连段窗口比例、格挡窗口毫秒、
处决各阶段时长、残影数量与淡出时长）全部暴露，而把"伤害/命中判定/HP"留给项目层。

**每个模块还带两层自检**（这是可继承的真正价值）：

- **运行时 `_selfCheck()`**（在 `ready()` 里跑）：查物理体/animator/子节点/配置，
  打 `console.error/warn`，**不生成图片**
- **静态 `modules/check/XxxModule.check.py`**：被 `vibegame check` **自动发现**
  （节点声明 `script: "XxxModule"` → 找 `modules/check/XxxModule.check.py`
  → 调 `check(project, node_path, opts) -> list[str]`），
  消息前缀分级 `ERROR` / `WARN` / `PREVIEW` / `PASS`

以 `ParallaxModule.check.py` 为例（4.1KB，全文读过）：它断言
`config.texture` 存在且在 manifest 里、`config.frame` 若给了就必须是图集的合法帧名——
注释写明这是"否则会在运行时静默失败的那两个笔误"。
`SideviewFighterModule.check.py` 15KB，是三者中最重的。

自检的取舍原则写得很清楚：

> "**Assert anything that can be asserted directly. Do not generate an image and make
> reviewers guess.**"（可断言的：必备 config 键、manifest key 存在、animator 状态/参数/剪辑存在、
> 纹理/帧存在、子节点/tag/hitbox/动作名存在、跨结构引用如 `config.actions[*].state` 指向存在的状态）
>
> "For anything requiring visual review, generate `PREVIEW` images instead of describing the
> issue in text."（该预览的：精灵与碰撞体对齐、动画帧带与激活帧正确性、
> 攻击/受伤/传感 hitbox 覆盖的帧与身体区域、模块自有 DOM/canvas 视觉与配置尺寸/锚点/偏移是否一致）

## 4.2 契约系统：把"已验证的跨角色生产流程"固化成文档

**契约 = 针对某类反复出现的游戏特性，把"谁做什么、按什么顺序、怎么验收"写成可复用流程。**
`spec/contracts/index.md` 是选择目录。

**选择纪律**（写在 index 开头）：

1. 每个新任务开始时扫一遍这张表
2. 生产类型匹配的，打开契约读其 Pattern 的 `### When to use`
3. **每个适用契约恰好选一个 Pattern**
4. 把决策写进 `prd.md` `Reuse / Constraints`：
   `Use <contract> pattern <pattern-slug> because <task-specific reason>.`

**"Pattern 只能由编排者选"** 是硬规矩——设计师、架构师、下游都不选。
并且："若表中没有匹配的契约，就用 `spec/engine/` 的默认指南。
**不要在 `prd.md` 里现造一个契约**；若某生产类型反复出现，提给 `self-evolve` 流程去收编成真契约。"

**契约 schema**：

```
## Pattern N: <kebab-slug>
### When to use          — 产出的工件、IO 形状、运行时行为、协调边界；且只写"已验证过的确切类型"
### Basic Knowledge       — 当需要先验常识才知道"为什么要这么做"时使用
### Responsibility
    #### Artist           — （若有实质工作）必须带 ##### Workflow 三步：Generate / Package / Verify
    #### Architect/Programmer/Auditor/Player/Reviewer/...
### Manifest and asset boundary   — 可选，跨角色的资产边界规则
```

`index.md` 还收录了一条**质量守则**（针对"能力优先"的写法）：

> "`### When to use` is capability-first... **State the exact game type or feature slice where
> the pattern was practice-verified. Do not 'reasonably' infer other game types that could
> also use it.** No 'also works for', 'good fit for', or game-name lists unless those exact
> cases came from completed projects."

**十一份契约的清单**：

| 契约 | 生产类型 | Pattern |
| --- | --- | --- |
| `rastermap.md` | 关卡/竞技场布局 | `rastermap`（单张手绘背景 + 显式不可见碰撞体） |
| `tilemap.md` | 关卡/竞技场布局 | `tilemap`（可复用瓦片网格 + 瓦片级碰撞） |
| `status_bar.md` | UI 状态条 | `sprite-backed-status-bar` / `fighting-hud-dom` / `discrete-icon-meter` |
| `game_overlay.md` | 暂停/死亡/胜利菜单 | `dom-overlay-with-phaser-pause` |
| `charge-family.md` | 蓄力-释放技能动画包 | `three-sheet-charge-release` |
| `digit.md` | 数值 HUD | `dom-css-digit-hud` |
| `dom_card.md` | DOM 手牌前端 | `dom-card-hand-frontend` |
| `sideview_fighter.md` | 玩家战斗控制器 | `sideview-fighter-module` |
| `prototype_polish.md` | 原型→真实美术工作流 | `prototype` / `polish` |
| `parallax_background.md` | 滚动多层背景 | `scrolling-parallax-layers` |
| `runtime-ai.md` | 运行时 AI | `chatbot-as-game-character-or-player` |

### 重点契约一：`rastermap.md` —— 手绘背景与碰撞体对齐（含一个完整的跨角色闭环）

这是"**AI 生成的背景图怎么变成可玩的关卡**"的答案。流程是一条**五角色链**：

| 角色 | 职责 |
| --- | --- |
| Orchestrator | 在 prd 里写明选用该 pattern；**点名必需地标**（地面线、平台 bbox、墙界、竞技场边界、击杀区） |
| **Artist** | 生成一张含可见地形的背景 PNG；**用 `vibegame art label` + VLM 确认估算地标**；把最终地标写进 `assets/manifest.json` 的该资产 `landmark` 块；**不写 scene JSON** |
| Architect | 读 manifest 的 `landmark` 块；**把源图像素地标换算为世界空间碰撞体位置**；规划不可见静态碰撞体；缺地标则报 `[MISSING LEAD DECISION]` / `[ASSETS GAP]` |
| Programmer | 加背景节点；加 `script: "Collider"` + `body: "static"` 且**无 `visual`** 的地图碰撞体；**不许用可见 rect/circle/image 占位**；碰撞体命名保持稳定以便运行时调 |
| **Player** | 跑游戏、**用 Runtime API 现场调碰撞体位置**；用截图 + VLM 二元问答（"脚在可见地面：上/下/正好"）；**收敛后把最终值写回 scene JSON**；存前后截图与 VLM 判定为证据 |
| Reviewer | 若地形碰撞体在正常运行中可见 → 拒；若玩家脚浮空或下陷 → 拒；若墙碰撞早停或越过可见边 → 拒；**用地外部 VLM 判定做像素对齐检查** |

**`landmark` 元数据格式**（写在图像资产上，引擎不消费，**是给 agent 的**）：

```json
{
  "forest-arena": {
    "type": "image", "path": "levels/forest-arena.png",
    "landmark": {
      "bbox": { "left-ledge": { "x": 430, "y": 630, "w": 260, "h": 30 } },
      "markY": { "ground": 840 },
      "markX": { "left-bound": 60, "right-bound": 1860 }
    }
  }
}
```

规则注明：坐标系是**源图像素、左上原点**；碰撞体是**纯物理不可见**（`script:"Collider"`
+ `collider` 字段 + **无 `visual`**）；`vibegame run --debug` 可显示物理体供取证，
但**不得在项目配置里打开 debug 视觉**；**"The engine never infers collision from image pixels."**

滚动地图还给了具体做法：把图像 `pivot` 设到滚动起始边
（横向滚动 `[0, 0.5]`，纵向 `[0.5, 0]`），节点放在滚动轴 0 与另一轴画布中线；
不够长就**首尾相接多张**，"**Never stretch a single image to make up the distance; it only blurs.**"

### 重点契约二：`tilemap.md` —— 含真实"为什么"的先验知识

这份契约是最能说明"契约不只是流程、还携带先验"的例子。它有一个
**`### Basic Knowledge` 章节，专门解释为什么需要 face/top 分离**：

> "Game engines usually support fixed-size square tiles in a tilemap. To make non-square
> wall/door sprites usable in that tilemap, use this structure:
>
> 1. Resize the raw wall/door sprite to `w x h`, where `w = tileSize` and `h` is between
>    `1x` and `2x tileSize`. It must be taller than the floor tile, but if it is taller than
>    `2x`, the visual result usually looks wrong.
> 2. **Split each wall/door horizontally into two uneven tiles**:
>    `face(tileSize x tileSize)` + `top(tileSize x (h - tileSize))`. The `top` tile does not
>    fill its whole tile cell. Its visible content sits near the lower part of the tile.
>    Then place `wall_face`/`door_face` at each wall/door face position, place the matching
>    `top` tile in the grid cell above that face, and set depth to
>    `wall_top = door_top > wall_face = door_face > floor`.
> 3. With this setup, every wall that has another wall below it will have the lower wall
>    column's `top` tile covering the lower part of its face cell. It is not literally half,
>    but **visually it reads like tilted-view occlusion**.
>
> **Follow this principle. It is the strongest prior for implementing this pattern.**"

**它还内嵌了一段完整的、经过验证的 tileset 生成 prompt**（约 60 行），
核心约束包括：3×3 稀疏图集、第 1 行是墙/门立方体块、第 2/3 行是地板方块、
**正交 45° 俯视而非真 3D 斜投影**、顶面与正面**同宽且左右边缘对齐**、
剪影必须是**干净的竖直矩形（像立着的多米诺）没有任何斜边**、
每格都有显式语义描述。并点明：

> "The key part of this prompt is **not** the 'sandstone dungeon' theme. The key constraints
> are: a 3x3 sparse raw sheet... Row 1 contains wall / door cuboids. Rows 2/3 contain floor
> square slabs. Wall / door and floor share the same footprint. **The top face and front face
> of each wall / door have the same width.** Every cell has an explicit semantic description."

还有一张 **ASCII 房间图例**定义瓦片语义（`.` 地板 / `F` 地板+墙正面 /
`W` 地板+墙正面+墙顶 / `D` 门 / `d` 门复用墙顶 / `+` 走廊地板）：

```text
WWWWWWW
W.....W
W.....W
W.....W
FFW.WFF
..W+W..
..W+W..
..W+W..
```

以及两个很实用的**工程提示**：
"水平与垂直走廊必须共享一套视觉语言，如果走廊瓦片是有方向的，
两个形态应是彼此的 90° 旋转"；"**地板变体应低比例混入，不要全随机铺成高噪音地面**"。

**Common mistakes 也直接列出**：把墙/门做成一张高精灵然后指望一格渲染两格高／
`wall_top` 与 `wall_face` 不属于同一视觉体／门丢失墙体家族语言／
地板变体过多抢焦点／只交图不交瓦片清单／**"Asking the model for a packed semantic
tileset that is already engine-ready. This path is unstable."**

## 4.3 五套可运行骨架

`skeletons/index.md` 是**选择目录**（带 "When to use" 与 "When NOT to use" 两列）：

| Slug | 形态 | 何时用 |
| --- | --- | --- |
| `2d-action-boss-fight` | 1v1 横版 boss 战：竞技场场景、玩家 FSM、boss FSM、弹道、FX、HUD、覆盖层、剥净的 manifest | 空洞骑士/茶杯头/Sekiro-2D 风格的单挑切片 |
| `roguelike-deckbuilder` | 固定屏回合制卡牌战：牌库/手牌/弃牌/能量循环、底部弧形 DOM 手牌、敌人意图、奖励选择 | 杀戮尖塔式单场战斗 |
| `roguelike-dungeon-shooter` | 俯视房间制地牢射击：程序化房间图、瓦片地板墙、玩家移动+远程武器、敌波、掉落、boss 房、小地图、升级三选 | 吸血鬼幸存者/元气骑士/挺进地牢 |
| `swipe-slice-arcade` | 固定单屏指针滑切：抛物线飞物、切开成物理两半+特效、连击、危险物即死、对数难度曲线、DOM HUD | 水果忍者式 |
| `2d-bounce-parkour` | 侧视精准弹跳平台：玩家 FSM（idle/run/jump/fall/dash/bounce）、单次空中冲刺、浮空弹跳目标、多阶段 + localStorage 最佳成绩、DOM 像素字体 HUD、视差背景、相机跟随+震屏 | 蔚蓝式"不要落地"弹跳跑酷 |

骨架的**三层结构**（自进化技能里定义）：

1. **游戏逻辑**：`project.json` / `scenes/` / `scripts/` / `entities/` / `config/` / CSS /
   字体选择 / 主题布局 / placeholder-safe 的 `assets/manifest.json` / `index.md`。
   **"The best conversion only changes texture references to placeholders."**
   必须保留场景流、视觉比例、显示尺寸、碰撞体尺寸、相机边界、时序、布局、`runtimeState` 形状
2. **美术资产**：`art-pack.md` + 可选 `art-pack-assets/`（由 artist 侧负责）
3. **错误**：`errors.md`（由编排者负责）

### 解剖 `2d-action-boss-fight`（最完整的一套）

**运行时形状**：视口 960×540；竞技场 1440×540 带水平相机夹取；
一个常驻玩家节点 + 一个常驻 boss 节点；弹道与 FX 运行时经 `.node.json` 模板生成；
玩家 HP 用 `MaskHUDModule` 离散 pip；boss HP 用 `StatusBarModule` 底部条；
暂停/死亡/胜利用 `GameOverlayModule`；三者都暴露 `runtimeState()`。

**玩家 FSM 十二态**：
```
IDLE, RUN, JUMP, FALL, DASH, ATTACK, AIR_ATTACK,
CHARGE_BUILD, CHARGE_FULL, CHARGE_RELEASE, HURT, DIE
```
核心规则：`_setState()` 是唯一转换入口且**幂等**；`_syncVisualState()` 映射到剪辑；
移动态读移动/跳/冲/攻击输入；**承诺态锁输入直到玩法计时器清零且非循环动画结束**；
**命中框激活窗与动画/动作锁窗分离**；蓄力流是 build→full→release，早放退回普通攻击；
**冲刺是动画驱动的，所以距离 = `dashSpeed * dashClipDuration`**。

**Boss FSM 七态**：`IDLE, APPROACH, WINDUP, ACTIVE, RECOVERY, HURT, DIE`。
攻击流 `windup → active → recovery`。核心规则：距离决定攻击选择；冷却防连发；
`boss.node.json` 的内联 `config` 里可选 `frameEvents` **把攻击事件绑到动画帧**
（进入 active、开命中框、生成 FX/弹道、启动突进位移）；
前摇与后摇等待非循环动画完成；**active 计时器独占伤害窗**，结束即关命中框；
**boss 只在 idle/approach/recovery/hurt 时受创踉跄，攻击中保持承诺**。

**FX 与弹道模式**（一段很清楚的职责划分）：`OneShotFx` 管临时视觉并在非循环动画结束时自删，
**纯视觉、永不拥有碰撞体尺寸**；攻击命中框是**专用子 `Collider` 节点**，
带声明的宽高/偏移/`flipWithParent`，**脚本只 enable/disable，永不运行时改尺寸或位置**；
突进的 active 命中框**把精灵 FX 作为子节点挂上**，于是碰撞体与攻击 FX 一起被检视。

**`errors.md`：七条真实失败模式**（本文认为这是整套体系里最有价值的单件资产）：

| # | 症状 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | 玩家走路但动画永远停在第 0 帧 | `play()` 默认 `restart=true`，而状态机每帧调 `_syncAnim()` | **幂等状态设置器**：`_setState(s){ if(this.state===s) return; ... }` |
| 2 | boss 追击时朝向反了（与玩家同一套逻辑） | **不同美术的默认朝向不同**（玩家朝右，boss 可能朝左） | 在每个角色脚本里**注明默认朝向**，翻转条件按它写 |
| 3 | 冲刺用一次后，冷却到了也再不能用（除非跳一下落地） | 用**事件边**（离地→落地）重置标志，从不离地就永不见该边 | 改用**状态谓词**：`if (isGrounded && cooldown<=0) canDash = true`。"同一规则适用于二段跳、蓄力可用性、格挡窗口" |
| 4 | 薄视觉+厚碰撞体（1×1 空白视觉 + 1440×20 碰撞体）→ 玩家掉穿 | 默认同体模式下 `body.setSize` 会被 `gameObject.scaleX`（≈1/视觉宽）除回去 | `collider: { body:"static", host:"separate", width:1440, height:20 }` |
| 5 | boss 设了 `immovable:true`"因为不该被玩家推动"→ boss 掉穿地面 | **Phaser 要求一对碰撞体中至少一方可动**才能施加分离冲量；地面是 static（等同 immovable），boss 也 immovable → 无解 | boss 用 `immovable:false`；若要抗推，用 `immovable:true` **同时把玩家↔boss 那对改成 `overlap`（传感器）** 或命中时手动 `setVelocityX(0)` |
| 6 | player agent 验收失败：`runtimeState()` 缺 PRD 断言字段 | runtimeState 写码时定、PRD 判据后来扩 —— **漂移** | 三个控制器的 `runtimeState()` 覆盖所有 PRD 可见状态（玩家：位置/hp/状态/朝向/是否着地/无敌；boss：位置/hp/maxHp/状态/当前攻击/AI 开关；根管理器：fightOver/victorySide）。"**加新状态机时，把 runtimeState 对照 PRD 审计作为交付前的最后一步**" |
| 7 | boss 地面猛击的裂缝特效**跑到地板下面** | 运行时生成的 FX 相对**生成者原点**定位；脚锚角色（`collider.pivot [0.5,1]`）的原点 y 就是**脚/地面线**而非身体中心，于是大的正 `offsetY` 把中心锚的 FX 推到地下 | 脚锚生成者的地面接触 FX，`offsetY` 保持在 0 附近（小负数让冲击带坐在表面上）。"记住：底锚的 `boss.y` **已经等于**地面线" |

**每条的格式**：`## N. <症状标题>` → `### Symptom` / `### Cause` / `### Fix`（含代码）
→ **`**Spec update**: <指向被改的骨架/引擎指南/检查的地方>`**。
最后那行是**闭环**：它保证"这个教训进到了某个未来项目会读到的地方"，
而不是躺在某次对话里。（例如第 1 条的 Spec update 写明
"骨架的两个控制器都带这个 guard，新的横版动作脚本应照抄"。）

### `art-pack.md`（724 行）：实证资产配方

与 `self-evolve` 配套，`art-pack.md` 记录**这个子类型实际用过的原始图与 prompt**。
结构：

```
## <分组>            # Map / Player / Boss / FX / UI ...
### <原始图名>
- prompt
  ```
  <verbatim prompt>
  ```
- layout: <sheet 形状>
**Hints**                       # 可选，仅当该原始图偏离通用规则时
- <与通用规则的差异>
```

示例（boss 战的竞技场背景）的 prompt 里能看到完整的方法论：
**风格锚定**（"use the project style reference as the style anchor"）→
**目标合成**（1440×540 世界、侧视、无透视倾斜、地面线在下四分之一）→
**场景内容清单** → **硬排除清单**（无角色/无斩击/无弹道/无 UI/无文字水印边框网格线）
→ **可玩性收尾**（"保持竞技场可玩：清晰水平空间、可读地面线、左右墙界、
与小尺寸白色角色和白色斩击 FX 有足够对比"）。

### 自进化如何把上述一切变成"下一代的更高起点"

这是 Part IV 与 09-03 报告里"自进化"机制的交汇点。四目的地中，
**骨架与契约这两件事的实际内容就是 Part IV 描述的那批文件**：
项目收尾时，编排者把"这个项目里证明有效的东西"按严格门槛提升为
`skeletons/<slug>/`、`modules/`、`.vibegame/spec/contracts/`，
并且（这是关键）**规矩是"只提升真实任务里承重的，不发明没用过的先验"**：

> "**Ship only what was load-bearing in a real task. Do not invent priors that were never used.**"
> "**Your job is to let future orchestrators choose, not to force a choice.**
> Keep `### When to use` grounded in verified capability, not plausible genre extrapolation."

模块提权的取舍标准也很明确：

> "Pure gameplay logic is usually easy to rewrite correctly. **Code that affects visuals and
> real runtime feel is easier to get subtly wrong and harder to test**, so it is more valuable
> to preserve as a module."

---

# Part IV.5 游戏验证层：怎么知道"这游戏真能玩"

游戏开发绕不开"改完怎么验"。VibeGame 在这一层的答案很完整，且**全部围绕游戏的特殊性**
（状态在跑、画面主观、手感不可读）设计。

## 4.5.1 帧同步运行时控制：让 agent 按自己的节奏验

这是整套里最硬的一段工程。它不靠 rAF 拦截、不靠 `scene.pause()`，
而是**把帧门做在引擎自己的 update 调用里**：

```js
// SceneTree.update(time, delta)
if (this.runtimeController) {
  if (!this.runtimeController.shouldUpdate()) return   // ← 帧门
  this.propagateUpdate(this.root, delta / 1000)
  this.inputMap?._advanceFrame()
  this.runtimeController.postUpdate()
  return
}
if (!this.running) return   // 正常模式：running 标志控制
```

`shouldUpdate()` 是四态状态机（未启用直通 / 暂停返回 false / 步进递减预算并耗尽时转暂停 /
播放直通）。关键设计：**`continue(N)` 返回 Promise 且被 WS 层 `await`**，
于是 HTTP 响应被挂起直到那 N 帧真的跑完——`vibegame play continue -f 30`
意味着**恰好 30 次 update 通过**，不是 500 毫秒。**agent 的墙上时钟与游戏时间解耦了。**

配套三件事都是真做的：

1. **语义输入注入打在脚本 API 边界**：`input` 命令改的是 `InputMap._injected`，
   于是 `isPressed()`/`isHeld()`/`isReleased()` 全部照常工作，
   连**释放边**都由 `_advanceFrame()` 逐帧快照合成。于是"按住→松开"这种最考验时序的
   测试不需要真实按键时序。
2. **游戏自述状态**：脚本可选实现 `runtimeState()`，返回值进 snapshot 的 `runtime` 字段。
   引擎不知道什么重要（选中单位、激活面板、跳跃缓冲），所以让游戏自己声明。
   同理 `breakpoint(reason)` 由游戏代码调用，回传 `{status:'breakpoint', node, reason}`。
3. **两个控制面按延迟选**：agent 走 WS（语义 + `eval` + 可观测性），
   bot 走 `window.__vibegameTest` 的同步 `page.evaluate`（免 HTTP 往返）；
   且 controller **总是被构造**，只在需要时才 activate——所以 bot 模式能取 snapshot 而不暂停游戏。

**19 条 wire 命令**覆盖：激活/停用/继续/暂停/播放/快照/输入/设值/点击/移动/拖拽/按键/
eval/状态/console 读取/network 读取。加上 console 与 network 的**环形缓冲区**
（各 200/500 条，带单调 `seq` 支持 `?since=` 增量拉取，console 错误 1 秒窗内去重）。

**也给了逃生口与纪律**：`vibegame play eval` 可注入任意 JS（拿到 `sceneTree`/`host`/`runtime`），
但文档明确警告 **"Do not inspect gameplay through `window.__vibegameRuntime`;
it is browser bridge plumbing, not the scene tree."**；
`batch` 在同进程跑多条命令（省每次 ~0.5s 的 Python 启动），首失败即停并回传当前 snapshot；
`record`/重放把一次成功验证固化成 `play.sh`（证据落 `logs/step_NNN.png`）。

## 4.5.2 bot 协议：让 AI"自己玩自己做的游戏"并留下可复核证据

契约极简（bot 是 Python 脚本，**不许 import Playwright**，runner 持有浏览器）：

```python
def decide(snap, ctx): ...                      # 必须；snap 形状与 snapshot 命令一致
META = {"name", "purpose", "max_seconds", "params"}   # 可选
def compact(snap, ctx) -> dict: ...             # 可选（trace 体积控制）
```

`ctx` 暴露 `KEY`（语义动作 → `KeyboardEvent.code`）、`scratch`、`elapsed_s`、`tick`。
动作是四元组 `(kind, key/payload, duration, reason)`；8 种执行
（`wait/tap/hold/down/up/mousemove/click/drag`）+ 3 种终止（`done/fail/breakpoint`）。

**三件产物**：

| 文件 | 内容 | 关键点 |
| --- | --- | --- |
| `video.webm` | Playwright 录制 | close 前抢 `page.video` |
| `trace.jsonl` | 每次决策一行 `{tick, t, action, state}` | **写在动作执行之前**，所以 `t` 是"决策时刻"而非"完成时刻" |
| `result.json` | `{ok, status, reason, setup_s, duration_s, decision_count, bot_meta, error, console_errors}` | **`ok = (status == "done")`** |

**`breakpoint` 是交接机制**：bot 发 `("breakpoint", None, 0, "<what looked off>")` →
激活运行时控制 → 打印后续命令 → 阻塞等 SIGINT。
**一个实时 bot 的发现因此转成可附着的调试会话，且视频仍在录。**

**最后一条纪律最关键**（`reviewer.md` 原文）：

> "Read `trace.jsonl` before accepting a pass; **`done` alone does not prove the intended
> phases ran.**"

## 4.5.3 "不算证据"清单：验收的四条反例

写在 `reviewer.md` 的 Minimal Checklist 里，四条全部针对**游戏特有的伪证据**：

| 不算证据的理由 | 原文 |
| --- | --- |
| **"帧在动"≠ 可运行** | "particles and tweens keep frame entropy high while gameplay logic is broken. Require state diffs, not 'the screen is moving'." |
| **"已 eval 验证"≠ 证据** | "eval bypasses the game loop; it proves a function exists, not that gameplay can reach it. Reject." |
| **旧轮次证据过期** | "a prior reviewer session's evidence is stale if any code changed since. Re-verify in the current session." |
| **为过测试改引擎是 workaround 不是修复** | "turning on a testing-only knob (e.g. Phaser `forceSetTimeOut`) in production code is a workaround, not a fix. Require the underlying bug be addressed." |

并给出**可运行的最低证据标准**（三条，逐条可机械核对）：
① 角色响应输入移动（前后位置必须不同，配前后截图）；
② 主行为触发（快照必须显示对应状态变化：敌人 HP 降 / 实例化了弹道节点 / 动画状态翻转，任一即可）；
③ 敌人/AI 活着（无输入时 t=0 vs t≈2s 位置或行为状态必须变化；完全冻结 = AI 没启动）。

以及**证据类型由验收项推导**的映射（`player.md`）：
状态类判据→snapshot 前后 + 数值/布尔断言；视觉类→该视觉时刻的截图；
手感类→交互轨迹 + 关键帧截图。**"多数验收项两者都要。"**

## 4.5.4 VLM：语义判官，不是尺子

`vibegame vlm` 是独立 CLI 动词（不是某个 gate 的内部件），
用 OpenAI 兼容端点打视觉模型，能力靠旗标 + prompt 表达：
单图二元问答 / 多图对比 / 目录批量挑选 / `-s` 传 rubric +
`--add-background magenta`（把透明精灵合成到纯色底，专治边缘光晕）。

**真正有价值的是它的认知约束**（`spec/cli/vlm.md`）：

> "VLMs … are **semantic judges, not measurement instruments**. They answer
> 'is this aligned / wrong / clipping?' reliably; they do not answer
> 'by how many pixels?' reliably."

- **可信**：二元/方向性 yes-no（"脚在可见地面的上方、下方、还是踩在面上？"）
- **仅作粗提示**：VLM 主动给的像素数字——"用来挑步长可以，**绝不直接代入数值**"
- **禁止提问**：绝对像素坐标 / 精确偏移 / 精确缩放

于是视觉微调被规定成**二分搜索**（改值 → 二元问 → 迭代），而非一次性求解。
`boss-design`/`rastermap` 都建立在这条之上（"脚在可见地面：上/下/正好"）。

还有一条**为什么需要外部模型**的诚实理由（`player.md`）：

> "You are a VLM yourself; the value of `vibegame vlm` is **context isolation** — a fresh
> model with no investment in your prior decisions gives more honest semantic verdicts than
> your own re-reading of a screenshot you have already looked at five times."

并配了一个**具名事故**作为硬规则的依据：

> "The HK boss-fight failures slipped through because the agent said 'looks fine' without a
> context-clean second opinion; the floating-above-ground was visible in the screenshots,
> but **the agent had stopped seeing it**."

## 4.5.5 静态检查（游戏资产层的机器门）

`vibegame check` 是**游戏专属的静态检查**，分两层：

| 层 | 内容 |
| --- | --- |
| **Schema 层** | 6 份 JSON Schema（project / node / scene / manifest / input-map / tilemap），用 `Draft202012Validator` 校验。分工原则写在文件头：**"结构规则（字段名/类型/必需/枚举）住在 schema 里；只有 schema 表达不了的东西（合法 KeyCode、跨文件一致性）才写进代码"** |
| **手写规则层** | ~40 条，覆盖：engine 目录存在性 / 硬编码 URL 契约（禁 `/game/...`、禁根路径资源、禁 `location.origin` 拼 URL）/ 脚本与模块命名后缀契约 / project.json 必需字段 / manifest（重复 key、缺 type、占位字段误用、孤儿 manifest、**同一图片被多个条目引用**）/ tileset 结构 / input-map 键合法性（硬编码 Phaser 3.80 KeyCode 集）/ 场景与节点定义（缺 root、children 非数组、`src` 文件不存在、script 解析）/ 视觉（ratio 与 width/height 互斥、texture 必须在 manifest）/ 动画（帧引用、`duration` 误用、**frame offset 要求 `collider.host:"separate"`**）/ animator（state 的 clip 必须存在）/ tilemap / `instantiate()` 引用预载 / JS 语法（`node --check`）/ JS 结构（缺 `import { Node }`、类名与文件名不符）/ `playAnim('X')` 的剪辑必须存在于某节点 |

**分级**：项目检查 `ERROR`/`WARN`（有 ERROR 则退出码 1）；
节点检查额外有 `PREVIEW`（"这是一个预览图路径"，不是严重度）与 `PASS`。

**渲染层的预览**（`node_check.py`）用 **PIL** 画：视觉在底、原点黄点 + 碰撞盒绿框 +
子碰撞体、以及 `--anim` 的横向帧带（可叠子节点半透明视觉与碰撞体）。
**但有一条重要的诚实提醒**：引擎是 JS，预览是 Python **平行重实现**，
无共享代码；其 docstring 声明的继承规则已与自身实现漂移
（写 `[0.5,0.5]`，代码返回 `[0.5,1]`），且 `--anim` 路径**完全不处理 per-frame `offset`**。
所以"预览复刻真实坐标"是**纪律而非机制**——`self-evolve` 里那句
"Do not write approximate coordinates just to make preview easier" 是提示词要求，
靠的是事后目检，不是代码保证。

---

# Part V 对照本仓：游戏开发视角

## 5.1 本仓在"游戏开发"上的真实现状

先说事实（逐项核证）：

| 项 | 状态 |
| --- | --- |
| 桌宠 Orca Pet | `specs/next-version/desktop-pet/design.md` —— **已立项未实现**；定位"锦上添花"；**铁律 core 零改动、明确不做小游戏** |
| `design-lab/` | **一个概念稿**：`design-lab/fps-hud/{README.md, fps-hud.html}`，零依赖 FPS HUD 模拟，自述"非产品源码、不引用任何 `packages/*`" |
| `designs/` | **空目录** |
| A2UI | 全域动态 UI 声明层（17 个工具），**交互层，不是运行时控制器**；纯 DOM/声明式，无游戏循环 |
| `browser.*` actions | 三个薄封装 → vendored `bsk`（腾讯 BrowserSkill）驱动真实 Chrome；**有 snapshot/click/fill/screenshot**，但完全在第三方二进制后面 |
| 离屏 Chromium | `web-fetch-provider.ts`：一个 `show:false` + `offscreen:true` 的 `BrowserWindow`，**只做 WebFetch 渲染**；用 Electron `webContents` API，**刻意不走 CDP** |
| design 系统 | `templates/design/macrostructures/` 10 个页面骨架 + `systems/` 9 个设计系统 + taste 技能（10 条 P0 + 20 条 gate + 五维自评）；`design.audit` 是**确定性零 LLM** 的三轴机检 |
| 游戏相关 spec | `specs/next-version/cad-3d-generation`（img2threejs 线）—— 3D 生成，非游戏 |

**结论**：本仓在"游戏开发"这条线上，**目前是一个已立项的桌宠 + 一些可复用的邻近能力
（设计系统 / 确定性审计 / A2UI 声明层），没有游戏引擎层、没有游戏设计知识、没有可运行的游戏基线。**

## 5.2 逐层对位

| 游戏开发维度 | VibeGame 实况 | 本仓现状 | 差距性质 |
| --- | --- | --- | --- |
| **引擎层：让 AI 写对** | 四条为 LLM 失效模式设计的产品约束（省略即继承 / pivot 级联 / UI 三路线 / 模板强制）+ 11 条 pitfall + 单位一致性 + 生命周期顺序 | **无游戏引擎**。A2UI 是声明式 UI 交互层，无游戏循环、无物理、无帧时序 | 本仓缺**整层** |
| **声明式数据模型** | `project.json → scene.json → NodeDef` 三层全文本 + 5 条跨文件依赖规则 + 6 份 JSON Schema | `packages/core/templates/design/` 有 `.dd` 设计文档格式 + 模板/设计系统；**面向网页/文档，非可运行物** | 本仓的声明式是**文档级**；VibeGame 是**可执行级** |
| **设计知识库** | 19 份设计理论与模式（含 boss 遭遇参数表、UI/HUD 惯例表、正负反馈框架）+ 三档注入机制（always / design.jsonl 自选 / on-demand）+ **intent vs production 分层纪律** | taste 技能（**面向视觉/版式**，10 条 P0 + 20 gate）+ macrostructures（**页面骨架**）；**无玩法设计知识**（无核心循环/MDA/难度曲线/遭遇设计） | 本仓有**视觉设计**知识，缺**玩法设计**知识 |
| **美术管线** | 16 动词全链 + **纯色键抠图（非模型，可靠）** + 轮廓切帧 + 内联 bbox 图集 + 像素归一化 + 从深处填充修边 + **一整套 sprite prompt 工程学** | `imagegen` 技能存在（图像生成）；designer 线有视觉资产；cad-3d 线走 img2threejs；**无"生成→可用游戏资产"的后处理链**（抠图/切帧/图集/像素归一） | 本仓有**生成**，缺**后处理成可用资产** |
| **游戏能力层** | 11 个参数化模块（战斗/状态条/卡牌/小地图/升级三选…）+ 11 份跨角色生产契约（含 Basic Knowledge 讲"为什么"）+ **模块随附静态检查** | `packages/core/src/actions/` 44 个 action 是**工具调用**（review/crg/design/prototype/task），不是游戏玩法单元 | 本仓的"能力单元"是**开发工具**；VibeGame 的是**玩法构件** |
| **可运行基线** | 5 套可打开可玩的骨架 + **placeholder 机制**（代码先行、美术后到、替换零改码）+ **`errors.md` 7 条带 Spec update 闭环的失败记忆** | 无 | 本仓缺**整层**，且这是最难自建的一层（需要真实项目沉淀） |
| **验证/验收** | bot 三件套 + "不算证据"四条反例 + 证据类型映射 + VLM judge-not-ruler + rastermap 脚对齐二元检查 | `review.full` 三源合并（git diff + CRG + churn）**文本证据强**；`design.audit` 确定性机检；`prototype.verify` 重新计算式验收；**无"运行起来对不对"** | 本仓能做"代码变了什么"，做不到"跑起来对不对"（09-03 已记，此处从游戏视角再确认） |

## 5.3 本仓真正缺的三件事（按"自建难度"排序）

1. **可运行物这一层**（最难自建，也最值钱）。
   VibeGame 的骨架价值不在"5 个模板"，而在**它们是可打开可玩的**，
   且**靠 placeholder 机制让代码与美术解耦**。这套东西无法靠读文档获得——
   它需要真实项目跑通后沉淀（这正是 `errors.md` 的七条从哪来）。
2. **玩法设计知识**（中等难度，但需要取舍）。
   本仓的 design 实践在**视觉/版式**（taste 三轴、macrostructures），
   而 VibeGame 在**玩法**（核心循环、难度曲线、遭遇设计、反馈环、公平性）。
   两者不重叠，是正交的两块知识。
3. **"为 AI 写码"设计的产品约束**（最易起步，也最易被忽略）。
   四条约束（省略即继承 / pivot 级联 / UI 三路线 / 模板强制）本质是
   **把 LLM 的失效模式提前变成 API 语义**。这条经验对本仓任何"AI 生成物"的场景都适用，
   不限于游戏。

## 5.4 本仓已经更强、不需要对位的部分

- **确定性审计**：`design.audit` 是零 LLM 的三轴计算；VibeGame 的 `check.py` 强在
  **数量与覆盖**（~40 条规则 + 6 份 Schema），但 taste 类的"审美三轴可计算"是本仓独有。
- **知识回写机制**：`skill-up` CI（每晚跑、可红）、`memory.distill`（四类提案 + 去重 +
  复核 + 经原生工具回写）、`memory.audit`（从**失败**学习）——比 VibeGame 的
  `evolve` CLI（实测是校验+原子拷贝）更成熟。
- **规格生命周期**：`specs/` 五区（active / next-version / review-ing / branch-implemented / archive）+
  `git mv` 强制 + 研究台账图例——VibeGame 的 per-task 四契约件（prd/plan/log/context）很轻，
  本仓的规格治理更完整。
- **任务结构**：task tree 带 `why` 必填（"没有叙事结构的结构是无用的"）、
  artifactRefs / memoryRefs / sessionRef / snapshot——比 VibeGame 的 `tasks.jsonl` 丰富。

---

# Part VI 可借鉴清单（只记发现，不给落地方案）

> 集成深度沿用 09-03 标度：L0 = 知识/提示词层；L1 = 用户可选外挂；L2 = 内置能力；
> L3 = 源码级继承。**全部以 `∥` 状态记账，不排序、不启动、不另立 spec。**

| # | 发现的游戏开发能力 | 深度 | 为什么值得记 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | **四条"为 AI 写码"设计的产品约束**：省略即继承（含"When in doubt, omit"判据与反面动机）/ pivot 四级级联（含"何时覆盖"判定表）/ UI 三路线 + 禁 `Phaser.Text` + "UI 首版即须匹配美术"/ 程序化实体必须走模板（含预载陷阱） | L0 | 这不是引擎技巧，是**把 LLM 失效模式变成 API 语义**。任何"AI 生成物"场景都适用 | `entity-guide.md` / `collision-guide.md` / `animation-guide.md#pivot` / `ui.md` |
| 2 | **11 条 pitfall 清单**（每帧 `playAnim` 冻结动画 / `sprite.width` vs `displayWidth` / `body.x` vs `physicsObject.x` / `instantiate` 预载 / `=== n` 判帧跳帧 …） | L0 | **AI 生成游戏代码的失效模式集合**，逐条都有"后果 + 正解"，可直接作为生成提示词的负面清单 | 各引擎指南的 `> **Pitfall**:` 段 |
| 3 | **intent vs production 的分层纪律**（设计只写 action category / object class / spatial origin；禁写帧数、像素、具体运动、连实现形式都不写）+ **一行 GDD 声明格式** | L0 | 这是"设计意图如何在不锁死实现的前提下保持可执行"的答案；理由（"锁死数字会在后续调参时崩"、"要求图像生成做不到的视觉精度"）比规则本身更有价值 | `boss-design.md` / `ui-conventions.md` 首尾对照表 |
| 4 | **boss 遭遇设计参数表** | L0 | 视觉尺度启发（屏高一半）、攻击三类与名词类要求、telegraph 四类、按类型分级的可打断性、5 种移动模式、2-4 招轮转 + ±20% 随机化、阶段转换 | `patterns/boss-design.md` |
| 5 | **UI/HUD 惯例表**（每项的默认 + 覆盖条件 + 理由），含**误击反馈与"超级护甲"的按类型判定表** | L0 | "该不该显示"的决策被变成了可查表；`hit` 动画与可打断性的闭环要求（"只要踉跄就必须有 hit 动画"）很实用 | `patterns/ui-conventions.md` |
| 6 | **`errors.md` 失败记忆格式**：症状/根因/修法（含代码）/**`**Spec update**:` 闭环行** | L0/L1 | 本仓完全没有这类资产。七条内容本身也可直接用（Phaser immovable 不分离、薄视觉厚碰撞体需 `host:"separate"`、冲刺重置用状态谓词而非事件边） | `skeletons/2d-action-boss-fight/errors.md` |
| 7 | **sprite prompt 工程学**：参数分类学 / sheet 尺寸与用途映射 / 全局硬规则 / containment 规则 / view 规则（side 一律朝右，**错了就 hflip 不重生成**）/ 具名 IP 规则（点名而非描述）/ **idle 四帧单一连续微循环的八条写法** / 帧数判据（cyclic loop vs held pose）/ **变体行 × 动画列网格** | L0 | 这是"如何稳定生成可切片的游戏资产"最具体的一份规范；idle 写法与帧数判据可直接迁移到任何序列帧生成场景 | `spec/art/sprite.md` |
| 8 | **纯色键 + 泛洪抠图路线**（默认 `#FF00FF`，主体含洋红则换色）+ **容差漂移的实测排障流程**（采样角像素 → 显式 `-c` + 提容差 + `--defringe`） | L2 | 不依赖模型、确定性强、可预期；"生成模型给的颜色会偏"这个现实与应对值得记 | `rmbg.py` + `sprite.md` 全局规则 |
| 9 | **切帧 = 轮廓检测**（OpenCV，min_area 过滤 + 行列聚类排序，可选 VLM agent 路径）+ **`cut --label` 只写 bbox 不裁图**（内联 atlas，无需独立 atlas JSON） | L2 | "不固定网格"这个选择对抗了生成图不听话的现实；内联 bbox 简化了资产与引擎的接口 | `cut.py` |
| 10 | **placeholder 机制**：`placeholder_atlas`（语义帧名映射内置 8×8 图集）/ `placeholder_image`（`shape`+`color` 生成）→ polish 只换 manifest 条目，**node.json 与脚本零改动** | L2/L3 | 整套设计的枢纽：让"代码先行、美术后到"真正成立。配套的 `Frame-coupled events` 例外处理（帧耦合玩法必须在原型期声明、polish 必须保留）同样重要 | `project-setup.md` + `prototype_polish.md` |
| 11 | **美术管线 16 动词的完整职责划分**（生成→抠图→切帧→图集→像素归一→修边→分析）+ **perfectify 的"从深处向外填充"** 修边策略 + `analyze` 的透明四态分类 | L2 | 本仓有图像生成但无"生成→可用资产"的后处理链 | `src/artist/` 各模块 + `cli.py` |
| 12 | **契约的 `Basic Knowledge` 章节**（tilemap 的 face/top 分离为什么必要，含完整可复用 tileset 生成 prompt 与 ASCII 瓦片语义图例） | L0/L2 | "契约不只写流程、还携带先验常识"这个结构很有价值；且它示范了"如何解释为什么不这么做" | `contracts/tilemap.md` |
| 13 | **rastermap 的五角色闭环**：artist 标注地标（`landmark` 元数据在 manifest 上，引擎不消费）→ architect 换算世界坐标 → programmer 建不可见 collider（**禁用可见占位**）→ player 用 Runtime API 现场调 + VLM 二元校验 → reviewer 用 VLM 判定做拒绝门 | L1/L2 | 这是"生成的美术如何变成可玩关卡"的完整答案；`landmark` 元数据这个"给 agent 而非给引擎"的设计很干净 | `contracts/rastermap.md` |
| 14 | **模块随附静态检查**（`modules/check/XxxModule.check.py`，按 `script` 字段自动发现，`ERROR/WARN/PREVIEW/PASS` 分级）+ **"能断言就断言，必须目检就出预览"** 的二分法 | L1/L2 | 把检查挂在**可继承单元**上；本仓 `design.audit` 是确定性审计但与"模块"无绑定 | `self-evolve/SKILL.md` Step 4 + `ParallaxModule.check.py` |
| 15 | **11 个模块的参数化深度**（尤其 `SideviewFighterModule` 把连段窗口、格挡窗口毫秒、处决各阶段时长、残影数量全部 config 化，玩法层只留伤害/HP） | L2 | 示范了"哪些该进可复用件、哪些该留项目层"的切分线 | `modules/index.md` + `SideviewFighterModule.js` |
| 16 | **`pose_bundle` 概念**：把无内在循环运动的持姿状态（jump/fall/dash/bounce）**打包进一张图生成**，以保证缩放/调色板/描边重量完全一致 | L0 | 一个很实际的成本-一致性权衡技巧 | `sprite.md` 帧数判据节 |
| 17 | **骨架的 `When to use` / `When NOT to use` 双列目录** + "不比他项目更优则不覆盖旧骨架，而是加前缀另建" | L0 | 选择目录与版本演进规则；后者避免了"新项目污染旧基线" | `skeletons/index.md` + `self-evolve` 骨架节 |
| 18 | **自进化的提权取舍标准**："只提升真实任务里承重的，不发明没用过的先验" + "优先保留**影响视觉与真实手感**的代码（纯玩法逻辑容易重写正确，视觉+碰撞+行为耦合最难复刻）" | L0 | 一条判断"什么值得沉淀"的实用标准 | `self-evolve/SKILL.md` Global Rules |
| 19 | **帧同步运行时控制**：帧门做在引擎自己的 update 里 / `continue(N)` 用 Promise 让 HTTP 阻塞到帧真跑完 / 语义输入注入脚本 API 边界（含合成释放边）/ `runtimeState()` 游戏自述 / `breakpoint()` 交接 | L2/L3 | "让 AI 验收自己做的可运行物"的完整工程答案；它证明关键不在更强的模型，而在**产品给自己装了一个可暂停、可步进、可注入的运行时** | `SceneTree.update` + `RuntimeController` + `spec/engine/runtime.md` |
| 20 | **"不算证据"四条反例**：帧在动≠可运行（粒子/tween 维持帧熵）/ "已 eval 验证"≠证据（绕过游戏循环）/ 旧轮次证据过期 / 为过测试改引擎是 workaround | L0 | 对任何"AI 交付可运行物"的验收都适用；**四条都是可逐字复用的判决**，本仓 review 目前只产出文本证据 | `reviewer.md` §4 Minimal Checklist |
| 21 | **VLM 的认知约束**：semantic judge not ruler / 只信二元与方向 / VLM 主动给的像素数字仅用于挑步长 / **禁止问"差几像素"** / 由此把微调规定成二分搜索 + **context isolation** 作为调外部模型的理由（"看过五遍的截图你不再看得见"，附具名事故） | L0 | 本仓 `vision-mcp` 已有工具但无此纪律；"为什么要独立复核"被从礼貌变成了论证 | `spec/cli/vlm.md` + `player.md` §B6 |
| 22 | **bot 三件套 + "先读 trace 再接受通过"**（`video.webm` / `trace.jsonl`（写在动作执行**之前**）/ `result.json`（`ok = status=="done"`））+ `breakpoint` 交接机制 | L1/L2 | 游戏自动化验证的完整协议；"`done` 本身不证明预设阶段跑过"这条纪律很锋利 | `spec/engine/runtime.md` §Runtime bot |

---

# Part VII 风险与不跟进

## 7.1 风险

- **论文无定量评估**（自认 limitation）：*"our study focuses on system design and illustrates
  capabilities through demonstrations, but does not provide a controlled quantitative
  evaluation."* 所有能力结论来自 9 个自报 demo。**骨架的 `errors.md` 是"真实项目沉淀"的
  证据，但沉淀样本量未知。**
- **美术质量的上限受生成模型约束**：`sprite.md` 里那些极其具体的规则
  （同包围盒、同缩放、不得越格、4 帧单一连续微循环）恰恰说明
  **生成模型本身稳定性不足**，需要靠 prompt 契约 + 后处理 +（必要时）重生成来兜。
  文档自己也承认失败要"regenerate the raw sheet"。
- **`decompose` 依赖外部服务**（Qwen-Image-Layered，需 `ssh -L 5001:localhost:5001` 隧道），
  且 `imagegen`/`videogen` 都需要 API key——**不是开箱可用**。
- **设计知识库是"够用的摘要"而非完整课程**：17 份理论，单份 3-8KB。
  对常见类型（平台/动作/RPG/卡牌/roguelike）够用；对复杂类型可能不足。
- **契约的"已验证范围"纪律是双刃剑**：`tilemap` 明确写"仅验证于俯视地牢 roguelike"，
  `rastermap` 写"仅验证于侧视竞技场"。**这意味着能力边界很清楚，但也意味着
  超出验证范围时没有指引**。
- **热度与成熟度倒挂**：238★ / 18 commits / 0 issues（2026-09-15 快照）。
  骨架、errors.md、契约这批"沉淀物"的质量看起来需要多个真实项目才能产出——
  与 18 次提交的仓库历史不太相称，**这批材料的实际来源值得存疑**
  （可能是团队内部项目的沉淀一次性开源）。
- **许可**：Apache-2.0（GitHub API 确认）；Phaser 3 是 MIT；README 的"商用部署通知"
  是非约束性请求（明示不要求批准/不收费/不改动 Apache 权利）。**无 GPL 传染。**

## 7.2 明确不跟进

- **Phaser / 自研引擎整体吸纳**：本仓是 Electron + TS，换栈零收益；
  且 09-03 已划界"价值在机制层不在代码层"——**本文进一步确认：价值在"约束设计"层，
  连机制都不是**。
- **游戏资产管线全套照搬**：sprite 生成属游戏垂直域；本仓 designer/cad-3d 线各有路线。
  仅取"纯色键+泛洪"这条确定性路线与"生成→可用资产"的职责划分思想。
- **19 份设计理论全量引入**：游戏垂直域知识；本仓若不做游戏生成，无消费场景。
- **`decompose` 的远程服务依赖**：需要自建 GPU 服务 + 隧道，与"本地优先"不符。
- **8 角色班底与 tmux 编排**：已由前次调研判定为游戏垂直域规模，结论不变。
- **把 `errors.md` 当模板套用**：**内容可借鉴，但机制不可照搬**——
  它的价值来自"真实项目跑通后的沉淀"，直接编写一份"看起来像"的 errors.md
  会产生**伪造的先验**，与它自身的纪律（"只提升承重的"）相违背。

---

## 结论

**这一轮调研把 VibeGame 的估值重心从"多 agent"移到了"约束设计"。**

读完游戏开发层的全部一手材料后，最清楚的判断是：**VibeGame 真正解决的问题不是
"让 AI 有个团队"，而是"让 AI 生成的东西在那个它一定会做错的领域里少错一点"。**
它的四层材料都在做同一件事：

- **引擎层**：把 LLM 的失效模式（防御性写码、原点漂移、重复创建、裸对象拼装）
  变成 API 语义（省略即继承 / pivot 级联 / 模板强制），并配一份 11 条的 pitfall 清单。
- **设计层**：把"设计意图"与"制作细节"强制分层，理由写得很硬
  ——写死数字会在后续调参时崩，要求图像生成做不到的视觉精度是浪费。
- **美术层**：把"如何稳定生成可切片的资产"变成可复现的规则集
  （纯色标记 + containment + 帧数判据 + idle 四帧的连续微循环写法），
  并用纯色键+泛洪这条**确定性**路线兜住生成模型的不听话。
- **游戏能力层**：11 个参数化模块 + 11 份带 `Basic Knowledge` 的契约 +
  5 套**可打开可玩**的骨架 + 一层 placeholder 机制让代码与美术解耦。

**最值钱的单件资产是 `errors.md`**——七条真实失败模式，每条带症状/根因/修法/
`Spec update` 闭环行。它示范了一件事：**"把失败变成未来会读到的资产"是有格式的**，
而这个格式本仓完全没有。

**对本仓的直接含义**（定位，不是方案）：本仓在**开发工具链**（review/crg/design/prototype/
task 的 44 个 action）、**确定性审计**（`design.audit` 零 LLM 三轴）、**知识回写**
（skill-up CI / memory.distill / memory.audit）、**规格与任务治理**上都比 VibeGame 成熟。
缺的是三层：**可运行的游戏/可运行物基线**、**玩法设计知识**、**为 AI 生成物设计的声明式约束**。
第三层最容易起步（本质是设计决策），前两层需要真实项目沉淀——
而 VibeGame 恰好演示了**沉淀的格式长什么样**。

**建议动作：全部候选以 `∥` 状态记账于本文与 research 索引，不另立 spec、不启动代码。**
本文与 `2026-09-03-vibegame-prestudy.md`（机制层宏观）、以及同日的
harness 层调研合起来，构成 VibeGame 的完整画像：
**09-03 讲"它是什么"，本文讲"游戏开发层它准备好了什么"，前者是地图，后者是地形。**
