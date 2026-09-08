# 知识库容器（KB Container）— 设计文档

> 日期：2026-09-08 · 状态：设计定稿（**储备项，当前版本不实施**——2026-09-08 用户拍板移入本规划区，开工时 `git mv` 回 `specs/kb-container/` 转活跃）
> 范围：**wiki（deepwiki）+ 架构图（archify typed-IR / 知识图谱）** 的存储格式容器化。**CodeGraph / CRG 排除在外**——它们是独立的分析索引（SQLite 库 + symlink 布局，链上本就以 update hook 重建语义存在，coord-chain §11.5），不属于知识库资产，格式与它们无关（用户拍板 2026-09-08）。
> 上游：coord-chain（`specs/coord-chain/design.md` R35/R40/§11.5）· OKF 调研（2026-09-08 会话，结论：OKF 作为导入/导出适配器，非存储格式）

## 1. 定位与三个核心决策

把 wiki + 架构图从「散文件目录」收敛为**单文件容器**：`<workspace>/.deeporca/kb/knowledge.dkb`。容器内嵌 git 的数据模型（内容寻址 blob + 快照 manifest + head 指针），是知识库的**唯一事实源**，由 main 进程确定性管线**独占写入**（事务化）。

三个决策（2026-09-08 调研定案）：

1. **壳 = SQLite 单文件**（`node:sqlite`，零新依赖）。依据：融合需求逼出内容寻址结构（git 数据模型），ZIP 壳整包重写 + 无事务被排除，自研 pack 重复造 SQLite 已有的索引/事务/压实。xlsx/PSD 是需求来源（单文件制品心智模型），不是实现候选——两者恰好都是「整文件重写、无版本」的格式，在增量写与快照融合上不及格。
2. **快照 manifest 与 `GitFileHistory` manifest / 链 ws tree 同构**（`Record<path, {blob, mode}>`）。容器快照 ↔ 链 tree 零翻译，`kb.sync` 的机械判定（coord-chain §11.5）直接落在容器快照的 baseline 字段上。
3. **容器本身是信任根**：model 的写授权只覆盖目录暂存区（现状不变），容器只接受确定性管线的事务写入——以容器的 host-only 写入边界**取代 per-file receipt HMAC**（§5.3，receipt 的 per-install secret 本就跨机不可移植）。

## 2. 生产方式现状（本设计的地基，2026-09-08 代码核实）

### 2.1 wiki 管线（`desktop/main/tools/wiki-cli.ts` + `wiki-staging.ts`）

```
触发: knowledge:build(index.build-all 阶段2) / 文件变更后自动同步 hook（fire-and-forget update） / LLM action wiki.init|wiki.update

init : 恢复孤儿stage或丢弃stage → vendored openwiki CLI 全新生成（agent 增量写页到 openwiki/）
       → 内容重量校验（>512B 页计数；exit code 与完成标记都不可信）→ promote
update: hasWikiStore → noChangeFastPath（marker.gitHead == HEAD 且树干净 → 跳过）
       → 每根串行mutex → 丢弃stage → copyStoreToStage（deepwiki→openwiki 全量拷贝）
       → ensureSaneWikiMarker（治愈非法 gitHead）→ CLI --update（agent 以 git log <gitHead>..HEAD 增量）
       → 校验 → promote → 清扫 stage 残留
promote: store→.trash aside → stage rename 进位（原子）→ 删 aside（崩溃安全；promote 抛错时 stage 是唯一副本，必须存活）
```

- **完成标记 `.last-update.json`**：写在 stage 内、随晋升混入 `.deeporca/deepwiki/` 内容区，字段 `{gitHead(40-hex), status: complete|interrupted, model}`——这就是 wiki 现行的**基线锚**（锚定工作区 git HEAD）。
- 失败模式已制度化：空跑自动重试（可切辅助模型）、interrupted 警告（下次增量补全）、卡退出 60s 强制按完成处理。

### 2.2 架构图管线（`desktop/main/tools/archify-cli.ts` + `core/actions/index-build.ts` 阶段3）

