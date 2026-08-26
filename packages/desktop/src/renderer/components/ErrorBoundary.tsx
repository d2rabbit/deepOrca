import { Component, useState, type ErrorInfo, type JSX, type ReactNode } from "react";
import { useI18n } from "../i18n";

type Props = {
  /** Fallback renderer; defaults to a compact error card with retry. */
  fallback?: (error: Error) => ReactNode;
  children: ReactNode;
};

type State = { error: Error | null };

/** Default fallback: human-readable message + retry + collapsible detail.
 *  Function component so it can reach the i18n context. */
function DefaultFallback({ error, onRetry }: { error: Error; onRetry: () => void }): JSX.Element {
  const { t } = useI18n();
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="ui-panel-error">
      <div>{error.message || t("error.panelCrash")}</div>
      <div className="ui-panel-error-actions">
        <button type="button" className="ui-panel-error-retry" onClick={onRetry}>
          {t("error.retry")}
        </button>
        <button type="button" className="ui-panel-error-detail-toggle" onClick={() => setShowDetail((v) => !v)}>
          {showDetail ? t("common.hide") : t("common.show")}
        </button>
      </div>
      {showDetail && error.stack ? <pre className="ui-panel-error-stack">{error.stack}</pre> : null}
    </div>
  );
}

/**
 * Crash fence for panel-scoped dynamic content (A2UI surfaces, markdown
 * previews). Without a boundary, an exception thrown during an effect or
 * render unmounts the ENTIRE React tree — the user sees a black window and
 * must restart the app. This keeps the blast radius at the panel, and the
 * Retry button re-mounts the children without an app restart.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("[ui] panel crashed, contained by ErrorBoundary:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error);
      return <DefaultFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

/** Default fallback export shape kept JSX-free for callers that don't need it. */
export function ErrorFallback({ error }: { error: Error }): JSX.Element {
  return <div className="ui-panel-error">{error.message || String(error)}</div>;
}
