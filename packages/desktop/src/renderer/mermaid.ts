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

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

async function ensureMermaid(): Promise<MermaidApi> {
  if (mermaidApi) return mermaidApi;
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = (async () => {
      const mod = await import("mermaid");
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        fontFamily: "inherit",
        flowchart: {
          htmlLabels: true,
          curve: "basis",
        },
        themeVariables: {
          background: "transparent",
          fontFamily: "inherit",
          // Nodes follow the active app theme (token → resolved color).
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
        },
      });
      mermaidApi = mermaid;
      return mermaid;
    })();
  }
  return mermaidLoadPromise;
}

/** Render one chart definition to an SVG string. Serialized: never parallel. */
export function renderMermaidSvg(chart: string): Promise<string> {
  const job = renderQueue.then(async () => {
    const mermaid = await ensureMermaid();
    const { svg } = await mermaid.render(`mermaid-diagram-${++diagramCounter}`, chart);
    return svg;
  });
  // Keep the queue alive across failures; the caller sees the rejection.
  renderQueue = job.catch(() => undefined);
  return job;
}

/** Test hook: whether the dynamic import + init has completed. */
export function isMermaidLoaded(): boolean {
  return mermaidApi != null;
}
