import { useCallback, useState } from "react";
import type { MainTab } from "../lib/app-models";

export type DesignWorkspaceTab = {
  root: string;
  label: string;
  suiteId?: string;
};

type DesignWorkspaceTabs = {
  prototypeTabs: DesignWorkspaceTab[];
  designTabs: DesignWorkspaceTab[];
  openPrototypeTab: (root: string, suiteId?: string) => void;
  closePrototypeTab: (root: string) => void;
  openDesignTab: (root: string, suiteId?: string) => void;
  closeDesignTab: (root: string) => void;
  resetDesignTabs: () => void;
};

function upsertTab(tabs: DesignWorkspaceTab[], root: string, suiteId?: string): DesignWorkspaceTab[] {
  const existing = tabs.find((tab) => tab.root === root);
  if (!existing) {
    return [...tabs, { root, label: root.split(/[\\/]/).pop() ?? root, ...(suiteId ? { suiteId } : {}) }];
  }
  if (!suiteId || existing.suiteId === suiteId) return tabs;
  return tabs.map((tab) => (tab.root === root ? { ...tab, suiteId } : tab));
}

/** Root-scoped prototype/UI-design surface tabs, kept outside App's composition root. */
export function useDesignWorkspaceTabs(
  setActiveTab: React.Dispatch<React.SetStateAction<MainTab>>
): DesignWorkspaceTabs {
  const [prototypeTabs, setPrototypeTabs] = useState<DesignWorkspaceTab[]>([]);
  const [designTabs, setDesignTabs] = useState<DesignWorkspaceTab[]>([]);

  const openPrototypeTab = useCallback(
    (root: string, suiteId?: string) => {
      setPrototypeTabs((tabs) => upsertTab(tabs, root, suiteId));
      setActiveTab({ kind: "prototype", root, ...(suiteId ? { suiteId } : {}) });
    },
    [setActiveTab]
  );
  const closePrototypeTab = useCallback(
    (root: string) => {
      setPrototypeTabs((tabs) => tabs.filter((tab) => tab.root !== root));
      setActiveTab((tab) => (tab.kind === "prototype" && tab.root === root ? { kind: "chat" } : tab));
    },
    [setActiveTab]
  );
  const openDesignTab = useCallback(
    (root: string, suiteId?: string) => {
      setDesignTabs((tabs) => upsertTab(tabs, root, suiteId));
      setActiveTab({ kind: "design", root, ...(suiteId ? { suiteId } : {}) });
    },
    [setActiveTab]
  );
  const closeDesignTab = useCallback(
    (root: string) => {
      setDesignTabs((tabs) => tabs.filter((tab) => tab.root !== root));
      setActiveTab((tab) => (tab.kind === "design" && tab.root === root ? { kind: "chat" } : tab));
    },
    [setActiveTab]
  );

  const resetDesignTabs = useCallback(() => {
    setPrototypeTabs([]);
    setDesignTabs([]);
    setActiveTab((tab) => (tab.kind === "prototype" || tab.kind === "design" ? { kind: "chat" } : tab));
  }, [setActiveTab]);

  return {
    prototypeTabs,
    designTabs,
    openPrototypeTab,
    closePrototypeTab,
    openDesignTab,
    closeDesignTab,
    resetDesignTabs,
  };
}
