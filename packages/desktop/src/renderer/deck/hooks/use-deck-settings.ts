// Deck settings snapshot hook (E15): engine-side config for deck surfaces
// that need it — the control-center model/thinking capsules and the context
// focus card's compaction-threshold override. Writes go through the same hot
// paths the classic top bar uses (setModel / setThinkingMode) and adopt the
// summary the main process returns, so the UI reflects reality immediately.
//
// No module-level cache on purpose: every mounted consumer re-reads once on
// mount. It's one cheap IPC invoke each, and per-instance state keeps the
// hook trivially testable (a fixture swap is visible to the next mount).
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import type { ModelConfigSelection, SettingsSummary, ThinkingModeSelection } from "../../../shared/ipc";

export type DeckSettings = {
  /** Null until the first summary lands (or if it never does — all consumers must null-guard). */
  settings: SettingsSummary | null;
  /** Re-read from the main process; returns the fresh summary or null on failure. */
  refresh(): Promise<SettingsSummary | null>;
  selectModel(selection: ModelConfigSelection): Promise<void>;
  applyThinking(selection: ThinkingModeSelection): Promise<void>;
};

/** Shape guard: an invalid payload (e.g. a bare stub resolving nothing) must
 *  land as `null`, never as a half-typed object downstream consumers crash on. */
function isSummary(value: unknown): value is SettingsSummary {
  return typeof value === "object" && value !== null && Array.isArray((value as { endpoints?: unknown }).endpoints);
}

export function useDeckSettings(): DeckSettings {
  const [settings, setSettings] = useState<SettingsSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getSettings()
      .then((summary) => {
        if (!cancelled && isSummary(summary)) setSettings(summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (): Promise<SettingsSummary | null> => {
    try {
      const summary = await api.getSettings();
      if (!isSummary(summary)) return null;
      setSettings(summary);
      return summary;
    } catch {
      return null;
    }
  }, []);

  const selectModel = useCallback(async (selection: ModelConfigSelection) => {
    try {
      // The main process echoes the authoritative summary — adopt it wholesale.
      const summary = await api.setModel(selection);
      if (isSummary(summary)) setSettings(summary);
    } catch {
      // Best-effort; the next refresh() picks up whatever landed.
    }
  }, []);

  const applyThinking = useCallback(async (selection: ThinkingModeSelection) => {
    try {
      const summary = await api.setThinkingMode(selection);
      if (isSummary(summary)) setSettings(summary);
    } catch {
      // Best-effort (same as above).
    }
  }, []);

  return { settings, refresh, selectModel, applyThinking };
}
