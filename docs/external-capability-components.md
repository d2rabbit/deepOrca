# DeepOrca 外部第三方能力组件清单

> 更新日期：2026-08-12  
> 基线分支：`fix/stabilize-data-loss-and-test-suite`
>
> 本文只列出直接提供产品能力、需要从外部获取或在运行时加载的第三方组件，例如 OpenWiki、Open Code Review 和 CodeGraph。Electron、React、TypeScript、ESLint、测试库和常规工具依赖不在范围内。
>
> GitMCP、A2UI 和 activity-frames 是 DeepOrca 本地实现，不需要额外安装；它们仅在本文末尾用于澄清边界。

## 1. 总览

| 组件                  | 主要能力                       | 获取/安装方式                                  | 何时获取                        | 是否随应用完整打包                 |
| --------------------- | ------------------------------ | ---------------------------------------------- | ------------------------------- | ---------------------------------- |
| Open Code Review      | AI 代码审查                    | desktop npm dependency                         | `npm install` / package staging | 是                                 |
| CodeGraph             | 符号索引、调用图、MCP          | desktop npm dependency；旧 vendor/npx fallback | `npm install`                   | 是，npm 路径为主                   |
| OpenUI Lang           | UI 生成和渲染                  | desktop npm dependency                         | `npm install`                   | 是                                 |
| OpenWiki              | 项目 Wiki 生成和更新           | npm install 到 `desktop/vendor`                | desktop build 或手动 vendor     | 是，vendor runtime                 |
| uv                    | Python 工具运行器              | 下载 GitHub Release 预编译二进制               | desktop build 或手动 vendor     | 是，若下载成功                     |
| BrowserSkill / `bsk`  | Chromium 浏览器自动化          | 下载 GitHub Release 预编译二进制               | desktop build 或手动 vendor     | 计划随包，但 runtime wiring 不完整 |
| Granite Embedding 97M | 本地向量嵌入和语义路由         | 从 Hugging Face/mirror 下载模型文件            | desktop build 或手动 vendor     | 是，若下载成功                     |
| Tailwind Browser JIT  | DeepDesign 离线 Tailwind 编译  | 从 unpkg/jsDelivr 下载单文件并内联             | desktop build                   | 内联到 renderer                    |
| Bento Slides          | 演示文稿 HTML runtime/template | 下载 GitHub Release 单文件                     | desktop build 或手动 vendor     | 是，随 core templates              |
| Serena                | 符号导航、语义编辑、重构 MCP   | marker + 首次运行时 `uv tool run`              | build 写 marker，首次使用安装   | 否，实际工具按需下载               |
| CRG                   | 代码风险图谱和影响分析         | marker + 首次运行时 `uv tool run`              | build 写 marker，首次使用安装   | 否，实际工具按需下载               |
| SkillSpector          | Skill/MCP 安全扫描             | marker + GitHub wheel/git，经 uv 安装          | build 写 marker，首次使用安装   | 否，实际工具按需下载               |

## 2. 统一构建与打包模型

桌面能力组件通过三条路径进入应用：

1. **npm capability dependencies**：进入 desktop staging 的 `node_modules`；
2. **`packages/desktop/vendor/` artifacts**：由 Electron Builder 通过 `extraResources` 原样复制到 `Resources/app/vendor/`；
3. **core template assets**：随 `@deeporca/core` 的 `templates/` 一起复制。

```bash
# 安装 npm capability packages
npm install

# 尝试刷新所有 desktop build 所需的第三方能力
npm run desktop:build

# 生成可打包 staging 并执行 Electron Builder
npm run desktop:package
```

`desktop:build` 的 vendoring 是 best-effort：网络失败时尽量保留已有 artifact；若本地也没有 artifact，具体能力可能回退到 npm、npx、系统工具或不可用。打包后的应用不会在启动时自动刷新 vendor 组件。

## 3. npm 安装并随应用打包

### 3.1 Open Code Review / OCR

- **用途**：读取工作区 Git diff，生成结构化 AI 审查意见。
- **来源包**：`@alibaba-group/open-code-review`
- **声明版本**：`^1.8.0`；当前 lockfile/安装版本为 `1.8.0`。
- **安装方式**：

```bash
npm install
```

它是 `@deeporca/desktop` 的正常 dependency，不需要 vendor 脚本。

