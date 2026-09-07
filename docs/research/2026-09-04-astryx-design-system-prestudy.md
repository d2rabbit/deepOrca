# Astryx（facebook/astryx）设计系统调研纪要 — 与设计系统进阶方案比对

> **日期**：2026-09-04 · **性质**：为 `specs/design-systems-advance/design.md`（设计系统进阶唯一方案）服务的对比研究纪要——继 2026-09-01 四项目研究（open-design / open-pencil / open-codesign / penpot，见 `2026-09-01-design-systems-comparative-study.md`）之后的**第五个对比项目**。
> **方法**：zread MCP 一手取证（read_file / get_repo_structure / search_doc 直读上游仓库文件与目录树：主 README、`packages/core/README.md`、`packages/cli/README.md`、`CLAUDE.md`、`IME_GUARD_DESIGN.md` 五份全文 + `packages/core/src` 与 `internal/` 全目录树 + 三轮专题检索），未克隆、未安装、未运行。证据标注沿用本目录惯例：〔已核实〕= 直接读过文件/目录树，〔README 口径〕= 仅上游自述。
> **对比目标**：`specs/design-systems-advance/design.md` 的五差距（G1-G5）、V3 哲学四原则（§4）、.dd v2 文档模型（§6.2）、三层质量闸（§6.3）、统一 token 契约与防漂移（§7.1）、evals 扩充（§7.4）；并对照 `specs/cmb-adoption/`（CMB 供给侧工程）口径。
> **交付**：纯调研留档，无代码改动；借鉴建议仅供设计案修订与 eval 扩充参考，**消费以 specs/ 为准（总口径）**。

---

## §0 一句话定位与总体结论

| 项 | 内容 |
| --- | --- |
| 定位〔README 口径〕 | **Meta 内部孵化 8 年、13,000+ app 在用的设计系统**（Beta）开源：组件库型设计系统——150+ 可访问组件 + 品牌 token 主题 + 页面模板 + agent-first CLI，"built for how we build now: by people and the agents working alongside them" |
| 技术栈〔已核实〕 | React 19（peer deps）+ StyleX 编写/预构建 CSS 分发（消费者无感 StyleX）+ CSS 自定义属性 token 体系 + `@layer` 显式级联 + pnpm 11 / Node 22 / vitest；MIT |
| 物种 | **分发型组件库**（给人和 agent 消费现成组件建 app），非设计工具、非生成式工作台 |
| 规模〔已核实目录树 / README 口径〕 | `packages/core/src` 组件目录实测 **103**（README 口径 150+，含 hooks 与多变体拆分）· 7 个现成主题（neutral/butter/chocolate/matcha/stone/gothic/y2k）· CLI 15 命令 + manifest 面、43 条 append-only 错误码 · eslint 插件 **30 条规则**（每条带同名测试）· charts/vega 仅 `@canary` dist-tag 未稳定 |

**总体结论**：

1. **物种不同，不构成本方案的冲击**。deepOrca 的两大模块（prototype.* / design.*）是"生成式工作台"（LLM 直写 OpenUI Lang / .dd 产物），astryx 是"分发型组件库"（预构建 CSS + 组件 + CLI 供人和 agent 消费）。2026-09-01 的两阵营划分（生成式/编辑器式）应**扩为三物种**：生成式工作台 / 编辑器式画布 / 分发型组件库。本方案"LLM 直写产物 + 轻内核"路线不受影响，四原则（契约驱动/回环保证/中间产物即资产/轻内核多载体）反而被 astryx 逐条印证。
2. **三大交叉带的机制密度是全部已研究项目中最高的**，为设计案 §6.2（tokens schema / 组件原子库）、§6.3（lint preset）、§6.4（确定性调色板）、§6.6（tokens.css 导出）、§7.1（防漂移）、§7.4（evals）提供工业级实现参照。
3. **agent-first 深度超出此前所有已研究项目**：CLI 即 agent 接口（typed JSON envelope / 自描述 manifest / 稳定错误码 / doctor CI 门）、`init` 把组件索引写进 `AGENTS.md`/`CLAUDE.md`、**vibe-tests 用 LLM 系统性评测"SKILL 文档对 agent 的供给质量"**——与 CMB"供给侧工程"哲学同族，vibe-tests 可作 CMB-6（失败模式分类学）在组件库侧的镜像参照。

---

## §1 仓库一手纪要

### 1.1 定位与结构

