/**
 * Project dependency readiness probe (specs/cmb-adoption CMB-5, desktop side).
 *
 * A language server launched against a project whose declared dependencies
 * are NOT installed produces false-positive import/dependency errors — worse
 * than no diagnostics at all, because they flow back into the agent's
 * self-correction loop (CodeBrain bootstrap: "Without these steps, validate()
 * may report false-positive import/dependency errors").
 *
 * Rules of engagement (design §2.2):
 *   - only intercept "deps declared but not installed" — projects WITHOUT a
 *     dependency declaration are left alone (zero interference, fail-open);
 *   - pure production path helpers (`node:path`/`node:fs`) — no hand-rolled
 *     separator surgery (AGENTS.md cross-platform path policy);
 *   - no caching: a single existsSync per marker, so `npm install` heals the
 *     leg on the very next request.
 *
 * A missing state returns a remediation hint so the degradation line that
 * reaches the model says HOW to fix it, not just that it failed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LspServerSpec } from "./server-specs";

export type DepsReadiness = { ready: true } | { ready: false; reason: string; remediation: string };

function exists(root: string, ...segments: string[]): boolean {
  return existsSync(join(root, ...segments));
}

/** A go.mod with a `require` entry declares external modules; a stdlib-only
 *  module legitimately has NO go.sum, and gopls handles it fine — only the
 *  "declared deps, no go.sum" combination is a false-positive risk. */
function goModDeclaresExternalDeps(root: string): boolean {
  try {
    const text = readFileSync(join(root, "go.mod"), "utf8");
    return /require\s+\(/.test(text) || /require\s+\S+\s+v\d/.test(text);
  } catch {
    return false; // unreadable → treat as no declaration → probe open
  }
}

/**
 * Per-family readiness table (specs/cmb-adoption design §2.2 — three families
 * this round; the other seven have no cheap, reliable "deps missing" marker
 * and stay fail-open until an observation window justifies criteria).
 */
export function probeDepsReadiness(root: string, spec: LspServerSpec): DepsReadiness {
  switch (spec.id) {
    case "typescript": {
      if (!exists(root, "package.json")) return { ready: true };
      if (exists(root, "node_modules")) return { ready: true };
      return {
        ready: false,
        reason: "typescript dependencies not installed (package.json present, node_modules missing)",
        remediation: "run npm install",
      };
    }
    case "python": {
      const declared = exists(root, "pyproject.toml") || exists(root, "requirements.txt");
      if (!declared) return { ready: true };
      if (exists(root, ".venv") || exists(root, "venv")) return { ready: true };
      return {
        ready: false,
        reason: "python dependencies not installed (pyproject.toml/requirements.txt present, no .venv)",
        remediation: "run python -m venv .venv && .venv/bin/pip install -r requirements.txt (or equivalent)",
      };
    }
    case "go": {
      if (!exists(root, "go.mod")) return { ready: true };
      if (!goModDeclaresExternalDeps(root)) return { ready: true };
      if (exists(root, "go.sum")) return { ready: true };
      return {
        ready: false,
        reason: "go modules not resolved (go.mod declares requires, go.sum missing)",
        remediation: "run go mod tidy",
      };
    }
    default:
      return { ready: true };
  }
}

/** Stable error token the core side can pattern-match if it ever needs to. */
export const DEPS_MISSING_TOKEN = "LSP_UNAVAILABLE(deps-missing)";

/** Full band-ready error string for a not-ready probe. */
export function depsMissingError(probe: { ready: false; reason: string; remediation: string }): string {
  return `${DEPS_MISSING_TOKEN}: ${probe.reason} — ${probe.remediation}`;
}
