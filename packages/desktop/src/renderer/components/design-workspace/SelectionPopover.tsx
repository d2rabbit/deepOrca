import { useEffect, useState, type JSX } from "react";
import { useI18n } from "../../i18n";
import { IconClose, IconSparkle } from "../../ui/icons";

export type WorkspaceSelection = {
  nodePath: string;
  bounds: { x: number; y: number; width: number; height: number };
  action?: string;
};

type Props = {
  selection: WorkspaceSelection | null;
  readOnly?: boolean;
  quickFixes: readonly string[];
  onClose: () => void;
  onFix: (instruction: string) => void;
  onExecute?: (action: string) => void;
};

export function SelectionPopover({
  selection,
  readOnly,
  quickFixes,
  onClose,
  onFix,
  onExecute,
}: Props): JSX.Element | null {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!selection) setDraft("");
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, selection]);

  if (!selection) return null;
  const left = Math.max(8, selection.bounds.x + selection.bounds.width + 10);
  const top = Math.max(8, selection.bounds.y - 6);
  const submit = () => {
    const instruction = draft.trim();
    if (!instruction || readOnly) return;
    onFix(instruction);
    setDraft("");
  };

  return (
    <aside className="ui-design-selection-popover" style={{ left, top }} data-testid="selection-popover">
      <header>
        <IconSparkle />
        <strong>{t("designWorkspace.selectionFix")}</strong>
        <button type="button" onClick={onClose} aria-label={t("common.close")}>
          <IconClose />
        </button>
      </header>
      <code>{selection.nodePath}</code>
      <div className="ui-design-selection-quick">
        {selection.action && onExecute ? (
          <button type="button" disabled={readOnly} onClick={() => onExecute(selection.action!)}>
            {t("designWorkspace.executeAction", { action: selection.action })}
          </button>
        ) : null}
        {quickFixes.map((label) => (
          <button type="button" disabled={readOnly} key={label} onClick={() => onFix(label)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ui-design-selection-input">
        <input
          value={draft}
          disabled={readOnly}
          aria-label={t("designWorkspace.selectionPrompt")}
          placeholder={t("designWorkspace.selectionPrompt")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <button type="button" disabled={readOnly || !draft.trim()} onClick={submit}>
          {t("common.apply")}
        </button>
      </div>
    </aside>
  );
}
