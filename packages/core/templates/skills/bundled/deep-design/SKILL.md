---
name: deep-design
description: >-
  Generate design-grade HTML artifacts (prototypes, dashboards, decks, posters)
  as self-contained single HTML files. Use when users ask for design, 原型,
  落地页, dashboard, 仪表盘, 演示文稿, poster, landing page, or UI 设计稿.
  Reads the project DESIGN.md brand contract, composes from seed templates,
  optionally inlines Canvas UI visual effects. Output is one HTML file with
  zero external dependencies.
---

# DeepDesign — Generate Design-Grade HTML Artifacts

Produce a single, self-contained HTML design artifact using bundled seed
templates and section layouts — **not** by writing CSS from scratch. The seed
already encodes good defaults (typography, spacing, accent budget). Your job
is to compose it into a polished design.

## When to Use

- User asks for a landing page / 落地页 / marketing page / homepage
- User asks for a prototype / 原型 / mockup / UI 设计稿
- User asks for a dashboard / 仪表盘 / admin panel / 后台
- User asks for a poster / 海报 / social media card
- User wants to design something visual and asks "can you make it look good?"

## Resource Map

```
deep-design/
├── SKILL.md                              ← you're reading this

templates/design/
├── systems/                              ← DESIGN.md brand contracts
│   ├── dark-tech.md                      ← default (matches Orca theme)
│   ├── modern-minimal.md                 ← light, clean, airy
│   └── editorial.md                      ← serif, magazine, structured
├── templates/
│   └── web-prototype/                    ← landing/marketing/general web
│       ├── seed.html                     ← READ FIRST: tokens + class system
│       └── references/
│           └── layouts.md                ← 8 paste-ready section skeletons
└── canvas-ui/                            ← optional visual effects (Phase 3)
    └── registry.json                     ← liquid/blaze/glass/particle…
```

## Workflow

### Step 0 — Read the brand contract

Check for a project-level `.deeporca/DESIGN.md`. If it exists, read it — its
colors, fonts, spacing become the `:root` variables in the seed.

If no project DESIGN.md exists, pick a built-in system based on context:

- Dark/tech/productivity → `dark-tech.md`
- Light/clean/SaaS → `modern-minimal.md`
- Editorial/magazine/content → `editorial.md`

State which system you're using in one sentence.

### Step 1 — Read the seed template

**Read `seed.html` end-to-end** — at minimum through the `<style>` block.
The class inventory in `layouts.md` lists every class defined in the seed.
If one is missing, add it to `<style>` rather than re-defining it inline.

### Step 2 — Plan the section rhythm

**Pick layouts before writing copy.** From `layouts.md`, choose a rhythm:

| Page kind | Default rhythm                           |
| --------- | ---------------------------------------- |
| Landing   | hero → features → stats _or_ quote → cta |
| Marketing | hero → log-list → cta                    |
| Pricing   | hero → comparison → cta                  |
| Docs      | hero → log-list → cta                    |

State the chosen list in one sentence to the user **before** writing — they
can redirect cheaply now, not after 200 lines of HTML.

### Step 3 — Compose

1. Copy `seed.html` as the starting point.
2. Replace the six `:root` CSS variables with the design system's tokens.
3. Replace `<title>` and the topnav brand.
4. For each chosen section, copy the `<section>` block from `layouts.md` into
   `<main id="content">`.
5. Replace all `[REPLACE]` strings with **real, specific content** from the
   user's brief. No filler — if a slot is empty, the section is the wrong
   choice; pick a different layout.

### Step 4 — Optional: inline Canvas UI effects

If the design would benefit from visual flair (liquid hero background, glass
panels, particle reveal), check `canvas-ui/registry.json` for available
effects. Inline the component's vanilla JS source into the HTML. Use
sparingly — one effect per page maximum.

### Step 5 — Self-check

Run through the P0 checklist in `layouts.md`:

- [ ] Every `:root` variable from DESIGN.md — no invented colors
- [ ] Accent used at most 2× per screen
- [ ] No `[REPLACE]` placeholders remain
- [ ] No external image URLs (use `.ph-img`)
- [ ] Every `<section>` has `data-dd-id`
- [ ] Mobile reflow works at 920px

### Step 6 — Write the file

Write the completed HTML to:

```
.deeporca/designs/<descriptive-name>.html
```

Then send one short summary naming the file and what it contains. Do not
output the full HTML source in chat.

## Hard Rules

- **Single accent, used at most twice per screen.** Eyebrow + primary CTA is
  the default budget.
- **Image placeholders, not external URLs.** Use `.ph-img` — never link to a
  stock photo CDN.
- **Mobile reflow already works** via the seed's media query at 920px. Don't
  break it by adding fixed widths.
- **`data-dd-id` on every `<section>`** so comment mode can target it.
- **Self-contained single HTML** — all CSS inline in one `<style>` block. No
  external `<link>` or `<script src>`. The file must open in any browser.

## Output Contract

Write to `.deeporca/designs/<name>.html`. One short summary after writing.
Nothing after.
