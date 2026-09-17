// Vendor the models.dev model catalog snapshot (specs/model-fleet-adaptation
// §七 X3.1) into the desktop app.
//
//   packages/desktop/vendor/models-dev/
//     api.json                      (~4.7MB — 220 providers / ~7.8k models)
//     .vendored-models-dev.json     marker: fetchedAt + sha256 + counts
//
// Data: MIT (anomalyco/models.dev). Refresh policy: when the marker is older
// than the TTL (7 days by default) or missing; --force always re-fetches. A
// failed refresh keeps the existing snapshot (fail-open at runtime — core's
// model-catalog degrades to null and behavior equals today's).
//
// Usage:
//   node scripts/vendor-models-dev.js            # refresh when stale
//   node scripts/vendor-models-dev.js --force    # force re-download
//
// Env:
//   MODELS_DEV_URL       (default: https://models.dev/api.json)
//   MODELS_DEV_TTL_DAYS  (default: 7)

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL as fileUrl } from "node:url";

import { withAtomicSwap } from "./vendor-fs.js";
import { assertPublicHttpsUrl } from "./vendor-download.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "models-dev");
const markerFile = join(targetDir, ".vendored-models-dev.json");

const force = process.argv.includes("--force");
const URL_ = process.env.MODELS_DEV_URL ?? "https://models.dev/api.json";
const TTL_DAYS = Number(process.env.MODELS_DEV_TTL_DAYS ?? 7);

// Sanity floors: a proxied error page or a truncated body would parse to far
// fewer entries — refuse to vendor anything below the known catalog scale.
const MIN_PROVIDERS = 50;
const MIN_MODELS = 1000;

function log(message) {
  console.log(`[vendor-models-dev] ${message}`);
}

function markerAgeDays() {
  if (!existsSync(markerFile)) return null;
  try {
    const marker = JSON.parse(readFileSync(markerFile, "utf8"));
    if (!marker.fetchedAt) return null;
    const ageMs = Date.now() - Date.parse(marker.fetchedAt);
    return Number.isFinite(ageMs) ? ageMs / 86_400_000 : null;
  } catch {
    return null;
  }
}

async function fetchSnapshot() {
  assertPublicHttpsUrl(URL_, "MODELS_DEV_URL");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Manual redirect loop: every hop re-validates the public-https rule, so
    // a compromised/shortener URL cannot bounce the fetch at a private host
    // (same redirect-pinning rationale as vendor-download.js).
    let url = URL_;
    let response;
    for (let hop = 0; hop < 5; hop += 1) {
      response = await fetch(url, { signal: controller.signal, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        response.body?.cancel();
        if (!location) {
          throw new Error(`redirect without location at ${url}`);
        }
        url = new fileUrl(location, url).toString();
        assertPublicHttpsUrl(url, "redirect location");
        continue;
      }
      break;
    }
    if (!response) {
      throw new Error("unreachable: redirect loop produced no response");
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${URL_}`);
    }
    const text = await response.text();
    const parsed = JSON.parse(text);
    const providers = Object.keys(parsed ?? {}).length;
    let models = 0;
    for (const provider of Object.values(parsed ?? {})) {
      const m = provider?.models;
      if (m && typeof m === "object" && !Array.isArray(m)) models += Object.keys(m).length;
    }
    if (providers < MIN_PROVIDERS || models < MIN_MODELS) {
      throw new Error(`snapshot below sanity floor (${providers} providers / ${models} models) — refusing to vendor`);
    }
    return { text, sha256: createHash("sha256").update(text).digest("hex"), providers, models };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const age = markerAgeDays();
  if (!force && age !== null && age < TTL_DAYS && existsSync(join(targetDir, "api.json"))) {
    log(`up-to-date (fetched ${age.toFixed(1)}d ago, TTL ${TTL_DAYS}d) — skipping.`);
    return;
  }
  log(`fetching ${URL_} (prev: ${age === null ? "none" : `${age.toFixed(1)}d old`}) …`);
  const snapshot = await fetchSnapshot();

  await withAtomicSwap(targetDir, {
    log,
    tag: "models-dev",
    async build(staging) {
      writeFileSync(join(staging, "api.json"), snapshot.text, "utf8");
      writeFileSync(
        join(staging, ".vendored-models-dev.json"),
        `${JSON.stringify(
          {
            url: URL_,
            fetchedAt: new Date().toISOString(),
            sha256: snapshot.sha256,
            providers: snapshot.providers,
            models: snapshot.models,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    },
  });
  log(
    `vendored ${snapshot.providers} providers / ${snapshot.models} models (sha256 ${snapshot.sha256.slice(0, 12)}…).`
  );
}

main().catch((error) => {
  console.error(`[vendor-models-dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
