# 审查报告：OpenUI 官方组件库迁移四笔提交

- **审查范围**：`672ebd5..55f68be`（feat/modern-ui-redesign）
  - `5ec3d52` fix(desktop): 补齐 openui.warningSummary 六语言词条
  - `f2824e0` chore(deps): 对齐 @openuidev 三件套并引入 react-ui 0.13.10
  - `7cdff77` fix(desktop): legacy Button 的 Action 计划改走 triggerAction 第三参
  - `55f68be` feat(core,desktop): 交互原型切换官方 openuiLibrary + 单应用交互契约
- **审查方式**：code-bug-analyzer 高级并行模式——静态 Bug / 安全审计 / 逻辑正确性 / 代码质量四维并行扫描；全部发现对照已安装 dist（`@openuidev/lang-core@0.2.17`、`react-lang@0.2.15`、`react-ui@0.13.10`）与当前源码复核，HIGH 项经二次亲验（官方 CSS/组件源码逐行确认）。
- **结论**：**无 Critical**；2 High、4 Medium、若干 Low。交互契约主线（三参 triggerAction、$page 导航、表单快照、提示词生成、打包、测试）经四维验证全部成立。

---

## 🔴 HIGH-1 主题桥把主按钮文字染成与底色同色（隐形标签）

- **位置**：`packages/desktop/src/renderer/ui-css/openui-bridge.css:50,67`
- **证据**（官方 `styles/index.css` 亲验）：
  ```css
  .openui-button-base-primary {
    background-color: var(--openui-interactive-accent-default);
    color: var(--openui-text-accent-primary); ...
  }
  ```
  官方语义中 `--openui-text-accent-primary` 是"accent 填充之上的文字"（明暗两套默认均近白色）；桥接错映射为 `var(--ui-accent)`，与 `--openui-interactive-accent-default: var(--ui-accent)` 同色 → **蓝底蓝字**。
- **后果**：主按钮（画布最高频组件）、复选框指示器、日期选择器选中日的文字不可见。
- **修复**：
  ```css
  --openui-text-accent-primary: var(--ui-text-on-accent);
  --openui-text-accent-secondary: color-mix(in srgb, var(--ui-text-on-accent) 50%, transparent);
  --openui-text-accent-tertiary: color-mix(in srgb, var(--ui-text-on-accent) 20%, transparent);
  ```

## 🔴 HIGH-2 样式表加载失败回退注入 Aqua 主题文件 → 全应用静默换肤

- **位置**：`packages/desktop/src/renderer/main.tsx:53-62`（调用点 84-86）
- **问题**：`injectStylesheet` 的 onerror 对任何失败链接注入 `./styles.css`——那是 Aqua 主题令牌文件，不是通用兜底。若 build 的 openui CSS 拷贝降级（`build.mjs` 仅 warn），三个 openui 链接 404 → 主题链接之后追加 Aqua 令牌（最多 3 份重复），级联在后赢 → **整窗（含原型弹窗）静默变成 Aqua**，默认主题为 line 时等于覆盖用户主题；与 build 告警"画布无样式"的预期完全不符。
- **修复**：仅主题链接（`THEME_LINK_ID`）走 styles.css 回退；其余本地表失败即放弃（应用壳由 ui.css 保证，画布无样式是 build warn 已预期的降级）。

## 🟡 MEDIUM-1 库路由启发式失准 + 裸字符串 action 崩溃（合并一组）

