---
name: book-distill
description: >-
  Distill a book, manual, or long document into a reusable Agent Skill
  (SKILL.md + references/). Use when the user provides a book, textbook,
  handbook, or long document and asks to "turn it into a skill", "distill this
  book", "extract the methodology", 把这本书/手册蒸馏成技能, 总结/萃取长文档为可复用技能,
  or wants its checklists, workflows, and pitfalls converted into a skill the
  agent loads on demand. Not for plain summaries or reading notes. Triggers:
  distill, 蒸馏, 书籍, 手册, 教材, 长文档, book, manual, handbook, textbook,
  book to skill, 文档转技能, knowledge extraction, 知识萃取, 提炼方法论.
---

# book-distill — Distill a Book or Long Document into a Skill

Turn a book, manual, or other long document into a **reusable Agent Skill**: a
`SKILL.md` (+ `references/` when warranted) written to the **user skills
directory**, so future sessions load the book's operational knowledge on demand
instead of re-reading the source.

This is extraction, not copying. The output is a capability distillation —
triggers, steps, pitfalls, examples — restated in our own words, with only
short evidence quotes from the source.

## When to Use

- User provides a book / manual / textbook / long document and asks to "turn it
  into a skill", "distill it", 蒸馏成技能, or extract its methodology
- User wants a document's checklists, workflows, or pitfalls available as a
  loadable skill in future sessions
- Distilling internal or team-owned documentation into agent capabilities

## When NOT to Use

- User wants a summary or reading notes → answer directly; produce no skill
- Source is fiction / history / narrative with no operational methodology →
  say so; a skill needs actionable capability, not facts
- User wants to edit an existing skill → use the skill-writer methodology
- Source is a website or a codebase → wiki-qa / openwiki cover those; this
  skill is for documents

## Pipeline Overview

