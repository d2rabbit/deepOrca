import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Workspace-tree refresh signal.
 *
 * `refreshKey` is a monotonic counter passed to Sidebar/SourceControlPanel; those
 * components re-fetch the whole workspace tree over IPC whenever it changes.
 *
 * Extracted from App.tsx verbatim. `bump` keeps an empty dep array on purpose:
 * it (and `bumpThrottled`, which derives from it) sits in the boot effect's dep
 * array, and that effect must run exactly once — a changing identity would
 * re-fire api.ready(), re-register every IPC listener, and reload the session the
 * user is currently viewing.
 */
export type TreeRefresh = {
  refreshKey: number;
  bump: () => void;
  /** Throttled to once per 1.5s with a trailing call, for streaming updates. */
  bumpThrottled: () => void;
};

export function useTreeRefresh(): TreeRefresh {
  const [refreshKey, setRefreshKey] = useState(0);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Throttled variant for high-frequency session-entry updates: every bump makes
  // the sidebar re-fetch the whole workspace tree over IPC, so during streaming
  // we cap it to once per 1.5s with a trailing call.
  const throttleRef = useRef<{ last: number; timer: ReturnType<typeof setTimeout> | null }>({
    last: 0,
    timer: null,
  });
  const bumpThrottled = useCallback(() => {
    const state = throttleRef.current;
    const elapsed = Date.now() - state.last;
    if (elapsed >= 1500) {
      state.last = Date.now();
      bump();
      return;
    }
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      state.last = Date.now();
      bump();
    }, 1500 - elapsed);
  }, [bump]);

  useEffect(
    () => () => {
      const state = throttleRef.current;
      if (state.timer) clearTimeout(state.timer);
    },
    []
  );

  return { refreshKey, bump, bumpThrottled };
}
