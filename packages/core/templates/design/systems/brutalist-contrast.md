# Design System: Brutalist Contrast

> Neobrutalism — cream ground, saturated blocks, black borders, hard offset shadows.
> **When to pick this**: bold marketing pages, creative tools, youth brands, portfolio
> pieces that need loud energy. Avoid for enterprise trust, finance, or healthcare.

## Color

- Background: `#fef6e4` (cream)
- Surface: `#ffffff` (always inside a 2px black border)
- Accent: `#ff5d8f` (hot pink — max 2 uses per screen, black text only)
- Decorative fill: `#ffd23f` (yellow — blocks/badges only, never accent-duty)
- Text: `#111111`
- Muted: `#5a5a5a`

## Typography

- Display: heavy grotesque (Archivo Black / Arial Black), weight 900, tight tracking
- Body: sans-serif ("Helvetica Neue" / Arial), weight 400
- Mono: monospace (Space Mono / monospace) for labels and stickers
- Headlines are chunky and short; body stays quiet at 15-16px

## Layout

- Max-width: 1200px
- Section padding: 64px vertical (48px on mobile)
- Grid: 12-column, 24px gap
- Card radius: 0 (sharp — hard edges carry the style)
- Button radius: 0
- Border language: 2-3px solid `#111111` on every element, offset shadow `4px 4px 0 #111111`

## Motion

- Transitions: 100-150ms, no easing softness (steps or ease-out)
- Press: `transform: translate(4px, 4px)` with the shadow removed
- Hover: fill color swaps to accent or decorative yellow

## Components

- Button primary: accent background, `#111111` text, 2px black border + hard shadow
- Button ghost: white background, 2px black border, hover swaps to yellow fill
- Card: white background, 2px black border, hard shadow, 24px padding
- Focus: 3px solid `#111111` outline offset 3px — distinct from decorative borders
- Image placeholder: yellow or cream block with 2px black border, no external URLs
- Stickers/badges: decorative yellow fills, mono uppercase labels, rotated -2deg max