- **运行入口**：`@alibaba-group/open-code-review/bin/ocr.js`
- **运行方式**：使用 Electron bundled Node，并设置：

```text
ELECTRON_RUN_AS_NODE=1
OCR_NO_UPDATE=1
```

- **打包**：`scripts/package-desktop.js` 把该依赖加入 standalone desktop staging，平台 optional package 随 npm 安装。
- **相关位置**：
  - `packages/desktop/package.json`
  - `packages/desktop/src/main/index.ts`
  - `packages/core/src/actions/review.ts`

### 3.2 CodeGraph

- **用途**：符号索引、定义/引用查询、调用关系和 CodeGraph MCP。
- **来源包**：`@colbymchenry/codegraph`
- **声明版本**：`^1.5.0`；当前 lockfile/安装版本为 `1.5.0`。
- **安装方式**：

```bash
npm install
```

该包通过 platform optional dependencies 提供 Windows、Linux 和 macOS 对应二进制。

- **当前运行解析顺序**：

```text
1. @colbymchenry/codegraph/npm-shim.js
2. packages/desktop/vendor/codegraph 中的旧预编译 binary
3. legacy vendor JavaScript entry
4. npx -y @colbymchenry/codegraph
```

- **MCP 启动方式**：

```bash
codegraph serve --mcp
```

并以当前项目目录作为 `cwd`。

- **旧 vendor 路径**：`scripts/vendor-codegraph.js` 可下载 GitHub Release binary 到：

```text
packages/desktop/vendor/codegraph/<platform>-<arch>/
```

但 `packages/desktop/build.mjs` 已明确使用 npm dependency 为主，不再在正常 build 中运行该脚本。release 校验和 core resolver 仍保留旧 vendor 分支，形成历史兼容路径。

- **后续建议**：可以迁移为“npm package → npx fallback”并删除旧 CodeGraph vendor 机制，但应同步清理 package script、resolver、测试和 release vendor 校验，不能只删 `vendor-codegraph.js`。

### 3.3 OpenUI Lang

- **用途**：结构化 UI 生成、renderer 渲染及 in-process A2UI 工作流。
- **来源包**：

```text
@openuidev/lang-core
@openuidev/react-lang
```

- **声明版本**：分别为 `^0.2.10`、`^0.2.9`。
- **安装方式**：

```bash
npm install
```

- **运行方式**：作为 renderer/core 普通模块使用，不启动外部 binary，也不写入 vendor 目录。

## 4. 下载或安装到 desktop vendor

### 4.1 OpenWiki

- **用途**：初始化项目 Wiki、增量更新、列出和读取 Wiki 页面。
- **来源**：npm package `openwiki`；源项目为 LangChain AI OpenWiki。
- **版本策略**：
  - `OPENWIKI_VERSION` 环境变量优先；
  - 否则查询 npm registry latest；
  - 查询失败时 fallback `0.2.5`。
- **手动安装方式**：

```bash
npm run vendor:openwiki --workspace @deeporca/desktop
```

脚本执行等价于：

```bash
npm install \
  --no-save \
  --no-package-lock \
  --legacy-peer-deps \
  --omit=dev \
  --ignore-scripts \
  openwiki@<version>
```

- **生成结构**：

```text
packages/desktop/vendor/openwiki/
├── dist/cli.js
├── package.json
├── node_modules/
└── .vendored-openwiki-version
```

- **运行方式**：桌面只解析 `vendor/openwiki/dist/cli.js`，并使用 Node 22+ / Electron bundled Node 启动，同时注入项目 LLM credentials 和 `OPENWIKI_MODEL`。
- **fallback 边界**：build 输出中仍有 `npx openwiki` 提示，但实际 desktop Wiki resolver 在 vendor entry 缺失时返回不可用，不可靠地调用外部 npx。
- **打包**：完整 `vendor/openwiki`（包含嵌套 `node_modules`）通过 Electron Builder `extraResources` 复制。
- **当前本地状态**：只发现 `openwiki.staging-5d3e40d2`，没有最终 `openwiki/dist/cli.js`；这可能是中断的 atomic install，当前 checkout 的 OpenWiki runtime 不完整。

### 4.2 uv

