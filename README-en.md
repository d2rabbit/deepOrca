<div align="center">

<p align="center">
  <a href='https://github.com/asdshuaishuai/deepcode-cli'>
    <img src='docs-site/assets/orca-icon.png' width='120' alt="DeepOrca"/>
  </a>
</p>

# DeepOrca

**Next-generation AI coding assistant**

English · [中文](README.md) · [Docs](docs/) · [Changelog](CHANGELOG.md)

<br/>
</div>

---

## 🐋 About DeepOrca

**DeepOrca** is a next-generation AI coding assistant optimized for the `deepseek-v4` model. It ships as an Electron desktop client, built from two packages:

| Package | Description |
|---------|-------------|
| `@deeporca/core` | Core engine: LLM session loop, built-in tools, Skills/MCP extensions, session persistence |
| `@deeporca/desktop` | Electron desktop client: full GUI with Monaco editor, multi-panel layout, and themes |

### 📦 About Deep Code

DeepOrca originated as a fork of [Deep Code](https://github.com/lessweb/deepcode-cli) (`@vegamo/deepcode`) and has since grown into an independent project. We kept Deep Code's excellent core engine architecture (LLM session loop, built-in tools, Skills/MCP extensions, permission control) and extended it substantially — desktop GUI, built-in plugin system, GitMCP module, Monaco Editor integration — while removing the terminal CLI and VSCode extension form factors.

Deep Code is open-sourced under the MIT License. As required by the license, this repository fully preserves the original copyright notice (see [LICENSE](LICENSE)), and we thank the original authors.

## ✨ Highlights

- **Extension system** — Skills (`SKILL.md`-driven), MCP servers, and built-in plugins (browser-skill, open-code-review, git-mcp)
- **Monaco Editor integration** — professional code editing with syntax highlighting
- **GitMCP panel** — index GitHub repositories locally and search docs/code semantically
- **Code review / CodeGraph / Git panels** — review changes, visualize the code graph, and manage source control
- **Multi-theme & i18n** — Aqua / Glass Prism / Punk themes, 6 languages (en / zh / ja / ko / zh-HK / zh-TW)
- **Optimized for DeepSeek** — context caching, thinking mode, and reasoning-effort control

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/asdshuaishuai/deepcode-cli.git
cd deepcode-cli

# Install dependencies
npm install

# Run the desktop client in dev mode
npm run desktop:dev
```

### Configuration

Create `~/.deeporca/settings.json` (an existing `~/.deepcode` config directory is picked up automatically — no migration needed):

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

Environment variables with the `DEEPORCA_` prefix (e.g. `DEEPORCA_API_KEY`) are also supported; legacy `DEEPCODE_` variables keep working as a fallback.

> 📖 See [docs/configuration.md](docs/configuration.md) for the full configuration reference.

## 📚 Documentation

| Doc | Description |
|-----|-------------|
| [docs/architecture.md](docs/architecture.md) | Architecture and core flow |
| [docs/configuration.md](docs/configuration.md) | Configuration reference |
| [docs/mcp.md](docs/mcp.md) | MCP server setup |
| [docs/agent-skills.md](docs/agent-skills.md) | Skills development guide |
| [docs/permission.md](docs/permission.md) | Permission model |

## 🤝 Contributing

```bash
npm install       # install dependencies
npm test          # run core tests
npm run check     # typecheck + lint + format check
npm run build     # build core
npm run desktop:dev
```

## 📄 License

This project is released under the [MIT License](LICENSE).

- DeepOrca is derived from [Deep Code](https://github.com/lessweb/deepcode-cli) (Copyright (c) 2026 lessweb, MIT License).
- In accordance with the MIT License, the original copyright notice and permission notice are preserved in full; when you use, modify, or redistribute this project (or substantial portions of it), you must also keep the copyright and permission notices in [LICENSE](LICENSE).
- The software is provided "as is", without warranty of any kind — see the license text for details.
