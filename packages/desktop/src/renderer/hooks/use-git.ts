import { useCallback, useState } from "react";
import { api } from "../api";
import type { Translate } from "../i18n";

/**
 * Git branch state and the switch / stash-and-switch flows.
 *
 * Extracted from App.tsx verbatim. Its four cross-domain dependencies are all
 * injected as functions, and all of them are `[]`-stable at the call site, so the
 * callbacks' dep arrays keep the identities they had inline.
 */
export type GitDeps = {
  bumpTree: () => void;
  refreshSessions: () => Promise<void>;
  setErrorLine: (line: string | null) => void;
  pushToast: (kind: "success" | "error", message: string) => void;
  t: Translate;
};

export type GitState = {
  branch: string;
  branches: string[];
  /** Non-null when a switch was blocked by a dirty tree; names the target branch. */
  branchConflict: string | null;
  setBranchConflict: React.Dispatch<React.SetStateAction<string | null>>;
  stashSwitching: boolean;
  refreshGit: () => Promise<void>;
  handleSwitchBranch: (next: string) => Promise<void>;
  handleStashAndSwitch: () => Promise<void>;
};

export function useGit({ bumpTree, refreshSessions, setErrorLine, pushToast, t }: GitDeps): GitState {
  const [branchConflict, setBranchConflict] = useState<string | null>(null);
  const [stashSwitching, setStashSwitching] = useState(false);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);

  const refreshGit = useCallback(async () => {
    try {
      const [current, list] = await Promise.all([api.gitCurrentBranch(), api.gitListBranches()]);
      setBranch(current);
      setBranches(list);
    } catch {
      // Git may be unavailable in this workspace — keep prior branch state.
    }
  }, []);

  const handleSwitchBranch = useCallback(
    async (next: string) => {
      const result = await api.gitCheckout(next);
      if (result.ok) {
        await refreshGit();
        await refreshSessions();
        bumpTree();
      } else if (result.conflict) {
        // Dirty tree: offer stash-and-switch instead of dumping raw git stderr.
        setBranchConflict(next);
        await refreshGit();
      } else {
        setErrorLine(result.error ?? t("app.requestFailed"));
        // Keep the dropdown in sync with the real branch after a failed switch.
        await refreshGit();
      }
    },
    [bumpTree, refreshGit, refreshSessions, setErrorLine, t]
  );

  const handleStashAndSwitch = useCallback(async () => {
    const target = branchConflict;
    if (!target || stashSwitching) {
      return;
    }
    setStashSwitching(true);
    try {
      const result = await api.gitStashCheckout(target);
      if (result.ok) {
        setBranchConflict(null);
        if (result.stashWarning) {
          // Checkout succeeded but the stashed changes could not be restored —
          // surface as an error toast so the user recovers via `git stash pop`.
          pushToast("error", result.stashWarning);
        } else {
          pushToast("success", t("scm.stashSwitchDone", { branch: target }));
        }
        await refreshGit();
        await refreshSessions();
        bumpTree();
      } else {
        setBranchConflict(null);
        setErrorLine(result.error ?? t("app.requestFailed"));
        await refreshGit();
      }
    } finally {
      setStashSwitching(false);
    }
  }, [branchConflict, stashSwitching, bumpTree, pushToast, refreshGit, refreshSessions, setErrorLine, t]);

  return {
    branch,
    branches,
    branchConflict,
    setBranchConflict,
    stashSwitching,
    refreshGit,
    handleSwitchBranch,
    handleStashAndSwitch,
  };
}