```
触发: index.build-all 阶段3（sessionless background task）/ arch-scan.run / 面板手动渲染

authoring: background task（arch-scan skill）读 codegraph+wiki 证据，agent 亲手写 typed-IR
           → .deeporca/prototypes/arch-<slug>.<type>.json（5类: architecture|workflow|sequence|dataflow|lifecycle；
             写授权覆盖整个 prototypes/ 目录）
fastPath  : 树干净（排除生成目录）且现有图 mtime > HEAD 时间戳且全部已交付 → 跳过 LLM，只跑交付门禁
checkpoint: 增量运行前内存快照全部实质 IR；运行后丢失/降级(≤256B)者从检查点恢复（防 LLM bash 越权摧毁）
deliver   : 确定性门禁——清扫退化残留 → 逐工件: HTML存在 && 不stale && receipt校验通过 → 跳过(仅刷新patches)；
           否则 archify CLI schema+layout+render 校验 → 原子提交 HTML → 套7个幂等viewer补丁 → writeReceipt
receipt   : <html>.receipt.json = {htmlSha256, irPath, at, mac=HMAC(htmlPath|sha, per-install secret@userData)}
           —— 只有 host 交付的 HTML 才被 iframe/预览信任，model 伪造的一律重渲染
```

### 2.3 中间产物清单（本设计必须逐一处置的对象）

| # | 产物 | 位置 | 生命周期 | 现状角色 |
|---|---|---|---|---|
| W1 | `openwiki/` stage 目录 | 工作区根 | 运行中存在，结束后清扫 | CLI 唯一可写区（事务暂存） |
| W2 | `.last-update.json` | stage 内→晋升后混在 deepwiki store | **持久** | wiki 基线锚（gitHead/status/model） |
| W3 | `.github/workflows/openwiki-update.yml` | 仓库 | CLI 每次重丢，非预存即清理 | 上游 CLI 副作用 |
| W4 | `~/.openwiki/connectors/*` | 用户级 | 持久 | 生成期 CodeGraph/Serena MCP 连接器配置 |
| A1 | typed-IR `arch-*.<type>.json` | `.deeporca/prototypes/` | **持久（权威工件）** | agent 授权产物；HTML 的编辑源 |
| A2 | `<name>.html` | 同上 | 持久（渲染产物） | archify 原子交付 + 7 个幂等补丁 |
| A3 | `<name>.html.receipt.json` | 同上 | 持久 | 信任 sidecar（HMAC 绑本机 secret） |
| A4 | 内存 checkpoint（IR 快照 Map） | index-build 进程内 | 单次运行 | 防 LLM 自毁的恢复点 |
| A5 | 退化残留 / `.patching` tmp | prototypes/ | 瞬时 | 门禁清扫 / 原子写中间态 |
| F1 | `knowledgeFreshness` wikiSync/archSync | main 内存 | 重启即失（读面用 mtime 兜底） | 面板 stale 判定 |

### 2.4 基线锚现状 → 需要统一

wiki 锚 = `marker.gitHead`（git SHA）；arch 锚 = mtime vs HEAD 时间戳（弱比较）；coord-chain §11.5 要求知识锚 = 本地 head checkpoint（checkpointHash）或链上 commitCid。三套口径必须在容器里统一为一个 `baseline` 字段（§4.3）。

## 3. 容器格式

- **文件**：`<workspace>/.deeporca/kb/knowledge.dkb`（扩展名 dkb = DeepOrca Knowledge Base，落点/命名可评审调整）。WAL 模式 + 空闲/退出时 `checkpoint(TRUNCATE)`，接受瞬态 `-wal/-shm` 伴生。
- **写入者边界**：仅 main 进程 KB 模块（`desktop/src/main/kb/`，按 2500 行纪律拆 `kb-store.ts` / `kb-merge.ts` / `kb-import.ts`）。renderer 走 IPC，core 经 seam 注入（与 WikiController 同模式，core 不新增 sqlite 依赖面）。
- **表结构**：

