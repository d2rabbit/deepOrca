/**
 * DeepOrca OpenUI component library — lightweight components styled with
 * DeepOrca's --ui-* CSS variables, matching the existing design system.
 *
 * This is the catalog the OpenUI Lang Renderer uses to resolve component
 * names (e.g. `root = Column([...])`) into React elements. Each component
 * is defined via `defineComponent` with a Zod v4 props schema so the parser
 * can validate LLM output and auto-generate prompt signatures.
 */

import { z } from "zod/v4";
import type { ComponentRenderProps } from "@openuidev/react-lang";
import { createLibrary, defineComponent, useStateField, useTriggerAction } from "@openuidev/react-lang";

// ── Shared prop schemas ──────────────────────────────────────────────────────

const childrenSchema = z.array(z.unknown()).optional().describe("Child elements to render inside");

const actionSchema = z.string().optional().describe("Action name fired on interaction (e.g. 'submit:login')");

// ── Layout components ────────────────────────────────────────────────────────

const Column = defineComponent({
  name: "Column",
  description: "Vertical stack container. Children flow top-to-bottom.",
  props: z.object({
    children: childrenSchema,
    gap: z.string().optional().describe("Gap between children (e.g. '12px', '8px')"),
    padding: z.string().optional(),
    align: z.enum(["left", "center", "right", "stretch"]).optional(),
  }),
  component: ({ props, renderNode }: ComponentRenderProps<Record<string, unknown>>) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: (props.gap as string) ?? "8px",
        padding: (props.padding as string) ?? undefined,
        alignItems:
          props.align === "center"
            ? "center"
            : props.align === "right"
              ? "flex-end"
              : props.align === "stretch"
                ? "stretch"
                : "flex-start",
      }}
    >
      {props.children ? renderNode(props.children) : null}
    </div>
  ),
});

const Row = defineComponent({
  name: "Row",
  description: "Horizontal flex container. Children flow left-to-right.",
  props: z.object({
    children: childrenSchema,
    gap: z.string().optional(),
    padding: z.string().optional(),
    align: z.enum(["top", "center", "bottom"]).optional(),
    justify: z.enum(["start", "center", "end", "between"]).optional(),
  }),
  component: ({ props, renderNode }: ComponentRenderProps<Record<string, unknown>>) => (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: (props.gap as string) ?? "8px",
        padding: (props.padding as string) ?? undefined,
        alignItems: props.align === "center" ? "center" : props.align === "bottom" ? "flex-end" : "flex-start",
        justifyContent:
          props.justify === "center"
            ? "center"
            : props.justify === "end"
              ? "flex-end"
              : props.justify === "between"
                ? "space-between"
                : "flex-start",
      }}
    >
      {props.children ? renderNode(props.children) : null}
    </div>
  ),
});

const Stack = defineComponent({
  name: "Stack",
  description: "Simple vertical stack with default gap. Use for grouping related elements.",
  props: z.object({
    children: childrenSchema,
    gap: z.string().optional(),
  }),
  component: ({ props, renderNode }: ComponentRenderProps<Record<string, unknown>>) => (
    <div style={{ display: "flex", flexDirection: "column", gap: (props.gap as string) ?? "8px" }}>
      {props.children ? renderNode(props.children) : null}
    </div>
  ),
});

const Card = defineComponent({
  name: "Card",
  description: "Surface card with border, background, and padding. Groups content visually.",
  props: z.object({
    children: childrenSchema,
    title: z.string().optional(),
    padding: z.string().optional(),
  }),
  component: ({ props, renderNode }: ComponentRenderProps<Record<string, unknown>>) => (
    <div
      className="ui-card"
      style={{
        background: "var(--ui-surface, #1e1e1e)",
        border: "1px solid var(--ui-border-soft, #333)",
        borderRadius: "var(--ui-radius, 8px)",
        padding: (props.padding as string) ?? "16px",
      }}
    >
      {props.title ? (
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--ui-text-dim)" }}>
          {props.title as string}
        </div>
      ) : null}
      {props.children ? renderNode(props.children) : null}
    </div>
  ),
});

// ── Content components ───────────────────────────────────────────────────────

