/**
 * Risk map — Canvas force-directed renderer (user ask 2026-09-01: 性能好、
 * 直观、细致、有适度美观与交互、不花哨；D3 不考虑). Replaces the file-card
 * board: one <canvas>, a hand-rolled bounded physics layout (repulsion +
 * edge springs + group cohesion, PRE-SETTLED synchronously so the first
 * paint is already organized), communities as translucent halos, nodes as
 * risk-colored discs sized by callers. Interactions: hover highlights the
 * neighborhood, click selects into the side card, drag nodes, wheel zoom /
 * drag pan, double-click resets. Communities are FIRST-CLASS: the 文件/社区
 * toggle re-groups the halos (Leiden data comes from the graph build's
 * `communities` extra).
 *
 * ZERO dependencies: no D3, no CDN, no external assets — the page is a
 * self-contained document rendered inside the sandboxed iframe
 * (`sandbox="allow-scripts"`), so every model/DB-authored string reaches the
 * page through `safeJson` (JSON with `<` escaped) or `escapeHtml`.
 *
 * `theme` is passed EXPLICITLY by the caller (the app's resolved appearance)
 * instead of keying off `prefers-color-scheme`: the page renders inside an
 * iframe, which follows the OS setting rather than the app's appearance
 * toggle (review round 2026-09-01 — same treatment as the arch preview).
 */

import { existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { createCrgGraphQuery, CRG_DATA_DIR, CRG_LEGACY_DIR, type CrgRiskEdge, type CrgRiskNode } from "@deeporca/core";
import type { ReviewGraphFinding } from "../../shared/ipc";
import { bindFindingsToNodes } from "./review-bind.js";

/** How many top-risk nodes the simplified map shows. */
export const OVERVIEW_LIMIT = 60;

/** graph.db's on-disk path (canonical or legacy location), null when absent. */
function graphDbPath(root: string): string | null {
  for (const dir of [CRG_DATA_DIR, CRG_LEGACY_DIR]) {
    const p = path.join(root, dir, "graph.db");
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Overview cache (review round 2026-09-01): the six-factor ranking is the
 * heaviest query in the module, and it used to re-run on EVERY report
 * selection AND again for the map. Keyed by root, invalidated by graph.db
 * mtime — a rebuild refreshes naturally, no TTL heuristics.
 */
const overviewCache = new Map<string, { mtimeMs: number; overview: { nodes: CrgRiskNode[]; edges: CrgRiskEdge[] } }>();

export function getRiskOverviewCached(root: string, limit: number): { nodes: CrgRiskNode[]; edges: CrgRiskEdge[] } {
  const dbPath = graphDbPath(root);
  if (!dbPath) return { nodes: [], edges: [] };
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(dbPath).mtimeMs;
  } catch {
    // unreadable — skip the cache, query cold
  }
  const hit = overviewCache.get(root);
  if (hit && mtimeMs > 0 && hit.mtimeMs === mtimeMs) return hit.overview;
  const overview = createCrgGraphQuery().getRiskOverview(root, limit);
  if (mtimeMs > 0) overviewCache.set(root, { mtimeMs, overview });
  return overview;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON for inline <script> — `<` escapes kill `</script>` and `<!--`. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Community hues — one ramp slot per community index (cycles past 8). */
const COMMUNITY_HUES = ["#60a5fa", "#a78bfa", "#2dd4bf", "#fbbf24", "#fb7185", "#22d3ee", "#818cf8", "#a3e635"];

export function buildRiskGraphHtml(
  root: string,
  projectName: string,
  language: string,
  theme: "light" | "dark",
  reportFindings?: ReviewGraphFinding[]
): string | null {
  if (!createCrgGraphQuery().hasGraph(root)) return null;
  const { nodes, edges } = getRiskOverviewCached(root, OVERVIEW_LIMIT);
  if (nodes.length === 0) return null;

  const zh = language.toLowerCase().startsWith("zh");
  const dark = theme === "dark";
  const labels = zh
    ? {
        title: "审查风险图谱",
        score: "风险分",
        callers: "调用者数",
        coverage: "测试覆盖",
        security: "安全相关",
        community: "所属社区",
        neighbors: "邻居",
        byFile: "按文件",
        byCommunity: "按社区",
        legendHigh: "高风险",
        legendMid: "中风险",
        legendLow: "低风险",
        legendSecurity: "安全相关",
        hint: "拖拽节点 · 滚轮缩放 · 双击空白复位 · 悬停看邻居",
        noCommunity: "未归类",
        related: "相关审查意见",
        relatedNone: "该节点无对应审查意见",
        jumpBack: "点击回跳报告",
      }
    : {
        title: "Review Risk Map",
        score: "Risk score",
        callers: "Callers",
        coverage: "Test coverage",
        security: "Security-relevant",
        community: "Community",
        neighbors: "Neighbors",
        byFile: "By file",
        byCommunity: "By community",
        legendHigh: "High risk",
        legendMid: "Medium risk",
        legendLow: "Low risk",
        legendSecurity: "Security",
        hint: "drag nodes · wheel zoom · dbl-click reset · hover for neighbors",
        noCommunity: "unassigned",
        related: "Related findings",
        relatedNone: "No findings bound to this node",
        jumpBack: "click to jump back to the report",
      };

  // Bidirectional locate (design §4.3): the currently selected report's
  // findings bind to the top-N nodes by line-range overlap — the side card
  // shows each node's related opinions and each opinion can jump back to
  // the report (parent.postMessage). Same bind routine reviewReadReport
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

  // Community metadata for halo labels (absent/failed reads keep the view
  // risk-only: fail-open, same as before).
  const commIds = [...new Set(nodes.map((n) => n.communityId).filter((c): c is number => c != null))];
  let commMeta = new Map<number, { name: string; cohesion: number; size: number }>();
  if (commIds.length > 0) {
    const comms = createCrgGraphQuery().getCommunities(root, commIds);
    commMeta = new Map(comms.map((c) => [c.id, { name: c.name || `#${c.id}`, cohesion: c.cohesion, size: c.size }]));
  }

  const payload = {
    dark,
    topQn: nodes[0].qualifiedName,
    labels,
    communities: commIds.map((id, i) => ({
      id,
      name: commMeta.get(id)?.name ?? `#${id}`,
      hue: COMMUNITY_HUES[i % COMMUNITY_HUES.length],
    })),
    nodes: nodes.map((n) => ({
      qn: n.qualifiedName,
      name: n.name,
      file: n.filePath,
      lineStart: n.lineStart,
      risk: n.riskScore,
      callers: n.callerCount,
      security: n.securityRelevant,
      comm: n.communityId,
      coverage: n.testCoverage,
    })),
    edges,
    opinions: [...opinionsByQn.entries()].map(([qn, list]) => ({ qn, list })),
  };

  const subtitle = zh
    ? `Top ${nodes.length} 风险节点 · ${edges.length} 条调用边 · 社区 ${commIds.length} 组 · 拖拽/缩放探索`
    : `Top ${nodes.length} risk nodes · ${edges.length} call edges · ${commIds.length} communities · drag/zoom to explore`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}" data-theme="${dark ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(labels.title)} — ${escapeHtml(projectName)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; flex-direction: column; height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: ${dark ? "#17191f" : "#f6f8fb"}; color: ${dark ? "#e6e9ef" : "#1b2129"}; }
  .top { display: flex; align-items: center; gap: 14px; padding: 10px 18px 8px; flex-wrap: wrap; }
  h1 { font-size: 17px; margin: 0; }
  .meta { font-size: 12px; color: ${dark ? "#9aa5b3" : "#66707d"}; }
  .seg { display: inline-flex; border: 1px solid ${dark ? "#34383f" : "#d9dee6"}; border-radius: 999px; overflow: hidden; }
  .seg button { border: none; background: transparent; color: ${dark ? "#9aa5b3" : "#66707d"};
    padding: 3px 12px; font-size: 12px; cursor: pointer; }
  .seg button.on { background: color-mix(in srgb, #60a5fa 18%, transparent); color: ${dark ? "#e6e9ef" : "#1b2129"}; font-weight: 650; }
  .main { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 0 14px 10px; }
  #rc-canvas { flex: 1; min-width: 0; border-radius: 12px; cursor: grab; touch-action: none; }
  #rc-canvas.dragging { cursor: grabbing; }
  .side { width: 264px; flex: none; border: 1px solid ${dark ? "#34383f" : "#d9dee6"};
    border-radius: 12px; background: ${dark ? "#1f2229" : "#ffffff"}; padding: 14px; overflow-y: auto; }
  .side .fname { font-size: 11px; color: ${dark ? "#9aa5b3" : "#66707d"}; word-break: break-all; }
  .side h2 { font-size: 15px; margin: 2px 0 8px; word-break: break-all; }
  .side .row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
  .side .row .k { color: ${dark ? "#9aa5b3" : "#66707d"}; }
  .side .sec { margin-top: 12px; padding-top: 8px; border-top: 1px solid ${dark ? "#34383f" : "#e3e6eb"};
    font-size: 12px; }
  .side .sec .hd { font-size: 11px; font-weight: 650; color: ${dark ? "#9aa5b3" : "#66707d"};
    text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
  .side .nb { padding: 1px 0; color: ${dark ? "#c6cdd8" : "#3c4653"}; cursor: pointer; }
  .side .nb:hover { color: #60a5fa; }
  .fi-item { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 6px;
    cursor: pointer; font-size: 12px; }
  .fi-item:hover { background: ${dark ? "#26292f" : "#eef1f6"}; }
  .fi-item .fs { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .fs.hi { background: #ef4444; } .fs.md { background: #f59e0b; } .fs.lo { background: #94a3b8; }
  .legend { display: flex; align-items: center; gap: 14px; padding: 0 18px 10px;
    font-size: 11.5px; color: ${dark ? "#9aa5b3" : "#66707d"}; flex-wrap: wrap; }
  .legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
</style>
</head>
<body>
  <div class="top">
    <h1>${escapeHtml(labels.title)} — ${escapeHtml(projectName)}</h1>
    <span class="meta">${escapeHtml(subtitle)}</span>
    <span class="seg" id="modeSeg">
      <button type="button" class="ms on" data-mode="community">${escapeHtml(labels.byCommunity)}</button>
      <button type="button" class="ms" data-mode="file">${escapeHtml(labels.byFile)}</button>
    </span>
  </div>
  <div class="main">
    <canvas id="rc-canvas"></canvas>
    <aside class="side" id="sideCard"></aside>
  </div>
  <div class="legend">
    <span><span class="dot" style="background:#ef4444"></span>${escapeHtml(labels.legendHigh)}</span>
    <span><span class="dot" style="background:#f59e0b"></span>${escapeHtml(labels.legendMid)}</span>
    <span><span class="dot" style="background:#94a3b8"></span>${escapeHtml(labels.legendLow)}</span>
    <span><span class="dot" style="border:2px dashed ${dark ? "#fbbf24" : "#d97706"};width:6px;height:6px"></span>${escapeHtml(labels.legendSecurity)}</span>
    <span style="opacity:.75">${escapeHtml(labels.hint)}</span>
  </div>
<script>
"use strict";
var D = ${safeJson(payload)};

// ── palette ─────────────────────────────────────────────────────────────
var C = D.dark
  ? { bg: "#17191f", hullA: 0.07, hullS: 0.16, edge: "154,163,179", text: "#c6cdd8", dim: "#9aa5b3",
      sel: "#60a5fa", riskHigh: "#ef6b6b", riskMid: "#f59e0b", riskLow: "#94a3b8" }
  : { bg: "#f6f8fb", hullA: 0.05, hullS: 0.22, edge: "70,80,100", text: "#3c4653", dim: "#66707d",
      sel: "#3b82f6", riskHigh: "#d64545", riskMid: "#d97706", riskLow: "#64748b" };
function riskColor(r) { return r >= 0.66 ? C.riskHigh : r >= 0.33 ? C.riskMid : C.riskLow; }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ── nodes ───────────────────────────────────────────────────────────────
var info = {};   // qn -> node record (canvas + side card)
var nodes = D.nodes.map(function (n, i) {
  var rec = {
    i: i, qn: n.qn, name: n.name, file: n.file, lineStart: n.lineStart, risk: n.risk,
    callers: n.callers, security: n.security, comm: n.comm, coverage: n.coverage,
    top: i < 8, x: 0, y: 0, vx: 0, vy: 0, pinned: false
  };
  info[n.qn] = rec;
  return rec;
});
var adj = {};     // qn -> [{other, weight}]
for (var e of D.edges) {
  if (!info[e.source] || !info[e.target] || e.source === e.target) continue;
  (adj[e.source] = adj[e.source] || []).push({ other: e.target, weight: 1 });
  (adj[e.target] = adj[e.target] || []).push({ other: e.source, weight: 1 });
}
var edges = D.edges.filter(function (e) { return info[e.source] && info[e.target] && e.source !== e.target; });

// ── groups (communities first-class; files as the alternate grouping) ───
var commById = {}; for (var c of D.communities) commById[c.id] = c;
function groupKey(mode, n) { return mode === "community" ? (n.comm != null ? "c" + n.comm : "c-none") : "f" + n.file; }
function groupMeta(mode, key) {
  if (mode === "community" && key.indexOf("c") === 0 && key !== "c-none") {
    var id = Number(key.slice(1)); var cm = commById[id];
    return { hue: cm ? cm.hue : "#818cf8", label: cm ? cm.name : "#" + id };
  }
  return null; // file mode → neutral slate hulls
}

// ── layout: deterministic init + bounded force relaxation ───────────────
var W = 900, H = 620;
function initPositions() {
  var groups = {};
  nodes.forEach(function (n) { var k = groupKey(mode, n); (groups[k] = groups[k] || []).push(n); });
  var keys = Object.keys(groups);
  keys.forEach(function (k, gi) {
    var cx = W / 2 + Math.cos((gi / keys.length) * 6.2832) * W * 0.3;
    var cy = H / 2 + Math.sin((gi / keys.length) * 6.2832) * H * 0.3;
    groups[k].forEach(function (n, j) {
      var a = (j / Math.max(1, groups[k].length)) * 6.2832 + gi;
      n.x = cx + Math.cos(a) * 46 + (j % 3) * 6;
      n.y = cy + Math.sin(a) * 46 + (j % 2) * 6;
      n.vx = 0; n.vy = 0;
    });
  });
}
function tick(alpha) {
  var i, j, a, b, dx, dy, d2, f;
  for (i = 0; i < nodes.length; i++) for (j = i + 1; j < nodes.length; j++) {
    a = nodes[i]; b = nodes[j];
    dx = a.x - b.x; dy = a.y - b.y; d2 = dx * dx + dy * dy;
    if (d2 < 1) d2 = 1;
    if (d2 > 42000) continue;
    f = Math.min(1400 / d2, 5) * alpha;
    dx = (dx / Math.sqrt(d2)) * f; dy = (dy / Math.sqrt(d2)) * f;
    a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
  }
  for (var e of edges) {
    a = info[e.source]; b = info[e.target];
    dx = b.x - a.x; dy = b.y - a.y;
    var d = Math.max(8, Math.hypot(dx, dy));
    f = ((d - 120) / d) * 0.045 * alpha;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  var cx = 0, cy = 0;
  nodes.forEach(function (n) { cx += n.x; cy += n.y; });
  cx /= nodes.length || 1; cy /= nodes.length || 1;
  nodes.forEach(function (n) {
    n.vx += (W / 2 - n.x) * 0.012 * alpha + (cx - n.x) * 0.008 * alpha;
    n.vy += (H / 2 - n.y) * 0.012 * alpha + (cy - n.y) * 0.008 * alpha;
    if (n.pinned) { n.vx = 0; n.vy = 0; return; }
    n.vx *= 0.82; n.vy *= 0.82;
    n.x += Math.max(-14, Math.min(14, n.vx)); n.y += Math.max(-14, Math.min(14, n.vy));
  });
}
var mode = "community";
initPositions();
for (var t = 0; t < 170; t++) tick(1);   // pre-settle: first paint is organized
var relaxFrames = 45;                    // a short eased settle after load

// ── canvas ──────────────────────────────────────────────────────────────
var canvas = document.getElementById("rc-canvas");
var ctx = canvas.getContext("2d");
var view = { x: 0, y: 0, k: 1 };         // pan + zoom
var hover = null, selected = null, dragNode = null, panning = false, panStart = null;

function resize() {
  var r = canvas.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(50, Math.floor(r.width * dpr));
  canvas.height = Math.max(50, Math.floor(r.height * dpr));
  draw();
}
window.addEventListener("resize", resize);

function draw() {
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.width / dpr, h = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);
  ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);

  // group halos — communities (tinted) or files (neutral)
  var groups = {};
  nodes.forEach(function (n) { var k = groupKey(mode, n); (groups[k] = groups[k] || []).push(n); });
  for (var key of Object.keys(groups)) {
    var g = nodes.length ? groups[key] : [];
    if (g.length < 2) continue;
    var cx = 0, cy = 0;
    g.forEach(function (n) { cx += n.x; cy += n.y; });
    cx /= g.length; cy /= g.length;
    var rad = 0;
    g.forEach(function (n) { rad = Math.max(rad, Math.hypot(n.x - cx, n.y - cy)); });
    rad += 34;
    var meta = groupMeta(mode, key);
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832);
    ctx.fillStyle = meta ? hexA(meta.hue, C.hullA) : "rgba(" + C.edge + "," + C.hullA * 0.7 + ")";
    ctx.fill();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = meta ? hexA(meta.hue, C.hullS) : "rgba(" + C.edge + "," + C.hullS + ")";
    ctx.stroke(); ctx.setLineDash([]);
    if (mode === "community" && meta) {
      ctx.fillStyle = hexA(meta.hue, 0.85); ctx.font = "10.5px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(meta.label.slice(0, 26), cx, cy - rad + 12);
    }
  }

  // edges — brighter when either endpoint is hovered/selected; edges that
  // CROSS a community boundary draw violet (the coupling the 社区 view exists
  // to expose).
  var focus = hover || selected;
  for (var e of edges) {
    var a = info[e.source], b = info[e.target];
    var lit = focus && (e.source === focus.qn || e.target === focus.qn);
    var cross =
      mode === "community" && a.comm != null && b.comm != null && a.comm !== b.comm;
    ctx.strokeStyle = lit
      ? "rgba(96,165,250,0.9)"
      : cross
        ? "rgba(167,139,250," + (C.dark ? 0.55 : 0.45) + ")"
        : "rgba(" + C.edge + ",0.22)";
    ctx.lineWidth = lit ? 1.6 : cross ? 1.3 : 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // nodes
  for (var n of nodes) {
    var dimmed = focus && n !== focus && !(adj[focus.qn] || []).some(function (x) { return x.other === n.qn; });
    var r = 5 + Math.min(n.callers, 20) * 0.45 + n.risk * 4;
    ctx.globalAlpha = dimmed ? 0.18 : 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832);
    ctx.fillStyle = riskColor(n.risk); ctx.fill();
    if (n.security) {
      ctx.setLineDash([2.5, 2.5]);
      ctx.strokeStyle = C.dark ? "#fbbf24" : "#d97706"; ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
    }
    if (n === selected || n === hover) {
      ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, 6.2832);
      ctx.strokeStyle = C.sel; ctx.lineWidth = 2; ctx.stroke();
    }
    if (view.k >= 0.85 || n.top) {
      ctx.fillStyle = C.text; ctx.font = "10.5px system-ui, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(n.name.length > 20 ? n.name.slice(0, 19) + "…" : n.name, n.x, n.y + r + 11);
    }
    ctx.globalAlpha = 1;
  }
}
function hexA(hex, a) {
  var v = hex.replace("#", "");
  var r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}

// ── interaction ─────────────────────────────────────────────────────────
function toWorld(ev) {
  var r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left - view.x) / view.k, y: (ev.clientY - r.top - view.y) / view.k };
}
function pick(p) {
  var best = null, bd = 1e9;
  for (var n of nodes) {
    var d = Math.hypot(n.x - p.x, n.y - p.y);
    var r = 5 + Math.min(n.callers, 20) * 0.45 + n.risk * 4 + 5;
    if (d <= r && d < bd) { best = n; bd = d; }
  }
  return best;
}
canvas.addEventListener("mousemove", function (ev) {
  var p = toWorld(ev);
  if (dragNode) { dragNode.x = p.x; dragNode.y = p.y; dragNode.pinned = true; tick(0.5); draw(); return; }
  if (panning) { view.x = panStart.vx + (ev.clientX - panStart.mx); view.y = panStart.vy + (ev.clientY - panStart.my); draw(); return; }
  var hit = pick(p);
  if (hit !== hover) { hover = hit; if (hit) show(hit.qn); draw(); }
});
canvas.addEventListener("mouseleave", function () { if (hover) { hover = null; draw(); } });
canvas.addEventListener("mousedown", function (ev) {
  var p = toWorld(ev);
  var hit = pick(p);
  if (hit) { dragNode = hit; canvas.classList.add("dragging"); }
  else { panning = true; panStart = { mx: ev.clientX, my: ev.clientY, vx: view.x, vy: view.y }; canvas.classList.add("dragging"); }
});
window.addEventListener("mouseup", function () {
  if (dragNode) { dragNode.pinned = false; dragNode = null; }
  panning = false; canvas.classList.remove("dragging");
});
canvas.addEventListener("click", function (ev) {
  var hit = pick(toWorld(ev));
  if (hit) { selected = hit; show(hit.qn); draw(); }
});
canvas.addEventListener("wheel", function (ev) {
  ev.preventDefault();
  var r = canvas.getBoundingClientRect();
  var mx = ev.clientX - r.left, my = ev.clientY - r.top;
  var factor = Math.exp(-ev.deltaY * 0.0012);
  var nk = Math.max(0.35, Math.min(3.2, view.k * factor));
  view.x = mx - ((mx - view.x) / view.k) * nk;
  view.y = my - ((my - view.y) / view.k) * nk;
  view.k = nk; draw();
}, { passive: false });
canvas.addEventListener("dblclick", function (ev) {
  if (!pick(toWorld(ev))) { fitView(); draw(); }
});
function fitView() {
  var r = canvas.getBoundingClientRect();
  var xs = nodes.map(function (n) { return n.x; }), ys = nodes.map(function (n) { return n.y; });
  var minX = Math.min.apply(null, xs) - 60, maxX = Math.max.apply(null, xs) + 60;
  var minY = Math.min.apply(null, ys) - 60, maxY = Math.max.apply(null, ys) + 60;
  view.k = Math.max(0.35, Math.min(2.4, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
  view.x = (r.width - (minX + maxX) * view.k) / 2;
  view.y = (r.height - (minY + maxY) * view.k) / 2;
}

// ── side card ───────────────────────────────────────────────────────────
var L = D.labels;
var opinions = {};
for (var o of D.opinions) opinions[o.qn] = o.list;
function show(qn) {
  var n = info[qn]; if (!n) return;
  var cm = n.comm != null ? commById[n.comm] : null;
  var nb = (adj[qn] || []).slice(0, 8);
  var ops = opinions[qn] || [];
  var html = '<div class="fname">' + esc(n.file) + ":" + n.lineStart + "</div>" +
    "<h2>" + esc(n.name) + "</h2>" +
    '<div class="row"><span class="k">' + esc(L.score) + '</span><span>' + n.risk.toFixed(2) + "</span></div>" +
    '<div class="row"><span class="k">' + esc(L.callers) + '</span><span>' + n.callers + "</span></div>" +
    '<div class="row"><span class="k">' + esc(L.coverage) + '</span><span>' + esc(n.coverage) + "</span></div>" +
    '<div class="row"><span class="k">' + esc(L.security) + '</span><span>' + (n.security ? "✓" : "—") + "</span></div>" +
    '<div class="row"><span class="k">' + esc(L.community) + '</span><span>' + esc(cm ? cm.name : L.noCommunity) + "</span></div>" +
    '<div class="sec"><div class="hd">' + esc(L.neighbors) + "</div>";
  for (var x of nb) html += '<div class="nb" data-q="' + esc(x.other) + '">' + esc((info[x.other] || {}).name || x.other) + "</div>";
  html += "</div>" + '<div class="sec"><div class="hd">' + esc(L.related) + "</div>";
  if (ops.length === 0) html += '<div style="opacity:.6">' + esc(L.relatedNone) + "</div>";
  for (var op of ops) {
    html += '<div class="fi-item" data-fi="' + op.findex + '"><span class="fs ' + op.sev + '"></span><span>' + esc(op.label) + "</span></div>";
  }
  html += "</div>";
  if (ops.length > 0) html += '<div style="margin-top:8px;font-size:11px;opacity:.6">' + esc(L.jumpBack) + "</div>";
  document.getElementById("sideCard").innerHTML = html;
  document.querySelectorAll(".side .nb").forEach(function (el) {
    el.addEventListener("click", function () { show(el.getAttribute("data-q")); centerOn(el.getAttribute("data-q")); });
  });
  document.querySelectorAll(".fi-item").forEach(function (el) {
    el.addEventListener("click", function () {
      try { parent.postMessage({ type: "crg:locate-finding", findex: Number(el.getAttribute("data-fi")) }, "*"); }
      catch (err) { /* sandboxed or detached — side card only */ }
    });
  });
}
function centerOn(qn) {
  var n = info[qn]; if (!n) return;
  var r = canvas.getBoundingClientRect();
  view.x = r.width / 2 - n.x * view.k;
  view.y = r.height / 2 - n.y * view.k;
  draw();
}

// group toggle
document.getElementById("modeSeg").addEventListener("click", function (ev) {
  var item = ev.target.closest(".ms"); if (!item) return;
  document.querySelectorAll("#modeSeg .ms").forEach(function (m) { m.classList.toggle("on", m === item); });
  mode = item.getAttribute("data-mode");
  initPositions();
  for (var t = 0; t < 170; t++) tick(1);
  relaxFrames = 45;
  fitView(); draw();
});

// external locate: the report's chip asks this page to select a node
window.addEventListener("message", function (e) {
  if (e.source !== window.parent) return;   // only the embedding window
  var d = e.data;
  if (!d || d.type !== "crg:select-node" || typeof d.qn !== "string") return;
  if (info[d.qn]) { selected = info[d.qn]; show(d.qn); centerOn(d.qn); draw(); }
});

// ── boot: resize → fit → short eased settle loop ────────────────────────
resize();
fitView();
selected = info[D.topQn] || null; if (selected) show(selected.qn);
(function frame() {
  if (relaxFrames > 0) {
    relaxFrames--; tick(1 - relaxFrames / 60);
    draw();
    requestAnimationFrame(frame);
  }
})();
</script>
</body>
</html>`;
}
