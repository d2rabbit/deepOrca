# 下一版本规划：自进化引擎 · Studio 基座 · 远程访问 · 知识编译 · 工作区语义检索

> 日期：2026-08-18（2026-08-19 增补主线 D）· 状态：**规划中（冻结期后的 `next/*` 版本路线，本文不排当前版本期）**
> 来源：会话 sess_2233bbaf 的方向确立（自进化引擎 / action→Studio 超大版本 / 远程访问），经 2026-08-18 全项目终判（`docs/pre-production-spec-final-audit.md`）与本日收尾批事实校正；2026-08-19 基于 llm_wiki 预研（`docs/research/2026-08-19-llm-wiki-prestudy.md`）增补主线 D 知识编译；2026-09-02 基于 zvec-grep 调研增补主线 E 工作区语义检索（spec [`specs/next-version/zg-semantic-search/`](../../specs/next-version/zg-semantic-search/design.md)）。**2026-09-03 对齐**：主线 spec 路径随 specs 目录重组更新至 `specs/next-version/`；文末新增储备 spec 章节（非主线项，不裁撤）；原预生产出口门槛已拍板毙掉（见 §0 入口前置更新）。
> 依据口径：路线与现状以 `docs/features/feature-roadmap.md` §0 为准；实现以 `specs/` 为准；调研仅参考。
> **⚠️ 优先级让位（2026-08-27）**：新立王牌路线 [OC · AI 协调工作链](./coord-chain-plan.md)（联盟链 + 资产共享 + 任务谱系接续开发）优先级高于本文 A–D 主线——资源冲突时 OC 优先，本文各主线启动顺序整体后移一位，内容与分期不变。**（2026-09-02 注：主线 E 同样让位于 OC。）**

## 0. 版本定位与入口（前置阻塞）

**三主线共享同一地基（action registry/dispatch 单点），同期做返工最少**——这是把 B1+B2 提升进下一版（而非原建议的"再下一版"）的核心理念。入口前置（**2026-09-03 更新**）：原预生产出口门槛（F4 真机烟雾交互清单走查 → H 预生产切换，spec 已废弃归档至 `specs/archive/deprecated/pre-production/`）**已拍板毙掉、不再作为启动闸**——冻结期结束后，本规划的全部主线即可进入 `next/*` 分支启动。

| 主线 | 下一版纳入 | 紧随其后一版 |
| --- | --- | --- |
| A 自进化引擎 | E1 执行捕获 + E2 改进回路（含 task-tree P3 设计） | E3 Self-Harness/HarnessBank 起步 |
| B action → Studio 基座（超大版本） | B1 冷插拔（P0）+ B2 热激活/隔离（P1） | B3 管理 + B4 发行版 MVP + B5 信任富 UI |
| C 远程访问 | M1 地基 + M2 隧道 + M3 配对 UX（含 MCP HTTP transport） | M4（WebRTC 打洞/E2E，可选） |
| D 知识编译 | D0 零基建 + D1 doc-wiki 编译层 MVP + D2 检索/图谱/研究闭环 | D3 生态（反向 MCP 暴露、多格式/剪藏扩面） |
| E 工作区语义检索（zvec-grep） | M0 P0 验证 + M1 core + M2 desktop adapter + M3 产品面（体量小：3–5 天） | M4 观察项（远程 embedding 授权 / full toolset / routing 联动） |

## 主线 A：自进化引擎（坐实路线图 §十一 三层）

| 层 | 现状（2026-08-18 终判） | 下一版动作 |
| --- | --- | --- |
| 层一 技能从哪来/好不好 | ✅ book-distill + skill-up CI 已落地（pin 已定版 v0.9.0） | — |
| 层一 **OpenSpace 闭环「执行→评估→改进」** | ❌ 唯一缺口（代码零匹配） | **E1 + E2** |
| 层二 harness 自改进（Self-Harness/HarnessBank） | ❌ P3 | 设计先行（E3），实现紧随其版 |
| 层三 蜂群协作 | ❌ P3 | 远期 |

