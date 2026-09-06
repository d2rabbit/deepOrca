/**
 * Habit-based completion ranking (2026-09-06 user ask: 习惯性补全 — an
 * editor basic). A frecency map (word → {count, lastUsed}) persisted in
 * localStorage feeds two consumers:
 *  - the fallback completion source boosts frequently/recently used words and
 *    badges them ★N in the popup's detail slot;
 *  - the kernel's typing listener records words the user just FINISHED
 *    typing (separator keystroke), so habits accumulate from plain typing,
 *    not only from popup accepts.
 *
 * Fail-open by design: localStorage issues (quota, disabled) never break
 * completion — the map just lives in memory for the session.
 */

const STORAGE_KEY = "deeporca.editor.completion-habit-v1";
const MAX_ENTRIES = 500;
const SAVE_DEBOUNCE_MS = 1500;

export type HabitEntry = { count: number; lastUsed: number };

type HabitMap = Map<string, HabitEntry>;

let cache: HabitMap | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(): HabitMap {
  if (cache) return cache;
  const out: HabitMap = new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, [number, number]>;
      for (const [word, [count, lastUsed]] of Object.entries(parsed)) {
        if (typeof count === "number" && typeof lastUsed === "number") {
          out.set(word, { count, lastUsed });
        }
      }
    }
  } catch {
    /* corrupt or unavailable — start empty */
  }
  cache = out;
  return out;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const map = load();
      // Evict stale-first when over cap: oldest lastUsed goes first.
      if (map.size > MAX_ENTRIES) {
        const byAge = [...map.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
        for (let i = 0; i < byAge.length - MAX_ENTRIES; i += 1) map.delete(byAge[i]![0]);
      }
      const obj: Record<string, [number, number]> = {};
      for (const [word, e] of map) obj[word] = [e.count, e.lastUsed];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* quota/disabled — keep the in-memory map */
    }
  }, SAVE_DEBOUNCE_MS);
  saveTimer.unref?.();
}

/** Record one use of `word` (popup accept or typing completion). */
export function bumpHabit(word: string): void {
  if (!/^[A-Za-z_$][\w$]{2,}$/.test(word)) return;
  const map = load();
  const prev = map.get(word);
  map.set(word, { count: Math.min(999, (prev?.count ?? 0) + 1), lastUsed: Date.now() });
  scheduleSave();
}

/** Usage count for the popup badge (0 = unknown word). */
export function habitCount(word: string): number {
  return load().get(word)?.count ?? 0;
}

/** Recency factor: full weight inside a week, halved after a month, quarter
 *  beyond — old habits fade instead of dominating forever. */
function recencyFactor(lastUsed: number): number {
  const ageDays = (Date.now() - lastUsed) / 86_400_000;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.5;
  return 0.25;
}

/** Ranking boost for the completion source (>= 0; 0 = no habit). Capped so a
 *  heavily repeated word can't permanently pin above exact-prefix matches. */
export function habitBoost(word: string): number {
  const entry = load().get(word);
  if (!entry) return 0;
  return Math.min(12, entry.count) * recencyFactor(entry.lastUsed);
}

/** Test seam: reset the map + storage. */
export function resetHabitForTests(): void {
  cache = new Map();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Typing listener seam: the user just typed a SEPARATOR at `pos` — collect
 * the word immediately before it and record it as finished typing. `sliceDoc`
 * is CM6's Text.sliceString (line-oriented lookups would be heavier).
 */
export function recordSeparatorCompletion(sliceDoc: (from: number, to: number) => string, pos: number): void {
  const maxScan = 64;
  const start = Math.max(0, pos - maxScan);
  const chunk = sliceDoc(start, pos);
  const m = /[A-Za-z_$][\w$]*$/.exec(chunk);
  if (m && m[0].length >= 3) bumpHabit(m[0]);
}
