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

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, chart: string) => Promise<{ svg: string }>;
};

let mermaidApi: MermaidApi | null = null;
let mermaidLoadPromise: Promise<MermaidApi> | null = null;
let diagramCounter = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

/** Appearance mermaid.initialize() last ran with (token values lock at init). */
let configuredAppearance = "";

/** Node/cluster hue ramp length — mirrors --ui-diagram-hue-0..7 in ui.css. */
const HUE_COUNT = 8;
/** Injected stylesheet id — the paint side of the do-hue-* classes. */
const HUE_STYLE_ID = "deeporca-mermaid-hues";

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function currentAppearance(): string {
  if (typeof document === "undefined") return "";
  return document.documentElement.getAttribute("data-appearance") ?? "";
}

function configureMermaid(mermaid: MermaidApi): void {
  configuredAppearance = currentAppearance();
  const hue = (i: number, fallback: string): string => cssVar(`--ui-diagram-hue-${i}`, fallback);
  const cScale: Record<string, string> = {};
  const pie: Record<string, string> = {};
  for (let i = 0; i < HUE_COUNT; i++) {
    cScale[`cScale${i}`] = hue(i, "#60a5fa");
    cScale[`cScaleLabel${i}`] = cssVar("--ui-text", "#1b2129");
    pie[`pie${i + 1}`] = hue(i, "#60a5fa");
  }
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    fontFamily: "inherit",
    flowchart: {
      htmlLabels: true,
      curve: "basis",
      // Generous layout — arch maps should read like posters, not terminal
      // output: air between ranks/nodes and a real margin around the canvas.
      diagramPadding: 20,
      nodeSpacing: 64,
      rankSpacing: 84,
    },
    themeVariables: {
      background: "transparent",
      fontFamily: "inherit",
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

    // Flowchart / class / state nodes — one hue each, in document order.
    let hue = 0;
    root.querySelectorAll("g.node, g.statediagram-state").forEach((el) => {
      el.classList.add("do-node", `do-hue-${hue % HUE_COUNT}`);
      hue++;
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
    // themeVariables lock at init — re-resolve them when the appearance has
    // flipped since (the do-hue paints are var()-live; this refreshes the
    // mermaid-native edges/labels that are not covered by the decorate pass).
    if (configuredAppearance !== currentAppearance()) configureMermaid(mermaid);
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
