import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const RMRF = { recursive: true, force: true };

console.log("Cleaning build artifacts...\n");

// Root node_modules
rmSync(join(root, "node_modules"), RMRF);
console.log("  rm node_modules/");

// Per-package node_modules, dist, generated, tsbuildinfo
const packageDirs = globSync("packages/*", { cwd: root, absolute: true });
for (const pkgDir of packageDirs) {
  const short = pkgDir.replace(root + "/", "");

  rmSync(join(pkgDir, "node_modules"), RMRF);
  console.log(`  rm ${short}/node_modules/`);

  rmSync(join(pkgDir, "dist"), RMRF);
  console.log(`  rm ${short}/dist/`);

  rmSync(join(pkgDir, "src", "generated"), RMRF);
  console.log(`  rm ${short}/src/generated/`);

  rmSync(join(pkgDir, "tsconfig.tsbuildinfo"), { force: true });
}

console.log("\n✅  Clean complete.\n\n");
