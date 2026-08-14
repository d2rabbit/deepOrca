#!/usr/bin/env node
/**
 * generate-openui-prompt.mjs — regenerate the OpenUI Lang component prompt
 * from deeporcaLibrary's Zod schemas via library.prompt().
 *
 * Eliminates dual-source drift: the component table in pm-designer-openui
 * SKILL.md is a generated artifact, not hand-maintained.
 *
 * Usage:
 *   node scripts/generate-openui-prompt.mjs           # print to stdout
 *   node scripts/generate-openui-prompt.mjs --write    # update SKILL.md
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// The library definition imports React components — we can't import it
// directly in a plain Node script. Instead we re-create the library with
// stub components (the schema is what matters for prompt generation).
// This mirrors the component definitions in
// packages/desktop/src/renderer/openui/library.tsx — keep in sync.

async function main() {
  // Dynamic import of lang-core (ESM).
  const { createLibrary, defineComponent } = await import("@openuidev/lang-core");
  const { z } = await import("zod/v4");

  const Stub = () => null;

  const lib = createLibrary({
    root: "Stack",
    components: [
      defineComponent({
        name: "Column",
        props: z.object({
          children: z.array(z.any()).optional(),
          gap: z.number().optional(),
          padding: z.number().optional(),
          align: z.string().optional(),
        }),
        description: "Vertical layout container",
        component: Stub,
      }),
      defineComponent({
        name: "Row",
        props: z.object({
          children: z.array(z.any()).optional(),
          gap: z.number().optional(),
          padding: z.number().optional(),
          align: z.string().optional(),
        }),
        description: "Horizontal layout container",
        component: Stub,
      }),
      defineComponent({
        name: "Stack",
        props: z.object({ children: z.array(z.any()).optional(), gap: z.number().optional() }),
        description: "Stacked layout (vertical + horizontal)",
        component: Stub,
      }),
      defineComponent({
        name: "Card",
        props: z.object({
          children: z.array(z.any()).optional(),
          padding: z.number().optional(),
          shadow: z.boolean().optional(),
        }),
        description: "Card container with border and padding",
        component: Stub,
      }),
      defineComponent({
        name: "TextContent",
        props: z.object({
          text: z.string(),
          variant: z.enum(["title", "subtitle", "body", "caption", "title-xl", "body-dim", "mono"]).optional(),
        }),
        description: "Text content with variants",
        component: Stub,
      }),
      defineComponent({
        name: "Badge",
        props: z.object({
          label: z.string(),
          variant: z.enum(["success", "warning", "error", "info", "neutral"]).optional(),
        }),
        description: "Badge/pill label",
        component: Stub,
      }),
      defineComponent({
        name: "Button",
        props: z.object({
          label: z.string(),
          action: z.string().optional(),
          variant: z.enum(["primary", "secondary", "ghost", "danger"]).optional(),
        }),
        description: "Interactive button (triggers action)",
        component: Stub,
      }),
      defineComponent({
        name: "TextField",
        props: z.object({
          label: z.string(),
          placeholder: z.string().optional(),
          type: z.enum(["text", "password", "email", "number"]).optional(),
          name: z.string().optional(),
        }),
        description: "Text input field (state-managed)",
        component: Stub,
      }),
      defineComponent({
        name: "Metric",
        props: z.object({
          label: z.string(),
          value: z.string(),
          delta: z.string().optional(),
          trend: z.enum(["up", "down", "flat"]).optional(),
        }),
        description: "Metric card (label + value + optional delta)",
        component: Stub,
      }),
      defineComponent({
        name: "Divider",
        props: z.object({}),
        description: "Horizontal divider line",
        component: Stub,
      }),
      defineComponent({
        name: "Spacer",
        props: z.object({ size: z.number().optional() }),
        description: "Vertical spacer",
        component: Stub,
      }),
    ],
    componentGroups: [
      { name: "Layout", components: ["Column", "Row", "Stack", "Card"], notes: "Container components" },
      {
        name: "Content",
        components: ["TextContent", "Badge", "Metric", "Divider", "Spacer"],
        notes: "Display components",
      },
      { name: "Interactive", components: ["Button", "TextField"], notes: "User-input components" },
    ],
  });

  const prompt = lib.prompt({
    additionalRules: [
      "Follow the taste skill's design discipline (one accent, 4/8px spacing, ≥4.5:1 contrast).",
      "Use Query('design.readWiki', {name: '...'}) to pull project context into prototypes.",
    ],
    editMode: false,
  });

  if (process.argv.includes("--write")) {
    const skillPath = join(repoRoot, "packages/core/templates/plugins/design/skills/pm-designer-openui/SKILL.md");
    let content = readFileSync(skillPath, "utf8");
    // Replace the component table section between ## Available components and the next ## heading.
    const sectionRegex = /## Available components[\s\S]*?(?=\n## )/;
    if (sectionRegex.test(content)) {
      content = content.replace(sectionRegex, `## Available components\n\n${prompt}\n`);
      writeFileSync(skillPath, content, "utf8");
      console.log(`[generate-openui-prompt] updated ${skillPath}`);
    } else {
      console.error("[generate-openui-prompt] '## Available components' section not found in SKILL.md");
      process.exit(1);
    }
  } else {
    console.log(prompt);
  }
}

main().catch((err) => {
  console.error(`[generate-openui-prompt] failed: ${err.message}`);
  process.exit(1);
});
