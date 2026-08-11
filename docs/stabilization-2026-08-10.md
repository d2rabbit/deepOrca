# Stabilization Report — 2026-08-10

Branch: `fix/stabilize-data-loss-and-test-suite`
Based on: `perf/native-optimizations` (a433932)

A stabilization pass triggered by an assessment that found a **live data-loss bug**,
a **test suite that hung indefinitely**, and a **flagship feature that had never
actually run** — all hidden because the suite never completed.

> **Acceptance:** `npm run check` and `npm test` exit 0. Suite **196s + indefinite
> hang → 21s**, 449 tests green, lint warnings **27 → 0**.

---

## 1. Diagnosis — three root causes

### RC1 — Session-index read/write mismatch (live data loss)

`4d5575a` debounced index _writes_ into `pendingIndex` (250 ms), but left every
_read_ going to disk. `updateSessionEntry` is load→mutate→save and runs ~17× per
streaming turn, so two updates inside one debounce window each rebase on the stale
file and the first is **permanently lost**.

- Corrupted accumulated `usage` / `usagePerModel` accounting.
- Dropped `permission_denied` entirely (test 62 proved it: a freshly constructed
  second manager reading the file saw no denial at all).

**Fix:** `loadSessionsIndex` prefers `pendingIndex`, returning a shallow copy to
keep snapshot semantics. `denySessionPermission` now flushes (terminal user
decision, like create/delete). Regression test added; verified it fails without
the fix (`session-a` rename comes back as `'old a'`).

> **Trap avoided:** I initially wanted to re-normalize pending entries on read,
> but `normalizeSessionEntry`'s `deserializeProcesses` uses `Object.entries()`,
> which returns `[]` for the in-memory `Map` — that would **silently drop every
> tracked process**. Reverted and documented in AGENTS.md.

### RC2 — Test suite hang (abort race)

The `APIUserAbortError` mock settled only via an abort listener, but `ec11350`
inserted `await getRoutedMcpTools()` between "mark processing" and "issue
request", so the abort now fires _before_ the listener is attached → promise
never settles → `node --test` hangs at 0% CPU forever.

**Fix:** mock checks `signal.aborted` first (mirrors the real SDK). Every runner
gains `--test-timeout` + `--test-force-exit`; `ci.yml` gains `timeout-minutes: 45`.

> **Gotcha:** `--test-timeout` for files built from top-level `test()` applies to
> the _whole file_, not per-test. 60 s truncated the entire run. Sized to 300 s
> against measured total runtime.

### RC3 — Semantic routing never ran

The model dir was built as `<core>/../../packages/desktop/vendor/...`, resolving
to `packages/packages/desktop/...` — a path that never existed. Routing is
`enabled: true` by default but fails open, and `getEmbeddingLoadError()` was never
consumed, so there was no symptom.

**Root cause was architectural:** core derived a vendor path from `__dirname`
instead of using the host-injection pattern that codegraph / crg / serena already
use. Added `configureRoutingModelDir`, injected by the desktop main process.
Forwarded a host logger into the embedding service (a bad path fails inside the
fire-and-forget warmup, not the constructor). `closeEmbeddingService()` on app
teardown releases onnxruntime native handles.

**Verified end to end:** routers non-null, warmup completes at 384 dims, embed
works, close releases cleanly.

---

## 2. Triage — 24 failures, 2 shared root causes

| Bucket                                   | Count | Examples                                                             | Fix                     |
| ---------------------------------------- | ----- | -------------------------------------------------------------------- | ----------------------- |
| Stale test expectation (product changed) | 9     | `bundled:` → `plugin:`, builtin MCP injection, prompt order          | Update test             |
| Real product regression (RC1)            | 14    | token accounting (78–81), permissions (60–63), notifications (38–39) | Fix `loadSessionsIndex` |
| Real product regression (isolated)       | 1     | npx `-y` deleted in `bed96b0`                                        | Restore `withNpxYesArg` |

One source fix (RC1) cleared 14 tests. One test-side fix (builtin MCP opt-out +
select-by-name) cleared 5 and removed ~180 s of serena startup timeouts.

---

## 3. What was done

### P0 — stop the bleeding

