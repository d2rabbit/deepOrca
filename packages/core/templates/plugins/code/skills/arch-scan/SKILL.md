---
name: arch-scan
description: >-
  Scan codebase architecture and generate an interactive A2UI architecture map
  using perspective-driven recursive analysis. Use when users ask for "scan
  architecture", "架构图", "架构扫描", "architecture diagram", "代码结构",
  "dependency map", or "how does this codebase work". Produces an A2UI Surface
  (nestable component tree) rendered via DeepOrca's DesignPreview — no external
  CLI, no Mermaid files. Methodology adopted from oh-my-mermaid (omm).
---

# arch-scan — Perspective-Based Architecture Scanner (A2UI Renderer)

## Purpose

Analyze the codebase and generate an **interactive A2UI architecture map** using
**perspective-driven recursive analysis**.

- A **perspective** is a top-level view — a distinct way to look at the
  architecture (structure, data flow, dependencies, etc.).
- Each element in a perspective gets analyzed recursively. If it has internal
  structure, it becomes a **nestable group** (click to expand in the A2UI
  preview). If not, it stays a **leaf node**.
- Output is an **A2UI Surface** (a tree of components), NOT Mermaid `.mmd` files.
  Each perspective = a top-level panel; each element = a node card with metadata
  fields; groups = expandable nested surfaces.

> **Methodology**: The perspective catalog and recursive drill-down approach are
> adopted from [oh-my-mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid)
> (omm). DeepOrca replaces omm's Mermaid + CLI + `.omm/` file tree with A2UI
> component trees rendered in-app. See
> `docs/research/2026-08-06-oh-my-mermaid-research.md`.

---

## Step 0: Detect Language

