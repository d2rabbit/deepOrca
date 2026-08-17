import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const RMRF = { recursive: true, force: true };

// Two clean tiers:
//   node scripts/clean.js           → clean:artifacts (dist, generated, tsbuildinfo)
//   node scripts/clean.js --all     → also remove node_modules everywhere
//
// `npm ci` in CI previously ran `npm run clean` (the old script deleted
// node_modules), which then left the lane without a toolchain for the
// subsequent typecheck/build. CI now uses the default (artifacts-only) tier;
// `--all` is the developer "burn it all down" reset. Pass `--all` explicitly
// to opt into the destructive node_modules removal.
const purgeNodeModules = process.argv.includes("--all");

const label = purgeNodeModules ? "all (artifacts + node_modules)" : "artifacts only";
console.log(`Cleaning ${label}...\n`);

if (purgeNodeModules) {
  rmSync(join(root, "node_modules"), RMRF);
  console.log("  rm node_modules/");
}

// Per-package node_modules, dist, generated, tsbuildinfo
const packageDirs = globSync("packages/*", { cwd: root, absolute: true });
for (const pkgDir of packageDirs) {
  const short = pkgDir.replace(root + "/", "");

  if (purgeNodeModules) {
    rmSync(join(pkgDir, "node_modules"), RMRF);
    console.log(`  rm ${short}/node_modules/`);
  }

  rmSync(join(pkgDir, "dist"), RMRF);
  console.log(`  rm ${short}/dist/`);

  rmSync(join(pkgDir, "src", "generated"), RMRF);
  console.log(`  rm ${short}/src/generated/`);

  rmSync(join(pkgDir, "tsconfig.tsbuildinfo"), { force: true });
}

console.log("\n✅  Clean complete.\n\n");
