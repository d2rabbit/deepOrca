import * as path from "path";

export type McpSpawnSpec = {
  command: string;
  args: string[];
  shell: boolean;
  windowsHide?: boolean;
};

export function createMcpSpawnSpec(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): McpSpawnSpec {
  // An absolute path (e.g. process.execPath, a vendored node binary, or a JS
  // entry resolved via require.resolve) can be spawned directly without a shell.
  // This avoids relying on cmd.exe (via ComSpec), which Electron's environment
  // may not expose correctly — causing `spawn cmd.exe ENOENT`. The shell path
  // below is only needed for bare command names (npx, …) that require PATHEXT
  // resolution.
  //
  // Use the win32 path rules explicitly rather than the host's `path`: this
  // function takes `platform` so callers (and tests) can reason about Windows
  // from any host, but `path.isAbsolute` follows the *running* platform, so on
  // posix hosts it reports `C:\…` as relative and would pick the shell branch.
  // On real Windows the two are identical, so behaviour there is unchanged.
  if (platform === "win32" && !path.win32.isAbsolute(command)) {
    return {
      // On Windows, shell: true lets cmd.exe resolve the command via PATHEXT
      // (npx -> npx.cmd, etc.). Join command and args into a single string
      // with empty spawn args to avoid Node 24 DEP0190.
      // Only quote arguments that need protection from cmd.exe to prevent
      // double-wrapping by Node.js's own shell quoting.
      command: [command, ...args].map(quoteWindowsArgIfNeeded).join(" "),
      args: [],
      shell: true,
      windowsHide: true,
    };
  }

  return {
    command,
    args,
    shell: false,
    // Match the shell branch: a spawned Node process can briefly flash a console
    // window on Windows, so hide it regardless of how the command is resolved.
    windowsHide: true,
  };
}

function quoteWindowsArgIfNeeded(arg: string): string {
  if (/[\s"&|<>^()]/.test(arg)) {
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&")}"`;
  }
  return arg;
}
