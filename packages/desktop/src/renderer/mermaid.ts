/**
 * Mermaid loader + SVG renderer shared by MermaidDiagram and StreamdownView's
 * MermaidBlock renderer.
 *
 * mermaid is imported DYNAMICALLY so it only loads when a diagram actually
 * renders — it is a ~1MB dependency and must stay out of the initial bundle
 * chunk. The library is a bundled npm dependency (never CDN — the CSP in
 * index.html forbids remote scripts). Rendered SVGs are self-contained
 * (inline styles only, securityLevel "strict"), so they comply with the CSP.
 *
 * Theme: "base" + themeVariables resolved from the app's `--ui-*` tokens at
 * init time, so diagrams follow the ACTIVE theme (light or dark) instead of
 * mermaid's light-oriented default palette. Colors are locked in at first
 * render; a theme switch re-tints on the next content reload.
 *
 * Color: LLM-generated charts rarely carry classDefs, so a flat theme paints
 * every node the same color. After mermaid renders, decorateMermaidSvg()
 * post-processes the SVG — nodes / clusters / sequence actors are tagged with
 * do-hue-N classes cycling the app's --ui-diagram-hue-* ramp, and a companion
 * stylesheet (injected once into <head>) fills them via color-mix() on those
 * vars. Because the fills are var()-driven they re-tint LIVE on appearance
 * switches, without re-rendering.
 *
 * Concurrency: mermaid.render is NOT safe to call in parallel (shared
 * internal state + one scratch element). Pages can carry several diagrams
 * (wiki pages, arch maps), so renders are SERIALIZED through a queue —
 * parallel calls used to make random diagrams throw and fall back to source.
 */

import { useSyncExternalStore } from "react";

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, chart: string) => Promise<{ svg: string }>;
};

let mermaidApi: MermaidApi | null = null;
let mermaidLoadPromise: Promise<MermaidApi> | null = null;
let diagramCounter = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

/** Skin identity mermaid.initialize() last ran with (token values lock at init):
 *  appearance + active theme stylesheet + line variant. Any of these changing
 *  native mermaid colors (edge-label rects, pie/gantt fills) means the locked
 *  themeVariables are stale and initialize() must run again. */
let configuredSkin = "";

/** Skin change notification — see the watcher below. */
let skinVersion = 0;
const skinListeners = new Set<() => void>();

function currentSkin(): string {
  if (typeof document === "undefined") return "";
  const de = document.documentElement;
  const themeHref = document.getElementById("deeporca-theme-css")?.getAttribute("href") ?? "";
  return `${de.getAttribute("data-appearance") ?? ""}|${themeHref}|${de.dataset.lineVariant ?? ""}`;
}

function notifySkinChange(): void {
  skinVersion++;
  for (const fn of skinListeners) fn();
}

// Watch every axis of the skin. Appearance and the line variant are data
// attributes on <html> (synchronous CSS-var overrides). Themes swap the
// #deeporca-theme-css <link> href — the vars only reflect the new sheet once
// it LOADS, so the `load` event (not the href mutation) is the notify point;
// the head childList observer re-arms when the link appears at boot.
if (typeof document !== "undefined") {
  const attrObserver = new MutationObserver(() => notifySkinChange());
  attrObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-appearance", "data-line-variant"],
  });
  const armLinkWatcher = (): void => {
    const link = document.getElementById("deeporca-theme-css");
    if (!link || link.dataset.mermaidSkinWatched === "1") return;
    link.dataset.mermaidSkinWatched = "1";
    link.addEventListener("load", notifySkinChange);
  };
  armLinkWatcher();
  new MutationObserver(armLinkWatcher).observe(document.head, { childList: true, subtree: false });
}

/** React hook: re-render the caller whenever the skin flips (theme, light/dark,
 *  line variant). MermaidDiagram keys its render effect on this so mounted
 *  diagrams repaint instead of keeping the previous skin's native colors. */
export function useMermaidSkinVersion(): number {
  return useSyncExternalStore(
    (onChange) => {
      skinListeners.add(onChange);
      return () => {
        skinListeners.delete(onChange);
      };
    },
    () => skinVersion
  );
}

