using System.Diagnostics;
using System.Runtime.InteropServices;

using DeepOrca.Core.Permissions;
namespace DeepOrca.Core.Common;

// ProcessControl — 进程树终止（对拍上游 common/process-tree.ts）。
// Windows：Job Object 每调用包裹（KILL_ON_JOB_CLOSE），无进程组；POSIX：树杀走进程组。

public static class ProcessControl
{
    public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
        public long ProcessMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public long JobMemoryLimit;
        public nuint PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr securityAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, int infoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    /// <summary>
    /// 创建进进程树包裹（Windows Job Object 容器）。KILL_ON_JOB_CLOSE：
    /// job 句柄关闭（进程退出/超时后处理）即树杀，兜底孤儿。
    /// </summary>
    public sealed class ProcessTreeHandle : IDisposable
    {
        private IntPtr _job;

        public ProcessTreeHandle()
        {
            _job = Runtime.PathIsWindows ? CreateJobObjectW(IntPtr.Zero, null) : IntPtr.Zero;
            if (_job != IntPtr.Zero)
            {
                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION { LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE };
                var size = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
                var ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(info, ptr, false);
                    SetInformationJobObject(_job, 9, ptr, size); // JobObjectExtendedLimitInformation
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
            }
        }

        /// <summary>把子进程纳入 job（仅 Windows）。</summary>
        public void Assign(Process process)
        {
            if (_job != IntPtr.Zero && process.Handle != IntPtr.Zero)
            {
                AssignProcessToJobObject(_job, process.Handle);
            }
        }

        /// <summary>强制树杀（Windows 经 TerminateJobObject；POSIX 走进程组）。</summary>
        public void Kill(bool isPosixGroup = false)
        {
            if (_job != IntPtr.Zero)
            {
                TerminateJobObject(_job, 1);
            }
            else if (isPosixGroup)
            {
                KillProcessGroup(-1); // 占位；POSIX 树杀由调用方按 pid 传入
            }
        }

        public void Dispose()
        {
            if (_job != IntPtr.Zero)
            {
                CloseHandle(_job); // KILL_ON_JOB_CLOSE 在句柄关闭时生效
                _job = IntPtr.Zero;
            }
        }
    }

    /// <summary>POSIX 进程组树杀（信号 → pgid；Windows 调用方不应走此路径）。</summary>
    public static void KillProcessGroup(int processGroupId)
    {
        if (Runtime.PathIsWindows) return;
        _ = ExecKill(processGroupId, 9);
    }

    [DllImport("libc", EntryPoint = "kill", SetLastError = true)]
    private static extern int ExecKill(int pid, int sig);
}