- ** packages**〔已核实〕：`core`（组件 + 主题运行时 + hooks + i18n + utilities，发布）· `cli`（组件文档/模板/脚手架/主题构建/codemods，发布）· `themes`（7 主题，发布）· `charts` / `vega`（Vega-Lite 图表封装，仅 `@canary`）· `richtext`（目录树在，主 README 包表未列，疑似滞后）· `lab`（实验组件，仅内部，不发布）。主 README 表另列 `@astryxdesign/build`，目录树未见独立 `build/`——README 与目录树轻微口径差，未深究。
- **治理面**〔已核实〕：changesets + `scripts/`（28 个含同步/校验/生成脚本，多数带同名 `.test.mjs`）+ `internal/`（eslint 插件 / lab-readiness 审计 / stylex-capabilities 扫描 / vibe-tests / test-utils）。
- **文档三站**〔README 口径〕：docsite（astryx.atmeta.com）+ Storybook + Sandbox；仓库治理另走 GitHub Wiki（API Conventions / Design Conventions / Component Lifecycle / Swizzle Ergonomics / AI + Design Systems 等）。
- **证据**：`docs/CHARTV2_*` 四份在途文档（phase1 plan / readiness / stage1 design / verification checklist）与 charts `@canary` 互证——**图表是 13,000-app 规模的设计系统里最不成熟的部分**，与本仓 token 面板自绘 SVG 图表的判断一致（不做重投入）。

### 1.2 Token 与主题体系（G2 / §6.2 / §6.4 的最完整参照）

〔已核实，zread 主题系统 / Design Tokens / CSS Variable Cascade / Custom Theme Authoring / Tailwind Integration 五篇〕

1. **`@layer` 显式级联序**：`reset.css`（`@layer reset`）→ `astryx.css` 组件样式（`@layer astryx-base`）→ `theme.css` token 覆盖（`@layer astryx-theme`），**导入顺序即契约**；主题 CSS 以 `data-astryx-theme` 属性作用域，缺属性则回退内置默认值。
2. **Token families**：`--color-*` / `--radius-*` / `--shadow-*` / `--spacing-*` / `--font-*`、`--text-*` / `--duration-*` / `--ease-*` + **组件级域 token**（`--astryx-card-padding: var(--spacing-3)` 等派生引用）——与 .dd v2 计划的六组（color/typography/spacing/radius/shadow/motion）几乎一一对应（astryx 把 motion 拆 duration/ease 两组）。
3. **语义 → 分类单向重定向**：语义 token 值是分类 token 的 `var()` 引用（`--color-error → var(--color-text-red)`），换主题只改分类层，语义层自动跟随——**这是 .dd v2 `{组.名}` 引用语法的成熟镜像**（方向相反：astryx 是"语义层指向分类层"的重定向，.dd v2 是"值引用"）。
4. **light-dark() 元组编译**：theme 源里一个值写 `[light, dark]` 两态元组，构建时编译为 `light-dark(light, dark)`——**一个 token 双态、零双 tokens 集**。且有 lint 规则 `no-light-dark-outside-theme` 禁止在主题文件外手写 `light-dark()`。
5. **defineTheme 生成式主题**：shorthand（typography scale / motion / radius base×multiplier / accent seed）解析为完整 token map；**accent seed → HCT 调色板程序化生成**；radius 基数×倍率批量生成 `--radius-*`（`--radius-none`/`--radius-full` 固定不参与倍率）。
6. **组件级 override targets**：`astryx theme targets` 输出整个可主题化面——每组件 `{key, className, component, props, states}`，**props/states 是该组件的合法覆盖键显式枚举**；主题可写 `badge: { 'variant:info': { backgroundColor, color } }` 级覆盖，且可重定向语义 token。
7. **theme build 产物化**：`astryx theme build`（含 `--check` 新鲜度收据：missing/outdated 各带 reason、batch 批量）把主题源编译为 css/js/dts——**编译产物 + 新鲜度收据**模式。
8. **Tailwind bridge**：`tailwind-theme.css` 用 `@theme inline` 把系统 token 映射为 Tailwind utilities（`--spacing: var(--spacing-1)` → `p-4`=16px 与 `--spacing-4` 同源；`bg-surface`/`text-primary`/`rounded-lg` 直落 token）——**utilities 不脱离 token 层**，任意值仍可作逃生口。

### 1.3 Agent-first CLI（人类与机器同一接口）

〔已核实，`packages/cli/README.md` 全文〕

