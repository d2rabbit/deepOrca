using System.Text.Json.Nodes;
using DeepOrca.Core.Types;
using Xunit;

namespace DeepOrca.Core.Tests;

// AnyJson（JsonNode 封装）用例：解析容错 / 深比较 / 序列化往返

public class AnyJsonTests
{
    [Fact]
    public void Parses_valid_and_rejects_malformed()
    {
        var node = AnyJson.Parse("""{"a":1,"b":[true,null,"x"]}""");
        Assert.NotNull(node);
        Assert.Null(AnyJson.Parse("{not-json"));
        Assert.Null(AnyJson.Parse(""));
    }

    [Fact]
    public void Deep_equals_is_order_insensitive_for_objects()
    {
        var a = AnyJson.Parse("""{"x":1,"y":{"z":"v"}}""");
        var b = AnyJson.Parse("""{"y":{"z":"v"},"x":1}""");
        var c = AnyJson.Parse("""{"x":2,"y":{"z":"v"}}""");

        Assert.True(AnyJson.DeepEquals(a, b));
        Assert.False(AnyJson.DeepEquals(a, c));
        Assert.True(AnyJson.DeepEquals(null, null));
        Assert.False(AnyJson.DeepEquals(a, null));
    }

    [Fact]
    public void Write_round_trips_compact_json()
    {
        var node = AnyJson.Parse("""{"k": [1, 2, 3]}""");
        var text = AnyJson.Write(node);
        Assert.Equal("""{"k":[1,2,3]}""", text);
        Assert.Equal("null", AnyJson.Write(null));
    }

    [Fact]
    public void Accessors_extract_typed_values()
    {
        var obj = AnyJson.Parse("""{"s":"v","i":42,"b":true}""") as JsonObject;
        Assert.NotNull(obj);
        Assert.Equal("v", AnyJson.GetString(obj["s"]));
        Assert.Equal(42, AnyJson.GetInt(obj["i"]));
        Assert.True(AnyJson.GetBool(obj["b"]));
        Assert.Null(AnyJson.GetInt(obj["s"]));
    }

    [Fact]
    public void Session_message_survives_jsonl_round_trip()
    {
        var toolCall = ToolCallJson("call_1", "bash");
        var message = SessionMessage.Create("s1", SessionMessageRole.Assistant, null,
            messageParams: new JsonObject { ["tool_calls"] = new JsonArray(toolCall.DeepClone()) });

        var json = CoreJson.Serialize(message);
        var restored = CoreJson.Deserialize<SessionMessage>(json);

        Assert.NotNull(restored);
        Assert.Equal(message.Id, restored.Id);
        Assert.Equal(SessionMessageRole.Assistant, restored.Role);
        var restoredCalls = restored.MessageParams as JsonObject;
        Assert.NotNull(restoredCalls);
        Assert.True(AnyJson.DeepEquals(message.MessageParams, restored.MessageParams));
    }

    private static JsonObject ToolCallJson(string id, string name) => new()
    {
        ["id"] = id,
        ["type"] = "function",
        ["function"] = new JsonObject { ["name"] = name, ["arguments"] = "{}" },
    };
}
