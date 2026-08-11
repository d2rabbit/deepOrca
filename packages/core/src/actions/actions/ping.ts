/**
 * Trivial proof action — validates the three-surface mechanism end to end
 * (register → toToolDefinitions → execute → progress → cancel) without any
 * spawn/agent dependency. Real actions (review.run, index.buildAll, …) are
 * added in Phase 1+; see `specs/define-action/design.md` §三/§四.
 */

import type { ActionDefinition, ActionRun } from "../types";

export interface PingInput {
  name?: string;
}

export interface PingOutput {
  pong: string;
  echo: string;
  projectRoot: string;
}

export const pingDefinition: ActionDefinition<PingInput> = {
  id: "system.ping",
  description:
    "Trivial health-check action. Returns a pong with the echoed name. Used to verify the action pipeline (LLM tool surface, dispatch, progress, cancellation) end to end.",
  category: "system",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Optional name to echo back." },
    },
    additionalProperties: false,
  },
  sideEffects: [],
};

export const pingRun: ActionRun<PingInput, PingOutput> = async (input, ctx) => {
  const echo = input?.name ?? "world";
  ctx.emit({ message: `ping received: ${echo}`, percent: 50 });
  return { pong: "pong", echo, projectRoot: ctx.projectRoot };
};
