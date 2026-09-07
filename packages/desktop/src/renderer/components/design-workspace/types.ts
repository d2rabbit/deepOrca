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
  return "quality" in content || "sourcePrototype" in content || "designSystemId" in content || "tokens" in content;
}
