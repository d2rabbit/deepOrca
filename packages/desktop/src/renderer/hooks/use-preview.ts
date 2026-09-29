import { useCallback, useState } from "react";
import { clearSurfaces as clearA2uiSurfaces } from "../a2ui/processor";
import { detectPrototypeArtifact } from "../moonviz/detect-artifact";
import type { SessionMessage } from "../../shared/ipc";

/**
 * Preview surfaces: A2UI prototypes, MoonViz prototype documents (specs/
 * moonviz-engine-replacement — the retired OpenUI mode's successor),
 * DeepDesign (.dd) documents and the CodeGraph architecture HTML.
 *
 * Extracted from App.tsx verbatim. The tool-result detection previously lived
 * inline inside the boot effect's onAssistantMessage handler (~60 lines);
 * `applyToolMessage` keeps only the state transitions — which pipeline a tool
 * result belongs to (and with which payload) is decided by the pure
 * `detectPrototypeArtifact` function (see moonviz/detect-artifact.ts).
 *
 * Both `applyToolMessage` and `resetForSession` keep an empty dep array: the first
 * is called from the boot effect (whose dep array must stay identity-stable or the
 * entire boot chain re-runs) and the second from `loadSession`.
 */
export type PreviewState = {
  prototypeJson: string | null;
  prototypeMode: "a2ui" | "moonviz" | "design" | "spec";
  /** Canonical MoonViz `.mbt.md` document carried by the preview. */
  prototypeMoonvizDoc: string;
  designContent: string | null;
  graphHtml: string | null;
  /** Returned raw — passed straight to CodeReviewPanel's onShowGraph. */
  setGraphHtml: React.Dispatch<React.SetStateAction<string | null>>;
  previewOpen: boolean;
  previewTab: "prototype" | "design" | "prd";
  setPreviewTab: React.Dispatch<React.SetStateAction<"prototype" | "design" | "prd">>;
  /** Auto-open the matching preview when a render/update tool result arrives. */
  applyToolMessage: (message: SessionMessage) => void;
  /** Open a stored design artifact in the preview (from DesignPanel). */
  openDesignArtifact: (pipeline: "moonviz" | "design" | "spec", content: string) => void;
  /** Clear preview state (and cached A2UI surfaces) when switching sessions. */
  resetForSession: () => void;
  closePreview: () => void;
};

export function usePreview(): PreviewState {
  const [prototypeJson, setPrototypeJson] = useState<string | null>(null);
  const [prototypeMode, setPrototypeMode] = useState<"a2ui" | "moonviz" | "design" | "spec">("moonviz");
  const [prototypeMoonvizDoc, setPrototypeMoonvizDoc] = useState<string>("");
  const [designContent, setDesignContent] = useState<string | null>(null);
  const [graphHtml, setGraphHtml] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"prototype" | "design" | "prd">("prototype");

  // Auto-switch the matching preview panel when a render/update tool result arrives.
  const applyToolMessage = useCallback((message: SessionMessage) => {
    if (message.role !== "tool") return;
    const artifact = detectPrototypeArtifact(message.content || "");
    if (!artifact) return;

    // Single right-slot rule: opening the preview panel evicts the graph panel.
    setGraphHtml(null);
    if (artifact.mode === "design" || artifact.mode === "spec") {
      // Spec documents (PRDs) get their OWN tab — the Design tab is for UI
      // visual drafts (.dd) only (user report 2026-09-02: a PRD opened under
      // the "Design" marker read as a UI design).
      setPrototypeMode(artifact.mode);
      setDesignContent(artifact.payload);
      setPreviewOpen(true);
      setPreviewTab(artifact.mode === "spec" ? "prd" : "design");
    } else if (artifact.mode === "moonviz") {
      setPrototypeMode("moonviz");
      setPrototypeMoonvizDoc(artifact.payload);
      setPreviewOpen(true);
      setPreviewTab("prototype");
    } else {
      setPrototypeMode("a2ui");
      setPrototypeJson(artifact.payload);
      setPreviewOpen(true);
      if (!artifact.isUpdate) {
        setPreviewTab("prototype");
      }
    }
  }, []);

  const resetForSession = useCallback(() => {
    // M1: drop all cached A2UI surfaces so the new session starts clean and
    // the global singleton Map doesn't grow unbounded across switches.
    clearA2uiSurfaces();
    // F3: reset prototype panel state so switching sessions doesn't reopen
    // the preview with stale content from the prior session.
    setPrototypeJson(null);
    setPrototypeMoonvizDoc("");
    setPrototypeMode("a2ui");
    setPreviewOpen(false);
    setDesignContent(null);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setPrototypeJson(null);
    setPrototypeMoonvizDoc("");
    setDesignContent(null);
  }, []);

  /** Open a stored design artifact in the preview panel (from DesignPanel / task hub). */
  const openDesignArtifact = useCallback((pipeline: "moonviz" | "design" | "spec", content: string) => {
    setGraphHtml(null);
    if (pipeline === "moonviz") {
      setPrototypeMode("moonviz");
      setPrototypeMoonvizDoc(content);
      setPreviewTab("prototype");
    } else if (pipeline === "spec") {
      // PRD → its own tab; the Design tab stays UI-visual-draft only.
      setPrototypeMode("spec");
      setDesignContent(content);
      setPreviewTab("prd");
    } else {
      setPrototypeMode(pipeline);
      setDesignContent(content);
      setPreviewTab("design");
    }
    setPreviewOpen(true);
  }, []);

  return {
    prototypeJson,
    prototypeMode,
    prototypeMoonvizDoc,
    designContent,
    graphHtml,
    setGraphHtml,
    previewOpen,
    previewTab,
    setPreviewTab,
    applyToolMessage,
    openDesignArtifact,
    resetForSession,
    closePreview,
  };
}