- **用途**：为 Serena、CRG 和 SkillSpector 提供隔离 Python/tool 安装与运行环境。
- **来源**：`astral-sh/uv` GitHub Release 预编译 binary。
- **版本策略**：
  - `UV_VERSION` 优先；
  - 否则 GitHub latest；
  - 查询失败时 fallback `0.11.32`。
- **手动安装方式**：

```bash
npm run vendor:uv --workspace @deeporca/desktop
```

- **生成位置**：

```text
packages/desktop/vendor/uv/<platform-target>/
```

- **运行解析**：vendored uv 优先，系统 PATH 中的 `uv`/`uvx` 次之。
- **打包**：若存在则通过 `extraResources` 随应用复制；release staging 会检查当前平台 uv 目录。
- **网络边界**：即使 uv 本身随应用打包，Serena、CRG 和 SkillSpector 首次运行时仍可能通过 uv 联网获取 Python 和工具包。

### 4.3 BrowserSkill / `bsk`

- **用途**：使用真实 Chromium/Chrome 会话执行浏览器自动化。
- **来源**：Tencent BrowserSkill GitHub Release 的预编译 Rust CLI。
- **版本策略**：
  - `BSK_VERSION` 优先；
  - 否则查询 latest CLI release；
  - fallback `0.1.9`。
- **安装方式**：`desktop:build` 会调用 `scripts/vendor-browser-skill.js`。当前 desktop package 没有单独暴露 `vendor:browser-skill` npm script，也可以直接执行：

```bash
node scripts/vendor-browser-skill.js
```

- **生成位置**：

```text
packages/desktop/vendor/browser-skill/
├── bsk          # Unix
├── bsk.exe      # Windows
└── .vendored-bsk-version
```

- **额外前置条件**：配套 Chromium extension。
- **当前问题**：Skill 文档要求 `bsk` 在 PATH 上，但未发现 desktop 自动把 `vendor/browser-skill` 加入 PATH 或通过 resolver 指向该 binary。也就是说 artifact 会被下载/打包，但实际 runtime wiring 仍需补齐或依赖用户自行安装 `bsk`。
- **澄清**：仓库中的浏览器组件是 Tencent BrowserSkill，不是 Python `browser-use` 或 `agent-browser`。

### 4.4 Granite Embedding 97M multilingual R2

- **用途**：本地语义嵌入，供 Skill/Tool 路由和 memory recall 使用。
- **来源模型**：`ibm-granite/granite-embedding-97m-multilingual-r2`
- **版本策略**：默认 tag 为可变的 `main`，也可通过 `GRANITE_MODEL_REPO`、`GRANITE_MODEL_TAG` 覆盖。
- **安装方式**：`desktop:build` 会调用 `scripts/vendor-granite.js`。当前 desktop package 没有单独暴露 npm script，也可以直接执行：

```bash
node scripts/vendor-granite.js
```

- **下载顺序**：

```text
HF_ENDPOINT（若配置）
→ https://hf-mirror.com
→ https://huggingface.co
```

- **生成位置**：

```text
packages/desktop/vendor/granite-embedding/
└── ibm-granite/granite-embedding-97m-multilingual-r2/
    ├── onnx/model_quantized.onnx
    ├── tokenizer.json
    ├── tokenizer_config.json
    ├── special_tokens_map.json
    └── config.json
```

下载的 `model_quint8_avx2.onnx` 会重命名为 `onnx/model_quantized.onnx`。

- **运行方式**：desktop 启动时把模型目录注入 core routing；`@deeporca/embedding` 使用 Transformers.js 和 ONNX Runtime 加载。
- **fallback**：fail-open。模型缺失或加载失败时，路由回退完整候选，memory 可回退非本地 ONNX 策略。
- **当前问题**：默认 tag 不是 immutable revision、没有 checksum、当前 vendor 中未见完整模型、第三方 notices 未登记 Granite，且 build 现有路径检查与实际 target 名称不一致。

### 4.5 Tailwind Browser JIT

- **用途**：DeepDesign / `.dd` 预览中的离线 Tailwind utility 编译。
- **来源**：`@tailwindcss/browser@4`。
- **安装方式**：`desktop:build` 会调用 `scripts/vendor-tailwind.js`，也可以直接执行：

```bash
node scripts/vendor-tailwind.js
```

- **下载地址**：

```text
https://unpkg.com/@tailwindcss/browser@4
https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4
```

