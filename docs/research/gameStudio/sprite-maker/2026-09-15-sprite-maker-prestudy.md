# 预研：JohnKinyanjui/sprite-maker（Sprite Studio）—— 把 2D 像素美术的生命周期做成确定性 harness

日期：2026-09-15 · 分支：`feat/modern-ui-redesign` · 性质：预研（无代码变更，不启动 spec）

## 定位声明（先读这个）

Sprite Studio（`sprite-maker`）是本调研里**最像"本仓会造的东西"**的一个项目。
它与 VibeGame、GameFactory-3A 都不是同量级的对标：

| 维度 | VibeGame | GameFactory-3A | Sprite Studio |
| --- | --- | --- | --- |
| 定位 | NL→可玩 2D 网页游戏的垂直 harness | NL→3A 资产+引擎代码的多引擎 Skill 框架 | **NL→可用 2D 像素资产的本地优先工作台** |
| 资产 | 2D 美术管线（Python） | 图片/3D/场景/动作/音频/CG（全品类） | **2D 像素画 + 绑定 + 动画 + 图集** |
| 引擎 | 自研 Phaser 3 封装 | UE5/Unity/Godot/three.js/Blender | **无引擎**（桌面工具，产物是 PNG 图集） |
| 核心命题 | agent 团队怎么验收自己做的游戏 | 资产怎么跨引擎生成与隔离 | **AI 生成的像素画怎么变成确定性的可用资产** |

**核心问题**：一个把"自然语言 → 像素动画 → 可用图集"做成确定性 harness 的桌面工具，
在仓库里编码了什么"游戏开发能力"？它与本仓的距离有多近？

> **总口径**：调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现；
> 正式实现一律以 `specs/` 为准。**本文不另立 spec、不启动代码、不给落地方案。**

### 调研材料（全部一手）

| 类别 | 材料 |
| --- | --- |
| README | `README.md`(18.9KB) 全文 |
| 入口 Skill | `src-tauri/resources/skills/sprite-director/SKILL.md`(3.9KB) — 资产路由 |
| 绑定规划 | `references/rig-planning-contract.md`(15KB) — rig v3 完整契约 |
| 质量门控 | `references/quality-gates.md`(3.4KB) — 19 条交付检查 |
| 原生 rig 引擎 | `references/native-rig-engine.md`(3.8KB) |
| MCP server | `src-tauri/src/bin/sprite-studio-mcp.rs`（目录确认）|
| 技能引用 | `references/` 22 份（harness/contract/profile/preset）|
| 仓库结构 | GitHub API 367 文件 |

---

## TL;DR

| 层 | Sprite Studio 编码了什么 | 是真工程吗 |
| --- | --- | --- |
| **核心命题** | AI 只画 master（源画），**绑定与动画必须确定性渲染**（AI 禁止发明帧） | ✅ **真，且是全文最有价值的单条纪律** |
| **路由** | Skill 按资产种类（character/creature/effect/prop/terrain/rig）走不同 harness，harness 名出现在请求上方，**禁止替换** | ✅ 真 |
| **rig v3 绑定** | 命名关节点 + 胶囊骨骼 + 每像素归属 + 两骨骼 IK + 固定接触点 + 命名姿态 + 加权 mesh | ✅ 真。15KB 的 rig-planning-contract 是完整的绑定工程规范 |
| **循环闭合** | "无缝循环必须是默认"——AI 必须在选帧数前规划恢复/稳定/反向/收尾相；末帧不得复制首帧 | ✅ 真。把"循环怎么闭合"变成了规划契约 |
| **物理包络** | 在选变换/帧时序前，先建立米/米每秒/秒的物理包络；走循环必须结束于互补接触/恢复姿态 | ✅ 真 |
| **质量门控** | 19 条交付检查（文件存在/画布一致/透明背景/剪影/像素纪律/调色板/rig 来源/rig 可重现/循环预览三遍/角色一致性/运动力学/配对肢体身份/清单/类别合约/AI 完工来源/整洁交接/原创性/附着合理性/翅膀力学）| ✅ 真 |
| **自动修复** | 验证失败时自动修 rig 提案（收紧 mask/移枢轴到物理关节/改 z 序/调变换）并重验一遍；渲染后检查接触表与循环播放的 8 类问题；**禁止把验证失败作为"未完成工作"交给用户** | ✅ 真 |
| **MCP server** | `sprite-studio-mcp` stdio daemon，复用 SQLite + 工作区文件；Phase 2 工具（导出/队列/spritesheet/VFX/质量报告/资产列表）**不 spawn agent 即可跑** | ✅ 真 |
| **确定性保证** | rig JSON 存锁定 master 的 SHA-256，master 变了 rig 拒渲染；每帧必须是同一已验证 master 的确定性变换；PNG 字节级可重现 | ✅ 真 |
| **与 AI 分工** | ImageGen 只做 master 或授权时的 polish；绑定/遮罩/枢轴/修复/姿态/粗略帧由 AI 规划但**确定性渲染器绘制**；AI 永远不准独立发明动画帧 | ✅ 真。这条纪律是整套设计的脊梁 |

