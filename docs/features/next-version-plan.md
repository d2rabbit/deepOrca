# 下一版本规划：自进化引擎 · Studio 基座 · 远程访问

> 日期：2026-08-18 · 状态：**规划中（冻结期后的 `next/*` 版本路线，本文不排当前版本期）**
> 来源：会话 sess_2233bbaf 的方向确立（自进化引擎 / action→Studio 超大版本 / 远程访问），经 2026-08-18 全项目终判（`docs/pre-production-spec-final-audit.md`）与本日收尾批事实校正。
> 依据口径：路线与现状以 `docs/features/feature-roadmap.md` §0 为准；实现以 `specs/` 为准；调研仅参考。

## 0. 版本定位与入口（前置阻塞）

**三主线共享同一地基（action registry/dispatch 单点），同期做返工最少**——这是把 B1+B2 提升进下一版（而非原建议的"再下一版"）的核心理由。入口前置（预生产收尾，见 `specs/pre-production/tasks.md`）：F4 真机烟雾交互清单走查 → H 预生产切换（版本定格 → dev 合并 → tag → 冻结生效）完成后，本规划的全部主线进入 `next/*` 分支启动。

| 主线 | 下一版纳入 | 紧随其后一版 |
| --- | --- | --- |
| A 自进化引擎 | E1 执行捕获 + E2 改进回路（含 task-tree P3 设计） | E3 Self-Harness/HarnessBank 起步 |
| B action → Studio 基座（超大版本） | B1 冷插拔（P0）+ B2 热激活/隔离（P1） | B3 管理 + B4 发行版 MVP + B5 信任富 UI |
| C 远程访问 | M1 地基 + M2 隧道 + M3 配对 UX（含 MCP HTTP transport） | M4（WebRTC 打洞/E2E，可选） |

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
- 缓期确认：G3 大技能分片召回注入（skill-routing 目标表 G3）**建议缓做**（2026-08-18 评估：book-distill 约定 SKILL.md ≤300 行 + references 文件名清单 ≤50 已缓解注入压力，待注入 token 占比真实过高再立项）。

## 主线 B：action → Studio 基座（超大版本迭代）

**核心认知**（`specs/module-system/design.md` v2，当前全 0 代码）：defineAction 已完成（28 action 静态注册）是地基，终点是「DeepOrca = AI Studio 内核」——第三方不 fork 代码，用 dist.json 发行版清单组装垂直 AI Studio，DeepOrca 桌面版降级为参考发行版。五件套基座：action 总线 + A2UI + wasm 沙箱（唯一全缺）+ MCP + Skill。架构承诺：action 是唯一能力总线，一切 UI 事件汇入 `registry.execute`；L0 内核冻结，对外只承诺七张平台 API 契约表。

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

## 强化清单（本版本遗留，进下一版窗口逐项核对）

2026-08-18 评估与终判口径，进入下一版时按本节对齐：

| 项 | 2026-08-18 状态 | 下一版处置 |
| --- | --- | --- |
| 设置面板路径授权可见/可撤销 | 未做（tasks.md:164 已登记缺口） | **建议做**（约 0.5 天，安全可见性） |
| pm-design-v2 独立 HTML 导出 | 未做（compileDdToHtml 已有 + showSaveDialog 先例） | **可做**（~0.5 天）；React 代码导出不做、版本切换 UI 不做（已拍板） |
| 沙箱 Linux bwrap / Windows WSL2 后端 | 未实现，detect 诚实降级在位 | **建议不做**（现有纵深已覆盖威胁模型；AppArmor/userns 雷区 + WSL2 要求装 distro，收益窄） |
| graph-engineering 收编 bundled skill | 未做 | **建议关闭**（与 code 插件组能力重叠；冻结期新增 bundled skill 需过 i18n/manifest/eval 全链） |
| G3 大技能分片召回 | 未做 | **建议缓做**（见主线 A 末行） |
| GitMCP 任务 12 人工回归 | 自动项已过，手测清单未走查 | 人工走查（F4 同批） |
| F4 交互清单 + 双开回归（开两个实例共同工作） | 启动烟雾已过；交互清单/双开待人工 | 人工走查（本版本预生产测试内容） |
| B3 book-distill 端到端演练 / skill-up 双引擎对拍 | 待真实 LLM 花费 | 预生产测试内容，不代跑 |
| 路由「匹配负反馈」 | 明确不做 | 列观察项（OpenSpace 加权走离线批量解，见主线 A 张力注记） |
| dsh S1 事件溯源 / S2 loop 扩展点化 | 大重构，触发条件未出现 | 不做 |
| skill-eval S3 产品内评估 | 不排期（S1/S2 稳定 ≥2 周 + 用户诉求前置） | 不做 |

## 启动顺序建议

1. **先收本版本尾**：F4 交互清单 + 双开回归 + GitMCP-12 人工走查 → H 预生产切换（版本定格/dev 合并/tag/冻结生效）；
2. 冻结生效后开 `next/*`：A-E1 设计与 B-B1 可并行启动（E1 埋点与 registry 动态化同 spec 合写；前者改 core、后者改 desktop main + core/modules，无冲突）；C-M1 的 dispatch 抽取与 action 第四表面同源，建议与 B1 同批设计；
3. 体量锚点：B1 的 wasm runtime（DMABI + Tier-0）是全版本唯一从零大块，优先立 `specs/module-system/` 任务拆分启动。
