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
  // leafer versions may exist before any quality/tokens land (EARS 17:
  // field-level routing — a bare {leafer} payload is still a UI suite).
  return (
    "quality" in content ||
    "sourcePrototype" in content ||
    "designSystemId" in content ||
    "tokens" in content ||
    "leafer" in content
  );
}
