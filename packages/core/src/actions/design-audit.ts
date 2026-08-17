/**
 * design.audit — deterministic, zero-LLM audit of .dd design artifacts.
 *
 * The `audit` verb for the design line (structure follows the `audit`
 * discipline of markdown design-skill systems: read the target → score it
 * against anti-slop rules → emit a ranked findings list → DO NOT change
 * anything). This is the machine-checkable half of taste:
 *
 *   - the three computable diversity axes of taste #11 (paper lightness
 *     band, display type family, accent hue band), compared against the
 *     recent artifacts in `.deeporca/designs/`;
 *   - a deterministic subset of the taste gates (banned identity fonts,
 *     external image URLs, `transition-all`, bare-`1fr` image grids,
 *     section-marker integrity, missing macrostructure declaration).
 *
 * Findings are sorted auto-fail > high > medium > low; long finding lists are
 * bucket-sampled by rule (coverage over prefix). Deterministic: no LLM, no
 * rendering — front-matter tokens and the HTML body only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import type { ActionDefinition, ActionRun } from "./types";
import { bucketSample, renderBucketSample } from "../common/bucket-sample";

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export interface DesignAuditInput {
  /** Artifact to audit: file name under .deeporca/designs/ (with or without .dd), or omit for the latest. Contained to that directory. */
  target?: string;
  /** How many recent artifacts to compare the three axes against. Default 3. */
  compareRecent?: number;
}

export type DesignAuditSeverity = "auto-fail" | "high" | "medium" | "low";

export interface DesignAuditFinding {
  readonly id: string;
  readonly severity: DesignAuditSeverity;
  readonly rule: string;
  readonly message: string;
}

/** The three computable diversity axes (taste #11). */
export interface DesignAuditAxes {
  readonly lightness: "dark" | "mid" | "light";
  readonly displayFamily: string;
  readonly accentBand: "warm" | "cool" | "neutral" | "chromatic-other";
}

export interface DesignAuditOutput {
  readonly ok: boolean;
  readonly target: string;
  /** Axes computed from the target's front-matter tokens. */
  readonly axes?: DesignAuditAxes;
  /** Artifacts the axes were compared against (name → axes). */
  readonly comparedTo?: ReadonlyArray<{ readonly name: string; readonly axes: DesignAuditAxes }>;
  readonly findings: readonly DesignAuditFinding[];
  /** Bucket-sampled rule summary (always present; coverage over prefix). */
  readonly summary: readonly string[];
  /** Findings omitted from the array above when it was capped (>15). */
  readonly omittedFindings?: number;
  readonly error?: string;
}

// ── Color / type math ────────────────────────────────────────────────────────

const BANNED_IDENTITY_FONTS = new Set(["inter", "roboto", "open sans", "poppins", "lato"]);

function parseHex(color: string | undefined): [number, number, number] | null {
  if (!color) return null;
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1];
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16) / 255,
      parseInt(hex[1] + hex[1], 16) / 255,
      parseInt(hex[2] + hex[2], 16) / 255,
    ];
  }
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

/** WCAG relative luminance (0–1). */
function relativeLuminance(rgb: [number, number, number]): number {
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function hueOf(rgb: [number, number, number]): { h: number; s: number } {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s };
}

const FONT_FAMILY_CLASSIFIERS: ReadonlyArray<{ readonly family: string; readonly keywords: readonly string[] }> = [
  { family: "mono", keywords: ["sf mono", "fira code", "jetbrains mono", "cascadia", "menlo", "consolas", "mono"] },
  { family: "display-serif", keywords: ["didot", "bodoni", "playfair"] },
  { family: "serif", keywords: ["iowan", "charter", "georgia", "times", "garamond", "cambria", "serif"] },
  { family: "slab", keywords: ["slab", "rockwell", "clarendon"] },
  { family: "black-sans", keywords: ["arial black", "archivo black", "anton"] },
  { family: "geometric-sans", keywords: ["avenir", "futura", "century gothic", "montserrat", "poppins"] },
  { family: "humanist-sans", keywords: ["gill", "franklin gothic", "source sans", "open sans"] },
  { family: "grotesque", keywords: ["helvetica", "arial", "roboto", "inter", "univers", "grotesk"] },
  { family: "system-fallback", keywords: ["system-ui", "-apple-system", "blinkmacsystemfont", "segoe ui"] },
];

/** Classify a font stack into the taste #11 display-family vocabulary (first family wins). */
export function classifyFontFamily(stack: string | undefined): string {
  if (!stack) return "other";
  const first = stack
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "");
  if (!first) return "other";
  for (const { family, keywords } of FONT_FAMILY_CLASSIFIERS) {
    if (keywords.some((k) => first.includes(k))) return family;
  }
  return "other";
}

function firstFamily(stack: string | undefined): string {
  if (!stack) return "";
  return stack
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "");
}

