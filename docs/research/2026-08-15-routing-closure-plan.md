# Router 模块闭环方案：能力闭环 × 数据流闭环（R1-R4）

> 日期：2026-08-15 · 分支：fix/stabilize-data-loss-and-test-suite（routing 批次挂续）
> 前置分析：2026-08-15 SkillRouter 深度审计（本文 §〇 为其结论的结构化映射）；对照 spec：`specs/skill-routing/design.md`（G1-G3 原始设计）
> 约束：纯 core + desktop 接线改动；无新 npm 依赖；每批次独立可 revert；fail-open 纪律不破。
> 方法论：深模块词汇（Module / Interface / Depth / Seam / Adapter / Leverage / Locality），§一 全部为 ModuleDesign 工件。

## 〇点五、R1-R4 落地记录（2026-08-15 执行完毕）

全部批次落地并全量验证（`npm run check` 0 error；core 412 用例含 +22 路由新测试全绿；desktop 144/149 通过，5 个失败为存量 ipc-security 问题）。与计划的偏差：

- **R1**：按计划落地——`multiIntent` 合并进 G1 精排的同一 flash 调用；G1 先跑、G3 仅多意图触发且结果过防幻觉白名单；G2 会话级冻结；内置服务器（serena/codegraph/a2ui/activity-frames）默认 pin；`routing/telemetry.ts` 结构化事件（G1/G2/G3/SAD/server 五阶段，经既有 `configureRoutingLogger` 单点注入双通道输出）。
- **R2**：按计划落地——frontmatter `categories/inputs/outputs` 契约（全可选，缺失行为与现状逐字节一致，向后兼容测试锁定）；`composeSkillRoute` 携带元数据激活 `ioTypeCoercion`/`categoryJaccard`；**DAG 编排提示**以隐藏 `<orchestration-plan>` 系统消息注入（步骤 + 依赖顺序，不再丢弃）；skill-writer 模板同步契约文档。
- **R3**：**facade 全量落地，lazy connect 以"机制落地、行为保持"方式实现**——`RoutingFacade`（decide-once/invalidate/invalidateAll + 事件内嵌）承接 G2 决策，session 侧保留物化缓存保证数组 identity 稳定；`ensureMcpServersConnected` 按 decision.serverNames 拉起声明态但掉线的服务器。诚实记录：当前服务器清单全部为"用户显式配置或内置 pinned"，lazy 今天无目标人群——强行改变启动行为只有回归风险，故机制留接缝（含合成服务器测试），待非 pinned 自动注入服务器出现时自然激活，同时兼任子进程死亡的自愈通道。
- **R4**：按计划落地——设置保存触发 `invalidateRouting()`（bundle/冻结集/退避时间戳三清）；加载失败 60s 退避；G1/G3 signature 统一为单一 builder（含 categories，交替不再触发 rebuild）；`routing-vec-*.json` LRU GC（上限 32）；budget 估算改用序列化 schema 真实长度（`RoutableTool.schemaJson`）；知识面板新增"语义路由"卡片（ready/idle/error 三态 + 载因，i18n 6 语言）。

---

## 〇、问题映射（审计结论 → 设计输入）

