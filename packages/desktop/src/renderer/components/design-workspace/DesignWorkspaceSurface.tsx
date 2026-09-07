import { lazy, Suspense, type JSX } from "react";
import { m, springToken } from "../../ui/motion";
import { useI18n } from "../../i18n";

const PrototypeWorkspace = lazy(() =>
  import("./PrototypeWorkspace").then((module) => ({ default: module.PrototypeWorkspace }))
);
const DesignWorkspace = lazy(() => import("./DesignWorkspace").then((module) => ({ default: module.DesignWorkspace })));

type DesignWorkspaceTab =
  | { kind: "prototype"; root: string; suiteId?: string; tab?: string }
  | { kind: "design"; root: string; suiteId?: string; tab?: string };

type Props = {
  tab: DesignWorkspaceTab;
  onClose: (kind: DesignWorkspaceTab["kind"], root: string) => void;
};

/** Animated main-stage host shared by the two independent design workspaces. */
export function DesignWorkspaceSurface({ tab, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const close = (): void => onClose(tab.kind, tab.root);
  return (
    <m.div
      key={`tab-${tab.kind}:${tab.root}`}
      className="ui-sheet"
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.985 }}
      transition={springToken}
    >
      <Suspense fallback={<div className="ui-side-panel-empty">{t("common.loading")}</div>}>
        {tab.kind === "prototype" ? (
          <PrototypeWorkspace
            key={tab.root}
            root={tab.root}
            suiteId={tab.suiteId}
            initialTab={tab.tab}
            onBack={close}
          />
        ) : (
          <DesignWorkspace key={tab.root} root={tab.root} suiteId={tab.suiteId} initialTab={tab.tab} onBack={close} />
        )}
      </Suspense>
    </m.div>
  );
}