const TextContent = defineComponent({
  name: "TextContent",
  description:
    "Text element. variant controls size/weight: 'small', 'body', 'large', 'large-heavy', 'title', 'caption', 'muted'.",
  props: z.object({
    text: z.string().describe("The text content to display"),
    variant: z
      .enum(["small", "body", "large", "large-heavy", "title", "caption", "muted"])
      .optional()
      .describe("Text style variant"),
  }),
  component: ({ props }: ComponentRenderProps<Record<string, unknown>>) => {
    const variant = (props.variant as string) ?? "body";
    const styles: Record<string, React.CSSProperties> = {
      small: { fontSize: 12, color: "var(--ui-text-dim)" },
      body: { fontSize: 14, color: "var(--ui-text)" },
      large: { fontSize: 18, color: "var(--ui-text)" },
      "large-heavy": { fontSize: 18, fontWeight: 600, color: "var(--ui-text)" },
      title: { fontSize: 24, fontWeight: 700, color: "var(--ui-text)" },
      caption: { fontSize: 11, color: "var(--ui-text-faint, var(--ui-text-dim))" },
      muted: { fontSize: 13, color: "var(--ui-text-faint, var(--ui-text-dim))" },
    };
    return <span style={styles[variant] ?? styles.body}>{props.text as string}</span>;
  },
});

const Badge = defineComponent({
  name: "Badge",
  description: "Small pill-shaped label for status/tags/metadata.",
  props: z.object({
    label: z.string().describe("Badge text"),
    variant: z.enum(["default", "success", "warning", "error", "info"]).optional(),
  }),
  component: ({ props }: ComponentRenderProps<Record<string, unknown>>) => {
    const variant = (props.variant as string) ?? "default";
    const colors: Record<string, { bg: string; fg: string }> = {
      default: { bg: "rgba(128,128,128,0.15)", fg: "var(--ui-text-dim)" },
      success: { bg: "rgba(34,197,94,0.15)", fg: "#4ade80" },
      warning: { bg: "rgba(251,191,36,0.15)", fg: "#fbbf24" },
      error: { bg: "rgba(239,68,68,0.15)", fg: "#f87171" },
      info: { bg: "rgba(59,130,246,0.15)", fg: "#60a5fa" },
    };
    const c = colors[variant] ?? colors.default;
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 10px",
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 500,
          background: c.bg,
          color: c.fg,
        }}
      >
        {props.label as string}
      </span>
    );
  },
});

// ── Interactive components ───────────────────────────────────────────────────

function ButtonComponent({ props }: ComponentRenderProps<Record<string, unknown>>) {
  const triggerAction = useTriggerAction();
  const variant = (props.variant as string) ?? "primary";
  const base: React.CSSProperties = {
    padding: "8px 20px",
    borderRadius: "var(--ui-radius, 8px)",
    fontSize: 14,
    fontWeight: 500,
    cursor: props.disabled ? "not-allowed" : "pointer",
    opacity: props.disabled ? 0.5 : 1,
    border: "none",
    transition: "opacity 0.15s",
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { ...base, background: "var(--ui-accent, #3b82f6)", color: "#fff" },
    secondary: {
      ...base,
      background: "var(--ui-surface-sunken, rgba(128,128,128,0.1))",
      color: "var(--ui-text)",
      border: "1px solid var(--ui-border-soft)",
    },
    ghost: { ...base, background: "transparent", color: "var(--ui-text-dim)" },
  };
  return (
    <button
      style={variants[variant] ?? variants.primary}
      onClick={() => {
        if (props.disabled) return;
        if (props.action) triggerAction(props.action as string);
      }}
    >
      {props.label as string}
    </button>
  );
}

const Button = defineComponent({
  name: "Button",
  description: "Clickable button. variant: 'primary' | 'secondary' | 'ghost'. action fires on click.",
  props: z.object({
    label: z.string().describe("Button text"),
    action: actionSchema,
    variant: z.enum(["primary", "secondary", "ghost"]).optional(),
    disabled: z.boolean().optional(),
  }),
  component: ButtonComponent,
});