Ask the user or infer from the project's primary language. Write all field
content (description, context, concern, etc.) in the detected language
(Chinese for DeepOrca's default). Element IDs and component keys are always
English kebab-case.

## Step 1: Explore the Codebase

Use `bash` (glob/find) and `read` tools to understand the project:

- Read `package.json`, `pyproject.toml`, `go.mod`, or equivalent manifests
- List top-level directories to identify module boundaries
- Read key entry points (`main`, `index`, `app`, `cmd` files)
- Look for route definitions, service layers, database connections, external integrations
- Read `AGENTS.md` / `CLAUDE.md` / architecture docs if present

## Step 2: Select Perspectives

From the catalog below, choose which perspectives are meaningful for this
codebase. **Always** include `overall-architecture`.

### Perspective Catalog

| Perspective             | When to create                          | What it answers                                   |
| ----------------------- | --------------------------------------- | ------------------------------------------------- |
| `overall-architecture`  | **Always**                              | What exists and how pieces relate                 |
| `request-lifecycle`     | Any server/API                          | How a request enters and gets handled end-to-end  |
| `data-flow`             | Any data processing, DB usage           | Where data comes from, transforms, and lands      |
| `dependency-map`        | Complex module graph                    | What depends on what, what's shared               |
| `external-integrations` | External APIs/services                  | What the system connects to and why               |
| `state-transitions`     | Stateful features (frontend or backend) | How state changes and what triggers it            |
| `route-page-map`        | Frontend with routing                   | Page structure and navigation flow                |
| `command-surface`       | CLI tools                               | Command hierarchy and dispatch                    |
| `extension-points`      | Plugin/extension systems                | Extension architecture and registry               |
| `pipeline`              | ML/data pipelines                       | Stage topology and data flow                      |
| `orchestration`         | Event-driven/queue systems              | Publisher, subscriber, broker topology            |
| `storage`               | 2+ storage systems                      | Storage topology (DB, cache, queue, object store) |

Don't force perspectives that don't exist in the code.

## Step 3: Generate the A2UI Surface (Recursive)

Build the A2UI Surface using `update_surface` (the A2UI tool). The surface is a
tree of components:

### Component model

- **Root**: a `panel` with the project name + an overview description.
- **Perspective**: a `panel` (tab) per selected perspective. Each has a title
  like `"Overall Architecture"` / `"Data Flow"` / `"Dependency Map"`.
- **Element**: a `card` inside a perspective. Each card has:
  - `title`: element name (e.g. `"Main Process"`)
  - `subtitle`: file path (e.g. `src/main/`)
  - `description`: what this element does
  - Optional fields as card content: `context`, `constraint`, `concern`, `todo`, `note`
- **Group** (element with internal structure): a nestable `surface` inside the
  card — clicking it expands to show child element cards.
- **Edge** (relationship between elements): rendered as a labeled connector in
  the A2UI graph view (use the `graph` surface type with `nodes` + `edges`).

### 3a. Build the root surface

```
update_surface({
  surfaceId: "arch-root",
  type: "panel",
  props: { title: "<Project Name> Architecture", layout: "tabs" },
  children: [ ...perspective panels ]
})
```

### 3b. For each perspective, create a panel with a graph

Each perspective is a `graph` surface showing nodes (elements) and edges
(relationships with labels):

```
update_surface({
  surfaceId: "arch-overall",
  type: "graph",
  props: {
    title: "Overall Architecture",
    direction: "LR",  // or "TD" for hierarchies
    nodes: [
      { id: "renderer", label: "Renderer\nsrc/renderer/", kind: "entry" },
      { id: "main", label: "Main Process\nsrc/main/", kind: "entry" },
      { id: "store", label: "Data Store\nsrc/store.ts", kind: "store" },
    ],
    edges: [
      { from: "renderer", to: "main", label: "IPC invoke/on" },
      { from: "main", to: "store", label: "read/write JSON" },
    ],
  }
})
```

### Node kinds (for color coding)

| Kind       | Color hint | When to use                                 |
| ---------- | ---------- | ------------------------------------------- |
| `entry`    | blue       | Entry points (HTTP handler, CLI, main)      |
| `store`    | green      | Persistent storage (DB, cache, file system) |
| `external` | gray       | Third-party services outside the codebase   |
| `concern`  | red        | Known risk or bottleneck                    |
| `default`  | neutral    | Regular module/component                    |

### 3c. Recursive drill-down — analyze every element

**For every element (node) in the perspective graph:**

1. **Analyze** the code it represents (`read` the relevant files/directories).

2. **Add a detail card** to the element's surface with at least a `description`.
   Optionally add `context`, `constraint`, `concern`, `todo`, `note` fields.

3. **Decide leaf or group:**
   - **Distinct internal components found** → add a nested `graph` surface inside
     the element's card and recurse deeper (it becomes an expandable group).
   - **No meaningful sub-components** (single file, trivial wrapper, external
     system) → leaf node, just fill in the metadata fields.

4. **If group** — add the nested graph and repeat step 3c for each element.

### Example recursion

```
overall-architecture (perspective graph)
  nodes: renderer, main-process, engine-system, data-store

  → analyze renderer (src/renderer/)
    → finds: App.tsx, components/, hooks/, stores/
    → GROUP → add nested graph: components, stores, hooks
      → analyze components → 15 files, no sub-structure → LEAF
      → analyze stores → 4 stores → LEAF

  → analyze data-store (src/store.ts)
    → single file → LEAF
```

## Step 4: Summarize

Report to the user:

- Which perspectives were generated
- How many elements / groups / leaves
- Suggest viewing in the A2UI preview pane (the surface renders automatically)

## Edge Rules

- Every edge must have a meaningful `label`: `A --"why this connection exists"--> B`
- More elements in one graph → recurse deeper (don't cram 30 nodes in one view).
- Use `direction: "LR"` for most graphs, `"TD"` for hierarchies.

## General Rules

- **Use A2UI tools (`update_surface`) only** — do NOT write Mermaid `.mmd` files,
  do NOT call any external CLI, do NOT create `.omm/` directories.
- Do not re-analyze elements that haven't changed (incremental updates).
- Do not create circular references — a child element must never reference its parent.
- Write all human-readable fields in the detected language (Chinese by default).
