/**
 * os-link — cross-shell command dictionary.
 *
 * Problem: agents default to POSIX/Linux commands regardless of the host OS,
 * which breaks the moment a command must run in cmd.exe / PowerShell (user
 * context, spawned subprocesses, Windows-native tooling). os-link maps each
 * semantic operation ("proc.kill-port") to the correct incantation per shell
 * so the LLM can pick the right column instead of guessing.
 *
 * The rendered dictionary is injected into the stable runtime-context prefix
 * (see prompt.ts getStableRuntimeContext) — it is byte-stable per machine and
 * therefore safe for the DeepSeek prefix cache.
 */

export type OsLinkShell = "bash" | "cmd" | "pwsh";

export interface OsLinkEntry {
  /** Semantic id, grouped by prefix: fs / text / env / proc / net / sys / arc / misc. */
  id: string;
  /** One-line description of the operation. */
  title: string;
  /** Per-shell incantation; null = no practical native equivalent. */
  commands: Record<OsLinkShell, string | null>;
  /** Quirks the LLM must know (escaping, aliases, admin rights, version gates). */
  notes?: string;
}

export const OS_LINK_SHELLS: readonly OsLinkShell[] = ["bash", "cmd", "pwsh"];

export const OS_LINK_ENTRIES: readonly OsLinkEntry[] = [
  // ── fs: files & directories ──────────────────────────────────────────────
  {
    id: "fs.list",
    title: "List directory (incl. hidden)",
    commands: { bash: "ls -la", cmd: "dir /a", pwsh: "Get-ChildItem -Force" },
  },
  {
    id: "fs.list-recursive",
    title: "List files recursively",
    commands: { bash: "find . -type f", cmd: "dir /s /b", pwsh: "Get-ChildItem -Recurse -File" },
  },
  {
    id: "fs.pwd",
    title: "Print working directory",
    commands: { bash: "pwd", cmd: "cd", pwsh: "Get-Location" },
    notes: "cmd: bare `cd` prints instead of changing directory.",
  },
  {
    id: "fs.mkdir",
    title: "Create directory (with parents)",
    commands: {
      bash: "mkdir -p path/to/dir",
      cmd: "mkdir path\\to\\dir",
      pwsh: "New-Item -ItemType Directory -Force path",
    },
    notes: "cmd `mkdir` creates parents implicitly. pwsh: mkdir/md are aliases of New-Item.",
  },
  {
    id: "fs.copy",
    title: "Copy file or directory",
    commands: { bash: "cp -r src dst", cmd: "xcopy /E /I src dst", pwsh: "Copy-Item -Recurse src dst" },
    notes: "cmd: plain `copy` only handles files; xcopy for trees.",
  },
  {
    id: "fs.move",
    title: "Move / rename",
    commands: { bash: "mv src dst", cmd: "move src dst", pwsh: "Move-Item src dst" },
  },
  {
    id: "fs.delete-file",
    title: "Delete file",
    commands: { bash: "rm -f file", cmd: "del /f file", pwsh: "Remove-Item -Force file" },
  },
  {
    id: "fs.delete-tree",
    title: "Delete directory tree",
    commands: { bash: "rm -rf dir", cmd: "rmdir /s /q dir", pwsh: "Remove-Item -Recurse -Force dir" },
  },
  {
    id: "fs.touch",
    title: "Create empty file / bump mtime",
    commands: { bash: "touch file", cmd: "type nul > file", pwsh: "New-Item -ItemType File -Force file" },
    notes: "cmd variant truncates; there is no mtime-only touch.",
  },
  {
    id: "fs.find-by-name",
    title: "Find files by name pattern",
    commands: { bash: 'find . -name "*.ts"', cmd: "dir /s /b *.ts", pwsh: "Get-ChildItem -Recurse -Filter *.ts" },
    notes: "Prefer the read tool / ripgrep for workspace searches.",
  },
  {
    id: "fs.which",
    title: "Locate an executable on PATH",
    commands: { bash: "command -v name", cmd: "where name", pwsh: "Get-Command name" },
  },
  {
    id: "fs.realpath",
    title: "Resolve absolute/canonical path",
    commands: { bash: "realpath path", cmd: "for %i in (path) do @echo %~fi", pwsh: "Resolve-Path path" },
    notes: "cmd: use %%i (double percent) inside batch files.",
  },
  {
    id: "fs.symlink",
    title: "Create symbolic link",
    commands: {
      bash: "ln -s target link",
      cmd: "mklink link target",
      pwsh: "New-Item -ItemType SymbolicLink -Target target -Path link",
    },
    notes: "Windows: needs admin or Developer Mode; mklink /D for directories.",
  },
  {
    id: "fs.disk-usage",
    title: "Directory size",
    commands: {
      bash: "du -sh path",
      cmd: null,
      pwsh: "(Get-ChildItem path -Recurse -File | Measure-Object Length -Sum).Sum",
    },
  },
  // ── text: file content ───────────────────────────────────────────────────
  {
    id: "text.cat",
    title: "Print whole file",
    commands: { bash: "cat file", cmd: "type file", pwsh: "Get-Content file" },
    notes: "Prefer the read tool for workspace files.",
  },
  {
    id: "text.head",
    title: "First N lines",
    commands: { bash: "head -n 20 file", cmd: null, pwsh: "Get-Content file -TotalCount 20" },
  },
  {
    id: "text.tail",
    title: "Last N lines",
    commands: { bash: "tail -n 20 file", cmd: null, pwsh: "Get-Content file -Tail 20" },
  },
  {
    id: "text.tail-follow",
    title: "Follow a growing file (logs)",
    commands: { bash: "tail -f file", cmd: null, pwsh: "Get-Content file -Wait" },
  },
  {
    id: "text.grep",
    title: "Search text in files (recursive)",
    commands: {
      bash: 'rg -n "pattern" .',
      cmd: 'findstr /s /n /i "pattern" *',
      pwsh: 'Get-ChildItem -Recurse -File | Select-String -Pattern "pattern"',
    },
    notes: "Prefer ripgrep (rg) when installed; findstr regex support is limited.",
  },
  {
    id: "text.count-lines",
    title: "Count lines",
    commands: { bash: "wc -l file", cmd: 'find /c /v "" file', pwsh: "(Get-Content file).Count" },
  },
  // ── env: environment variables ───────────────────────────────────────────
  {
    id: "env.print",
    title: "Print all environment variables",
    commands: { bash: "env", cmd: "set", pwsh: "Get-ChildItem Env:" },
  },
  {
    id: "env.get",
    title: "Read one variable",
    commands: { bash: "printenv NAME", cmd: "echo %NAME%", pwsh: "$env:NAME" },
    notes: "cmd: %NAME% expands at parse time (delayed expansion issues in loops).",
  },
  {
    id: "env.set-session",
    title: "Set variable for current shell",
    commands: { bash: "export NAME=value", cmd: "set NAME=value", pwsh: '$env:NAME = "value"' },
    notes: "bash tool: shell state does not persist between calls — chain with &&.",
  },
  {
    id: "env.path-prepend",
    title: "Prepend to PATH (current shell)",
    commands: {
      bash: 'export PATH="/x/bin:$PATH"',
      cmd: "set PATH=C:\\x\\bin;%PATH%",
      pwsh: '$env:PATH = "C:\\x\\bin;$env:PATH"',
    },
    notes: "Path separator differs: bash ':', cmd/pwsh ';'.",
  },
  // ── proc: processes & ports ──────────────────────────────────────────────
  {
    id: "proc.list",
    title: "List processes",
    commands: { bash: "ps aux", cmd: "tasklist", pwsh: "Get-Process" },
  },
  {
    id: "proc.kill",
    title: "Kill by PID",
    commands: { bash: "kill -9 1234", cmd: "taskkill /PID 1234 /F", pwsh: "Stop-Process -Id 1234 -Force" },
  },
  {
    id: "proc.kill-by-name",
    title: "Kill by process name",
    commands: { bash: "pkill -f name", cmd: "taskkill /IM name.exe /F", pwsh: "Stop-Process -Name name -Force" },
  },
  {
    id: "proc.port-owner",
    title: "Find process owning a port",
    commands: {
      bash: "lsof -i :8080",
      cmd: "netstat -ano | findstr :8080",
      pwsh: "Get-NetTCPConnection -LocalPort 8080",
    },
    notes: "cmd netstat prints the PID in the last column.",
  },
  {
    id: "proc.kill-port",
    title: "Kill whatever holds a port",
    commands: {
      bash: "kill $(lsof -t -i :8080)",
      cmd: "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :8080') do taskkill /PID %a /F",
      pwsh: "Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force",
    },
    notes: "cmd: pipe inside for-command must be caret-escaped (^|).",
  },
  // ── net: networking ──────────────────────────────────────────────────────
  {
    id: "net.http-get",
    title: "HTTP GET to stdout",
    commands: { bash: "curl -sS url", cmd: "curl -sS url", pwsh: "Invoke-RestMethod url" },
    notes:
      "Windows 10+ ships curl.exe (usable from cmd). In Windows PowerShell 5.1 `curl` is an Invoke-WebRequest alias with different flags — call curl.exe explicitly or use pwsh column.",
  },
  {
    id: "net.download",
    title: "Download file",
    commands: {
      bash: "curl -L -o out.bin url",
      cmd: "curl -L -o out.bin url",
      pwsh: "Invoke-WebRequest -Uri url -OutFile out.bin",
    },
  },
  {
    id: "net.ping",
    title: "Ping a host",
    commands: { bash: "ping -c 4 host", cmd: "ping -n 4 host", pwsh: "Test-Connection -Count 4 host" },
    notes: "count flag differs: -c (POSIX) vs -n (Windows).",
  },
  {
    id: "net.port-check",
    title: "Test TCP connectivity to host:port",
    commands: { bash: "nc -z host 443", cmd: null, pwsh: "Test-NetConnection host -Port 443" },
    notes: "cmd: no native equivalent — route through PowerShell.",
  },
  {
    id: "net.interfaces",
    title: "Show network interfaces / IPs",
    commands: { bash: "ip addr", cmd: "ipconfig /all", pwsh: "Get-NetIPAddress" },
  },
  {
    id: "net.dns",
    title: "Resolve a hostname",
    commands: { bash: "nslookup example.com", cmd: "nslookup example.com", pwsh: "Resolve-DnsName example.com" },
  },
  // ── sys: system information ──────────────────────────────────────────────
  {
    id: "sys.info",
    title: "OS / kernel info",
    commands: { bash: "uname -a", cmd: "systeminfo", pwsh: "Get-ComputerInfo" },
  },
  {
    id: "sys.date",
    title: "Current date/time (ISO)",
    commands: { bash: "date -Iseconds", cmd: "echo %DATE% %TIME%", pwsh: "Get-Date -Format o" },
  },
  {
    id: "sys.whoami",
    title: "Current user",
    commands: { bash: "whoami", cmd: "whoami", pwsh: "whoami" },
  },
  {
    id: "sys.cpu-count",
    title: "Logical CPU count",
    commands: { bash: "nproc", cmd: "echo %NUMBER_OF_PROCESSORS%", pwsh: "$env:NUMBER_OF_PROCESSORS" },
  },
  {
    id: "sys.mem",
    title: "Memory total/free",
    commands: {
      bash: "free -h",
      cmd: 'systeminfo | findstr /C:"Available Physical Memory" /C:"Total Physical Memory"',
      pwsh: "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory",
    },
  },
  {
    id: "sys.disk-free",
    title: "Disk free space",
    commands: { bash: "df -h", cmd: null, pwsh: "Get-Volume" },
    notes: "cmd: `wmic logicaldisk` is deprecated/removed on newer Windows — use pwsh.",
  },
  {
    id: "sys.uptime",
    title: "System uptime",
    commands: {
      bash: "uptime",
      cmd: null,
      pwsh: "(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime",
    },
  },
  // ── arc: archives ────────────────────────────────────────────────────────
  {
    id: "arc.create-tar",
    title: "Create tar.gz archive",
    commands: { bash: "tar -czf out.tgz dir", cmd: "tar -czf out.tgz dir", pwsh: "tar -czf out.tgz dir" },
    notes: "Windows 10+ ships bsdtar as tar.exe (works in cmd/pwsh). For .zip on pwsh: Compress-Archive dir out.zip.",
  },
  {
    id: "arc.extract",
    title: "Extract archive",
    commands: { bash: "tar -xzf in.tgz", cmd: "tar -xzf in.tgz", pwsh: "tar -xzf in.tgz" },
    notes: "For .zip on pwsh: Expand-Archive in.zip dest.",
  },
  // ── misc ─────────────────────────────────────────────────────────────────
  {
    id: "misc.sleep",
    title: "Sleep N seconds",
    commands: { bash: "sleep 5", cmd: "timeout /t 5 /nobreak", pwsh: "Start-Sleep -Seconds 5" },
    notes:
      "cmd `timeout` is interactive-only; fails when stdin is redirected — prefer `ping -n 6 127.0.0.1 >nul` there.",
  },
  {
    id: "misc.open",
    title: "Open file/URL with default app",
    commands: { bash: "open target", cmd: 'start "" target', pwsh: "Invoke-Item target" },
    notes: "bash column is macOS; Linux: xdg-open. cmd: the quoted empty title arg is mandatory.",
  },
  {
    id: "misc.clear",
    title: "Clear terminal",
    commands: { bash: "clear", cmd: "cls", pwsh: "Clear-Host" },
  },
  {
    id: "misc.chain",
    title: "Run A then B only if A succeeded",
    commands: { bash: "a && b", cmd: "a && b", pwsh: "a; if ($?) { b }" },
    notes: "pwsh 7+ also supports && (pipeline chain operators); Windows PowerShell 5.1 does NOT.",
  },
];

