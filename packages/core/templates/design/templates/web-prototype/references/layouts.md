# Web Prototype — Section Layouts

> Paste-ready section skeletons for the `seed.html` `<main id="content">` block.
> Each section carries `data-dd-id` for comment targeting. Replace all
> `[REPLACE]` placeholders with real, specific content — no filler.

## Class inventory

All classes are defined in `seed.html` `<style>`. Available sections:

| #   | Section    | Use for                                   |
| --- | ---------- | ----------------------------------------- |
| 1   | hero       | Page opener with headline + CTA           |
| 2   | features   | 3-column feature grid with icons          |
| 3   | stats      | Numeric highlights (big numbers)          |
| 4   | quote      | Single testimonial / pull quote           |
| 5   | cta        | Final call-to-action band                 |
| 6   | log-list   | Text list (docs sections, changelog, FAQ) |
| 7   | split      | 50/50 image + text                        |
| 8   | comparison | Pricing / feature comparison table        |

## Default rhythms by page kind

| Page kind             | Default rhythm                                     |
| --------------------- | -------------------------------------------------- |
| Landing               | 1 hero → 2 features → 3 stats _or_ 4 quote → 5 cta |
| Marketing / editorial | 1 hero → 7 log-list → 5 cta                        |
| Pricing               | 1 hero → 8 comparison → 5 cta                      |
| Docs index            | 1 hero → 7 log-list → 5 cta                        |

State the chosen list in one sentence to the user **before** writing.

---

## 1. Hero

```html
<section class="section" data-dd-id="hero">
  <div class="container" style="text-align: center; max-width: 800px; margin: 0 auto;">
    <span class="eyebrow">[REPLACE: eyebrow text]</span>
    <h1 class="display" style="margin: 16px 0;">[REPLACE: compelling headline]</h1>
    <p class="lead" style="margin: 0 auto 32px;">[REPLACE: subheadline explaining the value prop in one sentence]</p>
    <div style="display: flex; gap: 16px; justify-content: center;">
      <a href="#" class="btn btn-primary">[REPLACE: primary CTA]</a>
      <a href="#" class="btn btn-ghost">[REPLACE: secondary CTA]</a>
    </div>
  </div>
</section>
```

## 2. Features (3-column)

```html
<section class="section" data-dd-id="features" id="features">
  <div class="container">
    <div class="grid grid-3">
      <div class="card">
        <div class="card-icon">[REPLACE: emoji or SVG]</div>
        <h3 class="card-title">[REPLACE: feature title]</h3>
        <p class="card-desc">[REPLACE: one-sentence description of what this feature does and why it matters]</p>
      </div>
      <div class="card">
        <div class="card-icon">[REPLACE]</div>
        <h3 class="card-title">[REPLACE]</h3>
        <p class="card-desc">[REPLACE]</p>
      </div>
      <div class="card">
        <div class="card-icon">[REPLACE]</div>
        <h3 class="card-title">[REPLACE]</h3>
        <p class="card-desc">[REPLACE]</p>
      </div>
    </div>
  </div>
</section>
```

## 3. Stats

```html
<section class="section" data-dd-id="stats">
  <div class="container">
    <div class="grid grid-4" style="text-align: center;">
      <div>
        <div class="display" style="font-size: 40px; color: var(--accent);">[REPLACE: number]</div>
        <p class="card-desc">[REPLACE: label]</p>
      </div>
      <div>
        <div class="display" style="font-size: 40px;">[REPLACE]</div>
        <p class="card-desc">[REPLACE]</p>
      </div>
      <div>
        <div class="display" style="font-size: 40px;">[REPLACE]</div>
        <p class="card-desc">[REPLACE]</p>
      </div>
      <div>
        <div class="display" style="font-size: 40px;">[REPLACE]</div>
        <p class="card-desc">[REPLACE]</p>
      </div>
    </div>
  </div>
</section>
```

## 4. Quote

