/**
 * Simplified in-app risk map — replaces the CRG wheel's own `visualize` D3
 * page (user ask 2026-08-31: "对于我们而言太复杂了，需要简化同时保持效果").
 *
 * The old path spawned `code-review-graph visualize` and handed its stdout
 * back as if it were HTML (the wheel only prints a file path — the "graph"
 * window rendered that one line of text), plus a ~MB self-contained D3 page
 * nobody could read. This generator instead reads graph.db DIRECTLY via
 * CrgGraphQuery.getRiskOverview (top-N nodes by risk + the CALLS edges among
 * them) and emits a small self-contained page: one SVG ring, nodes sized and
 * colored by risk score, hover/click highlights the node's call links, and a
 * side card with the details. No external libraries, no Python, no spawn.
 */

import { createCrgGraphQuery, type CrgRiskNode } from "@deeporca/core";

/** How many top-risk nodes the simplified map shows. */
const OVERVIEW_LIMIT = 60;

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

/** Deterministic ring layout: highest risk at 12 o'clock, clockwise. */
function ringPosition(index: number, total: number): { x: number; y: number } {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { x: 460 + 330 * Math.cos(angle), y: 400 + 330 * Math.sin(angle) };
}

export function buildRiskGraphHtml(root: string, projectName: string, language: string): string | null {
  const query = createCrgGraphQuery();
  if (!query.hasGraph(root)) return null;
  const { nodes, edges } = query.getRiskOverview(root, OVERVIEW_LIMIT);
  if (nodes.length === 0) return null;

  const zh = language.toLowerCase().startsWith("zh");
  const labels = zh
    ? {
        title: "审查风险图谱",
        subtitle: `Top ${nodes.length} 风险节点 · ${edges.length} 条调用边 · 简化视图（自研渲染）`,
        score: "风险分",
        callers: "调用者数",
        coverage: "测试覆盖",
        security: "安全相关",
        empty: "点击节点查看详情",
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
        empty: "Click a node for details",
        legendHigh: "High risk",
        legendMid: "Medium risk",
        legendLow: "Low risk",
      };

  const positions = new Map<string, { x: number; y: number }>();
  const byName = new Map<string, CrgRiskNode>(nodes.map((n) => [n.qualifiedName, n]));
  nodes.forEach((n, i) => positions.set(n.qualifiedName, ringPosition(i, nodes.length)));

  const edgeLines = edges
    .map((e) => {
      const a = positions.get(e.source);
      const b = positions.get(e.target);
      if (!a || !b) return "";
      return (
        `<line data-src="${escapeHtml(e.source)}" data-dst="${escapeHtml(e.target)}" ` +
        `x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`
      );
    })
    .join("\n");

  const nodeDots = nodes
    .map((n, i) => {
      const p = positions.get(n.qualifiedName)!;
      const r = 5 + n.riskScore * 9;
      const short = n.name.length > 26 ? `${n.name.slice(0, 25)}…` : n.name;
      // Labels for the top-risk nodes alternate outside/inside the ring along
      // the radial direction so adjacent names don't overlap.
      let label = "";
      // Label every OTHER of the top-10 — top-risk nodes sit adjacent on the
      // ring, so consecutive labels would collide.
      if (i < 10 && i % 2 === 0) {
        const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const off = i % 2 === 0 ? r + 10 : -(r + 22);
        label =
          `<text x="${(dx * off).toFixed(1)}" y="${(dy * off + 4).toFixed(1)}"` +
          `${dx > 0.3 ? ' text-anchor="start" x="' + (dx * off + 4).toFixed(1) + '"' : dx < -0.3 ? ' text-anchor="end" x="' + (dx * off - 4).toFixed(1) + '"' : ""}>` +
          `${escapeHtml(short)}</text>`;
      }
      return (
        `<g class="node" data-id="${escapeHtml(n.qualifiedName)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">` +
        `<circle r="${r.toFixed(1)}" fill="${riskColor(n.riskScore)}" ${n.securityRelevant ? 'class="sec"' : ""}/>` +
        label +
        `</g>`
      );
    })
    .join("\n");

  // The side card is SERVER-RENDERED for the top-risk node: the initial view
  // is fully populated even if the interaction script never runs.
  const top = nodes[0];
  const topNeighbors = edges
    .filter((e) => e.source === top.qualifiedName || e.target === top.qualifiedName)
    .map((e) => {
      const other = byName.get(e.source === top.qualifiedName ? e.target : e.source);
      return other ? `${e.source === top.qualifiedName ? "→" : "←"} ${other.name}` : null;
    })
    .filter((v): v is string => v !== null);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(labels.title)} — ${escapeHtml(projectName)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
    "PingFang SC", "Microsoft YaHei", sans-serif; background: #f4f6fa; color: #1b2129; }
  @media (prefers-color-scheme: dark) {
    body { background: #17191f; color: #e6e9ef; }
    .side { background: #1f2229 !important; border-color: #34383f !important; }
    svg { background: #1b1e24 !important; }
    .meta { color: #9aa5b3 !important; }
  }
  .main { flex: 1; padding: 20px 8px 8px 20px; min-width: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .meta { color: #66707d; font-size: 12.5px; margin-bottom: 6px; }
  svg { width: 100%; height: calc(100vh - 84px); background: #eef1f6; border-radius: 12px; }
  svg line { stroke: #b3bcc9; stroke-opacity: .35; stroke-width: 1; }
  svg line.hot { stroke: #d64545; stroke-opacity: .9; stroke-width: 2; }
  svg circle { cursor: pointer; }
  svg circle.sec { stroke: #7c3aed; stroke-width: 2.5; }
  svg g.node.dim { opacity: .22; }
  svg g.node text { font-size: 11px; fill: #55606d; text-anchor: middle; pointer-events: none; }
  .legend { position: absolute; left: 32px; bottom: 20px; font-size: 12px; color: #55606d;
    display: flex; gap: 14px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; }
  .side { width: 320px; flex: none; margin: 20px 20px 20px 0; border: 1px solid #d9dee6;
    background: #fff; border-radius: 12px; padding: 16px; overflow: auto; max-height: calc(100vh - 40px); }
  .side h2 { margin: 0 0 8px; font-size: 14px; word-break: break-all; }
  .side .row { font-size: 12.5px; margin: 6px 0; color: #3c4653; word-break: break-all; }
  .side .row b { color: inherit; }
  .side .nb { margin-top: 10px; }
  .side .nb div { font-size: 12px; padding: 3px 0; border-bottom: 1px dashed #e2e6ec;
    word-break: break-all; color: #55606d; }
</style>
</head>
<body>
<div class="main">
  <h1>${escapeHtml(labels.title)} — ${escapeHtml(projectName)}</h1>
  <div class="meta">${escapeHtml(labels.subtitle)} · <code>${escapeHtml(root)}</code></div>
  <svg viewBox="0 0 920 800" role="img" aria-label="${escapeHtml(labels.title)}">
    ${edgeLines}
    ${nodeDots}
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
</aside>
<script>
(function () {
  try {
  var labels = {
    score: ${JSON.stringify(labels.score)},
    callers: ${JSON.stringify(labels.callers)},
    coverage: ${JSON.stringify(labels.coverage)},
    security: ${JSON.stringify(labels.security).replace(/</g, "\\u003c")}
  };
  // JSON embedded into an inline <script>: "<" is escaped so a hostile name
  // can never close the script block from inside a JS string literal.
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
  var byId = {};
  var nodes = document.querySelectorAll("g.node");
  nodes.forEach(function (g) { byId[g.getAttribute("data-id")] = g; });
  var lines = document.querySelectorAll("svg line");
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
    var esc = function (v) {
      return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };
    aside.innerHTML =
      "<h2>" + esc(d.name) + "</h2>" +
      '<div class="row">' + esc(d.path) + "</div>" +
      '<div class="row"><b>' + labels.score + ":</b> " + d.score + "</div>" +
      '<div class="row"><b>' + labels.callers + ":</b> " + d.callers + "</div>" +
      '<div class="row"><b>' + labels.coverage + ":</b> " + d.coverage + "</div>" +
      (d.sec ? '<div class="row"><b>' + labels.security + "</b></div>" : "") +
      '<div class="nb">' + Object.keys(neighbors).map(function (k) {
        return "<div>" + esc(neighbors[k]) + "</div>";
      }).join("") + "</div>";
    nodes.forEach(function (g) { g.classList.toggle("dim", g.getAttribute("data-id") !== id); });
    lines.forEach(function (l) {
      var hit = l.getAttribute("data-src") === id || l.getAttribute("data-dst") === id;
      l.classList.toggle("hot", hit);
      l.style.opacity = hit ? "" : "0.08";
    });
  }
  nodes.forEach(function (g) {
    g.addEventListener("click", function () { show(g.getAttribute("data-id")); });
    g.addEventListener("mouseenter", function () { show(g.getAttribute("data-id")); });
  });
  document.querySelector("svg").addEventListener("mouseleave", function () {
    nodes.forEach(function (g) { g.classList.remove("dim"); });
    lines.forEach(function (l) { l.classList.remove("hot"); l.style.opacity = ""; });
  });
  if (nodes.length > 0) show(nodes[0].getAttribute("data-id"));
  } catch (e) { /* side card ships server-rendered; interactions only */ }
})();
</script>
</body>
</html>`;
}
