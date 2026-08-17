# Macrostructure: Pricing Table

> Page skeleton fingerprint — visual system agnostic.

## Skeleton fingerprint

- **Title placement**: one short header line + billing toggle (monthly /
  annual) — the toggle is part of the title block, then the table starts.
- **Separation language**: plans are columns separated by gutters; exactly
  ONE plan may be highlighted (border/surface/accent) as recommended — the
  highlight is the page's single loudest signal.
- **Button voice**: one CTA per plan column, same component at same width in
  every column; the recommended plan's CTA is primary, all others ghost.
- **Image handling**: none. Checkmarks/x glyphs and, optionally, one small
  plan glyph per column header.
- **Reveal**: static; the billing toggle cross-fades numbers in place
  (≤150ms) — no re-layout, no reflow of column heights.

## Layout math

- 3-4 plan columns, equal width, feature rows aligned ACROSS columns (same
  feature name = same row height in every column); feature matrix scrolls as
  one unit under a sticky column-header row on mobile.

## Use when

SaaS pricing, plan pickers, tier comparison, package selection. Two plans
still work (2 columns + a comparison checklist below).

## Do not

- more than one highlighted plan;
- feature rows that don't align across columns (misaligned rows make
  comparison impossible — that is the whole page's job);
- hiding the price currency/period or the "per seat" basis.
