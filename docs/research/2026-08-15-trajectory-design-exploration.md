# 轨迹设计探索：行为记忆（agent 视角）× 任务轨迹（人类视角）

> 日期：2026-08-15 · 性质：设计探索与现状对账（非实施方案）
> 对象：`specs/archive/activity-frames/design.md`（已实现，~3000 行）× `specs/archive/task-tree/design.md`（纯设计，零实现）
> 核心定位（本探索的坐标系，先于一切技术细节）：

|            | activity-frames                                                          | task-tree                                                            |
| ---------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 本质       | **行为记忆**                                                             | **任务轨迹**                                                         |
| 消费者     | **agent**（机器）                                                        | **人类**（用户）                                                     |
| 回答的问题 | "这个用户/项目**做过什么**——我该带着什么预期工作"                        | "这个 agent **正在/曾经怎么推进任务**——我该看什么、回到哪、批准什么" |
| 形态       | 检索面：MCP 工具 + 上下文块（结构化 JSON/紧凑 markdown，token 效率优先） | 视图面：树图/分支切换器/合并清单（可视可交互，认知效率优先）         |
| 输入       | 时间轴原始事件（屏幕帧 / 会话记录 / shell / git / 文件）                 | 意图结构（规划、分叉、合并、放弃的决策事件）                         |
| 失败语义   | fail-open：查不到 → agent 少一点背景，会话照常                           | fail-open：树坏了 → 降级线性会话，人仍能工作                         |

**两者不是同一系统的两层，是受众相反的两个产品。** 共享的只有原始事实源（session 历史、git、文件系统），在数据层互不依赖，可以独立演进、独立排期。任何"统一轨迹模型"的提案都应先回答"给谁看"——给 agent 的要压缩成可检索的画像，给人的要展开成可导航的结构，压缩与展开的方向相反，硬统一只会两头不讨好。

---

## 一、activity-frames：行为记忆——现状对账

### 1.1 定位（修正后）

三层记忆体系中的**行为层**（TDAM 对话记忆="用户说了什么"；activity-frames="用户做了什么"；openwiki 知识记忆="项目是什么"）。它给 agent 提供背景预期：用户的工具习惯（shell/git 画像）、工作热点文件、常见工作流序列——让 agent 在动手前知道"这个人平时怎么干"。

### 1.2 实现现状：双管线（spec 未回写）

spec（8-02）只描绘了管线 A；实现演化出了管线 B：

**管线 A——屏幕行为（spec 原样）**
`db.ts`（只读外部 SQLite：`~/.deeporca/activity.db` / `~/.nocta/db.sqlite`）→ `sessionize`（DWELL_CAP 90s / SESSION_GAP 300s / 闪烁合并 20s）→ `entities`（35+ 站点 URL 解析）→ `frames` 编译 → 6 工具（get_activity / day_summary / steps / patterns / communications / context）。

**管线 B——DeepOrca 自身活动画像（spec 外新增）**
`collectors/`（session / shell / git / file 四采集器 → aggregator → `BehavioralProfile`）→ 3 工具（hotspots / workflows / profile）+ get_context 双实现。

### 1.3 对账结论（5 项）

| #   | 发现                                                                                                                         | 判定                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | nocta-recorder **未 vendor**（spec Phase 4 未执行，无 vendor 脚本、build.mjs 无调用）——管线 A 数据源依赖用户自装，未装则空转 | 半功能；需产品决策（vendor or 显式降级声明）                                  |
| 2   | 对话侧原始事实是三层（session JSONL → memory L0/L1 分片 → session-collector 聚合），三层独立演化、无统一关联查询             | 记录；agent 侧够用则不动                                                      |
| 3   | 位置落 desktop/main/tools（spec 写 core）——与 controller-seam 迁出方向一致，seam 常量留 core、builder 注入（a2ui 同款）      | **spec 过时，非实现错误**；应回写                                             |
| 4   | **零测试**：spec Phase 5（sessionize/entities/frames 单测 + 原项目 fixture 作 port-validation oracle）未兑现                 | 债务：~3000 行确定性算法无一行测试                                            |
| 5   | 消费闭环是被动检索（agent 主动调 MCP 工具），无 memory recall 式 boot 自动注入                                               | 设计取舍待显式化：行为画像是否进开机上下文是 token 成本 vs 背景收益的产品决策 |

