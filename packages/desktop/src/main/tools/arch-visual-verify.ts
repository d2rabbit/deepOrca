/**
 * Arch visual verifier (specs/arch-visual-readback 门①②③) — the host side
 * of the archify-controller `ArchVisualVerifier` seam. Three layered gates
 * over each DELIVERED artifact, cheapest first (fireworks "deterministic
 * checks first" philosophy; no upstream code):
 *
 *   门① layout contract  — archify validate --layout-json (architecture
 *        only), node overlap + out-of-canvas checks (archify-layout-check).
 *   门② containment      — the vendored visual-check.mjs harness: CDP-driven
 *        Chrome screenshots (4 viewports × 2 themes) + scroll-overflow
 *        containment; exit 2 / receipt.error = honest skip.
 *   门③ vision readback  — ONE vision-model call over a 1440×900 light+dark
 *        screenshot pair with a four-question perceptual contract (clipping/
 *        overlap/label overflow/legibility); skipped when no vision model is
 *        configured — honestly, never as a pass.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVisionClient, runStandaloneChatCompletion } from "@deeporca/core";
import type { ArchVisualVerdict } from "@deeporca/core";
import { listArchifyArtifacts } from "./archify-cli";
import { runArchifyLayoutCheck } from "./archify-layout-check";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Vendor root resolves for BOTH layouts: bundled main (dist/main.js →
// ../vendor/archify) and unbundled source runs (src/main/tools →
// ../../../vendor/archify — tsx/real-machine scripts). First hit wins.
function resolveArchifyVendorDir(): string {
  const candidates = [
    join(__dirname, "..", "vendor", "archify"), // bundled: dist/main.js
    join(__dirname, "..", "..", "..", "vendor", "archify"), // source: src/main/tools
  ];
  return candidates.find((dir) => existsSync(join(dir, "bin", "archify.mjs"))) ?? candidates[0]!;
}
const ARCHIFY_VENDOR_DIR = resolveArchifyVendorDir();
const ARCHIFY_BIN = join(ARCHIFY_VENDOR_DIR, "bin", "archify.mjs");

/** visual-check harness budget: 8 captures (4 viewports × 2 themes) + page loads. */
const VISUAL_CHECK_TIMEOUT_MS = 240_000;

type GateStatus = "pass" | "fail" | "skipped";

// ── 门②: containment harness ────────────────────────────────────────────────

interface VisualCheckReceipt {
  status?: string;
  error?: string;
  containment?: { status?: string };
  captures?: { status?: string };
}

/** Sidecar receipt path convention (visual-check.mjs sidecarPaths). */
function receiptPathFor(htmlPath: string): string {
  return htmlPath.replace(/\.html?$/i, "") + ".visual-check.json";
}

