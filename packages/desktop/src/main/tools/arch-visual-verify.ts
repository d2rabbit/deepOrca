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
const ARCHIFY_VENDOR_DIR = join(__dirname, "..", "vendor", "archify");
const ARCHIFY_BIN = join(ARCHIFY_VENDOR_DIR, "bin", "archify.mjs");
const VISUAL_CHECK_BIN = join(ARCHIFY_VENDOR_DIR, "bin", "visual-check.mjs");

/** visual-check harness budget: 8 captures (4 viewports × 2 themes) + page loads. */
const VISUAL_CHECK_TIMEOUT_MS = 120_000;

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
  if (!existsSync(VISUAL_CHECK_BIN)) {
    return { status: "skipped", findings: ["visual-check.mjs not vendored"] };
  }
  const run = spawnSync(process.execPath, [VISUAL_CHECK_BIN, htmlPath], {
    encoding: "utf8",
    timeout: VISUAL_CHECK_TIMEOUT_MS,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  // Parse the sidecar receipt for the structured truth (exit code alone
  // conflates fail with harness errors).
  let receipt: VisualCheckReceipt | null = null;
  try {
    receipt = JSON.parse(readFileSync(receiptPathFor(htmlPath), "utf8")) as VisualCheckReceipt;
  } catch {
    receipt = null;
  }
  if (receipt?.error) {
    return { status: "skipped", findings: [receipt.error.slice(0, 200)] };
  }
  if (run.status === 2 || (!receipt && run.status !== 0)) {
    return {
      status: "skipped",
      findings: [`visual-check skipped/unavailable (exit ${run.status}): ${String(run.stderr ?? "").slice(0, 160)}`],
    };
  }
  const containment = receipt?.containment?.status ?? (run.status === 0 ? "pass" : "fail");
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
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
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
  try {
    const { message } = await runStandaloneChatCompletion({
      client,
      projectRoot,
      request: { model, max_tokens: 512, messages: [{ role: "user", content }] },
    });
    const verdict = parseVisionVerdict(String(message.content ?? ""));
    if (!verdict) {
      return { status: "skipped", findings: ["visual review inconclusive (unparseable vision verdict)"] };
    }
    return verdict.pass
      ? { status: "pass", findings: verdict.evidence ? [verdict.evidence] : [] }
      : { status: "fail", findings: [verdict.evidence || "perceptual defect flagged by vision readback"] };
  } catch (err) {
    return {
      status: "skipped",
      findings: [`vision readback failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`],
    };
  }
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
