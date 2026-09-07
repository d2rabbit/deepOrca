import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { parseDesignHash, type DesignWorkspaceTabKind, type DesignWorkspaceTabSegment } from "../lib/design-deep-link";
import type { MainTab } from "../lib/app-models";

export type DesignWorkspaceTab = {
  root: string;
  label: string;
  suiteId?: string;
};

export { parseDesignHash };
export type { DesignWorkspaceTabKind, DesignWorkspaceTabSegment };

type DesignWorkspaceTabs = {
  prototypeTabs: DesignWorkspaceTab[];
  designTabs: DesignWorkspaceTab[];
  openPrototypeTab: (root: string, suiteId?: string, tab?: DesignWorkspaceTabSegment) => void;
  closePrototypeTab: (root: string) => void;
  openDesignTab: (root: string, suiteId?: string, tab?: DesignWorkspaceTabSegment) => void;
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
    (root: string, suiteId?: string, tab?: DesignWorkspaceTabSegment) => {
      setPrototypeTabs((tabs) => upsertTab(tabs, root, suiteId));
      setActiveTab({ kind: "prototype", root, ...(suiteId ? { suiteId } : {}), ...(tab ? { tab } : {}) });
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
    (root: string, suiteId?: string, tab?: DesignWorkspaceTabSegment) => {
      setDesignTabs((tabs) => upsertTab(tabs, root, suiteId));
      setActiveTab({ kind: "design", root, ...(suiteId ? { suiteId } : {}), ...(tab ? { tab } : {}) });
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

  // Hash deep links (mockup v2.1 demo states): open the named workspace, then
  // clear the hash so it stays inert. Re-review M4: when a workspace of that
  // kind is already open, REUSE its root+suiteId instead of force-switching to
  // the most-recent workspace root (which could silently re-target the viewed
  // suite); the most-recent root is only the fallback when nothing is open.
  // Kept here so App's composition root stays at its file-length ceiling.
  const openTabsRef = useRef<{ design: DesignWorkspaceTab[]; prototype: DesignWorkspaceTab[] }>({
    design: [],
    prototype: [],
  });
  openTabsRef.current = { design: designTabs, prototype: prototypeTabs };
  useEffect(() => {
    let cancelled = false;
    const open = async () => {
      const parsed = parseDesignHash(window.location.hash);
      if (!parsed) return;
      try {
        const existingTab = openTabsRef.current[parsed.kind][0];
        const root = existingTab?.root ?? (await api.listWorkspaceSessions()).workspaces[0]?.root;
        if (!root || cancelled) return;
        if (parsed.kind === "design") openDesignTab(root, existingTab?.suiteId, parsed.tab);
        else openPrototypeTab(root, existingTab?.suiteId, parsed.tab);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {
        /* fail-open: a malformed hash is inert */
      }
    };
    void open();
    window.addEventListener("hashchange", open);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", open);
    };
  }, [openDesignTab, openPrototypeTab]);

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