**一句话**：Sprite Studio 的真正价值不在"AI 能画像素画"，而在它把**"AI 生成的画面怎么变成确定性的、可重用的、游戏可用的资产"**做成了 harness——核心纪律是**AI 只画源画，绑定与动画必须确定性渲染**。

---

# Part I 核心命题：AI 画源画，确定性渲染器画动画

## 1.1 最根本的一条纪律

`SKILL.md` 开篇的路由表背后藏着一条规则，在 rig-planning-contract 里被反复强调：

> "ImageGen must never invent animation timing, poses, or pose sheets."
> "The AI may revise the proposal—masks, pivots, z order, transforms, and tiny
> joint repair commands—but **it must never independently invent an animation frame**."

以及质量门控第 7 条：

> "Rig provenance: **animation poses come from the saved deterministic rig tied to
> the exact focused source. Independently generated AI poses are rejected.**"

这意味着：**AI 的唯一作画权是 master（源画）**。一旦 master 锁定，
所有动画帧必须由确定性渲染器从该 master 的像素变换而来。
AI 可以规划绑定、遮罩、枢轴、变换，但**永远不准自己生成某一帧的画面**。

为什么重要：AI 生成的帧存在身份漂移（identity drift）——同一角色跨帧会微妙变形。
确定性渲染器从同一 master 的像素做最近邻平移/旋转/缩放，**字节级可重现**，
彻底消除漂移。

## 1.2 工具分工

```
ImageGen（Codex/Cursor/Antigravity）     Rust 确定性渲染器         Python 工具
─────────────────────────────           ──────────────────         ────────────
只做 master（源画）                       绑定变换、动画帧              rig validate
AI polish / Full redraw（仅授权时）       terrain/prop/effect 绘制     sprite_tool.py
                                        contact sheet 组装           sprite_rig.py
```

三种模式：

| 模式 | 谁画 | 何时用 |
| --- | --- | --- |
| **rig-only**（默认） | ImageGen 只做 master；绑定/帧全由 Rust 渲染器画 | 绝大多数情况 |
| AI polish | 在已完成的粗略 rig 帧上编辑，每结果过 `sprite_polish.py` | 用户显式选 |
| Full redraw（实验性） | AI 重新画帧 | 用户显式选 |

---

# Part II 绑定工程：rig-planning-contract 全文解读

这是本文认为 Sprite Studio 最有价值的单件资产——15KB 的绑定工程规范。

## 2.1 阶段 0 — 确认运动意图

> "A subject name is not a motion: 'animate this rabbit' is incomplete, while
> 'make this rabbit hop forward' is actionable."

| 情形 | 做什么 |
| --- | --- |
| 提示含明确运动 | 重述为 `MOTION INTENT: <动词> — <一句话力学>` 并继续 |
| 提示未说怎么动 | **问一个简洁问题并停下渲染**：`How should this <观察到的 subject> move?` 提供 3-4 个解剖学适当的示例 |

**推断运动建议来自实际观察到的视觉主体**，而非文件名/类别/聊天标题。
例如兔子可 hop/bound/pounce/耳鼻 idle；蜈蚣以腿波蠕动；鸟可振翅/起飞/滑翔/着陆。

**禁止**：
- 用整体图像的 bobbing/sliding/scaling/交替帧替代自然的关节运动
- 根平移只允许作为规划的步态/跳跃弧/后座/其他物理动作的后果

在选变换/帧时序前，先建立 **`PHYSICAL ENVELOPE`**（米 / 米每秒 / 秒）。

## 2.2 阶段 0.5 — 规划循环闭合

