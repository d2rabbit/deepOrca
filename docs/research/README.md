# research 目录索引

> 调研文档台账：每份文档对应的模块、消费状态（提案是否已落地到代码）与遗留项。
> 基线：分支 `feat/sandbox-p0-path-gate` 工作树，2026-08-17 全量核对（逐份读原文 + 对照代码取证），同日按项目所有者决策更新处置。
>
> **状态图例**：✅ 已消费（提案全部落地，或按提案有意"零代码"处置完毕）· 🟡 部分消费（部分落地，有明确遗留）· ⬜ 未消费（纯调研/规划，代码零落地）· ❌ 已作废（文件名划线，保留溯源不删除）。
> 子提案被否决的在备注中以 ❌ 标出。
>
> **总口径（2026-08-17 确立）**：**调研仅供参考，以项目实际实现方案为主，调研内容不列入正式实现**；正式实现一律以 `specs/` 为准。
>
> **维护规则**：新增调研文档在本索引登记一行；提案落地后回写消费状态与一行证据；子提案否决标 ❌ 并留因；整篇作废划线保留。本轮核对发现至少 3 份文档的自身状态行滞后于代码——以本索引为准。

## 总览

47 份文档（含 1 份 EN 孪生 + 08-18 新增 1 份 + 08-19 UI/UX 重设计 4 份 + 08-19 超大版本重构预研 2 份 + 08-21 新增 1 份 + 08-27 新增 1 份 + 09-03 新增 3 份 + 09-04 新增 1 份）：**✅ 21 · 🟡 11 · ⬜ 12 · ❌ 3（作废）**。整体消费率高；作废 3 份均为 2026-08-17 拍板（zread 对比线、MemOS 线、pi-sdk 线），理由见各行备注。

---

## 2026-07 · 外部项目评估与地基迁移

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-07-30-harness-handbook-skillspector-agentreach-opennotebook.md](./2026-07-30-harness-handbook-skillspector-agentreach-opennotebook.md) | 四外部项目评估，仅采纳 SkillSpector 作内置安全扫描 MCP | `desktop/tools/skill-spector-cli.ts`、`core/mcp`、`templates/plugins/meta-skills`、`scripts/vendor-skillspector.js` | ✅ | SkillSpector 已内置（uv pin 2.5.1，git+SHA——PyPI 版本是恶意软件）。Agent-Reach/open-notebook ❌不采纳已遵守；"安装管线强制闸门"未成形（依赖 §十二 远程源，未落地） |
| [2026-07-30-html-in-canvas.md](./2026-07-30-html-in-canvas.md) | 核实 WICG html-in-canvas 是平台 API 非库，修正 roadmap | `docs/features/feature-roadmap.md` §六 | ✅ | 处置型调研：结论（不可 vendor、P3 阻塞于平台）已回写 roadmap，代码零落地是有意为之 |
| [2026-07-a2ui-integration.md](./2026-07-a2ui-integration.md) | A2UI Agent-to-UI 协议集成 | `desktop/tools/a2ui/`（~900 行 MCP server + 7 模板）、`core/mcp/a2ui-seam.ts`、`renderer/a2ui/`、`renderer/components/Prototype*` | ✅ | **2026-08-17 拍板"无偏移"**：A2UI 锁定**全域动态 UI**，不介入 designer 模块（三层定位边界由 guard 测试锁死）；弃官方 `@a2ui/react` 改自建 processor 为既定方案而非偏离。已实现 |
| [2026-07-mcp-sdk-migration.md](./2026-07-mcp-sdk-migration.md) | 手写 MCP 客户端/服务端迁移到官方 SDK | `core/mcp/mcp-manager.ts`（Client + Stdio/InMemoryTransport）、`desktop/tools/gitmcp/server.ts`、`core/mcp/spawn-spec.ts` | ✅ | 地基性迁移完成，对外接口零变化。遗留："解锁远程 server（Streamable HTTP）"未兑现——至今无 HTTP 传输，远程 MCP 不可配 |
| [2026-07-ocr-integration-and-ua-analysis.md](./2026-07-ocr-integration-and-ua-analysis.md) | 阿里 OCR 集成 + Understand-Anything 耦合分析 | `desktop/tools/ocr-cli.ts`（npm 内置 ^1.8.0）、`core/actions/review*`、`renderer/components/CodeReviewPanel.tsx`、`templates/plugins/code` | ✅ | OCR 全落地并演进（review.full = CRG 风险 + OCR 语义组合）。**UA ❌ 2026-08-17 正式划掉关闭**（与 codegraph+CRG+openwiki 冗余，不采纳不排期），本文消费完结 |
| [2026-07-open-source-integration-feasibility.md](./2026-07-open-source-integration-feasibility.md) | CodeFlow/CLI-Anything/OpenDesign/BrowserSkill/OCR 五项目可行性 | `templates/plugins/browser`、`core/actions/browser.ts`、`scripts/vendor-browser-skill.js`、`templates/plugins/code` | 🟡 | BrowserSkill ✅、OCR ✅；**OpenDesign 2026-08-17 定为"参考借鉴"**——自有 designer 模块已是其核心闭环等价实现，对比与进化见新预研 [2026-08-17-opendesign-openpencli-vs-designer.md](./2026-08-17-opendesign-openpencli-vs-designer.md)；CLI-Anything ⬜ 待评估；CodeFlow ❌按提案不集成 |
| [2026-07-plan-mode-vs-non-plan.md](./2026-07-plan-mode-vs-non-plan.md)（EN 孪生 `…_en.md` 同状态） | Plan Mode 受控对比实验：+26% 费用换 0%→75% 可用率 | `core/session.ts`（force-ask）、`core/prompt.ts`、`renderer/components/PlanCard.tsx`、`docs/plan-mode.md` | ✅ | 证据归档型消费：Plan Mode 产品化保留并在 core 强制执行（宽松配置下也 force-ask） |
| [2026-07-tailwind-namethatui-htmx.md](./2026-07-tailwind-namethatui-htmx.md) | Tailwind 作 DeepDesign 实现层 + NameThatUI 风格库 | `core/templates/design/references/ui-styles.md`（14 风格）、`scripts/vendor-tailwind.js`（离线 JIT）、`renderer/dd/compiler.ts` | ✅ | 两件"做的"全落地且 Tailwind 方案升级为本地 vendor（离线可用，取代 CDN 建议）；htmx ❌不采纳、主 UI 不引 Tailwind 均被遵守 |
| ~~[2026-07-zread-vs-gitmcp.md](./archive/2026-07-zread-vs-gitmcp.md)~~ | zread MCP vs 自建 GitMCP 对比 | `desktop/tools/gitmcp/` | ❌ | **2026-08-17 拍板作废**：zread 对比线不再使用，本文停用。**GitMCP 四项增强（get_repo_structure / read_file / docs 多文件索引 / outline）独立成案、已核对提上日程**（见遗留待办）——现状：`tools.ts` 仍是 4 工具、文档源仅 llms.txt→readme 三选一，四项全部未做、均可行 |

