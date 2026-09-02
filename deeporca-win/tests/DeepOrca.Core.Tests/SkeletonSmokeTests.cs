using Xunit;

namespace DeepOrca.Core.Tests;

// M0 骨架探针：验证 sln → 工程 → 测试管道联通（dotnet test 全绿即 M0 出口之一）。
// M1 起替换为真实用例（SSE 解析 / 消息配对 / AnyJson）。
public class SkeletonSmokeTests
{
    [Fact]
    public void Test_pipeline_is_wired()
    {
        Assert.True(true);
    }
}