```sql
blobs(hash TEXT PRIMARY KEY, size INTEGER, data BLOB);          -- 内容寻址条目本体
snapshots(id TEXT PRIMARY KEY, parent TEXT, baseline TEXT/*JSON*/,
          origin TEXT, ts INTEGER, manifest TEXT/*JSON: Record<path,{blob,mode}>*/);
head(id TEXT);                                                   -- 单行：现行快照
attic(path TEXT, blob_hash TEXT, superseded_by TEXT, origin TEXT, ts INTEGER,
      PRIMARY KEY(path, blob_hash));                             -- 融合落败版留痕（开放问题#10的"链上可溯"）
meta(key TEXT PRIMARY KEY, value TEXT);                          -- 格式版本 / okf_version / 上次kb.sync摘要 / freshness
wiki_fts(...)                                                    -- P1: FTS5 over 现行 wiki 条目（面板检索增益）
```

- 条目路径沿用现有语义：`wiki/index.md`、`wiki/modules/auth.md`、`arch/arch-checkout.architecture.json`、`arch/arch-checkout.architecture.html`（派生缓存，见 §5.3）。
- 内容寻址使快照 diff = 两 manifest 键集比对（毫秒级，coord-chain §14 同款结论）；未变条目跨快照零重复存储。

## 4. 操作语义

### 4.1 读写

- **读**：head → manifest → hash → blob，索引查找，与包内其他条目无关。
- **写**：单个 SQLite 事务内完成「写 blob → 写新快照（新 manifest）→ 推进 head」。崩溃安全，只写增量，**永不全文件重写**（这是对现 promoteStage rename 链的直系替代，崩溃窗口从「rename 链中间态」缩到「事务原子性」）。

### 4.2 快照

每次管线提交产出一个快照。R35「KB 无历史管理、无回滚 UI」不因此改变：快照是**协议机制**（覆盖判定的依据、融合的原子单元），不暴露为用户功能。保留策略：最近 N 个快照 + 全部 attic，择机 `VACUUM`（KB 规模下成本可忽略）。

### 4.3 baseline 锚（统一三套口径）

```jsonc
// snapshots.baseline
{ "kind": "git" | "checkpoint" | "wscommit", "ref": "<40-hex | checkpointHash | commitCid>", "ts": 0 }
```

- 纯本地 git 场景：`kind:"git"`，ref = HEAD（对齐现行 wiki marker / arch fastPath 行为）。
- coord-chain 场景：链上对齐后为 `wscommit`，本地无链对齐时 `checkpoint`（§11.5 的「等价锚」）。
- **判定分工**：baseline 提供「链上 KB 资产到达」的粗判（`baseline ≥ 本机锚 → 覆盖采纳`，§11.5 机械判定）；manifest 三方对比提供精确融合（§4.4）。异 kind 不可直接比序时回退到 manifest 对比——两者互补，粗判定路由，细对比裁决。

### 4.4 覆盖融合（kb 资产到达 / 链同步的融合入口）

传入快照 A（baseline Ba）× 本地 head L（Bl），逐路径三方比对（共同祖先 = 快照表中最近的共享 manifest 基态）：

| 情形 | 动作 | kb.sync 字段 |
|---|---|---|
| A 改、L 未改 | 取 A | `adopted[]` |
| L 改、A 未改 | 留 L | `keptLocal[]` |
| 双方均改且不同 | 按 §11.5 惯例 `(ts, origin)` LWW；落败版进 `attic` | `adopted[]` + conflict 留痕 |
| baseline 相交判定先行（A 基线 ≥ 本机锚） | 整体覆盖采纳（R35 严格模式） | `adopted[]` |

融合结果 = 新快照（baseline 推进为 max），**单事务原子生效**；产出直接构造成 `kb.sync{baseline, adopted[], keptLocal[], agentsMerged}` 记账负载。AGENTS.md **不在容器内**（标记块合并是 §11.5 独立机制，仓库根文件照旧）；符号图不在容器内（hook 重建）。

## 5. 中间产物处置（逐条）

