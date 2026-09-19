/**
 * specs — the spec-domain read model (public barrel; the only import surface).
 *
 * Owns: frontmatter parsing, the derived SpecIndex, graph/validate/drift
 * queries, and the design-chain registration writer. Forbidden reaches: no
 * UI, no session/LLM dependencies — a pure filesystem read model.
 */
export type { SpecDriftFinding, SpecDriftGate, SpecDriftState, SpecGraph, SpecIssue, SpecNode } from "./spec-index";
export { getSpecGraph, listSpecs, resetSpecIndexCache, validateSpecs } from "./spec-index";
export type { DesignChainRegistration } from "./writer";
export { ensureDesignChainRegistration, sanitizeSuiteSlug } from "./writer";
