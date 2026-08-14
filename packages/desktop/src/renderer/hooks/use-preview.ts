import { useCallback, useState } from "react";
import { clearSurfaces as clearA2uiSurfaces } from "../a2ui/processor";
import type { SessionMessage } from "../../shared/ipc";

/**
 * Preview surfaces: A2UI prototypes, OpenUI Lang code, DeepDesign (.dd) documents
 * and the CodeGraph architecture HTML.
 *
 * Extracted from App.tsx verbatim. The tool-result detection previously lived
 * inline inside the boot effect's onAssistantMessage handler (~60 lines);
 * `applyToolMessage` is that block moved here unchanged.
 *
 * Both `applyToolMessage` and `resetForSession` keep an empty dep array: the first
 * is called from the boot effect (whose dep array must stay identity-stable or the
 * entire boot chain re-runs) and the second from `loadSession`.
 */
export type PreviewState = {
  prototypeJson: string | null;
  prototypeMode: "a2ui" | "openui" | "design";
  prototypeOpenuiCode: string;
  designContent: string | null;
  graphHtml: string | null;
  /** Returned raw — passed straight to CodeReviewPanel's onShowGraph. */
  setGraphHtml: React.Dispatch<React.SetStateAction<string | null>>;
  previewOpen: boolean;
  previewTab: "prototype" | "design";
  setPreviewTab: React.Dispatch<React.SetStateAction<"prototype" | "design">>;
  /** Auto-open the matching preview when a render/update tool result arrives. */
  applyToolMessage: (message: SessionMessage) => void;
  /** Clear preview state (and cached A2UI surfaces) when switching sessions. */
  resetForSession: () => void;
  closePreview: () => void;
};

export function usePreview(): PreviewState {
  const [prototypeJson, setPrototypeJson] = useState<string | null>(null);
  const [prototypeMode, setPrototypeMode] = useState<"a2ui" | "openui" | "design">("openui");
  const [prototypeOpenuiCode, setPrototypeOpenuiCode] = useState<string>("");
  const [designContent, setDesignContent] = useState<string | null>(null);
  const [graphHtml, setGraphHtml] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<"prototype" | "design">("prototype");

  // Auto-switch to prototype panel when a render_prototype/render_surface
  // tool result arrives with A2UI payload.
  const applyToolMessage = useCallback((message: SessionMessage) => {
    if (message.role !== "tool") return;
    const content = message.content || "";
    // Check for DeepDesign (.dd format) tool results via metadata.design.
    if (content.includes("render_design") || content.includes("update_design")) {
      try {
        const parsed = JSON.parse(content);
        const meta = parsed.metadata ?? {};
        if (meta.design) {
          const ddContent = typeof meta.design === "string" ? meta.design : String(meta.design);
          setPrototypeMode("design");
          setDesignContent(ddContent);
          setPreviewOpen(true);
          setPreviewTab("design");
        }
      } catch {
        // Not parseable.
      }
    }
    // Check for OpenUI Lang tool results via metadata.openui.
    if (content.includes("render_openui") || content.includes("update_openui")) {
      try {
        const parsed = JSON.parse(content);
        const meta = parsed.metadata ?? {};
        if (meta.openui) {
          const openuiCode = typeof meta.openui === "string" ? meta.openui : String(meta.openui);
          // Full replacement — update_openui sends the complete updated program.
          setPrototypeMode("openui");
          setPrototypeOpenuiCode(openuiCode);
          setPreviewOpen(true);
          setPreviewTab("prototype");
        }
      } catch {
        // Not parseable.
      }
    }
    // Check for A2UI tool results via metadata.a2ui (set by executor).
    else if (
      content.includes("render_prototype") ||
      content.includes("render_surface") ||
      content.includes("update_surface")
    ) {
      try {
        const parsed = JSON.parse(content);
        const meta = parsed.metadata ?? {};
        if (meta.a2ui) {
          const a2uiJson = typeof meta.a2ui === "string" ? meta.a2ui : JSON.stringify(meta.a2ui);
          if (content.includes("render_prototype") || content.includes("render_surface")) {
            setPrototypeMode("a2ui");
            setPrototypeJson(a2uiJson);
            setPreviewOpen(true);
            setPreviewTab("prototype");
          } else if (content.includes("update_surface")) {
            setPrototypeMode("a2ui");
            setPrototypeJson(a2uiJson);
            setPreviewOpen(true);
          }
        }
      } catch {
        // Not parseable — stay in chat view.
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
    setPrototypeOpenuiCode("");
    setPrototypeMode("a2ui");
    setPreviewOpen(false);
    setDesignContent(null);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setPrototypeJson(null);
    setPrototypeOpenuiCode("");
    setDesignContent(null);
  }, []);

  return {
    prototypeJson,
    prototypeMode,
    prototypeOpenuiCode,
    designContent,
    graphHtml,
    setGraphHtml,
    previewOpen,
    previewTab,
    setPreviewTab,
    applyToolMessage,
    resetForSession,
    closePreview,
  };
}