## 2026-08-04 ~ 08-07 · 记忆与路由工作流

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| ~~[2026-08-04-memos-memory-operating-system.md](./archive/2026-08-04-memos-memory-operating-system.md)~~ | MemOS 记忆操作系统预研 → 行为记忆分层 | `specs/behavior-memory/design.md`（其产物）、`desktop/tools/activity-frames/` | ❌ | **2026-08-17 拍板作废**：已引入**腾讯持久化记忆**（`@deeporca/memory`，vendored TDAI Core L0–L3 管线）承接记忆能力，MemOS 线关闭；其直接产物 `specs/behavior-memory/` spec 不再排期。旁系成果保留：activity-frames 双管线与行为 boot context（`session.ts:972`，默认关）已另行落地 |
| [2026-08-05-audit-issues.md](./2026-08-05-audit-issues.md) | perf 分支全量审查 issue 清单（8C/21H/17M）及修复验收 | `desktop/main/index.ts`、`ipc-security`、`memory/`、`scripts/vendor-fs.js`、`scripts/package-desktop.js` | ✅ | 验收记录型：抽查全部修复在树（导航防护、memory 生命周期、项目隔离、原子交换等）；延期项 M11（discovery fixture 测试）等属实未做 |
| [2026-08-06-oh-my-mermaid-research.md](./2026-08-06-oh-my-mermaid-research.md) | oh-my-mermaid 方法论采纳、Mermaid 渲染弃用 | `templates/plugins/code/skills/arch-scan/SKILL.md`（12 视角 + 递归下钻）、`renderer/DesignPreview` | ✅ | arch-scan skill 完整复用其视角目录；Mermaid 依赖已彻底移除（删 412 行死代码，残留仅过时注释） |
| [2026-08-06-skillweaver-skill-routing-integration.md](./2026-08-06-skillweaver-skill-routing-integration.md) | SkillWeaver 论文 → 检索先行路由两期落地 | `core/routing/`（G1 短名单/G2 工具路由/G3 compose）、`packages/embedding`、`specs/skill-routing\|text-embedding\|skill-eval` | ✅ | P0/P1/P4 ✅（G3 composeRoute 超前完成）；嵌入模型按约束换型 Granite 97M；**P2 book-distill ✅（2026-08-17 收官计划 B 线落地）；P3 skill-up CI ✅ S1+S2（A 线落地：脚本+workflow+8 包 14 用例+引擎适配器；skill-up pin 已于 2026-08-18 定版 v0.9.0 并实拉验证——原"待联网定版"闭环）** |
| [2026-08-07-openopc-research.md](./2026-08-07-openopc-research.md) | OpenOPC 虚拟公司框架：超远期理念参考 | 仅 `docs/features/feature-roadmap.md` §十六（前置条件表） | ⬜ | 按自身决策不动代码；前置条件中记忆向量召回✅、skill-up 闭环已排期、Plan DAG/Subagent 演进中 |

