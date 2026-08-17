# Macrostructure: Bento Grid

> Page skeleton fingerprint — visual system agnostic (pairs with any
> `templates/design/systems/` preset; the tokens decide the look, this file
> decides the structure).

## Skeleton fingerprint

- **Title placement**: small eyebrow + compact title top-left, immediately
  followed by the grid — the grid IS the hero, not the title.
- **Separation language**: no rules, no card borders by default — cells are
  separated by whitespace and surface shifts; at most one divider per screen.
- **Button voice**: one quiet text-link or ghost button per cell max; a single
  primary CTA may live inside the largest cell.
- **Image handling**: images fill entire cells edge-to-edge (no framed
  thumbnails), mixed 1-3 cells wide/tall.
- **Reveal**: all cells visible at once (static composition); hierarchy comes
  from cell size contrast, not sequencing.

## Layout math

- CSS grid, 4 columns desktop (2 tablet, 1 mobile) with one dominant cell
  spanning 2×2; the remaining cells vary spans — no two adjacent cells the
  same width unless deliberately paired.
- Cell radius and padding constant across all cells; gutters on the 4/8 scale.

## Use when

Product overviews, feature matrices, personal/portfolio homepages, "everything
we do" pages. Avoid for long reading or single-message pages — the grid
distributes attention, it does not focus it.

## Do not

- More than 7 cells (bento collapses into a card wall);
- identical spans across all cells (that is a feature grid, see Landing Flow);
- nested grids inside cells deeper than one level.
