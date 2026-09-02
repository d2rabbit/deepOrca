#!/usr/bin/env node
// check-core-boundaries.mjs — DeepOrca.Core UI-free 红线守护（M1.0，design §四）。
// 规则：Core 源码不得引用 WinUI / WebView2 / WindowsAppSDK / 任何 GUI 框架；
// 不得直接 Console.*（logger 由宿主注入）。命中即非零退出。
// 用法：node tools/check-core-boundaries.mjs [core-src-dir]（默认 src/DeepOrca.Core）

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const coreDir = resolve(process.cwd(), process.argv[2] ?? "src/DeepOrca.Core");

const forbidden = [
  { pattern: /\bMicrosoft\.UI\b/, label: "WinUI (Microsoft.UI)" },
  { pattern: /\bMicrosoft\.WindowsAppSDK\b/, label: "WindowsAppSDK" },
  { pattern: /\bMicrosoft\.Web\.WebView2\b/, label: "WebView2" },
  { pattern: /\bMicrosoft\.Maui\b/, label: "MAUI" },
  { pattern: /\bAvalonia\b/, label: "Avalonia" },
  { pattern: /\bWindows\.UI\.Xaml\b/, label: "UWP XAML" },
  { pattern: /\bConsole\.(Write|WriteLine|Error|Out)\b/, label: "Console.*（logger 由宿主注入）" },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "obj" || entry.name === "bin") continue;
      yield* walk(full);
    } else if (entry.name.endsWith(".cs") || entry.name.endsWith(".csproj")) {
      yield full;
    }
  }
}

let violations = 0;
for (const file of walk(coreDir)) {
  const text = readFileSync(file, "utf8");
  for (const { pattern, label } of forbidden) {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        console.error(`[core-boundary] ${file}:${i + 1} 违反红线 ${label}: ${line.trim()}`);
        violations++;
      }
    });
  }
}

if (violations > 0) {
  console.error(`[core-boundary] Core UI-free 红线检查失败：${violations} 处违规`);
  process.exit(1);
}
console.log(`[core-boundary] OK — ${coreDir} 无 UI 依赖、无 Console.* 直调`);