1. **统一接口哲学**：CLI 即"primary interface for humans and machines alike"，agent 与 build 工具用与 CLI 同源的 programmatic API（`@astryxdesign/cli/api` 导入即可用，"CLI command handlers are thin wrappers around these functions"——**两表面数据恒等**是显式保证）。
2. **typed JSON envelope + 稳定错误码**：每命令支持 `--json`，信封 `{type, data}`；**错误分支只能 branch on `code` 不能 branch on 人读 message**；43 条错误码 **append-only**（一旦发布语义不变、永不删除，新错误条件新增码），CLI 抛错与 JSON 信封同码。
3. **自描述 capability manifest**：`astryx manifest --json` 返回"OpenAPI spec for the CLI"——全部命令/参数/旗标（类型/可选值/默认值）/是否支持 --json/可发出的 response type 判别器；manifest **从 Commander 元数据派生（不能漂移）**，Commander 不追踪的两个事实由白名单+映射补充，**由 drift 测试把守**（`manifest.test.mjs`：加命令不描述则 CI 失败）。
4. **`doctor` 健康检查 CI 门**：8 项检查（Node 版本/core 解析/版本对齐/主题包/config/agent docs 存在性/peer deps/包管理器），**exit code 即契约**（0 无 fail / 1 有 fail），可直接作 CI step。
5. **token 经济文档选项**：`--detail brief<compact<full` 阶梯 + `--dense`（压缩格式，"token-efficient, useful for AI agents"）+ `--zh`（简中文档）——多语言与多密度都是一等能力。
6. **`init` → AGENTS.md**：一次性把组件索引写进 `AGENTS.md`/`CLAUDE.md`，让 agent "discovers components, templates, and design tokens instead of guessing"；doctor 会检查 agent docs 是否存在且含 Astryx section 标记。
7. **`search` 跨域统一入口**：component/hook/doc/template 四域统一排名搜索（名称与关键词命中 > 散文偶然提及，含 typo 模糊匹配），每条带域标签与**后续命令**（`→ astryx component Button`）。
8. **`layout`（XLE/XLO 压缩表达式）**：紧凑表达式展开为 TSX（componentsUsed/states 数/todos/blocksReferenced/警告回执），`layout.grammar` 输出语法速查表 + **由注册表生成的别名映射**；`experimental.xle.components` 可注册 app 本地组件进表达式。
9. **`swizzle` 弹出源码**：把组件源 eject 到项目里自有；返回**收据**（组件名/属主包/输出目录/复制文件数/是否含 StyleX/维护者备注）。
10. **Integrations 扩展协议**：消费端 `astryx.config` 列集成包，作者端 `astryx.integration` manifest 声明 components/templates/codemods/docs 贡献；全走同一 CLI 面；**发现失败降级为 stderr 一行警告，永不污染 JSON 信封**；`validate-integration` 单包诊断。
11. **agent bootstrap 规则**〔CLAUDE.md〕：每个分支先跑 bootstrap（help/docs/component --list/template --list，<500ms）——"docs reflect the branch's actual API"；改组件前必先 `component <Name> --dense`。

### 1.4 vibe-tests 评测体系（G5 / §7.4 的直接蓝本）

〔已核实，`CLAUDE.md` /vibe-test 命令全文 + `internal/vibe-tests/` 目录树〕

- **评测对象是"AGENTS.md 对 LLM 的供给质量"**（"vibeability"）：不是评代码，是评**供给文档**能否让 LLM 一次写出正确组件代码。
- **21 个测试**，支持分层采样（`/vibe-test 5`）与全量；结果 JSON 含 persona / promptCategory / trajectoryDepth / componentsUsed / **escapeHatches**（逃生口用量 = 偏离正道使用任意值/内联样式的度量）。
- **degradation 模式**：10-turn 对话（填充/干扰/恢复轮）探测 **turn 0/6/8/10** 的质量衰减曲线，输出每测试的折线图——上下文保持性度量。
- **对照环境矩阵**〔已核实目录树〕：`environments/` 四组（project-astryx / project-astryx-tailwind / **project-baseline** / **project-html**）——A/B 对照"有无设计系统 vs 裸 HTML"。
- **判定与基准**〔已核实目录树〕：`ideals/` 每测试的理想结果截图（~55 张）+ `a11y-manifests/`（astryx vs baseline 可访问性清单）+ `design-judge.ts` / `design-judge-gemini.py`（LLM 视觉评审）。
- **子实验线**：`prompt-purity-test/`（variants，提示词纯净性）· `selector-naming-test/`（A/B 变体）· `cli-discovery-test/`（CLI 发现性，含 conditions.json）· `personas/`（analyst/evaluator/radius-evaluator）· `test-sets/`（default/complex-selector/radius-tokens）。
- **执行编排**：`/vibe-test` 由 CLAUDE.md 自定义命令描述完整流程（并行子代理生成 → `gh workflow run vibe-screenshots.yml` 出预览截图 → aggregate 聚合），**评测已进入 CI 工作流**。

### 1.5 质量与防漂移纪律

