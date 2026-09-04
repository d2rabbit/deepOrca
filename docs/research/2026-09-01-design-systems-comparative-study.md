# 四开源设计项目对比研究纪要 — open-design / open-pencil / open-codesign / penpot

> **日期**：2026-09-01 · **性质**：为 deepOrca 设计系统进阶方案（`specs/design-systems-advance/design.md`）服务的对比研究纪要
> **方法**：四个仓库于 2026-09-01 浅克隆至本地逐一核实（open-design 562MB / penpot 505MB / open-codesign 83MB / open-pencil 32MB），只读源码与文档，未运行安装；证据标注〔已核实〕= 直接读过文件/目录，〔README 口径〕= 仅上游自述。
> **配套**：子代理深度报告曾暂存 `.research/*-report.md`（已于收尾时清理）；本节要为可追溯证据保留关键文件路径。

---

## §0 一句话定位与总体结论

| 项目 | 一句话定位 | 与 deepOrca 的关系 |
|------|-----------|-------------------|
| **open-design**（nexu-io） | 开源 Claude Design 替代：**不造 agent**，把用户本地的 coding-agent CLI 当设计引擎；三层文件系统（skills/templates/design-systems）+ Express daemon + SKILL.md 协议生态 | 思想同源（deep-design 即其核心闭环的自有复刻）；建议吸收其**质量机制与留存哲学**，不引入 daemon |
| **open-pencil**（open-pencil） | AI 原生设计编辑器（Figma 替代愿景）：native 读写 .fig/.pen，Tauri+CanvasKit 画布，CLI/MCP 可编程操作设计树，headless SDK | 技术栈正交（矢量画布 vs 生成式 HTML）；建议吸收**设计 lint 规则实现**与**token 审计/聚类**思想 |
| **open-codesign**（OpenCoworkAI） | （待研究报告返回后补） | — |
| **penpot**（penpot） | 开源设计 & 原型平台（Figma 自托管替代）：SVG 原生渲染 + flexible layout + 组件/variants + tokens，REST API/插件/MCP 开放面 | 建议吸收**结构化设计文档模型**、**token 工具化**、**组件复用与变体**、**开放数据面**思想；不引入 Clojure 栈 |

**总体结论**：四个项目分处两个阵营——**生成式**（open-design：产物即代码/HTML；open-codesign 待核实）与 **编辑器式**（open-pencil、penpot：设计稿是结构化文档模型/画布）。deepOrca 的两大模块恰好是生成式（OpenUI Lang 程序 + .dd 文档），进阶方向是**把"生成式产物"升级为"半结构化设计资产"**：既有生成式的轻量（零守护进程、LLM 直写），又借编辑器式的结构化（token 契约、组件复用、可查询数据面）与质量机制（lint、加权评审、版本留存）。

---

## §1 open-design（nexu-io/open-design）研究

> 深度报告要点摘录；完整证据路径见各条。

### 1.1 定位与规模

- **定位**〔已核实，README.md:34-38〕："The open-source Claude Design alternative"；让本地 coding-agent CLI（claude/codex/…）当设计引擎，deepOrca 同厂牌的 DeepSeek Harness 已被原生适配（`apps/daemon/src/runtimes/defs/deepseek-harness.ts`：`--profile open-design --stdio`、dsh-profile-jsonl 流格式、会话恢复）。
- **规模实测**〔已核实〕：skills 162 · design-templates 114 · design-systems 152 包（+`_schema`）· craft 12 规则 · plugins 483（official scenarios 14/image 45/video 63/design-systems 143/atoms 13/examples 183 + community 10）· MCP 工具 22 · 内置设计方向 5 · deck 模板 `html-ppt-*` 47 · RuntimeAgentDef 27。
- **架构**：Express+better-sqlite3 daemon（唯一特权进程，`/api/*` 单轨）↔ Next.js 16 web ↔ Electron desktop（sidecar IPC 发现 URL）；UI 与 CLI 共享同一套 API（UI-CLI dual-track）；BYOK 代理（客户端带 key → daemon SSRF 校验 → 转发 → SSE 回流）。

### 1.2 核心机制：三层文件系统 + agent loop

