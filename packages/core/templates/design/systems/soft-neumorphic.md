# Design System: Soft Neumorphic

> Soft UI — controls extruded from a single pale matte ground by dual light/dark
> shadows. No borders, big radii, one saturated accent for the primary action.
> **When to pick this**: calm utility apps, wellness/light-finance dashboards, music
> players, settings screens. Avoid dense tables — softness hurts scannability.

## Color

- Background: `#e0e5ec` (the only ground — surfaces share it exactly)
- Surface: `#e0e5ec` (shape comes from shadow, never from fill or border)
- Accent: `#4756d7` (indigo — the one saturated color, primary action only)
- Text: `#2d3748`
- Muted: `#4f5a70`

## Typography

- Display: rounded humanist sans (Nunito / ui-rounded / system-ui), weight 700
- Body: same family, weight 400, 16px, line-height 1.6
- Mono: monospace for numerics in toggles/meters

## Layout

- Max-width: 1080px
- Section padding: 80px vertical
- Grid: 12-column, 24px gap
- Card radius: 24px (oversized — softness is the identity)
- Button radius: 16px
- No borders anywhere — division is shadow and space only

## Motion

- Transitions: 200ms ease
- Press: shadows invert to inset (control sinks into the ground)
- Hover: shadow widens slightly, no color jumps

## Components

- Raised (default): `box-shadow: -6px -6px 12px rgba(255,255,255,0.85), 6px 6px 12px rgba(163,177,198,0.6)`
- Pressed/active: the same pair inset
- Button primary: accent background, white text, raised shadow, press sinks
- Button ghost: ground fill, raised shadow, text color
- Card: ground fill, raised shadow, 32px padding
- State cue rule (WCAG): shadows alone never indicate state — pair every
  checked/error state and focus with a non-shadow cue (2px accent outline offset 2px)
- Image placeholder: inset (concave) surface, no external URLs
