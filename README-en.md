<div align="center">

<p align="center">
  <a href="https://github.com/d2rabbit/deepOrca">
    <img src="docs-site/assets/orca-icon.png" width="120" alt="DeepOrca"/>
  </a>
</p>

# DeepOrca

**Prototype · Design · Code — the AI Studio**

English · [中文](README.md) · [Docs](docs/) · [Changelog](CHANGELOG.md)

<br/>
</div>

---

## 🐋 About DeepOrca

**DeepOrca** is an AI-powered creation Studio. Three core capabilities — **Prototype Design**, **UI Design**, and **Intelligent Coding** — work independently or in combination. Whether you want to quickly build an interactive prototype, generate beautiful UI designs, or dive straight into code, everything lives in one desktop app. Optimized for `deepseek-v4`, delivered as an Electron desktop application.

### 🎯 Three Core Capabilities

| Capability       | Description                                                                                                                                        | Technology                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **🎯 Prototype** | Describe requirements in natural language; AI generates interactive prototypes (forms/kanban/multi-page) with bidirectional interaction validation | A2UI protocol + OpenUI Lang + 7 templates |
| **🎨 UI Design** | Generate self-contained HTML designs with 3 design systems, 14 UI styles, Tailwind built-in — deliverable standalone                               | DeepDesign `.dd` format                   |
| **💻 Code**      | DeepSeek-powered conversational coding: 7 built-in tools, MCP for infinite extensibility, Monaco editor, Git integration                           | Core Engine + MCP + Monaco                |

Each capability works standalone. Use them independently or combine them — from prototype validation to design mockups to code implementation, flow as needed.

The repository contains four npm workspaces:

| Package               | Description                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `@deeporca/core`      | Engine: LLM session loop, seven built-in tools, Skills/MCP, Actions, and session persistence |
| `@deeporca/desktop`   | Electron main/preload/renderer application with Monaco, panels, and themes                   |
| `@deeporca/embedding` | Local IBM Granite embedding runtime for semantic routing and retrieval                       |
| `@deeporca/memory`    | In-process L0-L3 memory pipeline and vector retrieval                                        |

### 📦 About Deep Code

