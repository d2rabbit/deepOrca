# Design System: Swiss International

> International Typographic Style — white ground, strict grid, one red accent,
> typography does all the work. Flat, systematic, asymmetric.
> **When to pick this**: corporate/systematic sites, architecture and design studios,
> typography-forward portfolios where the grid itself is the aesthetic.

## Color

- Background: `#ffffff`
- Surface: `#f0f0ee`
- Accent: `#d30000` (Swiss red — max 2 uses per screen)
- Text: `#111111`
- Muted: `#595959`

## Typography

- Display: grotesque (Helvetica Neue / Inter / system-ui), weight 700, tight leading (1.1)
- Body: same grotesque family, weight 400, line-height 1.6
- Hierarchy by size step only (mathematical scale, e.g. ×1.5) — never by typeface change
- Flush-left, ragged-right alignment; no centered text

## Layout

- Max-width: 1200px
- Section padding: 80px vertical
- Grid: strict 12-column, 24px gutter — columns are visible structure, may break asymmetrically
- Card radius: 0
- Button radius: 0
- Rules: 1px solid `#111111` (full strength — Swiss rules don't fade)

## Motion

- Transitions: 150ms opacity or color only
- Hover: underline reveal or invert (white bg ↔ red bg)
- No lifts, no shadows — the page is printed, not floating

## Components

- Button primary: accent background, white text, no radius, no shadow, hover inverts to white bg + red border + red text
- Button ghost: transparent, 1px `#111111` border
- Card: surface background, no border, no shadow, 32px padding
- Images: full-bleed to grid edges, captions in mono 12px left-aligned
- Section dividers: 1px solid `#111111` horizontal rules
- Focus: 2px solid `#111111` outline — the only "decoration" allowed on interaction