/** Node/cluster hue ramp length — mirrors --ui-diagram-hue-0..7 in ui.css. */
const HUE_COUNT = 8;
/** Injected stylesheet id — the paint side of the do-hue-* classes. */
const HUE_STYLE_ID = "deeporca-mermaid-hues";
/**
 * Semantic component kinds (fixed hue per kind, suite-wide legend — design
 * system adopted from Cocoon-AI/architecture-diagram-generator, MIT). The
 * arch-scan skill tags nodes with these via mermaid `class`/`classDef`; the
 * kind→hue mapping lives in the injected stylesheet.
 */
const SEMANTIC_KINDS = ["entry", "store", "frontend", "backend", "bus", "cloud", "external", "concern"] as const;

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function configureMermaid(mermaid: MermaidApi): void {
  configuredSkin = currentSkin();
  const hue = (i: number, fallback: string): string => cssVar(`--ui-diagram-hue-${i}`, fallback);
  const cScale: Record<string, string> = {};
  const pie: Record<string, string> = {};
  // mermaid's pie chart addresses pie1..pie12 and mindmap branches can index
  // cScale past 8 — cycle the 8-hue ramp so entries beyond the ramp still
  // follow the theme instead of dropping to mermaid's light-only defaults.
  const paletteSlots = Math.max(HUE_COUNT, 12);
  for (let i = 0; i < paletteSlots; i++) {
    cScale[`cScale${i}`] = hue(i % HUE_COUNT, "#60a5fa");
    cScale[`cScaleLabel${i}`] = cssVar("--ui-text", "#1b2129");
    pie[`pie${i + 1}`] = hue(i % HUE_COUNT, "#60a5fa");
  }
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    fontFamily: "inherit",
    // Source-size lever (real-machine feedback: node-sparse charts like the
    // dataflow map render tiny at mermaid's default 16px — labels are
    // measured at this size at layout time, so nodes and spacing grow with
    // it; the fit-in-card pass then only needs to close the remainder).
    fontSize: 18,
    flowchart: {
      htmlLabels: true,
      curve: "basis",
      // Balanced layout (real-machine feedback: 64/84 spacing made sparse
      // charts sprawl — "why does it spread out by itself?"). Compact
      // spacing keeps few-node charts tight; the fit-in-card pass scales
      // them up for readability instead of relying on layout air.
      diagramPadding: 14,
      nodeSpacing: 44,
      rankSpacing: 58,
    },
    themeVariables: {
      background: "transparent",
      fontFamily: "inherit",
      fontSize: "18px",
      // Nodes follow the active app theme (token → resolved color). The
      // decorate pass below re-paints flowchart/class/state/sequence shapes
      // with the hue ramp; these cover everything it doesn't reach.
      primaryColor: cssVar("--ui-surface", "#ffffff"),
      primaryTextColor: cssVar("--ui-text", "#1b2129"),
      primaryBorderColor: cssVar("--ui-border", "#9aa7b6"),
      secondaryColor: cssVar("--ui-surface-sunken", "#eef1f6"),
      secondaryTextColor: cssVar("--ui-text", "#1b2129"),
      secondaryBorderColor: cssVar("--ui-border", "#9aa7b6"),
      tertiaryColor: cssVar("--ui-surface-sunken", "#eef1f6"),
      tertiaryTextColor: cssVar("--ui-text", "#1b2129"),
      tertiaryBorderColor: cssVar("--ui-border", "#9aa7b6"),
      // Cluster (subgraph) fill: sunken so grouping stays visible.
      clusterBkg: cssVar("--ui-surface-sunken", "#eef1f6"),
      clusterBorder: cssVar("--ui-border-soft", "#c3cdd9"),
      // Edges and edge labels.
      lineColor: cssVar("--ui-border", "#9aa7b6"),
      edgeLabelBackground: cssVar("--ui-surface", "#ffffff"),
      // Global text (sequence/state titles, notes).
      textColor: cssVar("--ui-text", "#1b2129"),
      noteBkgColor: cssVar("--ui-surface-sunken", "#eef1f6"),
      noteTextColor: cssVar("--ui-text-dim", "#55606d"),
      noteBorderColor: cssVar("--ui-border-soft", "#c3cdd9"),
      // Sequence diagrams.
      actorBkg: cssVar("--ui-surface", "#ffffff"),
      actorBorder: cssVar("--ui-border", "#9aa7b6"),
      actorTextColor: cssVar("--ui-text", "#1b2129"),
      actorLineColor: cssVar("--ui-border-soft", "#c3cdd9"),
      signalColor: cssVar("--ui-text", "#1b2129"),
      signalTextColor: cssVar("--ui-text", "#1b2129"),
      labelBoxBkgColor: cssVar("--ui-surface", "#ffffff"),
      labelBoxBorderColor: cssVar("--ui-border", "#9aa7b6"),
      labelTextColor: cssVar("--ui-text", "#1b2129"),
      loopTextColor: cssVar("--ui-text-dim", "#55606d"),
      // State diagrams.
      altBackground: cssVar("--ui-surface-sunken", "#eef1f6"),
      // Accent (hover/active-ish accents keep the app hue).
      accentColor: cssVar("--ui-accent", "#1c6fe0"),
      // Pie / timeline / xychart ramps cycle the diagram hues.
      ...cScale,
      ...pie,
    },
  });
}