## 2026-08-11 ~ 08-14 · 设计系统与 dsh 吸纳

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-08-11-knowledge-memory-materialization-design.md](./2026-08-11-knowledge-memory-materialization-design.md) | 知识源/索引面板/记忆模块"具现化"4 改造 | `core/prompt.ts`（6 知识源）、`desktop/shared/ipc.ts` + `main/index.ts`（Memory/Knowledge IPC）、`renderer/components/IndexLibraryPanel.tsx`、`memory/memory-manager.ts` | ✅ | 提交 `3073cd0` 全部实施 + 审计修复。注意：文档自身状态行仍写"待实施"（未回写） |
| [2026-08-11-tool-orchestration-design.md](./2026-08-11-tool-orchestration-design.md) | Serena×CodeGraph×OpenWiki×内建四工具协调 P0-P4 | `core/prompt.ts`（决策矩阵）、`core/session.ts`（差异化后缀 + LSP 诊断反馈环）、`desktop/tools/wiki-cli.ts`（Serena connector） | ✅ | P0-P3 落地（P2 诊断反馈环、P3 wiki connector 均已实现，超文档自记进度）；P4（两套记忆交叉）长期可选未做 |
| [2026-08-13-text-to-cad-img2threejs.md](./2026-08-13-text-to-cad-img2threejs.md) | text-to-cad / img2threejs 技能接入评估 | `specs/cad-3d-generation/design.md`（产物）、roadmap §十八（新增） | 🟡 | 仅文档级消费（spec"规划中" + roadmap 域新增）；代码零落地；kkFileView ❌用户拍板不引入（已回写 roadmap） |
| [2026-08-14-deepseek-harness-deep-dive.md](./archive/2026-08-14-deepseek-harness-deep-dive.md) | dsh 全景：Cordis 微内核、S/A/B 级吸纳清单、插件三路线 | `core/session.ts`、`core/common/*` | 🟡 | **已整合**：三份 dsh 文档合并为 [2026-08-17-dsh-consolidated.md](./2026-08-17-dsh-consolidated.md)（唯一台账），本篇仅供溯源 |
| [2026-08-14-dsh-adoption-plan.md](./archive/2026-08-14-dsh-adoption-plan.md) | dsh 成果分层落地计划（P0 修复/P1 加固/P2 择机/P3 暂缓） | `core/session.ts`、`core/common/llm-error.ts` | 🟡 | **已整合**（同上）。P0 三项 ✅ 全落地；P1 四项未动——吸收顺序与重估见整合台账（P1-1→P1-2→P1-4→前缀收尾包） |
| [2026-08-14-dsh-deepseek-optimization-takeaways.md](./archive/2026-08-14-dsh-deepseek-optimization-takeaways.md) | dsh 对 DeepSeek 的 18 条机制（前缀字节守恒主线） | `core/common/openai-message-converter.ts`、`openai-client.ts` | 🟡 | **已整合**（同上）。P0 核查项结案；前缀守恒 #11/#13/#18 去向见整合台账（#11 归 P1-2 决策点，#13+#18 归前缀收尾包） |
| [2026-08-14-openui-deep-dive.md](./2026-08-14-openui-deep-dive.md) | OpenUI Lang 能力盘点 + 集成残缺审计 + 三层定位修订 | `renderer/openui/`、`desktop/tools/a2ui/`、`desktop/tools/design-store.ts` | ✅ | 经 full-adoption-plan 全部执行（update_openui 改全量替换语义已回写偏离表）。§5.2"OpenUI 取代 A2UI" ❌被三层定位取代（A2UI=全域交互层，2026-08-17 再次锁定） |
| [2026-08-14-openui-full-adoption-plan.md](./2026-08-14-openui-full-adoption-plan.md) | 三层定位 + M1-M7 模块 + Batch 6-10 执行计划 | `renderer/openui/*`、`design-store.ts`、`core/actions/design.ts`、`scripts/generate-openui-prompt.mjs` | ✅ | 全目录消费最彻底的执行计划：Batch 6-10 逐项在树，测试五件套齐，缓期项与文档一致 |
| ~~[2026-08-14-pi-sdk-derived-agent-feasibility.md](./archive/2026-08-14-pi-sdk-derived-agent-feasibility.md)~~ | pi-agent 作派生子 agent 运行时可行性 | （目标 `core/session.ts` runSubagent、`core/actions/`） | ❌ | **2026-08-17 拍板作废**：deepOrca 已存在自有派生 agent（`actions/registry.ts` RegistryHost.runSubagent + defineAction 生态，IPC/LLM/MCP 三面到达），"外部子 agent 运行时"需求已自有满足——贪多嚼不烂，关闭。连带结论：dsh C1 外部委派路线同样仅存"借生态"残值（见整合台账 #9） |
| [2026-08-14-template-split-codegraph-dual-mechanism.md](./2026-08-14-template-split-codegraph-dual-mechanism.md) | ① core/templates 拆迁 desktop；② CodeGraph npm/vendor 双机制统一 | ② `scripts/package-desktop.js`（改验 npm 包）；① 替代方案见备注 | ✅ | **2026-08-17 确认模板拆分不再需要，本文完结**。最终实现方案：**外部工具与 MCP 实现已全部迁出 core**（a2ui/gitmcp/activity-frames/CRG 等工具代码在 `desktop/src/main/tools/`；`core/src/mcp/` 仅剩 seam/manager/spawn-spec/types），**模板与 skill 默认留 core**（`getBuiltinPluginsRoot()` 解析 `core/templates/plugins`）；CodeGraph 统一 npm `@colbymchenry/codegraph` 路径（vendor-codegraph.js 已删）。`specs/module-system/` 承接的是发行版/模块系统远景，不含模板搬迁 |

