---
name: deep-design
description: >-
  Generate design-grade web artifacts using the .dd (OrcaDesign) format —
  YAML front-matter + HTML body with section markers. Use when users ask for
  design, 原型, 落地页, dashboard, 仪表盘, landing page, or UI 设计稿.
  Reads the project DESIGN.md brand contract, composes from seed tokens,
  produces a .dd file that DeepOrca renders to a live preview. Tailwind CSS
  utility classes are available (locally vendored, no CDN needed).
---

# DeepDesign — Generate Design-Grade Web Artifacts

Produce a `.dd` (OrcaDesign Document) file — a structured design format with
YAML metadata + HTML body. **Do not write raw HTML files.** The `.dd` format
gives you structured tokens, section markers for targeted editing, and live
preview in DeepOrca's right-side panel.

## Designing from a prototype (原型 → UI/UX 设计稿)

When the prompt embeds a prototype (an OpenUI Lang program), the prototype is
the interaction basis: the design must cover ALL of its pages and flows —
elevate each into a polished, visually designed section. Do not drop or rename
the prototype's functionality; your job is the UI/UX layer (visual system,
layout, typography, states), not re-scoping the product.

## When to Use

- User asks for a landing page / 落地页 / marketing page / homepage
- User asks for a prototype / 原型 / mockup / UI 设计稿
- User asks for a dashboard / 仪表盘 / admin panel / 后台
- User asks for a poster / 海报 / social media card
- User wants to design something visual and asks "can you make it look good?"

## The .dd Format

A `.dd` file has two parts:

### Part 1: YAML Front-matter (metadata + tokens)

```yaml
---
name: Acme Landing Page
system: dark-tech
style: glassmorphism
macrostructure: landing-flow
version: "1.0"
tokens:
  bg: "#0a0a0a"
  surface: "#1a1a1a"
  accent: "#3b82f6"
  text: "#f5f5f5"
  muted: "#888888"
  fontDisplay: "Iowan Old Style, Charter, Georgia, serif"
  fontBody: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  fontMono: "JetBrains Mono, monospace"
  maxWidth: "1200px"
  radius: "8px"
  gap: "24px"
sections:
  - id: hero
    type: hero
  - id: features
    type: features
  - id: cta
    type: cta
---
```

### Part 2: HTML Body (with section markers)

```html
<!-- dd:section hero -->
<section data-dd-id="hero" class="section">
  <div class="container">
    <p class="eyebrow">Introducing Acme</p>
    <h1 class="display">The Future of Design</h1>
    <p class="lead">AI-powered design at the speed of thought.</p>
    <a href="#signup" class="btn btn-primary">Get Started</a>
  </div>
</section>
<!-- /dd:section -->

<!-- dd:section features -->
<section data-dd-id="features" class="section">
  <div class="container">
    <h2>Why Choose Us</h2>
    <div class="grid grid-3">
      <div class="card">
        <div class="card-icon">⚡</div>
        <h3 class="card-title">Fast</h3>
        <p class="card-desc">Lightning quick iteration</p>
      </div>
    </div>
  </div>
</section>
<!-- /dd:section -->
```

### Key rules

- **Section markers are mandatory**: `<!-- dd:section xxx -->` ... `<!-- /dd:section -->`
- **Tokens map to CSS `:root` variables**: the compiler injects them automatically
- **Tailwind CSS is available**: use utility classes like `flex gap-4 rounded-xl`
  alongside the seed CSS classes (`.btn`, `.card`, `.grid`, etc.)
- **Self-contained**: the compiler adds the `<html>`, `<head>`, `<style>`, and
  Tailwind script — you only write the YAML + section HTML

## Available CSS Classes

| Class | Purpose |
|-------|---------|
| `.container` | Max-width wrapper (1200px default) |
| `.section` | Vertical padding (80px default) |
| `.grid`, `.grid-2/3/4` | CSS grid with gap |
| `.topnav`, `.topnav-inner`, `.topnav-brand`, `.topnav-links` | Sticky navigation |
| `.eyebrow` | Small uppercase accent label |
| `.display` | Large hero title |
| `.lead` | Muted lead paragraph |
| `.btn`, `.btn-primary`, `.btn-ghost` | Buttons with hover states |
| `.card`, `.card-icon`, `.card-title`, `.card-desc` | Feature cards |
| `.ph-img` | Placeholder image (no external URLs) |
| `.footer` | Footer with border-top |
| `.mono` | Inline code style |

## Workflow

### Step 0 — Read the brand contract

Check for a project-level `.deeporca/DESIGN.md`. If it exists, read it — its
colors, fonts, spacing become the tokens in the YAML front-matter.

If no project DESIGN.md exists, pick a built-in system. Full token presets
(typography pairing, motion, components) live in `templates/design/systems/<name>.md`;
the table carries the essential tokens:

