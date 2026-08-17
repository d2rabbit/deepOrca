# Design System: Terminal Mono

> Hacker/CLI aesthetic — phosphor green on near-black, monospace everything,
> ASCII dividers, dense information. The interface is a shell transcript.
> **When to pick this**: developer tools, CLI products, changelogs, tech branding
> that wants credibility with engineers. Avoid for consumer warmth or luxury.

## Color

- Background: `#0b0f0c` (near-black, green-tinted)
- Surface: `#121a13`
- Accent: `#00e676` (phosphor green — max 2 uses per screen)
- Text: `#c9f7cf`
- Muted: `#7fae86`
- Borders: 1px solid `#263528`

## Typography

- Display: monospace (JetBrains Mono / SF Mono / Menlo), weight 700, uppercase
- Body: same monospace, weight 400, 14px — density is the character
- Hierarchy by size, weight, and color only — never by typeface change
- Prompt glyphs (`$`, `>`, `#`) as eyebrows; ASCII dividers (`──`, `==`)

## Layout

- Max-width: 960px (terminal column)
- Section padding: 48px vertical
- Grid: 12-column, 16px gap — compact
- Card radius: 0
- Button radius: 0

## Motion

- Transitions: 80-120ms, near-instant (keystroke speed)
- Hover: invert — accent background with `#0b0f0c` text
- Cursor-blink animations sparingly, honor `prefers-reduced-motion`

## Components

- Button primary: accent background, `#0b0f0c` text, mono uppercase, 1px accent border
- Button ghost: transparent, 1px `#00e676` border, accent text, hover inverts
- Card: surface background, 1px solid `#263528` border, 24px padding
- Window chrome: title bar with `● ● ●` dots in muted, mono title
- Image placeholder: surface fill with ASCII-art or scanline texture, no external URLs
- Focus: 2px dashed `#00e676` outline — terminal selection feel
