import { useEffect, useMemo, useState, type JSX } from "react";
import type { AskPermissionRequest, PermissionScope } from "../../shared/ipc";
import type { Scope } from "../lib/permissions";
import {
  buildResult,
  isAlwaysAllowedScope,
  isPromptGranted,
  pathGrantFor,
  scopeRiskColor,
  describeScope,
  type PermissionResult,
} from "../lib/permissions";
import { useI18n, type MessageKey } from "../i18n";
import { Button, Card, CardHeader, Row } from "../ui/index";

type Props = {
  requests: AskPermissionRequest[];
  onSubmit: (result: PermissionResult) => void;
  onCancel: () => void;
};

/**
 * One card per REQUEST (tool call), not per scope. The core protocol is a
 * binary allow/deny keyed by toolCallId, so the old scope-by-scope walk was
 * dishonest: a deny on the first scope of a request silently locked out a
 * later "allow" for the same request, with no way back. All scopes of the
 * request are shown at once and one decision applies to the whole call.
 */
export function PermissionCard({ requests, onSubmit, onCancel }: Props): JSX.Element | null {
  const { t } = useI18n();
  // Dedupe by toolCallId in first-appearance order (defensive — the engine
  // normally sends one AskPermissionRequest per tool call).
  const requestList = useMemo(() => {
    const seen = new Set<string>();
    const list: AskPermissionRequest[] = [];
    for (const request of requests) {
      if (seen.has(request.toolCallId)) continue;
      seen.add(request.toolCallId);
      list.push(request);
    }
    return list;
  }, [requests]);
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "allow" | "deny">>({});
  const [alwaysAllows, setAlwaysAllows] = useState<PermissionScope[]>([]);
  const [alwaysAllowPaths, setAlwaysAllowPaths] = useState<{ write: string[]; read: string[] }>({
    write: [],
    read: [],
  });

  // A request is already satisfied when EVERY scope it asks for is covered by
  // an always-grant (scope-level or path-level) — same predicate the submit
  // loop below uses, so the card can neither stall nor skip unsatisfied asks.
  const isRequestGranted = (request: AskPermissionRequest): boolean => {
    const scopes: Scope[] = request.scopes.length > 0 ? request.scopes : ["unknown"];
    return scopes.every((scope) => isPromptGranted(scope, request.filePath, alwaysAllows, alwaysAllowPaths));
  };

  let effectiveIndex = index;
  while (effectiveIndex < requestList.length && isRequestGranted(requestList[effectiveIndex]!)) {
    effectiveIndex += 1;
  }

  const request = requestList[effectiveIndex] ?? null;
  const scopes: Scope[] = request ? (request.scopes.length > 0 ? request.scopes : ["unknown"]) : [];
  // "Always" persists grants, so it only makes sense when at least one scope
  // of this request is persistable (scope-level or bound to a path).
  const allowAlways = request ? scopes.some((scope) => isAlwaysAllowedScope(scope)) : false;

  // Keyboard shortcuts: 1=allow, 2=always (if available), 3=deny.
  // Modifier/repeat guards: held keys must not machine-gun decisions, and
  // system combos (Ctrl+1, AltGr digits) must not leak in as approvals.
  useEffect(() => {
    if (!request) return;
    function onKey(e: KeyboardEvent): void {
      if (e.repeat || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "1") commit("allow");
      else if (e.key === "2" && allowAlways) commit("always");
      else if (e.key === "3" || (e.key === "2" && !allowAlways)) commit("deny");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!request) {
    return null;
  }

  function commit(kind: "allow" | "always" | "deny"): void {
    const current = request!;
    const nextDecisions: Record<string, "allow" | "deny"> = {
      ...decisions,
      [current.toolCallId]: kind === "deny" ? "deny" : "allow",
    };

    let nextAlways = alwaysAllows;
    let nextPaths = alwaysAllowPaths;
    if (kind === "always") {
      // Persist every scope of THIS request: path-bound when the scope has a
      // file path (task 14 — persist the PATH, not the whole-disk scope),
      // scope-level otherwise.
      for (const scope of scopes) {
        if (!isAlwaysAllowedScope(scope)) continue;
        const grant = pathGrantFor(scope, current.filePath);
        if (grant) {
          if (!nextPaths[grant.kind].includes(grant.path)) {
            nextPaths = {
              ...nextPaths,
              [grant.kind]: [...nextPaths[grant.kind], grant.path],
            };
          }
        } else if (!nextAlways.includes(scope)) {
          nextAlways = [...nextAlways, scope];
        }
      }
    }

    setDecisions(nextDecisions);
    setAlwaysAllows(nextAlways);
    setAlwaysAllowPaths(nextPaths);

    const nextIndex = effectiveIndex + 1;
    setIndex(nextIndex);

    // Submit when no unsatisfied requests remain — same predicate as the
    // render-time skip loop (divergence here once stalled the card).
    let remaining = nextIndex;
    while (
      remaining < requestList.length &&
      requestList[remaining]!.scopes.length > 0 &&
      requestList[remaining]!.scopes.every((scope) =>
        isPromptGranted(scope, requestList[remaining]!.filePath, nextAlways, nextPaths)
      )
    ) {
      remaining += 1;
    }
    if (remaining >= requestList.length) {
      onSubmit(buildResult(requestList, nextDecisions, nextAlways, nextPaths));
    }
  }

  return (
    <Card warn className="ui-card-enter ui-perm-card">
      <CardHeader>
        <span className="ui-perm-warn-icon" aria-hidden="true">
          ⚠
        </span>{" "}
        {t("perm.required")}{" "}
        <span style={{ color: "var(--ui-text-faint)", fontWeight: 400 }}>
          {Math.min(effectiveIndex + 1, requestList.length)}/{requestList.length}
        </span>
      </CardHeader>
      {/* Progress bar showing which request we're on */}
      {requestList.length > 1 ? (
        <div className="ui-perm-progress">
          {requestList.map((req, i) => (
            <div
              key={req.toolCallId}
              className={`ui-perm-progress-dot${i < effectiveIndex ? " done" : i === effectiveIndex ? " current" : ""}`}
            />
          ))}
        </div>
      ) : null}
      <div style={{ fontWeight: 600 }}>{request.name}</div>
      <div className="ui-mono ui-perm-cmd">{request.command}</div>
      {request.description ? (
        <div style={{ color: "var(--ui-text-dim)", fontSize: 12.5 }}>{request.description}</div>
      ) : null}
      {/* Side-effect scope tags — ALL scopes of this request, one decision */}
      <div className="ui-perm-scopes">
        {scopes.map((scope) => (
          <span key={scope} className="ui-perm-scope-tag" style={{ borderColor: scopeRiskColor(scope) }}>
            <span className="ui-perm-scope-dot" style={{ background: scopeRiskColor(scope) }} />
            {t(`scope.${scope}` as MessageKey)}
            <span className="ui-perm-scope-desc">{describeScope(scope)}</span>
          </span>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>{t("perm.proceed")}</div>
      <div className="ui-opt-row">
        <button className="ui-opt ui-opt--allow" onClick={() => commit("allow")}>
          {t("perm.yes")}
        </button>
        {allowAlways ? (
          <button className="ui-opt" onClick={() => commit("always")}>
            {scopes.some((scope) => pathGrantFor(scope, request.filePath)) ? t("perm.alwaysPath") : t("perm.always")}
          </button>
        ) : null}
        <button className="ui-opt ui-opt--deny" onClick={() => commit("deny")}>
          {t("perm.no")}
        </button>
      </div>
      <div className="ui-perm-kbd-hint">
        <span>
          <kbd>1</kbd>
          {t("perm.yes")}
        </span>
        {allowAlways ? (
          <span>
            <kbd>2</kbd>
            {t("perm.always")}
          </span>
        ) : null}
        <span>
          <kbd>{allowAlways ? "3" : "2"}</kbd>
          {t("perm.no")}
        </span>
      </div>
      <Row justify="flex-end">
        <Button size="sm" onClick={onCancel}>
          {t("common.interrupt")}
        </Button>
      </Row>
    </Card>
  );
}
