import type { JSX } from "react";
import { useI18n } from "../i18n";
import { WorkspaceDirectory } from "./design-workspace/WorkspaceDirectory";

export type PrototypeDesignPanelProps = {
  activeRoot: string;
  /** 打开某工作区的原型工作台（suiteId 缺省 = 默认套件）。 */
  onOpenWorkspace: (root: string, suiteId?: string) => void;
  /** 原型工作台 tab 正被查看（主题目录的激活判定前提）。 */
  surfaceActive?: boolean;
  /** 当前查看的套件 id。 */
  activeSuiteId?: string;
};

/** Cross-workspace prototype directory; workspace opening is owned by the Hub/App. */
export function PrototypeDesignPanel({
  activeRoot,
  onOpenWorkspace,
  surfaceActive,
  activeSuiteId,
}: PrototypeDesignPanelProps): JSX.Element {
  const { t } = useI18n();
  return (
    <WorkspaceDirectory
      activeRoot={activeRoot}
      kind="prototype"
      title={t("proto.title")}
      onOpenWorkspace={onOpenWorkspace}
      surfaceActive={surfaceActive}
      activeSuiteId={activeSuiteId}
    />
  );
}

export default PrototypeDesignPanel;
