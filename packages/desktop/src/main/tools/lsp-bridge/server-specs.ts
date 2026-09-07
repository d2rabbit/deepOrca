/**
 * LSP server spec table (P1 language expansion, user ask 2026-09-04): one
 * entry per supported language family — extensions, LSP languageId mapping,
 * and the ordered launch thunks (design §2.3 resolution chain: PATH probe →
 * pinned npm fallback via npx).
 *
 * Every spawn call site sits IN THIS TABLE with a literal command string —
 * that is a deliberate security-posture choice: the bridge never builds a
 * command line from runtime input (file contents travel inside LSP messages,
 * not argv), so there is no command-injection surface at all. Missing
 * servers degrade to the next candidate, then to a soft error carrying the
 * installHint — probe, never auto-install.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

export type LspSpawnOpts = {
  cwd: string;
  env: Record<string, string>;
  stdio: ["pipe", "pipe", "pipe"];
  /** POSIX only: lead a new process group so teardown can kill the whole
   *  tree (-pid). Windows is handled by taskkill /T /F instead. */
  detached?: boolean;
};

export type LspSpawnCandidate = {
  /** Human name for error messages. */
  command: string;
  /** Static launch — literal command, argv from the table. */
  launch: (opts: LspSpawnOpts) => ChildProcess;
};

export type LspServerSpec = {
  /** Pool key + routing identity. */
  id: string;
  extensions: readonly string[];
  /** LSP languageId per extension; first match wins, fallback = defaultLanguageId. */
  languageIdByExt?: Record<string, string>;
  defaultLanguageId: string;
  /** Probed in order (first launch that initializes wins). */
  pathCandidates: readonly LspSpawnCandidate[];
  /** Pinned npm fallback via `npx -y` (only npm-distributed servers). */
  npmFallback?: { pack: string; args: string[] };
  installHint: string;
};

const TYPESCRIPT_PIN = "typescript-language-server@6.0.0";
const PYRIGHT_PIN = "pyright@1.1.413";

/**
 * Resolve a bare command name to an absolute executable inside a PATH
 * directory (root fix, security audit): `spawn(name, { shell: true })` with
 * cwd = the opened workspace let cmd.exe resolve `name` from the CURRENT
 * DIRECTORY first — a malicious repo shipping `npx.cmd` (or `dart.bat`) at
 * its root executed with full user privileges the moment a file opened.
 * An absolute path cannot be shadowed that way; combined with
 * NoDefaultCurrentDirectoryInExePath (lsp-process.ts) both layers of the
 * cwd search are closed. POSIX has no cwd search — returns the bare name.
 */
function resolveShellCommand(bin: string): string {
  if (process.platform !== "win32") return bin;
  const exts = [".cmd", ".exe", ".bat", ""];
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, `${bin}${ext}`);
      try {
        if (statSync(p).isFile()) {
          // Quote for cmd's `/s` strip-quotes rule when the resolved path
          // contains spaces (e.g. "C:\Program Files\nodejs\npx.cmd").
          return p.includes(" ") ? `"${p}"` : p;
        }
      } catch {
        // Not present at this candidate — keep scanning.
      }
    }
  }
  // Refuse the bare-name + shell form: it is exactly the hijack surface.
  throw new Error(`${bin} not found on PATH — refusing a cwd-resolvable bare name`);
}

/** npx resolves to a .cmd shim on Windows — needs the shell form (literal
 *  command + static argv, so still no injection surface; the command is
 *  resolved to an absolute PATH hit first, see resolveShellCommand). */
function npxCandidate(pack: string, args: string[]): LspSpawnCandidate {
  return {
    command: "npx",
    launch: (o) =>
      process.platform === "win32"
        ? spawn(resolveShellCommand("npx"), ["-y", pack, ...args], { ...o, shell: true })
        : spawn("npx", ["-y", pack, ...args], o),
  };
}

