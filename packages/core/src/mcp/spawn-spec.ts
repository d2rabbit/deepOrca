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
  if (platform === "win32" && !path.isAbsolute(command)) {
    return {
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
    windowsHide: true,
  };
}

function quoteWindowsArgIfNeeded(arg: string): string {
  if (/[\s"&|<>^()]/.test(arg)) {
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/g, "$&$&")}"`;
  }
  return arg;
}
