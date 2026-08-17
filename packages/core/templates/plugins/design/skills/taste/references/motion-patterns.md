# Motion Patterns — named choreography vocabulary

> Load tier: read this file ONLY when the artifact actually includes motion
> (entrance reveals, hover choreography beyond simple state swaps, or any
> `@keyframes` in a `.dd`). Static pages: the 6-line Animation discipline
> section in SKILL.md is enough — do not load this file.
>
> Provenance: common-motion idioms restated in our own words, inspired by the
> conventions of publicly circulating motion-design corpora. No external
> prompt or asset is reproduced here. Discipline authority remains the taste
> skill; this file supplies vocabulary, not rules.

Ten named patterns. Each: intent, pure-CSS skeleton, recommended timing, and
the `prefers-reduced-motion` fallback. Every skeleton is self-contained
(no JS, no external assets) — the `.dd` contract holds.

Shared conventions:

- Easing tokens: `--ease-out: cubic-bezier(0.25, 0.1, 0.25, 1)` (the default
  reveal easing), `--ease-snap: cubic-bezier(0.4, 0, 0.2, 1)` (state swaps).
- All patterns below must sit behind `@media (prefers-reduced-motion: no-preference)`;
  the reduced-motion fallback for every entrance pattern is **visible, no
  transform** (opacity 1, transform none — never leave content hidden).
- Stagger ladder: children delay in 60–90ms steps (`.05s / .1s / .15s`…);
  never stagger more than 6 elements.

## 1. ClipReveal — masked line rise

Text or media rises out of an overflow-hidden mask. The workhorse for
headlines.

```css
.clip-reveal { overflow: hidden; }
.clip-reveal > * {
  transform: translateY(100%);
  animation: clip-rise 0.7s var(--ease-out) forwards;
}
@keyframes clip-rise { to { transform: translateY(0); } }
```

Timing: 0.6–0.7s, ease-out. Do not use for body paragraphs (one element per
viewport moment).

## 2. WordStagger — word-by-word fade-up

Each word wrapped in a span; identical animation offset by the ladder.

```css
.word-stagger span { display: inline-block; opacity: 0; transform: translateY(0.4em);
  animation: word-in 0.55s var(--ease-out) forwards; }
.word-stagger span:nth-child(2) { animation-delay: 0.06s; }
/* … ladder ≤6 steps */
@keyframes word-in { to { opacity: 1; transform: none; } }
```

Timing: 0.5–0.6s per word, 60–90ms stagger. One line max — a paragraph
word-staggered is noise.

## 3. BlurIn — focus pull

Element enters from slight blur + low opacity; sharpens as it lands. Use for
hero imagery or single statements — at most once per page.

```css
.blur-in { filter: blur(8px); opacity: 0;
  animation: focus-pull 0.9s var(--ease-out) forwards; }
@keyframes focus-pull { to { filter: blur(0); opacity: 1; } }
```

Timing: 0.8–0.9s. Pairs with ClipReveal on the same hero (text clips, image
pulls focus) — the two share one duration scale.

## 4. DelayLadder — sequenced section entrance

No special keyframes: the SAME fade-up applied to siblings with stepped
`animation-delay`. The pattern is the ladder, not the animation.

```css
.ladder > * { opacity: 0; transform: translateY(12px);
  animation: ladder-in 0.5s var(--ease-out) forwards; }
.ladder > *:nth-child(2) { animation-delay: 0.1s; }
.ladder > *:nth-child(3) { animation-delay: 0.2s; }
@keyframes ladder-in { to { opacity: 1; transform: none; } }
```

Steps: 0.05–0.1s increments, ≤6 children, identical animation per child.
If you need a 7th step, the section is too granular.

## 5. CountUp — numeric odometer

Numbers that tick upward on entrance. Pure CSS: a vertical digit strip
translated by steps.

```css
.countup { display: inline-block; overflow: hidden; height: 1em; }
.countup .strip { display: flex; flex-direction: column;
  animation: tick 0.8s var(--ease-out) steps(9) forwards; }
@keyframes tick { to { transform: translateY(-9em); } } /* strip holds 0…9 */
```

Timing: 0.6–0.8s, steps() easing (NOT smooth — odometers snap). Use for
stats rows only; never animate more than 3 numbers on one screen.

## 6. Marquee — infinite band

Content band scrolling at constant speed. Logos, ticker lines, tags.

```css
.marquee { overflow: hidden; }
.marquee .track { display: flex; gap: 2rem; width: max-content;
  animation: slide 20s linear infinite; }
@keyframes slide { to { transform: translateX(-50%); } } /* track duplicated 2× */
```

Timing: 15–30s per loop (speed, not duration, is the design decision —
target 40–80px/s). `linear` is correct HERE only (constant velocity is the
point); duplicate the track content so the loop is seamless. Marquee must
pause on hover and stops entirely under reduced-motion.

## 7. ScrollReveal — enter on viewport entry

The scroll-linked variant of DelayLadder: `animation-timeline: view()` where
supported, IntersectionObserver-free.

```css
@supports (animation-timeline: view()) {
  .scroll-reveal { animation: reveal linear both; animation-timeline: view();
    animation-range: entry 0% entry 60%; }
  @keyframes reveal { from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: none; } }
}
```

Graceful degradation: browsers without view-timelines show content
immediately (the `@supports` guard keeps it visible). Range must complete by
60% of entry — the element must finish revealing before it reaches center.

## 8. RiseFall — hover lift with grounding

Hover feedback with a settled return: rise a little, gain a soft shadow that
reads as the lift's cause.

```css
.lift { transition: transform 0.2s var(--ease-snap),
  box-shadow 0.2s var(--ease-snap); }
.lift:hover { transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.12); }
```

Timing: 0.15–0.2s. The -2px is a vocabulary token: -1px whisper (links in
dense lists), -2px standard (cards/buttons), -4px banner (the ONE element a
screen may emphasize). Same value everywhere per tier — hover scale is NOT
part of this vocabulary.

## 9. CrossFade — content swap

Two states of the same slot fade through each other (pricing toggle, tab
panels, slide decks).

```css
.swap { position: relative; }
.swap .pane { transition: opacity 0.35s var(--ease-snap); }
.swap .pane[aria-hidden="true"] { opacity: 0; pointer-events: none;
  position: absolute; inset: 0; }
```

Timing: 0.3–0.4s, opacity ONLY (no transform — the slot must not reflow).
Both panes stay mounted; visibility is `pointer-events`, not `display`.
`transition-all` is forbidden for this — name the property.

## 10. LayerSlide — stacked drawer reveal

A panel slides over a dimmed base (sheets, notifications, nav drawers).

```css
.drawer { transform: translateX(100%); transition: transform 0.3s var(--ease-snap); }
.drawer.open { transform: translateX(0); }
.scrim { opacity: 0; transition: opacity 0.3s var(--ease-snap); }
.scrim.show { opacity: 1; }
```

Timing: 0.3s, both layers synchronized to the same duration/easing (a scrim
that lags the drawer reads as a bug). Transform only — a drawer that animates
`left`/`width` triggers layout on every frame.

---

## Choosing (the vocabulary in one breath)

Headline → ClipReveal · hero image → BlurIn · stats → CountUp · lists/cards →
DelayLadder · logos/ticker → Marquee · section sequence → ScrollReveal ·
hover → RiseFall · toggles → CrossFade · overlays → LayerSlide · one special
line → WordStagger. Two different patterns maximum per viewport; three on a
full landing page is the ceiling. When in doubt, delete the animation —
motion earns its place by directing attention, not by proving the page is
alive.
