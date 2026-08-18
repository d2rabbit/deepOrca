# Desktop Titlebar Win/Linux Caption Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the custom title-bar's close / maximize / minimize buttons on Windows and Linux into naked, full-height buttons with a generous right inset; fix the Linux branch so it renders the same controls as Windows instead of macOS gumdrops. Leave macOS untouched.

**Architecture:** Flip the platform predicate in `TopBar.tsx` from "is this Windows?" to "is this macOS?", so the same `winControls` JSX block mounts on both win32 and linux. Strip the chrome container from `.ui-window-controls.win` in `ui.css`, give the buttons full bar height + 46 px width + 32 px right margin, and update the Metro override in `styles-metro.css` to match. No IPC, no types, no i18n touched.

**Tech Stack:** Electron renderer (React + TSX), plain CSS variables, semantic `--ui-*` tokens, Metro theme overrides.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/desktop/src/renderer/components/TopBar.tsx` | Platform branching for caption controls | Rename `isWin` → `isMac`; invert two ternaries. |
| `packages/desktop/src/renderer/ui.css` | Default-theme `.ui-window-controls.win` + `.ui-win-ctrl` rules | Strip chrome container; naked full-height buttons with hover tint. |
| `packages/desktop/src/renderer/styles-metro.css` | Metro-theme override for the same selectors | Clear chrome; bind hover to `--metro-blue` / `--metro-red`. |

No new files. No tests added (desktop package has no test suite today; visual verification is the primary check, see Verification section).

---

## Task 1: Flip platform branch in `TopBar.tsx`

**Files:**
- Modify: `packages/desktop/src/renderer/components/TopBar.tsx:63, 124, 223`

- [ ] **Step 1: Rename `isWin` to `isMac` and flip the predicate**

In `packages/desktop/src/renderer/components/TopBar.tsx`, find the line:

```ts
const isWin = platform === "win32";
```

Replace with:

```ts
const isMac = platform === "darwin";
```

- [ ] **Step 2: Invert the left-side ternary (line ~124)**

Find:

```tsx
{isWin ? null : macControls}
```

Replace with:

```tsx
{isMac ? macControls : null}
```

- [ ] **Step 3: Invert the right-side ternary (line ~223)**

Find:

```tsx
{isWin ? winControls : null}
```

Replace with:

```tsx
{isMac ? null : winControls}
```

- [ ] **Step 4: Confirm no other references to `isWin` remain**

Run:

```bash
grep -n "isWin" packages/desktop/src/renderer/components/TopBar.tsx
```

Expected: no output (grep exits 1 with no matches).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors; the existing rename is purely local).

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/TopBar.tsx
git commit -m "refactor(desktop): mount win caption controls on linux too

Renames the TopBar platform predicate from isWin to isMac so the same
winControls JSX block renders on both win32 and linux. macOS keeps its
gumdrops; linux no longer falls through to the macOS branch."
```

---

## Task 2: Rewrite `.ui-window-controls.win` and `.ui-win-ctrl` in `ui.css`

**Files:**
- Modify: `packages/desktop/src/renderer/ui.css:313-361`

- [ ] **Step 1: Replace the container block**

In `packages/desktop/src/renderer/ui.css`, find the block:

```css
/* Windows caption buttons — compact grouped container, inset from right edge. */
.ui-window-controls.win {
  align-self: center;
  gap: 2px;
  margin-left: auto;
  margin-right: var(--ui-space-3);
  padding: 3px;
  background: var(--ui-surface-hover);
  border: 1px solid var(--ui-border-soft);
  border-radius: var(--ui-radius-md);
}
```

