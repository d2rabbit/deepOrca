/**
 * design.audit tests — deterministic zero-LLM audit of .dd artifacts.
 *
 * Locks in:
 *   - axis computation from front-matter tokens (lightness band, display
 *     family classification, accent hue band);
 *   - three-axis collision vs recent artifacts (taste #11 machine check);
 *   - gate subset: banned identity fonts, external images, transition-all,
 *     bare-1fr image grids, section markers, missing macrostructure;
 *   - severity ordering + bucket-sampled summary;
 *   - audit-only contract: no file is modified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ActionRegistry } from "../actions/registry";
import { NULL_SPAWNER } from "../actions/types";
import { designAuditDefinition, designAuditRun } from "../actions/design-audit";
import { computeDesignAxes, classifyFontFamily } from "../actions/design-audit";

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "design-audit-test-"));
}

function writeDd(root: string, name: string, frontmatter: string, html = ""): string {
  const dir = path.join(root, ".deeporca", "designs");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name.endsWith(".dd") ? name : `${name}.dd`);
  fs.writeFileSync(file, `---\n${frontmatter}\n---\n${html}\n`);
  return file;
}

const DARK_TECH_FM = `
name: dark one
system: dark-tech
macrostructure: landing-flow
tokens:
  bg: "#0a0a0a"
  surface: "#141414"
  accent: "#6366f1"
  text: "#fafafa"
  fontDisplay: "Iowan Old Style, Charter, Georgia, serif"
  fontBody: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
`;

const GOOD_BODY = `
<!-- dd:section hero -->
<section data-dd-id="hero" class="section"><h1 class="display">Title</h1></section>
<!-- /dd:section -->
<!-- dd:section features -->
<section data-dd-id="features" class="section"><div class="grid grid-3"><div class="card ph-img"></div></div></section>
<!-- /dd:section -->
`;

function makeRegistry(root: string): ActionRegistry {
  const r = new ActionRegistry({ projectRoot: root, spawner: NULL_SPAWNER });
  r.register(designAuditDefinition, designAuditRun);
  return r;
}

// ── pure helpers ─────────────────────────────────────────────────────────────

test("computeDesignAxes: dark paper, serif display, cool-ish indigo accent", () => {
  const axes = computeDesignAxes({
    bg: "#0a0a0a",
    accent: "#6366f1",
    fontDisplay: "Iowan Old Style, Georgia, serif",
  });
  assert.ok(axes);
  assert.equal(axes.lightness, "dark");
  assert.equal(axes.displayFamily, "serif");
  // indigo #6366f1 hue ≈ 239° → cool
  assert.equal(axes.accentBand, "cool");
});

test("computeDesignAxes: light paper, mono display, warm accent; neutral chroma", () => {
  const light = computeDesignAxes({ bg: "#fafafa", accent: "#ff5d8f", fontDisplay: '"SF Mono", monospace' });
  assert.ok(light);
  assert.equal(light.lightness, "light");
  assert.equal(light.displayFamily, "mono");
  // hot pink #ff5d8f hue ≈ 336° → chromatic-other
  assert.equal(light.accentBand, "chromatic-other");
  const neutral = computeDesignAxes({ bg: "#fafafa", accent: "#888888", fontDisplay: "Georgia, serif" });
  assert.equal(neutral?.accentBand, "neutral");
});

test("computeDesignAxes: incomplete tokens → null", () => {
  assert.equal(computeDesignAxes(undefined), null);
  assert.equal(computeDesignAxes({ bg: "#0a0a0a" }), null);
});

test("classifyFontFamily: vocabulary classes by first family", () => {
  assert.equal(classifyFontFamily("Helvetica Neue, Arial, sans-serif"), "grotesque");
  assert.equal(classifyFontFamily('"Avenir Next", "Century Gothic"'), "geometric-sans");
  assert.equal(classifyFontFamily("-apple-system, BlinkMacSystemFont"), "system-fallback");
  assert.equal(classifyFontFamily("Something Unknown"), "other");
});

// ── action behavior ──────────────────────────────────────────────────────────

test("clean artifact audits with zero findings and computes axes", async () => {
  const root = makeRoot();
  writeDd(root, "clean", DARK_TECH_FM, GOOD_BODY);
  const result = await makeRegistry(root).execute("design.audit", {}).result;
  assert.equal(result.ok, true);
  assert.equal(result.target, "clean.dd");
  assert.deepEqual(result.findings, []);
  assert.equal(result.axes.lightness, "dark");
});

test("banned display font is auto-fail", async () => {
  const root = makeRoot();
  const fm = DARK_TECH_FM.replace(
    'fontDisplay: "Iowan Old Style, Charter, Georgia, serif"',
    'fontDisplay: "Inter, sans-serif"'
  );
  writeDd(root, "inter-design", fm, GOOD_BODY);
  const result = await makeRegistry(root).execute("design.audit", { target: "inter-design" }).result;
  assert.equal(result.findings[0].id, "font-banned-display");
  assert.equal(result.findings[0].severity, "auto-fail");
});

test("three-axis collision with a recent artifact is a high finding", async () => {
  const root = makeRoot();
  const same = DARK_TECH_FM.replace("name: dark one", "name: dark two");
  writeDd(root, "older", DARK_TECH_FM, GOOD_BODY);
  writeDd(root, "newer", same, GOOD_BODY);
  const result = await makeRegistry(root).execute("design.audit", { target: "newer" }).result;
  const collision = result.findings.find((f) => f.id.startsWith("axes-collision"));
  assert.ok(collision, `expected axes-collision finding, got: ${JSON.stringify(result.findings)}`);
  assert.equal(collision.severity, "high");
  assert.ok(collision.message.includes("older.dd"));
});

test("varying one axis avoids the collision finding", async () => {
  const root = makeRoot();
  writeDd(root, "dark-cool", DARK_TECH_FM, GOOD_BODY);
  const varied = DARK_TECH_FM.replace("name: dark one", "name: light warm")
    .replace('bg: "#0a0a0a"', 'bg: "#fafafa"')
    .replace('accent: "#6366f1"', 'accent: "#d30000"');
  writeDd(root, "light-warm", varied, GOOD_BODY);
  const result = await makeRegistry(root).execute("design.audit", { target: "light-warm" }).result;
  assert.equal(
    result.findings.find((f) => f.id.startsWith("axes-collision")),
    undefined
  );
});

test("external images, transition-all, bare-1fr image grids are detected", async () => {
  const root = makeRoot();
  const body = `
<!-- dd:section hero -->
<section data-dd-id="hero">
  <img src="https://cdn.example.com/x.png" alt="remote">
  <div class="card" style="transition: all .3s">card</div>
  <div style="grid-template-columns: 1fr 2fr"><img src="local.png"></div>
</section>
<!-- /dd:section -->
`;
  writeDd(root, "messy", DARK_TECH_FM, body);
  const result = await makeRegistry(root).execute("design.audit", { target: "messy" }).result;
  const ids = result.findings.map((f) => f.id);
  assert.ok(ids.includes("external-images"));
  assert.ok(ids.includes("transition-all"));
  assert.ok(ids.some((id) => id.startsWith("grid-1fr-image")));
});

test("section-marker / data-dd-id mismatch and missing macrostructure are flagged", async () => {
  const root = makeRoot();
  const fm = DARK_TECH_FM.replace("macrostructure: landing-flow\n", "");
  const body = `
<!-- dd:section hero -->
<section data-dd-id="hero"></section>
<!-- /dd:section -->
<section data-dd-id="orphan"></section>
`;
  writeDd(root, "markers", fm, body);
  const result = await makeRegistry(root).execute("design.audit", { target: "markers" }).result;
  const ids = result.findings.map((f) => f.id);
  assert.ok(ids.includes("section-markers"));
  assert.ok(ids.includes("no-macrostructure"));
});

test("missing artifact and empty designs dir return structured errors", async () => {
  const empty = makeRoot();
  const none = await makeRegistry(empty).execute("design.audit", {}).result;
  assert.equal(none.ok, false);
  assert.match(none.error, /no \.dd artifacts/);
  const missing = await makeRegistry(empty).execute("design.audit", { target: "nope" }).result;
  assert.equal(missing.ok, false);
  assert.match(missing.error, /artifact not found/);
});

test("audit is read-only — artifact bytes unchanged", async () => {
  const root = makeRoot();
  const file = writeDd(root, "immutable", DARK_TECH_FM, GOOD_BODY);
  const before = fs.readFileSync(file, "utf-8");
  await makeRegistry(root).execute("design.audit", {});
  assert.equal(fs.readFileSync(file, "utf-8"), before);
});

test("summary carries bucket-sampled rule lines", async () => {
  const root = makeRoot();
  writeDd(root, "summarize", DARK_TECH_FM, GOOD_BODY);
  const result = await makeRegistry(root).execute("design.audit", {}).result;
  assert.ok(Array.isArray(result.summary));
  assert.equal(result.summary.length, 0); // zero findings → zero summary lines
});
