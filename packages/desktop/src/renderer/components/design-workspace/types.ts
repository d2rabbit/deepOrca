import type {
  DesignArtifactRef,
  DesignLintFinding,
  DesignQualityResult,
  DesignSuite,
  DesignSuiteChangeEvent,
  DesignSuiteContent,
  DesignSuiteKind,
  DesignSuiteStatus,
  DesignSuiteSummary,
  DesignSuiteVersion,
  DesignSystemCatalogItem,
  DesignTheme,
  DesignThemeRef,
  DesignSuiteThemeAssign,
  PrototypeSuiteContent,
  PrototypeVerificationCheck,
  PrototypeVerificationResult,
  UiSuiteContent,
} from "../../../shared/ipc";

export type {
  DesignArtifactRef,
  DesignLintFinding,
  DesignQualityResult,
  DesignSuite,
  DesignSuiteChangeEvent,
  DesignSuiteContent,
  DesignSuiteKind,
  DesignSuiteStatus,
  DesignSuiteSummary,
  DesignSuiteVersion,
  DesignSystemCatalogItem,
  DesignTheme,
  DesignThemeRef,
  DesignSuiteThemeAssign,
  PrototypeSuiteContent,
  PrototypeVerificationCheck,
  PrototypeVerificationResult,
  UiSuiteContent,
};

export function isPrototypeContent(content: DesignSuiteContent): content is PrototypeSuiteContent {
  return "moonviz" in content || "spec" in content || "verification" in content;
}

export function isUiContent(content: DesignSuiteContent): content is UiSuiteContent {
  // MoonViz 接管原型栈后 UI 套件是 leafer-only（旧 openui 字段随栈作废）。
  // `leafer` versions may exist before any quality/tokens land (EARS 17).
  return (
    "quality" in content ||
    "sourcePrototype" in content ||
    "designSystemId" in content ||
    "tokens" in content ||
    "leafer" in content
  );
}

/** Host-side prototype element selection (view-path + viewport bounds).
 *  The MoonViz preview is a sandboxed iframe and emits no DOM selections
 *  today; the type survives for the agent-path revise targeting. */
export type PrototypeSelection = {
  nodePath: string;
  bounds: { x: number; y: number; width: number; height: number };
  action?: string;
};