function runContainmentGate(htmlPath: string): { status: GateStatus; findings: string[] } {
  if (!existsSync(ARCHIFY_BIN)) {
    return { status: "skipped", findings: ["archify.mjs not vendored"] };
  }
  // The harness is a LIBRARY (visual-check.mjs exports runVisualCheck, no CLI
  // of its own) — the entry is the archify CLI subcommand, which writes the
  // receipt/screenshots sidecars next to the artifact and exits 0/1/2
  // (pass/fail/skipped). Real-machine T2 finding: spawning the library file
  // directly exits 0 doing nothing — trust ONLY the receipt, never a
  // no-receipt exit code.
  const run = spawnSync(process.execPath, [ARCHIFY_BIN, "visual-check", htmlPath], {
    encoding: "utf8",
    timeout: VISUAL_CHECK_TIMEOUT_MS,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  let receipt: VisualCheckReceipt | null = null;
  try {
    receipt = JSON.parse(readFileSync(receiptPathFor(htmlPath), "utf8")) as VisualCheckReceipt;
  } catch {
    receipt = null;
  }
  if (receipt?.error) {
    return { status: "skipped", findings: [receipt.error.slice(0, 200)] };
  }
  if (!receipt) {
    return {
      status: "skipped",
      findings: [`visual-check produced no receipt (exit ${run.status}): ${String(run.stderr ?? "").slice(0, 160)}`],
    };
  }
  if (run.status === 2 || receipt.status === "skipped") {
    return { status: "skipped", findings: [`visual-check skipped (exit ${run.status})`] };
  }
  const containment = receipt.containment?.status ?? "fail";
  if (containment !== "pass") {
    return { status: "fail", findings: [`containment ${containment}: content overflows the viewport`] };
  }
  return { status: "pass", findings: [] };
}

// ── 门③: perceptual vision readback ─────────────────────────────────────────

/** Four-question perceptual contract (fail-closed parse, one retry in-band). */
const VISION_CONTRACT_PROMPT =
  "You are auditing a rendered architecture diagram for ACCIDENTAL visual defects " +
  "(not aesthetics). Look at BOTH screenshots (light and dark themes) and answer " +
  'JSON only: {"clipping":bool,"overlap":bool,"label_overflow":bool,"illegible":bool,"evidence":"one line naming the worst area"} ' +
  "- clipping: text or shapes cut off at edges; overlap: nodes visually colliding; " +
  "label_overflow: labels escaping their containers; illegible: text unreadable " +
  "(contrast/size). true only for clear defects you can point at.";

function parseVisionVerdict(raw: string): { pass: boolean; evidence: string } | null {
  // Tolerate markdown fences and prose wrappers around the JSON object
  // (real-machine T2: deepseek-v4-flash-vision-exp sometimes wraps).
  const fenced = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const match = fenced ?? raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(fenced ? fenced[1]! : match[0]) as Record<string, unknown>;
    const flags = ["clipping", "overlap", "label_overflow", "illegible"].map((key) => parsed[key] === true);
    const evidence = typeof parsed.evidence === "string" ? parsed.evidence.slice(0, 200) : "";
    return { pass: flags.every((f) => !f), evidence };
  } catch {
    return null;
  }
}

async function runVisionGate(
  projectRoot: string,
  htmlPath: string
): Promise<{ status: GateStatus; findings: string[] }> {
  const { client, model } = createVisionClient(projectRoot);
  if (!client || !model) {
    return { status: "skipped", findings: ["vision model not configured — visual review skipped"] };
  }
  // 1440×900 light + dark screenshots (visual-check sidecar convention).
  const stem = htmlPath.replace(/\.html?$/i, "");
  const shots = ["1440x900.light.png", "1440x900.dark.png"]
    .map((suffix) => `${stem}.visual-check.${suffix}`)
    .filter((p) => existsSync(p));
  if (shots.length === 0) {
    return { status: "skipped", findings: ["no visual-check screenshots to read back"] };
  }
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: VISION_CONTRACT_PROMPT },
    ...shots.map((p) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${readFileSync(p).toString("base64")}` },
    })),
  ];
  // Real-machine T2: the vision model occasionally wraps or drops the JSON —
  // one in-band retry on an unparseable verdict (spec R3), then honest skip.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { message } = await runStandaloneChatCompletion({
        client,
        projectRoot,
        request: { model, max_tokens: 512, messages: [{ role: "user", content }] },
      });
      const verdict = parseVisionVerdict(String(message.content ?? ""));
      if (verdict) {
        return verdict.pass
          ? { status: "pass", findings: verdict.evidence ? [verdict.evidence] : [] }
          : { status: "fail", findings: [verdict.evidence || "perceptual defect flagged by vision readback"] };
      }
      // unparseable → retry once in-band
    } catch (err) {
      return {
        status: "skipped",
        findings: [`vision readback failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`],
      };
    }
  }
  return { status: "skipped", findings: ["visual review inconclusive (unparseable vision verdict after retry)"] };
}

// ── Verifier assembly ───────────────────────────────────────────────────────

export async function verifyArchArtifacts(root: string): Promise<readonly ArchVisualVerdict[]> {
  const artifacts = listArchifyArtifacts(root).filter((a) => a.htmlDelivered);
  const verdicts: ArchVisualVerdict[] = [];
  for (const artifact of artifacts) {
    const findings: string[] = [];

    // 门① — deterministic geometry (cheapest; architecture-only by upstream).
    const layout = runArchifyLayoutCheck({
      archifyBinPath: ARCHIFY_BIN,
      diagramType: artifact.type,
      irPath: artifact.jsonPath,
    });
    const layoutStatus: GateStatus = layout.skipped ? "skipped" : layout.violations.length > 0 ? "fail" : "pass";
    if (layout.skipped) {
      findings.push(`layout: ${layout.skipReason ?? "skipped"}`);
    } else {
      findings.push(...layout.violations.map((v) => `layout ${v.kind} [${v.nodes.join("↔")}]: ${v.detail}`));
    }

    // 门② — containment harness (needs screenshots for 门③ too).
    const containment = runContainmentGate(artifact.htmlPath);
    findings.push(...containment.findings.map((f) => `containment: ${f}`));

    // 门③ — vision readback, only when containment held (layered cost).
    const vision =
      containment.status === "pass"
        ? await runVisionGate(root, artifact.htmlPath)
        : { status: "skipped" as GateStatus, findings: ["vision skipped (containment failed or skipped)"] };
    findings.push(...vision.findings.map((f) => `vision: ${f}`));

    const gates = { layout: layoutStatus, containment: containment.status, vision: vision.status };
    const status: ArchVisualVerdict["status"] =
      layoutStatus === "fail" || containment.status === "fail" || vision.status === "fail"
        ? "fail"
        : layoutStatus === "pass" && containment.status === "pass" && vision.status === "pass"
          ? "pass"
          : "skipped";
    const contactSheet = existsSync(`${artifact.htmlPath.replace(/\.html?$/i, "")}.visual-check.html`)
      ? `${basename(artifact.htmlPath).replace(/\.html?$/i, "")}.visual-check.html`
      : undefined;
    verdicts.push({
      artifact: artifact.name,
      status,
      gates,
      findings: findings.filter((f) => !f.endsWith("pass") || f.includes(":")),
      ...(contactSheet ? { contactSheet } : {}),
    });
  }
  return verdicts;
}
