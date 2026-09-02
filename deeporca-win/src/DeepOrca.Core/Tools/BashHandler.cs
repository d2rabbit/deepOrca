using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DeepOrca.Core.Common;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Tools;

// BashHandler — shell 命令执行（对拍上游 bash-handler.ts + apple BashHandler.swift）。
// marker 包装：{ init; 关 extglob; cmd; __DEEPORCA_STATUS__=$?; printf marker $PWD; exit $status; } < /dev/null
// Windows：Git Bash + Job Object 每调用包裹（KILL_ON_JOB_CLOSE，无进程组）。

public sealed class BashHandler
{
    public const int MaxOutputChars = 30000;
    public const int MaxCaptureChars = 10 * 1024 * 1024;

    private static readonly Regex TrailingBackgroundOperator = new(@"(^|[^\\&])\s*&\s*$");
    private readonly Dictionary<string, string> _sessionCwds = new();
    private readonly object _gate = new();

    public required string ProjectRoot { get; init; }

    /// <summary>超时下限（对齐上游 clampBashTimeoutMs 的 minTimeoutMs；测试可调小）。</summary>
    public int MinTimeoutMs { get; init; } = ShellUtils.MinBashTimeoutMs;

    /// <summary>沙盒启动规格注入（M7 接入 SandboxLauncher；null → 不包裹）。</summary>
    public Func<(string Executable, string[] Args, Dictionary<string, string>? Env, string Cwd)?>? SandboxWrap { get; init; }

    public string GetSessionCwd(string sessionId)
    {
        lock (_gate)
        {
            return _sessionCwds.GetValueOrDefault(sessionId) ?? ProjectRoot;
        }
    }

    public void ClearSessionCwd(string sessionId)
    {
        lock (_gate) _sessionCwds.Remove(sessionId);
    }

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var rawCommand = context.Arguments["command"] is JsonValue v && v.TryGetValue<string>(out var c) ? c : "";
        var runInBackground = IsTrue(context.Arguments["run_in_background"]);
        var command = runInBackground ? StripTrailingBackgroundOperator(rawCommand) : rawCommand;
        if (string.IsNullOrWhiteSpace(command))
        {
            return ToolExecutionResult.Fail("bash",
                "Missing required \"command\" string.", errorType: "inputParse");
        }

        var startCwd = GetSessionCwd(context.SessionId);
        var (shellPath, shellArgs, marker) = BuildShellCommand(command);

        if (runInBackground)
        {
            return StartBackgroundShell(shellPath, shellArgs, startCwd, command, marker, context);
        }

        var execution = await ExecuteShellAsync(shellPath, shellArgs, startCwd, command, marker, context, ct).ConfigureAwait(false);
        var (stdout, stderr, exitCode, signal, error, timedOut, timeoutMs) = execution;
        var built = BuildToolCommandResult(stdout, stderr, marker, exitCode, signal);
        UpdateSessionCwd(context.SessionId, startCwd, built.Cwd);

        if (error is not null || built.ExitCode != 0 || signal is not null)
        {
            var errorMessage = error ?? (timedOut ? "Command timed out." : signal is not null
                ? $"Command terminated by signal {signal}."
                : built.ExitCode is { } code ? $"Command failed with exit code {code}." : "Command failed.");
            return FormatResult(built, false, errorMessage);
        }