| 产物 | 处置 | 理由 |
|---|---|---|
| W1 `openwiki/` stage | **保留在容器外**，角色不变：不可信输入缓冲。晋升点从「rename 进 deepwiki/」改为「事务导入容器」（`kb-import.ts: importWikiStage`，逐条读入→blobs→新快照→推进 head，校验逻辑与 512B 重量线复用）后清扫 | LLM 可写区必须与事实源隔离——现行 staging 的全部安全设计（校验门禁、坏运行不伤 store）原样保留，只是终点换成事务 |
| W2 `.last-update.json` | **升格为快照字段**：`baseline` + 快照 `origin/meta` 携带 status/model。容器内 wiki 内容区不再有隐藏文件 | 元数据混进内容区是现行形态的历史包袱；OKF 导出（§7.2）也不该带 `.last-update.json` |
| W3 GitHub workflow | 不变（管线外围清理行为照旧） | 与 KB 格式无关 |
| W4 `~/.openwiki/connectors` | 不变 | 生成期配置，非知识资产 |
| A1 typed-IR json | **进容器为主数据**（权威工件）。authoring 阶段保持目录形态：agent 仍写暂存区（建议 `.deeporca/kb/staging/arch/`，沿用 prototypes 的写授权模型），deliver 门禁后事务入库，暂存区清扫 | agent 亲手写的是 IR；SQLite 文件绝不能进 model 写授权 |
| A2 渲染 HTML | **进容器为派生缓存**（行内带 `ir_hash` 指针）；入库前套用 viewer 补丁（容器内即最终形态） | 链上分发自包含（对端拿到即可用）；补丁幂等收敛设计支持升级后 re-patch（读出→补丁→事务回写） |
| A3 receipt sidecar | **退役**。信任锚换成「容器 host-only 写入边界」：model 写不进 SQLite 文件，容器内 HTML 天然 host 交付（安全强度不降反升——receipt 防的 TOCTOU/伪造路径整类消失） | receipt 的 HMAC secret 是 per-install 的，**跨机不可移植**：链上同步的对端校验必失败、必然重渲染；容器方案让信任随容器本身走 |
| A4 内存 checkpoint | 保留 | 它保护的是**暂存区**（agent 仍可在目录暂存区自毁 IR），容器事务管不到暂存区 |
| A5 退化残留/tmp | 暂存区清扫照旧；容器内不存在此问题（事务） | — |
| F1 freshness 戳 | **收进容器 meta**（wikiSync/archSync + baseline），重启不丢，读面 mtime 兜底逻辑可简化 | in-memory 戳「重启即失、非活动工作区不可见」是现行已知缺陷（knowledge-ipc.ts 注释自证） |

## 6. 管线改造点（集成面盘点）

1. **wiki-cli.ts**：`promoteStage` → `kb.importWikiStage`；`noChangeFastPath` 改读 `head.baseline`；`hasWikiStore`/`countSubstantialPagesIn` 对 stage 保留 fs 实现、对 store 改容器查询。串行 mutex 保留（SQLite 单写者 + 管线互斥双保险）。
2. **index-build.ts**：`hasExistingWikiArtifacts`/`hasExistingArchmaps`/`archNoChangeFastPath` 改查容器（fastPath 的 mtime 比较顺带升级为 baseline 比较）；阶段 3 交付后暂存区清扫。
3. **archify-cli.ts**：`deliverAllPending` 渲染目标从 prototypes/ 改为容器（IR 读暂存区 → 渲染临时文件 → 套补丁 → 事务入库）；`refreshViewerPatches` 变为「读容器 → re-patch → 回写」；receipt 写入/校验删除。
4. **knowledge-ipc.ts**：status/arch 列表/读 JSON 改容器查询；`archPathWithinRegisteredRoot` 的路径 pin 改为 `(registeredRoot, entryPath)` 二元组 pin（容器路径本身 + 条目路径白名单校验，防穿越逻辑保留）；**HTML 预览仍需真实文件**：打开/内嵌前从容器导出到 userData 临时目录（导出时校验 `ir_hash`/内容 hash），沙箱窗口与权限拒绝逻辑不变。
5. **core/actions/wiki.ts**：`wiki.list-pages`/`read-page` 改经 host 注入的读取 seam（core 保持 fs/sqlite 双不沾，与 WikiController 同模式）；frontmatter 解析（已是 OKF 形态：type/title/description/tags）不动。
6. **IPC 契约**：`shared/ipc.ts` knowledge 通道的行为语义不变（读面类型不变），新增可选的容器信息字段（格式版本、head baseline、上次 kb.sync 摘要）——顶部同步状态行（R35 唯一 UI 表面）数据源。