> "Treat every animation as a seamless loop unless the user explicitly requests a
> one-shot action or a non-looping final hold. Before choosing the frame count,
> the AI must propose the missing recovery, settle, reverse, or follow-through
> phases needed to return naturally to the opening state.
> **Do this internally without making the user design the loop.**"

关键规则：
- 首帧是循环的开场态——**不得复制到末帧**（播放已从末帧回到首帧，复制会产生不希望要的停顿）
- 帧表写成环形序列；对每个部件比较末帧与首帧变换，末-首变化不得大于普通相邻帧变化
- 走循环必须结束于互补接触/恢复姿态，自然流入开场接触
- 循环帧数预算无法同时容纳可读动作与闭合时，**建议更多帧**（在 Auto 限制内）；用户固定帧数时，简化次级运动而不牺牲闭合

## 2.3 阶段 1 — rig 提案（绑定前必须做的事）

**视觉检查**：附带 master/reference 时，在写任何绑定前先**实际目视检查**。
不得从文件名/类别/聊天标题/用户描述推断主体/解剖/遮罩/枢轴。

**运动准备度与肢体门（Motion-readiness gate）**：

> "The whole visible subject is never a valid single rigid base for locomotion."

- 四足跳需要：后躯/臀驱动、前肩/着陆、躯干/骨盆压缩、头/颈/尾等次级部件的**独立遮罩**；前后组都必须有非恒等变换
- 双足走/跑需要：左右腿独立支撑 + 手臂/上身对抗
- 分节生物需要：多个独立分相的体节/腿组
- 解剖被遮挡或不清楚时：**标记 master `MOTION READY: no`**，不用 `stableBase` 藏失败

**Auto 帧数推荐**：`AI FRAME RECOMMENSION: N frames — <视觉/力学理由>`，
在用户最小/最大范围内，N 在 rig/渲染文件/清单/最终响应中一致使用。
"walk"不得自动等于 8 帧。

**可读性判据**（在 1× 回放时）：
- 至少两个解剖部件在周期内跨越可感知的姿态范围：**8° 旋转 / 1.5 逻辑像素平移 / 5% 缩放**
- ±2° 或 0.999–1.001 缩放是"数值运动但像素量化后视觉静止"——**必须拒绝**
- 核心身体作为力学一部分运动，不是移动肢体上方的刚性平台
- 双足需骨盆/躯干压缩与反旋；四足需骨盆/肩/脊柱弯曲；分节生物需行波过至少两个体段；翼化角色需胸/躯干对翅膀的反应
- **末帧不得复制首帧**

## 2.4 rig 版本 3 结构

| 字段 | 作用 |
| --- | --- |
| `rigVersion: 3` | 新绑定必须用 v3；v1/v2 只为既有资产可读 |
| `rootMotion` | `"in-place"`（游戏 ready 步态）或 `"baked"`（仅用户明确要求位移时）|
| `baseZ` | 基底与所有部件共享一种深度序；帧只在真实遮挡变化时用 `zOverrides` |
| 每个部件 | 语义 `role`；命名绑定姿态 `anchors`（源空间 `[x,y]`）；`parent` + `attach: {parentAnchor, selfAnchor}`；先解析父变换，子变换局于继承的父姿态 |
| `rigProfile` | 形态专用骨架（biped/quadruped/hexapod/segmented-many-leg/serpentine/winged/amorphous/rigid-object）|
| `joints` | 每个实际观察到的关节：源位置、能见度、两个邻接部件 |
| `bone` 胶囊 | 可见游戏侧关节必须由两个邻接部件的实际源像素支撑；基底像素不得落在骨骼胶囊内 |
| 像素归属 | 每个可见源像素属于基底**或恰好一个**可动部件；重叠只在 `overlapMode: "joint-cap"` 时允许（小缝修）|
| `phase` / `contacts` / `pose` | 每个运动帧声明 `phase`、仅固定接触点为 `contacts`、命名 `pose` |
| IK | 优先用每帧两骨骼 `ik` 约束（端点锚、锁定画布目标、弯曲方向、可选末端执行器世界旋转）|
| 加权 mesh | 当源剪影无法干净拆分时：绑定姿态 `vertices`、索引 `triangles`、每个顶点 1-4 项权重 `{bone, weight}`，权重和必须为 1；在膝/肩/臀等弯区加内部顶点；**最近邻采样保持调色板颜色精确** |