- **E1 执行结果捕获基础设施（最核心，新立 spec）**：对 skill 和 action 统一记录成功/失败/重试/用户纠正；**埋点定于 `registry.execute` 单点**（与 action 总线动态化 B1 同 spec 设计，避免二次返工）。复用地基：activity-frames 管线 B 采集器、task-tree 轨迹、skill-up 裁判体系。
- **E2 改进回路**：低成功率技能 → skill-digester 重写 description；高成功率加权匹配。**⚠️ 关键张力**：「加权匹配」与 `docs/research/2026-08-15-routing-closure-plan.md` 的「匹配负反馈明确不做」决策冲突——解法已确立：**加权走离线批量**（skill-up 评估结果 → 静态元数据调整），不碰 G1 在线路由，必须写进 E1/E2 spec。
- **E3 层二起步（设计先行）**：Self-Harness 消费 E1 数据；HarnessBank evolver 复用 Subagent（`MAX_SUBAGENT_DEPTH=4` 在树）；执行隔离载体 = **task-tree P3（branch = subagent 载体）**，设计需先吸收 ruflo 预研的 journal/断点恢复/补偿三模式（`docs/research/2026-08-17-external-repos-prestudy.md` §5）。
- **度量端收尾**：skill-up 双引擎趋势对拍（T2.3）+ CI 首跑、B3 book-distill 端到端演练——均待真实 LLM 花费，列为预生产测试内容而非本版开发项。
- 缓期确认：G3 大技能分片召回注入（skill-routing 目标表 G3）~~**建议缓做**~~ → **2026-08-18 晚间拍板推翻：纳入本阶段收尾批实施**（已回写 `specs/skill-routing/design.md` 状态行；台账 `docs/spec-open-items-status.md` §一 #9）。

## 主线 B：action → Studio 基座（超大版本迭代）

**核心认知**（`specs/next-version/module-system/design.md` v2，当前全 0 代码）：defineAction 已完成（28 action 静态注册）是地基，终点是「DeepOrca = AI Studio 内核」——第三方不 fork 代码，用 dist.json 发行版清单组装垂直 AI Studio，DeepOrca 桌面版降级为参考发行版。五件套基座：action 总线 + A2UI + wasm 沙箱（唯一全缺）+ MCP + Skill。架构承诺：action 是唯一能力总线，一切 UI 事件汇入 `registry.execute`；L0 内核冻结，对外只承诺七张平台 API 契约表。

| 下一版分期 | 内容 | 体量 |
| --- | --- | --- |
| **B1 = P0 冷插拔** | registry 动态化四方法（`registerContributed`/`resolveContributed`/`unregisterOwner`/`onChanged`）、ModuleRegistry 单写者、in-process wasm runtime（DMABI + Tier-0 + 16MB 硬顶）、CapabilityBroker P0、`packages/guest-sdk/`（Rust） | 全线唯一从零大块（`packages/core/src/modules/` 6 文件） |
| **B2 = P1 热激活+隔离** | yield/resume 挂起协议、Tier-1 能力（`action.invoke:<prefix>`、`fs.read:<glob>`、`llm.judge`）、worker_threads 隔离、A2UI surface 贡献+回流（`a2ui:action` → `registry.execute`）、ModuleSurfacePanel | 小 |

（B3 管理+自举 / B4 发行版 MVP / B5 信任富 UI 属紧随其后一版；P3/D3 生态注册表远期不进主体。）

**⚠️ 文档级缝合空白**：§十二 插件中心远程源体系（marketplace.json）与 P3/D3 模块/发行版注册表是两套分发叙事，无分工说明——做到 D2 为止不碰，但 spec 需记录。

## 主线 C：远程访问（路线图 §十三 M1–M3）

**现状**：零代码（`packages/desktop/src/main/remote/` 不存在）。方案已细化到文件落点（`docs/research/2026-08-15-remote-access-sunlogin-mapping.md`）：向日葵式「被控端主动外连 + 云端映射 + 识别码配对」，自建 WSS 反向隧道，不 vendor frp/ngrok；否决 Tailscale mesh；三档入口自动选择（LAN 直连/公网直连/NAT relay）。

