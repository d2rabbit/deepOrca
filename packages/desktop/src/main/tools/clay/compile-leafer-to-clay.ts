/**
 * compile-leafer-to-clay — clay-ui-runtime WP2 确定性编译器（纯 TS，零运行时依赖）。
 *
 * 输入：Leafer 场景 JSON（LEAFER_CREATE_CONTRACT 形状：{tag:"Leafer",width,height,fill,children}，
 * 图元 Rect/Ellipse/Text/Image/Path/Line/Group/Box/Frame，绝对 x/y + width/height，
 * 容器可用 flow/gap/padding/flowAlign）。
 * 输出：Clay 树 IR（preview.html 的 bind 协议消费）+ 跳过/降级计数。
 *
 * 确定性纪律（M3E #2，对齐 describeLeaferDocument）：固定遍历序（children 数组序）、
 * 输出键按固定顺序构造（与输入键序无关）、数值 round2——同输入字节级同输出。
 *
 * 断行职责（WP0 结论）：CJK 文本由 preview.html 的 GLUE（clay-preview-html.ts 的
 * wrapCJK，浏览器侧 canvas 度量）逐字符预断行——本编译器只搬运文本节点；
 * Clay 分词只认 ' ' 与 '\n'，未预断行的 CJK 文本会整段溢出。
 */

export interface ClayTreeNode {
  kind: "box" | "text";
  name?: string;
  /** x/y 存在 ⇒ 绝对定位（Clay floating，相对父容器偏移）。 */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** [r,g,b,a]，a ∈ 0..255。 */
  background?: [number, number, number, number];
  radius?: number;
  border?: { color: [number, number, number, number]; width: number };
  layout?: { direction: "x" | "y"; gap: number; padding?: [number, number, number, number] };
  text?: string;
  fontSize?: number;
  lineHeight?: number;
  color?: [number, number, number, number];
  children?: ClayTreeNode[];
}

export interface ClayCompileStats {
  /** 跳过的图元标签与名字（横幅逐条展示）。 */
  skipped: string[];
  /** 近似降级的元素数（渐变取首色、阴影忽略、透明度并入 alpha 等）。 */
  degraded: number;
  /** 编译产出的节点数。 */
  nodes: number;
}

export interface ClayCompileResult {
  tree: ClayTreeNode | null;
  stats: ClayCompileStats;
}

type Dict = Record<string, unknown>;

const SKIP_TAGS = new Set(["Image", "Path", "Line"]);
const round2 = (n: number): number => Math.round(n * 100) / 100;

function isDict(v: unknown): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function hexDigit(d: string): number {
  const code = d.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

/** "#rgb" / "#rrggbb" / "#rrggbbaa" → [r,g,b,a]；不匹配返回 null。 */
function parseHexColor(hex: string): [number, number, number, number] | null {
  if (!hex.startsWith("#")) return null;
  const body = hex.slice(1);
  if (body.length === 3) {
    const r = hexDigit(body[0]);
    const g = hexDigit(body[1]);
    const b = hexDigit(body[2]);
    if (r < 0 || g < 0 || b < 0) return null;
    return [r * 17, g * 17, b * 17, 255];
  }
  if (body.length !== 6 && body.length !== 8) return null;
  const pair = (i: number): number => hexDigit(body[i]) * 16 + hexDigit(body[i + 1]);
  const r = pair(0);
  const g = pair(2);
  const b = pair(4);
  if ([r, g, b].some((n) => n < 0)) return null;
  const a = body.length === 8 ? pair(6) : 255;
  if ([r, g, b, a].some((n) => n < 0)) return null;
  return [r, g, b, a];
}

/** fill：'#rrggbb' 纯色直译；gradient 取首 stop（降级计数）；其余 → null。 */
function parseFill(fill: unknown, stats: ClayCompileStats): [number, number, number, number] | null {
  if (typeof fill === "string") return parseHexColor(fill);
  if (isDict(fill)) {
    const stops = fill.stops;
    if (Array.isArray(stops) && stops.length > 0) {
      stats.degraded += 1; // 渐变 → 首 stop 纯色近似
      const first = stops[0];
      if (isDict(first) && typeof first.color === "string") return parseHexColor(first.color);
    }
  }
  return null;
}

function parsePadding(padding: unknown): [number, number, number, number] | undefined {
  if (typeof padding === "number" && Number.isFinite(padding)) return [padding, padding, padding, padding];
  if (Array.isArray(padding)) {
    const nums = padding.filter(isNum);
    if (nums.length === 4) return [nums[0], nums[1], nums[2], nums[3]];
    if (nums.length === 2) return [nums[1], nums[1], nums[0], nums[0]];
  }
  return undefined;
}

export function compileLeaferToClayTree(doc: unknown): ClayCompileResult {
  const stats: ClayCompileStats = { skipped: [], degraded: 0, nodes: 0 };
  if (!isDict(doc) || doc.tag !== "Leafer") {
    return { tree: null, stats: { ...stats, skipped: ["root"] } };
  }
  const width = isNum(doc.width) ? round2(doc.width) : undefined;
  const height = isNum(doc.height) ? round2(doc.height) : undefined;
  const rootFill = parseFill(doc.fill, stats);
  const children: ClayTreeNode[] = [];
  if (Array.isArray(doc.children)) {
    for (const child of doc.children) {
      const node = walkNode(child, stats);
      if (node) children.push(node);
    }
  }
  const tree: ClayTreeNode = {
    kind: "box",
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(rootFill ? { background: rootFill } : {}),
    children,
  };
  // 节点数按全树统计（合成根除外）——banner 与 manifest 的「节点数」必须
  // 反映真实编译产物规模，根层计数会把深层嵌套文档低报一个量级。
  stats.nodes = children.reduce((sum, child) => sum + countTreeNodes(child), 0);
  return { tree, stats };
}

function countTreeNodes(node: ClayTreeNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countTreeNodes(child), 0);
}