- **SKILL.md 协议**〔已核实，docs/skills-protocol.md〕：Claude Code Agent Skills 约定 + `od:` 扩展（mode/surface/scenario/craft.requires/critique.policy/design_system.requires/example_prompt）；省略 `od:` 时默认值使现有 skill 零配置兼容。
- **模板形态**〔已核实，`design-templates/web-prototype/`〕：seed 是 `assets/template.html`（6 个 `:root` token 变量 + 类系统 + 浏览器 chrome）+ `references/layouts.md`（8 种 paste-ready section 骨架，含默认节奏表 hero→features→stats→cta）+ `references/checklist.md`（P0/P1/P2 三级自检）+ `example.html`。**代理人"先选版式再写文案、先读 seed 再写 CSS"**。
- **设计系统包**〔已核实，`design-systems/default/`〕：`manifest.json`（schemaVersion v1）+ **`DESIGN.md`（9 节品牌契约：Visual Theme / Color Palette & Roles / Typography / Component Stylings / Layout / Depth & Elevation / Do's and Don'ts / Responsive / Agent Prompt Guide）** + `tokens.css`（编译产物）+ `design-tokens.json`（结构化语义 token）+ `components.html` + `USAGE.md` + `source/` 证据 + `_schema/` schema 校验。
- **注入顺序**〔已核实，skills-protocol §5〕：USAGE.md → 完整 DESIGN.md → import-mode 指引 → tokens.css → 组件清单 → 富文件索引 → craft 规则 → 技能/模板 body。
- **MCP 面**〔已核实，apps/daemon/src/mcp.ts〕：22 工具；生成 loop = create_project → start_run → get_run 轮询（30-60s，"5-30 分钟正常，running 且无新文件 ≠ 卡死，不要自己 write_file 代替设计"）。

### 1.3 设计哲学（原文口径）

- "Your CLI becomes the design engine, your laptop becomes the studio, and your team's DESIGN.md becomes the brand contract"〔README.md:36〕
- "We don't ship an agent"——agent-native、model-agnostic〔README.md:260〕
- **产物即真实代码，不是像素画布**："delivers single-page artifacts in real CSS, real fonts… exported straight to HTML/PDF/PPTX/MP4"〔README.md:38〕；"MCP exposes the design source directly — the agent always sees the live file"（文件即真相，不导出 zip 快照）〔README:381-395〕
- **anti-slop 可执行化**：craft/anti-ai-slop.md"七宗罪"P0 阻断（默认 indigo accent、hero 双停渐变、emoji 当图标、无衬线显示字体、圆角卡片+左侧色条、编造指标、填充文案），对应 `lint-artifact.ts` 的 `AI_DEFAULT_INDIGO` 常量；"failing an enforced rule is not a style preference, it is a regression"；非自动检查项显式标注 "(guidance, not auto-checked)"。
- **0.14 "Inspiration Time Machine"**〔已核实 blog〕："灵感来得便宜，留住却昂贵"——产品价值在于**留存中间产物**（草图/来源/旧版/线索）；Plan mode + Excalidraw 草图流程、HTML 版本历史可回退、composer 上下文来源可见。
- **0.15 "Design System Prompt 优化"**〔已核实 docs/CHANGELOG/v0.15.0/zh-CN.md〕：首 token -49.5%、输入 token -25.1%；"任务完成意味着真正有交付物"（`run-deliverable-validation.ts`：没有生成/保存可用项目文件的 run 不再算成功）。
- **统一澄清机制**：`<question-form>` 内联 artifact 是唯一提问通道，答案作为下一条用户消息回流。

### 1.4 质量机制落地程度

| 机制 | 状态 | 要点 |
|------|------|------|
| critique 五维卡（技能级） | shipped | Philosophy/Visual hierarchy/Detail/Functionality/Innovation 0-10 + band；**强制证据引用**（"Numbers without evidence get rejected"）；取 worst sustained band 不平均；输出 Keep/Fix/Quick-wins + SVG radar |
| Design Jury（产品级自评门） | 实现中，分级 rollout | 五 panelist 加权（Critic 0.4/Brand 0.2/a11y 0.2/Copy 0.2），composite ≥ 8.0；≤3 轮收敛；`ship_best` 兜底；**同一 CLI 会话内多 turn**实现（不另起进程）；`.ndjson` 可回放 |
| artifact lint | shipped | `POST /api/artifacts/lint`，P0 自动强制 |
| tweaks 面板 | 模板级 shipped / 通用 UX 未实现 | 5 标准旋钮（--accent/--scale/--density/--mode/--motion）改写 CSS 变量 + localStorage |
| comment-mode 定向编辑 | partially shipped | `data-od-id` section 锚点已就位 |
| 版本快照/会话恢复 | shipped | run-html-version-snapshots + agent-session-resume |

### 1.5 对 deepOrca 的借鉴清单