- **位置**：`packages/desktop/src/renderer/openui/OpenuiRenderer.tsx:33`
- **漏判**：仅用共享名（Stack/Card/Button/TextContent）的旧套件路由到官方库 → arity 冲突（legacy `Card(…, "标题")` 撞官方 `variant` 枚举；legacy `"ghost"` 无对应；`Stack(…, "12px")` 撞 gap 枚举）→ 红墙 + 一轮自愈。
- **最坏子例**：legacy `Button("Sign In", "submit:login")` 在官方 schema 下解析干净（action 为 ZodAny），点击时官方 Button 把字符串传 `triggerAction` 第三参 → react-lang `"steps" in action` 对字符串抛 `TypeError` → **静默死按钮**（无红墙、无 ActionEvent、无自愈输入）。
- **误判**：字符串字面量/UI 文案里的 `Row(`/`Column(`（含 `data.Row(`、CodeBlock 的 `codeString`）会把整个官方原型路由去 legacy → 全量 unknown-component。
- **修复**：① 追加官方专属名检测（`Table|Tabs|Modal|Form|Input|TextArea|Select|Col|CardHeader|Buttons|FormControl|Callout|Tag|Separator|CodeBlock|Steps` 出现即官方优先）；② 生成提示词加硬规则「button 的 action 必须是 `Action([...])` 表达式，禁止裸字符串」；③ 中期把 authoring library 记入套件元数据，正则仅兜底。

## 🟡 MEDIUM-2 官方 CSS 重复注入（~248KB/窗 死重）

- **位置**：`packages/desktop/build.mjs:281-283` + `main.tsx:84-86`
- **证据**：sha1 比对——`layered/styles/index.css` 与 `components/index.css` 字节等价（仅 @layer 包裹，级联永远赢不了未分层规则）；`styles/openui-defaults.css`（21.6KB）是 components/index.css（226KB，内嵌 defaults）的前缀。
- **后果**：`openui-styles.css` 与 `openui-defaults.css` 均为死重，随安装包发布、每窗解析。
- **修复**：只拷贝 + 注入 `components/index.css` 一份；`build.mjs` 三次 `cp` 共用单 try/catch 导致首个失败跳过后续（顺序依赖），改逐文件独立 try/catch。

## 🟡 MEDIUM-3 build 漂移守卫文案指向错误源头

- **位置**：`packages/desktop/build.mjs:318-319,348`
- **问题**：仍称组件表"由 library-schema.ts 生成、与 library-schema.ts 漂移"；实际源头已切官方 `openuiLibrary.prompt()`（`scripts/generate-openui-prompt.mjs`）。漂移失败时开发者会改错文件。
- **修复**：文案改为指向官方 openuiLibrary / 生成提示词。

## 🟡 MEDIUM-4 规格文档与实现矛盾未备注

- **位置**：`specs/design-systems-advance/design.md:63,206`
- **问题**：规格钉死"11 组件 / 不改语言、不换渲染器、schema 保持不变"，本次迁移整体替换为官方 60+ 组件库，无备注。
- **修复**：补一行 superseded 备注（"2026-09 起由官方 openuiLibrary 接管，见 issues 本篇"）。

---

## 🟢 LOW（汇总）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| L1 | `library-schema.ts:1-14`、`library.tsx:1-9` | 头注仍自称"single source of truth / 改 schema 必须重生成 SKILL.md"，已不实；`actionSchema` 的 describe 改写已是 prompt 死代码 | 两文件头加 LEGACY 说明（仅回退旧套件；SKILL.md 契约来自官方库） |
| L2 | `pm-designer-openui/SKILL.md:472` | `Tag("Admin", undefined, "sm", "info")` 教了非法字面量（`undefined` 解析为未解析标识符，恰好无害但属坏示范） | 改 `Tag("Admin", "sm", "info")` |
| L3 | `openui-bridge.css:29` | `--openui-overlay` 桥到不透明表面 → ImageGallery 灯箱背景变实心墙 | 改半透明黑 scrim（`color-mix(in srgb, #000 60%, transparent)`） |
| L4 | `openui-bridge.css` | purple/pink 令牌未桥，跟随 OS `prefers-color-scheme` 而非应用 `[data-appearance]`（OS 亮 + 应用暗时 Tag 紫粉色不跟随） | 补派生映射或接受 |
| L5 | `prototype.ts:541`、`a2ui-mcp.ts:1101-1103`、`design.ts:565,167-171` | 交互契约句子三处重复（两处逐字相同、具现化段措辞漂移） | core 提取共享常量 |
| L6 | `docs/builtin-inventory.md:271,306`、`docs/pre-production-capability-scan.md:50` | 技能清单陈旧（缺 vendored openui、仍称"自研"） | 文档同步 |
| L7 | `packages/desktop/package.json:47` + CI | lang-core 0.2.17 新增 install 遥测（PostHog/CloudFront，假名，`OPENUI_TELEMETRY_DISABLED=1`/`DO_NOT_TRACK=1` 可关）——CI 六条矩阵与开发机均未设 | CI env + 开发文档 |
| L8 | `templates/plugins/design/skills/openui/SKILL.md` | vendored 官方技能未禁隐式调用（每次会话都是匹配候选）且含 `npx @openuidev/cli@latest` 未钉版本 | frontmatter 加 `metadata: allow-implicit-invocation: false`（机制已核实），README 记为本地偏差 |
| L9 | `main.tsx:5` + `devtools-guard.ts` | dev 期 devtools CDN 远程代码路径依赖守卫 + 首位导入；生产路径已死（NODE_ENV define DCE） | 保持现状；可加守卫位置测试 |
| L10 | `i18n/locales/en.ts:1762` | warningSummary 英文文案内嵌中文按钮名「修复此项」——根因是修复按钮标签本身未走 i18n（672ebd5 之前既有） | 后续统一本地化按钮标签 |
| L11 | `generate-openui-prompt.mjs:15` | "pinned" 措辞 vs 实为 caret + lockfile 对齐 | 措辞修正 |
| L12 | `openui-prompt.test.ts:26,47-48` | 对上游文案的精确钉死会在上游 minor 升级时失败（判定为故意金丝雀） | 接受；升级时随漂移守卫一起改 |

