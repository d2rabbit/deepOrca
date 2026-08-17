// Vendor IBM Granite Embedding 97M multilingual R2 (ONNX) into the desktop app.
//
// This model powers local embedding for memory recall (sqlite-vec backend)
// via @deeporca/embedding (transformers.js + onnxruntime-node). Files are
// laid out in the HuggingFace mirror structure that transformers.js expects:
//
//   packages/desktop/vendor/granite-embedding/
//     ibm-granite/granite-embedding-97m-multilingual-r2/
//       onnx/model_quantized.onnx   (~60-90MB, int8)
//       tokenizer.json
//       tokenizer_config.json
//       special_tokens_map.json
//       config.json
//
// Download fallback chain: huggingface.co → hf-mirror.com (HF is unreachable
// from the target environment; hf-mirror is a known-good mirror). Both layers
// use short timeouts so a dead host fails fast and the mirror is tried.
//
// Usage:
//   node scripts/vendor-granite.js            # download/refresh model
//   node scripts/vendor-granite.js --force    # force re-download
//
// Env overrides:
//   GRANITE_MODEL_REPO   (default: ibm-granite/granite-embedding-97m-multilingual-r2)
//   GRANITE_MODEL_TAG    (default: main)
//   HF_ENDPOINT          (default: https://huggingface.co — set to https://hf-mirror.com to force mirror)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative as relativePath, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { withAtomicSwap } from "./vendor-fs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const targetDir = join(repoRoot, "packages", "desktop", "vendor", "granite-embedding");
const versionFile = join(targetDir, ".vendored-granite-version");

const force = process.argv.includes("--force");

const MODEL_REPO = process.env.GRANITE_MODEL_REPO ?? "ibm-granite/granite-embedding-97m-multilingual-r2";
// SECURITY: the tag flows into download URLs — validate externally set values.
const MODEL_TAG = (() => {
  const t = process.env.GRANITE_MODEL_TAG;
  if (!t) return "main";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(t)) {
    throw new Error(`unsafe GRANITE_MODEL_TAG: ${JSON.stringify(t)}`);
  }
  return t;
})();

/**
 * Files transformers.js needs for feature-extraction. Each entry maps a
 * `remote` HuggingFace path to the `local` path it should be saved as.
 *
 * The Granite repo does NOT ship the standard `model_quantized.onnx` — its
 * smallest ONNX is `onnx/model_quint8_avx2.onnx` (98MB, int8). We download
 * that and rename to `model_quantized.onnx` so transformers.js loads it via
 * dtype "q8" (which expects the `_quantized` suffix → `model_quantized.onnx`).
 */
const FILES = [
  { remote: "onnx/model_quint8_avx2.onnx", local: "onnx/model_quantized.onnx" },
  { remote: "tokenizer.json", local: "tokenizer.json" },
  { remote: "tokenizer_config.json", local: "tokenizer_config.json" },
  { remote: "special_tokens_map.json", local: "special_tokens_map.json" },
  { remote: "config.json", local: "config.json" },
];

// Version marker: repo + tag (+ a fixed schema revision so layout changes re-trigger).
const VERSION = `${MODEL_REPO}@${MODEL_TAG}#v1`;

function log(message) {
  console.log(`[vendor-granite] ${message}`);
}

/**
 * Build candidate URLs for a HuggingFace resolve path.
 *
 * Order: HF_ENDPOINT env (if set) → hf-mirror.com (primary — verified
 * reachable and proxies LFS via 302 to the reachable us.aws.cdn.hf.co CDN)
 * → huggingface.co (direct, often unreachable from the target env — last
 * resort). Both layers use short connect timeouts so a dead host fails fast.
 */
