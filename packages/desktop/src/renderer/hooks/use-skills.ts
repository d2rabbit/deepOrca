import { useCallback, useState } from "react";
import { api } from "../api";
import type { SkillInfo } from "../../shared/ipc";

/**
 * Skill list and the per-turn selection.
 *
 * Extracted from App.tsx verbatim.
 *
 * `refreshSkills` MUST keep an empty dep array and take `sessionId` as a
 * parameter rather than closing over the active session: it sits in the boot
 * effect's dep array (via `loadSession`), and that effect must run exactly once.
 */
export type SkillsState = {
  skills: SkillInfo[];
  selectedSkills: string[];
  /** Returned raw — `handleSend` clears the selection after dispatching. */
  setSelectedSkills: React.Dispatch<React.SetStateAction<string[]>>;
  refreshSkills: (sessionId?: string) => Promise<void>;
  handleToggleSkill: (name: string) => void;
  handleRefreshPluginSkills: () => Promise<void>;
};

export function useSkills(activeId: string | null): SkillsState {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  const refreshSkills = useCallback(async (sessionId?: string) => {
    setSkills(await api.listSkills(sessionId));
  }, []);

  const handleToggleSkill = useCallback(
    (name: string) =>
      setSelectedSkills((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name])),
    []
  );

  const handleRefreshPluginSkills = useCallback(async () => {
    await api.pluginRefreshSkills(activeId ?? undefined);
    await refreshSkills(activeId ?? undefined);
  }, [activeId, refreshSkills]);

  return { skills, selectedSkills, setSelectedSkills, refreshSkills, handleToggleSkill, handleRefreshPluginSkills };
}
