/**
 * specs — the spec-domain read model (public barrel; the only import surface).
 *
 * Owns: frontmatter parsing, the derived SpecIndex, graph/validate/drift
 * queries, and the design-chain registration writer. Forbidden reaches: no
 * UI, no session/LLM dependencies — a pure filesystem read model.
 * `resetSpecIndexCache` is a test/teardown helper (kept here, not on the
 * cross-package root barrel); `sanitizeSuiteSlug` stays module-internal.
 */
export type { SpecDriftFinding, SpecDriftGate, SpecDriftState, SpecGraph, SpecIssue, SpecNode } from "./spec-index";
export {
  SPEC_NODE_STATUSES,
  SPEC_NODE_TYPES,
  getSpecGraph,
  listSpecs,
  resetSpecIndexCache,
  validateSpecs,
} from "./spec-index";
export type { DesignChainRegistration } from "./writer";
export { ensureDesignChainRegistration } from "./writer";