| #   | 缺口                                                                                                                                                                       | 现状证据                                                                                                  | 危害                                                                                                                            | 对应工件 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A1  | **G3 无门槛前置**：每条带文本消息先跑一次 SAD flash 分解，无复杂度预判；G3 命中即短路、跳过 flash 精排验证                                                                 | `session.ts:1700-1717`（composeRoute 在 G1 之前无条件尝试）；`composeRoute` 仅检查 enabled+ready+候选非空 | 每轮 1→2 次 flash 调用（成本/延迟净回归）；置信度倒挂——低保障路径（纯 embedding）先跑且命中后短路高保障路径（LLM 精排）         | M2       |
| A2  | **G2 逐迭代重路由**：工具集按"最近 assistant 消息"逐迭代重算                                                                                                               | `session.ts:2936` 在激活循环内调用 `getRoutedMcpTools`；查询上下文含动态 assistantSummary（1113-1125）    | 工具集变化=请求前缀变化=**DeepSeek 前缀缓存全灭**（与 dsh"前缀字节守恒"及 6a9b70f2 cache-first 正面冲突）；多步任务中途工具消失 | M1       |
| B3  | **Compose 退化 + DAG 丢弃**：SkillInfo 无 categories/inputTypes/outputTypes → `ioTypeCoercion`/`categoryJaccard` 恒零；CompositionPlan 的 DAG/步骤编排被扁平化为技能名并集 | `session.ts:1706` 注释自认元数据缺失；消费端 1714-1719 只取 `steps[].skill.name`                          | G3 相对"多查询 G1"的增量价值趋零，成本（SAD 调用）却照付                                                                        | M3       |
| B4  | **配置一次性快照 + 失败每轮重试**：routerBundle 终身缓存，`settings.routing` 运行时改不动；import 失败后 `routerInitPromise` 清空、每条消息重试                            | `session.ts:988-1036`                                                                                     | 用户关不掉路由；embedding 包缺失时每轮浪费一次 dynamic import                                                                   | M5       |
| B5  | **连接面缺失**：全部配置+内置服务器无条件启动，语义路由只作用在注入面                                                                                                      | `initMcpServers → mcpManager.initialize(augmentMcpServersWithBuiltins(...))`；无任何 lazy 语义            | 重服务器（serena/codegraph）不管用不用全启动；G2 索引签名覆盖所有已连服务器                                                     | M4       |
| C1  | G1/G3 共用 VectorIndex 但 signature 字符串不等（`name\0desc` vs `name\0desc\0""`）→ 交替触发 rebuild（磁盘缓存兜住，仅 CPU/IO 浪费）                                       | `skill-router.ts:156,172`                                                                                 | 小                                                                                                                              | R4       |
| C2  | `routing-vec-*.json` 磁盘缓存无 GC，只增不减                                                                                                                               | `vector-index.ts:146-156`                                                                                 | 小                                                                                                                              | R4       |
| C3  | G2 budget 估算只算 name+desc ×3，与真实 schema 体量偏差大（方向偏小→更少路由，"安全"方向失真）                                                                             | `tool-router.ts:132-140`                                                                                  | 小                                                                                                                              | R4       |
| C4  | **零观测**：路由命中/回退/耗时无任何遥测——当年"routing 从未运行"的 bug 潜伏数月正因失效完全静默                                                                            | routingLogger 仅在 embedding 加载失败时用一次                                                             | 中（结构性复发风险）                                                                                                            | M6       |

**闭环现状判定**：G1 主链 ✅ 真闭环；G2 ⚠️ 数据流闭环但语义有害；G3 ❌ 半闭环（组合结果无消费、兼容度恒零）；配置链 ❌；观测链 ❌；连接面 ❌ 无。

---

## 一、目标架构：六个 ModuleDesign 工件

> 设计主线：把"逐 turn 决策"重构为"**会话级一次决策 + 显式失效**"。G2 冻结、G3 闸门、lazy connect 三件事共享同一骨架，收口进一个深模块。

### M1. RoutingFacade —— 会话级路由决策单点（核心新模块）

```
ModuleDesign:
  module: packages/core/src/routing/routing-facade.ts（新建，UI-free）
  interface:
    methods:
      - decide(context: RouteContext): Promise<SessionRoute>
        RouteContext = { sessionId, userMessage, skills, mcpServers(声明态), mcpTools(已发现) }
        SessionRoute（纯数据，无行为）= {
          injectedToolNames: string[]        // 会话内冻结的注入集（字节稳定）
          serversToConnect: string[]        // lazy connect 集（含 pinned）
          skillDecision: { names: string[]; multiIntent: boolean; orchestration?: string }
          events: RoutingEvent[]            // M6 观测事件随决策产出
        }
      - invalidate(reason: string): void    // 显式失效：配置变更/用户手动/嵌入服务重启
    invariants:
      - 会话内工具集字节稳定（前缀守恒）：decide 每会话至多一次，重路由只能经 invalidate
      - 一切失败 fail-open 回退超集（全工具/全服务器/全技能候选），SessionRoute 永不为 null
      - 决策产物是纯数据 —— 可序列化、可测试、可观测（"返回结果，别产生副作用"）
  depth: deep —— 调用方学一个方法，同时得到 G2 冻结 + G3 闸门 + lazy connect + 观测
  seam_location: SessionManager 对 facade 的调用点（激活循环外，每会话一次）+ mcpManager.initialize 的调用点
  adapters: SessionManager（桌面/CLI 共用）、routing 测试
  leverage: 前缀稳定性策略一次实现，三个消费方（工具注入/MCP 连接/技能编排）受益
  locality: "何时重路由"的答案只存在于 facade 一处
删除测试: 拆掉该模块 → 冻结/闸门/lazy 语义散回三处各自实现 → 前缀稳定性不再可审计 → 模块在创造价值。
```

