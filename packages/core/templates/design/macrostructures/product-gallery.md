# Macrostructure: Product Gallery

> Page skeleton fingerprint — visual system agnostic.

## Skeleton fingerprint

- **Title placement**: minimal header — brand mark + collection name at
  caption scale; the products start almost immediately.
- **Separation language**: the grid gutters and image aspect ratios carry the
  structure; text sits BELOW each tile (name, one spec line, price) in a
  strict repeated micro-layout.
- **Button voice**: "Add" / "Select" per tile as a quiet chip or text action;
  one cart/next action pinned to the header or footer bar.
- **Image handling**: every tile same aspect ratio, object-fit cover, empty
  slots kept as placeholders rather than breaking the grid.
- **Reveal**: tiles may stagger-fade ≤100ms apart on load; hover reveals the
  tile action ONLY (no zoom-to-warp, no cross-tile motion).

## Layout math

- Responsive square-or-4:5 tiles, 3-4 per row desktop, 2 tablet, 1-2 mobile;
  filter/sort bar above the grid right-aligned, result count left-aligned.

## Use when

Stores, catalogs, asset libraries, template markets, portfolio grids of
homogeneous items. Heterogeneous items (different shapes/importance) belong
in a Bento Grid instead.

## Do not

- tiles with different aspect ratios in one grid;
- editorial paragraphs inside tiles (one spec line maximum);
- hiding the result count or filter state.