function TextFieldComponent({ props }: ComponentRenderProps<Record<string, unknown>>) {
  // Bind the field to the SDK's form state via useStateField — the unified
  // hook upstream recommends for component authors. It reads the current
  // value from form state (falling back to props.value) and writes back via
  // setValue, so event.formState is populated when a Button fires an action
  // (e.g. submit:login). Without this, PrototypePanel's handleOpenuiAction
  // never sees user input.
  const fieldName = (props.name as string) ?? (props.label as string) ?? "field";
  const initialValue = (props.value as string) ?? "";
  const field = useStateField<string>(fieldName, initialValue);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      {props.label ? (
        <label style={{ fontSize: 12, color: "var(--ui-text-dim)", fontWeight: 500 }}>{props.label as string}</label>
      ) : null}
      <input
        type={(props.type as string) ?? "text"}
        placeholder={(props.placeholder as string) ?? ""}
        value={field.value}
        name={fieldName}
        onChange={(e) => field.setValue(e.target.value)}
        style={{
          padding: "8px 12px",
          borderRadius: "var(--ui-radius, 8px)",
          border: "1px solid var(--ui-border-soft, #333)",
          background: "var(--ui-input-bg, rgba(0,0,0,0.15))",
          color: "var(--ui-text)",
          fontSize: 14,
          outline: "none",
        }}
      />
    </div>
  );
}

const TextField = defineComponent({
  name: "TextField",
  description: "Single-line text input with label and placeholder.",
  props: z.object({
    label: z.string().optional(),
    placeholder: z.string().optional(),
    value: z.string().optional(),
    type: z.enum(["text", "email", "password", "number"]).optional(),
    name: z.string().optional().describe("Form field name for data binding"),
  }),
  component: TextFieldComponent,
});

const Metric = defineComponent({
  name: "Metric",
  description: "KPI metric card — large number + label + optional trend indicator.",
  props: z.object({
    label: z.string().describe("Metric label (e.g. 'Total Revenue')"),
    value: z.string().describe("Metric value (e.g. '$12,345')"),
    trend: z.string().optional().describe("Trend indicator text (e.g. '+12% vs last month')"),
  }),
  component: ({ props }: ComponentRenderProps<Record<string, unknown>>) => (
    <div
      className="ui-metric"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "16px 20px",
        background: "var(--ui-surface, #1e1e1e)",
        border: "1px solid var(--ui-border-soft, #333)",
        borderRadius: "var(--ui-radius, 8px)",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--ui-text-faint, var(--ui-text-dim))",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {props.label as string}
      </span>
      <span style={{ fontSize: 28, fontWeight: 700, color: "var(--ui-text)" }}>{props.value as string}</span>
      {props.trend ? (
        <span style={{ fontSize: 12, color: "var(--ui-accent, #3b82f6)" }}>{props.trend as string}</span>
      ) : null}
    </div>
  ),
});

const Divider = defineComponent({
  name: "Divider",
  description: "Horizontal separator line.",
  props: z.object({}),
  component: () => (
    <hr
      style={{ border: "none", borderTop: "1px solid var(--ui-border-soft, #333)", margin: "8px 0", width: "100%" }}
    />
  ),
});

const Spacer = defineComponent({
  name: "Spacer",
  description: "Flexible vertical spacer. Use to push content apart in a Column.",
  props: z.object({
    size: z.string().optional().describe("Height of the spacer (default '16px')"),
  }),
  component: ({ props }: ComponentRenderProps<Record<string, unknown>>) => (
    <div style={{ height: (props.size as string) ?? "16px", flexShrink: 0 }} />
  ),
});

// ── Library export ───────────────────────────────────────────────────────────

export const deeporcaLibrary = createLibrary({
  components: [Column, Row, Stack, Card, TextContent, Badge, Button, TextField, Metric, Divider, Spacer],
  componentGroups: [
    {
      name: "Layout",
      components: ["Column", "Row", "Stack", "Card", "Divider", "Spacer"],
    },
    {
      name: "Content",
      components: ["TextContent", "Badge", "Metric"],
    },
    {
      name: "Interactive",
      components: ["Button", "TextField"],
    },
  ],
});
