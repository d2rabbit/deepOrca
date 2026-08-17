import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "glob";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Why this auto-derives the build order instead of a hardcoded list:
//
// Each `@deeporca/*` workspace that compiles with `tsc` must build after its
// internal dependencies have emitted declarations — `memory`/`core` both
// `import type` from `@deeporca/embedding`, so if embedding's dist/ doesn't
// exist when they run tsc, the build fails with "Cannot find module
// '@deeporca/embedding'". A hardcoded list broke twice already: when `memory`
// was added (daf3135 changed 1/2 → 1/3) and again when `embedding` was added
// (it was simply forgotten, leaving `npm install`'s `prepare` hook →
// `npm run build` broken on every fresh clone). Deriving the order from each
// package.json's `dependencies` makes adding a package zero-config.
//
// `@deeporca/desktop` is deliberately excluded: it builds via its own esbuild
// pipeline (`desktop:build`) and pulling it in here would also trigger
// vendoring, breaking the existing CI split where `npm run build` only
// produces the tsc outputs.
//
// We glob `packages/*/package.json` (matching clean.js / version.js) rather
// than `npm ls --workspaces --json`: the rest of the scripts already use glob,
// it avoids a subprocess + JSON parse, and the workspace list is just one
// glob pattern.

const pkgPaths = globSync("packages/*/package.json", { cwd: root, absolute: true });

// Collect every workspace's {name, build script, internal deps}.
const all = [];
for (const pkgPath of pkgPaths) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const name = pkg.name;
  const hasBuild = Boolean(pkg.scripts?.build);
  // Only @deeporca/* deps are internal. Match on the key only — the value is
  // "file:../x" and carries no ordering information we need.
  const internalDeps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@deeporca/"));
  all.push({ name, hasBuild, internalDeps });
}

// Workspaces that participate in the tsc build chain: have a build script and
// are not desktop (which has its own esbuild pipeline — see header comment).
const buildChain = all.filter((p) => p.hasBuild && p.name !== "@deeporca/desktop");
const buildNames = new Set(buildChain.map((p) => p.name));

// Kahn's algorithm. Only edges to packages that are themselves in the build
// chain count — a dep on desktop (or an unknown name) doesn't order anything.
const inDegree = new Map();
const dependents = new Map(); // name -> names that depend on it
for (const p of buildChain) {
  inDegree.set(p.name, 0);
  dependents.set(p.name, []);
}
for (const p of buildChain) {
  for (const dep of p.internalDeps) {
    if (buildNames.has(dep)) {
      inDegree.set(p.name, inDegree.get(p.name) + 1);
      dependents.get(dep).push(p.name);
    }
  }
}

// Seed with no-dependency packages, sorted for deterministic output.
const queue = [...buildNames].filter((n) => inDegree.get(n) === 0).sort();
const order = [];
while (queue.length) {
  const n = queue.shift();
  order.push(n);
  for (const dep of dependents.get(n).sort()) {
    inDegree.set(dep, inDegree.get(dep) - 1);
    if (inDegree.get(dep) === 0) queue.push(dep);
  }
}

if (order.length !== buildChain.length) {
  const cyclic = buildChain.filter((p) => inDegree.get(p.name) > 0).map((p) => p.name);
  console.error(`\n❌  Circular @deeporca dependency detected among: ${cyclic.join(", ")}\n`);
  process.exit(1);
}

console.log("=========================================");
console.log("  DeepOrca — Build");
console.log("=========================================");
console.log(`  order: ${order.join(" → ")}\n`);

function run(command, args, label) {
  process.stdout.write(`\n[${label}] ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { stdio: "inherit", cwd: root, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

order.forEach((name, i) => {
  run("npm", ["run", "build", `--workspace=${name}`], `${i + 1}/${order.length}`);
});

run("node", ["scripts/rewrite-esm-imports.js"], `${order.length + 1}/${order.length + 1}`);

console.log("\n✅  Build complete.\n\n");