### M2. 判定合并 —— 一次 flash 调用完成 G1 精排 + G3 复杂度闸门

- `identifyMatchingSkillNames` 的 flash JSON schema 增加 `"multiIntent": boolean`；G1 精排与复杂度判定**同一次调用**完成（零额外成本）。
- **顺序反转**：G1（有防幻觉验证的高置信路径）先跑；仅 `multiIntent === true` 时才进入 G3（SAD→检索→Compose）。单意图路径恢复 **1 次 flash 调用/轮**，置信度倒挂修复。
- G3 命中后仍需经 `candidateSkillNames` 白名单过滤（与 G1 同款防幻觉，补齐当前 G3 短路路径缺失的验证）。

### M3. SkillMetadata 契约 —— G3 能力闭环的数据前提

```
ModuleDesign:
  module: packages/core/src/skills/metadata.ts（frontmatter 解析）+ SkillInfo 类型扩展
  interface:
    methods:
      - parseSkillMetadata(frontmatter): { categories?, inputs?, outputs? }（全部可选，缺省即现状）
    invariants:
      - 向后兼容：无元数据的技能行为与现状逐字节一致（测试锁定）
      - 单一事实源：categories/inputs/outputs 只在 frontmatter 声明，Compose 与 skill-writer 模板共用同一契约说明
  seam: SKILL.md frontmatter（技能作者侧）→ normalizer → CompositionalSkill
  adapters: skill normalizer（session.ts）、skill-writer 模板、composeRoute
  leverage: 一次契约，Compose 的 ioTypeCoercion/categoryJaccard 由恒零变活数据，Eq.4 恢复本义
```

- **DAG 消费（数据流闭环关键）**：`CompositionPlan.steps[].{subTask, skill}` 与 `dependencies` 渲染为编排提示（"本请求已分解为 N 步：①…用 X 技能 → ②…用 Y 技能；②依赖①的产物"）注入会话——编排信息不再丢弃，G3 从"扁平取名"变为真组合路由。
- skill-writer/deeporca-self-refer 模板同步契约文档（新技能可选填）。

### M4. McpServerRouter —— 连接面路由（lazy connect）

```
ModuleDesign:
  module: 并入 RoutingFacade 的 decide（不单独建类——两个 Adapter 才算真实 Seam，
          连接面与注入面共享同一决策产物，拆开反而制造状态同步接缝）
  interface:
    - SessionRoute.serversToConnect 驱动 mcpManager.initialize(subset)
    - 声明态配置（settings + augmentWithBuiltins）保持不变，连接按需发生
    invariants:
      - 内置基础设施默认 pinned 常连：serena / codegraph / a2ui / activity-frames
        （它们服务全域能力而非单轮意图，且 codegraph/a2ui 是进程内服务器）
      - 未命中服务器零子进程；命中后在会话内保持连接（与注入集同冻结）
      - 用户显式 upsert/enable 的服务器视为 pin（用户意图优先于语义路由）
  depth: deep —— "哪些服务器该活着"的答案与"哪些工具该被看见"同源同冻结
  leverage: 前缀稳定 + 启动成本一次解决；G2 索引签名随之只覆盖已连服务器
```

### M5. 配置热更新 + 失败退避

- desktop `updateSettings` 通路在 patch 含 `routing` 键时调用 `sessionManager.invalidateRouting()`（丢弃 routerBundle + 嵌入服务代际失效 `closeEmbeddingService()` 后按需重建）。
- embedding import 失败 → 60s 退避窗口（模块内时间戳，不重试不计数）；窗口内 getRouters 直接返回 null bundle 且**缓存该失败**。