〔已核实，`internal/eslint-plugin-astryx/` 与 `scripts/` 目录树 + `CLAUDE.md`〕

1. **eslint-plugin-astryx 30 条规则**（目录树逐条实测，每条带同名测试），与 taste/anti-slop 直接同族的至少 8 条：`no-raw-color`（禁裸色值）· `no-hover-on-disabled` · `focus-outline-keyboard-only` · `no-classname-clobber`（禁 className 覆盖竞用）· `no-physical-properties`（强制逻辑 CSS 属性）· `no-light-dark-outside-theme`（light-dark 只许出现在主题文件）· `no-hardcoded-i18n-string` + `i18n-key-format` + `no-raw-intl-locale`（i18n 三连）· `no-unguarded-ime-keydown`（IME 未守护 keydown 报警）；另有 API 面规则（`boolean-prop-naming` / `require-base-props` / `require-ref-prop` / `presentational-component` / `no-wrapper-transform` / `no-style-only-wrapper` / `stylex-style-source` 等）与工程面规则（`copyright-header` / `no-raw-console-cli`）。
2. **STYLEX-CAPS 能力表注入 + 扫描验证**〔CLAUDE.md + internal/stylex-capabilities〕：上游能力矩阵（css 支持面/禁用形态/推荐 PATTERN 一览）以机器生成表注入 CLAUDE.md，末行 `VERIFY: node internal/stylex-capabilities/scan.mjs`——**进 agent 语境的能力表必须有机验**。
3. **生成制文档 + GENERATED 标记 + 漂移测试**：CLI README 的命令表/错误码表/response types 表全部 `BEGIN GENERATED` 区块由 `generate-cli-readme.mjs` 从单一事实源生成，配套漂移测试（`manifest.test.mjs` 等）——"加命令不描述则 CI 失败"。
4. **约定即测试**〔已核实 core/src〕：`naming.test.ts`（命名约定测试）· `docPropLiterals.test.ts` / `docPropReferences.test.ts`（.doc 文档有效性测试）· `serverSafeComponents.test.ts`（RSC 安全面测试）· `postinstall.test.mjs`——**每条强约定都有一只测试**。
5. **对比度专项 CI**：`check-badge-contrast.test.mjs` / `check-stone-secondary-text-contrast.test.mjs` / `check-syntax-punctuation-contrast.test.mjs`——**"特定 token 组合 × 特定主题"的实测对比度回归**（stone 是主题名），比泛化对比度检查更可维护。
6. **i18n 目录校验**：`check-i18n-catalog.mjs` + 配套测试——与 deepOrca"6 locale 全目录 typecheck 强制"同纪律不同机制（本仓用 TS Record 类型，astryx 用脚本+lint）。
7. **lab→core 转正审计**：`internal/lab-readiness/`（audit.mjs / catalog.mjs / manifest.mjs）+ `score-ledger.mjs` / `template-score-ledger.mjs`——**组件与模板按分记账的就绪/转正治理**，实验件（lab）进核心（core）有明确门槛。
8. **codemod 暂存-晋升链**：feature PR 把迁移脚本放 `transforms/next/`（版本号未知），发布 PR 时 `promote-codemod-next.mjs` 按 changesets 定出的真实版本晋升并注册 registry——迁移工作与版本号解耦。

### 1.6 文档工程

〔已核实，CLAUDE.md 文档标准节 + core/src 目录树〕

- **组件文档即代码**：每组件目录一个 `{Name}.doc.mjs`——纯 JS + JSDoc 类型注解、导出 `ComponentDoc` 对象（由 `@astryxdesign/cli/authoring` 类型约束），CLI 的 `component` 命令即渲染它；文档坏了是**类型错误/测试错误**，不是"没人发现"。
- **文件头协议**：每个源文件结构化 JSDoc 头（`@input` / `@output` / `@position`）+ `SYNC:` 注释提醒同步；修改代码必须更新文件头。
- **受众分离**：每个 `.doc.mjs` 与 `packages/cli/assets/docs/` 的读者是"**用** Astryx 建造的人/agent"，不是"造 Astryx 的人"；评审 rubric、就绪门、审计清单归 Wiki——受众错位是文档缺陷。

### 1.7 IME 组合输入守护（CJK 相关）

〔已核实，`IME_GUARD_DESIGN.md` 全文（评审用设计稿，注明 Not shipped）〕

