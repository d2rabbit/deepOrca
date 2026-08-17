/**
 * Bento action — structured presentation deck generator.
 *
 * Wraps the Bento Slides template: reads the vendored .bento.html template,
 * injects the deck JSON spec, and writes the output file. This is the action
 * equivalent of the bento-slides skill's manual `cp` + edit workflow.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ActionDefinition, ActionRun } from "./types";

export interface BentoCreateInput {
  outputPath: string;
  title: string;
  slides: Array<{
    layout?: string;
    elements: Array<{
      type: "text" | "shape" | "image" | "chart" | "table";
      props: Record<string, unknown>;
    }>;
  }>;
}

export interface BentoCreateOutput {
  path: string;
  size: number;
}

export const bentoCreateDefinition: ActionDefinition<BentoCreateInput> = {
  id: "bento.create",
  description:
    "Generate a self-contained Bento presentation deck (.bento.html) from a structured slide spec. " +
    "Reads the vendored Bento template, injects the deck JSON, writes the output file.",
  category: "work",
  parameters: {
    type: "object",
    properties: {
      outputPath: { type: "string", description: "Output file path (e.g. 'deck.bento.html')" },
      title: { type: "string", description: "Presentation title" },
      slides: {
        type: "array",
        description: "Slide definitions",
        items: {
          type: "object",
          properties: {
            layout: { type: "string" },
            elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["text", "shape", "image", "chart", "table"] },
                  props: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
    required: ["outputPath", "title", "slides"],
    additionalProperties: false,
  },
  sideEffects: ["write-in-cwd"],
};

export const bentoCreateRun: ActionRun<BentoCreateInput, BentoCreateOutput> = async (input, ctx) => {
  // Resolve the Bento template path from the core templates directory.
  const templatePath = path.join(
    // The template ships with @deeporca/core templates/plugins/work/skills/bento-slides/references/
    // getExtensionRoot() resolves to the package root.
    ctx.projectRoot,
    "packages",
    "core",
    "templates",
    "plugins",
    "work",
    "skills",
    "bento-slides",
    "references",
    "bento-template.bento.html"
  );

  // Try alternate locations if the source-tree path doesn't exist.
  let template: string | null = null;
  const candidates = [
    templatePath,
    path.join(ctx.projectRoot, "bento-template.bento.html"),
    // Packaged app: templates are relative to node_modules/@deeporca/core/templates/
    path.join(
      __dirname,
      "..",
      "..",
      "templates",
      "plugins",
      "work",
      "skills",
      "bento-slides",
      "references",
      "bento-template.bento.html"
    ),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        template = fs.readFileSync(candidate, "utf8");
        break;
      }
    } catch {
      // try next
    }
  }

  if (!template) {
    return { path: "", size: 0, error: "Bento template not found. Ensure the bento-slides skill is installed." };
  }

  // Build the deck JSON spec.
  const deckSpec = {
    title: input.title,
    slides: input.slides.map((s, i) => ({
      id: `slide-${i + 1}`,
      layout: s.layout ?? "default",
      elements: s.elements.map((e, j) => ({
        id: `el-${i + 1}-${j + 1}`,
        type: e.type,
        ...e.props,
      })),
    })),
  };

  // Inject the deck JSON into the template's <script id="bento-doc"> block.
  const jsonStr = JSON.stringify(deckSpec).replace(/</g, "\\u003c");
  const output = template.replace(/(<script[^>]*id=["']bento-doc["'][^>]*>)([\s\S]*?)(<\/script>)/, `$1${jsonStr}$3`);

  // Write the output file.
  const outputPath = path.isAbsolute(input.outputPath)
    ? input.outputPath
    : path.join(ctx.projectRoot, input.outputPath);
  fs.writeFileSync(outputPath, output, "utf8");

  return { path: outputPath, size: output.length };
};
