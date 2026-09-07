/**
 * Suppresses @openuidev/react-lang's dev-only DevTools auto-mount. Under
 * NODE_ENV=development the SDK dynamically imports @openuidev/devtools and
 * renders a floating debug widget into document.body — fine for their
 * scaffolded apps, noise for DeepOrca's dev runs (and for pixel-level UI
 * comparisons). The SDK exposes exactly this guard symbol; pre-setting it
 * keeps the widget opt-in without patching the package.
 *
 * MUST be imported before anything that pulls in @openuidev/react-lang —
 * ESM evaluates imports in declaration order, so it goes first in main.tsx.
 */
(globalThis as unknown as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;
