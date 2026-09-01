---
type: desktop
title: Plugin System
description: Plugin manager (skill search/docs/MCP add/remove), built-in plugin templates (8 packages), skill discovery priority, and plugin center UI.
tags: [plugins, skills, mcp, discovery]
---

# Plugin System

The plugin concept runs through three layers: core handles skill discovery/loading and built-in plugin documentation injection ([Architecture/Prompt System](../architecture/prompt-system.md)), desktop provides the management surface (`plugin-manager.ts`, `plugin-mcp-view.ts`, plugin center UI).

## PluginManager (`main/plugin-manager.ts`)

- **Skill search/refresh**: `searchSkills(query, sessionId)`, `refreshSkills` — scans skill roots and matches; reads skill docs (selects the `*_en` twin by locale).
- **MCP server add/remove**: `upsertMcpServer(name, command, args, env)`, `removeMcpServer` (persisted via `mcp-store.ts` to settings.mcpServers).
- **Built-in plugin enumeration**: `listBuiltinPlugins` / `readBuiltinDoc` / `listBuiltinGroups` — reads from core's `templates/plugins/` (8 plugin packages) and presents them by group (browser/code/design/knowledge/memory/meta-skills/vision/work).

## Skill Discovery Priority (core `session.ts`)

```text
./.deeporca/skills/（或 ./.deepcode/skills/）
→ ./.agents/skills/
→ ~/.deeporca/skills/（或 ~/.deepcode/skills/）
→ ~/.agents/skills/
→ bundled（templates/skills/）
```

- Every skill directory must have `SKILL.md` (YAML frontmatter: `name`, `description`).
- Auto-matching uses the model itself: candidate skill names + descriptions are sent to the LLM, which returns the matching name (JSON).
- `karpathy-guidelines` is injected by default; bundled skills: `deeporca-self-refer`, `skill-digester`, `skill-writer`.
- Plugin skill root: `templates/plugins/<group>/skills/` (each plugin package can carry skills).

## Built-in Plugin Templates (`packages/core/templates/plugins/`)

8 plugin package directories, each containing `skill.plugin.md` + `skills/` (skills) + optional `plugins/` (MCP or CLI plugin declarations) + `evals/` ([skill-evals](skill-evals.md) datasets):

| Package | Capability domain |
| --- | --- |
| `browser` | Browser automation (BrowserSkill bsk CLI, login state) |
| `code` | Coding domain: review/index/CRG/skill safety (skill-spector) |
| `design` | DeepDesign/PM-Design: dembrandt, design audit, A2UI |
| `knowledge` | CodeGraph/OpenWiki/knowledge indexing |
| `memory` | Memory domain (runner tools, recall) |
| `meta-skills` | Meta-skills (skill-weaver/skill-digester class) |
| `vision` | Vision model MCP |
| `work` | Workflow domain (GitMCP, task tree) |

> Note: `docs/builtin-inventory.md` is a historical snapshot from 2026-08-03 (183 skills + 10 MCP + 4 CLI); mobile/desktop development domain components were temporarily taken offline in their entirety in f680c14, **the current source of truth is `templates/plugins/`**.

## Plugin Center UI

- `PluginDetail.tsx` (23KB): group browsing, skill doc reading (zh/en), MCP configuration.
- `PluginMcpPanel.tsx`: MCP server status/start-stop.
- `ActionsPanel.tsx`: view/run registered Actions.

## Focused Tests

- `plugin-grouping.test.ts` (core): built-in plugin grouping and documentation consistency.
- `prefix-consistency.test.ts` (core): skill/plugin naming prefix consistency.

## Related Pages

- [Architecture/Prompt System](../architecture/prompt-system.md) (skill injection)
- [skill-evals](skill-evals.md) (skill quality gate)
- [main-process](main-process.md) (registerPluginsIpc)