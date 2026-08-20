# Studio 基座增强（H 线）— 技术设计

> 日期：2026-08-20 · 状态：**规划中（`next/*` 版本窗口，随主线 B（module-system P0 起步）节奏实施）**
> 来源预研：`docs/research/external-eval/2026-08-20-helix-harness-lego-prestudy.md`（HKUDS/HELIX）
> 挂靠：`docs/features/next-version-plan.md` 主线 B（action → Studio 基座）；母 spec = [`specs/module-system/design.md`](../module-system/design.md)（本文是其**借鉴增强子计划**，不改变其 P0–P2/D1–D3 阶段划分与红线）
>
> **总原则**：与 K 线同口径——**不引入、不 vendor、不拷贝代码与配置格式原文**（HELIX license 未核验，净室红线；其 lego-runtime 是替代性 harness 内核，与本仓引擎不兼容也不需要）。四项机制借鉴全部落在 module-system 既有阶段的验收项与门禁里，**零新增运行时依赖、零 vendor 脚本**。

---

## 0. 结论速览

| 轨道 | 内容 | 借鉴源 | 落点（母 spec 阶段） | 分期 |
| --- | --- | --- | --- | --- |
| **H1 平台 API 契约测试套** | 契约表（module-system §八）逐条 parity 测试：内置实现与（未来的）模块贡献实现跑同一套契约用例，契约变更即跑 | HELIX `conformance/` 跨实现一致性包 | B1（P0）验收项 | H1 P0 |
| **H2 port fixture 激活门禁** | CapabilityBroker Tier-0/1 激活前先跑对应能力的契约夹具，不过则拒载（fail-open 不阻塞内核） | HELIX port fixture | B1/B2（P0/P1）激活路径 | H2 P0 |
| **H3 dist.json provenance 强制** | 发行版清单每个模块/MCP/Skill 条目带来源 URL / license / 版本锁三字段，组装器缺字段拒装 | HELIX recipe source-traceable | B4（D1）dist.json schema | H3 P1（随 D1） |
| **H4 发行版编辑器四步流** | "检查 → 替换 → 验证 → 导出"流程形态（验证步 = 干跑组装 + 契约测试套） | HELIX browser builder | B4（D1/D2）UI | H4 P2（设计参考） |
| **A 线参照（不立任务）** | E1 数据 schema 参照 trace 标签分类；E3 设计引用其搜索空间组织 | HELIX training-data loop / harness search | next-version 主线 A（E1/E3 spec 各自吸收） | 记参照 |

## 1. H1 平台 API 契约测试套

### 1.1 动机

module-system §八承诺"对外只承诺七张平台 API 契约表"，母 spec 风险 R2 已指出冻结成本高；C-M1 也已计划 dispatch 契约漂移测试。HELIX 的 conformance 包验证了"契约必须有机器可执行的 parity 定义，否则契约表只是文档"。

### 1.2 设计

- 形态：`packages/core/src/modules/`（或 tests 侧）新增**契约用例集**——每条平台 API 契约表条目对应 ≥1 个可执行用例（输入 → 期望行为/错误面），内置实现必须全过。
- 双消费：① CI 回归（契约变更 = 破坏性变更，触发兼容矩阵检查，对应母 spec R2 缓解）；② 模块侧复跑（H2 门禁的用例来源，同一套用例喂给模块贡献实现）。
- 与 M1 dispatch 契约测试同族同风格（一套基建两种消费），B1 与 C-M1 同批设计时对齐用例格式。
- **红线**：P0 阶段契约表最小起步（母 spec R2 既定），契约用例只覆盖已承诺条目，不预写未冻结契约。

## 2. H2 port fixture 激活门禁

- CapabilityBroker 激活路径（Tier-0 起）插入一步：模块声明的每项能力（`action.invoke:<prefix>` / `fs.read:<glob>` / `llm.judge` 等）先跑对应 H1 契约用例（沙箱内、限时），全过才进工具面；任一失败 → 拒载该能力（模块整体 fail-open，内核会话不受阻）。
- 夹具结果进激活审计（复用 sandbox/audit.ts 链式日志的事件类型扩展或独立 `module_activate` 事件）。
- 分期：P0 对 Tier-0 的 `action.invoke` 一类能力先做；P1 worker 隔离就位后扩到全部 Tier-1 能力。

## 3. H3 dist.json provenance 强制

- schema：每个条目（module / mcpServer / skillPack / theme / layout）必填 `provenance: { source, license, version }`；组装器缺字段或 license 缺失 → 拒装并列明原因（对齐本仓 dembrandt 版权拒绝清单 / Provenance 块实践）。
- 该字段同时是 D2 签名信任链（ed25519）的输入之一——签名覆盖的清单必须可溯源。
- license 未核验/不明的第三方模块按 sandbox quarantine 同族思路降级：只能以不可信层（wasm + 数据 UI）装，不能带 renderer 组件代码。

## 4. H4 发行版编辑器四步流（P2 设计参考）

B4 期 UI 采"检查（清单体检+provenance 校验）→ 替换（原子/模块/主题换装）→ 验证（干跑组装 + H1 契约套 + H2 夹具）→ 导出（dist.json + 签名）"流程形态；各步产物可回放。本文只锁流程骨架，交互细节归 B4/B5 UI spec。

## 5. 净室红线（实现期约束）

1. 不拷贝 HELIX 任何源码、recipe/契约 JSON 格式原文与文档措辞；四项机制均为思想级借鉴，实现格式自研（dist.json schema 已由母 spec 定义，不向 recipe 格式靠拢）。
2. 思想来源标注以 `docs/research/external-eval/2026-08-20-helix-harness-lego-prestudy.md` 为凭。
3. 零新增依赖/零 vendor——违反即偏离立项前提。

## 6. 测试策略

- H1：契约用例集本身就是测试资产；用例格式单测 + "内置实现全过"进 CI。
- H2：拒载路径单测（夹具失败 → 能力不进工具面、模块状态可见、内核无感）；审计事件落链校验。
- H3：组装器 schema 校验单测（缺 provenance / license 缺失两分支）；不可信降级分支。
- H4：B4 期随 UI 测试，本文不预支。

## 7. 开放问题（实现前需拍板）

1. H1 用例格式与 C-M1 dispatch 契约测试是否统一为同一格式（建议统一，B1 与 M1 同批设计时定）。
2. H2 夹具超时预算（wall-clock 上限）与模块激活总时长上限（UX 可感知阈值）。
3. H3 对"来源为本仓官方注册表（D3 之前不存在）"的条目如何简化 provenance（本地路径条目的豁免格式）。
4. H2 夹具运行载体：P0 在主进程限时同步跑，还是直接进 worker（依赖 P1 worker 隔离就位）——影响 P0 范围。
