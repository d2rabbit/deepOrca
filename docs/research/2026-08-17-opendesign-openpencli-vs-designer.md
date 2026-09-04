# 预研：OpenDesign / OpenPenCLI 对比 deepOrca 现有 designer 模块与进化方向

> **日期**：2026-08-17 · **分支**：feat/sandbox-p0-path-gate（本预研为只读调研）
> **性质**：预研 —— 对比外部开源设计工具与 deepOrca **现有 designer 模块**的自有实现方案及其进化路径
> **口径（2026-08-17 项目所有者决策）**：**以项目实际实现方案为主，调研只是参考，不列入正式实现。** OpenDesign（nexu-io/open-design）定位为 **参考借鉴（reference only）** —— deepOrca 实质上已有自己的等价实现（designer 模块，见 §三）。"OpenPenCLI" 身份未定（见 §二）。
> **基线**：[2026-07-21 开源集成可行性调研](2026-07-open-source-integration-feasibility.md) §三（当时 OpenDesign 0.13.0，结论：MCP 接入为 P2 按需项）。
> **证据标注**：〔已核实〕= 直接读仓库源码/文档/发布页核实；〔README 口径〕= 上游自述数字未逐一清点；〔传闻〕= 第三方转述。

---

## 一、OpenDesign 现状核证（7 月评估后的变化）

### 1.1 版本与活跃度

| 项目 | 2026-07-21 基线 | 2026-08-17 现状 | 证据 |
|---|---|---|---|
| 版本 | 0.13.0 | **0.15.0（最新稳定）** | 〔已核实〕GitHub Releases 页 + newreleases.io 镜像 |
| 0.14.0 | — | "Inspiration Time Machine"，2026-07-08 发布，5 天内 125 PR / 36 贡献者 | 〔已核实〕官方博客 `apps/landing-page/app/content/blog/open-design-0-14-0-inspiration-time-machine.md` |
| 0.15.0 | — | 主题为 **Design System Prompt 优化**（代表性评测中首结果时间缩短）；另有镜像快照提到 "DeepSeek Harness now supported as a native runtime"（对 deepOrca 语境是个有趣信号，但该句出自 release 镜像摘要，〔传闻〕级） | 〔已核实存在/内容为 README+镜像口径〕确切发布日期未捕获 |
| 发布节奏 | 快 | 0.7.0（05-12）→ 0.8.0（05-20）→ 0.9.0（05-29，310 PR/88 人/7 天）→ … → 0.13 → 0.14.0（07-08）→ 0.15.0，**周~双周一个 minor** | 〔已核实〕仓库 CHANGELOG.md（master 分支 CHANGELOG 条目截至 0.9.0，后续版本走 Releases/博客，README roadmap 已勾到 0.13.0） |
| 许可 | Apache-2.0 | Apache-2.0（不变） | 〔已核实〕LICENSE/徽章 |
| 星标 | — | ~86k（第三方榜单口径） | 〔传闻〕awesomeai.info 列表，未从 GitHub API 直接核 |

**结论**：7 月评估后一个月内连发 0.14 / 0.15 两个 minor，仍处高速产品化迭代期，API 稳定性风险判断（基线文档）继续成立。

### 1.2 能力集核证（对照基线已知项）

基线已确认的（原型/演示文稿/仪表盘/图片/视频 HyperFrames/151 设计系统/277 插件/skills+design-templates+design-systems 三层/`od mcp`）**全部仍在且未缩水**，当前 README 口径：100+ 功能技能、90+ 渲染模板（15 deck 模板 × 36 主题）、151 设计系统包、277 官方插件 + 183 示例、26 runtime 定义（25 个去重 CLI 可执行文件）、93 条图片 prompt、11 个 HyperFrames 模板 + 39 条 Seedance prompt。〔README 口径，目录结构（skills/、design-templates/、design-systems/、plugins/_official/）已在 repo 树中核实存在〕

**7 月后新增/细化的、designer 模块负责人会关心的点**：