## 2026-08-15 ~ 08-17 · 闭环审计与新一轮预研

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-08-15-full-regression-review.md](./2026-08-15-full-regression-review.md) | 12 提交全功能四层回归审查（静态/套件/接线/真机） | `core/src` 全域 + `desktop/src` | ✅ | 闭环验收，实证声明抽查全部成立。其"缺陷 0"口径被后续评审流水线持续迭代（之后又修出任务树/沙箱多轮缺陷） |
| [2026-08-15-remote-access-sunlogin-mapping.md](./2026-08-15-remote-access-sunlogin-mapping.md) | 向日葵式远程接入：WSS 反向隧道 + dispatch table + 三档入口 | 规划 `desktop/main/remote/`、`packages/relay/`；改 `shared/ipc.ts` | 🟡 | 仅 roadmap v3.6 规划层落地（§十三 改写、TunnelClient 列 P1）；M1-M4 代码零启动，M1 地基（dispatch 抽取 + 契约测试）未动工 |
| [2026-08-15-routing-closure-plan.md](./2026-08-15-routing-closure-plan.md) | 路由 G1-G3 闭环修订 R1-R4（会话级冻结决策 + 显式失效） | `core/routing/`、`core/session.ts`、IndexLibraryPanel 路由卡 | ✅ | R1-R4 逐项在树（frozen Map、pinnedServers、元数据契约、LRU GC、60s 退避、5 语言路由卡）。遗留：lazy-connect 仅机制接缝（全服务器 pinned，无激活对象）；−30% token 实测未回写 |
| [2026-08-15-spec-gap-audit.md](./2026-08-15-spec-gap-audit.md) | 16 份 spec 逐条对照 + 7 条跨模块链路审计（差距审计轮） | `specs/`、`core/tasks/task-tree-service.ts`、`TaskTreePanel.tsx`、`DesignPanel.tsx` | ✅ | 自闭环：L3 断链（task-lineage 入记忆）、L5 项目码、面板 15s 轮询、一键具现化全部在树。自认未实现项（dsh P1-1/P1-2/P1-4）去向见整合台账 |
| [2026-08-15-trajectory-design-exploration.md](./2026-08-15-trajectory-design-exploration.md) | 澄清 activity-frames（行为记忆/agent 消费）与 task-tree（任务轨迹/人消费）分立 | `specs/archive/task-tree/`（三件套）、`core/tasks/task-tree-service.ts`、`desktop/tools/activity-frames/` | ✅ | P0-P2 落地（TaskTreeService + 面板 + merge + 记忆驱动 fork 召回 + 谱系馈赠）；P3（branch=subagent 载体）未启动——external-repos 预研中 ruflo 三模式（journal/断点恢复/补偿）的预定落点。注：行为记忆侧由腾讯持久化记忆（memory 包）承接后，activity-frames 定位以本文"管线 B 画像"为准 |
| [2026-08-17-external-repos-prestudy.md](./2026-08-17-external-repos-prestudy.md) | dembrandt / graph-engineering / ruflo 三仓库集成预研 | 提案落点：`core/session.ts` builtin MCP、`core/actions/design.ts`、bundled skills、`specs/task-tree` P3 | 🟡 | **同日回写（`60d86d6b` 收官计划 E1）**：dembrandt 线已兑现且路线更彻底（完全离线 vendored + 内置 Chromium CDP，非本文提议的 npx MCP）——P1 的 `design.extract`/`design.drift` action 落地（`actions/design.ts:238+`，SSRF 防线 `common/dembrandt.ts`）；**P0 另一半 graph-engineering 收编未做（2026-08-18 评估建议关闭——与 code 插件组 CodeGraph/CRG/arch-scan/openwiki 能力重叠，待项目所有者拍板）**；ruflo→task-tree P3、crg paths-between、openai-client 降级链未启动（见文首回写注记与新预研 §1.3-6/7 衔接） |
| [2026-08-17-dsh-consolidated.md](./2026-08-17-dsh-consolidated.md) | **dsh 调研整合台账**（预期 / 已吸收 / 可吸收候选池 / 暂缓否决） | `core/session.ts`、`core/common/*`、`core/routing/` | 🟡 | 取代三份 dsh 原文档作为唯一决策入口。已核实吸收 5+2 项（P0 三项 + MAX_SUBAGENT_DEPTH + reasoning 契约维持；#18/前缀保温部分）；候选池核心 4 项按推荐顺序：P1-1 崩溃合成收尾 → P1-2 两段式 compaction（含 #11 决策）→ P1-4 beforeToolExecution 钩子 → 前缀守恒收尾包（P1-3 判定已被自有演进基本覆盖，只补护栏）；C1 仅存"借生态"残值观望 |
| [2026-08-17-opendesign-openpencli-vs-designer.md](./2026-08-17-opendesign-openpencli-vs-designer.md) | OpenDesign 0.15 + OpenPenCLI 对比现有 designer 模块与进化 | `core/actions/design.ts`、`renderer/openui/`、`renderer/dd/`、`design-store.ts`、`templates/plugins/design/` | ⬜ | 结论：designer 模块已是 OpenDesign 核心闭环的自有等价实现（且防漂移机制更强），OpenDesign 定位参考借鉴不引依赖。**OpenPenCLI 身份待确认**（最可能是 OpenPencil 两同名项目之一，需项目所有者指认）。建议动作仅 3 项 prompt/模板层演进：设计系统预设扩充 P1、taste 五维自评 + anti-slop P2、大页面两段式生成 P3 |
| [2026-08-17-hallmark-codebrain-membrain-prestudy.md](./2026-08-17-hallmark-codebrain-membrain-prestudy.md) | **双模块线四仓库预研**：代码智能（索引+知识加强）= CodeBrain + MemBrain；designer（ui-designer 模板与风格强化）= hallmark + motionsites.ai | 提案落点：`packages/memory`（`auto-recall.ts`）、`core/actions/{review,codegraph}.ts`、`templates/design/macrostructures/`（新增）、`templates/plugins/design/skills/taste` | ✅ | **同日全量落地（§6 落地开发计划，四主题提交）**：F0 Inter 字体自伤修复 + #4 macrostructures/ 10 骨架 + taste #11 三轴可计算化 + #5 门禁 12–19 + #8 motion-patterns 参考 + #1 memory 事件向多查询改写（keepContentWords 复查撤销——与 buildFtsQuery 内置停用词过滤重叠）+ #2 三态 status 入带 + 分桶采样 + #7 dembrandt 版权拒绝清单 + Provenance 块 + #3 L1 抽取硬规则 + 输出校验器 + #6 design.audit action（三轴机检，确定性零 LLM）。三轮递进核证记录（子代理逐文件 → 本仓代码走读 → gh 恢复后浅克隆本地一手复核）。四条核证反转：① hallmark 零代码但补齐 designer 最大缺口——**宏结构词汇表缺失导致 taste #11 anti-slop 规则不可判定**；② **CodeBrain 主打的 agent-loop 七项全部不在仓库里**（硬依赖仅 pydantic+lsprotocol，本地 grep 全 src 零 LLM SDK 痕迹；精确 50 文件/7,611 LOC/78 提交），索引弱于本仓 CodeGraph 持久索引，只移植降级三态 + 诊断分桶采样 + 编辑后校验闸门；③ **MemBrain 无 LICENSE 文件禁止拷贝代码**（entity_resolver 是 Graphiti 无署名逐行移植，一手并排比对坐实），架构与本仓 L0–L3 同构——**复查修正：RRF 本仓已有**（`auto-recall.ts` searchHybrid 的 RRF 合并，k=60 与其同值、hybrid 默认开），真差距仅**固定角色多查询改写**；④ motionsites.ai（65 条动效规格）**内容源自付费画廊导出禁止 vendored**，但命名揭示模式词汇可蒸馏补 taste 最薄弱的动效轴。另发现本仓自伤：`deep-design` 的 `.dd` 示例默认字体 `Inter` 正是 hallmark 门禁 1 的 auto-fail 项 |