DeepOrca originated as a fork of [Deep Code](https://github.com/lessweb/deepcode-cli) (`@vegamo/deepcode`) and has since become an independent project. It retains Deep Code's core engine architecture—LLM sessions, built-in tools, Skills/MCP extensions, and permission control—while adding the desktop GUI, the Actions capability layer, local memory and embeddings, bundled extensions, GitMCP, and Monaco Editor. The terminal CLI and VSCode extension form factors were removed.

Deep Code is released under the MIT License. This repository preserves its original copyright notice as required; see [LICENSE](LICENSE).

In addition, DeepOrca's LLM session robustness layer (mutually-exclusive usage/cache accounting, automatic compact-and-retry on context overflow, and the stream idle watchdog) borrows its design from [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) (MIT License) — design adoption only, no code; see the [CHANGELOG acknowledgements](CHANGELOG.md#致谢--acknowledgements).

---

## ✨ Core Features

### 🧩 Extensions and capabilities

DeepOrca supports three extension sources and uses Actions to provide a common execution layer for selected capabilities:

| Type                               | Description                                                    | Management                      |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| **Skills**                         | `SKILL.md`-driven Agent capabilities                           | Place under `.deeporca/skills/` |
| **MCP servers**                    | External services connected through Model Context Protocol     | Configure in `settings.json`    |
| **Bundled extensions and Actions** | Skills, services, and composed workflows shipped with DeepOrca | Loaded by the desktop host      |

Examples include browser automation, Open Code Review, GitMCP, CodeGraph, OpenWiki, CRG, Serena, and design/knowledge Skills. See the [built-in inventory](docs/builtin-inventory.md) for the full list.

### ⚡ Actions: define once, invoke across surfaces

`defineAction` and `ActionRegistry` turn a project capability into a composable Action. A registered Action can be:

- exposed to the Agent as an LLM function tool;
- invoked through typed desktop IPC and UI;
- composed in core through `ActionRegistry.execute()`;
- observed through shared progress events and structured results; the core API also supports cancellation.

The built-in Actions cover diagnostics, OCR/CRG code review, CodeGraph/OpenWiki indexing, `index.build-all`, and `arch-scan`. Advanced users can open **Settings → Actions** to inspect registered capabilities, run parameterless Actions, and view progress and raw results.

```ts
import { ActionRegistry, defineAction } from "@deeporca/core";

const registry = new ActionRegistry({ projectRoot });

defineAction(
  registry,
  {
    id: "example.greet",
    description: "Return a greeting.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    },
  },
  async (input: { name?: string }, ctx) => {
    ctx.emit({ message: "Greeting", percent: 50 });
    return { message: `Hello, ${input.name ?? "world"}` };
  }
);

const run = registry.execute("example.greet", { name: "DeepOrca" });
run.onProgress(console.log);
const output = await run.result;
```

> **Current boundaries:** Actions are integrated with LLM tools and desktop IPC/UI. An external MCP Action Server, HTTP/CLI bindings, generated parameter forms, desktop cancellation, and fine-grained Action permissions are still planned. Runtime parameter-schema validation is currently shallow, so Action implementations should validate detailed constraints. See the [defineAction design](specs/define-action/design.md) for architecture and migration notes.

### 🎨 Desktop highlights

- **Modern canvas layout** — a floating function island, rounded work card, and pill task tabs replace IDE-style pane tiling; 6 themes (Aqua / Metro / Glass / Fusion / Line / Orca) × light & dark
- **Knowledge Center** — arch maps painted on a dotted canvas (8-color node ramp, dashed subgraph frames, fit-to-width that scales up), Wiki with full document typography, and a drillable 3-column symbol graph
- **Closed-loop flows** — a settled knowledge build surfaces a "view / quote" suggestion bar in the chat; any Wiki page quotes into a question in one click; review findings can be "asked in chat" or one-click-fixed; prototypes iterate inside the preview
- **Monaco Editor** — professional editing with syntax highlighting and completion
- **Actions panel** — inspect registered capabilities, run parameterless Actions, and view shared progress and structured results
- **GitMCP panel** — index GitHub repositories locally and search docs/code semantically
- **Code review panel** — review uncommitted workspace changes with structured OCR findings and optional CRG structural-risk enrichment
- **Index panel** — orchestrate CodeGraph, OpenWiki, and arch-scan with per-stage progress
- **Source control panel** — stage, commit, diff, and branch operations
- **i18n** — en / zh / ja / ko / zh-HK / zh-TW

### 🧠 Local embeddings, memory, and semantic routing

- **Granite 97M embeddings** — IBM Granite Embedding 97M multilingual R2 (384 dimensions, 200+ languages), running locally with transformers.js and onnxruntime-node; the model is vendored at build time
- **Memory retrieval** — `@deeporca/memory` provides an in-process L0-L3 pipeline with a sqlite-vec vector backend
- **Skill/tool routing** — embedding recall shortlists Skills and trims MCP tools at server granularity
- **Compositional routing (SkillWeaver)** — query decomposition, multi-Skill recall, compatibility planning, and DAG composition, inspired by [arxiv 2606.18051](https://arxiv.org/abs/2606.18051)
- Routing is **fail-open**: unavailable models or routing errors fall back to the full candidate set instead of interrupting a session

### 🏗️ One-click workspace indexing

`index.build-all` runs the workspace index stages in order:

| Stage           | Tool          | Layer         | Question answered                               |
| --------------- | ------------- | ------------- | ----------------------------------------------- |
| 1. Index        | **CodeGraph** | Symbol        | Where is this symbol, and who calls it?         |
| 2. Wiki         | **OpenWiki**  | Documentation | What does the project documentation say?        |
| 3. Architecture | **arch-scan** | Architecture  | What is the overall architecture and data flow? |

An initial build runs all three stages; **Update All** refreshes CodeGraph and OpenWiki only. Each stage reports success, skipped, or error independently, so a partial failure does not hide other results. `arch-scan` applies a 12-perspective recursive exploration method.

**After the build, knowledge connects to the conversation**: a successful build pops a "Wiki updated · N pages" bar over the composer (view / quote into a question); any Wiki page in the Knowledge Center quotes into the chat with one `@`-mention click; the symbol graph's color-coded columns (callers / focus / callees) drill down on click. End-to-end walkthroughs live in the [developer use cases](docs/use-cases_en.md).

### 🚀 Optimized for DeepSeek

- Tuned specifically for DeepSeek models
- Uses [context caching](https://api-docs.deepseek.com/guides/kv_cache) to reduce cost
- **Cache-first prompt ordering** keeps stable system content at the prefix and moves date/model data to transient tail messages
- Native [thinking-mode](https://api-docs.deepseek.com/guides/thinking_mode) and reasoning-effort controls

---

## 📊 Feature Status

| Area               | Capability                                                    | Status |
| ------------------ | ------------------------------------------------------------- | ------ |
| Core engine        | LLM session loop, seven built-in tools, compaction            | ✅     |
| Actions            | ActionRegistry, LLM tools, desktop IPC/UI, composed workflows | 🧪     |
| Desktop            | Electron GUI, panels, themes                                  | ✅     |
| Extensions         | Skills, MCP, and bundled extensions                           | ✅     |
| Local intelligence | Granite embeddings, L0-L3 memory, semantic routing            | ✅     |
| Editor             | Monaco Editor integration                                     | ✅     |
| Workspace indexing | CodeGraph, OpenWiki, and arch-scan                            | ✅     |
| Code review        | Open Code Review with optional CRG enrichment                 | ✅     |
| GitMCP             | Local GitMCP service and repository panel                     | ✅     |
| Browser automation | Bundled browser Skill                                         | ✅     |
| Source control     | Stage, commit, diff, and branch panel                         | ✅     |
| Permissions        | Fine-grained scopes for built-in tools                        | ✅     |
| Persistence        | Session restore, archive, and export                          | ✅     |
| Web search         | Built-in WebSearch tool                                       | ✅     |
| Multimodal input   | Paste or drag images into a session                           | ✅     |

> 🧪 The Actions registry, LLM/IPC integration, and desktop browser are available now; additional transports and permission integration are still evolving.

---

## 🗺️ Roadmap

Near-term work includes external MCP/HTTP/CLI Action surfaces, generated Action parameter forms, finer-grained Action permissions, a remote plugin center, custom commands, immersive project graphs/Wiki experiences, and AI-assisted design workflows.

Major integrated open-source capabilities include Flutter/Dart Skills, OpenWiki, CodeGraph, and Code Review Graph (CRG). Serena, OpenCLI, CLI-Anything, Open Design, and related projects remain under integration or evaluation.

See the full [feature roadmap](docs/features/feature-roadmap.md) and [research reports](docs/research/). Roadmap and design documents may describe goals that have not shipped yet; use the implementation and status notes on this page as the current baseline.

---

## 🚀 Quick Start

> Requires Node.js 22+ and npm 10.9.4. On Windows, the core bash tool also requires Git Bash.

```bash
# Clone and install
git clone https://github.com/d2rabbit/deepOrca.git
cd deepOrca
npm install

# Run the desktop client in development mode
npm run desktop:dev
```

### Configuration

Create `~/.deeporca/settings.json`. If `~/.deepcode` already exists, DeepOrca uses it as a compatibility fallback without requiring migration.

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-..."
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

Environment variables with the `DEEPORCA_` prefix, such as `DEEPORCA_API_KEY`, are also supported. Legacy `DEEPCODE_` variables remain a fallback. See the [configuration reference](docs/configuration_en.md).

### Desktop commands

```bash
npm run desktop:dev    # development mode
npm run desktop:build  # build the desktop app
npm run desktop:start  # build and run
```

---

## 📚 Documentation

| Document                                                             | Description                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| [CHANGELOG.md](CHANGELOG.md)                                         | Release notes                                             |
| [docs/quickstart_en.md](docs/quickstart_en.md)                       | Quick start                                               |
| [docs/use-cases_en.md](docs/use-cases_en.md)                         | Developer use cases (end-to-end workflows)                |
| [docs/architecture_en.md](docs/architecture_en.md)                   | Architecture and core flow                                |
| [docs/configuration_en.md](docs/configuration_en.md)                 | Configuration reference                                   |
| [docs/mcp_en.md](docs/mcp_en.md)                                     | MCP server setup                                          |
| [docs/agent-skills_en.md](docs/agent-skills_en.md)                   | Skills development guide                                  |
| [docs/permission_en.md](docs/permission_en.md)                       | Permission model                                          |
| [docs/session-persistence_en.md](docs/session-persistence_en.md)     | Session persistence                                       |
| [docs/builtin-inventory.md](docs/builtin-inventory.md)               | Bundled Skills, MCP servers, and tools                    |
| [specs/define-action/design.md](specs/define-action/design.md)       | Actions/defineAction design and migration notes (Chinese) |
| [docs/features/feature-roadmap.md](docs/features/feature-roadmap.md) | Feature roadmap (Chinese)                                 |
| [docs/research/](docs/research/)                                     | Technical research                                        |

---

## 🤝 Contributing and Verification

```bash
# Build, typecheck, lint, and verify formatting
npm run check

# Run all workspace tests
npm test

# Start desktop development
npm run desktop:dev
```

Focused Actions tests:

```bash
node packages/core/src/tests/run-tests.mjs packages/core/src/tests/actions.test.ts
node packages/core/src/tests/run-tests.mjs packages/core/src/tests/phase-actions.test.ts
node packages/desktop/src/tests/run-tests.mjs packages/desktop/src/tests/action-ipc.test.ts
```

Run `npm run format` before `npm run check && npm test`. Contributions use Conventional Commits such as `feat:`, `fix:`, and `docs:`.

---

## 📞 Help

- **Issues:** https://github.com/d2rabbit/deepOrca/issues
- **Documentation:** [docs/](docs/)

---

## 🙏 Open-Source Acknowledgements

DeepOrca builds on these open-source projects. The complete list — including attribution and full license texts for everything shipped inside the installer — is generated at build time as `packages/desktop/vendor/ThirdPartyNotices.txt` (maintained by [scripts/vendor-notice.js](scripts/vendor-notice.js)). License compliance across the entire dependency tree is enforced by `npm run license:check` ([scripts/check-licenses.js](scripts/check-licenses.js)) as part of `npm run check`.

| Project                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Role                                                                                     | License                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Deep Code](https://github.com/lessweb/deepcode-cli)                                                                                                                                                                                                                                                                                                                                                                                                                                    | Upstream project DeepOrca is derived from                                                | MIT                                                        |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)                                                                                                                                                                                                                                                                                                                                                                                                                     | Design reference for the LLM session robustness layer (no code used)                     | MIT                                                        |
| [TencentDB Agent Memory (TDAI Core)](https://github.com/TencentCloud/TencentDB-Agent-Memory)                                                                                                                                                                                                                                                                                                                                                                                            | L0–L3 memory pipeline (full fork under `packages/memory/src/tdai/`, see NOTICE.md there) | MIT                                                        |
| [Electron](https://github.com/electron/electron)                                                                                                                                                                                                                                                                                                                                                                                                                                        | Desktop runtime                                                                          | MIT                                                        |
| [Monaco Editor](https://github.com/microsoft/monaco-editor)                                                                                                                                                                                                                                                                                                                                                                                                                             | Code editor                                                                              | MIT                                                        |
| [OpenAI Node SDK](https://github.com/openai/openai-node)                                                                                                                                                                                                                                                                                                                                                                                                                                | LLM API client                                                                           | Apache-2.0                                                 |
| [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk)                                                                                                                                                                                                                                                                                                                                                                                                    | MCP tool-extension protocol                                                              | MIT                                                        |
| [transformers.js](https://github.com/huggingface/transformers.js) + [ONNX Runtime](https://github.com/microsoft/onnxruntime)                                                                                                                                                                                                                                                                                                                                                            | Local embedding inference                                                                | Apache-2.0 / MIT                                           |
| [IBM Granite Embedding 97M R2](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2)                                                                                                                                                                                                                                                                                                                                                                                | Embedding model weights for semantic routing                                             | Apache-2.0                                                 |
| [CodeGraph](https://github.com/colbymchenry/codegraph) · [OpenWiki](https://github.com/langchain-ai/openwiki) · [CRG](https://github.com/tirth8205/code-review-graph) · [Serena](https://github.com/oraios/serena) · [SkillSpector](https://github.com/NVIDIA/SkillSpector) · [BrowserSkill](https://github.com/Tencent/BrowserSkill) · [uv](https://github.com/astral-sh/uv) · [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) · [Bento](https://github.com/nyblnet/bento) | Capability components vendored with the product                                          | MIT / Apache-2.0 (fonts embedded in Bento are SIL OFL 1.1) |
| [sharp](https://github.com/lovell/sharp) + [libvips](https://github.com/libvips/libvips)                                                                                                                                                                                                                                                                                                                                                                                                | Image processing for transformers.js (DeepOrca uses text embeddings only)                | Apache-2.0 / **LGPL-3.0-or-later**                         |

**About libvips (LGPL-3.0):** libvips is a standalone prebuilt native library dynamically loaded by sharp. It is distributed **unmodified and user-replaceable** (dynamic linking, asar disabled), so it creates no copyleft obligation for DeepOrca, which remains MIT-licensed and commercially usable. As required by LGPL-3.0, `ThirdPartyNotices.txt` ships its notice, the full LGPL-3.0 and GPL-3.0 texts, and a pointer to the corresponding source.

All other npm dependencies are permissively licensed (MIT/ISC/BSD/Apache-2.0, etc.); there are no copyleft or commercially restrictive licenses (GPL/AGPL/SSPL/Commons Clause/BUSL) anywhere in the tree.

---

## 📄 License

This project is released under the [MIT License](LICENSE).

- DeepOrca is derived from [Deep Code](https://github.com/lessweb/deepcode-cli) (Copyright (c) 2026 lessweb, MIT License).
- The design of the LLM session robustness layer is informed by [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (deepseek-ai, MIT License) — design reference only, no code used.
- The original copyright and permission notices are preserved. They must remain when using, modifying, or redistributing this project or substantial portions of it.
- The software is provided “as is,” without warranty of any kind; see the full license text.

---

## 🌟 Support

If DeepOrca is useful to you, consider starring the repository, reporting bugs or feature ideas, sharing it with others, or contributing code and documentation.