1. **产物类型**：`prototype` / `deck` / `live-artifact`（tweaks 面板）/ `image` / `video`(HyperFrames→MP4) / `audio` / `design-system` / `scenario` 八类 `od.mode`；模板另有 `scenario` 字段按受众分组（design/marketing/operation/engineering/product/finance/hr/sale/personal）。
2. **MCP 面**：`od mcp install <agent>` 支持 16+ agent；0.9.0 起 MCP **不再只读**——新增 `write_file`、`delete_file`、`delete_project`、项目目录解析、`generation loop`（由 MCP 客户端反向驱动生成）。〔已核实，CHANGELOG 0.9.0〕默认仍 loopback 绑定 + 代理 SSRF 防护（`OD_ALLOWED_INTERNAL_HOSTS` 精确主机豁免）。
3. **SKILL.md 协议兼容**：零配置兼容 Claude Code Agent Skills 格式，OD 专属扩展走 `od:` frontmatter；插件 = `SKILL.md`（可移植契约）+ 可选 `open-design.json`（marketplace manifest）双文件设计。〔已核实，docs/skills-protocol.md、plugins/spec/SPEC.md〕
4. **质量控制**：artifact lint API + **五维自评 critique 前置门**（`design-templates/critique/`，utility 模板）；另有 `tweaks` 模板（AI 产出可调参 manifest）。〔已核实存在；但 roadmap 明言 "AI-emitted tweaks panel UX — not yet implemented"、"comment-mode surgical edits — partially shipped"〕
5. **架构未变**：Next.js 16 + React 18 web / Electron shell + sidecar IPC / Express+SQLite 本地 daemon / 外部 CLI spawn / BYOK SSE 代理。Node ~24、pnpm 10.33。**体量与双进程模型与基线评估时一致。**〔已核实〕
6. **方向性变化**：0.9+ 的增量主要在产品化与生态（官方云模型服务 Open Design Cloud/AMR、插件市场 The Bazaar、打包自更新、多语言、Windows portable/Linux Compose），**不在生成内核**——内核仍是"三层文件系统 + agent loop"。

### 1.3 与基线（2026-07-21）结论的差异

基线推荐"配置为 MCP Server（P2，按需）"——该结论仍然成立但**已被本次决策升级为参考借鉴**：deepOrca 的 designer 模块（§三）在 7-8 月完成了对 OpenDesign 核心闭环的自有复刻（见 `specs/archive/deep-design/design.md` §1 的解构：**"没有设计引擎，设计稿是 LLM 写的 HTML/CSS，daemon 只是文件服务器 + BYOK 代理 + iframe 预览壳"**——该判断经本次复核依然准确）。0.13→0.15 的变化没有推翻这一解构。

---

## 二、OpenPenCLI 身份确认：**待确认**（无字面同名项目）

用 `"OpenPenCLI"`、`open-pen-cli`、`openpen ai design tool`、`open pen agent`、`PenPot CLI` 等查询检索 GitHub/全网：**不存在名为 "OpenPenCLI" / "open-pen-cli" 的仓库**。它也不属于基线文档已覆盖的四项（CodeFlow、CLI-Anything、BrowserSkill、Open Code Review）。按候选可能性排序：

### 候选 1（最可能）：OpenPencil —— open-pencil/open-pencil

"OpenPencil CLI" 的自然展开。〔已核实，读 README/package.json〕