| 下一版分期 | 内容 |
| --- | --- |
| **M1 地基** | `createIpcHelpers()`（`main/index.ts`）dispatch 表抽取 + RemoteServer + 浏览器 shim + 契约漂移测试；只新增 `ws` 一个依赖；远程允许清单禁用桌面语义 channel（pickFolder、window:*）；审计日志。架构已复核：renderer 纯浏览器 bundle（零 Electron 直引）、102+15 IPC channel 集中、50+ 组件零改动 |
| **M2 隧道** | TunnelClient（Ed25519 设备密钥 + WSS 反向隧道）+ 新包 `packages/relay/` |
| **M3 配对 UX** | 识别码 + 6 位配对码 + QR + 设备端确认条 |
| **伴生** | **MCP HTTP/Streamable transport**——SDK 1.22 迁移承诺的「解锁远程 server」未兑现（仅 stdio），改动集中在 mcp-manager/spawn-spec，并入主线 C 一次做对 |

**与 action 线咬合**：defineAction 第四表面（HTTP endpoint）与 M1 dispatch 抽取同源，合并设计一次做对；module-system 开放问题「Web 壳是否纳入平台 ABI」维持「暂不承诺」。

**衔接鸿蒙**：远程访问（WS 无头服务端）正是鸿蒙 PC 移植（`docs/research/2026-08-18-harmonyos-pc-electron-port-feasibility.md`）的替代路线第一步——"core 抬到传输中立层"两线共用，C 线落地即解锁其验证 POC 的前置。

## 主线 D：知识编译（doc-wiki，路线图 §二 知识中心）

**现状**：知识栈六源无一消费"用户资料"——memory 只吃对话（L0–L3），OpenWiki 只吃代码，GitMCP 只吃外部 repo 文档；无"文档 → 结构化互链知识"的写入路径。llm_wiki 预研验证了缺口与补法（Karpathy「编译型知识库」方法论：知识**编译一次、持续维护**，而非每次查询重新推导；对标结论与四阶段路线图见预研文档 Part III/IV）。

| 下一版分期 | 内容 | 体量 |
| --- | --- | --- |
| **D0 零基建** | purpose.md 注入（core prompt 链，仿 AGENTS.md 三级解析）+ `kb-lint` skill（页面健康检查：矛盾/孤儿/缺页/缺交叉引用，先服务 openwiki 与 doc-wiki 页面） | 小（各 1–2 天，完全独立可先行） |
| **D1 编译层 MVP** | core `docwiki/` 模块：两步思维链摄入（分析→生成，flash 通道）+ SHA256 增量缓存 + 持久化串行队列 + `sources[]` 溯源 + 删除级联（共享实体保护）+ index.md/log.md + `docwiki.*` actions + `index.build-all` 第四阶段 + 面板第七源卡 | 中 |
| **D2 检索与闭环** | hybrid 检索（FTS5 + 可选向量 + 图扩展两信号起步：直接链接/来源重叠）+ 图谱洞察（孤儿/桥接/稀疏域，Louvain 留观察项）+ 异步审核队列（预定义操作 + 预生成查询）+ Deep Research 闭环（skill 形态，复用内置 WebSearch/WebFetch） | 中大 |

- **许可红线**：llm_wiki 为 **GPL-3.0**（LICENSE 本体核证）——零代码继承、不 vendor、不拷贝提示词文本，全部净室自研；方法论与算法思想（两步摄入、关联度信号、预算装配）不受版权保护可借鉴。技术栈（Tauri/Rust）本也不可复用，无实际损失。
- **与 A/B/C 线关系**：D0 完全独立可先行；D1 的 `docwiki.*` actions 按静态 defineAction 注册起步，B1 action 总线动态化后免费获益（同 E1 埋点逻辑，无需提前缴纳动态化成本）；Deep Research 闭环复用内置联网工具，不依赖 C 线。
- **复用地基**（本仓做同类事情的边际成本显著低于从零）：`WikiController` 注入惯例、gitmcp 的 node:sqlite FTS5 `SearchBackend` 先例、routing embedding 进程级单例（零新增模型实例）、`event:actionProgress` 进度通道、知识面板源卡协议、内置 WebSearch/WebFetch。
- spec：[`specs/next-version/doc-wiki/`](../../specs/next-version/doc-wiki/design.md)（design + tasks，2026-08-19 立）。

## 主线 E：工作区语义检索（zvec-grep/zg，2026-09-02 新立）