| System | Character | Pick when |
|--------|-----------|-----------|
| `dark-tech` | Dark, compact, indigo accent `#6366f1`, serif display + mono labels | Tech/productivity tools, dashboards |
| `modern-minimal` | Light, airy, blue accent `#0070f3`, generous whitespace | Clean SaaS, corporate sites, docs |
| `editorial` | Warm white, serif, dark-red accent `#8b0000`, sharp edges, print grid | Magazine, long-form reading, essays |
| `brutalist-contrast` | Cream, hot-pink accent `#ff5d8f`, black borders + hard shadows, chunky type | Loud marketing, creative tools, youth brands |
| `swiss-international` | Pure white, Swiss red `#d30000`, strict grid, grotesque type only | Systematic corporate, studios, typography-forward |
| `terminal-mono` | Near-black, phosphor green `#00e676`, all monospace, dense | Developer tools, changelogs, hacker branding |
| `glass-morphism` | Deep-indigo gradient, frosted panels, cyan `#22d3ee`, floating depth | Product launches, media/crypto, hero-heavy pages |
| `soft-neumorphic` | Pale single-hue ground `#e0e5ec`, extruded soft shadows, no borders | Calm utility apps, wellness, settings screens |
| `warm-handcrafted` | Cream + terracotta `#a34722`, humanist serif, stitched dashed borders | Artisanal/DTC, food & craft, nonprofit |

### Step 1 — Read seed.html for reference

Read `seed.html` to understand the class system and default styles. You don't
copy seed.html anymore — you write a .dd file from scratch using its classes.

### Step 2 — Plan the section rhythm

Pick TWO things before writing content: the page **macrostructure** (skeleton)
and then the section rhythm within it.

**Macrostructure** (skeleton fingerprint — which sections, in what shape).
Full definitions live in `templates/design/macrostructures/<name>.md` (~30
lines each; read only the one you pick). Declare the choice in the YAML
front-matter as `macrostructure: <name>`:

| Macrostructure | Pick when |
|----------------|-----------|
| `landing-flow` | Classic conversion funnel (hero → proof → features → CTA). The default-slop shape — choosing it requires saying why none of the other nine fit |
| `bento-grid` | "Everything we do" overview; mixed-size cells, grid IS the hero |
| `long-document` | Content read top-to-bottom (essays, docs, policies) — one measure, no cards |
| `manifesto` | A page that argues: few huge statements, one action, mostly whitespace |
| `type-specimen` | Typography as the artwork (font pages, identity reveals) |
| `editorial-spread` | Pairwise chapters (text + visual per unit); magazine rhythm |
| `dashboard-cockpit` | Monitor/operate surfaces: panels, KPI strip, zero marketing |
| `product-gallery` | Homogeneous items grid (store, catalog, assets) |
| `pricing-table` | Plan comparison; aligned feature rows, one highlighted plan |
| `documentation-hub` | Search-first reference; nav rail + content + outline |

The macrostructure is stack-agnostic (works for `.dd`, OpenUI, or raw HTML)
and is one of the computable diversity axes — taste #11 requires consecutive
designs to vary; skeleton choice is where that variation starts.

Then pick the section rhythm **within** the macrostructure:

| Page kind | Default rhythm |
|-----------|----------------|
| Landing | hero → features → stats → cta |
| Marketing | hero → log-list → cta |
| Pricing | hero → comparison → cta |
| Dashboard | hero → stats → features |

Large pages (>6 sections or >1500 words of content): use the optional two-stage
flow in Step 2b instead of writing straight through.

State the chosen sections to the user **before** writing.

### Step 2b — Two-stage generation (OPTIONAL — large pages only)

Use **only** for LARGE pages: more than 6 sections or more than 1500 words of
content. Small pages skip this entirely and go straight to Step 3.

- **Stage A — skeleton**: output the section skeleton only (~10 lines): section
  ids, the rhythm table, and a one-line intent per section. No content, no HTML.
- **Confirm**: ask the user via `AskUserQuestion` (proceed / adjust sections /
  drop sections). If the user pre-approved the plan or said not to ask, proceed
  without asking.
- **Stage B — fill**: write the full .dd file per the confirmed skeleton,
  following Steps 3-7 as usual.

Rationale: on a large page a wrong section plan wastes the entire fill pass — a
10-line skeleton makes the correction cheap.

### Step 3 — Write the .dd file

1. Write the YAML front-matter with tokens from the chosen design system.
2. List sections in the `sections:` array.
3. Write each section's HTML between `<!-- dd:section xxx -->` markers.
4. Use seed CSS classes + Tailwind utilities for styling.
5. Replace all placeholder text with **real, specific content**.

### Step 4 — Call render_design

Call the `render_design` MCP tool with the full .dd content. The preview panel
opens automatically showing the compiled design.

### Step 5 — Self-check (P0 rules)

- [ ] Title and body use different sizes/weights
- [ ] All spacing on 4px/8px scale
- [ ] One accent color throughout
- [ ] Every button has hover state
- [ ] Images use `.ph-img`, not external URLs
- [ ] Mobile reflow works (grids collapse at 920px)
- [ ] Every `<section>` has `data-dd-id` and section markers

### Step 6 — Iterate

When the user requests changes:
1. Edit the specific section in the .dd content.
2. Call `update_design` with the full updated .dd content.
3. Preview refreshes automatically.

### Step 7 — Save

Write the .dd file to `.deeporca/designs/<name>.dd` for persistence.

## Hard Rules

- **Single accent, used at most twice per screen.** Eyebrow + primary CTA is
  the default budget.
- **Image placeholders, not external URLs.** Use `.ph-img`.
- **`data-dd-id` on every `<section>`** and wrap in section markers.
- **Tokens from design system** — don't invent colors not in the token list.
- **Tailwind utilities OK** — they augment the seed CSS, don't replace it.

## Output Contract

Call `render_design` with the .dd content for preview.
Write to `.deeporca/designs/<name>.dd` for persistence.
One short summary after. Nothing after.
