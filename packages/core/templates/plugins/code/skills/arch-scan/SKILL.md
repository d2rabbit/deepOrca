---
name: arch-scan
description: "Architecture-map scan driven by the vendored archify skill package. Explores the repository (read/bash + codegraph/serena MCP), authors a typed JSON IR artifact (arch-<slug>.<type>.json under .deeporca/prototypes/), and iterates it through archify's validate receipts. The deterministic deliver/render gate runs host-side after this task completes. Used by index.build-all's arch stage and the arch-scan.run action."
---

# arch-scan — archify-driven architecture maps

You author ONE OR MORE typed JSON IR diagrams for the target repository using
the vendored **archify** skill package. You do NOT hand-write Mermaid, HTML, or
SVG — the IR file is your only durable artifact; the host renders it through
archify's validated delivery pipeline after you finish.

## Toolkit paths

The user message tells you where the vendored archify package lives:
`skillDoc` (the full authoring contract), `schemasDir`, `examplesDir`, `bin`.
Read `skillDoc` FIRST — it is the authoritative contract (type router,
authoring invariants, validation loop, repair discipline). The essentials are
restated here for reliability, but when they conflict, skillDoc wins.

## Authoring loop

1. **Choose the diagram type(s)** from the requested perspective:
   - overall / component / runtime → `architecture`
   - data-flow / lineage / pipeline → `dataflow`
   - request lifecycle / call chains → `sequence`
   - process / CI / runbook → `workflow`
   - state machines / retries → `lifecycle`
     When ambiguous, follow the type router in skillDoc, or run the
     deterministic classifier: `node <bin> guide "<scenario>" --json`.
2. **Read the contract inputs — only these**:
   - `skillDoc` (archify/SKILL.md)
   - ONE schema for your chosen type in `schemasDir`, plus `schemas/common.schema.json`
   - ONE matching example in `examplesDir`
     Do not read renderer internals, validators, or tests.
3. **Explore the repository for facts**: entrypoints, services, stores,
   external dependencies, trust boundaries. Use the codegraph/serena MCP tools
   for symbol-level relations and `read`/`bash` for structure. Never invent
   topology — every node, edge, boundary, card line, and guided view must be
   evidenced by code you actually read.
4. **Write the candidate EARLY** (artifact first):
   `.deeporca/prototypes/arch-<slug>.<type>.json` in the TARGET ROOT (the
   repository being scanned, reported in the user message). File name
   convention is load-bearing — the host's deliver gate parses the type from
   the `.<type>.json` suffix. Set `meta.quality_profile` to `"showcase"`.
   Match the user's language for reader-facing text; keep exact code
   identifiers, product names, commands and API paths as-is.
