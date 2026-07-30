/**
 * A2uiSurface — renders an A2UI Surface's component tree using custom
 * React components that match DeepOrca's design system (ui.css variables).
 *
 * This replaces @a2ui/react (which uses CSS Modules incompatible with
 * our esbuild setup). We map A2UI Basic Catalog component types to
 * our own lightweight React components styled with --ui-* CSS variables.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import type { A2uiComponent, A2uiSurfaceState } from "./processor";
import { processA2uiMessages, getSurfaces } from "./processor";

type Props = {
  /** Raw A2UI JSON messages (from MCP EmbeddedResource). */
  messagesJson: string;
  /** Called when the user interacts with an action-enabled component. */
  onAction?: (surfaceId: string, actionName: string, context: Record<string, unknown>) => void;
};

export function A2uiSurface({ messagesJson, onAction }: Props): JSX.Element {
  const [surfaces, setSurfaces] = useState<A2uiSurfaceState[]>([]);

  // Process messages on mount and when messagesJson changes.
  useEffect(() => {
    processA2uiMessages(messagesJson);
    setSurfaces(getSurfaces());
  }, [messagesJson]);

  if (surfaces.length === 0) {
    return <div className="ui-a2ui-empty">Loading Surface…</div>;
  }

  return (
    <div className="ui-a2ui-surfaces">
      {surfaces.map((surface) => (
        <div key={surface.surfaceId} className="ui-a2ui-surface">
          {surface.title ? <div className="ui-a2ui-surface-title">{surface.title}</div> : null}
          <div className="ui-a2ui-surface-body">
            {renderComponents(surface, surface.components, undefined, onAction)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Recursively render component tree from the adjacency list. */
function renderComponents(
  surface: A2uiSurfaceState,
  allComponents: A2uiComponent[],
  parentId: string | undefined,
  onAction?: (surfaceId: string, actionName: string, context: Record<string, unknown>) => void
): JSX.Element[] {
  const children = allComponents.filter((c) => c.parentId === parentId);
  return children.map((comp) => {
    const childElements = renderComponents(surface, allComponents, comp.id, onAction);
    return (
      <ComponentRenderer
        key={comp.id}
        component={comp}
        dataModel={surface.dataModel}
        childElements={childElements}
        onAction={onAction ? (actionName, context) => onAction(surface.surfaceId, actionName, context) : undefined}
      />
    );
  });
}

/** Map A2UI component type to a React element. */
function ComponentRenderer({
  component,
  dataModel,
  childElements,
  onAction,
}: {
  component: A2uiComponent;
  dataModel: Record<string, unknown>;
  childElements: JSX.Element[];
  onAction?: (actionName: string, context: Record<string, unknown>) => void;
}): JSX.Element {
  const props = component.properties ?? {};
  const type = component.type.toLowerCase();

  // Resolve property values that reference the data model via JSON Pointer ($ref).
  const resolve = (val: unknown): unknown => {
    if (typeof val === "string" && val.startsWith("$")) {
      const path = val.slice(1);
      return path.split("/").reduce<unknown>((obj, key) => {
        return (obj as Record<string, unknown>)?.[key];
      }, dataModel);
    }
    return val;
  };

  switch (type) {
    case "column":
      return <div className="ui-a2ui-column">{childElements}</div>;
    case "row":
      return <div className="ui-a2ui-row">{childElements}</div>;
    case "card":
      return <div className="ui-a2ui-card">{childElements}</div>;
    case "list":
      return <div className="ui-a2ui-list">{childElements}</div>;
    case "tabs":
      return <div className="ui-a2ui-tabs">{childElements}</div>;
    case "divider":
      return <hr className="ui-a2ui-divider" />;
    case "text":
      return (
        <div className={`ui-a2ui-text ui-a2ui-text-${resolve(props.variant) ?? "body"}`}>
          {String(resolve(props.text) ?? resolve(props.content) ?? "")}
        </div>
      );
    case "icon":
      return <span className="ui-a2ui-icon">{String(resolve(props.name) ?? "▸")}</span>;
    case "image":
      return (
        <img className="ui-a2ui-image" src={String(resolve(props.src) ?? "")} alt={String(resolve(props.alt) ?? "")} />
      );
    case "button": {
      const label = String(resolve(props.label) ?? resolve(props.text) ?? "Button");
      const actionName = String(resolve(props.action) ?? props.action ?? "click");
      return (
        <button className="ui-a2ui-button" onClick={() => onAction?.(actionName, { componentId: component.id })}>
          {label}
        </button>
      );
    }
    case "textfield":
    case "input": {
      const placeholder = String(resolve(props.placeholder) ?? resolve(props.label) ?? "");
      const value = String(resolve(props.value) ?? "");
      return <input className="ui-a2ui-textfield" placeholder={placeholder} defaultValue={value} />;
    }
    case "checkbox":
      return (
        <label className="ui-a2ui-checkbox">
          <input type="checkbox" defaultChecked={Boolean(resolve(props.checked))} />
          <span>{String(resolve(props.label) ?? "")}</span>
        </label>
      );
    case "choicepicker":
    case "select": {
      const options = (resolve(props.options) ?? resolve(props.choices) ?? []) as Array<{
        label?: string;
        value?: string;
      }>;
      return (
        <select className="ui-a2ui-choicepicker">
          {Array.isArray(options)
            ? options.map((opt, i) => (
                <option key={i} value={opt.value ?? opt.label ?? ""}>
                  {opt.label ?? opt.value ?? ""}
                </option>
              ))
            : null}
        </select>
      );
    }
    // ── DeepOrca custom catalog components (P3.2) ──────────────────────────
    case "kanbancolumn": {
      const title = String(resolve(props.title) ?? "");
      return (
        <div className="ui-a2ui-kanban-col">
          <div className="ui-a2ui-kanban-col-head">{title}</div>
          <div className="ui-a2ui-kanban-col-body">{childElements}</div>
        </div>
      );
    }
    case "kanbancard": {
      const cardTitle = String(resolve(props.title) ?? "");
      const priority = String(resolve(props.priority) ?? "");
      const priorityColor =
        priority === "high"
          ? "var(--ui-danger, #ef4444)"
          : priority === "medium"
            ? "var(--ui-warning, #f59e0b)"
            : "#3fb950";
      return (
        <div className="ui-a2ui-kanban-card" onClick={() => onAction?.("open_card", { componentId: component.id })}>
          <div className="ui-a2ui-kanban-card-title">{cardTitle}</div>
          {priority ? (
            <span className="ui-a2ui-kanban-card-priority" style={{ background: priorityColor }}>
              {priority}
            </span>
          ) : null}
          {childElements}
        </div>
      );
    }
    case "metriccard": {
      const label = String(resolve(props.label) ?? "");
      const value = String(resolve(props.value) ?? "");
      const trend = resolve(props.trend);
      const trendStr = typeof trend === "string" ? trend : "";
      const isUp = trendStr.startsWith("+");
      return (
        <div className="ui-a2ui-metric-card">
          <div className="ui-a2ui-metric-label">{label}</div>
          <div className="ui-a2ui-metric-value">{value}</div>
          {trendStr ? <div className={`ui-a2ui-metric-trend ${isUp ? "up" : "down"}`}>{trendStr}</div> : null}
        </div>
      );
    }
    case "flowstep": {
      const stepLabel = String(resolve(props.label) ?? "");
      const status = String(resolve(props.status) ?? "pending");
      const isActive = status === "active";
      const isDone = status === "done";
      return (
        <div className={`ui-a2ui-flow-step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
          <div className="ui-a2ui-flow-step-dot">{isDone ? "✓" : isActive ? "●" : "○"}</div>
          <span className="ui-a2ui-flow-step-label">{stepLabel}</span>
          {childElements}
        </div>
      );
    }
    case "badge": {
      const badgeText = String(resolve(props.text) ?? resolve(props.label) ?? "");
      const variant = String(resolve(props.variant) ?? "default");
      const colors: Record<string, string> = {
        success: "#3fb950",
        warning: "#d29922",
        danger: "#f85149",
        info: "#0ea5e9",
        default: "var(--ui-text-faint)",
      };
      return (
        <span
          className="ui-a2ui-badge"
          style={{ background: `${colors[variant] ?? colors.default}20`, color: colors[variant] ?? colors.default }}
        >
          {badgeText}
        </span>
      );
    }
    case "progress": {
      const pct = Math.min(100, Math.max(0, Number(resolve(props.percent) ?? 0)));
      return (
        <div className="ui-a2ui-progress">
          <div className="ui-a2ui-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      );
    }
    default:
      // Unknown component type — render children in a generic container.
      return (
        <div className="ui-a2ui-unknown" data-type={type}>
          {childElements}
        </div>
      );
  }
}