---

## 2026-08-18 · 鸿蒙 PC 适配

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-08-18-harmonyos-pc-electron-port-feasibility.md](./2026-08-18-harmonyos-pc-electron-port-feasibility.md) | DeepOrca 桌面端跑在鸿蒙 PC（2in1）的可行性：ohos_electron_hap（海泰方圆 HAP 模板，Electron 25/34 已移植，addon 交叉编译有实证） | 提案落点（未启动）：`node:sqlite` 调用点 addon 化、三原生依赖 OHOS 交叉编译、`process.platform === 'ohos'` 分支、vendor 裁剪 | ⬜ | **2026-08-18 拍板"先不做"**，纯决策留档。结论"有条件可行（高）"；头号未知 = PC 端应用 spawn 边界与移植团队 Electron ≥35（Node 22）跟进。与 `specs/harmonyos-dev-kit/`（用 DeepOrca 开发鸿蒙应用）互为反向命题。启动前须完成文内 §6 六项验证 POC |

---

## 2026-08-19 · UI/UX 重设计

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-08-19-ui-ux-audit-report.md](./2026-08-19-ui-ux-audit-report.md) | 桌面端 UI/UX 现状审计（全量代码走查，附 file:line 证据） | `packages/desktop/src/renderer/`（App.tsx、ui.css、rail、panels） | ⬜ | 发现 **P0 疑似缺陷：右侧预览面板 `.ui-preview-panel` 无 grid 归属**（`.ui-shell.right-open`/`.ui-rightpanel` 为零引用死代码），PM-Design 预览可见性需真机验证；另列 P1 结构问题 5 项（rail 19 按钮过载、视图状态复合、入口割裂、命令面板浅薄、权限打断）、P2 体验问题 10 项 |
| [2026-08-19-ui-ux-redesign-vision.md](./2026-08-19-ui-ux-redesign-vision.md) | 重设计愿景「Orca Deck · 阶段指挥舱」+ 竞品差异化定位（vs Cursor/Codex/Threads） | 提案落点：消息流阶段化、rail 五区收编、Inspector 右栏、审批队列、命令面板全覆盖 | ⬜ | 核心概念：平铺线程 → 五阶段脊柱（理解/计划/执行/验证/交付）；三波路径：止损 → 结构 → 差异化 |
| [2026-08-19-ui-ux-redesign-wireframes.md](./2026-08-19-ui-ux-redesign-wireframes.md) + 视觉稿 `2026-08-19-ui-ux-redesign-mockup.html` | 设计稿：全界面 ASCII 线框 + 尺寸/交互规格 + 键盘地图 + token 增补 | 提案落点：`ui.css`、rail.tsx、MessageList、Composer、command-palette、浮层栈 | ⬜ | HTML 视觉稿经 Playwright 截图验证渲染正确；正式实现一律以 specs/ 为准（总口径） |
| [2026-08-19-ui-ux-audit-verification.md](./2026-08-19-ui-ux-audit-verification.md) | 审计报告逐条核对 + 三批次修复方案 + 实施记录 | 同审计报告范围（`fix/test-baseline-ui-feedback@da20d16`） | ✅ | **核对结论：P0×2 / P1×5 全部坐实**，P2 九属实一过时（deepcode-cli 证据已失效）、rail 按钮数修正为 18；**批次一+二（F1–F5）已实施**——F1 右栏 `right-open` 接线 + 单槽互斥、F2 rail 常驻禁用态 + overflow 兜底、F3 编辑器联动切视图、F4 命令面板 11→30 条、F5 deny toast；门禁全绿，真机冒烟待做；CRG 架构图触发链路已补闭环（CodeReviewPanel 恢复 View Graph 按钮，`7d3ca8d` 重构丢的线） |