**现状缺口**：检索栈四层中「模糊意图 → 定位」为空白——rg 只认字面，codegraph 管结构不管内容语义，serena 需要精确符号名，Granite routing 只做 skill/tool 召回（不碰工作区内容），memory 的 BM25 只管会话记忆。"恢复主题偏好"→`hydratePreferences` 这类查询目前只能靠 LLM 多轮 rg 猜关键词 + read 拼上下文；中文文档/非代码内容检索同为空白。

**方案**：以内置 MCP server 形态接入阿里开源 zvec-grep（`zg` v0.2.1，Apache-2.0，Node ≥22）——`zg server --stdio` 桥接现有 `StdioClientTransport`（零新协议代码），本地 potion-code-16m-v2 embedding（Model2Vec 静态查表约 30MB，CPU 即可），`.zvec-grep/` 项目标记门槛（未索引项目完全无感）。上游自报 SWE-QA-Bench 配对实验：输入 token -47%、工具调用 -59%、评审分 +1.5。**红线：仅本地 embedding，不配置任何远程 provider，零数据出域。**

| 分期 | 内容 | 体量 |
| --- | --- | --- |
| **M0 验证门槛** | Windows 全链路 spike：索引/stdio 桥/daemon 稳定性/原生依赖（zvec/tree-sitter/ripgrep）/模糊查询召回对比；**不通过则整个 spec 归档** | 1 天（不写仓库代码） |
| **M1 core** | `zg.ts` 薄壳（server 名/标记探测/disable flag）+ `ZgController` seam（仿 serena-controller）+ `augmentMcpServersWithBuiltins` 注入 + G2 hint + 单测 | ~150 行 |
| **M2 desktop** | `ZgCliController`（spawn 三级兜底 npm→系统 Node 22→npx；`ZVEC_GREP_HOME`/`ZVEC_GREP_MODEL_CACHE` env 隔离；索引生命周期；app quit `zg server off` 防 daemon 泄漏）+ vendor 预置 potion 模型 + IPC 四方法 | ~300 行 |
| **M3 产品面** | MCP 页签开关 + 知识库状态卡（`zg status` 解析）+ i18n + license + 回归验收 | 小 |

- **四层分工**：bash+rg（已知词穷尽）→ codegraph（结构/调用链）→ serena（LSP 符号）→ **zg（模糊意图语义发现）**；zg 不做结构关系与符号编辑，是纯内容检索层。
- **与其他主线关系**：与主线 D 不重叠——D2 检索作用于"编译后的 doc-wiki 知识"，zg 作用于"工作区原始内容"；纯 MCP 注入，不依赖 B1 action 总线动态化；与 A/C 零耦合。
- **风险**：上游 0.2.x 太新（2026-08 底开源）→ 版本钉死 + adapter 单文件隔离 CLI 面；Windows 原生模块/daemon 表现未知 → M0 一票否决。
- spec：[`specs/next-version/zg-semantic-search/`](../../specs/next-version/zg-semantic-search/design.md)（design + tasks，2026-09-02 立）。

## 强化清单（本版本遗留，进下一版窗口逐项核对）

2026-08-18 评估与终判口径，进入下一版时按本节对齐：

| 项 | 2026-08-18 状态 | 下一版处置 |
| --- | --- | --- |
| 设置面板路径授权可见/可撤销 | 未做（tasks.md:164 已登记缺口） | **建议做**（约 0.5 天，安全可见性） |
| pm-design-v2 独立导出（.ddp/.ddu 压缩包） | **已实现（2026-08-18 收尾批 + 同日格式拍板）** | 收尾批完成，不再进下一版窗口；React 代码导出不做、版本切换 UI 不做（已拍板） |
| 沙箱 Linux bwrap / Windows WSL2 后端 | 未实现，detect 诚实降级在位 | **建议不做**（现有纵深已覆盖威胁模型；AppArmor/userns 雷区 + WSL2 要求装 distro，收益窄） |
| graph-engineering 收编 bundled skill | 未做 | **建议关闭**（与 code 插件组能力重叠；冻结期新增 bundled skill 需过 i18n/manifest/eval 全链） |
| G3 大技能分片召回 | **已实现（2026-08-18 收尾批）** | `skill-sharding` + `SkillShardRecaller` + session 接线，fail-open 全文回退；不再进下一版窗口 |
| GitMCP 任务 12 人工回归 | 自动项已过，手测清单未走查 | 人工走查（F4 同批） |
| F4 交互清单 + 双开回归（开两个实例共同工作） | 启动烟雾已过；交互清单/双开待人工 | 人工走查（本版本预生产测试内容） |
| B3 book-distill 端到端演练 / skill-up 双引擎对拍 | 待真实 LLM 花费 | 预生产测试内容，不代跑 |
| 路由「匹配负反馈」 | 明确不做 | 列观察项（OpenSpace 加权走离线批量解，见主线 A 张力注记） |
| dsh S1 事件溯源 / S2 loop 扩展点化 | 大重构，触发条件未出现 | 不做 |
| skill-eval S3 产品内评估 | 不排期（S1/S2 稳定 ≥2 周 + 用户诉求前置） | 不做 |

