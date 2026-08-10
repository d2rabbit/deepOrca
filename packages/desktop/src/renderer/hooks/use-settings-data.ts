import { useCallback, useState } from "react";
import { api } from "../api";
import type {
  EditableSettings,
  McpServerStatus,
  ModelConfigSelection,
  SessionMessage,
  SettingsSummary,
} from "../../shared/ipc";

/** The main content area App can switch to. */
export type MainView = "chat" | "settings" | "plugins";

/**
 * Settings summary, the editable settings form, and MCP status.
 *
 * Extracted from App.tsx verbatim.
 *
 * NOTE on `setMcpStatuses`: the state *value* is intentionally discarded. It
 * exists purely as a re-render pump so `refreshMcp()` and the onMcpStatusChanged
 * event cause the tree to re-read MCP status. It looks like dead code — deleting
 * it silently stops those refreshes from repainting.
 *
 * `handleOpenSettings` must keep an empty dep array: it is in both the global
 * shortcut handlers and the command palette's memo dep array.
 */
export type SettingsDeps = {
  setMainView: (view: MainView) => void;
  setMessages: (messages: SessionMessage[]) => void;
  activeIdRef: React.RefObject<string | null>;
  refreshSkills: (sessionId?: string) => Promise<void>;
};

export type SettingsState = {
  settings: SettingsSummary | null;
  editable: EditableSettings | null;
  settingsInitialTab: string | undefined;
  setSettingsInitialTab: React.Dispatch<React.SetStateAction<string | undefined>>;
  setEditable: React.Dispatch<React.SetStateAction<EditableSettings | null>>;
  refreshSettings: () => Promise<void>;
  refreshMcp: () => Promise<void>;
  handleSetModel: (selection: ModelConfigSelection) => Promise<void>;
  handleOpenSettings: () => Promise<void>;
  handleSaveSettings: (next: EditableSettings) => Promise<void>;
};

export function useSettingsData({ setMainView, setMessages, activeIdRef, refreshSkills }: SettingsDeps): SettingsState {
  const [settings, setSettings] = useState<SettingsSummary | null>(null);
  // Value discarded on purpose — see the note above.
  const [, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [editable, setEditable] = useState<EditableSettings | null>(null);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);

  const refreshSettings = useCallback(async () => {
    setSettings(await api.getSettings());
  }, []);

  const refreshMcp = useCallback(async () => {
    setMcpStatuses(await api.mcpStatus());
  }, []);

  const handleSetModel = useCallback(
    async (selection: ModelConfigSelection) => {
      setSettings(await api.setModel(selection));
      const id = activeIdRef.current;
      if (id) {
        setMessages(await api.listMessages(id));
      }
    },
    [activeIdRef, setMessages]
  );

  const handleOpenSettings = useCallback(async () => {
    setEditable(await api.getEditableSettings());
    setSettingsInitialTab(undefined);
    setMainView("settings");
  }, [setMainView]);

  const handleSaveSettings = useCallback(
    async (next: EditableSettings) => {
      const { summary, editable: fresh } = await api.updateSettings(next);
      setSettings(summary);
      setEditable(fresh);
      setMainView("chat");
      await Promise.all([refreshMcp(), refreshSkills(activeIdRef.current ?? undefined)]);
    },
    [activeIdRef, refreshMcp, refreshSkills, setMainView]
  );

  return {
    settings,
    editable,
    settingsInitialTab,
    setSettingsInitialTab,
    setEditable,
    refreshSettings,
    refreshMcp,
    handleSetModel,
    handleOpenSettings,
    handleSaveSettings,
  };
}