const OS_LINK_INDEX: ReadonlyMap<string, OsLinkEntry> = new Map(OS_LINK_ENTRIES.map((entry) => [entry.id, entry]));

export function getOsLinkEntry(id: string): OsLinkEntry | undefined {
  return OS_LINK_INDEX.get(id);
}

export function listOsLinkEntries(): readonly OsLinkEntry[] {
  return OS_LINK_ENTRIES;
}

/**
 * Render the dictionary as a compact markdown table for the system prompt.
 * `currentShell` marks the column the bash tool actually executes with, so the
 * model defaults to the right column and only reaches for cmd/pwsh when the
 * target shell really is one of those.
 */
export function renderOsLinkDictionary(currentShell: OsLinkShell = "bash"): string {
  const column = (shell: OsLinkShell) => (shell === currentShell ? `${shell} (current)` : shell);
  const lines: string[] = [
    `| operation | ${column("bash")} | ${column("cmd")} | ${column("pwsh")} |`,
    "| --- | --- | --- | --- |",
  ];
  for (const entry of OS_LINK_ENTRIES) {
    const cells = OS_LINK_SHELLS.map((shell) => {
      const command = entry.commands[shell];
      return command === null ? "—" : `\`${command.replace(/\|/g, "\\|")}\``;
    });
    const notes = entry.notes ? ` — ${entry.notes}` : "";
    lines.push(`| ${entry.id} ${entry.title}${notes} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

/**
 * The prompt-ready section: usage rules + the full dictionary table. Rendered
 * once into the stable runtime-context prefix; content depends only on
 * `currentShell`, so it stays byte-stable per machine (prefix-cache safe).
 */
export function renderOsLinkPromptSection(currentShell: OsLinkShell = "bash"): string {
  return `# OS Command Dictionary (os-link)

Cross-shell command lookup. Rules:
- The bash tool ALWAYS executes through bash (on Windows: Git Bash) — default to the bash column. Never emit cmd.exe or PowerShell syntax into a bash tool call.
- Use the cmd/pwsh columns only when the command itself must run in that shell (e.g. the user asked for it, or you are explicitly spawning cmd.exe / pwsh / powershell as a subprocess).
- "—" means no practical native equivalent; route through one of the other shells instead.
- Windows/Git-Bash paths are POSIX-style (/c/Users/...); bare drive paths (C:\\...) belong to the cmd/pwsh columns.

${renderOsLinkDictionary(currentShell)}`;
}