**末帧不得复制首帧**——即使另一帧是有意的 hold。

验证拒绝的 21 类问题：不匹配的 profile、缺失/不支持的可见关节、缺失命名关键姿态、骨骼包膜内残留像素、形态不兼容角色、未知目标、缺失/循环父级、缺失附着/接触锚、分离的附着锚、移动的固定锚、冲突的像素归属、未覆盖/无效的加权 mesh、刚性单块四足肢体、不可感知的变换范围、未解释的重复帧哈希、裁剪的可见像素、末-首根/关节/接触/剪影/深度不连续大于普通相邻过渡。

## 2.5 阶段 2 — 确定性渲染

```bash
python3 .sprite-studio/sprite_rig.py --validate .sprite-studio/rigs/<slug>.json   # 先验
python3 .sprite-studio/sprite_rig.py .sprite-studio/rigs/<slug>.json               # 再渲染
```

- rig JSON 存锁定 master 的 SHA-256；**master 变了 rig 拒渲染**
- 每帧必须是同一已验证 master 的确定性变换
- AI 可修提案（mask/枢轴/z 序/变换/小关节修），**永远不准独立发明动画帧**
- 任何显式后期 polish 必须保留粗略 rig 帧为姿态权威，过 frame-polish 契约

## 2.6 自动修复循环

> "Do not hand validation failures back to the user as unfinished work."

验证失败 → 自动修 rig 提案（收紧 mask / 移枢轴到物理关节 / 改 z 序 / 调变换）→ 重验。
渲染后检查接触表与循环播放的 **8 类问题**：
脱开的关节 / 空洞 / 重复哈希 / 滑动的固定锚 / 地平线漂移 / 裁剪 /
不可读的运动 / 错误肢体深度 / 循环弹出；
末-首过渡与普通过渡同标准审视。

翼化角色特检：可见翼根失去可信的肩/胸重叠、整个翼绕刚性卡飞行、近/远翼交换深度。

**禁止**：把被拒尝试或重试记录给用户；内部接受通过不出现在用户文本中；
只能在无有效工作区结果时停到 `GENERATION_FAILED`；动画交付至少需要两个不同帧。

---

# Part III 质量门控（19 条交付检查）

`quality-gates.md` 的 19 条，逐条都是"AI 提交物经常骗过编译但通不过玩家眼睛"的问题：

| # | 检查 | 防什么 |
| --- | --- | --- |
| 1 | 文件存在 + 解码 | 空引用 |
| 2 | 所有帧逻辑尺寸一致 | 图集错列 |
| 3 | 背景透明 + 四角 alpha=0 | 残留底色 |
| 4 | 主体 1× 可读 + 不碰非预期画布边 | 剪影被裁 |
| 5 | 无意外抗锯齿/模糊缩放/压缩噪点/孤立像素 | 像素纪律 |
| 6 | 轮廓/阴影/基色/高光跨帧一致 | 调色板漂移 |
| 7 | 动画姿态来自保存的 rig + 精确源画 | **AI 自画姿态冒充 rig 输出** |
| 8 | 重渲染保存的 rig 产出相同帧序/尺寸/枢轴/时序/层序 | rig 不可重现 |
| 9 | 预览至少三遍循环，脚/枢轴不漂移，运动弧有意，末-首不坏于相邻 | 循环爆跳 |
| 10 | 眼线/头尺寸/解剖/标记/服装/调色板/装备/地线/朝向稳定 | 身份漂移 |
| 11 | 接触不滑、可见关节不断、根运动合意图、无意外重复端点 | 运动力学 |
| 12 | 近/远肢体在交叉全程保持深度与遮挡角色 | 肢体身份互换 |
| 13 | `.sprite-studio/last-generation.json` 按播序列接受文件 + 正确 FPS/类别/来源/生成模式 | 清单 |
| 14 | rig 类别 / `assets/<category>/` / 清单类别 / 索引资产一致 | 类别契约 |
| 15 | AI polish/redraw 仅在显式选择时允许 + 每结果溯源到对应粗略 rig 帧 | AI 完工来源 |
| 16 | 仅最终接受清单帧留在 `assets/`；被取代 polish 存档在发布资产文件夹外 | 整洁交接 |
| 17 | 风格参考转通用特征，不复制已知角色/精确精灵 | 原创性 |
| 18 | 无肢体/翼/尾/头/武器/关节层读作漂浮岛；数学重合的锚仍失败于可见像素不在关节周围保持可信重叠 | 附着合理性 |
| 19 | 翼根在全程可见坐于肩/胸；翼膜绕关节折叠滞后而非整翼绕刚性卡飞行；翼数/近远身份/深度恒定 | 翅膀力学 |

