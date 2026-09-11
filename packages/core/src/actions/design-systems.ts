/**
 * 设计系统三源解析（specs/design-md-collection）。
 *
 * designSystemId 现在按优先级解析为三个来源之一：
 *   1. bundled —— core templates/design/systems/<id>.md（既有 9 套，闭合集）；
 *   2. "project" —— 工作区根的 DESIGN.md（Google Stitch 生态约定：AGENTS.md
 *      管怎么建、DESIGN.md 管长什么样；用户可从 VoltAgent/awesome-design-md
 *      收藏集复制任意一份放进项目，或手写）；
 *   3. vendor —— 宿主注入的 vendored 收藏集目录本身（desktop 构建期由
 *      scripts/vendor-design-md.js 从 VoltAgent/awesome-design-md 落盘到
 *      vendor/design-md/<name>/DESIGN.md，MIT；注入的就是 design-md 这层）。
 *
 * vendored 根是宿主注入而非 core 内推导（与 configureDembrandtVendorRoot /
 * configureRoutingModelDir 同款纪律：只有宿主知道跑在 repo checkout 还是打包
 * 应用里）。
 *
 * vendored 的读取纪律集中在本文件一处（readVendoredDesignSystem）：core 解析
 * 与宿主的设计系统目录列表共用它，避免两处各写一套校验而漂移。
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

/**
 * 单次读取的字节上限。UTF-8 单字符最多 4 字节，所以 4× 字符上限必然已经覆盖
 * 到截断点之后的全部内容——截断语义不变，但一份超大 DESIGN.md 不会整体读进
 * main 进程内存（上游内容不可信，读取必须有界）。
 */
const DESIGN_SYSTEM_MAX_READ_BYTES = DESIGN_SYSTEM_MAX_CHARS * 4;

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

/**
 * 目录包含性：解析后的目标必须落在 root 内。id 形态校验（闭合集 / VENDORED_ID_RE）
 * 才是主要闸门，这一道是第二重——若将来 id 的来源放宽（例如直接采信目录名或
 * 渲染层输入），它仍能拦住越界。
 */
function resolveInside(root: string, ...segments: string[]): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  return target.startsWith(resolvedRoot + path.sep) ? target : null;
}

/**
 * 有界读取 + 去空白。`requireRegularFile` 用 lstat（不跟随 symlink）只认常规
 * 文件——上游可以把 DESIGN.md 提交成符号链接，跟随它会读出发动机之外的任意
 * 文件，而内容会进提示词和目录 IPC。
 */
function readDesignSystemFile(file: string, requireRegularFile = false): string | null {
  try {
    const stat = requireRegularFile ? fs.lstatSync(file) : fs.statSync(file);
    if (!stat.isFile()) return null;
    if (stat.size <= DESIGN_SYSTEM_MAX_READ_BYTES) {
      const content = fs.readFileSync(file, "utf8").trim();
      return content || null;
    }
    // 超大文件只读头部：截断点之后的内容用不到，避免整体读入内存。
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.allocUnsafe(DESIGN_SYSTEM_MAX_READ_BYTES);
      const bytes = fs.readSync(fd, buffer, 0, DESIGN_SYSTEM_MAX_READ_BYTES, 0);
      return buffer.subarray(0, bytes).toString("utf8").trim() || null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * DESIGN.md 结构校验：≥3 个 `##` 节。宽松下限——实测收藏集 74 份文件全部
 * ≥3 节（linear.app 12 节），但 64 份没有 H1（YAML 元信息直接 `##` 起），
 * 所以不要求 `#` 标题；纯散文/错误文件在解析期拒绝，而不是把垃圾喂给
 * 画布生成（bundled / project / vendor 三个来源一视同仁）。
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
  const target = resolveInside(root, `${id}.md`);
  if (!target) return null;
  const content = readDesignSystemFile(target);
  return content ? { content: content.slice(0, DESIGN_SYSTEM_MAX_CHARS), source: "bundled" } : null;
}

/**
 * 工作区 DESIGN.md（project id 专用），双路径读取（specs/design-md-collection
 * S5 复刻整合）：根 `DESIGN.md`（Google Stitch 约定/收藏集复制）优先，回退
 * `.deeporca/DESIGN.md`（design.extract 复刻落盘位——代理经 write 工具门控
 * 写入，deep-design 技能 Step 0 的既有读点）。缺失/不成形返回 null。
 *
 * 这里不拒 symlink：项目自己的 DESIGN.md 指到别处是合法的用户选择，
 * 而 vendored 源来自不可信上游，纪律不同（见 readVendoredDesignSystem）。
 */
export function readProjectDesignSystem(projectRoot: string): ResolvedDesignSystem | null {
  const candidates = [path.resolve(projectRoot, "DESIGN.md"), path.resolve(projectRoot, ".deeporca", "DESIGN.md")];
  for (const file of candidates) {
    const content = readDesignSystemFile(file);
    if (content && looksLikeDesignSystemDoc(content)) {
      return { content: content.slice(0, DESIGN_SYSTEM_MAX_CHARS), source: "project" };
    }
  }
  return null;
}

/**
 * 读一份 vendored 系统，走完整纪律：id 形态 → 目录包含性 → 常规文件（拒
 * symlink/目录）→ 结构门 → 尺寸截断。解析不出来一律返回 null（调用方按
 * "不可用"处理，而不是把垃圾喂给画布生成）。宿主的设计系统目录也走这里，
 * 这样"目录里列出的"与"能解析出来的"永远一致。
 */
export function readVendoredDesignSystem(id: string): ResolvedDesignSystem | null {
  if (!vendorRoot || !VENDORED_ID_RE.test(id)) return null;
  const target = resolveInside(vendorRoot, id, "DESIGN.md");
  if (!target) return null;
  const content = readDesignSystemFile(target, true);
  if (!content || !looksLikeDesignSystemDoc(content)) return null;
  return { content: content.slice(0, DESIGN_SYSTEM_MAX_CHARS), source: "vendor" };
}

/**
 * 三源解析。bundled 与 vendored 同名时 bundled 优先（我们的系统是契约
 * 测试的基线）；"project" 读工作区 DESIGN.md。
 */
export function resolveDesignSystem(id: string, projectRoot: string): ResolvedDesignSystem | null {
  if (id === PROJECT_DESIGN_SYSTEM_ID) return readProjectDesignSystem(projectRoot);
  return readBundled(id) ?? readVendoredDesignSystem(id);
}

/**
 * 列出 vendored 的候选系统 id（目录名；无注入/不可读为空）。这是**候选**列表：
 * 只做目录形态过滤，不含逐文件校验——"是否真的可用"以
 * readVendoredDesignSystem 为准，调用方逐条判定。
 */
export function listVendoredDesignSystems(): string[] {
  if (!vendorRoot) return [];
  const dir = vendorRoot;
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