- 背景：7 处 keydown 命令点（Escape 关闭 / Enter 提交等）需要区分"组合输入中的按键"与"真命令"；核心谓词 `isImeKeyEvent` = `isComposing || keyCode === 229` **双信号**——理由：部分 IME 与旧 Safari 在组合 keydown 时 `isComposing` 尚未置位但**必报 229**，砍掉 229 回退会回归。
- 治理形态：谓词收编到 `utils/ime.ts`（唯一权威注释位）+ 3 处内联重复去重 + **lint 规则 `no-unguarded-ime-keydown` 给新代码兜底**；明确拒绝 `useImeSafeKeyDown` 包装 hook（2/7 调用点包装即错误：Escape 判定还叠加 focus-trap 等其它条件，"包装整个 handler"会改变行为）——**"谓词 + lint"而非"包装 hook"**，是"guidance over enforcement + 拒绝过度工程"的实例。
- lab 的 CodeEditor 用 `compositionstart/end` ref 跟踪守 onInput（防半个 CJK 音节写进 value）——**是另一个正交 concern**，文档里明说"intentionally out of scope"，并顺带标出一个潜伏缺陷（其 handleKeyDown 无 IME 守护）留独立修复。

### 1.8 设计哲学四原则（README 口径）

1. **Guidance over enforcement**——组件给能力不给护栏："if you pass a value, the component renders it"；设计观点活在文档与示例里。
2. **Strong, documented conventions**——命名/prop/组合规则全组件一致且全文档化，"人学过几个，剩下的就可预测；人和 AI 同样可预测"。
3. **One system for humans and AI**——API、约定、文档、CLI 一起设计；"每一次让 Astryx 对 AI 更容易的改动，也让它对人更容易"。
4. **Earned by measurement**——**测约定而不主张约定**，结论松持，被新情况证伪就改。
   开放内部（Open internals）：构件直接导出、`swizzle` 可把组件源弹出到项目里自有——与"封闭顶层 API"传统相反。

---

## §2 与设计系统进阶方案（design-systems-advance）比对

### 2.1 物种对位表

| 物种 | 项目 | 产物形态 | 消费形态 | 对本方案 |
| --- | --- | --- | --- | --- |
| 生成式工作台 | open-design / open-codesign | LLM 写 HTML/JSX 代码 | 浏览器即画布 | 本方案两大模块即此物种 |
| 编辑器式画布 | open-pencil / penpot | 结构化文档模型（场景图） | 画布编辑 + API 操作 | 本方案要吸收其"结构化程度" |
| **分发型组件库** | **astryx** | 预构建 CSS + 组件 + token 主题 | **人和 agent 经 CLI/API 消费现成件** | **新物种：不替代方案，是"消费侧参照系"** |

**含义**：astryx 解决的是"app 开发时直接拿现成件用"，deepOrca 两大模块解决的是"从需求到设计产物的生成"；两者唯一同构面是 **token 契约层**（两边都是 token-driven CSS custom properties）与 **agent 工具化层**（两边都把 agent 当一等消费者）。这两个同构面恰好是本方案 §6.2 / §7.1 / §7.4 的落点。

### 2.2 逐差距比对（G1-G5）

| 差距 | astryx 对应机制 | 比对结论 |
| --- | --- | --- |
| **G1 原型交互回路** | 无对应面（组件级交互 ≠ 原型走查；无 agent 响应回路概念） | 不影响 §5.2 设计；astryx 零输入，维持原案 |
| **G2 tokens / 组件复用** | §1.2 全套：families / 语义→分类重定向 / light-dark 元组 / 组件 override targets / Tailwind bridge / HCT 生成 | **强对应，§6.2 获六个具体机制补充**（见 2.3） |
| **G3 质量闸** | eslint 30 规则（AST 级）+ 对比度专项 CI + 约定即测试 | **强对应**：规则思想可移植进 design.lint preset；对比度专项 CI 是"渲染后机检"的可维护形态；实现形态不同（astryx 作用于 TSX 源码，.dd lint 作用于浅解析文本）需按 §6.3 defineRule 架构裁剪 |
| **G4 留存与回退** | 无对应（组件库无"设计工作流中间产物"概念） | 不影响 §6.4/§7.3 设计；维持原案 |
| **G5 记忆与评估** | **vibe-tests 全套**（§1.4） | **最大收益带**：本方案 eval 缺口（现状 1 正例 + 字符串断言）的完整方法论蓝本，见 2.4 |

### 2.3 §6.2 / §7.1 可吸收的六个 token 机制细节

