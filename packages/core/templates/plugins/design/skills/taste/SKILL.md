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