Seven stages, always in order. For short sources (< ~3 pages) collapse the
middle per the [Short-Source Fast Path](#short-source-fast-path).

| #   | Stage                                           | Output                                        |
| --- | ----------------------------------------------- | --------------------------------------------- |
| 1   | Source assessment (源评估)                      | rights verdict + size inventory               |
| 2   | Chapter map (章节地图)                          | TOC table with extract/skip verdicts          |
| 3   | Batched extraction (分批抽取)                   | capability cards per chapter                  |
| 4   | Dedupe & merge (去重合并)                       | deduped card set + destination plan           |
| 5   | Skill assembly (技能组装)                       | SKILL.md + references/ in the user skills dir |
| 6   | Trigger-description optimization (触发描述优化) | recall-oriented frontmatter description       |
| 7   | Self-check (自检)                               | checklist verdict + report to the user        |

## Stage 1: Source Assessment (源评估)

### 1a. Rights & compliance

Work through in order; stop and resolve the first failure before extracting:

- [ ] The user owns the content (own notes, internal handbook), OR holds a
      license, OR the source is public domain / openly licensed, OR the user
      asserts rights and provides the file
- [ ] If the source is a commercial book with no evident license → ask the
      user to confirm rights before proceeding
- [ ] Never fetch or accept pirated copies of commercial books

Extraction contract (binds every later stage):

- Paraphrase methodology in our own words.
- Quote only short evidence spans: at most ~2 sentences per quote, always with
  a chapter cite, a handful per derived skill at most.
- The derived skill must be transformative — capability extraction, not a
  condensed copy of the book.

### 1b. Size & shape inventory

Record: format (md / pdf / epub / txt / …), page or word count, chapter count,
language, and whether the text fits one read or needs batching. For PDF/EPUB,
extract text first; if extraction is lossy (scans, heavy layout), say so to
the user before continuing.

Decision:

- Fits in one read (roughly < 50 dense pages) → single-pass extraction
- Larger → batch by chapter groups in Stage 3

## Stage 2: Chapter Map (章节地图)

Build the table **before** extracting anything. One row per chapter:

| Chapter | Topic | Capability candidate | Verdict        |
| ------- | ----- | -------------------- | -------------- |
| 1       | …     | …                    | extract / skip |

- One-line value judgment per chapter: what capability, if any, it contributes.
- Mark **skip** for: forewords, author bios, pure narrative or anecdote
  chapters, repeated content, marketing chapters, topics with no actionable
  method.
- Typical books: 30–60% of chapters are skip-worthy. Skipping is the main
  quality lever — do not extract from every chapter out of completeness.
- If the book spans multiple unrelated capability domains, ask the user which
  domain to distill (one skill = one capability), or propose several skills.

## Stage 3: Batched Extraction (分批抽取)

Process chapters in batches — one chapter or one group of related chapters per
pass, never the whole book in one gulp. For every chapter marked **extract**,
produce **capability cards**, the atomic unit of distillation:

- `topic` — grouping key used by Stage 5 (e.g. "naming", "error-handling")
- `trigger` — when to apply this; concrete conditions and scenarios
- `steps` — ordered procedure, imperative voice
- `pitfalls` — anti-patterns and common mistakes the source warns about
- `examples` — concrete worked example; adapt freely, do not copy verbatim
- `evidence` — optional short quote + chapter cite (≤ ~2 sentences)

Rules:

- One card = one capability. Split compound chapters; merge nothing yet.
- Keep provenance on every card (chapter number).
- Restate in our own words; quote only evidence spans.
- Extract the source's "what not to do" — pitfalls are the highest-value
  content in a distilled skill.

Card schema in full + a worked example:
[references/capability-cards.md](references/capability-cards.md)

## Stage 4: Dedupe & Merge (去重合并)

Books repeat themselves. Merge overlapping cards across chapters:

- Same trigger + same steps → merge; keep the richest example, union the
  pitfalls.
- Same topic, different altitude (general principle vs. specific procedure) →
  the specific procedure goes in the SKILL.md workflow, the general principle
  goes to `references/<topic>.md`.
- Contradictions (ch. 2 says X, ch. 9 refines it) → keep the more specific or
  later guidance; note the conflict in the card until assembly.
- Cards whose trigger no future session could hit → drop (unreachable
  knowledge).
- Multiple sources distilled together → dedupe across sources the same way;
  provenance keeps them distinguishable.

Target: card count drops ~30–50% from Stage 3 output. Then assign each merged
card a destination — a `SKILL.md` section or a `references/<topic>.md` file.

## Stage 5: Skill Assembly (技能组装)

Write the derived skill to the **user skills directory**:

```
~/.deeporca/skills/<derived-name>/
├── SKILL.md            # triggers, workflow, core steps — ≤ ~300 lines
└── references/
    ├── <topic>.md      # per-topic detail (omit if material is thin)
    └── ...
```

- `<derived-name>` is kebab-case and names the capability domain, not the book
  title: `code-review-checklist`, not `the-pragmatic-programmer`.
- Follow the skill-writer conventions: valid frontmatter (`name` matches the
  directory, `description` < 1024 chars), progressive disclosure, imperative
  checklist-heavy body.
- Every references file starts with a provenance header comment:
  `<!-- source: <Book Title> — <Author>, chapters <n>–<m>, distilled YYYY-MM-DD -->`
- Never write into the builtin templates dir
  (`packages/core/templates/plugins/…`) or any product directory — that tree
  ships with the application.
- If the user explicitly asked for a project-shared skill, write to
  `<project>/.deeporca/skills/<name>/` instead and say so.

Layout, frontmatter requirements, and size budgets:
[references/output-contract.md](references/output-contract.md)

## Stage 6: Trigger-Description Optimization (触发描述优化)

This repository routes skills by **embedding recall** (G1 shortlist): a derived
skill is only useful if its description embeds near the queries that should
trigger it. Writing this description is a hard requirement of the pipeline,
not polish.

Recipe:

1. Formula: `[what it does] + [when to use it] + [trigger keywords]`.
2. Scenarios: list the concrete phrasings a future user would type
   ("Use when the user asks … to …").
3. Multilingual keywords: at minimum English + Chinese trigger words.
4. Specific over vague: file types, operations, domain nouns — not generic
   verbs.
5. State exclusions ("Not for …") to avoid over-triggering.

Good/bad examples and the recall checklist:
[references/output-contract.md](references/output-contract.md)

## Stage 7: Self-Check (自检)

Run every item before reporting done:

- [ ] Frontmatter is valid YAML; `name` is kebab-case and matches the directory
- [ ] `description` < 1024 chars; contains scenarios plus EN/ZH trigger words
      (recall quality: would the Stage 6 queries embed near it?)
- [ ] SKILL.md ≤ ~300 lines; detail lives in references/
- [ ] Pitfalls / anti-patterns are present, not just happy-path steps
- [ ] No verbatim source text beyond short evidence spans; every quote is
      ≤ ~2 sentences with a chapter cite
- [ ] Provenance header on every references file
- [ ] Output lives under `~/.deeporca/skills/` (or the requested project dir),
      never under the builtin templates dir
- [ ] The final report does NOT claim the derived skill is loaded or active —
      tell the user it is discovered on the next skill scan and how to verify

Report to the user: the skill path, stage-by-stage stats (chapters mapped /
extracted / skipped; cards extracted / merged), and the description written in
Stage 6.

## Short-Source Fast Path

Sources under ~3 pages: do not run the full pipeline. Over-engineering a single
page into SKILL.md + references/ is a defect, not thoroughness.

- Stage 1: rights checks still apply; the size check resolves to "single read".
- Stages 2–4: collapse — one extraction pass, obvious dedupe inline.
- Stage 5: single-file SKILL.md, **no** references/ directory.
- Stages 6–7: unchanged — description quality and self-check always apply.

## General Rules

- Write derived skills ONLY to the user skills dir (`~/.deeporca/skills/`) or,
  on explicit request, the project skills dir (`<project>/.deeporca/skills/`).
  Never into `packages/core/templates/plugins/` or any product directory.
- Never claim to execute, load, or auto-activate the derived skill. New skills
  are discovered on the next skill scan; tell the user how to verify.
- Keep provenance: book title/author and chapter range in every references
  file's header comment; chapter cites on evidence quotes.
- Copyright red line: paraphrase methodology; quote only short evidence spans;
  resolve doubtful rights before extracting.
- One skill = one capability domain. Multi-domain books → ask the user which
  domain, or propose multiple derived skills.
- Card-first: never write derived SKILL.md prose straight from the book —
  always go through capability cards (Stages 3–4) so dedupe and provenance
  hold.
