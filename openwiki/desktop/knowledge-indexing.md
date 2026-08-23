---
type: desktop
title: Knowledge Index (CodeGraph / CRG / OpenWiki / arch-scan)
description: Knowledge dashboard and index building: CodeGraph symbol library, CRG risk graph, OpenWiki docs, AGENTS in-place read, arch-scan architecture diagrams, and BuildJobManager background builds.
tags: [knowledge, codegraph, crg, openwiki, indexing]
---

# Knowledge Index

The desktop app aggregates four knowledge sources into a single dashboard (`registerKnowledgeIpc`'s `KnowledgeStatus`): CodeGraph (symbol graph), OpenWiki (docs), AGENTS.md (project description), and archmaps (A2UI architecture diagrams). The indexing and knowledge modules were reworked via specs/index-knowledge-rework R2 (2026-08-23): background build process, zero session residue, AGENTS in-place, symbol sub-tab.

## Knowledge Source Status

| Source | Status determination | Details |
| --- | --- | --- |
| CodeGraph | `.codegraph/` exists + freshness | symbol count, etc. |
| OpenWiki | `openwiki/` page count (recursive, including modules/+workflows/) | page count unit: "pages" |
| AGENTS.md | exists + line count | in-place read (containment check) |
| archmaps | `.deeporca/prototypes/*.json` | count + file list |

Freshness: `SessionBridge.getKnowledgeFreshness` (`lastMutation` vs. each source's `syncTime`) → `stale`/`indexed`.

## Per-Source Implementation

### CodeGraph (`main/tools/codegraph-sdk.ts`)

- **Index/sync**: `SdkCodegraphController` (SDK, `@colbymchenry/codegraph` dependency); MCP tools still run via a subprocess (npm-shim.js — the SDK's MCPServer doesn't yet provide connect(transport) for in-process bridging).
- **Symbol list**: `KnowledgeListSymbols` performs a direct read-only SQLite query on `.codegraph/codegraph.db` (`node:sqlite`, lazy-loaded for Node ≥ 22.5, falls back to an empty result).

### CRG (`main/tools/crg-cli.ts`)

- Build/visualize: `CrgCliController` (vendored CRG binary); queries go through the core `CrgGraphQuery` (Node.js reads SQLite directly; the MCP surface has been retired and hidden, commit b137ac17).
- Index store: `.code-review-graph/` directory existence.

### OpenWiki (`main/tools/wiki-cli.ts`)

- `WikiCliController` spawns the **vendored openwiki CLI** (`packages/desktop/vendor/openwiki/dist/cli.js`, ships with an isolated node_modules of ~187MB to avoid pulling @langchain/* into the dependency graph).
- LLM credentials are passed via env (`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENWIKI_MODEL`); the `OPENWIKI_LANGUAGE` language value is taken from the app locale.
- Writes OpenWiki connector configuration (`~/.openwiki/connectors/`): lets the wiki agent consume CodeGraph MCP and Serena MCP as knowledge sources (non-fatal; continues on failure).
- `--print` structured output (progress + results, not TUI).

### Serena / SkillSpector

- `serena-cli.ts`: semantic search/edit (SolidLSP, 40+ languages); Electron handshake fix (stdout block buffering issue, commit ce0f82c3).
- `skill-spector-cli.ts`: skill/MCP security scanning.

### arch-scan (A2UI Architecture Diagrams)

- The core action `arch-scan.run` produces A2UI surface JSON (`.deeporca/prototypes/`); `KnowledgeRenderArchmap` renders it as a self-contained HTML component tree view.

## BuildJobManager (`main/build-job-manager.ts`)

- R2-1 background builds: jobs are held in the **main process** (renderer row state is a read-only subscription; switching rows/tabs doesn't lose the build).
- `KnowledgeBuild` (init/update/auto) → `buildJobs.start(root, mode)` → ActionRegistry composition ([workflows/knowledge-build](../workflows/knowledge-build.md)).
- Status: `KnowledgeBuildStatus` (running/percent/stage).

## Focused Tests

- `app-boot.test.ts` (knowledge IPC wiring), `file-scanner.test.ts`.
- Core side: `codegraph.test.ts`, `routing-gating.test.ts` (knowledge source gating).

## Related Pages

- [main-process](main-process.md) (registerKnowledgeIpc/registerCodegraphIpc/registerCrgIpc/registerWikiIpc)
- [core/actions](../core/actions.md) (the wiki/codegraph/crg/index-build/arch-scan action family)
- [workflows/knowledge-build](../workflows/knowledge-build.md) (one-click build end to end)