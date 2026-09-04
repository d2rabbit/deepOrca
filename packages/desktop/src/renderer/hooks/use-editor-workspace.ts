import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

/** Per-file load/dirty bookkeeping for the editor workspace. */
export type EditorFileState = {
  /** On-disk content — the dirty baseline: `draft !== saved` ⇒ dirty. */
  saved: string;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  binary: boolean;
};

export type EditorWorkspaceStore = {
  /** Open files in first-open order. */
  openFiles: string[];
  activeFile: string | null;
  /** Current editor content per open file (absent until the read lands). */
  drafts: Map<string, string>;
  fileStates: Map<string, EditorFileState>;
  dirtyFiles: string[];
  anyDirty: boolean;
  /** Open a file (deduped) and make it active; first open reads it from disk. */
  openFile: (file: string) => void;
  /** Close one file; activating the neighbour when it was active. */
  closeFile: (file: string) => void;
  setActiveFile: (file: string) => void;
  setDraft: (file: string, content: string) => void;
  /** After a successful write: move the dirty baseline. */
  markSaved: (file: string, content: string) => void;
  /** Drop every open file/draft — closing the whole workspace. */
  closeWorkspace: () => void;
};

/**
 * Editor workspace state (B-line E1): the top bar carries ONE editor chip;
 * many files open as sub-tabs inside the editor sheet. This hook owns the
 * multi-file state — open order, active sub-tab, per-file drafts against an
 * on-disk baseline — so drafts survive sub-tab switches (E3 keeps the Monaco
 * model alive; this hook keeps the React-side state keyed by path).
 */
export function useEditorWorkspace(): EditorWorkspaceStore {
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  const [fileStates, setFileStates] = useState<Map<string, EditorFileState>>(() => new Map());
  // The load effect reads these to skip files it already handled; mirrors stay
  // current because they are reassigned on every render before effects run.
  const openRef = useRef(openFiles);
  openRef.current = openFiles;
  const activeRef = useRef(activeFile);
  activeRef.current = activeFile;
  const statesRef = useRef(fileStates);
  statesRef.current = fileStates;

  // Load-once per newly opened file. Re-opening an open file keeps its draft.
  useEffect(() => {
    for (const file of openFiles) {
      if (statesRef.current.has(file)) continue;
      setFileStates((current) => {
        if (current.has(file)) return current;
        const next = new Map(current);
        next.set(file, { saved: "", loaded: false, loading: true, error: null, binary: false });
        return next;
      });
      void api
        .editorReadFile(file)
        .then((res) => {
          setFileStates((current) => {
            const state = current.get(file);
            if (!state) return current; // closed while in flight
            const next = new Map(current);
            if (!res.ok) {
              next.set(file, { ...state, loading: false, error: res.error ?? "" });
            } else if (res.binary) {
              next.set(file, { ...state, loading: false, binary: true });
            } else {
              next.set(file, { saved: res.content ?? "", loaded: true, loading: false, error: null, binary: false });
            }
            return next;
          });
          if (res.ok && !res.binary) {
            setDrafts((current) => {
              if (current.has(file)) return current;
              const next = new Map(current);
              next.set(file, res.content ?? "");
              return next;
            });
          }
        })
        .catch((err: unknown) => {
          setFileStates((current) => {
            const state = current.get(file);
            if (!state) return current;
            const next = new Map(current);
            next.set(file, { ...state, loading: false, error: err instanceof Error ? err.message : String(err) });
            return next;
          });
        });
    }
  }, [openFiles]);

  const openFile = useCallback((file: string): void => {
    setActiveFile(file);
    setOpenFiles((files) => (files.includes(file) ? files : [...files, file]));
  }, []);

  const closeFile = useCallback((file: string): void => {
    const files = openRef.current;
    const idx = files.indexOf(file);
    if (idx === -1) return;
    const next = files.filter((f) => f !== file);
    setOpenFiles(next);
    setDrafts((current) => {
      if (!current.has(file)) return current;
      const nextDrafts = new Map(current);
      nextDrafts.delete(file);
      return nextDrafts;
    });
    setFileStates((current) => {
      if (!current.has(file)) return current;
      const nextStates = new Map(current);
      nextStates.delete(file);
      return nextStates;
    });
    if (activeRef.current === file) {
      setActiveFile(next[Math.min(idx, next.length - 1)] ?? null);
    }
  }, []);

  const setDraft = useCallback((file: string, content: string): void => {
    setDrafts((current) => {
      if (current.get(file) === content) return current;
      const next = new Map(current);
      next.set(file, content);
      return next;
    });
  }, []);

  const markSaved = useCallback((file: string, content: string): void => {
    setFileStates((current) => {
      const state = current.get(file);
      if (!state) return current;
      const next = new Map(current);
      next.set(file, { ...state, saved: content });
      return next;
    });
  }, []);

  const closeWorkspace = useCallback((): void => {
    setOpenFiles([]);
    setActiveFile(null);
    setDrafts(new Map());
    setFileStates(new Map());
  }, []);

  const dirtyFiles = openFiles.filter((file) => {
    const state = fileStates.get(file);
    return Boolean(state?.loaded) && drafts.get(file) !== state?.saved;
  });

  return {
    openFiles,
    activeFile,
    drafts,
    fileStates,
    dirtyFiles,
    anyDirty: dirtyFiles.length > 0,
    openFile,
    closeFile,
    setActiveFile,
    setDraft,
    markSaved,
    closeWorkspace,
  };
}
