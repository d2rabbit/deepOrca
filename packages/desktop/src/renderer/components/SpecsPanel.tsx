/**
 * SpecsPanel — read-only view over the workspace's spec domain
 * `.deeporca/specs/` (specs/spec-graph-adoption §1.4). Shares the SAME core
 * read model (getSpecGraph) the agent guidance points at — one source, so
 * the UI view and the agent view cannot drift.
 *
 * Layout: design chains first — a chain root is a product-design/design node
 * WITHOUT a parent, and its children are whatever names that id as `parent`
 * (architecture, tasks, …); every other node is independent (legal per
 * design 拍板⑦, rendered as its own entry, never folded into a chain).
 *
 * Drift findings arrive STRUCTURED (gate + state + optional count) from
 * core — this panel owns the localized wording, so no core-authored string
 * can leak one language into the six-locale UI (2026-09-19 review).
 */

import { useEffect, useRef, useState, type JSX } from "react";

// SPEC_NODE_STATUSES is a runtime const in core, but this panel only uses it
// in type position (typeof → status union) — hence the type-only import.
import type {
  SPEC_NODE_STATUSES,
  SpecDriftFinding,
  SpecDriftGate,
  SpecDriftState,
  SpecIssue,
  SpecNode,
} from "@deeporca/core";

import { api } from "../api";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";

type DriftState = Exclude<SpecDriftState, "ok">;
type NodeStatus = (typeof SPEC_NODE_STATUSES)[number];

const DRIFT_TEXT: Record<SpecDriftGate, Record<DriftState, MessageKey>> = {
  chain: {
    stale: "specs.drift.stale",
    // Gate A "unknown" = dangling parent link — NOT a missing snapshot.
    unknown: "specs.drift.needsReview",
    unimplemented: "specs.drift.needsReview",
    ahead: "specs.drift.needsReview",
  },
  implementation: {
    unimplemented: "specs.drift.unimplemented",
    ahead: "specs.drift.ahead",
    stale: "specs.drift.needsReview",
    unknown: "specs.drift.needsReview",
  },
  knowledge: {
    stale: "specs.drift.snapshotStale",
    unknown: "specs.drift.snapshotMissing",
    unimplemented: "specs.drift.needsReview",
    ahead: "specs.drift.needsReview",
  },
};

const STATUS_TEXT: Record<NodeStatus, MessageKey> = {
  draft: "specs.status.draft",
  active: "specs.status.active",
  done: "specs.status.done",
  stalled: "specs.status.stalled",
};

/** Structure-check codes (core validateSpecs) → localized templates. The
 *  core `message` is developer prose and never rendered here (2026-09 swarm
 *  review M1 closure — design.md 呈现: the panel surfaces the issue detail). */
const ISSUE_TEXT: Record<string, MessageKey> = {
  "duplicate-id": "specs.issue.duplicateId",
  "unknown-type": "specs.issue.unknownType",
  "unknown-status": "specs.issue.unknownStatus",
  "dangling-link": "specs.issue.danglingLink",
  "independent-architecture": "specs.issue.independentArchitecture",
  "architecture-parent-not-product-design": "specs.issue.archParentNotProductDesign",
  "chain-half": "specs.issue.chainHalf",
  "tasks-parent": "specs.issue.tasksParentMismatch",
  "artifact-escapes-root": "specs.issue.artifactEscapesRoot",
  "loose-file": "specs.issue.looseFile",
};

function issueLabel(issue: SpecIssue, t: (k: MessageKey, params?: Record<string, string>) => string): string {
  if (issue.code === "tasks-parent" && !issue.data?.parent) return t("specs.issue.tasksNoParent");
  const key = ISSUE_TEXT[issue.code];
  return key ? t(key, issue.data) : issue.code;
}

function statusLabel(status: string, t: (k: MessageKey) => string): string {
  const key = (STATUS_TEXT as Record<string, MessageKey | undefined>)[status];
  return key ? t(key) : status;
}

function driftPriority(finding: SpecDriftFinding): number {
  const order: DriftState[] = ["stale", "unimplemented", "ahead", "unknown"];
  return order.indexOf(finding.state as DriftState);
}