async function ensureMermaid(): Promise<MermaidApi> {
  if (mermaidApi) return mermaidApi;
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = (async () => {
      const mod = await import("mermaid");
      const mermaid = mod.default;
      configureMermaid(mermaid);
      mermaidApi = mermaid;
      return mermaid;
    })();
  }
  return mermaidLoadPromise;
}

/**
 * The paint rules for decorated diagrams. One <style> in <head>, written once:
 * every value is a color-mix()/var() expression against the live tokens, so
 * light/dark and theme switches re-tint already-rendered SVGs for free.
 * !important is required — mermaid locks its palette into per-element inline
 * styles, and only important author rules beat inline styles.
 */
function ensureHueStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(HUE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HUE_STYLE_ID;
  const rules: string[] = [];
  // DIRECT-CHILD selectors are load-bearing: cluster <g>s WRAP node <g>s, so a
  // descendant rule like `.do-cluster.do-hue-N rect` (0,2,1) would out-rank the
  // node rule `.do-hue-N rect` (0,1,1) under !important and repaint every node
  // inside a subgraph with the cluster tint — exactly the diagrams (arch maps
  // with subgraphs) this palette exists for.
  for (let i = 0; i < HUE_COUNT; i++) {
    const hue = `var(--ui-diagram-hue-${i}, #60a5fa)`;
    rules.push(`
.do-hue-${i} > rect, .do-hue-${i} > polygon, .do-hue-${i} > circle, .do-hue-${i} > ellipse, .do-hue-${i} > path {
  fill: color-mix(in srgb, ${hue} 14%, var(--ui-surface, #fff)) !important;
  stroke: ${hue} !important;
  stroke-width: 1.5px !important;
}
.do-hue-${i} text { fill: var(--ui-text, #1b2129) !important; }
.do-hue-${i} span.nodeLabel, .do-hue-${i} span.edgeLabel, .do-hue-${i} div, .do-hue-${i} p {
  color: var(--ui-text, #1b2129) !important;
}`);
  }
  // Subgraph/cluster frames: faint tint of the same ramp + dashed rail. Only
  // the cluster's OWN shape (direct child) — nodes inside keep their hues.
  for (let i = 0; i < HUE_COUNT; i++) {
    const hue = `var(--ui-diagram-hue-${i}, #60a5fa)`;
    rules.push(`
.do-cluster.do-hue-${i} > rect, .do-cluster.do-hue-${i} > polygon {
  fill: color-mix(in srgb, ${hue} 5%, var(--ui-surface-sunken, #eef1f6)) !important;
  stroke: color-mix(in srgb, ${hue} 42%, transparent) !important;
  stroke-width: 1.2px !important;
  stroke-dasharray: 7 5 !important;
}`);
  }
  // Semantic kinds — FIXED hue per component type, so the same kind reads
  // the same color across every diagram in a suite (one legend everywhere).
  // entry=blue bold, frontend=cyan, backend=teal, store=violet, bus=amber,
  // cloud=indigo, external=neutral dashed, concern=rose.
  const KIND_RULES: Array<[string, string]> = [
    ["entry", "var(--ui-diagram-hue-0, #60a5fa)"],
    ["frontend", "var(--ui-diagram-hue-5, #22d3ee)"],
    ["backend", "var(--ui-diagram-hue-2, #2dd4bf)"],
    ["store", "var(--ui-diagram-hue-1, #a78bfa)"],
    ["bus", "var(--ui-diagram-hue-3, #fbbf24)"],
    ["cloud", "var(--ui-diagram-hue-6, #818cf8)"],
    ["concern", "var(--ui-diagram-hue-4, #fb7185)"],
  ];
  for (const [kind, hue] of KIND_RULES) {
    rules.push(`
.do-kind-${kind} > rect, .do-kind-${kind} > polygon, .do-kind-${kind} > circle, .do-kind-${kind} > ellipse, .do-kind-${kind} > path {
  fill: color-mix(in srgb, ${hue} 14%, var(--ui-surface, #fff)) !important;
  stroke: ${hue} !important;
  stroke-width: ${kind === "entry" ? "2.2px" : "1.5px"} !important;
}`);
  }
  rules.push(`
.do-kind-external > rect, .do-kind-external > polygon, .do-kind-external > circle, .do-kind-external > ellipse, .do-kind-external > path {
  fill: color-mix(in srgb, var(--ui-text, #1b2129) 5%, var(--ui-surface, #fff)) !important;
  stroke: color-mix(in srgb, var(--ui-text, #1b2129) 48%, transparent) !important;
  stroke-width: 1.2px !important;
  stroke-dasharray: 4 3 !important;
}`);
  // Edge ink + arrowheads: quiet neutral so the node colors carry the show.
  rules.push(`
g.edgePaths path, g.edgePath path, path.flowchart-link, path.flowchart-v2-link {
  stroke: color-mix(in srgb, var(--ui-text, #1b2129) 40%, transparent) !important;
}
.ui-mermaid-container marker path {
  fill: color-mix(in srgb, var(--ui-text, #1b2129) 40%, transparent) !important;
  stroke: none !important;
}`);
  style.textContent = rules.join("\n");
  document.head.appendChild(style);
}

