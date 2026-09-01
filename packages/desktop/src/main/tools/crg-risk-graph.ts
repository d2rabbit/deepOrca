/**
 * Simplified in-app risk map — replaces the CRG wheel's own `visualize` D3
 * page (user ask 2026-08-31: "对于我们而言太复杂了，需要简化同时保持效果";
 * layout rework 2026-09-01: 不是环形，是按文件分组的图谱，参考架构图/索引关系图
 * 的分组卡片风格).
 *
 * Reads graph.db DIRECTLY via CrgGraphQuery.getRiskOverview (top-N nodes by
 * risk + the CALLS edges among them) and emits a small self-contained page:
 * functions grouped into per-FILE cards on a grid, each function a row with a
 * risk-colored dot + score; CALLS edges drawn between rows; click a row → the
 * side card shows details + neighbors (server-rendered for the top node, so
 * the initial view is populated even without the interaction script).
 * No external libraries, no Python, no spawn.
 */

import { createCrgGraphQuery, type CrgRiskEdge, type CrgRiskNode } from "@deeporca/core";
import type { ReviewGraphFinding } from "../../shared/ipc";
import { bindFindingsToNodes } from "./review-bind.js";

/** How many top-risk nodes the simplified map shows. */
export const OVERVIEW_LIMIT = 60;
/** Grouping caps — a readable board, not a data dump. */
const MAX_FILES = 8;
const MAX_FUNCS_PER_FILE = 8;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Risk score → color: high = red, mid = amber, low = slate. */
function riskColor(score: number): string {
  if (score >= 0.66) return "#d64545";
  if (score >= 0.33) return "#d97706";
  return "#64748b";
}

const CARD_W = 430;
const ROW_H = 30;
const HEAD_H = 34;
const GAP_X = 46;
const GAP_Y = 34;
const COLS = 2;

/** One grouped card on the board. */
type BoardGroup = { label: string; funcs: CrgRiskNode[] };

type Board = { width: number; height: number; svg: string };

/**
 * Lay one board out: groups → cards (COLS columns, deterministic order —
 * same graph, same board), functions as rows with risk dots + scores, CALLS
 * edges drawn between row centers. `isCross` marks edges whose endpoints
 * belong to DIFFERENT groups (the community board uses it to highlight
 * cross-community calls — design mining item ④).
 */
function buildBoard(groups: BoardGroup[], edges: CrgRiskEdge[], isCross?: (s: string, t: string) => boolean): Board {
  const positions = new Map<string, { x: number; y: number }>();
  const cardRects: { x: number; y: number; w: number; h: number; label: string }[] = [];
  groups.forEach((g, gi) => {
    const col = gi % COLS;
    const rowIdx = Math.floor(gi / COLS);
    const x = 36 + col * (CARD_W + GAP_X);
    const y = 96 + rowIdx * (HEAD_H + g.funcs.length * ROW_H + 26 + GAP_Y);
    cardRects.push({ x, y, w: CARD_W, h: HEAD_H + g.funcs.length * ROW_H + 16, label: g.label });
    g.funcs.forEach((n, fi) => {
      positions.set(n.qualifiedName, { x: x + 96, y: y + HEAD_H + fi * ROW_H + ROW_H / 2 + 2 });
    });
  });
  const width = 36 + COLS * (CARD_W + GAP_X) + 10;
  const rowsOfCards = Math.ceil(groups.length / COLS);
  const height = 96 + rowsOfCards * (HEAD_H + MAX_FUNCS_PER_FILE * ROW_H + 26 + GAP_Y) + 30;

  const edgeLines = edges
    .map((e) => {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b) return "";
      const mid = (a.x + b.x) / 2;
      const cross = isCross?.(e.source, e.target) ? " cross" : "";
      return (
        `<path class="edge${cross}" data-src="${escapeHtml(e.source)}" data-dst="${escapeHtml(e.target)}" ` +
        `d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${mid.toFixed(1)} ${a.y.toFixed(1)}, ${mid.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`
      );
    })
    .join("\n");

  const cards = cardRects
    .map((c) => {
      const short = c.label.length > 46 ? `…${c.label.slice(-45)}` : c.label;
      const rows = (groups[cardRects.indexOf(c)]?.funcs ?? [])
        .map((n) => {
          const p = positions.get(n.qualifiedName);
          if (!p) return "";
          const r = 4 + n.riskScore * 7;
          const name = n.name.length > 30 ? `${n.name.slice(0, 29)}…` : n.name;
          return (
            `<g class="fnode" data-id="${escapeHtml(n.qualifiedName)}">` +
            `<rect class="hit" x="${c.x + 6}" y="${(p.y - ROW_H / 2 + 2).toFixed(1)}" width="${CARD_W - 12}" height="${ROW_H - 2}"/>` +
            `<circle cx="${c.x + 20}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${riskColor(n.riskScore)}" ${n.securityRelevant ? 'class="sec"' : ""}/>` +
            `<text class="fname" x="${c.x + 36}" y="${(p.y + 4).toFixed(1)}">${escapeHtml(name)}</text>` +
            `<text class="fscore" x="${c.x + CARD_W - 12}" y="${(p.y + 4).toFixed(1)}">${n.riskScore.toFixed(2)}</text>` +
            `</g>`
          );
        })
        .join("\n");
      return (
        `<g class="file-card">` +
        `<rect class="card-bg" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="10"/>` +
        `<text class="card-file" x="${c.x + 14}" y="${c.y + 22}">${escapeHtml(short)}</text>` +
        rows +
        `</g>`
      );
    })
    .join("\n");

  return { width, height, svg: edgeLines + "\n" + cards };
}

