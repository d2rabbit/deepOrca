# F5 — 逐 spec 实现状态终判（specs/ 全目录 19 个）

> 日期：2026-08-18 · 执行：F5（specs/pre-production F 线收尾项）
> 方法：每 spec 读 design/tasks 状态行 + 抽查 2-3 个承重声明对照代码（file:line 取证），以代码为准；三组并行审计后汇总。
> 口径：✅ 已实现（按 spec 落地或含已拍板的正向偏差）· 🟡 部分（主体在、有明确缺口）· ⬜ 规划性（本就不是实现承诺）· ❌ 废弃/被取代。

## 总览

**19 个 spec：✅ 8 · 🟡 5 · ⬜ 4 · ❌ 2**

| spec | 终判 | 一句话 |
| --- | --- | --- |
| a2ui-integration | ✅ | P0 原型模块 + MCP 传输 + 渲染器 + IPC 全链路（a2ui-mcp.ts 903 行、自建 processor、PrototypePanel 挂载）；弃 `@a2ui/react` 为已拍板方案 |
| activity-frames | ✅ | 双管线 + 9 个 MCP 工具 + 可选 boot context；spec 含对账回写且与代码一致 |
| deep-design | ✅ | 核心闭环全落地且演进超 spec（设计系统 3→9、产物演进为 .dd OrcaDesign、iframe srcDoc 渲染）；§5 的 PDF 导出 IPC 以 iframe print 替代 |
| define-action | ✅ | Phase 0-3 全落地（registry 原语 + LLM/MCP/IPC 三面 + 统一进度 + 11 action 归位） |
| gitmcp-local-module | ✅ | 任务 1-11 全勾且代码实证（GitmcpList/Add/Remove/Reindex 通道 + SDK McpServer + sqlite 降级）；仅任务 12 人工手测清单未做 |
| mcp-sdk-migration | ✅ | SDK 依赖/客户端切换/spawn-spec 抽离全对上；§8 验收第 3 项"外部 server 实机验证"待 GUI 人工（spec 已如实记载） |
| task-tree | ✅ | P0-P2 全量 + 2026-08-18 P1 收尾（sessionIds 台账/整树归档/会话徽标 tab，`946cf77`）；快照切换显式缓期 |
| text-embedding | ✅ | Granite 97M（384 维）落地、路由+TDAI 双消费、构建期 vendor 离线化；**spec 状态行"未实施"陈旧待回写** |
| sandbox | 🟡 | P0-P2 + macOS 后端/审计/隔离器/quarantine/路径授权全落地；Linux bwrap、Windows WSL2 未实现（detect 诚实降级）；设置面板路径授权不可见/不可撤销（tasks.md:164 已登记） |
| skill-eval | 🟡 | S1/S2 产物全落盘（脚本+CI+8 包 evals+自定义引擎适配器，`2c98142`）；pin 已于 2026-08-18 定版 v0.9.0；双引擎对拍与 CI 首跑未做；**本 spec tasks.md 复选框全未勾（回写缺失，与 pre-production 已勾不一致）** |
| skill-routing | 🟡 | G1/G2 + M4(SAD/DAG) + R1-R4 全部落地且超越；目标表 G3（大技能分片召回注入）未实现——spec 自标"（后续）"属显式缓期（注意与已实现的内部命名 G3=CompositionalSkill 区分） |
| pm-design-v2 | 🟡 | 存储/Action/面板/具现化/预览迭代闭环主体落地；裁剪：2 管线（A2UI 按三层定位排除）、pm-analyst 缓期、版本切换 UI 与独立导出未做 |
| pre-production | 🟡 | A-G 七线完成（9 提交核实）、F1-F3+F6 落盘；F4 真机烟雾/F5（本文）/H 预生产切换收尾中 |
| android-dev-kit | ⬜ | 纯内核设计稿，零代码（roadmap 标"规划中"） |
| cad-3d-generation | ⬜ | spec 自标"规划中"，仅文档级消费 |
| desktop-pet | ⬜ | 调研定稿（未实现），设计稿即全部交付物 |
| module-system | ⬜ | P 轨/D 轨纯规划，tasks 全未勾（承接发行版远景） |
| behavior-memory | ❌ | 2026-08-17 拍板作废，由 @deeporca/memory（TDAI L0-L3）承接；旁系成果 activity-frames 已另行落地 |
| harmonyos-dev-kit | ❌ | 曾完整落地（`a32ef21`）后整体下线（`f680c14`/`c8c5b55`）；2026-08-18 鸿蒙 PC 移植调研结论"先不做"（docs/research/2026-08-18-harmonyos-pc-electron-port-feasibility.md） |

## 需要跟进的文档债（终判发现）

1. **specs/text-embedding/design.md 状态行**仍写"方案（未实施）"——陈旧，应回写"已实现（构建期 vendor 偏离运行时下载，属正向）"。
2. **specs/skill-eval/tasks.md** T1.1-T2.3 复选框全未勾——与 pre-production A1-A6 已勾不一致，应按实况回写（pin 定版 ✅、双引擎对拍/CI 首跑仍待）。
3. **docs/builtin-inventory.md** 仍列 harmonyos-mcp/harmonyos-deveco-cli——陈旧残留（代码已整体下线）。
4. **specs/pm-design-v2/tasks.md** 行 8 状态行"待开发"陈旧（行 3 对账行已较新）——可顺手清理。

## 逐 spec 证据索引

（审计取证 file:line 由三组并行审计产出，关键锚点：a2ui `a2ui-mcp.ts:281/415`；activity-frames `mcp.ts:85/351`；define-action `registry.ts:135/177`；gitmcp `session-bridge.ts:992-1060`；mcp-sdk `mcp-manager.ts:3-6`；task-tree `task-tree-service.ts:365/382/395`；text-embedding `transformers-embedding.ts:24/152`；sandbox `path-boundary.ts:119/136`、`detect.ts:41-53`；skill-eval `get-skill-up.mjs`、`skill-evals.yml:12/20`；skill-routing `skill-router.ts:45/154`；pm-design `design.ts:47`、`design-store.ts:23-53`；pre-production `docs/pre-production-capability-scan.md:17/75-86`；废弃两项见 research 台账。）