### M6. RoutingTelemetry —— 观测闭环

```
ModuleDesign:
  module: 并入 RoutingFacade（events 随 SessionRoute 产出）+ routingLogger（已注入）
  interface:
    - RoutingEvent = { stage: "G1"|"G2"|"G3"|"server"|"embedding"; outcome: "hit"|"fallback"|"skip"; latencyMs; counts }
    invariants:
      - 观测随决策产出（纯数据），不引入独立计时副作用
      - 每会话汇总一行：routing ready? skill 命中数 / 工具注入数(冻结) / 服务器连接数 / fallback 次数
  adapters: routingLogger → desktop 日志；knowledgeStatus IPC → 知识面板"语义路由"卡片
  leverage: "静默失效"结构性不可再现 —— 当年 routing 从未运行的 bug 若有此观测当天可见
```

---

## 二、数据流闭环图（方案后）

```
技能链:  扫描 → 索引(签名+缓存+GC) → G1 召回+精排(合并 multiIntent 判定)
              └─ multiIntent → SAD 分解 → 检索 → Compose(真元数据, Eq.4) → DAG 编排提示
         → 防幻觉白名单过滤 → 注入 <skill> → isLoaded 直通（会话内递减）           ✓ 闭环

工具链:  会话首 turn → RoutingFacade.decide（一次）
              → 注入集（会话内字节冻结，前缀守恒）
              → lazy connect 集（未命中零进程，pin 常连）
         → 激活循环各迭代消费冻结集，不再重路由                                 ✓ 闭环

配置链:  settings.routing 变更 → updateSettings → invalidateRouting → 重决策     ✓ 闭环
观测链:  RoutingEvent[] → routingLogger + 知识面板                              ✓ 闭环
索引链:  技能/工具集变化 → 签名比对 → 重建（磁盘缓存命中免嵌入）→ LRU GC          ✓ 闭环
```

未闭环且明确不做（记录防漂移）：**匹配负反馈**（匹配错了无再学习）——静态技能库场景收益低，且引入在线学习复杂度；列观察项。

---

## 三、批次计划（R1 → R4）

### R1 — 止血：前缀稳定 + 调用回归（0.5~1 天，`fix/routing-prefix-stability`）

| #   | 任务                                                                                         | 落点                                                          |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1-1 | M2 合并判定：flash schema 加 `multiIntent`；G1 先跑、G3 仅多意图触发；G3 结果过白名单        | `session.ts identifyMatchingSkillNames/createSkillDecomposer` |
| 1-2 | G2 会话级冻结（先以 SessionManager 内 Map<sessionId, frozenTools> 实现，R3 重构上移 facade） | `session.ts getRoutedMcpTools`                                |
| 1-3 | 内置服务器默认 pin（DEFAULT_ROUTING_CONFIG.pinnedServers）                                   | `routing/types.ts`                                            |
| 1-4 | Telemetry 最小版：G1/G2/G3/SAD 的 hit/fallback/skip+耗时经 routingLogger                     | `session.ts` 路由触点                                         |

**验收**：单意图会话 flash 调用数 = 1（mock client 计数测试）；同会话两轮 tools 数组字节一致（快照测试）；多意图会话 SAD 恰好一次。

### R2 — 能力闭环：元数据契约 + 真组合路由（1~2 天，`feat/skill-metadata-compose`）

| #   | 任务                                                                        | 落点                                          |
| --- | --------------------------------------------------------------------------- | --------------------------------------------- |
| 2-1 | M3 契约：frontmatter `categories/inputs/outputs` 解析 + SkillInfo 扩展      | `skills/metadata.ts`、`session.ts normalizer` |
| 2-2 | Compose 激活：CompositionalSkill 携带元数据进 composeRoute（兼容缺省）      | `session.ts:1706` 一带                        |
| 2-3 | DAG 编排提示注入（steps+dependencies → 执行提示消息）                       | `session.ts appendSkillMessages` 一带         |
| 2-4 | skill-writer / deeporca-self-refer 模板同步契约说明                         | `templates/`                                  |
| 2-5 | 测试：元数据缺失行为与现状逐字节一致（向后兼容锁定）；带元数据 Compose 单测 | core tests                                    |

