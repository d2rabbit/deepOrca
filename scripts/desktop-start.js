// Dev-only launcher that previews the desktop client as if running on another OS.
//
// Sets DEEPORCA_PLATFORM (honored by the Electron main process only in an
// unpackaged/dev build) and then runs the normal desktop build-and-start flow,
// so you can eyeball each platform's theme (Aqua / Metro / Glass) and its
// interaction adaptation (window controls, theme toggle) on any machine.
//
// Usage: node scripts/desktop-start.js <win|mac|lx>

import { spawn } from "node:child_process";

const PLATFORMS = {
  win: "win32",
  mac: "darwin",
  lx: "linux",
};

const key = process.argv[2];
const platform = PLATFORMS[key];

if (!platform) {
  console.error(`Unknown platform "${key ?? ""}". Use one of: ${Object.keys(PLATFORMS).join(", ")}`);
  process.exit(1);
}

console.log(`[desktop] previewing platform=${platform} (DEEPORCA_PLATFORM)`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["run", "build-and-start", "--workspace", "@deeporca/desktop"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DEEPORCA_PLATFORM: platform },
});

child.on("exit", (code) => process.exit(code ?? 0));