        return FormatResult(built, true, null);
    }

    // ── 命令包装 ──

    public static (string ShellPath, string[] Args, string Marker) BuildShellCommand(string command)
    {
        var shellPath = ShellUtils.ResolveShellPath();
        var marker = $"__DEEPORCA_PWD__{Guid.NewGuid():N}__";
        var init = ShellUtils.BuildShellInitCommand(shellPath);
        var disableExtglob = ShellUtils.BuildDisableExtglobCommand(shellPath);
        var normalized = ShellUtils.RewriteWindowsNullRedirect(command);

        var parts = new List<string>();
        if (init is not null) parts.Add(init);
        if (disableExtglob is not null) parts.Add(disableExtglob);
        parts.Add(normalized);
        parts.Add("__DEEPORCA_STATUS__=$?");
        parts.Add($"printf '%s%s\\n' \"{marker}\" \"$PWD\"");
        parts.Add("exit $__DEEPORCA_STATUS__");
        var wrapped = $"{{ {string.Join("; ", parts)}; }} < /dev/null";
        return (shellPath, ["-c", wrapped], marker);
    }

    // ── 执行 ──

    private async Task<(string Stdout, string Stderr, int? ExitCode, string? Signal, string? Error, bool TimedOut, int TimeoutMs)>
        ExecuteShellAsync(
            string shellPath, string[] shellArgs, string cwd, string command, string marker,
            ToolExecutionContext context, CancellationToken ct)
    {
        var timeoutMs = ShellUtils.ClampBashTimeoutMs(
            TryGetInt(context.Arguments, "timeout") ?? ShellUtils.DefaultBashTimeoutMs,
            minTimeoutMs: MinTimeoutMs);

        var psi = new ProcessStartInfo
        {
            FileName = shellPath,
            WorkingDirectory = cwd,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = false,
        };
        foreach (var arg in shellArgs) psi.ArgumentList.Add(arg);

        // 沙盒注入（M7：受限令牌 / AC / Job；null → 裸跑并为已审计降级）
        var wrapped = SandboxWrap?.Invoke();
        if (wrapped is { } w)
        {
            psi.FileName = w.Executable;
            psi.ArgumentList.Clear();
            foreach (var arg in w.Args) psi.ArgumentList.Add(arg);
            if (w.Env is not null)
            {
                foreach (var (k, v) in w.Env) psi.Environment[k] = v;
            }
            if (!string.IsNullOrEmpty(w.Cwd)) psi.WorkingDirectory = w.Cwd;
        }

        using var process = new Process { StartInfo = psi };
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        string? spawnError = null;
        try
        {
            if (!process.Start()) spawnError = "Process start failed";
        }
        catch (Exception ex)
        {
            spawnError = ex.Message;
        }

        if (spawnError is not null)
        {
            return ("", "", null, null, spawnError, false, timeoutMs);
        }

        // 确定性排空：两个读任务把管道读到 EOF（对拍 apple readDataToEndOfFile；
        // 事件驱动在进程退出瞬间有竞态，且行事件不含换行会拼坏输出）
        var stdoutTask = ReadCappedAsync(process.StandardOutput, stdout, ct);
        var stderrTask = ReadCappedAsync(process.StandardError, stderr, ct);

        // Windows：Job Object 每调用包裹（树杀/CLOSE 兜底）
        using var tree = new ProcessControl.ProcessTreeHandle();
        tree.Assign(process);
        var startTime = Environment.TickCount64;
        var timedOut = false;

        while (!process.HasExited)
        {
            if (Environment.TickCount64 - startTime >= timeoutMs)
            {
                timedOut = true;
                tree.Kill();
                try { process.Kill(entireProcessTree: true); } catch { }
                break;
            }
            await Task.Delay(50, ct).ConfigureAwait(false);
        }

        await process.WaitForExitAsync(ct).ConfigureAwait(false);
        // 排空读任务（树杀后子进程管道关闭；2s 兜底避免理论上悬挂的读）
        var drain = Task.WhenAll(stdoutTask, stderrTask);
        await Task.WhenAny(drain, Task.Delay(2000, CancellationToken.None)).ConfigureAwait(false);

        var exitCode = process.HasExited ? (int?)process.ExitCode : null;
        return (stdout.ToString(), stderr.ToString(), exitCode, null, null, timedOut, timeoutMs);
    }

    private static async Task ReadCappedAsync(StreamReader reader, StringBuilder sink, CancellationToken ct)
    {
        try
        {
            var buffer = new char[8192];
            while (true)
            {
                var read = await reader.ReadAsync(buffer, ct).ConfigureAwait(false);
                if (read == 0) break;
                AppendCapped(sink, new string(buffer, 0, read));
            }
        }
        catch (IOException) { /* 进程被杀后管道关闭属正常 */ }
        catch (OperationCanceledException) { }
    }

    // ── 后台任务 ──

    private ToolExecutionResult StartBackgroundShell(
        string shellPath, string[] shellArgs, string cwd, string command, string marker, ToolExecutionContext context)
    {
        var taskId = $"bash-{Guid.NewGuid():N}";
        var outputDir = Path.Combine(Path.GetTempPath(), "deeporca-background");
        Directory.CreateDirectory(outputDir);
        var outputPath = Path.Combine(outputDir, $"{taskId}.log");
        var startedAt = DateTimeOffset.UtcNow;

        var psi = new ProcessStartInfo
        {
            FileName = shellPath,
            WorkingDirectory = cwd,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = false,
        };
        foreach (var arg in shellArgs) psi.ArgumentList.Add(arg);

        var wrapped = SandboxWrap?.Invoke();
        if (wrapped is { } w)
        {
            psi.FileName = w.Executable;
            psi.ArgumentList.Clear();
            foreach (var arg in w.Args) psi.ArgumentList.Add(arg);
        }

        var process = new Process { StartInfo = psi };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) File.AppendAllText(outputPath, e.Data + "\n"); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) File.AppendAllText(outputPath, e.Data + "\n"); };

        try
        {
            if (!process.Start())
            {
                return ToolExecutionResult.Fail("bash", "Failed to start background process", errorType: "execution");
            }
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Fail("bash", $"Failed to start background process: {ex.Message}", errorType: "execution");
        }

        var pid = process.Id;
        var stopCommand = DeepOrca.Core.Permissions.Runtime.PathIsWindows
            ? $"cmd.exe /c \"taskkill /PID {pid} /T /F\""
            : $"kill -- -{pid}";

        // 后台进程生命周期独立于调用（不 WaitForExit；进程对象由终结器/进程树回收）
        _ = Task.Run(async () =>
        {
            await process.WaitForExitAsync();
            try { process.Dispose(); } catch { }
        });

        var message = $"Command running in background with ID: {taskId}.\n" +
                      $"Stop it with: {stopCommand}\n" +
                      $"Output is being written to: {outputPath}";
        return ToolExecutionResult.OkResult("bash", message, new System.Text.Json.Nodes.JsonObject
        {
            ["backgroundTaskId"] = taskId,
            ["processId"] = pid,
            ["outputPath"] = outputPath,
            ["stopCommand"] = stopCommand,
            ["cwd"] = cwd,
            ["startCwd"] = cwd,
            ["runInBackground"] = true,
            ["startedAtMs"] = startedAt.ToUnixTimeMilliseconds(),
        });
    }

    // ── 结果组装 ──

    private sealed record BuiltResult(string Output, string? Cwd, int? ExitCode, string? Signal, bool Truncated);

    private BuiltResult BuildToolCommandResult(string stdout, string stderr, string marker, int? exitCode, string? signal)
    {
        var (cleanedStdout, cwd) = StripMarker(stdout, marker);
        var combined = JoinOutput(cleanedStdout, stderr);
        var (text, truncated) = TruncateOutput(combined);
        return new BuiltResult(text, cwd, exitCode, signal, truncated);
    }

    private static (string Output, string? Cwd) StripMarker(string stdout, string marker)
    {
        if (string.IsNullOrEmpty(stdout)) return ("", null);
        var lines = stdout.Split('\n');
        int markerIndex = -1;
        for (var i = lines.Length - 1; i >= 0; i--)
        {
            if (lines[i].StartsWith(marker, StringComparison.Ordinal)) { markerIndex = i; break; }
        }
        if (markerIndex == -1) return (stdout, null);

        var markerLine = lines[markerIndex];
        var shellCwd = markerLine[marker.Length..].Trim();
        var cwd = shellCwd.Length > 0 ? ShellUtils.ToNativeCwd(shellCwd) : null;
        var kept = new List<string>(lines);
        kept.RemoveAt(markerIndex);
        return (string.Join("\n", kept), cwd);
    }

    private static string JoinOutput(string stdout, string stderr) =>
        !string.IsNullOrEmpty(stdout) && !string.IsNullOrEmpty(stderr) ? $"{stdout}\n{stderr}"
        : !string.IsNullOrEmpty(stdout) ? stdout
        : stderr;

    private static (string Text, bool Truncated) TruncateOutput(string output) =>
        output.Length <= MaxOutputChars ? (output, false) : (output[..MaxOutputChars], true);

    private ToolExecutionResult FormatResult(BuiltResult built, bool ok, string? errorMessage)
    {
        var metadata = new System.Text.Json.Nodes.JsonObject
        {
            ["exitCode"] = built.ExitCode,
            ["signal"] = built.Signal,
            ["cwd"] = built.Cwd,
            ["truncated"] = built.Truncated,
        };
        if (ok)
        {
            return ToolExecutionResult.OkResult("bash",
                string.IsNullOrEmpty(built.Output) ? "(no output)" : built.Output, metadata);
        }
        return ToolExecutionResult.Fail("bash", errorMessage ?? "Command failed.", metadata: metadata);
    }

    private void UpdateSessionCwd(string sessionId, string fallback, string? cwd)
    {
        lock (_gate)
        {
            _sessionCwds[sessionId] = cwd ?? fallback;
        }
    }

    private static bool IsTrue(System.Text.Json.Nodes.JsonNode? node) =>
        node is System.Text.Json.Nodes.JsonValue v &&
        (v.TryGetValue<bool>(out var b) ? b : v.TryGetValue<string>(out var s) && s == "true");

    private static int? TryGetInt(System.Text.Json.Nodes.JsonObject args, string key)
    {
        if (args[key] is System.Text.Json.Nodes.JsonValue v && v.TryGetValue<int>(out var i)) return i;
        return null;
    }

    private static void AppendCapped(StringBuilder sb, string text)
    {
        if (sb.Length >= MaxCaptureChars) return;
        var remaining = MaxCaptureChars - sb.Length;
        sb.Append(text.Length <= remaining ? text : text[..remaining]);
    }

    private static string StripTrailingBackgroundOperator(string command) =>
        TrailingBackgroundOperator.Replace(command, "$1").TrimEnd();
}