**吸收（prompt/模板层即可落地）**：① DESIGN.md 品牌契约分层注入顺序；② seed+layouts+checklist 模板经济；③ anti-slop 七宗罪静态 lint（做成 core 内置校验器）；④ 五维 critique 强制证据；⑤ Design Jury 加权门槛+有限轮+ship_best（**同会话多 turn 不另起进程**，适配 deepOrca 单进程引擎，opt-in 默认关）；⑥ direction picker（5 内置方向：确定性调色板+字体栈，禁模型即兴）；⑦ 输出契约纪律（写文件后只发一句摘要）；⑧ "没有交付物不算完成"；⑨ 中间产物留存 + 版本回退 UX；⑩ 上下文来源可见。

**不引入**：Express daemon+SQLite+sidecar 矩阵（与 core 既有持久化重复）；27 CLI 适配+BYOK/SSRF（deepOrca 只面向 DeepSeek）；付费云依赖（AMR/图片/视频）；双 prompt 实现+rollout 开关；MCP 长轮询生成编排。

---

## §2 open-pencil（open-pencil/open-pencil）研究

> HEAD 6f71448（2026-09-01，v0.14.0，MIT，bun workspaces）。自述"usable today, with some rough edges"。

### 2.1 定位与文档模型（最值得借鉴的地基）

- **定位**〔README 口径，README.md:3〕：开源设计编辑器，原生读写 .fig/.pen，内置 AI，可编程工具箱 + headless Vue SDK（嵌入别家产品）。
- **技术栈**〔已核实〕：Tauri v2 + Vue 3 + CanvasKit(Skia WASM) 渲染 + Yoga WASM 布局 + Yjs/Trystero P2P 协作 + Vercel AI SDK 多 provider；单进程本地优先（对比 Penpot："无后端/数据库/Docker，~11× 更小代码量不是简化而是不同架构"——comparison.md）。
- **统一文档模型 = SceneGraph**〔已核实，packages/scene-graph/src/types.ts〕：扁平 `Map<string, SceneNode>` + parentId 树；所有格式（.fig/.pen/HTML）归一化为它。节点类型 19 种（Figma 同族）。.fig = Kiwi 二进制（ZIP+Zstd+magic，Figma 同款 194 schema）；.pen = JSON 声明式文档（**当前 import-only**，写回是 roadmap 待办）。
- **"设计稿=可 diff 的数据"是显式目标**〔已核实，roadmap.md:16,76〕："Treat the scene graph as a programmable design document: every important read, write, export, diff, and validation operation should be reachable through UI, CLI, MCP, and SDK surfaces."——`analyze/diff.ts` 节点序列化 → unified diff；roadmap 提"structured node-tree diffs 作为一等 Git-friendly 审查产物"。
- **XPath 节点定位**〔已核实，packages/core/src/xpath.ts〕：fontoxpath + DOM facade 包装，`//FRAME[@width<300]` 可查；`nodeToXPath()` 反查生成唯一路径（名字冲突回退位置谓词）——**"定位"是一等 API，query 命令 / MCP 工具 / AI 工具共用**。

### 2.2 CLI 与 lint / analyze