1. **light-dark() 元组 → .dds 多主题轻量版**（§6.2① token-set/theme P2）：原案需多主题 tokens 集；astryx 证明"单值双态元组 + 构建期编译 + lint 禁止主题外手写"更省。.dds 的 light/dark 变体可直接采纳此形态（注意：`light-dark()` 需浏览器支持——Electron Chromium 现代版 OK；.ddu 独立打开场景需保留降级路径）。
2. **语义→分类单向重定向 → .dd v2 引用语法**（§6.2①）：原案 `{brand.primary.500}` 是"值引用"（叶子往上引），astryx 的 redirect 是"语义层改写指向分类层"（`--color-error → var(--color-text-red)`，主题改分类层语义层自动跟随）。两者方向互补：**组件/语义 token 引分类色，改主题只动分类层**——建议 .dds 的 token 分层显式区分"分类层（可换肤）→ 语义层（引用分类）→ 组件层（引用语义）"，主题切换只写分类层，比自由引用更收敛。
3. **组件 override targets（合法覆盖键显式枚举）→ 组件原子库**（§6.2②）：原案的组件"变体/状态"声明没有说清覆盖面如何限定；astryx 的 `theme targets`（props/states 合法键枚举 + `{component: { 'variant:info': {...} } }` 覆盖语法 + 可重定向语义 token）给出成熟形态——**组件库 schema 应给合法覆盖键清单，而非自由 CSS**。
4. **Tailwind-token bridge 思想 → .dd 编译器**（§1.2 现状缺口）：.dd 的 tokens 注入 `:root` 与内联 Tailwind JIT **各行其道**（taste"token 外颜色=违例"靠 prompt 自觉）；astryx 用 bridge 让 utilities 默认落 token。建议 .dd 编译器 seed CSS 增 bridge 段把常用 Tailwind utilities 映射到 token（纯生成 CSS，零新依赖）；**需按 vendored Tailwind JIT 版本评估实现形态**（astryx 用 Tailwind v4 `@theme inline`，本仓 JIT 版本能力待核）。
5. **seed→确定性调色板生成 → 方向选择 preset**（§6.4）：原案"确定性 OKLCH 调色板 + 禁模型即兴"；astryx 用 HCT（accent seed → 整组色阶程序化生成，radius base×multiplier 批量生成）——工业级印证"preset 的 palette 应由 seed 程序化生成而非手写五套"，保证 preset 内部一致性与可调性（HCT/OKLCH 等价，任选）。
6. **`@layer` 显式序 → .dd 编译器注入序契约**（§7.1 口径审计呼应）：§7.1 已发现 getSeedCss 与 seed.html ≥5 处数值不一致；astryx 的"reset → base → theme 三层显式 @layer + 导入序即契约"是 CSS 原生的注入序治理形态——.dd 编译器的 tokens/seed/Tailwind 注入顺序可显式化为一层契约，消掉"顺序隐式活在代码里"这一漂移温床。

### 2.4 vibe-tests → evals 扩充（§7.4 / skill-eval）的方法论移植

deepOrca 的评测对象与 astryx 的评测对象**同构**：astryx 评"AGENTS.md/文档能否让 LLM 写对组件代码"，deepOrca 要评"SKILL.md（taste/deep-design/pm-designer-openui）+ openui:prompt 能否让 LLM 写出合规 OpenUI Lang/.dd"。可直接移植的四个形状：

1. **"供给文档质量"一等评测对象**：本方案 §7.4 现在只评"产物对不对"（负例/工具调用断言）；vibe-tests 证明还应评"**改一条 SKILL 纪律后违例率是否真降**"——prompt 级改进获得可量化回归（本仓当前无此度量，prompt 改动只能拍脑袋）。
2. **分层采样 + persona + escape hatch 计数**：21 用例全量贵，分层抽样常态跑；persona（naive/analyst…）模拟不同用户口径；**escape hatch（逃生口用量）是比 pass/fail 更细的信号**（模型没失败但频繁绕开组件库 = 供给文档没把正道讲清）——对应 deepOrca 的"模型没违规但绕开 OpenUI 组件/绕开 taste"信号。
3. **10-turn degradation 探针（turn 0/6/8/10）**：度量长对话下纪律遵守的衰减——直接对应 deepOrca 长会话 compaction 后 taste 漂移问题（有实测价值，比"感觉后期会飘"强）。
4. **对照环境矩阵 + ideals 图像基准 + LLM 视觉评审**：astryx 用"project-astryx vs baseline vs html"证明设计系统的增量价值；deepOrca 可做"taste-on vs taste-off"或"v1 vs v2 SKILL"对照；ideals 截图 + design-judge（LLM 评）给"渲染后视觉判定"一个可复用形态（§6.3 渲染后机检之外的语义级判定）。
   **落点**：`specs/review-ing/skill-eval/design.md`（skill 评测）扩充与 §7.4 evals 扩充共用；执行面 deepOrca 自有 agent 通道（runSubagent/eval runner）即可跑，零新依赖；astryx 的 CI 编排（gh workflow 出截图）本仓可用既有 eval CI 思路承接。

