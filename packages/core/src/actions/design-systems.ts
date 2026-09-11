/**
 * 设计系统三源解析（specs/design-md-collection）。
 *
 * designSystemId 现在按优先级解析为三个来源之一：
 *   1. bundled —— core templates/design/systems/<id>.md（既有 9 套，闭合集）；
 *   2. "project" —— 工作区根的 DESIGN.md（Google Stitch 生态约定：AGENTS.md
 *      管怎么建、DESIGN.md 管长什么样；用户可从 VoltAgent/awesome-design-md
 *      收藏集复制任意一份放进项目，或手写）；
 *   3. vendor —— 宿主注入的 vendored 收藏集目录（desktop 构建期由
 *      scripts/vendor-design-md.js 从 VoltAgent/awesome-design-md 落盘到
 *      vendor/design-md/<name>/DESIGN.md，MIT）。
 *
 * vendored 根是宿主注入而非 core 内推导（与 configureCodegraphVendorRoot
 * 同款纪律：只有宿主知道跑在 repo checkout 还是打包应用里）。
 */

import fs from "node:fs";
import path from "node:path";
import { getExtensionRoot } from "../prompt";

/** 工作区 DESIGN.md 的保留 id。 */
export const PROJECT_DESIGN_SYSTEM_ID = "project";

/** bundled 闭合集（templates 内实际存在的全部系统）。 */
export const BUNDLED_DESIGN_SYSTEM_IDS = [
  "brutalist-contrast",
  "dark-tech",
  "editorial",
  "glass-morphism",
  "modern-minimal",
  "soft-neumorphic",
  "swiss-international",
  "terminal-mono",
  "warm-handcrafted",
] as const;

/** 设计系统文档进入生成提示词前的尺寸上限（载荷纪律，与套件文本同规）。 */
const DESIGN_SYSTEM_MAX_CHARS = 200_000;

/** vendored 系统 id 的安全形态（收藏集目录名：小写字母/数字/点/连字符）。 */
const VENDORED_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

let vendorRoot: string | null = null;

/** 宿主注入 vendored 收藏集根（null = 本次运行没有 vendored 系统）。 */
export function configureDesignSystemsVendorRoot(root: string | null): void {
  vendorRoot = root && root.trim() ? path.resolve(root.trim()) : null;
}

export function getDesignSystemsVendorRoot(): string | null {
  return vendorRoot;
}

function readTrimmed(file: string): string | null {
  try {
    const content = fs.readFileSync(file, "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * DESIGN.md 结构校验：≥3 个 `##` 节。宽松下限——实测收藏集 74 份文件全部
 * ≥3 节（linear.app 12 节），但 64 份没有 H1（YAML 元信息直接 `##` 起），
 * 所以不要求 `#` 标题；纯散文/错误文件在解析期拒绝，而不是把垃圾喂给
 * 画布生成。
 */
export function looksLikeDesignSystemDoc(content: string): boolean {
  return (content.match(/^##\s+\S/gm) ?? []).length >= 3;
}

export type DesignSystemSource = "bundled" | "project" | "vendor";

export interface ResolvedDesignSystem {
  content: string;
  source: DesignSystemSource;
}

function readBundled(id: string): ResolvedDesignSystem | null {
  if (!(BUNDLED_DESIGN_SYSTEM_IDS as readonly string[]).includes(id)) return null;
  const root = path.resolve(getExtensionRoot(), "templates", "design", "systems");
  const target = path.resolve(root, `${id}.md`);
  if (!target.startsWith(root + path.sep)) return null;
  const content = readTrimmed(target);
  return content ? { content, source: "bundled" } : null;
}

/** 工作区 DESIGN.md（project id 专用）。缺失/不成形返回 null。 */
export function readProjectDesignSystem(projectRoot: string): ResolvedDesignSystem | null {
  const file = path.resolve(projectRoot, "DESIGN.md");
  const content = readTrimmed(file);
  if (!content || !looksLikeDesignSystemDoc(content)) return null;
  return { content: content.slice(0, DESIGN_SYSTEM_MAX_CHARS), source: "project" };
}

function readVendored(id: string): ResolvedDesignSystem | null {
  if (!vendorRoot || !VENDORED_ID_RE.test(id)) return null;
  const dir = path.resolve(vendorRoot, "design-md", id);
  const target = path.resolve(dir, "DESIGN.md");
  if (!target.startsWith(dir + path.sep)) return null;
  const content = readTrimmed(target);
  return content ? { content: content.slice(0, DESIGN_SYSTEM_MAX_CHARS), source: "vendor" } : null;
}

/**
 * 三源解析。bundled 与 vendored 同名时 bundled 优先（我们的系统是契约
 * 测试的基线）；"project" 读工作区 DESIGN.md。
 */
export function resolveDesignSystem(id: string, projectRoot: string): ResolvedDesignSystem | null {
  if (id === PROJECT_DESIGN_SYSTEM_ID) return readProjectDesignSystem(projectRoot);
  return readBundled(id) ?? readVendored(id);
}

/** 列出当前可用的 vendored 系统 id（目录名；无注入/不可读为空）。 */
export function listVendoredDesignSystems(): string[] {
  if (!vendorRoot) return [];
  const dir = path.resolve(vendorRoot, "design-md");
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && VENDORED_ID_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
