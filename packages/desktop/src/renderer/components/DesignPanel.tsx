import type { JSX } from "react";
import { useI18n } from "../i18n";
import { WorkspaceDirectory } from "./design-workspace/WorkspaceDirectory";

export type DesignPanelProps = {
  activeRoot: string;
  onOpenWorkspace: (root: string, suiteId?: string) => void;
};

/** Read-only cross-workspace UI-design directory. Workspace opening is owned by the Hub/App. */
export function DesignPanel({ activeRoot }: DesignPanelProps): JSX.Element {
  const { t } = useI18n();
  return <WorkspaceDirectory activeRoot={activeRoot} kind="ui" title={t("design.title")} />;
}

export default DesignPanel;