### 1.4 行为记忆的改进路线（按价值/成本）

1. **补核心单测**（Phase 5 兑现）：sessionize 分段/闪烁、entities 解析、frames 编译，原项目 fixture 作 oracle——确定性算法可完全离线验证。
2. **spec 回写**：双管线、desktop 位置、6+3 工具清单、nocta 状态。
3. **nocta 决策**：vendor（SHA-256 校验、macOS 二进制、模式成熟）或在空数据时返回引导话术并声明"用户自装可选"。
4. **注入通道评估**：BehavioralProfile 的紧凑摘要（aggregator 已有 formatContextBlock）是否作为可选 boot context——对齐 memory recall 的 prepend 模式，配置开关默认关。

---

## 二、task-tree：任务轨迹——设计评估

### 2.1 定位（修正后）

**给人类看的工作视图**。当前 agent 的工作过程对人完全不可见（线性消息流），放弃的尝试直接丢失。task-tree 用 git 对象模型（commit/branch/fork/merge/reflog）把 agent 的任务推进组织成**可回溯、可并行、可导航**的结构：岔路口永远在，A/B 方案并排看，岔路谁批准谁负责。agent 是树的操作者（经 defineAction 三表面），人是树的**读者与批准者**（fork 提案、merge 确认清单均在人在回路）。

### 2.2 模型质量判断

七条设计约束全部踩在真实架构约束上（core 无 UI / 不重写会话 / fork 继承摘要而非全量 / merge 为 artifact 级 cherry-pick / 记忆驱动只提议 / fail-open / Action 一等）。值得肯定的决策：

- fork 继承"摘要 + artifactRefs + memoryRefs"而非消息流——避免双爆炸，复用 compaction；
- 存储显式吸收 sessions-index 丢数教训（pendingIndex + 终端操作 flush + 单写者）；
- 记忆驱动 fork 六步闭环（埋点→召回→分歧→提议→播种→谱系回收）是签名创新，谱系回收让阈值自学习。

### 2.3 薄弱点与补充风险

| #   | 风险/缺口                                                                                                         | 建议                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | P0（无 merge 无记忆 fork）≈ 会话分组 + 命名指针，价值有限                                                         | 管理预期；P0 的真正产出是存储与服务骨架              |
| 2   | Plan Mode 双向映射（UpdatePlan ↔ appendStep）双写隐患：plan 是 LLM 拥有的，树是服务拥有的，source of truth 未说清 | 明确**单向只读物化**（plan → tree），树不回写 plan   |
| 3   | 与 subagent 递归上限（MAX_SUBAGENT_DEPTH=4）天然耦合：P3 "branch = subagent 载体"时树深度即嵌套深度               | 设计时把深度上限暴露为树守卫参数，UI 显示"嵌套层级"  |
| 4   | 记忆侧改动（L2 谱系字段、DecisionPoint 事件消费）集中在 P2 爆发                                                   | P2 工期估计偏乐观；谱系字段先在 memory 侧出增量 spec |
| 5   | PM-Design 工作台是声明的第一消费方，但其排期独立                                                                  | fork 验收可用最小双分支对比代替，不必等工作台        |

### 2.4 人类视角的 UI 责任（设计未展开的部分）

既然受众是人，UI 不是附件而是产品本体：分支色条/灰显归档/合并确认清单之外，还需——岔路节点的**决策摘要**（为什么分叉、谁批准）、abandoned 分支的**教训一句话**（下次还走吗）、memory-spawn 的✦徽章 + 相似度 tooltip（spec 已有）。P0 最小面板就应包含"为什么"字段，否则树只是结构没有叙事。

---

## 三、关系澄清（替代"统一轨迹"）

两者**只共享原始事实源，不共享模型、不共享消费面**：

