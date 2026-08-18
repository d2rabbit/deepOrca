# Desktop Titlebar — Windows / Linux Caption Buttons Redesign

**Status:** approved
**Date:** 2026-07-23
**Scope:** `packages/desktop` only (renderer CSS + TopBar.tsx)
**Out of scope:** macOS caption buttons, IPC layer, i18n strings, model / branch / token widgets.

## Problem

On Windows and Linux the custom window-bar (`ui-window-bar`) renders the caption
buttons (min / max / close) inside a `.ui-window-controls.win` "capsule"
container (background, 1px border, padding, rounded radius). With the current
project / branch / model / token widgets and a narrow window width, the
container's combined width + right margin exceeds the bar's available area, so
the close button is clipped — only ~50 % of its glyph is visible. The clipped
glyph is also visually inconsistent with the rest of the title bar's flat
tokens, and on Linux the controls currently fall through to the macOS
"gumdrops" branch because `isWin = platform === "win32"` only catches Windows.

## Goals

1. Eliminate clipping on Windows and Linux (close button fully visible at all
   supported bar widths).
2. Match modern native caption-button styling — naked buttons, large click
   area, hover surface tint, danger tint on close.
3. Apply identical caption-button styling on Linux as on Windows; keep macOS
   gumdrops untouched.
4. Keep the change scoped to renderer code and CSS; do not change IPC, types,
   or i18n.

## Non-Goals

- macOS caption buttons (already a separate `.ui-gumdrop` block, unchanged).
- Replacing the unicode glyphs with SVG icons (deferred — see "Open
  Questions").
- Adding `maximize` / `restore` state switching with two distinct glyphs
  (deferred; current single-square glyph is acceptable for v1).
- Changing any other top-bar widget (project, branch, model, thinking,
  tokens, API-key pill).

## Design

### Platform branch flip

`TopBar.tsx` currently derives:

```ts
const isWin = platform === "win32";
// {isWin ? null : macControls}   // left side
// {isWin ? winControls : null}  // right side
```

This means Linux (`platform === "linux"`) shows macOS gumdrops on the left
and no controls on the right — a hidden bug for this UX.

Refactor to a positive `isMac` predicate:

```ts
const isMac = platform === "darwin";
// {isMac ? macControls : null}            // left side (mac only)
// {isMac ? null : winControls}            // right side (win + linux)
```

The `winControls` JSX block keeps the same three `<button>` elements in the
same min / max / close order.

### CSS — `.ui-window-controls.win` (in `ui.css`)

Drop the chrome container entirely. Naked buttons that stretch to the bar
height with a generous right inset:

```css
/* Windows / Linux caption buttons — naked, no chrome container, larger right inset. */
.ui-window-controls.win {
  align-self: stretch;
  gap: 0;
  margin-left: var(--ui-space-3);
  margin-right: 32px;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 0;
}

.ui-win-ctrl {
  width: 46px;
  height: 100%;
  min-height: 36px;
  display: grid;
  place-items: center;
  color: var(--ui-text-dim);
  font-size: 13px;
  line-height: 1;
  background: transparent;
  border-radius: 0;
  transition: background 0.12s ease, color 0.12s ease;
}
.ui-win-ctrl:hover {
  background: var(--ui-surface-hover);
  color: var(--ui-text);
}
.ui-win-ctrl:active {
  background: var(--ui-surface-active);
}
.ui-win-ctrl.close:hover {
  background: var(--ui-danger);
  color: #fff;
}
.ui-win-ctrl.close:active {
  background: var(--ui-danger);
  color: #fff;
}
```

Rationale:

- Removing the container's padding + border + radius reclaims ~10 px of
  width, which alone is enough to stop the clipping seen at the bar widths we
  support.
- `margin-right: 32px` provides the requested "large right inset" — clear of
  the window edge, distinct from the token / model cluster.
- `align-self: stretch` + `height: 100%` makes each button fill the bar's
  vertical extent, matching the Win11 / KDE caption-button hit area.
- `width: 46px` is the Win11 default caption-button width; combined with the
  bar height this gives a comfortable touch target.
- Hover uses the existing semantic surface tokens; close gets the existing
  `--ui-danger` token. No new tokens introduced.

### CSS — Metro theme override (in `styles-metro.css`)

Keep the override scoped to the same two selectors, just clearing the chrome
container and binding the hover to Metro's accent:

```css
.ui-window-controls.win {
  background: none;
  border: 0;
  border-radius: 0;
}
.ui-win-ctrl {
  border-radius: 0;
  color: var(--ui-text-faint);
}
.ui-win-ctrl:hover {
  background: var(--metro-blue);
  color: #fff;
}
.ui-win-ctrl.close:hover {
  background: var(--metro-red);
}
```

Glass / Aqua themes rely on the `ui.css` definitions unchanged.

### Glyphs (icons)

Keep the existing unicode characters (`—`, `□`, `✕`) so we don't ship a new
asset / SVG set in this change. `font-size: 13px` with `line-height: 1`
centers them cleanly in the 46 × bar-height hit area. Visual weight parity is
acceptable for v1; SVG icons are a future polish item.

## Affected Files

| File | Change |
|---|---|
| `packages/desktop/src/renderer/components/TopBar.tsx` | Rename `isWin` → `isMac`; invert the two ternaries that mount `macControls` / `winControls`. |
| `packages/desktop/src/renderer/ui.css` | Rewrite `.ui-window-controls.win` + `.ui-win-ctrl` block (lines ~313–361). |
| `packages/desktop/src/renderer/styles-metro.css` | Update Metro override block (lines ~110–126) to drop chrome container styles. |

No other files. No new dependencies. No generated code touched.

## Verification

1. `npm run typecheck` — must pass (only type-relevant change is a variable
   rename in TopBar.tsx).
2. `npm run lint` — must pass.
3. `npm run format:check` — must pass.
4. `npm run desktop:dev` (or `desktop:start`) and visually confirm:
   - **Windows:** close button fully visible; three buttons aligned to the
     right edge of the bar with a visible ~32 px gap from the screen edge;
     hover gives a light surface tint; hover on close gives a red fill.
   - **Linux:** identical to Windows (same code path).
   - **macOS:** gumdrops unchanged on the left, no right-side buttons.
5. Resize the window down to the minimum supported width and confirm the
   close button is still fully visible (the original bug repro).

## Open Questions / Future Work

- SVG icons vs unicode glyphs (cosmetic; deferred).
- Maximize / restore glyph swap when window state changes (functional
  polish; deferred — Electron `BrowserWindow.isMaximized()` already
  available via the existing IPC bridge, no schema change required).
- Theme-specific danger tokens for Metro / Aqua (currently Metro reuses
  `--metro-red`, others reuse `--ui-danger`).