/** Compute the three axes from .dd front-matter tokens; null when tokens are unusable. */
export function computeDesignAxes(tokens: Record<string, unknown> | undefined): DesignAuditAxes | null {
  if (!tokens) return null;
  const bg = parseHex(typeof tokens.bg === "string" ? tokens.bg : undefined);
  const accent = parseHex(typeof tokens.accent === "string" ? tokens.accent : undefined);
  const fontDisplay = typeof tokens.fontDisplay === "string" ? tokens.fontDisplay : undefined;
  if (!bg || !accent || !fontDisplay) return null;
  const lum = relativeLuminance(bg);
  const { h, s } = hueOf(accent);
  const accentBand: DesignAuditAxes["accentBand"] =
    s < 0.08 ? "neutral" : h >= 10 && h <= 60 ? "warm" : h >= 200 && h <= 300 ? "cool" : "chromatic-other";
  return {
    lightness: lum < 0.3 ? "dark" : lum <= 0.85 ? "mid" : "light",
    displayFamily: classifyFontFamily(fontDisplay),
    accentBand,
  };
}

function axesEqual(a: DesignAuditAxes, b: DesignAuditAxes): boolean {
  return a.lightness === b.lightness && a.displayFamily === b.displayFamily && a.accentBand === b.accentBand;
}

// ── Action ───────────────────────────────────────────────────────────────────

const MAX_FINDINGS = 15;

export const designAuditDefinition: ActionDefinition<DesignAuditInput> = {
  id: "design.audit",
  description:
    "Audit a design artifact (.dd) against the anti-slop discipline — deterministic, no LLM, changes nothing. " +
    "Machine-checks the three diversity axes of taste #11 (paper lightness band / display type family / accent hue band) " +
    "against recent artifacts in .deeporca/designs/, plus gate subsets: banned identity fonts, external image URLs, " +
    "transition-all, bare-1fr image grids, section markers, macrostructure declaration. Returns a severity-ranked findings list.",
  category: "design",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "Artifact to audit: name under .deeporca/designs/ (e.g. 'acme-landing'), or omit for the latest",
      },
      compareRecent: {
        type: "number",
        description: "How many recent artifacts to compare the three axes against (default 3)",
      },
    },
    additionalProperties: false,
  },
  sideEffects: ["read-in-cwd"],
};

interface ParsedDd {
  frontmatter: Record<string, unknown>;
  tokens: Record<string, unknown> | undefined;
  html: string;
}

function parseDd(raw: string): ParsedDd {
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  const tokens =
    typeof fm.tokens === "object" && fm.tokens !== null ? (fm.tokens as Record<string, unknown>) : undefined;
  return { frontmatter: fm, tokens, html: parsed.content ?? "" };
}

function resolveTarget(projectRoot: string, target: string | undefined): string | null {
  const dir = path.join(projectRoot, ".deeporca", "designs");
  if (!target) {
    // Latest .dd by modification time.
    try {
      const candidates = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".dd"))
        .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      return candidates[0] ? path.join(dir, candidates[0].f) : null;
    } catch {
      return null;
    }
  }
  // Containment (security-audit A1 lesson, design-store isSafeArtifactId
  // pattern): the target is LLM input — reject absolute paths and anything
  // that resolves outside .deeporca/designs/ instead of reading it.
  if (path.isAbsolute(target) || target.split(/[\\/]/).includes("..")) {
    return null;
  }
  const asIs = path.join(dir, target);
  if (fs.existsSync(asIs)) return asIs;
  const withExt = path.join(dir, target.endsWith(".dd") ? target : `${target}.dd`);
  return fs.existsSync(withExt) ? withExt : null;
}

function listRecentDd(projectRoot: string, exclude: string, count: number): string[] {
  const dir = path.join(projectRoot, ".deeporca", "designs");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".dd"))
      .map((f) => path.join(dir, f))
      .filter((p) => p !== exclude)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, count);
  } catch {
    return [];
  }
}