```
事实源（session 历史 / git / 文件系统）
   ├── 行为记忆（activity-frames）：压缩 → 画像 → agent 检索/注入
   └── 任务轨迹（task-tree）：     展开 → 结构 → 人类浏览/决策
```

- 方向相反：前者把事件**压缩**成稳定画像，后者把决策**展开**成可导航结构。
- 唯一值得做的桥：task-tree 的节点在完成/放弃时，其摘要可成为行为记忆的**带谱系输入**（"这条分支产出了什么/放弃了什么"）——即 task-tree §三的谱系回收写入 L2 时，session-collector 聚合口径可识别 fork 标记。这是单向数据馈赠，不是模型统一。
- 词汇不必强行统一（"轨迹"一词在两个语境含义不同），但文档交叉引用时必须注明受众。

---

## 三点五、落地记录（2026-08-15 执行完毕）

- **P1 行为记忆测试**：`activity-frames-core.test.ts` 13 用例（sessionize/entities/frames，fake-db 接缝零 SQLite 依赖）。**测试批次抓到两个真实移植缺陷并已修**：①闪烁合并比较了错误的一侧（Pass 2 死代码，A→B→A 从不合并）；②Pass 1 断段判定用了"当前帧→下一帧"间隙（breakReason 误标 + 末帧恒被甩成零活跃段）——现按 spec §5.1 语义修正。
- **P1 spec 回写**：activity-frames design.md 头部新增"实现状态对账"（双管线/desktop 位置/9 工具/nocta 决策）。
- **P2 nocta 决策**：不 vendor，管线 A 为"用户自装可选"（已写入 spec）。
- **P2 任务轨迹 P0**：core TaskTreeService（单写者 + flush 纪律 + reflog + fail-open）+ 6 个 task.\* Action + desktop 只读面板（含 why 叙事渲染）+ 6 用例测试。spec 追加 §十一（P0 记录 + plan→tree 单向物化消歧）+ tasks.md 核对表。
- 未做（按计划）：merge/记忆驱动 fork（P1+）、session taskRef 绑定（P1）、BehavioralProfile boot 注入（待评估产品决策）。

### 后续批次（2026-08-15 同日续执行）

- **任务树 P1 全量**：merge（cherry-pick + 冲突报告）、session 绑定（taskRef + sessionRef 单次绑定）、branch 级 resume、Plan Mode 单向物化（幂等去重）——11 用例测试。
- **行为记忆 boot 注入**：`settings.behaviorContext`（默认关）+ host 注入 provider seam（desktop collectors → core 隐藏系统消息），fail-open。
- **memory 谱系 L2 增量规格**：`specs/archive/task-tree/memory-lineage.md`（单向馈赠 tree→memory，实现列 P2）。

### P2 收官（2026-08-15）

任务树 P2 最小可用环完成（记忆驱动 fork 六步 / 泳道树图 / 冲突清单 / PM-Design 整合；快照切换缓期并记录理由）；真机功能验收通过（CDP 实跑 task.create→step→fork→recall 全链路 + 磁盘/reflog 核验 + rail 挂载确认）。轨迹计划至此收官。

## 四、落地清单（汇总）

| 优先级 | 事项                                                                                                                      | 归属     |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| P1     | activity-frames 核心单测（sessionize/entities/frames，fixture oracle）                                                    | 行为记忆 |
| P1     | activity-frames spec 回写（双管线/desktop 位置/工具清单/nocta 状态）                                                      | 行为记忆 |
| P2     | nocta-recorder vendor 或显式降级声明                                                                                      | 行为记忆 |
| P2     | BehavioralProfile 可选 boot 注入评估（配置开关）                                                                          | 行为记忆 |
| P2     | task-tree 拆 specs/archive/task-tree/tasks.md，启动 P0（TaskTreeService + 存储 + task.fork/list Action + 最小面板含"为什么"字段） | 任务轨迹 |
| P3     | task-tree 单向 plan→tree 物化规则写入 spec（消除双写歧义）                                                                | 任务轨迹 |
| P3     | 谱系回收 → L2 增量 spec（memory 侧）                                                                                      | 桥接     |