## 启动顺序建议

1. **先收本版本尾**：F4 交互清单 + 双开回归 + GitMCP-12 人工走查照常走查（已移交预生产测试批，2026-09-03）；原 H 预生产切换作为启动闸已随出口门槛毙掉——冻结期结束即视作放行；
2. 冻结生效后开 `next/*`：A-E1 设计与 B-B1 可并行启动（E1 埋点与 registry 动态化同 spec 合写；前者改 core、后者改 desktop main + core/modules，无冲突）；C-M1 的 dispatch 抽取与 action 第四表面同源，建议与 B1 同批设计；D-D0 两项零基建完全独立、任意时点可插入（D1 待 D0 的 purpose 约定验证后启动）；E-M0 P0 spike 纯调研不写仓库代码、冻结期内即可跑，M1–M3 待冻结生效后按 P0 结论启动；
3. 体量锚点：B1 的 wasm runtime（DMABI + Tier-0）是全版本唯一从零大块，优先立 `specs/next-version/module-system/` 任务拆分启动。

## 储备 spec（specs/next-version/ 内的非主线项，2026-09-03 对齐增补）

> 以下 8 个 spec 与 A–E 主线同存于 `specs/next-version/`（第二阶段规划区），但**不属于本计划 A–E 主线**——按既定口径不裁撤，保留于储备区，立项时点随各自功能域规划（移动域重启统一走 `next/*`）。目录总览见 [`specs/README.md`](../../specs/README.md) 与 [`specs/next-version/README.md`](../../specs/next-version/README.md)。

| spec | 一句话 | 当前状态 |
| --- | --- | --- |
| [android-dev-kit](../../specs/next-version/android-dev-kit/design.md) | 内核驱动的安卓开发套件（A1–A5） | ⬜ 设计稿（移动域重启向） |
| [cad-3d-generation](../../specs/next-version/cad-3d-generation/design.md) | 3D 与制造：text-to-cad / img2threejs 三阶段 | ⬜ 规划中 |
| [content-translation](../../specs/next-version/content-translation/design.md) | 第三方内容翻译引擎（Apple 系统引擎优先 + Argos 兜底） | ⬜ 设计定稿待实现 |
| [desktop-pet](../../specs/next-version/desktop-pet/design.md) | 桌宠小助手 P1–P10 | ⬜ 调研定稿（P1 悬浮窗按 spec 另立项） |
| [harmonyos-dev-kit](../../specs/next-version/harmonyos-dev-kit/design.md) | 鸿蒙开发套件 | ❌ 曾落地后整体下线；重启属 `next/*` |
| [in-process-multi-driver](../../specs/next-version/in-process-multi-driver/design.md) | 进程内多驱动并行（agent-relay 编排） | ⬜ 立稿未实施（S0 质量验证 + 锁版起步） |
| [model-fleet-adaptation](../../specs/next-version/model-fleet-adaptation/design.md) | GLM5 / Kimi-K3 / MiniMax-M3 / Qwen-3.8 收官适配 | 🟡 G0+S0 落地（16/34），S1–S4 系列核填待做 |
| [sandbox-next](../../specs/next-version/sandbox-next/design.md) | 沙箱延伸：bwrap / WSL2 / 能力矩阵对账 / WASI 预研 | ⬜ 独立任务规划（自 sandbox 收官延伸，2026-09-03） |