---

## 2026-08-19 · 超级大版本重构预研（内核 wasm 化 / 系统语言）

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-08-19-kernel-wasm-systems-refactor-prestudy.md](./2026-08-19-kernel-wasm-systems-refactor-prestudy.md) | 超大版本重构：内核 wasm 化（A）与系统语言重写（B）解耦裁决，M0–M4 五段排程 | 提案落点：M0 内存止血（offscreen Chromium/embedding 单例/子进程懒启动）、M1 传输中立化、M2 内核重写、M3 壳替换、M4 wasm 双目标 | ⬜ | **2026-08-21 用户拍板更正 M2 语言裁决：不换语言、维持 TypeScript**，迁移载体改为 scriptc + tsgo——见 [2026-08-21-scriptc-tsgo-ts-native-path-prestudy.md](./2026-08-21-scriptc-tsgo-ts-native-path-prestudy.md)；本文 M0/M1 结论不受影响，Rust 降为备选线 |
| [2026-08-19-moonbit-cangjie-language-prestudy.md](./2026-08-19-moonbit-cangjie-language-prestudy.md) | 内核重写后备语言深挖：MoonBit / 仓颉 | 提案落点：module-system guest 语言（MoonBit）、鸿蒙移植触发线（仓颉） | ⬜ | 裁决：两者不撼动主线（GC + 未 GA + 生态差）；**MoonBit 工具链 AGPL-3.0 + 运行时豁免悬置**为最重要单条结论；仓颉 Apache-2.0-with-exception 干净。主线由 Rust 改为 TS 原生路径后，本文 guest 线/鸿蒙线裁决仍独立成立 |

---

## 2026-08-21 · TS 原生化迁移路径

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-08-21-scriptc-tsgo-ts-native-path-prestudy.md](./2026-08-21-scriptc-tsgo-ts-native-path-prestudy.md) | **M2 更正后的承接报告**：scriptc（TS→原生二进制）+ TypeScript 7/tsgo（Go 编译器）双调研 + 迁移卫生规则 | 提案落点：tsconfig `rootDir` 显式化、CI 非阻塞 `tsgo --noEmit` 对账、三条接缝（进程/网络/动态加载）注入式隔离红线、`scriptc coverage` spike | 🟡 | 裁决：**tsgo 近期采纳**（本仓已在 TS 6.0.3 桥接版、tsconfig 几乎全绿、零编程式 API 依赖；待 7.1 API 解 typescript-eslint）；**scriptc 观察名单 + 最小 spike**（child_process/fetch/dynamic import 三存亡项原生目标未证实，experimental 单供应商）；08-19 报告 M0/M1 不变且权重上调，Rust 降备选。**同日立项 [`specs/ts-native-migration/`](../../specs/ts-native-migration/design.md)**：包拓扑拆分（shell/design 独立成包）为迁移前置 P0，tsgo=M1 段、scriptc spike=P4-a，M2 原生化为条件触发段 |

---

## 2026-08-27 · AI 协调工作链

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-08-27-coord-chain-technology-survey.md](./2026-08-27-coord-chain-technology-survey.md) | **王牌路线 OC 技术调研**：联盟式许可链选型（否决 PoW/Hypercore/OrbitDB/CRDT）、node:crypto 零依赖原语清单、mDNS/ws/blob 分发方案、prior art（Keybase sigchain/SSB/Hypercore） | 产物：[`specs/coord-chain/`](../../specs/coord-chain/design.md) 三件套 + [`docs/features/coord-chain-plan.md`](../features/coord-chain-plan.md)；规划落点 `packages/ledger/`、`desktop/main/coord-chain/` | ⬜ | 三个判定：许可链而非公链；链上只有元数据、资产走内容寻址层；差异化核心是任务谱系接续开发。Hypercore 与 CRDT 库列为观察项不引入。**优先级高于 next-version**（资源冲突时 OC 优先）。同日需求收紧（补记 §6）：UX 对标腾讯文档/飞书共享文档空间，**共享只认工作区主题**（git remote 归一/显式主题名 → themeId，跨主题发现层隔离；projectCode 为机器本地路径派生不可用作主题，`packages/core/src/common/app-dirs.ts:51` 取证） |