---

# Part IV 项目骨架与工程治理

## 4.1 目录结构

```
GameFactory3A/（对比用） vs sprite-maker/
├── agent_skills/                  ←→  src-tauri/resources/skills/sprite-director/
│   ├── setting_overview.md        ←→  SKILL.md（路由器）
│   ├── asset_qa/                  ←→  references/（harness/contract/profile/preset）
│   ├── code_gen/                  ←─  无对应（不生成玩法）
│   └── engine_context/            ←─  无对应（不接引擎）
├── models/                        ←─  无对应（AI 调用外部 CLI）
├── operators/                     ←─  无对应
├── pipeline/                      ←─  无对应
├── engine_adapters/               ←─  无对应
├── scripts/                       ←→  src-tauri/resources/sprite_rig*.py
└── test/                          ←─  无对应（有 scripts/*.test.ts）
```

**关键差异**：sprite-master **没有** pipeline / operators / models / engine_adapters。
它不做生成，生成全部外包给 Codex/Cursor/Antigravity CLI。
它的核心是**确定性的绑定/渲染/质检**。

## 4.2 桌面工作台（Tauri 2）

前端 Svelte + Vite + TypeScript + Bun；Rust 核心处理图像/绑定/MCP；SQLite 存元数据。

标签页：Chat(⌘1) / Sprites(⌘2) / References(⌘3) / Animate(⌘4) / Rig(⌘5) / Sheets(⌘6) / Packs(⌘7) / Playground(⌘8)。

Provider 能力发现：**隐藏不支持的模型/推理级别/多图输入/结构化输出/透明度**。

## 4.3 MCP Server（headless）

`sprite-studio-mcp` stdio daemon，复用 SQLite + 工作区文件，GUI 无需打开。

Phase 1 工具：`studio_status`, `open_workspace`, `ensure_conversation`, `generate`,
`get_generation`, `list_artifacts`（spawn agent）。

Phase 2 工具：`export`, `queue_sprite_sheet`, `queue_procedural_vfx`, `get_job`,
`quality_report`, `list_assets`, `list_packs`（**不 spawn agent，纯 Rust**）。

独立的 Python helper：`.sprite-studio/sprite_rig_mcp.py`（只与本地 rig 渲染器对话）。

## 4.4 数据安全性

- 文件注册后才校验
- 资产变更创建内容哈希版本
- 图集导出 / 对齐修复 / AI polish 创建新文件 + 记录；删图集**绝不删源帧**
- 质量警告可确认但不改画
- 新聊天无强制 master 图；引用用户控制

---

# Part V 与 VibeGame / GameFactory-3A 的对照

## 5.1 三者互补关系

| 能力 | VibeGame | GameFactory-3A | Sprite Studio |
| --- | --- | --- | --- |
| 资产生成 | 2D 美术管线（Python）| 6 类全品类（云/本地 API）| **外包给 CLI** |
| 绑定/动画 | 无（模板节点）| 无（动作生成走 API）| **确定性 rig 渲染器** |
| 引擎集成 | 自研 Phaser | UE5/Unity/Godot/three.js | **无** |
| 玩法生成 | task 流水线（含验收）| Mechanic 契约 + UI | **无** |
| 运行时控制 | **帧同步 + bot** | 无 | 无 |
| 验收 | 对抗式 7 agent + errors.md | 6 维评审表 | **19 条质量门控** |
| 产品形态 | CLI + tmux | Skill 框架 | **Tauri 桌面工具 + MCP** |

**三者覆盖游戏生成链的不同段**：
- Sprite Studio = **2D 资产生成与绑定**（最前段）
- GameFactory-3A = **3A 资产生成 + 引擎代码**（前中段）
- VibeGame = **运行时/验收/编排**（后段）

三者理论上可以串成一条链路（Sprite Studio 产出 2D 资产 → 引擎集成 → VibeGame 验收），
但现实中**三者成熟度都弱**（Sprite Studio 0.3.0 早期公开发布），
且 Sprite Studio 只做 2D 像素，与 VibeGame 的 2D 网页游戏最匹配。

