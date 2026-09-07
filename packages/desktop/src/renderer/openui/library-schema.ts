/**
 * LEGACY — Designer component contract for the pre-switch DeepOrca component
 * library. Since 2026-09 new prototypes are authored against the OFFICIAL
 * @openuidev/react-ui openuiLibrary (prompt generated from the library itself
 * by scripts/generate-openui-prompt.mjs); this schema's SKILL.md contract is
 * historical. It stays only so OpenuiRenderer can render suites generated
 * before the switch (routed by the legacy component-name heuristic), and the
 * actionSchema describe text is prompt dead-code for the same reason.
 *
 * React-free by design so non-React consumers can import it from plain Node:
 * - `library.tsx` binds each def to its React component (rendering adapter)
 * - `scripts/generate-openui-prompt.mjs` previously bound them to stubs
 *   (prompt adapter — superseded by the official openuiLibrary.prompt())
 *
 * This schema does NOT participate in SKILL.md generation: the prompt comes
 * from the official openuiLibrary itself, so editing legacy defs here can
 * never drift the generated contract.
 */

import { z } from "zod/v4";

// ── Shared prop schemas ──────────────────────────────────────────────────────

const childrenSchema = z.array(z.unknown()).optional().describe("Child elements to render inside");

const actionSchema = z
  .string()
  .optional()
  .describe(
    'Click behavior: an Action([@steps...]) expression, e.g. Action([@Set($page, "orders")]) — or a plain action name like "submit:login"'
  );

// ── Component definitions ────────────────────────────────────────────────────

export const DESIGNER_COMPONENT_DEFS = {
  Column: {
    description: "Vertical stack container. Children flow top-to-bottom.",
    props: z.object({
      children: childrenSchema,
      gap: z.string().optional().describe("Gap between children (e.g. '12px', '8px')"),
      padding: z.string().optional(),
      align: z.enum(["left", "center", "right", "stretch"]).optional(),
    }),
  },
  Row: {
    description: "Horizontal flex container. Children flow left-to-right.",
    props: z.object({
      children: childrenSchema,
      gap: z.string().optional(),
      padding: z.string().optional(),
      align: z.enum(["top", "center", "bottom"]).optional(),
      justify: z.enum(["start", "center", "end", "between"]).optional(),
    }),
  },
  Stack: {
    description: "Simple vertical stack with default gap. Use for grouping related elements.",
    props: z.object({
      children: childrenSchema,
      gap: z.string().optional(),
    }),
  },
  Card: {
    description: "Surface card with border, background, and padding. Groups content visually.",
    props: z.object({
      children: childrenSchema,
      title: z.string().optional(),
      padding: z.string().optional(),
    }),
  },
  TextContent: {
    description:
      "Text element. variant controls size/weight: 'small', 'body', 'large', 'large-heavy', 'title', 'caption', 'muted'.",
    props: z.object({
      text: z.string().describe("The text content to display"),
      variant: z
        .enum(["small", "body", "large", "large-heavy", "title", "caption", "muted"])
        .optional()
        .describe("Text style variant"),
    }),
  },
  Badge: {
    description: "Small pill-shaped label for status/tags/metadata.",
    props: z.object({
      label: z.string().describe("Badge text"),
      variant: z.enum(["default", "success", "warning", "error", "info"]).optional(),
    }),
  },
  Button: {
    description: "Clickable button. variant: 'primary' | 'secondary' | 'ghost'. action fires on click.",
    props: z.object({
      label: z.string().describe("Button text"),
      action: actionSchema,
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      disabled: z.boolean().optional(),
    }),
  },
  TextField: {
    description: "Single-line text input with label and placeholder.",
    props: z.object({
      label: z.string().optional(),
      placeholder: z.string().optional(),
      value: z.string().optional(),
      type: z.enum(["text", "email", "password", "number"]).optional(),
      name: z.string().optional().describe("Form field name for data binding"),
    }),
  },
  Metric: {
    description: "KPI metric card — large number + label + optional trend indicator.",
    props: z.object({
      label: z.string().describe("Metric label (e.g. 'Total Revenue')"),
      value: z.string().describe("Metric value (e.g. '$12,345')"),
      trend: z.string().optional().describe("Trend indicator text (e.g. '+12% vs last month')"),
    }),
  },
  Divider: {
    description: "Horizontal separator line.",
    props: z.object({}),
  },
  Spacer: {
    description: "Flexible vertical spacer. Use to push content apart in a Column.",
    props: z.object({
      size: z.string().optional().describe("Height of the spacer (default '16px')"),
    }),
  },
} as const;

export type DesignerComponentName = keyof typeof DESIGNER_COMPONENT_DEFS;

export const DESIGNER_COMPONENT_GROUPS = [
  { name: "Layout", components: ["Column", "Row", "Stack", "Card", "Divider", "Spacer"] },
  { name: "Content", components: ["TextContent", "Badge", "Metric"] },
  { name: "Interactive", components: ["Button", "TextField"] },
] as const satisfies readonly { name: string; components: readonly DesignerComponentName[] }[];
