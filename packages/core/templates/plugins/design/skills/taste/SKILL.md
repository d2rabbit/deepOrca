---
name: taste
description: >-
  Front-end design quality discipline — anti-slop methodology for layout,
  typography, spacing, color, and animation. Apply these rules when generating
  any UI output (DeepDesign .dd files, A2UI/OpenUI prototypes, or raw HTML).
  This skill is framework-agnostic: the principles apply regardless of whether
  you use CSS classes, Tailwind utilities, or component props.
---

# taste — Design Quality Discipline

You are a designer with taste. Every UI element you produce must pass these
checks. "Slop" is output that looks AI-generated — generic, inconsistent, and
careless. This skill eliminates slop.

## P0 — Non-negotiable rules (every output must pass)

1. **Title ≠ Body** — The page title and body text MUST use different font sizes
   AND different font weights. Minimum ratio: title ≥24px/700, body ≤16px/400.

2. **Spacing is a system** — All padding/margin/gap values come from a 4px/8px
   scale (4, 8, 12, 16, 24, 32, 48, 64, 80). No `13px`, `7px`, `22px`. Use CSS
   variables or Tailwind spacing tokens.

3. **One accent color** — A single `--accent` color drives all interactive
   elements (buttons, links, focus rings). Don't introduce a second accent
   unless the design system explicitly defines it.

4. **Contrast ≥ 4.5:1** — Text on background must pass WCAG AA. If `--text` on
   `--bg` is borderline, darken `--text` or lighten `--bg`. Never use
   `--muted` for body text — it's for secondary/caption text only.

5. **Every button has hover** — `btn-primary:hover` must show visible feedback
   (brightness change, translate, or shadow). No static buttons.

6. **Images have placeholders** — Never use broken `<img src="">` or external
   URLs that may 404. Use `.ph-img` class or a colored div with aspect-ratio.

7. **Mobile reflow works** — At ≤920px, grids collapse to 1 column, nav links
   hide or become a hamburger. Test mentally: does the layout stack vertically?

8. **Sections breathe** — Each `<section>` has `padding: var(--section-pad-y, 80px) 0`.
   No section touches the next without breathing room.

9. **No orphan headings** — A heading must always be followed by content
   (paragraph, items, or visual). Never a heading at the bottom of a section.

10. **Consistent border-radius** — All cards, buttons, inputs use the same
    `--radius` value. Don't mix `4px` on one card and `12px` on another.

11. **Differ from your recent work (anti-slop diversity)** — Before finalizing a
    design, list the recent artifacts in `.deeporca/designs/` (via the design
    tools or the `read` tool — names + a quick scan of each file's tokens and
    section list are enough). The new design must differ from the 3 most recent
    artifacts in BOTH axes: layout skeleton (which sections, in what structure)
    and palette emphasis (which color family dominates). If it is too similar to
    any of them, deliberately vary one axis — swap the layout skeleton or shift
    the accent/palette family — then re-verify.

## Typography ladder

Use this scale consistently:

| Role | Size | Weight | Class |
|------|------|--------|-------|
| Display/Hero title | 32-56px | 800 | `.display` |
| Section title (H2) | 24-36px | 700 | `h2` |
| Card title (H3) | 18px | 600 | `.card-title` / `h3` |
| Body text | 14-16px | 400 | `p` / `.lead` |
| Caption/Label | 11-12px | 500-600 | `.eyebrow` / `.caption` |
| Monospace/code | 13px | 400 | `.mono` |

**Line height**: 1.5-1.7 for body, 1.1-1.2 for headings.

## Color discipline

- **Background hierarchy**: `--bg` (page) → `--surface` (cards) → `--surface-alt` (hover)
- **Text hierarchy**: `--text` (primary) → `--muted` (secondary) → never lighter
- **Accent usage**: buttons, links, focus rings, eyebrow labels ONLY
- **Dark mode**: `--bg: #0a0a0a`, `--surface: #1a1a1a`, `--text: #f5f5f5`
- **Light mode**: `--bg: #fafafa`, `--surface: #ffffff`, `--text: #1a1a1a`

## Animation discipline

- **Duration**: 150-300ms for hover/state, 400-600ms for layout transitions
- **Easing**: `ease` or `cubic-bezier(0.4, 0, 0.2, 1)` — never `linear` for UI
- **Hover feedback**: at minimum `opacity` or `transform: translateY(-1px)`
- **No layout thrash**: hover should NOT change element size (use
  transform/opacity/shadow, not width/height/padding)

## Layout patterns

### Hero section
```
[eyebrow]          ← small, accent color
[Display Title]    ← large, bold
[Lead paragraph]   ← muted, max 60ch
[CTA button]       ← primary, with hover
```

### Feature grid
```
[Section title]
[grid grid-3]
  [card] × 3       ← icon + title + desc, equal height
```

### Stats row
```
[grid grid-3]
  [number]         ← large (28-48px), bold
  [label]          ← small, muted, uppercase
  [trend]          ← accent color, optional
```

## Self-check before submitting

Before calling `render_design` or `render_openui`, verify:
- [ ] Title and body use different sizes/weights
- [ ] All spacing values are on the 4/8 scale
- [ ] One accent color throughout
- [ ] Every button has a hover state
- [ ] Images use placeholders, not broken links
- [ ] Mobile layout stacks to 1 column
- [ ] Sections have vertical padding
- [ ] Border-radius is consistent

## Five-dimension critique (五维自评)

After rendering — judge the real output, not the plan — self-score the design
1-5 on each dimension:

| # | Dimension | Ask yourself |
|---|-----------|--------------|
| 1 | Hierarchy 层级 | Is the eye led correctly? Title dominates body, one focal point per view, scanning order is deliberate. |
| 2 | Rhythm 节奏 | Do sections alternate density and pace, or does every section carry the same weight? Spacing breathes. |
| 3 | Contrast 对比 | Size/weight/color contrast where it matters; every text/background pair ≥4.5:1. |
| 4 | Restraint 克制 | One accent, no decoration without purpose, nothing screams. Deleted more than added. |
| 5 | Craft 细节工艺 | Alignment, consistent radius, hover states, spacing on scale — details a human designer would catch. |

Gate: **every dimension ≥3 AND total ≥20** before delivering. If below, iterate
the weakest dimension once, re-score, then deliver anyway — and note the honest
final scores in your reply, e.g. `五维自评: 层级4 节奏3 对比5 克制4 工艺4 = 20`.
