# Macrostructure: Documentation Hub

> Page skeleton fingerprint — visual system agnostic.

## Skeleton fingerprint

- **Title placement**: no page hero — a search field IS the title block,
  full-width, auto-focused; logo and version selector flank it.
- **Separation language**: three permanent zones — nav tree (left), content
  (center), on-this-page outline (right); zones separated by persistent
  borders, never cards.
- **Button voice**: copy/try-it chips attached to code blocks; "edit this
  page" text link at content foot; no primary buttons.
- **Image handling**: architecture diagrams and screenshots inline at content
  width; a floating "was this helpful" widget at page foot.
- **Reveal**: content swaps without animation; the nav tree's active node
  highlight moves instantly. Motion budget is zero.

## Layout math

- Fixed side rails (nav ≈240px, outline ≈180px), fluid center with the
  60-72ch measure; rails collapse to drawers below 920px — the content zone
  never narrows below the measure.

## Use when

API references, guides, handbooks, internal wikis, knowledge bases. The
user's verb is "find and read a specific thing" — search-first, browse-second.

## Do not

- marketing sections mixed into the nav;
- cards inside the content zone (callouts are bordered aside blocks, not cards);
- animating route transitions between docs pages.
