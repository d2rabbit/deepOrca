using System.Text.Json.Nodes;
using DeepOrca.Core.Types;

namespace DeepOrca.Core.Tools;

// 小工具处理器：AskUserQuestion / UpdatePlan / WebSearch / WebFetch 占位（对拍 apple 直译）。
// WebSearch/WebFetch 的 provider 在 M7 实装（design §六.4；本层只做通道与错误语义）。

public sealed record AskOption(string Label, string? Value = null, string? Description = null);

/// <summary>宿主注入的提问展示器（UI/CLI 各自实现）；null → 默认答案（headless）。</summary>
public sealed class AskUserQuestionHandler
{
    public Func<IReadOnlyList<AskOption>, Task<string?>>? Presenter { get; init; }
    public string DefaultAnswer { get; init; } = "User did not answer";

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var question = AnyJson.GetString(context.Arguments["question"]) ?? "Please answer a question";
        var options = new List<AskOption>();
        if (context.Arguments["options"] is JsonArray rawOptions)
        {
            foreach (var raw in rawOptions)
            {
                if (raw is not JsonObject obj) continue;
                options.Add(new AskOption(
                    AnyJson.GetString(obj["label"]) ?? "",
                    AnyJson.GetString(obj["value"]),
                    AnyJson.GetString(obj["description"])));
            }
        }

        var answer = Presenter is null
            ? DefaultAnswer
            : await Presenter(options.Count > 0
                  ? options
                  : [new AskOption("Yes", "yes"), new AskOption("No", "no")]).ConfigureAwait(false)
              ?? DefaultAnswer;

        return ToolExecutionResult.OkResult("ask_user_question", answer, new JsonObject
        {
            ["question"] = question,
            ["awaitUserResponse"] = true,
        });
    }
}

public enum PlanNodeStatus
{
    Pending,
    InProgress,
    Completed,
    Blocked,
    Cancelled,
}

public sealed record PlanTreeNode
{
    public string Id { get; init; } = Guid.NewGuid().ToString();
    public required string Title { get; init; }
    public PlanNodeStatus Status { get; init; } = PlanNodeStatus.Pending;
    public List<PlanTreeNode> Children { get; init; } = [];
}

/// <summary>宿主回调承接计划树更新（UI 树刷新；M6 任务树接入后扩充）。</summary>
public sealed class UpdatePlanHandler
{
    public Func<PlanTreeNode, Task>? OnUpdate { get; init; }

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var rawPlan = context.Arguments["plan"] as JsonObject;
        var mode = AnyJson.GetString(context.Arguments["mode"]) ?? "update";

        var node = new PlanTreeNode
        {
            Title = rawPlan is null ? "Plan" : AnyJson.GetString(rawPlan["title"]) ?? "Plan",
            Status = ParseStatus(rawPlan?["status"]),
            Children = ParseChildren(rawPlan?["children"] as JsonArray ?? new JsonArray()),
        };

        if (OnUpdate is not null) await OnUpdate(node).ConfigureAwait(false);

        return ToolExecutionResult.OkResult("update_plan", $"Plan updated ({mode})",
            new JsonObject { ["mode"] = mode });
    }

    private static List<PlanTreeNode> ParseChildren(JsonArray raw) => raw.OfType<JsonObject>().Select(child =>
        new PlanTreeNode
        {
            Title = AnyJson.GetString(child["title"]) ?? "",
            Status = ParseStatus(child["status"]),
            Children = ParseChildren(child["children"] as JsonArray ?? new JsonArray()),
        }).ToList();

    private static PlanNodeStatus ParseStatus(JsonNode? node) => AnyJson.GetString(node) switch
    {
        "in_progress" => PlanNodeStatus.InProgress,
        "completed" => PlanNodeStatus.Completed,
        "blocked" => PlanNodeStatus.Blocked,
        "cancelled" => PlanNodeStatus.Cancelled,
        _ => PlanNodeStatus.Pending,
    };
}

/// <summary>Web 搜索通道（provider 由宿主注入；M7 提供 DDG Lite 默认实现）。</summary>
public sealed class WebSearchHandler
{
    public Func<string, Task<string>>? SearchProvider { get; init; }

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var query = AnyJson.GetString(context.Arguments["query"]);
        if (query is null)
        {
            return ToolExecutionResult.Fail("web_search", "Missing 'query' argument", errorType: "inputParse");
        }
        if (SearchProvider is null)
        {
            return ToolExecutionResult.Fail("web_search",
                "Web search provider is not configured (lands in M7).", errorType: "network");
        }
        try
        {
            var results = await SearchProvider(query).ConfigureAwait(false);
            return ToolExecutionResult.OkResult("web_search", results,
                new JsonObject { ["query"] = query });
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Fail("web_search", $"Search failed: {ex.Message}",
                errorType: "network", metadata: new JsonObject { ["query"] = query });
        }
    }
}

/// <summary>网页抓取通道（静态/渲染双 provider 由宿主注入；M7/M9 实装）。</summary>
public sealed class WebFetchHandler
{
    public Func<string, Task<string>>? FetchProvider { get; init; }

    public async Task<ToolExecutionResult> Handle(ToolExecutionContext context, CancellationToken ct = default)
    {
        var urlString = AnyJson.GetString(context.Arguments["url"]);
        if (urlString is null)
        {
            return ToolExecutionResult.Fail("web_fetch", "Missing 'url' argument", errorType: "inputParse");
        }
        if (!Uri.TryCreate(urlString, UriKind.Absolute, out var url) || url.Scheme is not ("http" or "https"))
        {
            return ToolExecutionResult.Fail("web_fetch", $"Invalid URL: {urlString}", errorType: "inputParse");
        }
        if (FetchProvider is null)
        {
            return ToolExecutionResult.Fail("web_fetch",
                "Web fetch provider is not configured (static in M7, render in M9).", errorType: "network");
        }
        try
        {
            var content = await FetchProvider(urlString).ConfigureAwait(false);
            return ToolExecutionResult.OkResult("web_fetch", content,
                new JsonObject { ["url"] = url.AbsoluteUri });
        }
        catch (Exception ex)
        {
            return ToolExecutionResult.Fail("web_fetch", $"Fetch failed: {ex.Message}",
                errorType: "network", metadata: new JsonObject { ["url"] = url.AbsoluteUri });
        }
    }
}