---

## 2026-09-03 · 外部 Coding Agent 全景预研

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-09-03-hkuds-deepcode-prestudy.md](./2026-09-03-hkuds-deepcode-prestudy.md) | HKUDS/DeepCode（16.5k★，MIT，v2.1.0）全景：Paper2Code 论文原型 → v2.x 通用 coding agent harness（Python 内核 + CLI TUI + Tauri 桌面 + JSON-RPC App Server），逐维对位本仓 | 规划落点（未启动）：`core/common/*`（compaction 两段式/每回合冻结安全 profile）、`core/mcp`（HTTP transport + OAuth，遗留待办 #9 参照）、`core/skills`（依赖展开/渐进读取）、`desktop`（会话投影分离/schema 生成契约） | ⬜ | 纯调研留档，无代码变更。**最有价值单条**：其 compaction 两段式（大工具结果中段修剪 → 前缀重放摘要 → 拒绝不收缩摘要）与本仓 dsh-consolidated 候选池 P1-2/前缀收尾包独立同向——继 dsh 之后第二个实现者，建议回写台账作论据；MCP HTTP+OAuth 印证遗留待办 #9。**同名澄清**：HKUDS DeepCode ≠ 本仓遗留 `.deepcode` 前身，但两者共享 SKILL.md 方言且 `~/.deepcode` 路径可能交叠（文内 §2.5） |

---

## 2026-09-03 · Motion 动画库调研

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-09-03-motion-react-animation-prestudy.md](./2026-09-03-motion-react-animation-prestudy.md) | Motion for React（`motion` 13.2.0，MIT，Framer Motion 更名延续）对本仓动画增强的预研：能力清单 × 渲染层纯 CSS 现状（68 keyframes/170 transition/零动画库/零退出动画）逐表面对位，P0-P3 分阶段采用方案 + View Transitions API 等备选对比 | 规划落点（未启动）：`renderer/ui/motion.tsx`（LazyMotion strict + MotionConfig reducedMotion）、`components/WorkspaceSheet.tsx`（自 App.tsx 抽出，减行）、Toast/QuickDock/modal 退出动画、hub/PiP 布局动画 | ⬜ | 纯调研留档，无代码变更。结论：**值得引入但定位"编排层"**——进出场/布局/级联归 Motion（首渲染 +<6KB gz，domMax 走动态 chunk），循环装饰动画（呼吸/脉冲/rb-flow）保留 CSS；App.tsx 已 2536 行超 2500 标准，封装必须全落新文件。无依赖可先行项：7 个 ui-css 文件补 prefers-reduced-motion 块 |
| [2026-09-03-smart-gateway-dual-lane-adaptation.md](./2026-09-03-smart-gateway-dual-lane-adaptation.md) | 「智能网关 × 复杂度双轨（复杂度仲裁 → 轻轨/重轨）」用户提案与本仓的适配方案：网关并入既有 skill 匹配 flash 调用（单调用双 verdict，轻轨零增量调用）；重轨 5 阶段全由原生机制组装（Plan Mode / runSubagent / runBackgroundLlmTask / review 动作 / multi-driver spec），仅新增 `core/routing/gate/` + `session-manager-depth.ts` 编排层；四红线（core UI-free / 前缀缓存瞬态尾部 / fail-open / i18n 6 目录）与 P0-P2 分期，P0 为纯观察、数据决策门 | 规划落点（未启动）：`core/routing/gate/`（新）、`core/session-manager-depth.ts`（新层）、`core/session-manager-skills.ts`（flash 返回扩展）、`core/session-types.ts`（`SessionEntry.lane`）、`core/settings.ts`（`complexityGate` 节）、`core/templates/prompts/depth-lane.md`、desktop lane 徽标 | ⬜ 未消费 → 🟡 | 纯方案留档，零代码变更。**关键发现**：`identifyMatchingSkillNames`（skills.ts:24-153）即提案"轻量预检 Agent"的既有同构先例（轻量模型/低温/JSON/缓存/fail-open），复杂度评分可并入同一 flash 调用实现"零增量成本轻轨"；重轨不引入 LangGraph。**2026-09-03 已按总口径落 spec**：`specs/next-version/depth-lane/`（design+tasks，P0 纯观察先行、数据决策门定 P1） |

---

## 2026-09-04 · backpass 记忆审计伴生工具