/**
 * Post-process a rendered mermaid SVG string: tag the colorable groups with
 * hue classes so the injected stylesheet can paint them. Purely additive —
 * on any parse/serialize failure the original SVG is returned untouched.
 */
export function decorateMermaidSvg(svg: string): string {
  if (typeof DOMParser === "undefined") return svg;
  ensureHueStyles();
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.getElementsByTagName("parsererror").length > 0) return svg;

    // Semantic-kind paint (design system adopted from Cocoon-AI's
    // architecture-diagram-generator, MIT): when the chart's classDefs tag a
    // node with a known kind (entry/store/frontend/backend/bus/cloud/
    // external/concern), it gets that kind's FIXED hue — the same component
    // type reads the same color across every diagram in the suite (one
    // legend for the whole document). Untagged nodes fall back to the
    // document-order hue cycle.
    const kindOf = (el: Element): string | null => {
      for (const kind of SEMANTIC_KINDS) {
        if (el.classList.contains(kind)) return kind;
      }
      return null;
    };
    // Flowchart / class / state nodes.
    let hue = 0;
    root.querySelectorAll("g.node, g.statediagram-state").forEach((el) => {
      const kind = kindOf(el);
      el.classList.add("do-node", kind ? `do-kind-${kind}` : `do-hue-${hue % HUE_COUNT}`);
      if (!kind) hue++;
    });
    // Subgraph frames cycle the ramp independently.
    let clusterHue = 0;
    root.querySelectorAll("g.cluster").forEach((el) => {
      el.classList.add("do-cluster", `do-hue-${clusterHue % HUE_COUNT}`);
      clusterHue++;
    });
    // Sequence-diagram actors.
    let actorHue = 0;
    root.querySelectorAll("g.actor, g.actor-man").forEach((el) => {
      el.classList.add("do-node", `do-hue-${actorHue % HUE_COUNT}`);
      actorHue++;
    });
    return new XMLSerializer().serializeToString(root);
  } catch {
    return svg;
  }
}

/** Render one chart definition to an SVG string. Serialized: never parallel. */
export function renderMermaidSvg(chart: string): Promise<string> {
  const job = renderQueue.then(async () => {
    const mermaid = await ensureMermaid();
    // themeVariables lock at init — re-resolve them when the skin has changed
    // since (appearance flip, theme swap, or line variant). The do-hue paints
    // are var()-live; this refreshes the mermaid-native edges/labels/pie
    // fills that the decorate pass does not cover.
    if (configuredSkin !== currentSkin()) configureMermaid(mermaid);
    const { svg } = await mermaid.render(`mermaid-diagram-${++diagramCounter}`, chart);
    return decorateMermaidSvg(svg);
  });
  // Keep the queue alive across failures; the caller sees the rejection.
  renderQueue = job.catch(() => undefined);
  return job;
}

/** Test hook: whether the dynamic import + init has completed. */
export function isMermaidLoaded(): boolean {
  return mermaidApi != null;
}