- **生成位置**：

```text
packages/desktop/vendor/tailwind/tailwind.js
```

build 随后读取该文件并生成/内联：

```text
packages/desktop/src/generated/tailwind-script.ts
```

- **版本与刷新**：只固定 major version 4，不固定 patch；缓存约 30 天后刷新。
- **fallback**：保留已有文件；完全缺失时生成空 script 并使用 seed CSS/在线 fallback。
- **完整性现状**：没有固定 digest/checksum。

### 4.6 Bento Slides

- **用途**：提供自包含的演示文稿编辑、预览和播放 HTML runtime/template。
- **来源**：`nyblnet/bento` GitHub Release。
- **版本策略**：查询 latest，查询失败 fallback `1.0.15`；当前 tracked marker 为 `1.0.16`。
- **安装方式**：`desktop:build` 会调用 `scripts/vendor-bento.js`，也可以直接执行：

```bash
node scripts/vendor-bento.js
```

- **生成位置**：

```text
packages/core/templates/plugins/work/skills/bento-slides/references/
├── bento-template.bento.html
└── .vendored-bento-version
```

- **运行方式**：Skill 把该自包含 HTML 模板复制到用户输出文件，不启动外部进程。
- **打包**：随 core templates 进入 packaged app，不依赖 desktop vendor extraResources。
- **当前问题**：`build.mjs` 的通用 existence check 指向 desktop vendor，但 Bento 实际写入 core templates；检查路径需要校准。

## 5. 首次使用时通过 uv 安装

### 5.1 Serena

- **用途**：基于 SolidLSP 的符号导航、查找、rename、replace body 和语义编辑 MCP。
- **Python package**：`serena-agent`
- **版本策略**：
  - `SERENA_VERSION` 优先；
  - 否则查询 PyPI latest；
  - fallback `1.6.1`。
- **build 阶段**：`scripts/vendor-serena.js` 只写版本 marker：

```text
packages/desktop/vendor/serena/.vendored-serena-version
```

可直接运行：

```bash
node scripts/vendor-serena.js
```

- **首次运行实际安装/启动**：

```bash
uv tool run \
  --python 3.13 \
  --from serena-agent==<version> \
  serena-agent start-mcp-server \
  --context ide-assistant \
  --project <projectRoot>
```

- **fallback**：vendored uv → system uv/uvx → 不可用。
- **是否离线**：不是。marker 只固定版本，不包含 Serena wheel 或 Python runtime；首次运行仍可能联网。

### 5.2 CRG / Code Review Graph

- **用途**：代码关系图、变更节点、爆炸半径、结构风险和架构分析。
- **Python package**：`code-review-graph`
- **版本策略**：
  - `CRG_VERSION` 优先；
  - 否则查询 PyPI latest；
  - fallback `2.3.7`。
- **build 阶段**：`scripts/vendor-crg.js` 只写 marker：

```text
packages/desktop/vendor/crg/.vendored-crg-version
```

可直接运行：

```bash
node scripts/vendor-crg.js
```

- **首次运行实际安装/启动**：

```bash
uv tool run \
  --from code-review-graph==<version> \
  code-review-graph
```

MCP 模式追加：

```text
serve --tools <analysis-tool-allowlist>
```

- **启用条件**：Session 默认只在项目已有 `.code-review-graph/` 时自动注册 CRG MCP；Action 可以触发 reindex。
- **fallback**：vendored uv → system uv/uvx → 不可用。
- **是否离线**：不是。首次运行可能联网获取 Python 和包。
- **待核对**：代码注释、PyPI 包和 third-party notices 中的上游仓库身份存在不一致，需要在发布前统一。

### 5.3 SkillSpector

- **用途**：Skill/MCP 安全扫描、prompt injection 和供应链风险检查。
- **来源**：NVIDIA SkillSpector GitHub release。
- **默认版本**：`2.5.1`，可通过 `SKILLSPECTOR_VERSION` 覆盖。
- **安全策略**：明确禁止从同名 PyPI package 安装；代码将其视为恶意包。
- **build 阶段**：`scripts/vendor-skillspector.js` 只写 marker：

```text
packages/desktop/vendor/skillspector/.vendored-skillspector-version
```

可直接运行：

```bash
node scripts/vendor-skillspector.js
```

- **首次使用优先安装 GitHub Release wheel**：

