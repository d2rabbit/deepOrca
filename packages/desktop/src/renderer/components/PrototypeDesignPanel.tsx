import type { JSX } from "react";
import { useI18n } from "../i18n";
import { WorkspaceDirectory } from "./design-workspace/WorkspaceDirectory";

export type PrototypeDesignPanelProps = {
  activeRoot: string;
  onOpenWorkspace: (root: string, suiteId?: string) => void;
};

/** Read-only cross-workspace prototype directory. Workspace opening is owned by the Hub/App. */
export function PrototypeDesignPanel({ activeRoot }: PrototypeDesignPanelProps): JSX.Element {
  const { t } = useI18n();
  return <WorkspaceDirectory activeRoot={activeRoot} kind="prototype" title={t("proto.title")} />;
}

export default PrototypeDesignPanel;