## 7. 与链路共享 / OKF 接线

- **链上分发**：容器文件 = 一个 blob 资产（预算内 10–30MB，4MB 分块 have/want 直接吃），一个 CID，原子同步。对端到达后「导入为传入快照」→ §4.4 融合 → `kb.sync` 记账。未来增量同步（只传变化 blob）因 manifest 与 ws tree 同构而零翻译，留 OC4。
- **OKF 适配器**（2026-09-08 调研结论的落点）：`.dkb → OKF bundle 目录` 导出、`OKF bundle → .dkb` 导入，宽容消费（未知 type/key 不拒绝）；同时充当人工检查/外部工具互操作后门。容器 meta 携带 `okf_version`。
- **安全红线**：容器路径必须过 `resolveRegisteredRoot()`/`isKnownRoot`；renderer 零直读；model 写授权仅限暂存区（与 prototypes 现状同模型）。

## 8. 迁移与兼容

一次性导入（对齐 `migrateLegacyWikiStore` 的 adopt 纪律）：首次触达时若存在 `.deeporca/deepwiki/`（含其 `.last-update.json` → 转 baseline）或 `.deeporca/prototypes/arch-*` → 读入构造首快照（baseline `kind:"git", ref:<marker.gitHead ?? HEAD>`）；导入校验（条目计数 + 重量线）通过后原目录按 promoteStage 的 swap-aside 精神移除，失败保留原目录重试。未迁移项目零行为变化（R21 同款红线）。

## 9. 体积与性能预算

wiki 数十页 ×3–5KB + arch 5–10 张 ×（IR 50–200KB + HTML 0.5–2MB）≈ **10–30MB** 单文件。单条读 <0.1ms、事务写 <1ms、FTS5 检索 <1ms（P1）；内容寻址使增量写只触变更条目；Windows 侧消除「数百小文件 + 杀软扫描」的枚举痛点。

## 10. 风险与开放问题

1. **HTML 派生缓存的时效**：archify 补丁升级后需 re-patch sweep（幂等收敛，现有设计直接沿用），容器让 sweep 变成读改写事务——成本可接受但需防频繁全量 sweep（按补丁版本号跳过）。
2. **融合冲突粒度**：页级 LWW + attic 留痕是否够用，对应 coord-chain 开放问题 #10，随 OC3 dogfood 一起验证。
3. **容器损坏**：SQLite 自身可校验（`PRAGMA integrity_check`），容器文件损坏时的恢复路径 = 从链上重拉 / 从 stage 重导 / 从 OKF 导出重导——写进故障手册。
4. **baseline 异 kind 比较语义**（§4.3）：git SHA 与 commitCid 不可直比时的路由规则需单测钉死。
5. **暂存区命名**：`.deeporca/kb/staging/` 还是沿用 `openwiki/` + prototypes/ 原位（更小改动面）——开工前评审定夺；倾向原位（CLI 硬编码 openwiki/ 不可改，arch 暂存维持 prototypes/ 可少动一处授权配置）。
6. **与 coord-chain 的落地时序**：容器先落（单机即受益），`kb.sync`/链上分发随 OC3 接线；baseline 的 `checkpoint`/`wscommit` 两态在链未合并前休眠。

## 11. 分期建议

| 期 | 内容 |
|---|---|
| P0 | kb-store（表结构/事务/读写）+ 一次性迁移 + wiki 管线切换（stage→容器）+ status/读面切换 |
| P1 | arch 管线切换（deliver 入容器、receipt 退役、预览导出）+ baseline 统一 + freshness 入 meta |
| P2 | 覆盖融合 + attic + kb.sync 负载产出（对接 coord-chain OC3）+ FTS5 面板检索 + OKF 导入导出适配器 |
