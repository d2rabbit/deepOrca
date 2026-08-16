import { useEffect, useMemo, useState, type JSX } from "react";
import type { AskPermissionRequest, PermissionScope } from "../../shared/ipc";
import type { Scope } from "../lib/permissions";
import {
  buildResult,
  buildScopePrompts,
  describeScope,
  isAlwaysAllowedScope,
  isPromptGranted,
  pathGrantFor,
  scopeRiskColor,
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
 * Walks through each requested scope, letting the user allow / always-allow / deny.
 * Emits the aggregated PermissionResult once every prompt has been answered.
 */
export function PermissionCard({ requests, onSubmit, onCancel }: Props): JSX.Element | null {
  const { t } = useI18n();
  const prompts = useMemo(() => buildScopePrompts(requests), [requests]);
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, "allow" | "deny">>({});
  const [alwaysAllows, setAlwaysAllows] = useState<PermissionScope[]>([]);
  const [alwaysAllowPaths, setAlwaysAllowPaths] = useState<{ write: string[]; read: string[] }>({
    write: [],
    read: [],
  });

  // Skip scopes already granted "always" during this run.
  const isAlwaysGranted = (scope: Scope, filePath?: string): boolean =>
    isPromptGranted(scope, filePath, alwaysAllows, alwaysAllowPaths);

  let effectiveIndex = index;
  while (effectiveIndex < prompts.length) {
    const prompt = prompts[effectiveIndex]!;
    if (isAlwaysAllowedScope(prompt.scope) && isAlwaysGranted(prompt.scope, prompt.request.filePath)) {
      effectiveIndex += 1;
      continue;
    }
    break;
  }

  const prompt = prompts[effectiveIndex] ?? null;

  const allowAlways = prompt ? isAlwaysAllowedScope(prompt.scope) : false;

  // Keyboard shortcuts: 1=allow, 2=always (if available), 3=deny
  useEffect(() => {
    if (!prompt) return;
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "1") commit("allow");
      else if (e.key === "2" && allowAlways) commit("always");
      else if (e.key === "3" || (e.key === "2" && !allowAlways)) commit("deny");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!prompt) {
    return null;
  }

  function commit(kind: "allow" | "always" | "deny"): void {
    const current = prompt!;
    const nextDecisions = { ...decisions };
    const prev = nextDecisions[current.request.toolCallId];
    nextDecisions[current.request.toolCallId] = kind === "deny" ? "deny" : prev === "deny" ? "deny" : "allow";

    let nextAlways = alwaysAllows;
    let nextPaths = alwaysAllowPaths;
    if (kind === "always" && isAlwaysAllowedScope(current.scope)) {
      const grant = pathGrantFor(current.scope, current.request.filePath);
      if (grant) {
        // Task 14: persist the PATH, not the whole-disk scope.
        if (!nextPaths[grant.kind].includes(grant.path)) {
          nextPaths = {
            ...nextPaths,
            [grant.kind]: [...nextPaths[grant.kind], grant.path],
          };
        }
      } else if (!alwaysAllows.includes(current.scope)) {
        nextAlways = [...alwaysAllows, current.scope];
      } else {
        nextAlways = alwaysAllows;
      }
    }

    const nextIndex = effectiveIndex + 1;
    setDecisions(nextDecisions);
    setAlwaysAllows(nextAlways);
    setAlwaysAllowPaths(nextPaths);
    setIndex(nextIndex);

    // Determine if any prompts remain after this decision. Same predicate
    // as the render-time skip loop — divergence here once stalled the card
    // (rendered null without submitting) after a scope-level always-allow.
    let remaining = nextIndex;
    while (remaining < prompts.length) {
      const prompt = prompts[remaining]!;
      if (
        isAlwaysAllowedScope(prompt.scope) &&
        isPromptGranted(prompt.scope, prompt.request.filePath, nextAlways, nextPaths)
      ) {
        remaining += 1;
        continue;
      }
      break;
    }
    if (remaining >= prompts.length) {
      onSubmit(buildResult(requests, nextDecisions, nextAlways, nextPaths));
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
          {Math.min(effectiveIndex + 1, prompts.length)}/{prompts.length}
        </span>
      </CardHeader>
      {/* Progress bar showing which permission step we're on */}
      {prompts.length > 1 ? (
        <div className="ui-perm-progress">
          {prompts.map((_, i) => (
            <div
              key={i}
              className={`ui-perm-progress-dot${i < effectiveIndex ? " done" : i === effectiveIndex ? " current" : ""}`}
            />
          ))}
        </div>
      ) : null}
      <div style={{ fontWeight: 600 }}>{prompt.request.name}</div>
      <div className="ui-mono ui-perm-cmd">{prompt.request.command}</div>
      {prompt.request.description ? (
        <div style={{ color: "var(--ui-text-dim)", fontSize: 12.5 }}>{prompt.request.description}</div>
      ) : null}
      {/* Side-effect scope tags — visual risk indicators */}
      <div className="ui-perm-scopes">
        {prompt.request.scopes.map((scope) => (
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
            {pathGrantFor(prompt.scope, prompt.request.filePath) ? t("perm.alwaysPath") : t("perm.always")}
            <span className="ui-scope-tag" style={{ color: scopeRiskColor(prompt.scope) }}>
              {t(`scope.${prompt.scope}` as MessageKey)}
            </span>
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