### 2.5 防漂移机制对账（§7.1）

| 本方案计划（§7.1） | astryx 已在跑的形态 | 结论 |
| --- | --- | --- |
| 口径快照测试挂 build（SKILL 组件表/规则数/工具清单断言） | ① GENERATED 标记 + 生成脚本 + manifest drift 测试；② naming.test.ts / doc 有效性测试 / serverSafe 测试；③ STYLEX-CAPS 注入表 + scan.mjs 机验 | **方向被三重印证**；建议优先采纳①：openui:prompt 已是生成制，SKILL.md 组件表条目可升级为同一生成源产出（"文档由代码生成"而非"文档手工同步"） |
| 防漂移快照测试（一次性） | ④ agent bootstrap 规则："每个分支先跑 bootstrap——docs 反映分支真实 API"；doctor 检查 agent docs 存在性与标记 | ④ 是运行期护栏（本仓不适用——无多分支分发问题）；②③ 的"约定即测试"密度值得对标 |

### 2.6 桌面自身 UI 体系（--ui-*）对照

deepOrca 桌面 renderer 的 `--ui-*` CSS 变量体系与 astryx token 体系**同种**（families + 主题作用域 + CSS 自定义属性）。三个观察点（非本轮动作）：

1. 语义→分类重定向与 `@layer` 显式序可作为 `ui.css` + `ui-css/` 拆分后的**层序契约**参考（2500 行标准拆分后，"层序隐式活在 import 顺序里"是同类漂移温床）。
2. 若桌面暗色以双值选择器/双 token 集实现，`light-dark()` 单 token 双态可作简化候选（需核实现有实现形态后再判）。
3. **不引入组件库本体**（见 §3）。

### 2.7 与 CMB 采纳线的关系

astryx 的 agent 语境纪律（`init` 写 AGENTS.md、分支绑定的 bootstrap 规则、`--dense` token 经济、稳定错误码、doctor 门）与 `specs/cmb-adoption` 的"供给侧工程"哲学同族——astryx 是**组件库侧的供给侧工程同类实践**。特别地，vibe-tests 补上了 CMB-6（harness 失败模式分类学）的镜像：**失败不只来自 harness，也来自"供给文档质量"**——"文档对 agent 的供给质量要有度量"可作为 CMB-6 独立对账时的参考系之一（文档级，不扩 CMB spec 范围）。

---

## §3 借鉴清单

### 3.1 吸收候选（10 项，按落点与分期标注）

| # | 吸收项 | 落点（design-systems-advance 对应章节） | 分期 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | vibe-tests 方法论（供给文档质量评测：分层采样 + persona + escape hatch + 10-turn degradation + 对照环境 + ideals/LLM 视觉评审） | §7.4 evals 扩充 + `specs/review-ing/skill-eval` | P2 | **本轮最大单项收益**；零新依赖，自有 agent 通道可跑 |
| 2 | light-dark() 元组单 token 双态 | §6.2① .dds 多主题轻量版 | P2 | 编译期展开；.ddu 独立打开需留降级评估 |
| 3 | token 三层分层（分类→语义→组件）+ 语义→分类单向重定向 | §6.2① tokens.schema 与引用语法 | P0 | 主题切换只写分类层；环引用校验两案一致 |
| 4 | 组件 override targets（合法覆盖键显式枚举 + 变体覆盖语法） | §6.2② 组件原子库变体/状态声明 | P0 | schema 给合法键清单而非自由 CSS |
| 5 | Tailwind-token bridge（utilities 默认落 token） | .dd 编译器 seed CSS（呼应 taste"token 外颜色=违例"的机检化） | P1 | 需按 vendored Tailwind JIT 版本评估；纯生成 CSS 零依赖 |
| 6 | eslint 30 规则清单 → design.lint preset 规则来源（≥8 条直接同族：no-raw-color / no-hover-on-disabled / focus-outline-keyboard-only / no-classname-clobber / no-physical-properties（裁剪）/ no-light-dark-outside-theme / require-base-props（组件原子库）/ i18n 类不适用） | §6.3 design.lint preset | P1 | 思想移植，形态按 defineRule 浅解析（astryx 是 AST 级） |
| 7 | "特定 token 组合 × 主题"对比度专项机检（badge/stone-secondary/syntax-punctuation 模式） | §6.3 渲染后机检 | P1 | 比泛化对比度检查可维护 |
| 8 | theme build 产物化 + `--check` 新鲜度收据 | §6.6 tokens.css 导出 + .dds 主题切换 | P1 | 编译收据（missing/outdated+reason）模式 |
| 9 | seed→确定性调色板/半径生成 | §6.4 方向选择 preset | P1 | preset palette 由 seed 程序化生成，非手写五套 |
| 10 | IME 守护（isComposing + keyCode 229 双信号）作为**审计项**：核对 renderer 输入面（chat composer / 搜索 / 命令面板）是否双信号守护 | 桌面 UI 审计补充（`docs/research/2026-08-19-ui-ux-audit-*` 系）或 CMB 台账新增观察项 | 即刻 | **纯审计，无编码**；astryx 的"谓词 + lint 拒绝包装 hook"过程范例亦值得借鉴（防过度工程） |