## ⚠️ 测试语义注记

- `bindings: true`/`toolCalls: true` 在传 `tools` 时本就默认 true——现有测试钉的是**生成输出**（`$varName`、`@Set`、`Available Tools`、`design.readWiki`）而非开关本身；保留显式传参作自文档化。
- 官方库交互测试走的是上游 Button；`library.tsx` 的 onClick 回归仅由 legacy 测试变异覆盖（可接受配对，中期可补第三用例直挂 legacy 库渲染官方形态代码）。

## ✅ 四维验证干净的关键项

- Button 三参修复正确，legacy 测试变异覆盖（回退第一参即失败，已实测）；官方 genui-lib 的 Button 自身正确调三参。
- `DESIGNER_EXAMPLE` 与 SKILL.md 登录/仪表盘示例对官方 schema 解析零错误（`$page` 入状态声明）。
- `triggerAction(label, undefined)` → `getFormPayload(undefined)` 返回**全量快照**——PrototypePanel 表单收集不受影响。
- 生成器：trim 标记 `## Syntax Rules` 在 0.2.17 仍在；spread 顺序正确（显式键覆盖官方）；7 个 `design.*` 工具名与 tool-provider 完全一致。
- CSS：注入顺序确定性成立（appendChild 同步、Promise.all 按数组序）、失败不 reject 不阻塞 bootstrap；桥接 79 个 `--openui-*` 令牌名零拼写、全部 `--ui-*` 引用存在；官方三份 CSS 零 `url()` 远程引用。
- devtools 守卫：Symbol 预置语义正确；main.tsx 首位导入成立；生产构建 NODE_ENV define 直接 DCE 掉挂载分支。
- 安全：三包零默认运行时网络调用（observability 零端点零开关；genui-lib 71 个 dist 文件零网络原语；`ai` peer 可选未安装）；工具描述纯静态无注入面；vendored 技能内容自带凭据卫生与反注入护栏；测试/词条无凭据字面量。
- 四笔提交均符合 Conventional Commits；`npm run check` 全绿；桌面全量测试 581 过 / 0 失败。

## 建议修复顺序

1. HIGH-1（bridge 两行）+ HIGH-2（main.tsx 回退条件）——即时修复。
2. MEDIUM-1 路由启发式 + Action 硬规则（防死按钮类）。
3. MEDIUM-2 CSS 去重 + 逐文件拷贝；MEDIUM-3 build 文案；MEDIUM-4 规格备注；L1/L2。
4. 其余 Low / 文档批（含 CI 遥测 env、vendored 技能 frontmatter）。
