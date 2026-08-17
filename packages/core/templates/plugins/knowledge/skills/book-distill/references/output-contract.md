# Output Contract — Derived Skill Layout & Description Recipe

What Stage 5 (技能组装) and Stage 6 (触发描述优化) must produce, and the exact
shape it must take. Follows the skill-writer conventions; this file adds the
book-distill-specific requirements on top.

## Directory layout

```
~/.deeporca/skills/<derived-name>/        # user skills dir — the default target
├── SKILL.md                              # required, ≤ ~300 lines
└── references/                           # omit entirely for thin material
    └── <topic>.md                        # one file per merged card group
```

- `<derived-name>`: kebab-case, ≤ 64 chars, names the **capability domain**
  (not the book title), must equal the frontmatter `name`.
- `references/<topic>.md` maps 1:1 to the `topic` keys assigned in Stage 4.
  Do not create a references file for a single card — fold singletons into a
  SKILL.md section.
- Short-source fast path: a single-page source produces a single SKILL.md and
  no references/ directory. No empty scaffolding.

## Frontmatter requirements

```yaml
---
name: <derived-name>
description: >-
  <Stage 6 output — see recipe below.>
---
```

- Valid YAML, no tabs; `name` matches the directory; `description`
  < 1024 chars and states both what it does and when to use it.
- Optional fields (`allowed-tools`, `categories`, `inputs`, `outputs`) follow
  the skill-writer rules; add them only when the distilled capability clearly
  warrants restriction or compositional routing.

## Provenance header (every references file)

First line of every `references/<topic>.md`:

```
<!-- source: <Book Title> — <Author>, chapters <n>–<m>, distilled YYYY-MM-DD -->
```

Evidence quotes inside the body carry per-quote chapter cites. The derived
SKILL.md does not carry a header comment (frontmatter must stay on line 1) —
provenance lives in its references files; if there are none, cite the source
once in the body's closing line.

## Stage 6 description recipe

This repository routes skills by embedding recall (G1 shortlist). The
description is the **only** routing surface — the body is never embedded.
Write it for recall, not for elegance.

1. Formula: `[what it does] + [when to use it] + [trigger keywords]`.
2. Scenarios: 2–4 concrete "Use when the user asks …" phrasings, quoting how a
   real user would phrase the request.
3. Multilingual keywords: at minimum English + Chinese trigger terms; add the
   source document's language if different.
4. Specific over vague: domain nouns, file types, operations. Generic verbs
   ("helps with documents") embed near everything and route nowhere.
5. Exclusions: one "Not for …" clause naming the nearest wrong-trigger
   candidates.

### Good

```yaml
description: >-
  Enforce the team's REST API naming rules before a design review. Use when
  the user writes or reviews endpoint paths, resource names, or query
  parameters and asks for naming conventions, 命名规范, or API style checks.
  Not for GraphQL schemas or database column naming. Triggers: api naming,
  endpoint style, 路径命名, resource naming, 命名检查.
```

### Bad

```yaml
description: >-
  A skill about APIs and best practices, distilled from a good book. Use for
  anything API-related.
```

Why it fails: no scenarios, no trigger phrasings, no Chinese keywords, no
exclusions — it will neither reliably match nor reliably not-match.

## Size budgets

| Artifact               | Budget                                       |
| ---------------------- | -------------------------------------------- |
| SKILL.md               | ≤ ~300 lines; detail pushed to references/   |
| references/<topic>.md  | ≤ ~200 lines each                            |
| Evidence quotes        | ≤ ~2 sentences per quote, a handful in total |
| Derived skills per run | 1 per capability domain (multi-domain → ask) |

Over budget → go back to Stage 4: merge more cards or demote whole sections to
references. Never trim by deleting pitfalls — they are the point.
