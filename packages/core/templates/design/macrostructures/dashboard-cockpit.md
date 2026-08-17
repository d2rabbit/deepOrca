# Macrostructure: Dashboard Cockpit

> Page skeleton fingerprint — visual system agnostic.

## Skeleton fingerprint

- **Title placement**: dense app-header (product name + view tabs + one
  primary action); page "title" is the current view name in the header, not
  a hero.
- **Separation language**: panels — bordered or surface-shifted rectangles
  with header rows; every panel is titled at caption size, uppercase or mono.
- **Button voice**: icon buttons in panel headers (refresh, configure); one
  primary action in the app header; no marketing CTAs anywhere.
- **Image handling**: no photography; visuals are charts, sparklines, heat
  cells, status glyphs.
- **Reveal**: data updates in place; entrance animation only on first load,
  ≤200ms, staggered per panel at most one step.

## Layout math

- 12-column grid parceled into panels; one KPI strip (3-5 stat cells) may run
  full width above the panel zone; no panel spans the full height.
- Consistent panel padding/header height across all panels — the cockpit
  reads as one machine, not a pile of widgets.

## Use when

Admin panels, monitoring, analytics, control surfaces, inbox/list tools. If
the user's primary verb is "monitor" or "operate", this is the skeleton.

## Do not

- hero sections, marketing copy, or testimonial blocks;
- panels without a header label;
- more than 2 levels of panel nesting.