export const designAuditRun: ActionRun<DesignAuditInput, DesignAuditOutput> = async (input, ctx) => {
  const projectRoot = ctx.projectRoot;
  const targetPath = resolveTarget(projectRoot, input?.target?.trim() || undefined);
  if (!targetPath) {
    return {
      ok: false,
      target: input?.target ?? "(latest)",
      findings: [],
      summary: [],
      error: input?.target
        ? `artifact not found: ${input.target} (looked in .deeporca/designs/)`
        : "no .dd artifacts in .deeporca/designs/ yet — generate one first",
    };
  }

  let parsed: ParsedDd;
  try {
    parsed = parseDd(fs.readFileSync(targetPath, "utf-8"));
  } catch (err) {
    return {
      ok: false,
      target: targetPath,
      findings: [],
      summary: [],
      error: `failed to read/parse artifact: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const findings: DesignAuditFinding[] = [];
  const { tokens, html, frontmatter } = parsed;

  // ── Gate 1: banned identity fonts (auto-fail / high) ─────────────────────
  const displayFirst = firstFamily(typeof tokens?.fontDisplay === "string" ? tokens.fontDisplay : undefined);
  const bodyFirst = firstFamily(typeof tokens?.fontBody === "string" ? tokens.fontBody : undefined);
  if (displayFirst && BANNED_IDENTITY_FONTS.has(displayFirst)) {
    findings.push({
      id: "font-banned-display",
      severity: "auto-fail",
      rule: "identity-font",
      message: `fontDisplay identity font "${displayFirst}" is on the banned list (Inter/Roboto/Open Sans/Poppins/Lato) — every design using it reads as generic AI output. Swap the display stack.`,
    });
  }
  if (bodyFirst && BANNED_IDENTITY_FONTS.has(bodyFirst)) {
    findings.push({
      id: "font-banned-body",
      severity: "high",
      rule: "identity-font",
      message: `fontBody identity font "${bodyFirst}" is on the banned list — pick a non-generic body stack.`,
    });
  }

  // ── Gate 2: three computable axes ─────────────────────────────────────────
  const axes = computeDesignAxes(tokens);
  const comparedTo: { name: string; axes: DesignAuditAxes }[] = [];
  if (!axes) {
    findings.push({
      id: "tokens-incomplete",
      severity: "medium",
      rule: "tokens",
      message:
        "front-matter tokens incomplete (need bg/accent/fontDisplay as hex/string) — the three diversity axes cannot be computed or enforced.",
    });
  } else {
    const recent = listRecentDd(projectRoot, targetPath, input?.compareRecent ?? 3);
    for (const recentPath of recent) {
      try {
        const other = computeDesignAxes(parseDd(fs.readFileSync(recentPath, "utf-8")).tokens);
        if (other) {
          comparedTo.push({ name: path.basename(recentPath), axes: other });
          if (axesEqual(axes, other)) {
            findings.push({
              id: `axes-collision:${path.basename(recentPath)}`,
              severity: "high",
              rule: "diversity-axes",
              message: `all three axes (lightness=${axes.lightness}, family=${axes.displayFamily}, accent=${axes.accentBand}) identical to ${path.basename(recentPath)} — taste #11 requires at least one axis to differ between consecutive designs.`,
            });
          }
        }
      } catch {
        // unreadable sibling — not the audited artifact's problem
      }
    }
  }

  // ── Gate 3: HTML body deterministic subset ────────────────────────────────
  if (/<img[^>]+src\s*=\s*["']https?:\/\//i.test(html)) {
    findings.push({
      id: "external-images",
      severity: "high",
      rule: "image-placeholders",
      message:
        'external <img src="http…"> found — use .ph-img placeholders; self-contained artifacts must not depend on remote images.',
    });
  }
  if (/transition[^;"']*?\ball\b/i.test(html)) {
    findings.push({
      id: "transition-all",
      severity: "medium",
      rule: "motion-discipline",
      message: "`transition-all` found — name the properties being transitioned (motion-patterns vocabulary).",
    });
  }
  for (const m of html.matchAll(/grid-template-columns:\s*([^;}"]+)/gi)) {
    const value = m[1];
    if (/\b1fr\b/.test(value) && !value.includes("minmax(0,")) {
      const around = html.slice(Math.max(0, m.index - 600), m.index + 600);
      if (/<img|ph-img/.test(around)) {
        findings.push({
          id: `grid-1fr-image:${m.index}`,
          severity: "medium",
          rule: "grid-math",
          message:
            "image-bearing grid uses bare `1fr` tracks without `minmax(0, 1fr)` — intrinsic image widths will blow out the grid.",
        });
      }
    }
  }
  const markerCount = (html.match(/<!--\s*dd:section/g) || []).length;
  const sectionCount = (html.match(/data-dd-id=/g) || []).length;
  if (markerCount !== sectionCount) {
    findings.push({
      id: "section-markers",
      severity: "medium",
      rule: "dd-contract",
      message: `section markers (${markerCount}) and data-dd-id sections (${sectionCount}) disagree — targeted section editing and the compiler both depend on the pair.`,
    });
  }
  if (!frontmatter.macrostructure) {
    findings.push({
      id: "no-macrostructure",
      severity: "low",
      rule: "macrostructure",
      message:
        "front-matter has no `macrostructure:` declaration — pick one from templates/design/macrostructures/ so skeleton diversity is auditable.",
    });
  }

  // ── Rank, cap, and bucket-sample ──────────────────────────────────────────
  const order: Record<DesignAuditSeverity, number> = { "auto-fail": 0, high: 1, medium: 2, low: 3 };
  const sorted = findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const kept = sorted.slice(0, MAX_FINDINGS);
  const sample = bucketSample(sorted, (f) => f.rule);
  const summary = renderBucketSample(sample, (f) => `${f.severity}:${f.id}`.slice(0, 60));

  return {
    ok: true,
    target: path.basename(targetPath),
    axes: axes ?? undefined,
    comparedTo: comparedTo.length > 0 ? comparedTo : undefined,
    findings: kept,
    summary,
    omittedFindings: sorted.length > kept.length ? sorted.length - kept.length : undefined,
  };
};
