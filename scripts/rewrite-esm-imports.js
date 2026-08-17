/**
 * Post-build script: rewrites extensionless relative imports in the core
 * package's dist/ output to include explicit ".js" extensions.
 *
 * tsc with moduleResolution:"bundler" emits `from "./foo"` (no extension).
 * Node.js ESM requires `from "./foo.js"`. This script bridges the gap.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
// Allow callers (e.g. package-desktop.js staging a built core into the app
// dir) to target a different dist tree. Defaults to the dev core dist.
const distDir = process.env.DIST_DIR ? resolve(process.env.DIST_DIR) : join(root, "packages", "core", "dist");

const files = globSync("**/*.js", { cwd: distDir, absolute: true });

// Match: from "./anything" or from "../anything"
// Negative lookahead: skip if already ends with .js, .json, .node, or is a bare specifier
const IMPORT_RE = /(from\s+["'])(\.\.?\/[^"']+?)(?<!\.[a-zA-Z0-9]{1,4})(["'])/g;

let totalRewrites = 0;

for (const filePath of files) {
  const original = readFileSync(filePath, "utf8");
  let rewrites = 0;

  const updated = original.replace(IMPORT_RE, (_match, prefix, specifier, quote) => {
    rewrites++;
    // Directory (barrel) imports like "./routing" → "./routing/index.js".
    // tsc emits the extensionless directory path; the dist has <dir>/index.js.
    // Appending ".js" alone yields "./routing.js" which neither Node ESM nor
    // tsx can resolve (the target is a directory, not a file). Detect that and
    // rewrite to the barrel entry instead. File imports keep the ".js" append.
    const resolved = resolve(dirname(filePath), specifier);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      return `${prefix}${specifier}/index.js${quote}`;
    }
    return `${prefix}${specifier}.js${quote}`;
  });

  if (rewrites > 0) {
    writeFileSync(filePath, updated, "utf8");
    totalRewrites += rewrites;
  }
}

console.log(`\n✅  Rewrote ${totalRewrites} imports across ${files.length} files in core/dist/\n`);
