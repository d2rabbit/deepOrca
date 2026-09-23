/**
 * 工具结果落盘指针（specs/model-vendor-profiles P1.3 后半）。
 *
 * 问题：bash 截断与 Stage-A 压缩都把超长工具输出**丢弃**——模型再也
 * 拿不回那段内容，只能靠重跑命令（有副作用）或接受信息缺失。本模块把
 * 完整原文落盘为项目内工件（`.deeporca/spill/`），消息里只留摘录 + 指针，
 * 模型用**既有 read 工具**按 path 续读——不新增工具、不新增协议，
 * 读回链路与普通读文件完全同一条。
 *
 * 失败一律 fail-open：落盘失败返回 null，调用方保持既有截断行为。
 */

import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

/** 落盘触发下限（chars）：低于此值丢弃可接受，不值得写盘。 */
export const SPILL_THRESHOLD_CHARS = 16_000;
/** spill 目录保留的最新工件数（写入时惰性清理，超出删最旧）。 */
export const SPILL_KEEP_FILES = 20;

function spillDirOf(projectRoot: string): string {
  return path.join(projectRoot, ".deeporca", "spill");
}

/**
 * 把完整内容写入 `<projectRoot>/.deeporca/spill/<ts>-<tool>-<rand>.txt`，
 * 返回绝对路径；任何失败返回 null（调用方退回无指针的旧行为）。
 * 同步写：调用点（bash 截断 / Stage-A 压缩）都在既有同步路径上，
 * 且大输出本身罕见——不为此引入异步化。
 */
/** 单调序号：同毫秒内多个工件也保持文件名字典序 = 创建序（prune 依赖）。 */
let spillSequence = 0;

export function spillToolOutput(projectRoot: string, tool: string, content: string): string | null {
  if (!projectRoot || content.length < SPILL_THRESHOLD_CHARS) return null;
  try {
    const dir = spillDirOf(projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    const safeTool = tool.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 24) || "tool";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    spillSequence += 1;
    const file = path.join(
      dir,
      `${stamp}-${String(spillSequence).padStart(6, "0")}-${safeTool}-${randomBytes(3).toString("hex")}.txt`
    );
    fs.writeFileSync(file, content, "utf8");
    pruneSpillDir(dir);
    return file;
  } catch {
    return null;
  }
}

/** 惰性清理：只保留最新 SPILL_KEEP_FILES 个工件；失败静默（best-effort）。 */
function pruneSpillDir(dir: string): void {
  try {
    const entries = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".txt"))
      .sort();
    const excess = entries.length - SPILL_KEEP_FILES;
    for (let i = 0; i < excess; i += 1) {
      try {
        fs.unlinkSync(path.join(dir, entries[i]!));
      } catch {
        // 单个删除失败不阻断
      }
    }
  } catch {
    // 目录不可读时跳过清理
  }
}

/**
 * 指针文案：追加到摘录之后，告诉模型完整原文在哪、怎么读。
 * 指针块自成一节，摘录照旧（不改动既有 head/tail 形状）。
 */
export function buildSpillNote(spillPath: string, totalChars: number): string {
  return (
    `\n\n[full output saved to ${spillPath} (${totalChars} chars)] ` +
    `Use the read tool on that path to view any part of it (offset/limit supported).`
  );
}