```html
<section class="section" data-dd-id="quote">
  <div class="container" style="max-width: 760px; text-align: center;">
    <blockquote class="display" style="font-size: 28px; font-weight: 400; line-height: 1.4; margin-bottom: 24px;">
      "[REPLACE: a real, specific quote — not a generic platitude]"
    </blockquote>
    <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
      <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--surface);" class="ph-img"></div>
      <div style="text-align: left;">
        <div style="font-weight: 600;">[REPLACE: name]</div>
        <div class="card-desc">[REPLACE: role · company]</div>
      </div>
    </div>
  </div>
</section>
```

## 5. CTA band

```html
<section class="section" data-dd-id="cta" id="contact">
  <div class="container">
    <div class="card" style="text-align: center; padding: 64px 32px;">
      <h2 class="display" style="margin-bottom: 16px;">[REPLACE: action headline]</h2>
      <p class="lead" style="margin: 0 auto 32px;">[REPLACE: one-line motivation]</p>
      <a href="#" class="btn btn-primary">[REPLACE: CTA label]</a>
    </div>
  </div>
</section>
```

## 6. Log list

```html
<section class="section" data-dd-id="log-list">
  <div class="container" style="max-width: 760px;">
    <div class="grid" style="gap: 12px;">
      <a
        href="#"
        class="card"
        style="display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; text-decoration: none; color: inherit;"
      >
        <span>[REPLACE: item title]</span>
        <span class="mono" style="color: var(--muted); font-size: 13px;">[REPLACE: meta]</span>
      </a>
      <!-- repeat -->
    </div>
  </div>
</section>
```

## 7. Split (image + text)

```html
<section class="section" data-dd-id="split">
  <div class="container">
    <div class="grid grid-2" style="align-items: center;">
      <div>
        <span class="eyebrow">[REPLACE]</span>
        <h2 class="display" style="font-size: 36px; margin: 12px 0;">[REPLACE: heading]</h2>
        <p class="lead" style="margin-bottom: 24px;">[REPLACE: paragraph]</p>
        <a href="#" class="btn btn-ghost">[REPLACE: link label]</a>
      </div>
      <div class="ph-img" style="aspect-ratio: 4 / 3;">[REPLACE: image alt text]</div>
    </div>
  </div>
</section>
```

## 8. Comparison table

```html
<section class="section" data-dd-id="comparison" id="pricing">
  <div class="container" style="max-width: 760px;">
    <div class="card" style="padding: 0; overflow: hidden;">
      <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
        <thead>
          <tr style="border-bottom: 1px solid color-mix(in srgb, var(--muted) 20%, transparent);">
            <th style="text-align: left; padding: 20px 24px; font-weight: 600;">[REPLACE: column 1]</th>
            <th style="text-align: center; padding: 20px; font-weight: 600;">[REPLACE: plan A]</th>
            <th style="text-align: center; padding: 20px; font-weight: 600; color: var(--accent);">
              [REPLACE: plan B]
            </th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid color-mix(in srgb, var(--muted) 10%, transparent);">
            <td style="padding: 16px 24px;">[REPLACE: row label]</td>
            <td style="text-align: center; padding: 16px; color: var(--muted);">[REPLACE: value]</td>
            <td style="text-align: center; padding: 16px;">[REPLACE: value]</td>
          </tr>
          <!-- repeat rows -->
        </tbody>
      </table>
    </div>
  </div>
</section>
```

---

## Self-check checklist

Before writing the final HTML, verify:

### P0 (must pass)

- [ ] Every `:root` variable comes from DESIGN.md — no invented colors
- [ ] Accent (`--accent`) used at most **2 times** per screen (eyebrow + primary CTA is the default budget)
- [ ] No `[REPLACE]` placeholders remain — all content is real and specific
- [ ] No external image URLs — use `.ph-img` class for image slots
- [ ] Every `<section>` has a `data-dd-id` attribute
- [ ] Mobile reflow works (resize to 920px — grid collapses, topnav links hide)

### P1 (should pass)

- [ ] Display font is serif, body is sans, mono for numerics/eyebrows
- [ ] Section rhythm matches the page kind default (or a justified deviation)
- [ ] Charts (if any) are inline SVG — no JS libraries

### P2 (bonus)

- [ ] Hover states on interactive elements (buttons, cards, links)
- [ ] Smooth scroll for anchor links
- [ ] Reduced-motion media query respected
