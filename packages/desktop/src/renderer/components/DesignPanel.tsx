import type { JSX } from "react";
import { useI18n } from "../i18n";
import { WorkspaceDirectory } from "./design-workspace/WorkspaceDirectory";

export type DesignPanelProps = {
  activeRoot: string;
  /** 打开某工作区的 UI 设计工作台（suiteId 缺省 = 默认套件）。 */
  onOpenWorkspace: (root: string, suiteId?: string) => void;
  /** UI 设计工作台 tab 正被查看（主题目录的激活判定前提）。 */
  surfaceActive?: boolean;
  /** 当前查看的套件 id。 */
  activeSuiteId?: string;
};

/** Cross-workspace UI-design directory; workspace opening is owned by the Hub/App. */
export function DesignPanel({
  activeRoot,
  onOpenWorkspace,
  surfaceActive,
  activeSuiteId,
}: DesignPanelProps): JSX.Element {
  const { t } = useI18n();
  return (
    <WorkspaceDirectory
      activeRoot={activeRoot}
      kind="ui"
      title={t("design.title")}
      onOpenWorkspace={onOpenWorkspace}
      surfaceActive={surfaceActive}
      activeSuiteId={activeSuiteId}
    />
  );
}

export default DesignPanel;