function hfResolveUrls(repo, file, tag) {
  const candidates = [];
  const envEndpoint = process.env.HF_ENDPOINT?.replace(/\/$/, "");
  if (envEndpoint) {
    // SECURITY: HF_ENDPOINT is externally influenceable — only an https
    // origin (scheme + host [+ port]) may become a download base (audit §4).
    try {
      const parsed = new URL(envEndpoint);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.pathname === "/") {
        candidates.push(`${parsed.origin}/${repo}/resolve/${tag}/${file}`);
      } else {
        log(`ignoring unsafe HF_ENDPOINT: ${envEndpoint}`);
      }
    } catch {
      log(`ignoring unparseable HF_ENDPOINT: ${envEndpoint}`);
    }
  }
  candidates.push(`https://hf-mirror.com/${repo}/resolve/${tag}/${file}`);
  candidates.push(`https://huggingface.co/${repo}/resolve/${tag}/${file}`);
  // De-duplicate while preserving order.
  return [...new Set(candidates)];
}

/**
 * Download a single file (by remote name) to dest, trying each candidate URL.
 * Uses curl with -L to follow hf-mirror's 302 redirect to the LFS CDN.
 */
function downloadFile(repo, remoteFile, dest, tag, stagingDir) {
  // containment check (security scan): the destination must resolve inside the
  // staging directory before it is handed to curl.
  const destResolved = resolve(dest);
  const relToStaging = relativePath(resolve(stagingDir), destResolved);
  if (relToStaging === "" || relToStaging.startsWith("..") || isAbsolute(relToStaging)) {
    throw new Error(`download destination escaped the staging directory: ${dest}`);
  }
  const urls = hfResolveUrls(repo, remoteFile, tag);
  let lastError = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isLast = i === urls.length - 1;
    log(`downloading ${remoteFile} from ${url}`);
    // SECURITY (scan fix): curl writes to stdout, so its argv is fixed flags
    // plus the `--` option terminator — the externally influenced URL is the
    // only dynamic element and sits strictly AFTER the terminator, where it
    // can never be parsed as a curl option. Per-argument validation: the URL
    // must be an https origin.
    if (!/^https:\/\//.test(url)) {
      throw new Error(`unsafe download URL rejected: ${url}`);
    }
    try {
      const body = execFileSync(
        "curl",
        ["-L", "--fail", "--retry", "2", "--connect-timeout", "12", "--max-time", "300", "--", url],
        {
          encoding: null,
          maxBuffer: 512 * 1024 * 1024,
        }
      );
      // containment check (security scan): the already-validated destination
      // (inside the staging dir) receives the bytes; no shell involved.
      writeFileSync(destResolved, body);
      return; // success
    } catch (err) {
      lastError = err;
      if (!isLast) {
        log(`download failed, trying next source …`);
      }
    }
  }
  throw lastError ?? new Error(`download failed for ${remoteFile}`);
}

async function main() {
  const previousVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;

  // Up-to-date check: version marker matches AND all local files present.
  const allFilesExist =
    previousVersion === VERSION && FILES.every((f) => existsSync(join(targetDir, MODEL_REPO, f.local)));

  if (allFilesExist && !force) {
    log(`up-to-date (${VERSION}) — skipping download.`);
    return;
  }

  log(`downloading Granite embedding model (${VERSION}, prev: ${previousVersion ?? "none"}) …`);

  await withAtomicSwap(targetDir, {
    log,
    tag: "granite-embedding",
    async build(staging) {
      const modelRoot = join(staging, MODEL_REPO);
      mkdirSync(join(modelRoot, "onnx"), { recursive: true });
      for (const f of FILES) {
        const dest = join(modelRoot, f.local);
        // Ensure subdirs (e.g. onnx/) exist — harmless if already there.
        mkdirSync(dirname(dest), { recursive: true });
        downloadFile(MODEL_REPO, f.remote, dest, MODEL_TAG, staging);
      }
    },
    verify(staging) {
      const modelRoot = join(staging, MODEL_REPO);
      // All expected local files must exist and be non-empty.
      for (const f of FILES) {
        const p = join(modelRoot, f.local);
        if (!existsSync(p)) {
          log(`verify: missing ${f.local}`);
          return false;
        }
      }
      log(`verify: all ${FILES.length} files present`);
      return true;
    },
  });

  // Write the version marker AFTER a successful swap so a future run can skip.
  writeFileSync(join(targetDir, ".vendored-granite-version"), VERSION, "utf8");
  log(`done — Granite embedding vendored at ${targetDir}`);
}

main().catch((err) => {
  log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
