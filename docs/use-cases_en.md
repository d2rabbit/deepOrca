# Developer Use Cases

> End-to-end workflows based on shipped features — everything below can be
> reproduced today. 中文版见 [use-cases.md](use-cases.md).

## At a glance

| Case                                                                                           | One-liner                                                                     | Entry point              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| [Onboarding to an unfamiliar codebase](#case-1-onboarding-to-an-unfamiliar-codebase)           | One build yields arch maps + Wiki + symbol graph, quotable straight into chat | Rail → Index & Knowledge |
| [Pre-merge review loop](#case-2-pre-merge-review-loop)                                         | Review → ask in chat → one-click fix, one continuous chain                    | Rail → Code Review       |
| [From requirement to interactive prototype](#case-3-from-requirement-to-interactive-prototype) | One command generates a prototype; iterate in the preview itself              | Type `/prototype`        |
| [Teach the AI your repo](#case-4-teach-the-ai-your-repo)                                       | Generate AGENTS.md and version your team conventions                          | Type `/init`             |

---

## Case 1: Onboarding to an unfamiliar codebase

**Scenario**: you just cloned a six-figure-line project and need to explain its
architecture, locate the core modules, and trace one typical request — within
the hour.

**Steps**:

1. Open the workspace in DeepOrca, go to **Index & Knowledge** in the left
   rail, and hit **Build** on the workspace row. Three stages run in order —
   symbols → Wiki → arch maps — with live progress under the row and a badge
   in the corner while it works in the background.
2. When the build settles, a **"Wiki updated · N pages"** suggestion bar pops
   over the composer — the junction between knowledge and conversation:
   - **View** jumps straight to the Knowledge Center;
   - **Quote in chat** fills the composer with an architecture-analysis
     question grounded in `@openwiki/` — press Enter to ask.
3. In the **Arch maps** sub-tab, the map fills a dotted drafting canvas with
   multiple charts behind pill switches, zoom, and fit-to-width. Nodes cycle
   an 8-color ramp and subgraphs get dashed frames — module boundaries read at
   a glance.
4. Read project docs in the **Wiki** sub-tab (full document typography); any
   page can be **quoted into chat** as context with one click.
5. In the **Symbols** sub-tab, the relationship graph lays out callers (violet)
   | focus (blue) | callees (teal). Click any node to recenter and drill down;
   the back button retraces your path.
6. Any time later, <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> → "knowledge" jumps back.

**Outcome**: an architecture understanding you can _talk to_ — not three
disconnected tool panels.

---

## Case 2: Pre-merge review loop

**Scenario**: a feature branch touched 20 files; you want a quick quality and
structural-risk pass before merging, and a few findings deserve a real
discussion before deciding how to fix them.

**Steps**:

1. Rail → **Code Review** → **Review** (`review.full`). OCR semantic review
   produces structured findings; when a CRG graph exists, structural-risk tags
   (e.g. "HIGH (12 callers)") are attached.
2. The result area offers two actions:
   - **💬 Ask in chat** — injects the current findings (risk-tagged, capped at
     8 with an honest +N) into the composer. Add "which of these are
     must-fix?" and send — discuss each one with the AI;
   - **🔧 One-click fix** — turns the finding list into a fix plan executed in
     session mode.
3. Fix by hand after the discussion, or take the one-click fix; re-run review
   to confirm convergence.

**Outcome**: find → understand → fix as one chain, inside one window.

---

## Case 3: From requirement to interactive prototype

**Scenario**: product wants a new page; you want to see a clickable prototype
before writing code — and iterate on it in place.

**Steps**:

1. Type `/prototype` in the session (or describe the requirement and let the
   AI use the prototype renderer).
2. The interactive prototype opens in the right preview — real navigation and
   form interaction, not a static screenshot.
3. Describe changes ("make the submit button a gradient") in the mini composer
   under the preview; iteration requests go straight back into the session and
   the prototype refreshes live. No window switching.
4. Once it feels right, ask the AI to implement it — the prototype is the spec.

**Outcome**: requirement → prototype → iteration → implementation, with every
step preserved in the session context.

---

## Case 4: Teach the AI your repo

**Scenario**: the team has build and coding conventions; every session should
follow them automatically instead of being told each time.

**Steps**:

1. Type `/init` — the AI scans the repo and generates `AGENTS.md` (build
   commands, layout conventions, test invocation, …).
2. Read the rendered file in the **AGENTS** sub-tab of Index & Knowledge, or
   open it in the editor to revise and commit.
3. Everyone who clones the repo gets the same AI collaboration conventions for
   free.
4. Layer finer-grained team workflows via Skills (see
   [agent-skills_en.md](agent-skills_en.md)).

**Outcome**: "how we work with AI" becomes version-controlled.

---

## Shortcuts

| Shortcut                          | Action                                                 |
| --------------------------------- | ------------------------------------------------------ |
| <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> | Command palette (navigation, themes, Knowledge Center) |
| <kbd>⌘N</kbd> / <kbd>Ctrl+N</kbd> | New session                                            |
| <kbd>⌘B</kbd> / <kbd>Ctrl+B</kbd> | Toggle sidebar                                         |
| <kbd>⇧Tab</kbd>                   | Plan mode (read-first)                                 |
| <kbd>⌘?</kbd>                     | Shortcut help                                          |

See also the [quickstart](quickstart_en.md).