- **定位**：开源 AI 原生设计编辑器（Figma 替代）：原生读写 `.fig` / `.pen` 文件，内置 AI chat（100+ 设计工具），可编程工具箱 + headless Vue SDK。**自述 "Active development. Not ready for production use."** 版本 0.13.2（package.json），MIT。
- **CLI（`@open-pencil/cli`，命令 `openpencil`）**：`tree / find / node / info` 浏览节点树；`query` 用 **XPath** 查设计树（`//FRAME[@width < 300]`）；`export` PNG/JPG/WEBP/SVG/`.fig`/**JSX+Tailwind**；`convert` 格式互转；`lint`（命名/布局/结构/可访问性，strict preset，`--rule color-contrast`）；`analyze colors/typography/spacing/clusters` + `variables` 设计 token 审计与聚类提取；`eval` 执行 **Figma Plugin API** 脚本可回写文件；省略文件参数时经 RPC **操控运行中的桌面 app 实时画布**；全命令 `--json`。
- **MCP**：`@open-pencil/mcp`，stdio（`openpencil-mcp`）+ HTTP（`openpencil-mcp-http`，:3100）；`OPENPENCIL_MCP_ROOT` 限定文件操作范围；桌面端可内嵌 Claude Code/Codex/Gemini CLI（ACP）；另有 agent skill 分发（`npx skills add open-pencil/skills@open-pencil`）与 `llms.txt`。
- **技术栈**：Tauri v2（~7MB）+ Vue 3 + CanvasKit(Skia WASM) + Yoga WASM + Yjs/Trystero(WebRTC P2P 协作)；bun workspace（core/vue/cli/mcp/docs 五包）。

### 候选 2（次可能）：OpenPencil（同名不同项目）—— ZSeven-W/openpencil

终端优先（"Design from your terminal"）的 AI 原生矢量设计工具，与候选 1 互相在 README 里声明同名不同向。〔已核实，读 README〕

- **Rust workspace**（已从 TS+Electron 在 v0.7.5 全面重写为 Rust 单二进制 55.5MB，无浏览器引擎），MIT。
- **CLI `op`**：`op start [--headless --file design.op]`、`op design @landing.txt`（批量设计 DSL，支持沙箱 JS/管道 stdin）、`op insert`、`op import:figma`。
- **MCP `op-mcp`**（无 Node，桌面二进制 `--mcp` 起 stdio + 活跃 HTTP 端点）：**分层设计工作流 `design_skeleton → design_content → design_refine`**、分段 prompt 检索、style guide 工具（50+ 内置风格标签模糊匹配）、多页管理、增量 codegen 管线（`codegen_plan/submit_chunk/assemble/clean`）。
- **特色**：并发 Agent Teams（空间子任务分解）、多模型能力档案（按模型档位自动调整 prompt/thinking）、**anti-slop 跨生成多样性追踪**、`.op` 为 JSON（Git 友好可 diff）、代码导出 React+Tailwind/HTML/Vue/Svelte/Flutter/SwiftUI/Compose/RN 九目标、Figma 导入、Git 三方合并。

### 候选 3（低可能）

- **Penpot**（penpot/penpot）：无官方 CLI，自动化走 REST API + 第三方 penpot-mcp；名称既无 "Open" 也无 "CLI"，匹配度最低。〔已核实检索结论〕
- **AmosTmg/open-pen**（信息极少）、**jackwener/OpenCLI**（网站转 CLI，与设计无关）。

### 判定

**待确认。** 结合本预研的语境（设计模块对比），最合理解读是 "OpenPencil 的 CLI/MCP 面"（候选 1 或 2；两者恰好覆盖不同侧重：候选 1 = 文件格式设计器的 headless 工具链，候选 2 = 终端原生生成式设计）。§四对比矩阵对其取"两者并集、择相关项"处理；**若后续确认指向其他项目，矩阵中标注 OpenPenCLI 的行需复核**。

---

## 三、deepOrca designer 模块现状盘点（自有实现方案清单）

> 三层定位（2026-08-14 钦定，所有者已锁定边界）：**A2UI = 全域交互层**（主动追问 + 批注，**不介入 designer**）；**PM-Design = 交互原型子域**（OpenUI Lang）；**UI-Design = 视觉设计稿子域**（.dd）。A2UI 越界由 `design-a2ui-boundary.test.ts` 三条 guard 测试锁死。

### 3.1 编排层 —— `packages/core/src/actions/design.ts`

- `design.materialize` 复合 Action（L35-59）：输入 `{requirement, pipeline: auto|openui|design}`，纯编排、不含渲染。
- 路由三级优先（L134-155）：用户显式 pipeline > **`ctx.judgeViaLlm` flash 模型单选**（SessionManager 注入，L143-154）> 关键词启发式 `routePipeline`（L62-124，中英双语关键词计分，fail-open）。
- 生成委托 `ctx.runSubagent` 挂技能（L176-181）：openui → `pm-designer-openui`，design → `deep-design`；prompt 中显式要求调用 `render_openui` / `render_design` 并引用 taste 设计纪律。
- 任务树集成（L183-201）：会话绑定任务分支时，具现化产物落为分支上一步骤（`switchBranch` + `appendStep`，best-effort）。
- `artifactId` 返回 `null` 不臆测（L202-210）——DesignPanel 以 `designs/` 列表为准。

### 3.2 PM-Design 管线（OpenUI Lang）—— `packages/desktop/src/renderer/openui/`

依赖：`@openuidev/lang-core ^0.2.10` + `@openuidev/react-lang ^0.2.9`（desktop package.json）。

| 文件 | 要点（file:line） |
|---|---|
| `OpenuiRenderer.tsx` | SDK `<Renderer>` 封装（L33-109）：`deeporcaLibrary` 组件库、`toolProvider`、`onStateUpdate/initialState` 表单水合、`onError` 上抛纠错回路；错误横幅 + raw code 折叠展示（L54-106）；空 code 清错（L47-50） |
| `library-schema.ts` | **组件契约单一事实源（React-free）**：11 组件 Zod v4 定义（L26-116：Column/Row/Stack/Card/TextContent/Badge/Button/TextField/Metric/Divider/Spacer），Layout/Content/Interactive 三组（L120-124）。schema 变更必须 `npm run openui:prompt` 再生成 SKILL.md（build 防漂移强制） |
| `library.tsx` | 每个定义绑 React 组件，样式走 `--ui-*` CSS 变量（与桌面主题同源） |
| `tool-provider.ts` | 7 个只读 `design.*` 工具（L20-66：projectRoot/gitStatus/listCode/readCode/readWiki/listWikiPages/memorySearch）——原型内 `Query()` 直连本地数据，**零 LLM token** |
| `correction.ts` | 纠错回路纯函数（L19-63）：`buildCorrectionPrompt`（结构化错误码→回喂 prompt，上限 5 条）、`shouldRetry`（同 code 同错只回喂一次，防 LLM↔renderer 死循环）、`correctionFingerprint` |
| `inline-extract.ts` | inlineMode 提取（L18-37）：assistant 消息中最后一个 ```` ```openui-lang ```` fence，`complete` 标记流式闭合；与工具通道去重是调用方不变量 |
| `detect-artifact.ts` | 三管线检测纯函数（L44-70）：只认工具结果 `metadata.{a2ui,openui,design}` 键，文本匹配仅为快路径 |

设置：`openuiInlineMode`（`packages/core/src/settings.ts` L157-161）——opt-in 灰度，工具通道仍为权威。

### 3.3 UI-Design 管线（.dd / OrcaDesign）—— `packages/desktop/src/renderer/dd/` + `DesignPreview.tsx`

- `dd/parser.ts`：YAML front-matter（name/system/style/version/tokens/sections）+ HTML body（`<!-- dd:section id -->` 标记）。
- `dd/compiler.ts`：`compileDdToHtml`（L23-49）= tokens → `:root` CSS 变量（L52-66，键值双向校验防 CSS 注入）+ seed CSS（L128-166，container/section/grid/topnav/btn/card/ph-img 等）+ 内联 Tailwind JIT script + 消毒后 body。**`sanitizeDdBody`**（L94-116）：整树删除 script/iframe/form/svg/video 等危险标签、剥 `on*` 事件、中和 `javascript:/vbscript:/data:` URL——威胁模型是"LLM 产物在 `allow-scripts` 沙箱 iframe 中渲染"。
- Tailwind 本地内置：`scripts/vendor-tailwind.js` 固定 `@tailwindcss/browser@4`，unpkg/jsdelivr 双源，build 时生成 `src/generated/tailwind-script.ts`；离线缺失时降级为仅 seed CSS。
- `DesignPreview.tsx`：iframe `sandbox="allow-scripts allow-modals"` srcDoc 渲染（L68-74）；**内联迭代 composer**（L46-53，引导 agent 用 `update_design` 做 section 级补丁）；PDF 导出走 iframe print（L55-61）。

### 3.4 持久化 —— `packages/desktop/src/main/tools/design-store.ts`

- 目录：`.deeporca/designs/` = `index.json`（轻量索引）+ `<uuid>/{meta.json, prototype.openui.txt | prototype.dd, requirement.md, formState.json}`。
- 版本快照（L99-160）：save 时内容变更自动快照入 `versions[]`，**FIFO 上限 20**（L53），调用方零管理；`requirement` 持久化为 requirement.md（L142-144）。
- formState 独立小入口 `saveFormState/readFormState`（L209-231），调用方 2s 节流落盘 + 重启水合（Batch 7）。
- 血缘：`saveArtifactWithLineage`——render 建档记 id / update 复用同 id（2026-08-14 落地记录，修复了"versions 永远累积不起来"的活 bug）。
- 安全：`isSafeArtifactId`（L198-208）UUID 白名单 + 路径 resolve 回校验，防 renderer 侧目录穿越删除。

### 3.5 工作台 UI —— `packages/desktop/src/renderer/components/`

- `DesignPanel.tsx`：左侧 rail 工作区。**一键具现化**输入框+按钮（L101-138 → `api.actionRun("design.materialize")`）；filter tabs all/原型/设计稿（L146-194）；Artifact 卡片（管线图标/标题/相对时间/删除）。
- `DesignPreview.tsx`（同 3.3）+ `PrototypePanel.tsx`（PM-Design 预览宿主）。

### 3.6 技能与提示词层 —— `packages/core/templates/plugins/design/`

- `skill.plugin.md`：design 插件清单（deep-design / pm-designer-openui / taste 三技能；`mcp: [a2ui]` 为共享进程宿主而非管线越界，guard 测试已锚定）。
- `pm-designer-openui/SKILL.md`：组件表为**生成产物**（哨兵注释包裹，L37-95）；全量替换迭代语义（L128-139，"send the complete program"）；hoisting/流式顺序指引（root 先行）。
- `deep-design/SKILL.md`：.dd 格式规范；**Step 0 读 `.deeporca/DESIGN.md` 品牌契约**（L119-127），无则选内置 3 系统（dark-tech/modern-minimal/editorial）；section 节奏规划表；渲染后 P0 自检清单（L160-168）；输出契约（render_design + 写 `.deeporca/designs/`）。
- `taste/SKILL.md`：10 条 P0 设计纪律（L17-50：Title≠Body、4/8px 间距系统、单一强调色、对比度 ≥4.5:1、按钮必有 hover、占位图、移动端重排、段落呼吸、无孤标题、圆角一致）+ 排版阶梯 + 颜色/动效纪律。框架无关，横跨三管线生效。
- **防漂移**：`scripts/generate-openui-prompt.mjs` —— library-schema → SDK `library.prompt()` → 写回 SKILL.md 组件表（裁掉 standalone 前导段）；desktop build 生成前后比对，篡改即构建失败（含负向验证）。

### 3.7 演示文稿管线 —— `packages/core/src/actions/bento.ts` + `scripts/vendor-bento.js`

- `bento.create` Action（L30-66）：结构化 slide spec（text/shape/image/chart/table 元素）→ 注入 vendored Bento 模板 → 自包含 `.bento.html`。
- vendoring：下载 nyblnet/bento 最新 `Bento_Slides.bento.html` 至 `templates/plugins/work/skills/bento-slides/references/`，`.vendored-bento-version` 固定版本标记，best-effort。

### 3.8 规格与决策文档

- `specs/pm-design-v2/design.md`（2026-08-11）+ `tasks.md`（2026-08-15 差距审计：管线集合=2、analysis.json/pm-analyst 缓期、版本切换 UI 与独立导出列为后续）。
- `specs/archive/deep-design/design.md`（2026-07-29）：**明确"复刻并超越 Claude Design/OpenDesign 核心闭环，不引入外部 daemon（Express+SQLite+Node24）"**；四层文件系统（DESIGN.md 品牌契约 / 模板 seed / SKILL.md 工作流 / 浏览器展示）。
- `docs/research/2026-08-14-openui-full-adoption-plan.md`：三层定位、Batch 6-10 全部落地记录、验收口径（无活谎言/单一事实源/数据闭环/流式/纠错自治）、暂缓清单（editMode merge、analysis.json、iframe 沙箱增强、落盘值正名）。

---

## 四、逐能力对比矩阵

### 4.1 OpenDesign × deepOrca

| # | OpenDesign 能力 | deepOrca 对应/缺失（file:line 见 §三） | 借鉴价值 |
|---|---|---|---|
| 1 | 原型生成（单页 HTML + 沙箱 iframe） | ✅ 双管线全覆盖：OpenUI Lang 原型 + .dd 设计稿（iframe sandbox + sanitizeDdBody） | **低**（已覆盖，机制同构） |
| 2 | 交互仪表盘 / live artifact（tweaks 面板） | 🟡 OpenUI 原型 + `design.*` Query 本地取数（零 token）；无 tweaks manifest | **中**（tweaks 思想可记观察清单；OD 自己 UX 也未实现） |
| 3 | 演示文稿 Deck（PPTX/PDF 导出、15 模板×36 主题） | 🟡 `bento.create` + vendored 模板 + .dd；PDF 走 iframe print；无 PPTX | **中**（PPTX 可选后续，agent-driven 思路） |
| 4 | 图片生成（gpt-image-2/ImageRouter，93 prompt） | ❌ designer 域内无（vision MCP 另属一域） | **无**（外部付费 API，隐私与定位不符） |
| 5 | 视频 HyperFrames（HTML+GSAP→MP4） | ❌ 无 | **无**（headless Chrome + FFmpeg + 外部模型，重依赖域外） |
| 6 | 设计系统 DESIGN.md（151 包） | 🟡 `.deeporca/DESIGN.md` 品牌契约同构 + 内置仅 3 套（deep-design SKILL.md L119-127） | **高**（纯 Markdown 扩充内置预设，零依赖，见 §五-1） |
| 7 | 功能技能 skills（100+，SKILL.md 协议） | ✅ 自有 SKILL.md 协议完全同构；designer 域 3 技能 + 生成式组件表 | **中**（可吸收 critique/tweaks 两个 utility 模板的**思想**） |
| 8 | design-templates 渲染模板（90+，mode×scenario） | 🟡 .dd section 节奏表 + seed CSS + taste 纪律 | **中**（节奏表可扩充为更多页型预设，prompt 层） |
| 9 | 插件生态（277 + 市场） | ✅ 自有插件/技能体系（`.deeporca/plugins`、模板插件清单） | **低**（生态玩法，当前阶段不适用） |
| 10 | MCP 面（`od mcp`，16+ agent，含 write/generation loop） | ✅ 自用已覆盖：a2ui in-process server 提供 `render/update_openui`、`render/update_design` | **无**（deepOrca 是 harness 本体，无需对外暴露第二套设计 MCP） |
| 11 | 25 CLI runtime 适配 | ✅ 不适用——deepOrca 自身即 agent | **无** |
| 12 | BYOK 代理 + daemon（Express+SQLite） | ✅ core 多端点 endpoints 配置 + 会话持久化（jsonl）；明确不要 daemon | **无**（架构冲突，见 §五-3） |
| 13 | 导出 HTML/PDF/PPTX/ZIP/MP4/MD | 🟡 .dd→自包含 HTML（compiler 一步到位）+ PDF + bento HTML deck | **中** |
| 14 | 质量控制：artifact lint API + 五维 critique 前置门 | 🟡 correction loop（SDK 结构化错误码回喂，一次去重）+ taste 10 条 P0 + deep-design 自检清单 | **高**（五维自评并入 taste/后渲染自检，纯 prompt 零代码，见 §五-2） |
| 15 | 持久化/会话恢复（SQLite projects） | ✅ design-store（index+meta+versions FIFO20+requirement.md+formState 水合） | **低**（已覆盖，JSON 足够） |
| 16 | 记忆积累（截图/字体/调色板沉淀为默认） | ✅ 仓库级 memory L0-L3 管线（另一模块，已存在） | **低** |
| 17 | 刷新既有代码库到品牌（code-migration） | ❌ designer 域无（codegraph/review 基建在） | **中/低**（思想：.dd tokens → 校验真实组件，远期） |
| 18 | Figma/Pencil 迁移插件（alpha） | ❌ 无 | **低**（OpenPencil 覆盖 .fig 读取，用户级 MCP 自配） |
| 19 | comment-mode 外科手术式编辑 | 🟡 update_design 已引导 section 级补丁（DesignPreview L50） | **中**（按 section 粒度已是自有答案；OD 该项也只 partial） |
| 20 | 版本快照/回溯 | ✅ versions[] FIFO 20 + 血缘 id 复用 | **低**（版本切换 UI 已列后续） |

### 4.2 OpenPenCLI（按最可能解读 = OpenPencil 两候选并集）× deepOrca

| # | OpenPencil 能力 | deepOrca 对应/缺失 | 借鉴价值 |
|---|---|---|---|
| 1 | `.fig`/`.pen` 文件读写、节点树浏览 | ❌ 无（域外：文件格式设计器 vs 生成式设计稿） | **无**（用户有需求可自装其 MCP，属用户级配置） |
| 2 | 设计 lint（命名/布局/对比度/可访问性，CLI 规则集） | 🟡 taste P0 规则（prompt 级、生成前约束） | **中**（规则条目如 color-contrast 可反哺 taste 清单） |
| 3 | token 审计与聚类提取（colors/typography/spacing/clusters → 变量） | ❌ 无 | **中/低**（若做"从既有 .dd/DESIGN.md 提炼 token"时有价值） |
| 4 | XPath 设计树查询 | ❌ 无 | **无**（无画布文档模型，不适用） |
| 5 | 多目标代码导出（候选 2：React+TW/HTML/Vue/Svelte/Flutter/SwiftUI/Compose/RN） | 🟡 .dd 天然自包含 HTML；spec pm-design-v2 P4 规划 OpenUI→React（SDK 已有能力） | **中**（对齐既有 P4，无需新动作立项） |
| 6 | 分层生成 `design_skeleton→content→refine`（候选 2 op-mcp） | 🟡 deep-design Step 2"先定 section 节奏再填内容"思想近似 | **中**（大页面可选两段式生成，prompt 层试验） |
| 7 | Style Guides 50+ 标签模糊匹配（候选 2） | 🟡 taste + 3 内置系统 | **中**（风格预设库与 §五-1 同一件事） |
| 8 | anti-slop 跨生成多样性追踪（候选 2） | ❌ 无（taste 管"单件质量"，不管"件间雷同"） | **中**（designs/ 目录即现成对比源，可进 taste 检查项） |
| 9 | 并发 Agent Teams 空间分解（候选 2） | ❌ 无（单 agent + runSubagent） | **低**（deepOrca 有任务树/子代理体系，按需自然演化） |
| 10 | MCP server（两家均有，stdio+HTTP） | ✅ 自有 a2ui in-process server | **无**（同 4.1#10） |

---

## 五、进化建议（只取思想、不引依赖）

> 总原则：**以现有 designer 模块为演进主体**；以下"吸收"均指 prompt/模板/纪律层的自有实现，不新增 npm 依赖、不引入外部进程。

### 5.1 值得吸收进现有模块（按优先级）

1. **内置设计系统库扩充（P1，价值最高/成本最低）**：OpenDesign 151 包 vs 自有 3 套（dark-tech/modern-minimal/editorial）。做法：在 `templates/plugins/design/` 下以**纯 Markdown** 增加精选预设（自写/改写 tokens 化的 DESIGN.md，参考其包形态 `DESIGN.md + 可选 tokens 清单`），deep-design SKILL.md 的系统选择表同步扩容。零运行时依赖，产出质量直接受益。
2. **五维自评并入质量纪律（P2）**：把 OD `design-templates/critique` 的五维评分卡思想落到 `taste/SKILL.md`（或 deep-design Step 5 自检清单扩充）——生成后自评一遍再交付。与既有 correction loop（渲染错误，事后硬错）互补：这是"没报错但丑"的软质量门。
3. **anti-slop 多样性检查（P2，与 2 同批）**：taste 增加一条"与 `designs/` 内近期产物比对，避免结构与配色雷同"——候选 2 OpenPencil 已验证该问题真实存在。
4. **分层生成试验（P3，可选）**：大页面 .dd 先出 section 骨架（+用户确认）再填充内容，对应候选 2 的 skeleton→content→refine。仅 prompt 层（SKILL.md 工作流步骤），不动工具面。
5. **tweaks manifest 思想记观察清单（不动作）**：OD roadmap 自己标 "not yet implemented"；待其跑通且我们有真实诉求（仪表盘调参）再评估。

### 5.2 已被自有方案覆盖、无需动作

- 双管线 + 一键具现化路由（design.materialize，flash 判定 + fail-open 启发式）——对应 OD 的 brief→direction→artifact 编排；
- 持久化/版本/需求/表单水合闭环（design-store）——对应 OD SQLite projects；
- 纠错回喂（correction.ts，一次去重护栏）——对应 OD artifact lint API，自有走 SDK 结构化错误码，等价且更轻；
- 品牌契约（`.deeporca/DESIGN.md`）与 OD DESIGN.md 刻意同构——**这是当初有意对齐的互操作面，保持即可**；
- SKILL.md 协议兼容——两家用的是同一约定，OD 的技能理论上可被 deepOrca 引用（参考性质，不列正式实现）；
- **防漂移机制（generate-openui-prompt 挂 build）——自有方案强于 OD**（OD 无 schema→prompt 强制同步的等价公开机制）；
- 沙箱与消毒（iframe sandbox + sanitizeDdBody）——对应 OD sandboxed iframe。

### 5.3 明确不建议引入的部分及原因

| 项 | 原因 |
|---|---|
| OpenDesign 整体 / 其 daemon | 体量（Next.js 16 + Electron + Express + SQLite + Node 24 + pnpm monorepo）；**双 Electron 桌面进程冲突**；违反 core 无 UI 依赖的分层规则。基线结论在 0.15 依然成立——0.13→0.15 的增量全在产品化/生态，架构未变。`specs/archive/deep-design/design.md` 的"去掉 daemon 复用内核"正是对本项的回答 |
| HyperFrames 视频管线 | headless Chrome + FFmpeg + 外部视频模型 API；重依赖 + 付费 API + 与 harness 定位不符 |
| OD 插件市场 / 25 CLI runtime 适配 | deepOrca 是 agent harness 本体而非外壳；自有插件/技能体系已在 |
| 图片/视频生成 provider 接入 | 外部付费 API、隐私面扩大；如个别用户需要属其自行配置范畴 |
| OpenPencil CLI/MCP 作为依赖（若 OpenPenCLI 指它） | ① 候选 1 自述 "Not ready for production"；② 候选 1 为 Tauri/Vue、候选 2 为 Rust 二进制，均与 Electron+React 技术栈正交，仅能以外置进程接入；③ 能力域（画布矢量文件编辑）与 designer 模块（生成式 HTML/DSL 设计稿）重叠有限。**处置**：对 `.fig` 读取等边缘需求，维持用户级 `settings.mcpServers` 自行接入的可能（与基线对 OD 的 MCP 建议同级：按需、参考、不列正式实现） |
| OpenUI editMode merge 回补 | 既有暂缓决策不变：全量替换口径已三处一致，token 代价可接受 |

---

## 六、结论

1. **deepOrca 的 designer 模块已经是 OpenDesign 核心闭环的自有等价实现**，且在若干点上更贴合自身架构：双管线（OpenUI Lang 交互原型 / .dd 自包含设计稿）+ flash 路由一键具现化 + JSON 落盘版本血缘 + SDK 结构化错误回喂 + schema→prompt 构建期防漂移 + 沙箱消毒，全程零守护进程、零新增重型依赖。OpenDesign 0.13→0.15 一个月连发两版，但增量在云服务/插件市场/打包体验等**产品化与生态方向**，未改变"三层文件系统 + agent loop"的内核判断（该判断由 `specs/archive/deep-design/design.md` 最早解构，本次复核成立）。
2. **"OpenPenCLI" 身份待确认**：无字面同名项目；最可能是 OpenPencil（两家同名项目，候选 1 open-pencil/open-pencil 的 `@open-pencil/cli` 与候选 2 ZSeven-W/openpencil 的 `op`）。两者与 designer 模块的能力重叠集中在"设计纪律/风格预设/分层生成/多目标导出"等思想层面，均不构成依赖引入的理由。
3. **建议动作**仅三项，全部是 prompt/模板层自有演进：内置设计系统 Markdown 预设扩充（P1）、taste 扩充五维自评 + anti-slop 多样性（P2）、大页面两段式生成试验（P3，可选）。tweaks 面板、PPTX、代码库品牌化刷新记观察清单。
4. **重申口径**：以项目实际实现方案为主，本次调研结论**仅供参考，不列入正式实现**；外部工具（OD MCP / OpenPencil MCP）保持用户级可选配置的定位。