function driftLabel(finding: SpecDriftFinding, t: (k: MessageKey) => string): string {
  const base = t(DRIFT_TEXT[finding.gate][finding.state as DriftState]);
  return finding.count !== undefined ? `${base} ×${finding.count}` : base;
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
  // "ok" findings carry no user signal — a healthy gate must never win the
  // worst-slot (2026-09-19 swarm review: "ok" sorted first and both drew a
  // bogus empty badge on healthy nodes AND masked real drift on mixed ones).
  const findings = node.drift.filter((finding) => finding.state !== "ok");
  const worst = [...findings].sort((a, b) => driftPriority(a) - driftPriority(b))[0];
  return (
    <button type="button" className="ui-specs-node" onClick={() => onOpen(node.relPath)} title={node.relPath}>
      <span className={`ui-specs-status ui-specs-status-${node.status}`}>{statusLabel(node.status, t)}</span>
      <span className="ui-specs-node-title">{node.title}</span>
      <span className="ui-specs-node-type">{node.type}</span>
      {worst ? (
        <span
          className={`ui-specs-drift ui-specs-drift-${worst.state}`}
          title={findings.map((finding) => driftLabel(finding, t)).join(" · ")}
        >
          {driftLabel(worst, t)}
        </span>
      ) : null}
    </button>
  );
}

export function SpecsPanel({ root }: { root: string }): JSX.Element {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<SpecNode[] | null>(null);
  const [issues, setIssues] = useState<SpecIssue[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  // Tracks the CURRENT root for openNode's async guard (a slow specsOpen from
  // a previous workspace must not paint its failure banner here).
  const rootRef = useRef(root);
  rootRef.current = root;

  useEffect(() => {
    let cancelled = false;
    setNodes(null);
    setIssues([]);
    // A stale open-failure banner from the previous root must not survive
    // the switch (2026-09 iter-2 review).
    setOpenError(null);
    void api.specsGraph(root).then((graph) => {
      if (!cancelled) {
        setNodes(graph.nodes);
        setIssues(graph.issues ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const openNode = (relPath: string): void => {
    setOpenError(null);
    const openRoot = root;
    void api.specsOpen(openRoot, relPath).then((res) => {
      // Surface instead of a silent no-op (2026-09-19 swarm review): refusal
      // (unregistered root / containment) and real OS-open failures were both
      // invisible — a node click just did nothing. Root guard: a slow open
      // from a previous workspace must not paint its failure here.
      if (!res.ok && openRoot === rootRef.current) setOpenError(res.error ?? "unknown error");
    });
  };

  if (!root) {
    return (
      <div className="ui-specs">
        <div className="ui-side-panel-empty">{t("specs.empty")}</div>
      </div>
    );
  }

  const list = nodes ?? [];
  const childrenByParent = new Map<string, SpecNode[]>();
  for (const node of list) {
    if (!node.parent) continue;
    const bucket = childrenByParent.get(node.parent);
    if (bucket) bucket.push(node);
    else childrenByParent.set(node.parent, [node]);
  }
  // Chain roots: design-side nodes without an upstream. Their children are
  // whatever names the root id as `parent` (architecture, tasks, …).
  const chainRoots = list.filter((node) => (node.type === "product-design" || node.type === "design") && !node.parent);
  const linkedIds = new Set<string>();
  for (const chainRoot of chainRoots) {
    linkedIds.add(chainRoot.id);
    for (const child of childrenByParent.get(chainRoot.id) ?? []) linkedIds.add(child.id);
  }
  const independent = list.filter((node) => !linkedIds.has(node.id));

  return (
    <div className="ui-specs">
      {openError !== null ? (
        <div className="ui-specs-open-error">
          {t("specs.openFailed")}: {openError}
        </div>
      ) : null}
      {nodes === null ? (
        <div className="ui-side-panel-empty">{t("specs.loading")}</div>
      ) : list.length === 0 ? (
        <div className="ui-side-panel-empty">
          {t("specs.empty")}
          <div className="ui-specs-empty-hint">{t("specs.emptyHint")}</div>
        </div>
      ) : (
        <>
          {chainRoots.length > 0 ? <div className="ui-specs-section">{t("specs.chainSection")}</div> : null}
          {chainRoots.map((chainRoot) => (
            <div key={chainRoot.id} className="ui-specs-chain">
              <NodeRow node={chainRoot} onOpen={openNode} t={t} />
              <div className="ui-specs-chain-children">
                {(childrenByParent.get(chainRoot.id) ?? []).map((child) => (
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
      {/* Outside the nodes ternary on purpose: a loose-file-only specs tree
       * (zero nodes, non-empty issues) must still show its structure checks —
       * that bootstrap hint is the feature's canonical first-run state
       * (2026-09 iter-2 review). */}
      {nodes !== null && issues.length > 0 ? (
        <>
          <div className="ui-specs-section">{t("specs.issue.section")}</div>
          {issues.map((issue, index) => (
            <div
              key={`${issue.path}:${issue.code}:${index}`}
              className={`ui-specs-issue ui-specs-issue-${issue.severity}`}
            >
              <span className="ui-specs-issue-dot" aria-hidden="true" />
              <span className="ui-specs-issue-text">{issueLabel(issue, t)}</span>
              <span className="ui-specs-issue-path" title={issue.path}>
                {issue.path}
              </span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