### R3 — 连接面：RoutingFacade + lazy connect（1~2 天，`feat/mcp-server-router`）

| #   | 任务                                                                                                  | 落点                                          |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 3-1 | M1 facade 抽取：R1 的冻结逻辑上移为 `routing-facade.ts`，SessionManager 每会话一次 decide             | 新 `routing/routing-facade.ts` + `session.ts` |
| 3-2 | M4 lazy connect：serversToConnect 驱动按需 initialize；内置+用户显式操作视为 pin；tools/list 只含已连 | `mcp-manager`、`session.ts initMcpServers`    |
| 3-3 | 集成测试：未命中服务器零子进程（进程清单断言）；pin 常连；invalidate 后重决策                         | core tests                                    |

### R4 — 卫生（0.5 天，`chore/routing-hygiene`）

| #   | 任务                                                                              |
| --- | --------------------------------------------------------------------------------- |
| 4-1 | M5：updateSettings 含 routing → invalidateRouting；import 失败 60s 退避并缓存失败 |
| 4-2 | C1：G1/G3 signature 统一为同一 builder（含 categories 变化感知）                  |
| 4-3 | C2：routing-vec 缓存 LRU GC（上限 32 文件，按 mtime）                             |
| 4-4 | C3：G2 budget 估算改按序列化 schema 长度（JSON.stringify(def).length/4）          |
| 4-5 | 知识面板"语义路由"卡片（ready/命中/冻结注入数/fallback 计数）                     |

---

## 四、总验收口径

1. **调用经济性**：单意图会话每轮 flash 调用 ≤1；多意图会话 SAD 恰好 1 次（计数测试锁定）。
2. **前缀守恒**：同会话跨轮、跨迭代 tools 定义字节一致（快照测试）；对照 dsh 计划 P1-3（工具顺序稳定化）合并验收。
3. **连接面**：未命中服务器零子进程；pin 服务器常连；首用延迟 ≤ 一次正常 MCP 启动。
4. **配置闭环**：运行时关闭 `routing.enabled` 立即生效（下一会话零路由调用）。
5. **观测**：routing 事件在日志与知识面板均可见；人为断掉模型目录 → 面板 1 分钟内显示 fallback 而非静默。
6. **向后兼容**：无元数据技能、无 routing 配置的既有安装行为与现状逐字节一致。
7. `npm run check && npm test` 绿；`specs/skill-routing/design.md` 的 M3 目标（挂满内置 MCP 长会话每轮 token −30%）给出实测数字并回写 spec。

## 五、风险与回退

| 风险                                              | 缓解                                                                        | 回退                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| lazy connect 首用延迟（工具首次调用等服务器启动） | 内置基础设施 pin 常连；lazy 仅限非内置；会话内连接保持                      | revert R3，注入面冻结（R1）独立成立       |
| DAG 编排提示增加 token                            | 仅 multiIntent 会话注入；计入 G3 收益核算（§四.7）                          | 2-3 开关化（routing.orchestrationPrompt） |
| facade 重构引入行为漂移                           | R3 为纯结构迁移，R1/R2 测试先行护航                                         | revert R3                                 |
| hot-reload 代际失效误伤进行中会话                 | invalidate 只影响下一会话，进行中会话用已冻结集跑完                         | —                                         |
| multiIntent 判定假阴性（复杂请求没进 G3）         | G1 精排本身仍返回技能名单（能力不丢，只是无编排提示）；提示词中给出判定示例 | —                                         |

## 六、与既有计划的关系

- 本方案是 `specs/skill-routing/design.md`（G1-G3 原始设计）的**修订执行篇**：不推翻分级（G1 召回/G2 门控/G3 组合），修正其执行序（G1 先、G3 闸门后）并补齐原设计未覆盖的连接面与观测面。
- 与 dsh 落地计划（`archive/2026-08-14-dsh-adoption-plan.md`）**共享一个验收主题**：前缀字节守恒——dsh P1-3（工具顺序稳定化）并入本方案 R1 的快照测试一并验收。
- 与 designer 全域计划正交；唯一交集是 knowledgeStatus IPC（R4-5 面板卡片复用其通道）。
