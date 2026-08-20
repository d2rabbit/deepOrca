#!/usr/bin/env node
/**
 * Deck file-size guard (experiment-plan §1.5): every implementation file
 * under packages/desktop/src/renderer/deck/ must stay ≤ 2000 lines —
 * stylesheets are exempt. The classic App.tsx (1.5k+ lines) is the
 * counter-example this rule exists to prevent. Fails red on violation.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const deckDir = resolve(root, "packages/desktop/src/renderer/deck");
const MAX_LINES = 2000;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if ([".ts", ".tsx"].includes(extname(name))) yield p;
  }
}

if (!existsSync(deckDir)) {
  // Deck not created yet on this branch — nothing to guard.
  process.exit(0);
}

let failed = false;
for (const file of walk(deckDir)) {
  const lines = readFileSync(file, "utf8").split("\n").length;
  if (lines > MAX_LINES) {
    console.error(`[deck-size] ${file} has ${lines} lines (max ${MAX_LINES}) — split it by responsibility.`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("[deck-size] all deck implementation files within 2000 lines.");