次级候选（择机）：稳定错误码 append-only 治理 → correction.ts 纠错码表（append-only 契约 + 码表生成文档）；doctor 式一致性自检门（远期）；文档受众分离 + 文件头 SYNC 协议（本仓 2500 行拆分场景适用）。

### 3.2 验证性印证（不新增动作，方向被强证）

- 生成制文档 + 漂移测试 ↔ §7.1 快照测试计划（openui:prompt 已是生成制——方向正确）；
- capability manifest 自描述 ↔ §7.5 design-as-asset"agent 与产物之间要稳定协议，不要提示词拼 HTML"论断（astryx 用 OpenAPI-for-CLI 兑现了同一论断的组件库版）；
- check-i18n-catalog ↔ 本仓"6 locale 全目录 typecheck 强制"（同纪律不同机制，互为印证）；
- naming.test.ts ↔ 口径审计（"约定即测试"）；
- XLE/XLO 压缩表达式 ↔ OpenUI Lang DSL 路线（第二实现者，双向印证"紧凑行式声明语言"可行）；
- `--dense`/`--detail` token 经济阶梯 ↔ prompt 经济方向（roadmap delta-only）；
- "测约定而不主张约定"（earned by measurement）+ 可机检项全部机检化 ↔ G3"提示词纪律 → 机制保证"的总判断；
- 主题=CSS 自定义属性覆盖、StyleX 无感分发 ↔ 本仓 `--ui-*` 同源方案（技术路线无冲突）。

### 3.3 不引入

| 项 | 理由 |
| --- | --- |
| **组件库本体**（React 19 约束 + StyleX 编译链 + 103 组件迁移成本 + 打包体积） | 桌面 `--ui-*`/ui.css 体系已收敛中且受 2500 行标准治理；引入=renderer 全量重写，收益不成比例；design.* 产物的 OpenUI Lang/.dd 载体与 astryx 物种不同，无替代关系 |
| pnpm 11 / changesets / crowdin / npm 分发与 codemod 晋升链 | 本仓 npm workspaces 已成型、无下游消费者、6 locale 手工目录 typecheck 已强制；治理工程不匹配单仓库桌面产品形态 |
| Storybook / docsite / sandbox 三站 | 无对应基建诉求；docs 站另有 docs/ 与 docs-site/ 现状 |
| charts / vega 包 | `@canary` 未稳定（Meta 自己的图表仍是 CHARTV2 在途）；本仓 token 面板图表已自绘 SVG 零依赖 |
| XLE/XLO 第二套布局 DSL | OpenUI Lang 已占位；双 DSL 增负担 |
| `useImeSafeKeyDown` 式包装 hook（若将来做 IME 审计修复） | astryx 已用 7 调用点逐点核对证明包装即错误——**谓词 + lint 形态优先** |

---

## §4 结论与建议

1. **对 design-systems-advance：是"跨物种的同族参照"，不改变方案骨架**。V3 四原则被逐条印证（契约驱动↔token 分层与 override targets；回环保证↔规则即测试/对比度 CI/doctor 门；中间产物即资产↔无直接对应但未被证伪；轻内核多载体↔预构建 CSS 零插件分发哲学）。
2. **六个章节获得工业级细节补充**：§6.2（机制 2/3/4）、§6.3（候选 6/7）、§6.4（候选 9）、§6.6（候选 8）、§7.1（对账表）、§7.4（§2.4 移植方案）。
3. **最大单项收益是 vibe-tests 方法论**（供给文档质量一等评测）——建议在 skill-eval 扩充或 design-domain evals 设计时回引本文 §2.4。
4. **建议动作**：无需变更 design-systems-advance 主稿；tokens schema 与组件原子库的 P0 设计细化时可回引 §2.3 六机制；IME 审计项可独立提入 ui-ux 审计系或 CMB 台账；物种地图（三物种两轴）可回写 2026-09-01 对比研究的 §3.1 阵营表述（仅记录，不强制）。
5. **消费状态**：⬜ 未消费（纯调研留档，无代码变更）；实现一律以 specs/ 为准。
