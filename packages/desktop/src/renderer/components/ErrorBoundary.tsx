import { Component, type ErrorInfo, type JSX, type ReactNode } from "react";

type Props = {
  /** Fallback renderer; defaults to a compact error card with the message. */
  fallback?: (error: Error) => ReactNode;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Crash fence for panel-scoped dynamic content (A2UI surfaces, markdown
 * previews). Without a boundary, an exception thrown during an effect or
 * render unmounts the ENTIRE React tree — the user sees a black window and
 * must restart the app. This keeps the blast radius at the panel.
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
      return <div className="ui-panel-error">{this.state.error.message || String(this.state.error)}</div>;
    }
    return this.props.children;
  }
}

/** Default fallback export shape kept JSX-free for callers that don't need it. */
export function ErrorFallback({ error }: { error: Error }): JSX.Element {
  return <div className="ui-panel-error">{error.message || String(error)}</div>;
}
