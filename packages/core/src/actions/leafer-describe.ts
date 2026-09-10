/**
 * UI→prompt deterministic compiler (specs/leafer-ui-engine WP5, M3E-canvas
 * methodology internalization). Translates a Leafer scene JSON into a stable
 * semantic outline for revision prompts:
 *
 *   - 几何→语义 (M3E #2): absolute coordinates become position words
 *     (top-left / centered / bottom-right …); raw numbers stay only in sizes.
 *   - 命名指代 (M3E #5): elements are addressed by their stable `name`
 *     (fallback: deterministic path), so revision instructions can reference
 *     nodes without re-generating coordinates.
 *   - 无抖动: pure function of the parsed document — same input produces
 *     byte-identical output regardless of JSON key order or whitespace
 *     (canonicalization + fixed traversal + fixed formatting; nothing
 *     time- or environment-dependent enters the string).
 */

export interface DescribeResult {
  /** Human/LLM-readable outline (empty document safe). */
  outline: string;
  /** Total nodes seen (including omitted-by-cap ones). */
  nodeCount: number;
}

const MAX_DEPTH = 24;
const MAX_NODES = 200;
const MAX_TEXT_CHARS = 80;

interface DescribeNode {
  tag?: unknown;
  name?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  fill?: unknown;
  stroke?: unknown;
  text?: unknown;
  fontSize?: unknown;
  flow?: unknown;
  gap?: unknown;
  padding?: unknown;
  children?: unknown;
}

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isStr = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Parse + canonicalize: kill whitespace/key-order jitter at the prompt seam. */
export function canonicalLeaferJson(leaferJson: string): string | null {
  try {
    return JSON.stringify(JSON.parse(leaferJson));
  } catch {
    return null;
  }
}

/** Horizontal position of an element against the root canvas width. */
function horizontalSlot(x: number, width: number, canvasWidth: number): string {
  if (width >= canvasWidth) return "full-width";
  if (x + width / 2 < canvasWidth / 3) return "left";
  if (x + width / 2 > (canvasWidth * 2) / 3) return "right";
  return "center";
}

/** Vertical position of an element against the root canvas height. */
function verticalSlot(y: number, height: number, canvasHeight: number): string {
  if (height >= canvasHeight) return "full-height";
  if (y + height / 2 < canvasHeight / 3) return "top";
  if (y + height / 2 > (canvasHeight * 2) / 3) return "bottom";
  return "middle";
}

function stylePhrase(node: DescribeNode): string {
  const parts: string[] = [];
  if (isStr(node.fill)) parts.push(`fill ${node.fill}`);
  if (isStr(node.stroke)) parts.push(`stroke ${node.stroke}`);
  if (isNum(node.fontSize)) parts.push(`fontSize ${node.fontSize}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function textPreview(node: DescribeNode): string | null {
  if (!isStr(node.text)) return null;
  const trimmed = node.text.trim();
  const clipped = trimmed.length > MAX_TEXT_CHARS ? `${trimmed.slice(0, MAX_TEXT_CHARS)}…` : trimmed;
  return `"${clipped}"`;
}

export function describeLeaferDocument(leaferJson: string): DescribeResult {
  const lines: string[] = [];
  let nodeCount = 0;
  let parsed: DescribeNode;
  try {
    parsed = JSON.parse(leaferJson) as DescribeNode;
  } catch {
    return { outline: "Scene document: <unparsable JSON>", nodeCount: 0 };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { outline: "Scene document: <not an object>", nodeCount: 0 };
  }

  const canvasWidth = isNum(parsed.width) ? parsed.width : 0;
  const canvasHeight = isNum(parsed.height) ? parsed.height : 0;
  const children = Array.isArray(parsed.children) ? parsed.children : [];
  const sizeLabel = canvasWidth > 0 && canvasHeight > 0 ? `${canvasWidth}x${canvasHeight}` : "<unset>";
  const background = isStr(parsed.fill) ? `, background ${parsed.fill}` : "";
  lines.push(`Canvas ${sizeLabel}${background}, ${children.length} top-level element(s).`);

  const walk = (node: unknown, path: string, depth: number, indent: string): void => {
    if (depth > MAX_DEPTH) return;
    nodeCount += 1;
    if (nodeCount > MAX_NODES) {
      if (nodeCount === MAX_NODES + 1) lines.push(`${indent}… (further nodes omitted)`);
      return;
    }
    if (typeof node !== "object" || node === null) {
      lines.push(`${indent}- <invalid node at ${path}>`);
      return;
    }
    const record = node as DescribeNode;
    const tag = isStr(record.tag) ? record.tag : "Node";
    const name = isStr(record.name) ? `"${record.name}"` : `<${tag.toLowerCase()}-at-${path}>`;
    const geometry =
      isNum(record.x) && isNum(record.y) && isNum(record.width) && isNum(record.height)
        ? `${record.width}x${record.height} at ${verticalSlot(record.y, record.height, canvasHeight)}-${horizontalSlot(record.x, record.width, canvasWidth)}`
        : "auto-sized";
    const preview = textPreview(record);
    const content = preview ? `: ${preview}` : "";
    lines.push(`${indent}- ${tag} ${name} ${geometry}${stylePhrase(record)}${content}`);
    if (Array.isArray(record.children)) {
      record.children.forEach((child, index) => walk(child, `${path}.${index}`, depth + 1, `${indent}  `));
    }
  };

  children.forEach((child, index) => walk(child, `c${index}`, 1, ""));
  return { outline: lines.join("\n"), nodeCount };
}

/** Resolve the stable `name` of the node a deterministic lint `nodePath`
 *  addresses (`document.children[2]`), so revise instructions can cite the
 *  same stable names the semantic outline advertises instead of raw JSON
 *  indices. Null when the path is not a lint path, the document cannot be
 *  parsed, or the node carries no usable name. */
export function leaferNodeStableNameAt(leaferJson: string, nodePath: string): string | null {
  if (!nodePath.startsWith("document")) return null;
  const rest = nodePath.slice("document".length);
  const indices: number[] = [];
  let consumed = 0;
  for (const match of rest.matchAll(/\.children\[(\d+)\]/g)) {
    if (match.index !== consumed) return null;
    consumed = match.index + match[0].length;
    indices.push(Number(match[1]));
  }
  if (consumed !== rest.length || indices.length === 0) return null;
  let node: unknown;
  try {
    node = JSON.parse(leaferJson);
  } catch {
    return null;
  }
  for (const index of indices) {
    if (!node || typeof node !== "object") return null;
    const children = (node as { children?: unknown }).children;
    if (!Array.isArray(children) || index < 0 || index >= children.length) return null;
    node = children[index];
  }
  const name = (node as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name : null;
}