## 5.2 与本仓（deepOrca）的对位

| 维度 | Sprite Studio | 本仓现状 | 距离 |
| --- | --- | --- | --- |
| **核心命题** | AI 画源画，确定性渲染器画动画 | 自有 LLM 循环 + 工具协议 | **近**：本仓也在做"agent 怎么可靠地产出" |
| **确定性渲染** | Rust rig 渲染器（字节可重现）| 无 | 本仓缺"资产怎么变成确定性产物"这一层 |
| **绑定规范** | rig v3 契约（15KB）+ 物理包络 + 循环闭合 + 运动准备度门 | 无 | 本仓若有 2D 资产场景，这是现成参考 |
| **质量门控** | 19 条交付检查（含 rig 可重现 / 循环三遍 / 配对肢体）| `design.audit` 三轴（面向视觉）| 互补：本仓面向"视觉审美"，Sprite 面向"游戏可用性" |
| **MCP server** | stdio daemon + Phase 2 纯 Rust 工具 | 自有 MCP client + vision-mcp | **近**：本仓有 MCP 基础设施，可参考 Phase 2 设计 |
| **桌面形态** | Tauri 2 桌面 | Electron 桌面 | **近**：同类桌面应用 |
| **与 AI 分工** | ImageGen 只做 master；AI 禁止发明帧；自动修复循环 | 无此纪律 | **这是最值得学的单条**：给 AI 的权限边界写得极其具体 |
| **与引擎集成** | 无（产物是 PNG 图集）| 无（browser.* 走 vendored bsk）| 两者都不接商业引擎 |

**Sprite Studio 与本仓是最近的**——同类桌面应用、同样有 MCP server、
同样在解决"agent 怎么可靠地产出"。差异在于它聚焦 2D 像素美术的全生命周期，
本仓聚焦通用 coding agent。

---

# Part VI 可借鉴清单（只记发现，不给落地方案）

| # | 发现 | 深度 | 为什么值得记 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | **"AI 只画源画，绑定与动画必须确定性渲染"**——AI 永远不准独立发明动画帧；rig 存 master SHA-256，master 变了拒渲染 | L0 | 本仓无此纪律；这是解决"AI 跨帧身份漂移"的最干净答案 | `SKILL.md` + `rig-planning-contract.md` |
| 2 | **运动准备度门（Motion-readiness gate）**：主体不可作单一刚性基底；解剖不清时标记 `MOTION READY: no` 而非用 stableBase 藏失败 | L0 | "何时该拒绝"比"何时该接受"更难写；本仓 skills 缺此类拒绝门 | `rig-planning-contract.md` §Stage 1 |
| 3 | **循环闭合规划**：无缝循环默认；AI 在选帧数前规划恢复/稳定/反向/收尾相；末帧不得复制首帧；帧表写成环形序列 | L0 | "循环怎么闭合"是动画生成的经典难题；这里是可执行的规划契约而非提示 | `rig-planning-contract.md` §Stage 0.5 |
| 4 | **物理包络优先**：选变换/帧时序前先建米/米每秒/秒的物理包络；走循环结束于互补接触 | L0 | 把"先想物理再画帧"变成强制顺序 | `rig-planning-contract.md` §Stage 0 |
| 5 | **可读性数值判据**：至少两解剖部件跨周期达 8° 旋转 / 1.5 逻辑像素平移 / 5% 缩放；±2° 或 0.999–1.001 是"像素量化后视觉静止"——必须拒绝 | L0 | **给"可读"下了可机械检查的数值定义**；本仓 `design.audit` 的数值判据可参考此风格 | `rig-planning-contract.md` §Stage 1 |
| 6 | **19 条质量门控**（含 rig 来源 / rig 可重现 / 循环三遍 / 配对肢体身份 / 附着合理性 / 翅膀力学）| L1 | 面向"游戏可用性"而非"视觉审美"；与本仓 `design.audit` 互补 | `quality-gates.md` |
| 7 | **自动修复循环**：验证失败自动修 rig 提案并重验；渲染后查 8 类问题；禁止把验证失败作为"未完成工作"交给用户；内部重试不出现在用户文本 | L0 | "agent 遇到验证失败怎么办"是通用问题；这里给了完整答案 | `rig-planning-contract.md` §Automatic AI repair loop |
| 8 | **MCP Phase 2 纯 Rust 工具**（导出/队列/spritesheet/VFX/质量报告/资产列表）不 spawn agent | L1 | 本仓 MCP 基础设施可参考：哪些工具该走纯后端、哪些该走 agent | 目录确认 + README |
| 9 | **Provider 能力发现**：隐藏不支持的模型/推理级别/多图输入/结构化输出/透明度 | L1 | 本仓 model-fleet-adaptation spec 在储备区；这里是已实现的版本 | README |
| 10 | **形态专用骨架（rigProfile）**：biped/quadruped/hexapod/segmented/serpentine/winged/amorphous/rigid-object | L0 | 给绑定加了形态学先决；与 VibeGame 的形态学知识库（Boss/玩家类型）正交 | `rig-planning-contract.md` §Rig version 3 |

