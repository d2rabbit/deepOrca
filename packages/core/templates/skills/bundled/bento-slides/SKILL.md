---
name: bento-slides
description: >-
  Generates presentation slide decks as self-contained .bento.html files that
  open in any browser with zero dependencies. Use when users ask for slides,
  演示文稿, deck, presentation, 幻灯片, or pitch materials. The agent authors
  pure JSON describing text, shapes, charts, images, and morph animations,
  then writes it into a Bento HTML shell. No server, no install — one file
  is the entire app (editor + viewer + presenter + document).
---

# Bento Slides — Generate Self-Contained Presentation Decks

Bento is a single-file office suite: the entire application (editor, viewer,
presenter) and your document data live in one `.bento.html` file (~644 KB).
Anyone can open it in a browser, edit, present, and share — no install needed.

## When to Use

- User asks for slides / 演示文稿 / deck / presentation / 幻灯片 / pitch
- User wants to visualize data as charts, diagrams, or a slide deck
- User needs to present project architecture, roadmap, or summary

## Workflow

### Step 1: Ensure a .bento.html shell exists

Copy the bundled template (contains the runtime JS + a minimal starter deck):

```bash
cp references/bento-template.bento.html deck.bento.html
```

Or download the latest from GitHub if the template is missing:

```bash
curl -fsSL -o deck.bento.html \
  https://github.com/nyblnet/bento/releases/latest/download/Bento_Slides.bento.html
```

### Step 2: Locate the JSON document block

The deck JSON lives inside a `<script>` tag near the top of the file:

```html
<script type="application/bento+json" id="bento-doc">
{ ...your deck JSON... }
</script>
```

Find the line with `id="bento-doc"` and the next `</script>` — replace the JSON
between them.

### Step 3: Generate the deck JSON

See the **Document Model** section below for the full schema. A minimal deck:

```json
{
  "format": "bento/slides",
  "version": 1,
  "title": "My Deck",
  "size": { "width": 1280, "height": 720 },
  "theme": {
    "background": "#101418",
    "color": "#F2F0EA",
    "accent": "#FF9E8A",
    "fontFamily": "system-ui, sans-serif"
  },
  "slides": [
    {
      "id": "s1",
      "background": "#101418",
      "transition": "none",
      "elements": [
        {
          "id": "t1", "type": "text",
          "x": 96, "y": 260, "w": 1088, "h": 160,
          "rotation": 0, "opacity": 1,
          "html": "Hello World",
          "fontSize": 88, "fontFamily": "system-ui, sans-serif",
          "fontWeight": 800, "color": "#F2F0EA",
          "align": "left", "valign": "top", "lineHeight": 1.1
        }
      ]
    }
  ]
}
```

### Step 4: CRITICAL — Escape all `<` in JSON strings

**Every `<` character inside the JSON must be escaped as `\u003c`.**

If an element's `html` contains `<b>bold</b>`, it must become
`\u003cb\u003ebold\u003c/b\u003e`. A single literal `</script>` anywhere in the
JSON will truncate the deck and corrupt the file. This is the #1 error source.

### Step 5: Write back and tell the user

Write the modified `.bento.html` file and tell the user to open it in a browser.
The file is the complete app — editing, presenting, and exporting all work
inside the browser.

---

## Document Model

### Required top-level keys

| Key | Type | Description |
|-----|------|-------------|
| `format` | string | Must be `"bento/slides"` |
| `version` | int | Currently `1` |
| `title` | string | Deck title |
| `size` | `{width, height}` | Canvas size. Default `1280×720` |
| `theme` | object | Must contain `background`, `color`, `accent`, `fontFamily` |
| `slides` | array | Each slide: `{id, background, transition, notes, elements[]}` |

### Optional top-level keys

| Key | Description |
|-----|-------------|
| `assets` | Data-URI store keyed by name; referenced as `"asset:<key>"` |
| `meta` | `{author, company, subject, event, keywords}` |
| `fonts` | `[{family, asset, weight}]` for embedded fonts |

---

## Element Types

All elements share base props: `id`, `x`, `y`, `w`, `h`, `rotation`, `opacity`.

### text