function walkNode(value: unknown, stats: ClayCompileStats): ClayTreeNode | null {
  if (!isDict(value)) {
    stats.degraded += 1;
    return null;
  }
  const tag = typeof value.tag === "string" ? value.tag : "";
  if (SKIP_TAGS.has(tag)) {
    stats.skipped.push(`${tag} · ${typeof value.name === "string" ? value.name : "(未命名)"}`);
    return null;
  }
  if (tag === "Text") return walkTextNode(value, stats);

  // 容器（Rect/Box/Frame/Group/Ellipse 近似）——box 图元。
  if (tag === "Ellipse") stats.degraded += 1; // 圆角矩形近似
  const node: ClayTreeNode = { kind: "box" };
  if (typeof value.name === "string" && value.name) node.name = value.name;

  const x = value.x;
  const y = value.y;
  if (isNum(x) && isNum(y)) {
    node.x = round2(x);
    node.y = round2(y);
  }
  if (isNum(value.width)) node.width = round2(value.width);
  if (isNum(value.height)) node.height = round2(value.height);

  const background = parseFill(value.fill, stats);
  if (background) node.background = background;

  const radius = value.cornerRadius;
  if (typeof radius === "number" && Number.isFinite(radius) && radius > 0) node.radius = round2(radius);
  if (tag === "Ellipse" && node.radius === undefined && isNum(value.width) && isNum(value.height)) {
    node.radius = round2(Math.min(value.width, value.height) / 2);
  }

  const stroke = value.stroke;
  if (stroke) {
    const color = parseFill(stroke, stats);
    if (color) {
      const strokeWidth = isNum(value.strokeWidth) ? Math.max(1, Math.round(value.strokeWidth)) : 1;
      node.border = { color, width: strokeWidth };
    }
  }

  const flow = value.flow;
  if (flow === "x" || flow === "y") {
    const padding = parsePadding(value.padding);
    node.layout = {
      direction: flow,
      gap: isNum(value.gap) ? round2(value.gap) : 0,
      ...(padding ? { padding } : {}),
    };
  }

  if (Array.isArray(value.children)) {
    const children: ClayTreeNode[] = [];
    for (const child of value.children) {
      const walked = walkNode(child, stats);
      if (walked) children.push(walked);
    }
    if (children.length > 0) node.children = children;
  }
  return node;
}

function walkTextNode(value: Dict, stats: ClayCompileStats): ClayTreeNode | null {
  const text = typeof value.text === "string" ? value.text : "";
  if (!text) {
    stats.degraded += 1; // 空文本（契约禁止，防御）
    return null;
  }
  const node: ClayTreeNode = { kind: "text", text };
  if (typeof value.name === "string" && value.name) node.name = value.name;
  const x = value.x;
  const y = value.y;
  if (isNum(x) && isNum(y)) {
    node.x = round2(x);
    node.y = round2(y);
  }
  const fontSize = isNum(value.fontSize) ? round2(value.fontSize) : 14;
  node.fontSize = fontSize;
  node.lineHeight = isNum(value.lineHeight) ? round2(value.lineHeight) : round2(fontSize * 1.4);
  const color = parseFill(value.fill, stats);
  if (color) node.color = color;
  if (isNum(value.width)) node.width = round2(value.width);
  if (isNum(value.height)) node.height = round2(value.height);
  return node;
}
