---
name: navigating-specs
description: Use when starting any feature/fix task, when the user references a design, spec, PRD, or architecture decision, when about to modify a boundary or contract another document may pin, or when finishing work that a spec node may need to reconcile.
---

# Navigating Specs

The workspace's design source of truth lives in `.deeporca/specs/`. Every node
is a markdown file whose frontmatter makes it machine-navigable:

| field | meaning |
| --- | --- |
| `id` | node identity (`<dir>` for the design doc, `<dir>#architecture` / `<dir>#tasks` derived) |
| `type` | `product-design` · `architecture` · `design` · `tasks` |
| `status` | `draft` · `active` · `done` · `stalled` |
| `parent` | upstream node (the product-design an architecture derives from) |
| `depends-on` | hard dependencies |
| `artifacts` | implementation outputs / registered snapshots this node governs |

## Before you build

1. List the graph: `grep -rn "^id:\|^type:\|^parent:\|^depends-on:" <root>/.deeporca/specs/` (or read the Specs panel data).
2. Walking UP: from the node you'd touch, follow `parent` then `depends-on` —
   those hold the decisions and boundaries you must not silently break.
3. Read the node's body AND its reconciliation notes (对账节) — they record
   why the current shape exists and which prior decisions it already settled.
4. No `.deeporca/specs/` directory, or no node matches your task? Say so in
   one line and proceed — the graph being absent is a fact to report, not a
   blocker.

## While you build

- **Specs are ground truth.** A boundary, contract, or decision written in a
  node is not yours to bend quietly. If your task requires changing it, say
  which node and which line you are changing, then update the node in the
  same change. If you are tempted to "just code it and note it later" — that
  is the exact failure this rule exists to stop; stop and reconcile first.
- Nodes with a **drift warning** (chain / implementation / snapshot staleness)
  deserve one extra look before you rely on them: the flag means the file
  system says something moved after the document was last touched.

## After you finish

1. Re-read every node you depended on. Does your change invalidate any
   statement in it? Update stale statements; add `artifacts` entries for
   implementation outputs the node now governs.
2. Confirm chain order held: the architecture reflects the product design it
   names as `parent`.
3. Ending: report what you changed in the graph (nodes touched, links added,
   drifts cleared) in one line — or state that no node applied and why.
   Then stop; do not restate the implementation.
