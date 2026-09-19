/**
 * SpecsPanel — read-only view over the workspace's spec domain
 * `.deeporca/specs/` (specs/spec-graph-adoption §1.4). Shares the SAME core
 * read model (getSpecGraph) the agent guidance points at — one source, so
 * the UI view and the agent view cannot drift.
 *
 * Layout: design chains first (product-design → architecture), then
 * independent nodes (no upstream — legal per design 拍板⑦, rendered as their
 * own entries, never folded into a chain). Status + drift badges are
 * mechanical signals straight from the wire payload.
 */

import { useEffect, useState, type JSX } from "react";

import type { SpecNode } from "@deeporca/core";

import { api } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

type DriftState = "stale" | "unimplemented" | "ahead" | "unknown";

const DRIFT_KEY: Record<DriftState, MessageKey> = {
  stale: "specs.drift.stale",
  unimplemented: "specs.drift.unimplemented",
  ahead: "specs.drift.ahead",
  unknown: "specs.drift.snapshotMissing",
};

const KNOWN_STATUSES = new Set(["draft", "active", "done", "stalled"]);

function worstDrift(node: SpecNode): DriftState | null {
  const priority: DriftState[] = ["stale", "unimplemented", "ahead", "unknown"];
  for (const state of priority) {
    if (node.drift.some((d) => d.state === state)) return state;
  }
  return null;
}

function NodeRow({
  node,
  onOpen,
  t,
}: {
  node: SpecNode;
  onOpen: (relPath: string) => void;
  t: (k: MessageKey) => string;
}): JSX.Element {
  const drift = worstDrift(node);
  return (
    <button type="button" className="ui-specs-node" onClick={() => onOpen(node.relPath)} title={node.relPath}>
      <span className={`ui-specs-status ui-specs-status-${node.status}`}>
        {KNOWN_STATUSES.has(node.status) ? t(`specs.status.${node.status}` as MessageKey) : node.status}
      </span>
      <span className="ui-specs-node-title">{node.title}</span>
      <span className="ui-specs-node-type">{node.type}</span>
      {drift ? (
        <span
          className={`ui-specs-drift ui-specs-drift-${drift}`}
          title={node.drift.map((d) => d.detail ?? d.state).join(" · ")}
        >
          {t(DRIFT_KEY[drift])}
        </span>
      ) : null}
    </button>
  );
}

export function SpecsPanel({ root }: { root: string }): JSX.Element {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<SpecNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNodes(null);
    void api.specsGraph(root).then((graph) => {
      if (!cancelled) setNodes(graph.nodes);
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const openNode = (relPath: string): void => {
    void api.specsOpen(root, relPath);
  };

  if (!root) {
    return <div className="ui-specs">{<div className="ui-side-panel-empty">{t("specs.empty")}</div>}</div>;
  }

  const designs = nodes?.filter((n) => n.type === "product-design" || n.type === "design") ?? [];
  const chains = designs
    .map((design) => ({
      design,
      children: nodes?.filter((n) => n.parent === design.id && n.id !== design.id) ?? [],
    }))
    .filter((chain) => chain.design || chain.children.length > 0);
  const linkedIds = new Set(chains.flatMap((c) => [c.design.id, ...c.children.map((n) => n.id)]));
  const independent = nodes?.filter((n) => !linkedIds.has(n.id)) ?? [];

  return (
    <div className="ui-specs">
      {nodes === null ? (
        <div className="ui-side-panel-empty">{t("specs.loading")}</div>
      ) : nodes.length === 0 ? (
        <div className="ui-side-panel-empty">
          {t("specs.empty")}
          <div className="ui-specs-empty-hint">{t("specs.emptyHint")}</div>
        </div>
      ) : (
        <>
          {chains.length > 0 ? <div className="ui-specs-section">{t("specs.chainSection")}</div> : null}
          {chains.map((chain) => (
            <div key={chain.design.id} className="ui-specs-chain">
              <NodeRow node={chain.design} onOpen={openNode} t={t} />
              <div className="ui-specs-chain-children">
                {chain.children.map((child) => (
                  <NodeRow key={child.id} node={child} onOpen={openNode} t={t} />
                ))}
              </div>
            </div>
          ))}
          {independent.length > 0 ? <div className="ui-specs-section">{t("specs.independentSection")}</div> : null}
          {independent.map((node) => (
            <NodeRow key={node.id} node={node} onOpen={openNode} t={t} />
          ))}
        </>
      )}
    </div>
  );
}