```text
skillspector[mcp] @ https://github.com/NVIDIA/SkillSpector/releases/download/v<version>/skillspector-<version>-py3-none-any.whl
```

- **fallback**：

```text
skillspector[mcp] @ git+https://github.com/NVIDIA/SkillSpector.git@v<version>
```

- **运行方式**：

```bash
uv tool run skillspector mcp
```

- **特殊开关**：

```text
DEEPORCA_SKIP_SKILL_PROVISION=1
```

可跳过自动 provision。

- **是否离线**：不是。应用只携带 version marker 和可选 uv，工具环境在用户侧首次使用时创建。

## 6. 不是外部安装组件的内置能力

### 6.1 GitMCP

当前 GitMCP 是 DeepOrca 的本地 TypeScript 实现：

```text
packages/core/src/gitmcp/
```

它编译为本地 stdio MCP server，并将 GitHub repo 文档/代码索引写入：

```text
~/.deeporca/gitmcp/index.db
```

它会访问 GitHub API/公开内容，但不需要安装外部 `git-mcp` package 或启动 GitMCP.io 服务。

### 6.2 A2UI 和 activity-frames

以下都是 core 内置的 in-process MCP server，不需要外部安装：

```text
packages/core/src/mcp/a2ui-mcp.ts
packages/core/src/activity-frames/mcp.ts
```

### 6.3 用户配置的 MCP 示例

文档或 UI preset 中出现的 `@playwright/mcp@latest`、GitHub/filesystem/memory/sequential-thinking MCP 等，是用户可选配置，不是 DeepOrca 默认下载或打包的组件，因此不计入上述供应链清单。

## 7. 当前 checkout 状态与已知不一致

1. `packages/desktop/vendor/` 当前只发现 `openwiki.staging-5d3e40d2`，未发现已完成的 OpenWiki、uv、BrowserSkill、Granite、Tailwind 或 marker 目录。
2. OpenWiki build 提示存在 npx fallback，但 desktop resolver 实际不使用外部 npx。
3. CodeGraph npm package 已是首选，旧 vendor script、resolver fallback 和 release 校验尚未清理。
4. BrowserSkill artifact 会下载并计划打包，但未发现自动 PATH/resolver wiring。
5. Serena、CRG、SkillSpector 只写 marker；真正工具仍在首次使用时下载。
6. Granite 默认跟随可变 `main`、没有 checksum，且未加入 third-party notice manifest。
7. Tailwind 只固定 major 4，没有固定 patch 或 digest。
8. Bento marker 当前为 `1.0.16`，脚本 fallback 仍为 `1.0.15`，build existence check 路径也不匹配实际 target。
9. `scripts/package-desktop.js` 的 release-required validation 只覆盖 CodeGraph、OpenWiki、uv 和 SkillSpector marker，没有覆盖 BrowserSkill、Serena、CRG、Granite、Tailwind 和 Bento。
10. 当前没有活跃组件通过 `git clone` 完整拉取源码；现有流程是 npm install、release archive、模型文件下载、marker-only provision 或运行时 uv 安装。
11. `packages/desktop/vendor/ThirdPartyNotices.txt` 当前缺失；即使重新生成，现有 manifest 也遗漏 Granite。

## 8. 安装命令速查

### 基础 npm capability packages

```bash
npm install
```

安装 Open Code Review、CodeGraph、OpenUI Lang，以及应用常规依赖。

### 当前已暴露的 vendor npm scripts

```bash
npm run vendor:codegraph --workspace @deeporca/desktop
npm run vendor:openwiki --workspace @deeporca/desktop
npm run vendor:uv --workspace @deeporca/desktop
```

其中 CodeGraph vendor 已不是正常 build 主路径。

### 未暴露为 package script 的 vendor installers

```bash
node scripts/vendor-browser-skill.js
node scripts/vendor-granite.js
node scripts/vendor-tailwind.js
node scripts/vendor-bento.js
node scripts/vendor-serena.js
node scripts/vendor-crg.js
node scripts/vendor-skillspector.js
```

### 统一尝试刷新并构建 desktop

```bash
npm run desktop:build
```

### 生成安装包

```bash
npm run desktop:package
```

执行 release packaging 前，应先确认 vendor artifact、marker、third-party notices 和当前平台 runtime 均完整。