- **CLI 全命令**〔已核实〕：tree/find/node/info/pages/query/selection/export(png…jsx/html/fig)/import(HTML/CSS/Tailwind→fig)/convert/lint/**analyze{colors,typography,spacing,clusters,overlaps}**/variables/eval/libraries/documents；全 `--json`；双模式（headless 文件 vs 运行中 app RPC）。
- **lint = 17 条规则，defineRule 架构**〔已核实，packages/core/src/lint/**〕：`defineRule({meta, match, check})` + Linter 先 capture 浅投影 LintNode → 按 match 类型白名单过滤 → ctx.report(ruleId/severity/nodePath/suggest)；preset = recommended/strict/accessibility。示例：`color-contrast` 对 TEXT 向上找最近实心背景算 WCAG 4.5，**变量绑定则跳过静态检查**（动态值不可靠的正确直觉）。
- **token 审计/聚类**〔已核实，tools/analyze/*.ts〕：colors = hex 频次 + variableName 溯源 + 色距≤15 相似聚类 + suggestedHex（"从未规范稿里反查 token 候选"）；clusters = 结构签名（尺寸取整 + 子类型计数）+ confidence 评分——**组件候选发现**。

### 2.3 AI 能力与闭环

- **统一工具管道**〔已核实〕：约 110 个 `defineTool`（core/src/tools，框架无关）→ Vercel AI SDK 适配，chat/MCP/CLI 三路共用。
- **render 工具 = AI 建稿主通道**：AI 用 **JSX 声明式**创建节点（`<Frame flex="col">`、`<Text color="#fff">`、内联 `<svg>`），支持 replace_id/insert_index/parent_id。
- **设计规范编码进 system prompt**〔已核实，system-prompt.md〕：单次 render ≤40 元素、拆 2-3 次（骨架→区块）；宽度/对齐数学必须走 `calc` 工具；4px 网格；字号 6-8 级；"父有 2+ 子必须 flex"。
- **落画布闭环（最直接可抄的运行时模式）**〔已核实，src/app/ai/tools/index.ts:88-112〕：每次 mutating 工具调用自动"前快照 → 执行 → 加载字体/重排/重绘 → 后快照 → push 一条 undo（AI: <tool>）"——**AI 每次改动都可一次撤销**；外加 `export_image` 截图视觉自检（多模态闭环）+ 工具插桩（noop 变更检测/重复调用检测/step budget 警告）。
- **describe 语义层**〔已核实，tools/describe/**〕：40+ 条"名称 pattern → ARIA 角色"推断（button/card/navigation…），让 AI 以语义而非像素理解视觉稿。

### 2.4 设计哲学

- **程序化设计 vs 鼠标拖拽**〔已核实，README Why + roadmap〕：Figma 封闭平台、专有二进制、"工作流因对方一个 point release 而断"；OpenPencil 的答案 = MIT + 原生读 .fig + **每个操作都可脚本化** + 数据不出机器。
- **文件即代码**：.pen 是 JSON（可人类阅读、可 diff）；.fig 保真优先 + raw 元数据晚绑定策略。
- **明确非目标**〔已核实，roadmap.md:129-134〕：强制账户/纯云文档；代理用户 AI key（BYOK 一贯）；只读自动化；为便利牺牲 .fig 保真。

### 2.5 对 deepOrca 的借鉴清单

**吸收**：① token 提取/聚类管道（分析 colors/clusters 三步法——与 dembrandt **互补**：dembrandt 管"既定 token 管理与应用"，open-pencil 管"从未规范稿反查 token 候选"，可做成视觉稿自动审计环节）；② lint 规则条目与架构（17 条映射到 taste 的命名/布局/可访问性增量；defineRule+match+LintNode 轻架构可直接照搬；"变量绑定跳过静态检查"直觉）；③ 节点定位协议（给 .dd/OpenUI 补"可逆地址生成器"，AI 编辑后报告"改了哪个路径"，升级自 section 标记）；④ 快照式 undo 闭环（AI 改动一次撤销，快照法比命令逆推便宜）+ 每次大改后自动出图自检；⑤ describe 语义层（40+ 角色 pattern → 语义摘要喂模型）；⑥ 工具质量插桩（noop/重复/step budget → deepOrca 评估"agent 这轮编辑干了什么"）；⑦ eval 逃生舱（.dd 的脚本化编辑兜底）。
**不引入**：Tauri/CanvasKit 栈（与 Electron 正交，借鉴接口分层而非技术选型）；.fig Kiwi 逆向（工作量巨大、无直接收益）；.pen 格式本身（import-only 未稳定，但"JSON + 声明式节点 + 变量/主题"思想可吸收）；100+ 工具全量粒度（deepOrca 应保持 10-20 精选工具）。

## §3 open-codesign（OpenCoworkAI/open-codesign）研究

> 本仓库带自身 AGENTS.md/CLAUDE.md（v0.2.0，2026-05-09 发布）。两处前提修正见 §3.4。

### 3.1 定位与前提修正

- **定位**〔已核实，README.md L9-11、docs/VISION.md L23-30〕：开源 Claude Design 替代品的 **Electron 桌面 AI 设计 agent 工作台**：提示词 → agent 工具循环 → 真实磁盘工作区（`App.jsx` + `DESIGN.md` + assets）→ iframe srcdoc 沙箱预览 → preview/done 双验证门 → 迭代 → 导出（HTML/PDF/PPTX/ZIP/MD）。
- **修正 1：不是实时协同**〔已核实〕：全库 grep yjs/crdt/websocket 零命中；VISION.md 把 "Real-time multi-user collaboration" 明确列为 non-goal。"Co" = 人机协作（结构化提问 + 可见循环 + 定点注释 pin），非多人协同。
- **修正 2：与 OpenUI 无关且非同厂**〔已核实〕：grep "openui" 零命中；OpenUI 是 wandb 开发（github.com/wandb/openui）；OpenCoworkAI 前作是 open-cowork。
- **成熟度**：MIT、v0.2.0 发布、pnpm+turbo+biome monorepo、Electron+React19+Tailwind4+Zustand、Vitest+Playwright、CI/发布流水线、26 品牌 DESIGN.md、17 个 markdown 方法技能、12 个 JSX 组件片段、scaffolds/frames 资产、decompose-to-UI-kit 基准（12 项布尔视觉判分）。

### 3.2 核心机制

- **agentic 循环**〔已核实，packages/core/src/agent.ts + docs/plans/2026-04-23-*〕：preflight 确定性问卷（set_title 首调）→ pi-coding-agent 循环（工具面：pi 内置编辑 + 设计工具 ask/scaffold/skill/preview/gen_image/tweaks/set_todos/done；权限门 Tier0-3）→ workspace 文件（唯一事实源）→ 预览运行时（iframe srcdoc 注入 vendored React+Babel+overlay+tweaks 桥）→ 自检验证（preview 返回 console/asset 错误 + DOM outline + 截图；done 静态 lint + 运行时验证 + 自愈 ≤3 轮）→ 导出。
- **载体**：`App.jsx`（React 源码，非画布 JSON）；`DESIGN.md`（Google 规范，`packages/shared/src/design-md.ts` zod 校验 + 2000 字符截断）；`MEMORY.md` 项目记忆 + 全局用户记忆（均带 schemaVersion）。
- **软阶段 + 可见性契约**〔已核实，VISION.md L62、run-protocol L53〕：阶段由提示词引导而非硬编码；阶段切换前一句 ≤18 词短说明；工具结果持久化只留紧凑字段。
- **验证闭环**（对 deepOrca 最值钱）：`preview(path)` 返回 ok/截图（仅 vision 模型）/DOM outline（≤4 层）/consoleErrors(≤50)/assetErrors(≤20)/metrics；`done(path)` 静态 lint（未闭合标签/重复 id/缺 alt/多源文件强制 DESIGN.md）+ 隐藏 BrowserWindow 运行时验证（~3s），`MAX_DONE_ERROR_ROUNDS = 3` 自愈重试。
- **EDITMODE/TWEAK_DEFAULTS 可调参数协议**〔已核实，packages/runtime/src/index.ts L268-314〕：模型在源码声明 `TWEAK_DEFAULTS`（合法 JSON，EDITMODE 标记包裹）→ 运行时替换为 `window.__codesign_tweaks__.tokens` → 暴露 `--ocd-tweak-<kebab>` CSS 变量 → **滑杆改值只更新 CSS 变量，不重跑 React/Babel/不重载 iframe**。
- **12 项布尔视觉判分**〔已核实，BENCHMARKS.md L27-63〕：`parityScore = passCount/12` 确定性派生（非浮点自由打分），分级阈值 verified/needs_review/needs_iteration/failed，失败自带原因——降低 judge 方差、跨运行可比。

### 3.3 设计哲学（有书面证据）

1. **本地优先 / BYOK / 无遥测**：凭据存 `~/.config/open-codesign/config.toml`(0600)；"Nothing leaves your machine unless your chosen model route requires it"（README L196）；禁止新增 SQLite 会话状态（local-first storage 硬约束）。
2. **文件即事实源**（Files Are Real）：外部编辑器改动为一等公民，Files 面板看文件系统而非工具日志（VISION.md L58-59）。
3. **渐进披露**（Progressive Disclosure）：基础提示词保持小，skills/scaffolds/brand 以**资源清单索引**注入，按需 `skill()`/`scaffold()` 加载（v0.2 设计文档抱怨旧方案"13 个 skill 全量注入每轮吃掉 20-40k tokens"）。
4. **品牌值 = 数据，不是模型记忆**：品牌 hex 色不得凭记忆编造，必须来自 DESIGN.md/官方材料/`skill("brand:<slug>")`（brand-acquisition.md）。
5. **反 AI 俗套是有意识的工程**：系统提示 12 条禁止模式（anti-slop-digest：禁 Inter/紫渐变/对称卡片/占位图…）+ 独立正向手法 skill（oklch、字体搭配、纹理背景）。
6. **合理预算/不堆依赖**：前端锁死最小栈（CLAUDE.md "Respect the lean budget"）。
7. **Design 即 Session**：会话=设计、cwd=工作区；v0.2 明确不做分支/回滚 UI/版本快照（roadmap 项）。

### 3.4 对 deepOrca 的借鉴清单

**直接可搬（资产级，MIT）**：① 12 节系统提示分节（266 行，含 output-rules/anti-slop digest/design-methodology 三节可直接吸收进设计技能）；② EDITMODE/TWEAK_DEFAULTS 协议（deepOrca 在 react-lang 渲染器外包一层即可："AI 声明可调参数 → CSS 变量 → 滑杆无重渲染更新"——这也正是 open-design 尚未实现的 tweaks 面板 UX 的可落地形态）；③ preview/done 双验证门 wire 协议（DOM outline + 错误上限 + 按模型能力降级截图；done = 静态 lint + 运行时验证 + ≤3 轮自愈）；④ 资源清单渐进披露（替代全量注入，适用于 deepOrca 技能/资产系统）；⑤ 26 个品牌参照 DESIGN.md（可平移为品牌风格预设包，带 attribution/license）；⑥ 12 个 JSX 组件片段 + device-frames 设备壳资产。
**机制级（需适配）**：⑦ 12 项布尔判分思想（"稿图→实现"对齐校验）；⑧ `ask()` 结构化问卷的 **svg-options 题型**（SVG 图形让用户选视觉方向）；⑨ 确定性 preflight + 事件顺序可测试；⑩ DESIGN.md 作为会话间设计系统交接物（done 强制多源文件有 DESIGN.md）；⑪ 上下文压缩分块策略（8KB 封顶/近窗原样/远窗 stub/200KB 硬顶）。
**不适用**：裸 JSX+Babel 渲染路径（deepOrca 保留 @openuidev/lang-core 流式 DSL 优势）；无实时协同/MCP 经验可抄；Electron 壳与打包流水线（deepOrca 已有）。

## §4 penpot（penpot/penpot）研究

> HEAD 约 2.19.0-unreleased / 最新发布 2.17.2，MPL-2.0，Kaleidos 旗下，Verified DPG。

### 4.1 文档模型（AI 可操作设计稿的根基）

- **File = 文档根**：`schema:file` 含 pages（有序 id 列表）+ pages-index（**uuid→shape 扁平对象表**，非嵌套树）+ colors/components/typographies/tokens-lib/plugin-data〔已核实，common/src/app/common/types/file.cljc:81-120〕。
- **一切编辑 = 44 种变更操作**〔已核实，files/changes.cljc〕：对象层 add/mod/del/mov/order + 页层 + 库层 + token 层（set-token/set-token-set/set-token-theme…）；同一操作定义被前端补丁、后端持久化、WebSocket 广播、undo/redo 复用。可 diff（page_diff.cljc）、可撤销（undo_stack.cljc 基于 change 批）。
- **.penpot 文件 = ZIP + 分片 JSON**〔已核实，backend/src/app/binfile/v3.clj〕——对外可读、可被外部工具解析。
- **@penpot/library**：内存构建 .penpot 文件并导出 ZIP 的**程序化 API**（createBuildContext → addFile… → exportStream）〔已核实，library/README.md〕。
- **渲染**：经典 = 浏览器 SVG DOM（main/render.cljs + ui/shapes/* 每形状一个 React SVG 组件）；2.16+ 增 Rust/Skia WASM（render-wasm/，同一源码出 frontend/export 两目标）；exporter Node 服务出 PNG/SVG/PDF；**布局引擎（flex/grid）在 common 层前后端共用**（geom/shapes/flex_layout|grid_layout）——响应式是"文档数据"而非渲染技巧。

### 4.2 设计系统：DTCG tokens + 组件 variants + 库共享

- **原生 Design Tokens，与 W3C DTCG 明确对齐**〔已核实，types/token.cljc:87-165〕：类型双向映射（:color/:spacing/:dimension/… ↔ DTCG 字符串类型）、`{组.名}` 大括号引用语法、2.17 起 `$` 鉴别符；**shape 只存 token 名、运行时按名解析**（:applied-tokens）；token-set → token-set-group → token + theme（激活哪些 set 的"视图"）（types/tokens_lib.cljc）。
- **组件 + Variants**〔已核实，types/component.cljc〕：组件 = 独立 :objects 副本树 + :main-instance-id 关联；同步走**属性组 touched 机制**（改一处标记组 touched，同步时整组不回写——实例覆盖显式记录）；Variant = variant-properties（name/value）+ container 画板聚合。
- **库共享**：文件库（组件/颜色/排版/tokens）跨文件 link；2.19 按 slug 自动关联库。
- **多页组织法**〔已核实，docs/mcp/design-file-structure-best-practices.md〕："一个功能一块画板，不只一屏"。

### 4.3 协作 / 开放面 / AI

- **协作非 CRDT**〔已核实〕：RPC `update-file`（revn+changes）+ Redis pub/sub（msgbus）+ WebSocket 订阅 + lagged-changes 补发；权限 org→team→project→file 四级 + share-link。
- **开放面**〔已核实〕：RPC `/api/main` + OpenAPI、JWT access token、webhooks、exporter HTTP 任务 API；**插件系统 = SES 加固沙箱** + manifest permissions + `penpot.ui/.selection/.page/.library/.storage/.history/.events` API + plugin-data 持久化；Inspect 模式输出独立 HTML/CSS（开发者交接）。
- **官方 MCP Server**〔已核实，mcp/README.md + tools/〕：LLM 的任务 = 在插件沙箱内**执行任意 JS**（`execute_code` 核心工具，storage 跨调用持状态）+ `export_shape` 导出 PNG **供 VLM 回看** + `high_level_overview`/`penpot_api_info` 文档引导。
- **官方 AI 方法论**〔已核实，docs/mcp/*〕：token 三级分层（global→semantic→component）、优先 flex/grid、基础间距 8px、视觉深度 ≤3-4 层；结构化 brief（Context/Goal/Inputs/Constraints/Quality Criteria）；**"做变换（transformation）而非生成最终稿"**；禁止绕过 tokens 硬编码。

### 4.4 设计哲学

- **开放标准优先**："works with open standards like SVG, CSS, HTML, and JSON"；"设计即代码（design is expressed as code）"；**SVG 即协议**——前后端同语言共享 common 层是实现载体〔README + docs/technical-guide/architecture/common.md〕。
- **资产所有权**：自托管 + MPL-2.0 → "full ownership of your design infrastructure"；开源核心 + 托管 SaaS + 企业版商业模式。
- **AI 立场**："AI connected to real design context / Multi-directional workflow / Your stack, your model, your decision"（2.15 定调）——模型自选、不绑架。

### 4.5 对 deepOrca 的借鉴清单

**吸收**：① **结构化文档模型**（对象表 + 操作流）→ .dd 的"doc 修改 = 操作级 diff"，AI 编辑 = 生成操作流而非重写整稿（最高价值）；② DTCG 规范 tokens（`{组.名}` 引用 + 按名应用 + 三层分级 + theme）——"AI 只改 token 层、全稿联动"直接缓解生成稿硬编码颜色问题；③ 组件 touched 组同步 → deepOrca 组件库的实例覆盖显式记录；④ flex/grid 布局纪律 → 布局审美纪律的现成模板（校验"是否所有容器都有布局"）；⑤ 多页/多画板组织 → 多页面设计稿的组织法；⑥ design-as-asset 开放面（无头构建 + execute_code/export_shape 式"程序化编辑 + 截图回看"闭环 + 白名单能力面）。
**不引入**：Clojure/ClojureScript 栈（移植成本极高）；Postgres+Redis+MinIO+exporter+WASM 渲染集群自托管规模；操作流协作引擎（桌面单机无实时多端需求，保留轻量版本号 + 变更日志即可）。

## §5 对比矩阵

| 维度 | open-design | open-codesign | open-pencil | penpot |
|------|-------------|---------------|-------------|--------|
| 阵营 | 生成式（产物即 HTML/代码） | 生成式（产物即 App.jsx 源码） | 编辑器式（SceneGraph 文档模型） | 编辑器式（SVG 文档模型） |
| 架构形态 | Express+SQLite daemon + Next.js + Electron sidecar | Electron 单进程 + pi-coding-agent 循环 | Tauri 单进程 + CanvasKit/Yoga WASM | Clojure 后端 + ClojureScript 前端 + Postgres/Redis/MinIO |
| 设计哲学金句 | "产物即真实代码；agent 永远看到活文件" | "文件即事实源；品牌值=数据不是模型记忆" | "把场景图当作可编程设计文档：每个读/写/导出/diff/校验都应经 UI/CLI/MCP/SDK 可达" | "设计即代码；SVG 即协议；你的模型你做主" |
| 设计系统载体 | DESIGN.md 9 节 + tokens.css + design-tokens.json + components.html | Google 规范 DESIGN.md（zod 校验）+ 26 品牌参照 | .pen 变量/主题 + analyze/token 提取聚类 | DTCG tokens + token-set/theme + 组件 variants + 库共享 |
| 质量机制 | 七宗罪 lint + 五维 critique（强制证据）+ Design Jury 加权门 + checklist | anti-slop digest + preview/done 双门 + 12 项布尔判分 + 自愈 ≤3 轮 | 17 条 lint 规则（defineRule）+ 三 preset + token 审计 | （平台侧弱；MCP 方法论约束 + tokens 硬编码禁令） |
| 中间产物/版本 | HTML 版本历史 + 会话恢复 + 草图 + 来源可见 | MEMORY.md + 会话 JSONL（v0.2 不做版本 UI） | 快照式 undo 闭环 + unified diff | 44 种操作流 → undo/redo 栈 + page_diff |
| 迭代模型 | brief→direction→artifact→critique→iterate | preflight→agent 循环→preview/done→导出 | AI 工具循环（快照 undo + export_image 自检） | MCP execute_code + export_shape 视觉闭环 |
| 开放面 | MCP 22 工具 + BYOK 代理 + CLI | 工具面 + 权限分级（v0.2 无 MCP） | CLI + MCP(stdio/HTTP) + headless SDK + eval 逃生舱 | RPC/OpenAPI + 插件 SES 沙箱 + 官方 MCP + @penpot/library |
| deepOrca 采纳建议 | 质量机制/留存哲学/方向选择（吸收）；daemon（不引入） | EDITMODE 协议观察、双验证门、资源清单渐进披露、布尔判分（吸收）；裸 JSX（不引入） | token 提取管道、lint 架构、可寻址定位、快照 undo（吸收）；Tauri/CanvasKit/.fig（不引入） | 文档模型/操作流、DTCG tokens、变体 touched、多页组织、design-as-asset（吸收）；Clojure 栈/自托管规模/协作引擎（不引入） |

## §6 设计哲学共性提炼

四个项目立场各异，但共享七条底层共识（也是本方案的总纲来源）：

1. **质量是机制不是话术**：lint 规则、双验证门、强制证据的评审、布尔判分——"防 slop"全部被工程化（open-design 七宗罪 → lint 常量；open-codesign preview/done + 12 项布尔；open-pencil 17 条 defineRule）。
2. **文档化程度决定 AI 可操作性**：从"HTML 文本"（open-design）到"源码文件"（open-codesign）到"对象表 + 操作流"（penpot/open-pencil 的 SceneGraph）——越结构化，AI 编辑越可 diff、可回滚、可验证。
3. **token 即契约**：品牌/设计系统必须数据化（DESIGN.md、DTCG tokens、变量/主题、品牌参照库），**禁止模型凭记忆编造品牌值**（三项目各自用不同话术重申同一原则）。
4. **模板经济**：不给模型从零写 CSS 的机会——seed + 骨架 + 占位 + 自检清单压缩自由度（open-design/深层 deep-design 已有）。
5. **中间产物与方向是人机协作的抓手**：方向选择题、骨架确认、版本回退、草图留存——设计是迭代过程，"灵感来得便宜，留住却昂贵"。
6. **渐进披露与 token 预算**：资源清单索引、按需加载、上下文压缩——把 token 经济设为一等约束。
7. **本地优先 / BYOK / 开放面**：数据不出机器是共同底线；同时都提供 CLI/MCP/API/SDK 作为"给程序与 agent 的设计接口"。

## §7 deepOrca 借鉴清单汇总

> 完整条目见各项目章节；这里按"落地层"归并。与本方案章节的映射：机制级 → §6/§7，prompt 级 → 技能扩展，不引入 → §10。

**A. 机制级（改动 core/desktop，价值最高）**
1. 统一 token 契约：tokens schema 化 + DTCG 语义分组 + 按名应用（penpot §4.2）→ §7.1
2. lint 规则引擎：defineRule 架构 + taste 可机检条目 + 七宗罪（open-pencil §2.2、open-design §1.3）→ §7.2
3. 双验证门：preview 契约 + done 终检 + 自愈 ≤3 轮（open-codesign §3.2）→ §5.4
4. 渲染后机检 + LLM 加权评审门（opt-in，同会话多 turn；open-design §1.4）→ §7.2
5. 版本留存与回退 UI（open-design 0.14；deepOrca file-history 基建已有）→ §7.3
6. 方向选择（direction picker；open-design §1.5 + svg-options 题型 open-codesign §3.3）→ §6.4
7. 交互回路（行为契约 + agent 响应；复用既有 a2ui:action 链路）→ §5.2
8. 12 项布尔判分思想（open-codesign §3.2）替代浮点自评 → §7.2
9. token 提取/聚类管道（open-pencil §2.2，与 dembrandt 互补）→ §6.7
10. 可寻址定位 + 操作级 diff（open-pencil XPath / penpot 操作流）→ §6.2

**B. prompt/模板级（改 templates，零依赖）**
- 五维 critique 强制证据 + Keep/Fix/Quick-wins（taste 已有五维，补证据约束）
- 输出契约纪律（写文件后只发一句摘要；deep-design 已有输出契约，推广到原型技能）
- anti-slop 禁止清单 + 正向手法清单并行注入（open-design/open-codesign）
- DESIGN.md 品牌契约分层注入顺序（USAGE→DESIGN.md→tokens→组件→craft→body）
- 资源清单渐进披露（design tool-provider 已有 7 只读工具，可升索引式）
- 多页原型节奏表 / 组件库示例页（layouts 扩充）

**C. 明确不引入**（理由见 §10）
- open-design：Express daemon + SQLite + BYOK 代理 + 27 CLI 适配 + 付费云
- open-codesign：裸 JSX+Babel 渲染路径
- open-pencil：Tauri/CanvasKit 栈、.fig Kiwi 逆向、.pen 格式本体、100+ 工具粒度
- penpot：Clojure 栈、自托管基础设施规模、实时协作引擎（Yjs/CRDT/WebRTC）