/**
 * `theme` is passed EXPLICITLY by the caller (the app's resolved appearance)
 * instead of keying off `prefers-color-scheme`: the page renders inside an
 * iframe, which follows the OS setting rather than the app's appearance
 * toggle (review round 2026-09-01 — same treatment as the arch preview).
 */
export function buildRiskGraphHtml(
  root: string,
  projectName: string,
  language: string,
  theme: "light" | "dark",
  reportFindings?: ReviewGraphFinding[]
): string | null {
  const query = createCrgGraphQuery();
  if (!query.hasGraph(root)) return null;
  const { nodes, edges } = query.getRiskOverview(root, OVERVIEW_LIMIT);
  if (nodes.length === 0) return null;

  // Bidirectional locate (design §4.3): the currently selected report's
  // findings bind to the top-N nodes by line-range overlap — the side card
  // then shows each node's related opinions and each opinion can jump back
  // to the report (parent.postMessage). Same bind routine reviewReadReport
  // uses, so both surfaces agree.
  const bindings = bindFindingsToNodes(reportFindings ?? [], nodes, root);
  const sevOf = (content: string | undefined): "hi" | "md" | "lo" => {
    const m = (content ?? "").match(/^\[(CRITICAL|HIGH|MEDIUM|LOW)\]/);
    if (!m) return "lo";
    return m[1] === "CRITICAL" || m[1] === "HIGH" ? "hi" : m[1] === "MEDIUM" ? "md" : "lo";
  };
  const summaryOf = (content: string | undefined): string => {
    const text = (content ?? "")
      .replace(/^\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 56 ? `${text.slice(0, 55)}…` : text;
  };
  const opinionsByQn = new Map<string, { findex: number; sev: "hi" | "md" | "lo"; label: string }[]>();
  for (const b of bindings) {
    const f = reportFindings?.[b.index];
    if (!f) continue;
    const list = opinionsByQn.get(b.qn) ?? [];
    list.push({ findex: b.index, sev: sevOf(f.content), label: summaryOf(f.content) });
    opinionsByQn.set(b.qn, list);
  }
  // Server-rendered opinions for the pre-filled top node (script can be
  // blocked by the sandbox — the initial side card still explains itself).
  const topOpinions = (opinionsByQn.get(nodes[0].qualifiedName) ?? [])
    .map(
      (o) =>
        `<div class="fi-item" data-fi="${o.findex}"><span class="fs ${o.sev}"></span>` +
        `<span class="fj">${escapeHtml(o.label)}</span></div>`
    )
    .join("");

  const zh = language.toLowerCase().startsWith("zh");
  const labels = zh
    ? {
        title: "审查风险图谱",
        subtitle: `Top ${nodes.length} 风险节点 · ${edges.length} 条调用边 · 简化视图（自研渲染）`,
        score: "风险分",
        callers: "调用者数",
        coverage: "测试覆盖",
        security: "安全相关",
        startHint: "点击节点查看详情",
        opinionsHead: "相关审查意见",
        opinionsHint: "点击回跳报告",
        opinionsEmpty: "该节点无对应审查意见",
        modeFile: "按文件",
        modeCommunity: "按社区",
        cohesion: "凝聚力",
        nodes: "节点",
        uncategorized: "未归类",
        legendHigh: "高风险",
        legendMid: "中风险",
        legendLow: "低风险",
      }
    : {
        title: "Review Risk Map",
        subtitle: `Top ${nodes.length} risk nodes · ${edges.length} call edges · simplified view`,
        score: "Risk score",
        callers: "Callers",
        coverage: "Test coverage",
        security: "Security-relevant",
        startHint: "Click a node for details",
        opinionsHead: "Related findings",
        opinionsHint: "Click to jump back to the report",
        opinionsEmpty: "no related findings for this node",
        modeFile: "By file",
        modeCommunity: "By community",
        cohesion: "cohesion",
        nodes: "nodes",
        uncategorized: "uncategorized",
        legendHigh: "High risk",
        legendMid: "Medium risk",
        legendLow: "Low risk",
      };

  // ── Two grouping axes (design mining item ④) ─────────────────────────
  // file board:  one card per file (the original layout — default view);
  // community board: one card per Leiden community (label shows name +
  // cohesion + size), with cross-community CALLS edges highlighted. Both
  // boards render the SAME nodes/edges — only the grouping differs — and
  // the page switches between them without a re-request.
  const sortGroup = (list: CrgRiskNode[]): CrgRiskNode[] =>
    [...list].sort((a, b) => b.riskScore - a.riskScore || b.callerCount - a.callerCount).slice(0, MAX_FUNCS_PER_FILE);

  const byFile = new Map<string, CrgRiskNode[]>();
  for (const n of nodes) {
    const list = byFile.get(n.filePath) ?? [];
    list.push(n);
    byFile.set(n.filePath, list);
  }
  const fileGroups: BoardGroup[] = [...byFile.entries()]
    .map(([filePath, list]) => ({ label: filePath, funcs: sortGroup(list) }))
    .sort((a, b) => b.funcs[0].riskScore - a.funcs[0].riskScore)
    .slice(0, MAX_FILES);
  const boardFile = buildBoard(fileGroups, edges);

  // Community labels — name + cohesion + size from the communities table
  // (absent/failed reads keep the view file-only: fail-open).
  const commIds = [...new Set(nodes.map((n) => n.communityId).filter((c): c is number => c != null))];
  let commMeta = new Map<number, { name: string; cohesion: number; size: number }>();
  if (commIds.length > 0) {
    const comms = query.getCommunities(root, commIds);
    commMeta = new Map(comms.map((c) => [c.id, { name: c.name || `#${c.id}`, cohesion: c.cohesion, size: c.size }]));
  }
  const hasCommunities = commIds.length > 0 && nodes.some((n) => n.communityId != null);

  const commOf = (qn: string): number | null => nodes.find((n) => n.qualifiedName === qn)?.communityId ?? null;
  let boardComm: Board | null = null;
  if (hasCommunities) {
    const byComm = new Map<string, CrgRiskNode[]>();
    for (const n of nodes) {
      const key = String(n.communityId ?? -1);
      const list = byComm.get(key) ?? [];
      list.push(n);
      byComm.set(key, list);
    }
    const commGroups: BoardGroup[] = [...byComm.entries()]
      .map(([key, list]) => {
        const id = Number(key);
        const meta = id >= 0 ? commMeta.get(id) : undefined;
        const label = meta
          ? `${meta.name} · ${labels.cohesion}: ${meta.cohesion.toFixed(2)} · ${meta.size || list.length} ${labels.nodes}`
          : `${labels.uncategorized}`;
        return { label, funcs: sortGroup(list) };
      })
      .sort((a, b) => b.funcs[0].riskScore - a.funcs[0].riskScore)
      .slice(0, MAX_FILES);
    boardComm = buildBoard(commGroups, edges, (src, tgt) => {
      const a = commOf(src);
      const b = commOf(tgt);
      return a != null && b != null && a !== b;
    });
  }
  const width = Math.max(boardFile.width, boardComm?.width ?? 0);
  const height = Math.max(boardFile.height, boardComm?.height ?? 0);

  const drawn = new Map<string, CrgRiskNode>();
  for (const n of nodes) drawn.set(n.qualifiedName, n);

  // Server-rendered side card for the top-risk node — initial view is
  // populated even if the interaction script never runs.
  const top = nodes[0];
  const topNeighbors = edges
    .filter((e) => e.source === top.qualifiedName || e.target === top.qualifiedName)
    .map((e) => {
      const other = drawn.get(e.source === top.qualifiedName ? e.target : e.source);
      return other ? `${e.source === top.qualifiedName ? "→" : "←"} ${other.name}` : null;
    })
    .filter((v): v is string => v !== null);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}" data-theme="${theme === "dark" ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(labels.title)} — ${escapeHtml(projectName)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Microsoft YaHei", sans-serif; background: #f4f6fa; color: #1b2129; }
  [data-theme="dark"] body { background: #17191f; color: #e6e9ef; }
  [data-theme="dark"] .side { background: #1f2229 !important; border-color: #34383f !important; }
  [data-theme="dark"] svg { background: #1b1e24 !important; }
  [data-theme="dark"] .meta { color: #9aa5b3 !important; }
  [data-theme="dark"] .file-card .card-bg { fill: #1f2229 !important; stroke: #34383f !important; }
  [data-theme="dark"] .card-file, [data-theme="dark"] .fname { fill: #e6e9ef !important; }
  [data-theme="dark"] .fscore { fill: #9aa5b3 !important; }
  [data-theme="dark"] svg .edge { stroke: #4a5160 !important; }
  .main { flex: 1; padding: 20px 8px 8px 20px; min-width: 0; position: relative; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .meta { color: #66707d; font-size: 12.5px; margin-bottom: 6px; }
  svg { width: 100%; height: calc(100vh - 96px); background: #eef1f6; border-radius: 12px; }
  .file-card .card-bg { fill: #ffffff; stroke: #d9dee6; stroke-width: 1; }
  .card-file { font-size: 12px; font-weight: 650; fill: #3c4653; }
  .fnode .hit { fill: transparent; cursor: pointer; }
  .fnode .hit:hover { fill: rgba(59, 130, 246, 0.06); }
  .fnode.dim { opacity: 0.22; }
  .fname { font-size: 11.5px; fill: #1b2129; }
  .fscore { font-size: 11px; fill: #66707d; text-anchor: end; font-family: ui-monospace, Consolas, monospace; }
  svg .edge { fill: none; stroke: #b3bcc9; stroke-opacity: 0.35; stroke-width: 1; }
  svg .edge.hot { stroke: #d64545; stroke-opacity: 0.9; stroke-width: 2; }
  svg .fnode circle { cursor: pointer; }
  svg .fnode circle.sec { stroke: #7c3aed; stroke-width: 2.5; }
  .mode-seg { display: inline-flex; gap: 2px; margin-left: 12px; padding: 2px;
    background: #ffffff; border: 1px solid #d9dee6; border-radius: 999px; vertical-align: -2px; }
  [data-theme="dark"] .mode-seg { background: #1f2229; border-color: #34383f; }
  .mode-seg .ms { font-size: 10.5px; padding: 2px 10px; border-radius: 999px;
    color: #66707d; cursor: pointer; }
  [data-theme="dark"] .mode-seg .ms { color: #9aa5b3; }
  .mode-seg .ms.on { background: rgba(28, 111, 224, 0.14); color: #1c6fe0; font-weight: 600; }
  [data-theme="dark"] .mode-seg .ms.on { background: rgba(90, 150, 240, 0.2); color: #5aa9ff; }
  svg .edge.cross { stroke: #d64545; stroke-opacity: 0.6; stroke-dasharray: 4 3; }
  .legend { position: absolute; left: 32px; bottom: 16px; font-size: 12px; color: #55606d;
    display: flex; gap: 14px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; }
  .side { width: 330px; flex: none; margin: 20px 20px 20px 0; border: 1px solid #d9dee6;
    background: #fff; border-radius: 12px; padding: 16px; overflow: auto; max-height: calc(100vh - 40px); }
  .side h2 { margin: 0 0 8px; font-size: 14px; word-break: break-all; }
  .side .row { font-size: 12.5px; margin: 6px 0; color: #3c4653; word-break: break-all; }
  .side .row b { color: inherit; }
  .side .nb { margin-top: 10px; }
  .side .nb div { font-size: 12px; padding: 3px 0; border-bottom: 1px dashed #e2e6ec;
    word-break: break-all; color: #55606d; }
  .side .fi { margin-top: 12px; }
  .side .fi-head { font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: #66707d; margin-bottom: 6px; }
  [data-theme="dark"] .side .fi-head { color: #9aa5b3; }
  .side .fi-item { display: flex; align-items: center; gap: 7px; font-size: 11.5px;
    padding: 5px 8px; margin-bottom: 4px; border: 1px solid #e2e6ec; border-radius: 8px;
    color: #3c4653; cursor: pointer; background: #fbfcfd; }
  .side .fi-item:hover { border-color: #1c6fe0; color: #1b2129; }
  [data-theme="dark"] .side .fi-item { background: #23262e; border-color: #34383f; color: #9aa5b3; }
  [data-theme="dark"] .side .fi-item:hover { border-color: #5aa9ff; color: #e6e9ef; }
  .side .fi-item .fs { flex: none; width: 8px; height: 8px; border-radius: 50%; }
  .side .fi-item .fs.hi { background: #d64545; }
  .side .fi-item .fs.md { background: #d97706; }
  .side .fi-item .fs.lo { background: #64748b; }
  .side .fi-item .fj { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side .fi-empty { font-size: 11.5px; color: #8590a0; padding: 4px 2px; }
  [data-theme="dark"] .side .fi-empty { color: #6f7a89; }
</style>
</head>
<body>
<div class="main">
  <h1>${escapeHtml(labels.title)} — ${escapeHtml(projectName)}</h1>
  <div class="meta">
    ${escapeHtml(labels.subtitle)} · <code>${escapeHtml(root)}</code>
    ${
      hasCommunities
        ? `
    <span class="mode-seg" id="modeSeg">
      <span class="ms on" data-board="file">${escapeHtml(labels.modeFile)}</span>
      <span class="ms" data-board="comm">${escapeHtml(labels.modeCommunity)}</span>
    </span>`
        : ""
    }
  </div>
  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(labels.title)}">
    <g id="board-file">${boardFile.svg}</g>
    ${boardComm ? `<g id="board-comm" style="display:none">${boardComm.svg}</g>` : ""}
  </svg>
  <div class="legend">
    <span><i style="background:#d64545"></i>${escapeHtml(labels.legendHigh)}</span>
    <span><i style="background:#d97706"></i>${escapeHtml(labels.legendMid)}</span>
    <span><i style="background:#64748b"></i>${escapeHtml(labels.legendLow)}</span>
    <span><i style="background:none;border:2px solid #7c3aed"></i>${escapeHtml(labels.security)}</span>
  </div>
</div>
<aside class="side">
  <h2>${escapeHtml(top.name)}</h2>
  <div class="row">${escapeHtml(top.filePath + (top.lineStart > 0 ? ":" + top.lineStart : ""))}</div>
  <div class="row"><b>${escapeHtml(labels.score)}:</b> ${top.riskScore.toFixed(2)}</div>
  <div class="row"><b>${escapeHtml(labels.callers)}:</b> ${top.callerCount}</div>
  <div class="row"><b>${escapeHtml(labels.coverage)}:</b> ${escapeHtml(top.testCoverage)}</div>
  ${top.securityRelevant ? `<div class="row"><b>${escapeHtml(labels.security)}</b></div>` : ""}
  ${topNeighbors.length > 0 ? `<div class="nb">${topNeighbors.map((t) => `<div>${escapeHtml(t)}</div>`).join("")}</div>` : ""}
  <div class="fi">
    <div class="fi-head">${escapeHtml(labels.opinionsHead)} · ${escapeHtml(labels.opinionsHint)}</div>
    <div id="gaFindings">${topOpinions || `<div class="fi-empty">${escapeHtml(labels.opinionsEmpty)}</div>`}</div>
  </div>
</aside>
<script>
(function () {
  try {
  var esc = function (v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  var labels = {
    score: ${JSON.stringify(labels.score).replace(/</g, "\\u003c")},
    callers: ${JSON.stringify(labels.callers).replace(/</g, "\\u003c")},
    coverage: ${JSON.stringify(labels.coverage).replace(/</g, "\\u003c")},
    security: ${JSON.stringify(labels.security).replace(/</g, "\\u003c")},
    opinionsEmpty: ${JSON.stringify(labels.opinionsEmpty).replace(/</g, "\\u003c")},
    opinionsHead: ${JSON.stringify(labels.opinionsHead).replace(/</g, "\\u003c")}
  };
  // finding-index → severity dot + snippet, grouped by node qualified name
  var opinions = ${JSON.stringify(Object.fromEntries(opinionsByQn)).replace(/</g, "\\u003c")};
  var info = ${JSON.stringify(
    Object.fromEntries(
      nodes.map((n) => [
        n.qualifiedName,
        {
          name: n.name,
          path: n.filePath + (n.lineStart > 0 ? ":" + n.lineStart : ""),
          score: n.riskScore.toFixed(2),
          callers: n.callerCount,
          coverage: n.testCoverage,
          sec: n.securityRelevant,
        },
      ])
    )
  ).replace(/</g, "\\u003c")};
  var nodes = document.querySelectorAll("g.fnode");
  var lines = document.querySelectorAll("svg .edge");
  var aside = document.querySelector(".side");
  function show(id) {
    var d = info[id];
    if (!d) return;
    var neighbors = {};
    lines.forEach(function (l) {
      var s = l.getAttribute("data-src"), t = l.getAttribute("data-dst");
      if (s === id) neighbors[t] = "→ " + (info[t] ? info[t].name : t);
      if (t === id) neighbors[s] = "← " + (info[s] ? info[s].name : s);
    });
    aside.innerHTML =
      "<h2>" + esc(d.name) + "</h2>" +
      '<div class="row">' + esc(d.path) + "</div>" +
      '<div class="row"><b>' + labels.score + ":</b> " + d.score + "</div>" +
      '<div class="row"><b>' + labels.callers + ":</b> " + d.callers + "</div>" +
      '<div class="row"><b>' + labels.coverage + ":</b> " + d.coverage + "</div>" +
      (d.sec ? '<div class="row"><b>' + labels.security + "</b></div>" : "") +
      '<div class="nb">' + Object.keys(neighbors).map(function (k) {
        return "<div>" + esc(neighbors[k]) + "</div>";
      }).join("") + "</div>" +
      '<div class="fi">' +
        '<div class="fi-head">' + labels.opinionsHead + '</div>' +
        renderOpinions(id) +
      "</div>";
    nodes.forEach(function (g) { g.classList.toggle("dim", g.getAttribute("data-id") !== id); });
    lines.forEach(function (l) {
      var hit = l.getAttribute("data-src") === id || l.getAttribute("data-dst") === id;
      l.classList.toggle("hot", hit);
      l.style.opacity = hit ? "" : "0.08";
    });
  }
  function renderOpinions(id) {
    var list = opinions[id] || [];
    if (list.length === 0) return '<div class="fi-empty">' + esc(labels.opinionsEmpty) + "</div>";
    return list.map(function (o) {
      return '<div class="fi-item" data-fi="' + o.findex + '">' +
        '<span class="fs ' + o.sev + '"></span><span class="fj">' + esc(o.label) + "</span></div>";
    }).join("");
  }
  document.getElementById("gaFindings").addEventListener("click", function (e) {
    var item = e.target.closest(".fi-item");
    if (!item) return;
    // Jump back to the report and flash the finding (design §3.3).
    try {
      parent.postMessage({ type: "crg:locate-finding", findex: Number(item.getAttribute("data-fi")) }, "*");
    } catch (err) { /* sandboxed or detached — side card only */ }
  });
  // External locate: the report's "定位 ◎" chip asks this page to select a node.
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "crg:select-node" || typeof d.qn !== "string") return;
    if (info[d.qn]) show(d.qn);
  });
  nodes.forEach(function (g) {
    g.addEventListener("click", function () { show(g.getAttribute("data-id")); });
    g.addEventListener("mouseenter", function () { show(g.getAttribute("data-id")); });
  });
  document.querySelector("svg").addEventListener("mouseleave", function () {
    nodes.forEach(function (g) { g.classList.remove("dim"); });
    lines.forEach(function (l) { l.classList.remove("hot"); l.style.opacity = ""; });
  });
  // Board group switcher (file ↔ community) — both boards ship in the page.
  var modeSeg = document.getElementById("modeSeg");
  if (modeSeg) {
    modeSeg.addEventListener("click", function (e) {
      var item = e.target.closest(".ms");
      if (!item) return;
      modeSeg.querySelectorAll(".ms").forEach(function (m) { m.classList.toggle("on", m === item); });
      var fileBoard = document.getElementById("board-file");
      var commBoard = document.getElementById("board-comm");
      if (!fileBoard || !commBoard) return;
      var comm = item.getAttribute("data-board") === "comm";
      fileBoard.style.display = comm ? "none" : "";
      commBoard.style.display = comm ? "" : "none";
    });
  }
  if (nodes.length > 0) show(nodes[0].getAttribute("data-id"));
  } catch (e) { /* side card ships server-rendered; interactions only */ }
})();
</script>
</body>
</html>`;
}
