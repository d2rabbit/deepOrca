// DeepOrca.Cli — chat / parallel / tokens / version（对齐 apple 分支验证手段）。
// M0 骨架探针：仅 version 可用；chat/parallel/tokens 自 M4 起逐命令实装。
if (args.Length == 0 || args[0] == "version")
{
    Console.WriteLine("deeporcacli 0.1.0-skeleton (net10.0, win-native)");
    return 0;
}

Console.WriteLine("用法：deeporcacli [chat | parallel | tokens | version]（chat/parallel/tokens 自 M4 实装）");
return 1;