export const LSP_SERVER_SPECS: readonly LspServerSpec[] = [
  {
    id: "typescript",
    extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    languageIdByExt: { tsx: "typescriptreact", jsx: "javascriptreact" },
    defaultLanguageId: "typescript",
    pathCandidates: [
      {
        command: "typescript-language-server",
        launch: (o) => spawn("typescript-language-server", ["--stdio"], o),
      },
    ],
    npmFallback: { pack: TYPESCRIPT_PIN, args: ["--stdio"] },
    installHint: "npm i -g typescript-language-server typescript",
  },
  {
    id: "python",
    extensions: ["py", "pyi"],
    defaultLanguageId: "python",
    pathCandidates: [
      {
        command: "pyright-langserver",
        launch: (o) => spawn("pyright-langserver", ["--stdio"], o),
      },
    ],
    npmFallback: { pack: PYRIGHT_PIN, args: ["pyright-langserver", "--stdio"] },
    installHint: "npm i -g pyright",
  },
  {
    id: "rust",
    extensions: ["rs"],
    defaultLanguageId: "rust",
    pathCandidates: [
      {
        command: "rust-analyzer",
        launch: (o) => spawn("rust-analyzer", [], o),
      },
    ],
    installHint: "rustup component add rust-analyzer",
  },
  {
    id: "go",
    extensions: ["go"],
    defaultLanguageId: "go",
    pathCandidates: [
      {
        command: "gopls",
        launch: (o) => spawn("gopls", [], o),
      },
    ],
    installHint: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "cpp",
    extensions: ["c", "h", "cpp", "cxx", "cc", "hpp", "hh", "hxx", "inc"],
    languageIdByExt: { c: "c", h: "c" },
    defaultLanguageId: "cpp",
    pathCandidates: [
      {
        command: "clangd",
        launch: (o) => spawn("clangd", [], o),
      },
    ],
    installHint: "install clangd (LLVM toolchain or the VS C++ workload)",
  },
  {
    id: "csharp",
    extensions: ["cs"],
    defaultLanguageId: "csharp",
    pathCandidates: [
      {
        command: "csharp-ls",
        launch: (o) => spawn("csharp-ls", [], o),
      },
      {
        command: "omnisharp",
        launch: (o) => spawn("omnisharp", ["-lsp"], o),
      },
    ],
    installHint: "dotnet tool install --global csharp-ls (or an OmniSharp distribution)",
  },
  {
    id: "java",
    extensions: ["java"],
    defaultLanguageId: "java",
    pathCandidates: [
      {
        command: "jdtls",
        launch: (o) => spawn("jdtls", [], o),
      },
    ],
    installHint: "install Eclipse JDT Language Server (jdtls)",
  },
  {
    id: "kotlin",
    extensions: ["kt", "kts"],
    defaultLanguageId: "kotlin",
    pathCandidates: [
      {
        command: "kotlin-language-server",
        launch: (o) => spawn("kotlin-language-server", [], o),
      },
    ],
    installHint: "install fwcd/kotlin-language-server on PATH",
  },
  {
    id: "swift",
    extensions: ["swift"],
    defaultLanguageId: "swift",
    pathCandidates: [
      {
        command: "sourcekit-lsp",
        launch: (o) => spawn("sourcekit-lsp", [], o),
      },
    ],
    installHint: "install the Swift toolchain (ships sourcekit-lsp)",
  },
  {
    id: "dart",
    extensions: ["dart"],
    defaultLanguageId: "dart",
    pathCandidates: [
      {
        command: "dart",
        launch: (o) =>
          // `dart` may be a .bat shim on Windows — static command + argv,
          // resolved to an absolute PATH hit first (see resolveShellCommand).
          spawn(resolveShellCommand("dart"), ["language-server"], {
            ...o,
            shell: process.platform === "win32",
          }),
      },
    ],
    installHint: "install the Dart SDK (ships the analysis server)",
  },
];

/** File extension (lowercased, no dot) → spec, or null when unsupported. */
export function resolveSpecForExtension(ext: string): LspServerSpec | null {
  const key = ext.toLowerCase();
  for (const spec of LSP_SERVER_SPECS) {
    if (spec.extensions.includes(key)) return spec;
  }
  return null;
}

export function resolveSpecForFile(filePath: string): LspServerSpec | null {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  return resolveSpecForExtension(ext);
}

/** LSP languageId for a file under its spec (extension-specific override first). */
export function languageIdForFile(spec: LspServerSpec, filePath: string): string {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  return spec.languageIdByExt?.[ext] ?? spec.defaultLanguageId;
}

/** Ordered spawn candidates for a spec: PATH probes → pinned npm fallback. */
export function candidatesForSpec(spec: LspServerSpec): LspSpawnCandidate[] {
  const out = [...spec.pathCandidates];
  if (spec.npmFallback) {
    out.push(npxCandidate(spec.npmFallback.pack, spec.npmFallback.args));
  }
  return out;
}