| 文档 | 主题 | 对应模块 | 消费 | 备注 |
| --- | --- | --- | --- | --- |
| [2026-09-04-backpass-integration-feasibility.md](./2026-09-04-backpass-integration-feasibility.md) | kunchenguid/backpass（MIT，0.1.16/0.1.17，Node≥22.5，CLI 本地记忆优化：扫描 Claude/Codex/Pi/OpenCode/Grok/Cursor CLI/Hermes 会话→证据聚合→proposal→审核写回）对本仓的集成可行性：不必须集成；推荐 P0 只读 status/scan → P1 显式 analyze/propose → P2 受控 apply 的 L1/L2 受控 CLI sidecar 姿态，全程不碰 core、不新增内置 MCP、不自动 apply、注册 root 界定运行目录 | 规划落点（未启动）：`desktop/main/tools/`（受控 spawn backpass）、桌面 proposal/预算展示（仅 L1/L2 时） | ⬜ | 纯调研留档，无代码变更。**关键结论**：DeepOrca 自有 sessions 不在 backpass 支持列表（要学习需上游贡献正式 transcript adapter）；`apply` 不是 DeepOrca 原生权限流程；npm latest(0.1.16) 与 GitHub tag(0.1.17) 不同步；transcript 脱敏非安全保证，会经 `acpx` 发外部 harness。调研仅供参考，实现以 specs/ 为准 |

---

## 消费链（文档 → 文档 → 代码）

- **dsh 链**：deep-dive + takeaways → adoption-plan → P0 三项落地（session.ts / llm-error.ts）→ **2026-08-17 整合为 dsh-consolidated 台账**（P1 候选排序：P1-1→P1-2→P1-4→前缀收尾包）
- **OpenUI/Designer 链**：a2ui-integration（锁定全域动态 UI）→ openui-deep-dive（三层定位修订）→ full-adoption-plan（Batch 1-10 全落地）→ **opendesign-openpencli 预研**（对比 OpenDesign，确认自有方案为主体）
- **路由链**：skillweaver-skill-routing-integration（G1/G2/G3）→ routing-closure-plan（R1-R4 闭环）→ 全落地；P2 book-distill + P3 skill-up CI 已于 2026-08-17 收官计划落地（版本 pin 待联网定版为闭环项）
- **记忆链**：memos 预研（❌ 作废，由腾讯持久化记忆 @deeporca/memory 承接）；trajectory-design-exploration 划定行为记忆 vs 任务轨迹边界 → task-tree P0-P2 落地、P3 待启动
- **模板/CodeGraph**：template-split → 由"工具代码迁 desktop/tools/、模板留 core"方案实现并关闭 → specs/module-system 承接发行版远景

## 遗留待办汇总（2026-08-17 更新）

**已排期 → 已收编进收官计划 [`specs/pre-production/`](../../specs/pre-production/design.md)（2026-08-17 定稿，本版本最终计划）**：含 skill-up CI、book-distill、GitMCP 增强、dsh 理念深化（router 为核心红线）、designer 增强（dembrandt 品牌摄取 + 进化设计）、全域能力扫描、旧文档清理、预生产切换（锁定分支 → 合并 dev → 冻结）——原排期项：

1. **GitMCP 四项增强**（已核对提上日程）：get_repo_structure（GitHub trees API）/ read_file（raw 读取任意文件）/ docs 多文件索引 / 文档 outline——现状 4 工具 + 三选一文档源，四项均可行，落点 `desktop/src/main/tools/gitmcp/{tools,github,indexer}.ts`
2. **skill-up CI**：`specs/skill-eval/tasks.md`（S1 CI 集成 → S2 自定义引擎；S3 不排期）
3. **skillweaver P2 book-distill**：待启动（新技能天然成为 skill-up 体系被测对象）

**候选池（按价值排序，启动前需另立 spec）**：

4. **dsh 整合台账候选**：P1-1 崩溃合成收尾 → P1-2 两段式 compaction → P1-4 beforeToolExecution 钩子 → 前缀守恒收尾包（详见 dsh-consolidated §五）
5. **sunlogin M1**（dispatch table 抽取 + shim 契约测试）——远程接入全链路地基
6. **designer 三项 prompt 层演进**（opendesign 预研产出）：设计系统预设扩充 P1、taste 五维自评 + anti-slop P2、两段式生成 P3
7. **cad-3d P0-P2**（spec 规划中，img2threejs 先行）
8. **external-repos P0/P1**（graph-engineering skill 收编 + dembrandt builtin MCP + ruflo 模式入 task-tree P3）
9. **HTTP transport**（mcp-sdk-migration 未兑现收益，解锁远程 MCP 配置）

**观望/超远期**：CLI-Anything（Python 门槛）、OpenOPC（前置条件部分就绪）、skillspector 安装管线闸门（依赖 §十二）、dsh C1"借生态"（待 dsh 首个 tagged release）、OpenPenCLI 身份确认（待项目所有者指认具体仓库）。

## 维护规则

- 新增 `YYYY-MM-DD-<topic>.md` 后在本文件对应时段表登记一行（主题一句话、对应模块、⬜）。
- 提案落地后回写消费状态与一行证据（提交号或 file:line）。
- 子提案否决时在备注标 ❌ 并写明否决原因/取代者，保留决策痕迹。
- 整篇作废：文件名加删除线、状态 ❌、备注写明作废理由与承接方；文件保留不删（溯源）。
- **调研文档一律不作为实现依据**：正式实现以 `specs/` 为准，调研仅提供参考与对账。
