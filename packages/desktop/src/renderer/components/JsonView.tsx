import { memo, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useI18n } from "../i18n";

/**
 * JSON rendering card modeled after the "agent chat rendering engine" spec:
 * a header bar (file icon + key-count badge + Tree/Raw view switch + copy)
 * over a syntax-colored, collapsible tree body. Used by tool cards whenever
 * a result payload is pure JSON — the tree view replaces the flat fenced
 * code block so nested structures stay scannable.
 */

function isComposite(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

/** Leaf value with per-type syntax color (string/number/boolean/null). */
function ValueLeaf({ value }: { value: unknown }): JSX.Element {
  if (typeof value === "string") return <span className="ui-json-str">&quot;{value}&quot;</span>;
  if (typeof value === "number") return <span className="ui-json-num">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="ui-json-bool">{String(value)}</span>;
  return <span className="ui-json-null">null</span>;
}

/**
 * One node of the tree. Composites (objects/arrays) render a caret toggle;
 * collapsed nodes show an "N items" badge inline with the closing bracket,
 * mirroring the reference engine's foldable nested nodes.
 */
function JsonNode({
  name,
  value,
  depth,
  isLast,
}: {
  name: string | null;
  value: unknown;
  depth: number;
  isLast: boolean;
}): JSX.Element {
  const { t } = useI18n();
  // Deep levels start collapsed so huge payloads stay compact.
  const [open, setOpen] = useState(depth < 2);
  const comma = isLast ? null : <span className="ui-json-punc">,</span>;
  const keyEl =
    name !== null ? (
      <>
        <span className="ui-json-key">&quot;{name}&quot;</span>
        <span className="ui-json-punc">:&nbsp;</span>
      </>
    ) : null;

  if (!isComposite(value)) {
    return (
      <div className="ui-json-line">
        {keyEl}
        <ValueLeaf value={value} />
        {comma}
      </div>
    );
  }

  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const openCh = isArr ? "[" : "{";
  const closeCh = isArr ? "]" : "}";

  return (
    <div className="ui-json-branch">
      <button type="button" className="ui-json-line ui-json-toggle" onClick={() => setOpen((v) => !v)}>
        <span className={`ui-json-caret${open ? "" : " closed"}`} aria-hidden="true">
          ▾
        </span>
        {keyEl}
        <span className="ui-json-punc">{openCh}</span>
        {!open ? (
          <>
            <span className="ui-json-count">{t("msg.jsonItems", { n: entries.length })}</span>
            <span className="ui-json-punc">{closeCh}</span>
            {comma}
          </>
        ) : null}
      </button>
      {open ? (
        <>
          <div className="ui-json-children">
            {entries.map(([k, v], i) => (
              <JsonNode key={k} name={isArr ? null : k} value={v} depth={depth + 1} isLast={i === entries.length - 1} />
            ))}
          </div>
          <div className="ui-json-line">
            <span className="ui-json-punc">{closeCh}</span>
            {comma}
          </div>
        </>
      ) : null}
    </div>
  );
}

export const JsonView = memo(function JsonView({ data, label }: { data: unknown; label?: string }): JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raw = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const keyCount = isComposite(data) ? (Array.isArray(data) ? data.length : Object.keys(data).length) : 0;

  // Clear the pending copy-feedback reset when the card unmounts.
  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(raw)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      // Clipboard can be locked/permission-denied — silently ignoring is the
      // least-noisy failure for a copy affordance (no state change).
      .catch(() => {});
  }, [raw]);

  return (
    <div className="ui-json-card">
      <div className="ui-json-head">
        <span className="ui-json-head-icon" aria-hidden="true">
          {"{}"}
        </span>
        <span className="ui-json-head-name">{label ?? "JSON"}</span>
        <span className="ui-json-head-badge">
          JSON • {keyCount}{" "}
          {Array.isArray(data) ? t("msg.jsonItems", { n: keyCount }) : t("msg.jsonKeys", { n: keyCount })}
        </span>
        <div className="ui-json-view-switch" role="group">
          <button
            type="button"
            className={mode === "tree" ? "active" : ""}
            onClick={() => setMode("tree")}
            aria-pressed={mode === "tree"}
          >
            {t("msg.jsonTree")}
          </button>
          <button
            type="button"
            className={mode === "raw" ? "active" : ""}
            onClick={() => setMode("raw")}
            aria-pressed={mode === "raw"}
          >
            {t("msg.jsonRaw")}
          </button>
        </div>
        <button
          type="button"
          className={`ui-json-copy${copied ? " copied" : ""}`}
          onClick={handleCopy}
          title={copied ? t("msg.copied") : t("msg.copy")}
          aria-label={t("msg.copy")}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <div className="ui-json-body">
        {mode === "tree" ? (
          <JsonNode name={null} value={data} depth={0} isLast />
        ) : (
          <pre className="ui-json-raw">{raw}</pre>
        )}
      </div>
    </div>
  );
});