```json
{
  "id": "title", "type": "text",
  "x": 96, "y": 140, "w": 1088, "h": 120,
  "html": "Big Title",
  "fontSize": 72, "fontFamily": "system-ui, sans-serif",
  "fontWeight": 800, "color": "#F2F0EA",
  "align": "center", "valign": "middle", "lineHeight": 1.2
}
```

Props: `html` (inline `<b>` `<i>` `<br>` ok), `fontSize`, `fontFamily`,
`fontWeight`, `color`, `align` (left|center|right), `valign` (top|middle|bottom),
`lineHeight`, optional `letterSpacing`.

### shape

```json
{
  "id": "box1", "type": "shape",
  "x": 96, "y": 300, "w": 400, "h": 200,
  "shape": "rect",
  "fill": "#1a1f26", "stroke": "#FF9E8A", "strokeWidth": 2,
  "radius": 12
}
```

Shapes: `rect`, `ellipse`, `triangle`, `arrow`, `line`, `path`.
Lines: `strokeStyle` (solid|dashed|dotted), `lineStart`/`lineEnd` arrows.
Paths: SVG `d` + `pathBox`. Connectors: `from`/`to: {el, side}`.

### image

```json
{
  "id": "img1", "type": "image",
  "x": 100, "y": 100, "w": 400, "h": 300,
  "src": "asset:logo",
  "fit": "cover", "radius": 8
}
```

`src` can be a data URI (`data:image/png;base64,...`) or `"asset:<key>"`.
`fit`: cover|contain|fill.

### chart

```json
{
  "id": "chart1", "type": "chart",
  "x": 96, "y": 260, "w": 1088, "h": 380,
  "preset": "bar",
  "option": {
    "xAxis": { "type": "category", "data": ["2022", "2023", "2024"] },
    "yAxis": { "type": "value" },
    "series": [{ "type": "bar", "data": [420, 780, 1300] }]
  }
}
```

Presets: `bar`, `line`, `pie`, `scatter`. The `option` follows ECharts JSON
format. Pie series data: `[{name, value}]`.

### table

```json
{
  "id": "tbl1", "type": "table",
  "x": 96, "y": 300, "w": 1088, "h": 300,
  "columns": [1, 2, 1],
  "header": true,
  "rows": [
    [{ "html": "Name" }, { "html": "Value" }, { "html": "Status" }],
    [{ "html": "Alpha" }, { "html": "42" }, { "html": "✅" }]
  ]
}
```

`columns` = fractional width weights.

### svg

Static SVG markup or paths.

---

## Morph Transitions (Signature Feature)

Set `transition: "morph"` on the **later** slide. Elements sharing the same
`id` across slides will animate (position, size, color, gradients):

```json
// Slide 1 — large title
{ "id": "headline", "type": "text", "x": 96, "y": 140, "w": 900, "fontSize": 120 }
// Slide 2 — same id, smaller, morphs into position
{ "id": "headline", "type": "text", "x": 96, "y": 84, "w": 500, "fontSize": 40 }
// Slide 2 transition setting:
{ "id": "slide2", "transition": "morph", "elements": [/* headline here */] }
```

The shared `id` is the contract. Reusing an `id` across slides = it morphs.

---

## Design Guardrails

- **Canvas:** 1280 × 720 px. Always check `doc.size` first.
- **Side margins:** 96 px. Content should not exceed `x = 1184`.
- **Max two typefaces.** One for headings, one for body.
- **One accent color.** Use `theme.accent` consistently.
- **Contrast:** Ensure text is readable against the background.

---

## Hard Rules (MUST Follow)

1. **Escape `<` → `\u003c`** in ALL JSON string values. This prevents
   `</script>` from corrupting the file.
2. **Exact key names matter.** Unknown keys are silently ignored — typos
   produce no error, just missing output.
3. **Never hand-write a bare HTML file** without the runtime shell. Always
   start from the template or download — the JS runtime must be present.
4. **`docId` (if present) must never be regenerated.** It identifies the deck.
5. **Dynamic tokens:** `{{page}}`, `{{pages}}`, `{{title}}`, `{{date}}`,
   `{{time}}`, `{{author}}` resolve at render time in text elements.
