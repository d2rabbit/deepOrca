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
  PrototypeSuiteContent,
  PrototypeVerificationCheck,
  PrototypeVerificationResult,
  UiSuiteContent,
};

export function isPrototypeContent(content: DesignSuiteContent): content is PrototypeSuiteContent {
  return "openui" in content || "spec" in content || "verification" in content;
}

export function isUiContent(content: DesignSuiteContent): content is UiSuiteContent {
  // The UI workspace only ever mounts kind="ui" suites, so a bare `openui`
  // field here IS the legacy artifact (EARS 15: 仅 openui 的历史版本必须
  // 可达) — do not gate it out into the empty state. `leafer` versions may
  // likewise exist before any quality/tokens land (EARS 17).
  return (
    "quality" in content ||
    "sourcePrototype" in content ||
    "designSystemId" in content ||
    "tokens" in content ||
    "leafer" in content ||
    "openui" in content
  );
}