- RC1 index read-through + lost-update regression test
- RC2 hang fix (mock + 4 runners + ci.yml)
- npx `-y` restored
- 9 stale test expectations updated

### P1 — make the signal trustworthy

- Routing activated (host injection + logger + close + tests)
- Dead memory-gateway code removed (3 places, −1294 lockfile lines; `tcvdb-text` kept)
- AGENTS.md corrected (4 packages, `routing/` section, 13 vendor scripts, RC1 invariant)
- Repo hygiene (screenshots untracked, `.tmp-*` cleaned, `.gitignore` tightened)

### P2 — structural refactors (behaviour-preserving)

- **Test harness:** jsdom + @testing-library/react on node:test; App.tsx testable
  for the first time; 3 guard tests (boot chain, subscribe/unsubscribe symmetry
  under StrictMode, boot-failure reporting). Desktop 37 → 40.
- **App.tsx:** 1773 → 1410 lines (−20%), 11 per-domain hooks. Boundary plan
  produced first (13 safe hooks + 1 HUB + 13 hazards, line-cited).
- **registerIpc:** 765-line function → 17 registrars (max 172), 85 channels
  unchanged.
- **SessionBridge:** 1216 → 1011 lines (read-only plugin/MCP projections only).
- **Lint:** 27 → 0.

### Extra fixes found along the way

- `spawn-spec.ts`: used host `path.isAbsolute` despite taking a `platform` arg →
  treated `C:\...` as relative on posix hosts. Now `path.win32`; Windows unchanged.
- `activity-frames` E2E: asserted host shell history, contradicting the runner's
  HOME isolation.
- `memory/capture.test.ts`: timezone bug (UTC vs local shard name) — failed 8 h/day
  east of UTC, never on CI.

---

## 4. Self-corrections during the work

- **Claimed "27 warnings all in memory"** — wrong; core had 2, desktop 1.
- **Claimed "gateway has one reference"** — missed `package-desktop.js:99`.
- **`closePreview` first draft** omitted `prototypeOpenuiCode` reset; corrected
  after checking the actual handler.
- **Nearly introduced data destruction** by re-normalizing pending entries (the
  `Map`/`Object.entries` trap above).
- **Misread `--test-timeout`** as per-test; it is file-level for top-level `test()`.

---

## 5. What was deliberately NOT done (with reasons)

- **`useConversation` (HUB):** 14 state + 22 callbacks but 12 injected
  dependencies — extraction is "move 400 lines behind a 12-arg options object",
  readability gain without decoupling gain.
- **SessionBridge remaining 3 plugin write methods:** need `emit`/`reload`/
  `resolveSaveTarget`/`readTargetSettings` — injecting 4 privates trades a long
  file for a wide coupling surface.
- **TDAI fork's 19 lint warnings:** editing vendored code widens upstream drift
  for no benefit. Ignored with rationale; also fixed a stale ignore path.
- **MCP failure exit code:** SDK's `stdio.js` drops it (`on('close', _code => …)`).
  Recovering it needs the private `_process`. Accepted as a minor diagnostic
  regression; stderr path still works and is tested.
- **Context-ifying App state:** would change memo boundaries / re-render
  characteristics — a behaviour change, not a refactor.

---

## 6. Commit log (10 commits, all on `fix/stabilize-data-loss-and-test-suite`)

```
035159b chore(lint): clear the warning backlog — 27 -> 0
0f1133c refactor(desktop): extract the read-only plugin/MCP projections from SessionBridge
e3fa579 refactor(desktop): split the 765-line registerIpc into per-domain registrars
d63792b refactor(desktop): extract the settings domain from App.tsx
04dcb1b refactor(desktop): extract git and global-shortcut domains from App.tsx
7d3ca8d refactor(desktop): extract preview, skills and process domains from App.tsx
8db6f0f refactor(desktop): extract five leaf domains from App.tsx into hooks
8e3e091 chore: untrack run-artifact screenshots and tighten gitignore
637acf4 docs(agents): correct the package map and record the invariants that broke
ccd5a09 fix: stop losing session-index updates, unhang the test suite, activate routing
```

Each commit independently passes `npm test`.
