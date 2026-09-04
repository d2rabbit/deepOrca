/**
 * Code-extension classification for tool-result hints (specs/cmb-adoption
 * CMB-3, batch C).
 *
 * The set is manually aligned with the LSP bridge's ten language families in
 * `packages/desktop/src/main/tools/lsp-bridge/server-specs.ts` — duplicated
 * BY DESIGN: core must not depend on desktop (layer rule), and the desktop
 * table carries spawn machinery core has no business importing. When a family
 * is added there, add the extensions here in the same change.
 */

const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  // typescript family
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  // python
  "py",
  "pyi",
  // rust
  "rs",
  // go
  "go",
  // c/c++
  "c",
  "h",
  "cpp",
  "cxx",
  "cc",
  "hpp",
  "hh",
  "hxx",
  "inc",
  // csharp
  "cs",
  // java
  "java",
  // kotlin
  "kt",
  "kts",
  // swift
  "swift",
  // dart
  "dart",
]);

export function isCodeFilePath(filePath: string): boolean {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Append the single-line "check it now" hint to a successful edit/write
 * output — only for code files (a .md tweak has no diagnostics to run).
 * Deliberately does NOT promise a turn-end recheck: the handler layer cannot
 * see whether the diagnostics bridge is even connected (specs/cmb-adoption
 * design §6 decision 3 — never state what you cannot guarantee).
 */
export function appendDiagnosticHint(output: string, filePath: string): string {
  if (!isCodeFilePath(filePath)) return output;
  return `${output}\n（已修改 ${filePath}，建议立即运行诊断检查该文件。）`;
}