---

# Part VII 风险与不跟进

## 7.1 风险

- **0.3.0 早期公开发布**：文件格式/提供者适配器/生成 harness 将演进；
  "The core desktop workflow works, but file formats, provider adapters, and
  generation harnesses will evolve." 引用其绑定时格式需跟进上游。
- **强依赖外部 CLI**：Codex/Cursor/Antigravity 必须已安装并登录；
  Cursor Image 需 Cursor 2.4+ 且已认证；Antigravity Image 需交互 `agy` 会话。
  **生成质量完全取决于这些 CLI 背后的模型**。
- **只做 2D 像素**：不接引擎、不做 3D、不做玩法。本仓若要做更宽的游戏开发，
  这只是前段工具。
- **绑定规范的"可执行性"**：rig v3 契约（15KB）极其详细，但
  其质量取决于 agent 是否真的读完并遵守；无公开的第三方复现报告。
- **MIT 许可证**干净可 vendor；但生成的资产版权取决于底层模型。

## 7.2 明确不跟进

- **Tauri 桌面应用整体照搬**：本仓是 Electron，换栈零收益。
  仅取 MCP Phase 2 设计、确定性渲染思想、质量门控风格。
- **rig v3 绑定格式全套引入**：游戏垂直资产格式；本仓若不做 2D 游戏，无消费场景。
  仅取"绑定先规划后渲染"的工序思想与数值可读性判据。
- **外部 CLI 全套接入**（Codex/Cursor/Antigravity）：本仓自有 LLM 循环，不需要宿主 CLI。
- **像素画专用质量门控全套引入**：面向 2D 像素美术；本仓 `design.audit` 面向网页/文档。
  仅取"给质量下可机械检查的数值定义"的方法。

---

## 结论

**Sprite Studio 是本次四个调研项目里与本仓最近的**——同类桌面应用、同样有 MCP server、
同样在解决"agent 怎么可靠地产出"。但差异显著：它聚焦 **2D 像素美术的全生命周期**，
本仓聚焦 **通用 coding agent**。

**Sprite Studio 的真正价值不在"AI 能画像素画"，而在它把"AI 生成的画面怎么变成
确定性的、可重用的、游戏可用的资产"做成了 harness。** 核心纪律只有一条：
**AI 只画 master，绑定与动画必须确定性渲染**。这条纪律解决了 AI 跨帧身份漂移的
经典难题，并通过 master SHA-256 锁定 + 字节级可重现渲染将其落地。

**最值钱的单件资产是 `rig-planning-contract.md`（15KB）**——
一份完整的 2D 像素绑定工程规范，含运动准备度门、循环闭合规划、物理包络优先、
数值可读性判据、自动修复循环。它示范了一件事：
**"agent 该做什么、不该做什么、拒绝什么、自动修什么"可以被写成可执行的契约**。

**与另外两个项目的组合观察**：
VibeGame（运行时/验收）、GameFactory-3A（3A 资产/引擎代码）、
Sprite Studio（2D 资产生成/绑定）覆盖游戏生成链的不同段。
**Sprite Studio 的"MCP server + Phase 2 纯后端工具"设计与本仓 MCP 基础设施最近，
是四个项目里最可能产生直接技术借鉴的一个**——尤其是在"哪些工具该走纯后端、
哪些该走 agent"的划分上。

**建议动作**：以 ∥ 状态记账于本文与 research/gameStudio 索引，不另立 spec、不启动代码。