5. **Validate + repair**: call the `validate_archifact` tool with the
   artifact's absolute path (preferred — it runs the official gate
   host-side). Fallback when that tool is unavailable:
   `node <bin> validate <type> <candidate.json> --quality showcase --json`.
   Read `diagnostics[]`; change ONLY the diagnosed `subject` using its
   `supportedFixes` — with the write tool. At most 2 focused repair rounds
   per artifact (host-side tightening of skillDoc's "continue while the
   error count reaches a new minimum" — the build must not stall on one map) —
   if two consecutive rounds do not lower the error count,
   stop and report the unresolved diagnostics truthfully. The host's
   deterministic deliver gate is the final authority either way. The gate
   re-runs the IDENTICAL checks on the final bytes: finish ONLY after a
   passing `validate_archifact` on the file as it last sits on disk — any
   edit after a passing validate must be re-validated, or the build fails
   on delivery.
6. **Report**: list each artifact you wrote (path + type + validation status).
   A validation failure you could not repair must be reported as such —
   never as success.

## Showcase surface (beauty comes from the IR, not decoration)

The renderer's color, depth and interactivity are driven by how completely you
fill the typed surface. The bullets are written for `architecture` (the default
perspective); each states its cross-type applicability. Use ALL of what your
chosen type's schema supports — and NONE of what it doesn't:

- **Placement (architecture only — no other schema has `layout`)**: prefer
  `layout: { mode: "grid" }` with explicit
  `row`/`col` per component (tidy spines, deterministic). Cells are
  0-indexed (`col < layout.cols`, one component per cell, origin default
  `[40, 80]`, pitch `cellW+gapX` / `cellH+gapY`). Free `pos` is a
  bounded exception, not prose-level coordinate planning. Place vertical
  chains so a direct edge is adjacent (directly beneath/beside), and remove
  a low-value edge BEFORE reaching for `via`/side overrides — most label
  and corridor diagnostics are really topology problems. **Hub components
  (fan-out ≥ 3) get their neighbors on the adjacent grid cells around them**
  — long edges spanning the board are crossing factories (real-machine
  2026-08-30: a hub chain produced 5 proper-crossing errors from geometry
  alone; re-placing the components adjacent fixed all of them without any
  routing controls). Other types place through their own fields: workflow
  `lane`+`col` (0–5), lifecycle `lane`+`col` (0–4), dataflow `stage`+`row`,
  sequence = participant order.
- **Semantic types drive the palette**: every component/node/participant
  gets its accurate `type` — `frontend`, `backend`, `database`, `cloud`,
  `security`, `messagebus`, `external`. Never lump a Redis into `backend` or
  a queue into `database` to save a thought; the wrong type renders the wrong
  color and legend entry. EXCEPTION — lifecycle `states` use their own enum:
  `start`, `active`, `waiting`, `decision`, `success`, `failure`, `neutral`,
  `external`.
- **Two-line depth**: give every component a one-line `sublabel` (its role in
  this system) and a `tag` when a concrete runtime is known (e.g. `:8080`,
  `Postgres 16`, `Node 22`) — all types EXCEPT sequence participants, which
  have no `tag` field. Sparse labels means SHORT, not MISSING.
- **Variants belong on RELATIONSHIPS** — node/component/participant/stage/
  state schemas REJECT a `variant` field (schema error). Relationship
  variants: `emphasis` on the 1–3 main-path edges, `security` on edges
  crossing a security-group boundary, `dashed` only on planned or optional
  relationships; sequence messages also accept `return`; workflow
  lanes/phases/groups take `normal`/`exception`. Never as decoration. Node
  importance is expressed by accurate `type` + placement on the main spine,
  not a variant field.
- **Boundaries (architecture only)**: `region` boundaries for deployment or
  team ownership, `security-group` for trust boundaries (auth edge, PII,
  secrets). External actors sit OUTSIDE the system boundary when that is
  factually true. Boundaries do not replace relationships; other types
  express ownership via workflow lanes/groups or dataflow
  `flows[].classification`.
- **Connections stay semantic**: label each edge with its protocol or action
  (`HTTP`, `gRPC`, `publish/subscribe`, `SQL`) — a label is deleted only when
  both endpoints fully imply it (skillDoc's label contract).
- **Conclusion cards** (`cards`, all five types; no schema cap — keep to
  1–3): after the map, state the facts a reader
  should retain — tech choices, data contracts, scaling/bottleneck notes.
  Every card line must trace to code you read. Cards balance the first
  screen next to the diagram panel; an artifact without any card usually
  reads unfinished.
- **Guided views** (`meta.views`, all five types; schema caps at 5 — author
  2–5 chapters): curated routes through the
  map using stable node ids, each with a one-line `note` (e.g. main request
  path, write path, auth boundary, failure handling). These power the story
  rail, follow camera and shareable moments in the delivered HTML — a map
  without views is silent; a map with views narrates itself.
- **Brand marks** for real, named products: when a component names a
  recognizable product (PostgreSQL, Redis, Kafka, Nginx, React, …), run
  `node <bin> brands "<name>" --json` (read-only; allowlisted in this task)
  and author the returned
  canonical id as `brand`. If lookup fails, omit `brand` — never guess.
- **Bidirectional pairs share one corridor legitimately**: two opposite
  edges between the same components (request/push) may overlap — that is
  semantically unambiguous and passes. NEVER author mirror `via` lanes to
  "separate" them: explicit `via` disables Automatic Port Spread and
  conflicts with the fixed side-midpoint anchors. Fix the LABEL collision
  instead — anchor each label beside the shared lane with `labelAt`
  (real-machine 2026-08-30: two `labelAt` anchors fixed a 15-error pair in
  one round).
- **Repair discipline**: apply at most ONE diagnosed geometry control per
  repair round, and only on the diagnosed `subject`. A showcase pass means
  all 9 artifact checks with 0 composition errors AND 0 warnings — "it
  validates at all" is not the bar.
- **Restraints that stay**: omit `meta.visual_preset`, `meta.subtitle`,
  `meta.animation`, and geometry overrides (`via`, `fromSide`, `toSide`,
  `channelX/Y`, `labelAt`) unless a diagnostic calls for one — the showcase
  bar is completeness of SEMANTICS, not styling tweaks. `fromSide`/`toSide`
  are direction CONTRACTS (the first/final segment must run perpendicular
  in the named direction): a guessed side paired with auto routing
  guarantees `endpoint-side-direction` failures.

## Hard rules

- **Mutate files ONLY with the `write` tool.** NEVER create, modify, or delete
  artifact files via bash/node/python one-liners — a real run's `node -e`
  script with an undefined variable wrote "undefined.json" and destroyed a
  complete artifact (2026-08-29). The write tool's read-before-write guard
  makes accidents impossible; a shell script makes them likely. bash is for
  READING and running `archify validate` / `archify brands` lookups — nothing
  else.
- Component `sources` are the repository-evidence surface: author them ONLY
  when the task prompt provides the meta.repository values (a github.com
  origin + pinned revision). Otherwise keep source anchors in sublabel/tag
  text — never author a sources array the gate cannot verify (a failed
  deliver fails the whole build stage).
- Durable artifacts go ONLY to `<targetRoot>/.deeporca/prototypes/arch-*.<type>.json`.
  Nothing else on disk is yours to write.
- Do not modify, delete, or "clean up" other files in prototypes/.
- Never claim a diagram rendered — rendering is the host's deterministic gate.
- Preserve exact code identifiers and product names in node/edge labels.
- A beauty feature without evidence is a LIE in color: do not author a
  boundary, card line, variant, or guided view that the code does not
  support. If the evidence is thin, ship the smaller truthful map.