Replace with:

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
```

- [ ] **Step 2: Replace the button block**

Find:

```css
.ui-win-ctrl {
  width: 32px;
  height: 26px;
  display: grid;
  place-items: center;
  color: var(--ui-text-dim);
  font-size: 11px;
  border-radius: var(--ui-radius-sm);
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.ui-win-ctrl:hover {
  background: var(--ui-surface-hover);
}
.ui-win-ctrl.close:hover {
  background: var(--ui-danger);
  color: #fff;
}
```

Replace with:

```css
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

- [ ] **Step 3: Lint + format check**

Run: `npm run lint`
Expected: PASS.

Run: `npm run format:check`
Expected: PASS (Prettier may reformat the `transition:` shorthand in step 2; if so, run `npm run format` once, then re-run format:check).

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/ui.css
git commit -m "style(desktop): naked caption buttons for win/linux titlebar

Drops the chrome container (background/border/radius/padding) and gives
each button full bar height + 46px width + 32px right inset, matching
modern native caption styling. Close button keeps its danger tint on
hover/active."
```

---

## Task 3: Update Metro theme override in `styles-metro.css`

**Files:**
- Modify: `packages/desktop/src/renderer/styles-metro.css:110-126`

- [ ] **Step 1: Clear the chrome container override**

In `packages/desktop/src/renderer/styles-metro.css`, find:

```css
/* 窗口控件组(Metro 扁平磁贴风):凹陷背景 + 直角按钮。 */
.ui-window-controls.win {
  background: var(--metro-bg-recessed);
  border-color: var(--ui-border-soft);
  border-radius: var(--ui-radius-sm);
}
```

Replace with:

```css
/* Metro caption controls: keep the bare container from ui.css; only restyle hover. */
.ui-window-controls.win {
  background: none;
  border: 0;
  border-radius: 0;
}
```

- [ ] **Step 2: Update the button hover block (already present, keep as-is)**

The following rules are already correct for the new naked style — leave them
unchanged:

```css
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

No edit needed. If you want Metro's close-active to also tint red, you may
add this single line below the existing `.ui-win-ctrl.close:hover` rule:

```css
.ui-win-ctrl.close:active {
  background: var(--metro-red);
}
```

This addition is optional and matches the default-theme behavior.

- [ ] **Step 3: Lint + format check**

Run: `npm run lint`
Expected: PASS.

Run: `npm run format:check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/styles-metro.css
git commit -m "style(desktop): align Metro caption controls with new naked chrome

Clears the Metro override's chrome container so it doesn't reintroduce a
border/background on top of the new ui.css rules. Optional close:active
rule added for parity with the default theme."
```

---

## Task 4: End-to-end visual verification

**Files:** none (manual / runtime check)

- [ ] **Step 1: Build the desktop bundle**

Run: `npm run desktop:build`
Expected: build succeeds.

- [ ] **Step 2: Launch and verify on Windows**

Run: `npm run desktop:start`
Visually confirm:
- Three buttons (min / max / close) are fully visible at the right end of the title bar.
- A clear ~32 px gap separates the close button from the right edge of the window.
- Buttons are visually "naked" (no surrounding capsule / border / radius).
- Hovering min or max gives a faint surface tint; hovering close gives a red fill.
- Clicking each button still triggers minimize / maximize-toggle / close (regression check).

- [ ] **Step 3: Verify on Linux (if a Linux host is available)**

On a Linux box, repeat step 2. Expected: identical behavior to Windows.

- [ ] **Step 4: Verify macOS is unchanged**

On macOS, repeat step 2. Expected: gumdrops on the far left, no right-side controls, no regressions to the rest of the bar.

- [ ] **Step 5: Resize-window stress test**

On Windows or Linux, drag the window down to the minimum supported width. Expected: the close button remains fully visible (the original bug repro must no longer occur).

- [ ] **Step 6: Run the full check suite**

Run: `npm run check`
Expected: PASS (typecheck + lint + format:check).

Run: `npm test`
Expected: PASS (no desktop tests today; CLI / core suites still green).

- [ ] **Step 7: Commit verification log (optional)**

If you captured screenshots or notes, you may add a short summary to the
commit log of task 3 (or amend it). No source files should change in this
task — this is purely a verification gate.

---

## Self-Review Notes

- **Spec coverage:**
  - "Platform branch flip" → Task 1 ✓
  - "CSS — `.ui-window-controls.win` rewrite" → Task 2 steps 1–2 ✓
  - "CSS — Metro override" → Task 3 steps 1–2 ✓
  - "Glyphs unchanged" → not a task (preserved by omission) ✓
  - "Verification (typecheck / lint / dev run / resize)" → Task 4 ✓
  - "Out of scope items" → none touched ✓
- **Placeholder scan:** No TBD / TODO / "implement later" anywhere.
- **Type / name consistency:** `isMac` introduced in Task 1, used in Tasks 1–4 consistently. CSS selector names (`ui-window-controls.win`, `ui-win-ctrl`, `ui-win-ctrl.close`) match across Tasks 2 and 3. No drift.
- **Commits:** Three focused commits (one per file family), plus a final verification step that does not change source.