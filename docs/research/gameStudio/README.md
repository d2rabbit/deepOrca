# GameStudio —— 游戏开发调研档案

> 游戏开发能力线的调研文档台账。聚焦**直接与游戏开发相关**的外部项目，按项目分目录归档。
> 总口径：调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现；
> 正式实现一律以 `specs/` 为准。

## 第二轮专题报告（2026-09-24）

**[2026-09-24-game-dev-round2-special-report.md](./2026-09-24-game-dev-round2-special-report.md)** ——
在第一轮三项目基础上加入 **OpenGame**（CUHK MMLab，arXiv 2604.18394，骨架库+活协议的定量消融：框架 > 模型）、
**threejs-game-skills**（MIT，2120★，3D 网页 director–specialist + 四账本纪律）、
**Claude-Code-Game-Studios**（MIT，25384★，49 agents/73 skills 的长周期人机协作治理 + 技能测评框架），
并核对 VibeGame 增量（无架构变化；出品方修正为**南京大学模式识别实验室**）。
产出：六项目三形态全景 + 六条产业趋同 + 21 条 ∥ 记账候选。3D 侧姊妹篇见
[../2026-09-24-3d-domain-special-report.md](../2026-09-24-3d-domain-special-report.md)。

## 调研项目总览（第一轮）

| 项目                               | 星级/许可         | 定位                                                                        | 与本仓的关系                                                  | 文档数 |
| ---------------------------------- | ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| [VibeGame](./vibegame/)            | 238★ / Apache-2.0 | NL→可玩 2D 网页游戏的垂直 harness（自研 Phaser 引擎 + 对抗式 7 agent 团队） | **互补**：运行时/验收/编排层（深度优先）                      | 2      |
| [GameFactory-3A](./gamefactory3a/) | 571★ / Apache-2.0 | NL→3A 资产+引擎代码的多引擎 Skill 框架（UE5/Unity/Godot/three.js/Blender）  | **互补**：资产/引擎/工程治理层（宽度优先）                    | 1      |
| [Sprite Studio](./sprite-maker/)   | MIT / 早期公开    | NL→可用 2D 像素资产的本地优先桌面工作台（确定性 rig 渲染器 + MCP）          | **最近**：同类桌面应用 + MCP 最近，聚焦 2D 像素美术全生命周期 | 1      |

## 三者覆盖游戏生成链的不同段

```
[Sprite Studio]          [GameFactory-3A]              [VibeGame]
2D 资产生成/绑定/图集     6 类资产生成 + 引擎代码       运行时/验收/编排/自进化
     ↓                          ↓                          ↓
  前段（资产）              前中段（资产+引擎）            后段（可验证）
```

**互补而非竞争**。理论上三者串成更完整链路，但各自成熟度信号都弱。

## 跨项目可借鉴 Top-5（全部 ∥ 观察记账，不启动 spec）

| #   | 发现                                                                                 | 来源           | 深度 |
| --- | ------------------------------------------------------------------------------------ | -------------- | ---- |
| 1   | **"不算证据"四条反例**：帧在动≠可运行 / eval≠证据 / 旧轮次过期 / 改引擎=workaround   | VibeGame       | L0   |
| 2   | **付费 API 6 步硬流程**：暂停→发完整成本估算→等明确答复→环境变量→拒绝则兜底→报告缺口 | GameFactory-3A | L0   |
| 3   | **Mechanic 契约 schema + 禁止反向依赖**（`UI→Mechanic→runtime`）                     | GameFactory-3A | L0   |
| 4   | **"AI 只画源画，绑定与动画必须确定性渲染"**：AI 永远不准独立发明动画帧               | Sprite Studio  | L0   |
| 5   | **errors.md 失败记忆格式**（症状/根因/修法/`**Spec update**:` 闭环行）               | VibeGame       | L0   |

## 各项目的"最值钱单件"

| 项目           | 最值钱单件                                    | 为什么                                                            |
| -------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| VibeGame       | `skeletons/*/errors.md` 七条真实失败模式      | 从真实项目蒸馏、面向未来行动的失败记忆，本仓完全没有              |
| GameFactory-3A | "验证不是可选项"6 维评审表 + 修复纪律         | 把"能跑 ≠ 可玩"写成验收规则                                       |
| Sprite Studio  | `rig-planning-contract.md`(15KB) 绑定工程规范 | 完整示范"agent 该做什么/不该做什么/拒绝什么/自动修什么"可写成契约 |

## 目录结构

```
gameStudio/
├── README.md                          ← 本文件（总览索引）
├── 2026-09-24-game-dev-round2-special-report.md   第二轮专题：OpenGame（定量消融）+ threejs-game-skills（账本纪律）+ CCGS（治理）+ VibeGame 增量核对
├── vibegame/                          VibeGame（tettethu/VibeGame，南京大学 PR Lab）
│   ├── 2026-09-03-vibegame-prestudy.md          机制层全景（游戏层）
│   └── 2026-09-15-vibegame-game-dev-deepdive.md 游戏开发层深潜
├── gamefactory3a/                     GameFactory-3A（OpenDCAI/GameFactory-3A）
│   └── 2026-09-15-gamefactory3a-prestudy.md      多引擎 Skill 框架
└── sprite-maker/                      Sprite Studio（JohnKinyanjui/sprite-maker）
    └── 2026-09-15-sprite-maker-prestudy.md       2D 像素资产确定性 harness
```

## 调研标准

每份调研报告遵循统一结构：

1. **定位声明**：与本仓的关系、与同档案其他项目的对照
2. **调研材料**：一手核证清单
3. **TL;DR**：核心判断表
4. **分层深潜**：按能力维度逐层展开，含一手代码/文档证据引用
5. **对照本仓**：逐项对位 + 差距归类
6. **可借鉴清单**：按 L0/L1/L2/L3 标注，全部 ∥ 观察记账
7. **风险与不跟进**：诚实标注落差与明确不跟进项
8. **结论**：一句话 + 最值钱单件 + 建议动作
