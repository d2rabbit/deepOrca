# Design System: Glass Morphism

> Frosted translucent panels floating over a vivid deep-indigo gradient —
> blurred glass, thin light borders, layered depth.
> **When to pick this**: splashy product launches, media/entertainment, crypto/Web3,
> hero-heavy pages with rich visual backdrops. Avoid for dense data or long reading.

## Color

- Background: `#12122e` (deep indigo — base of a fixed gradient backdrop)
- Surface: `rgba(255,255,255,0.12)` over the backdrop, solid fallback `#1d1d42`
- Accent: `#22d3ee` (cyan — max 2 uses per screen)
- Text: `#f2f4ff`
- Muted: `#a5b1e8`
- Panel border: 1px solid `rgba(255,255,255,0.25)`

## Typography

- Display: geometric sans ("Avenir Next" / "Century Gothic" / "Segoe UI"), weight 700, generous sizes (40-56px)
- Body: same sans, weight 400, 16px, line-height 1.6
- Light weights (300) for large muted leads — size carries the hierarchy

## Layout

- Max-width: 1100px
- Section padding: 96px vertical
- Grid: 12-column, 32px gap — panels float apart
- Card radius: 20px
- Button radius: 999px (pill)
- Backdrop: fixed full-page `linear-gradient(135deg, #12122e, #2b1d5e, #12122e)`

## Motion

- Transitions: 250-350ms, `cubic-bezier(0.4, 0, 0.2, 1)`
- Hover lift: translateY(-4px) + shadow deepens
- Backdrop never moves — only panels animate above it

## Components

- Panel/card: `rgba(255,255,255,0.12)`, `backdrop-filter: blur(16px)`, light border,
  shadow `0 8px 32px rgba(0,0,0,0.3)`, 32px padding
- Button primary: accent background, `#0b1120` text, pill, hover lifts
- Button ghost: `rgba(255,255,255,0.08)` glass fill, light border, text color
- Scrim rule: text never sits directly on the gradient — it sits on a panel; if a
  photographic backdrop region turns light, add a darker scrim layer under the text
- Image placeholder: gradient fills inside glass frames, no external URLs
- Focus: 2px solid `#22d3ee` outline offset 2px
