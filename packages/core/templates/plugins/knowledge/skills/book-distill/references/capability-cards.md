# Capability Cards — Extraction Schema (Stage 3)

The atomic unit of book-distill. Stage 3 (分批抽取) turns each meaningful
chapter into cards; Stage 4 (去重合并) merges them; Stage 5 (技能组装) renders
the merged cards into the derived skill. Never write derived SKILL.md prose
straight from the source — cards are where dedupe and provenance are enforced.

## Fields

| Field      | Required | What goes in it                                                        |
| ---------- | -------- | ---------------------------------------------------------------------- |
| `topic`    | yes      | Grouping key for Stage 5; kebab-case noun ("naming", "error-handling") |
| `trigger`  | yes      | Concrete conditions/scenarios when this applies; future-user phrasings |
| `steps`    | yes      | Ordered procedure, imperative voice, one action per step               |
| `pitfalls` | yes\*    | Anti-patterns and common mistakes the source warns about               |
| `examples` | yes\*    | Worked example; may be adapted — never copied verbatim                 |
| `evidence` | optional | Short quote + chapter cite, ≤ ~2 sentences                             |
| `source`   | yes      | Chapter number (and book id when distilling multiple sources)          |

\* If the chapter genuinely contains no pitfalls or no example, record the
field as absent with a one-word reason ("none stated") rather than inventing
content. Invented pitfalls are worse than missing ones.

## Field rules

- **trigger** — write it as the future user would experience the situation,
  not as the book frames the chapter. "Before publishing a public API" beats
  "as discussed in chapter 4". Triggers are what Stage 6 mines for the
  description keywords.
- **steps** — each step must be independently actionable. If a step hides a
  decision ("choose the right format"), split it and state the decision rule.
- **pitfalls** — copy the source's warnings even when they feel obvious; they
  become the anti-pattern section, which is the highest-value part of a
  distilled skill.
- **examples** — adapt names/ids/context freely; keep the structural lesson.
- **evidence** — quotes justify that the card reflects the source, they are
  not the card's content. If the card is clear without a quote, omit it.

## Worked example

Source: a hypothetical internal handbook, ch. 3 "变量命名".

```yaml
topic: naming
source: ch. 3
trigger: naming a new variable, function, or type in shared code
steps:
  - Encode domain intent, not type (playerCount, not intVal)
  - Prefer the domain term already used in the module; check neighbors first
  - Booleans read as assertions (isActive, hasAccess)
  - Cap at 3 words; if it needs more, split the concept
pitfalls:
  - Abbreviations only the author understands (cnt, mgr, tmp2)
  - Negated booleans (isNotReady) — invert the assertion instead
  - Renaming mid-refactor without grepping call sites
example: |
  // bad: const d = 86400000;
  const dayMs = 24 * 60 * 60 * 1000;
evidence: "'名字要说出领域意图，而不是类型' (ch. 3)"
```

## What NOT to extract

- Chapter narrative, anecdotes, and motivation — they justify the method, they
  are not the method.
- Facts without a trigger (dates, history, who-said-what).
- Advice the source itself marks as opinion or as contested.
- Whole procedures the source admits it does not follow.

If a chapter yields zero cards after honest filtering, that is a correct
Stage 2 "skip" verdict reached late — record it and move on.
