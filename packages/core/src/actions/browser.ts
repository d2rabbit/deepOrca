/**
 * Browser actions — structured wrappers around the `bsk` CLI (BrowserSkill).
 *
 * These actions give the agent a more reliable interface than raw bash calls.
 * The web-access-strategy skill teaches the agent WHEN to use browser automation;
 * these actions provide HOW.
 */

import type { ActionDefinition, ActionRun } from "./types";

export interface BrowserSessionStartOutput {
  sessionId: string;
  browser?: string;
}

export const browserSessionStartDefinition: ActionDefinition = {
  id: "browser.session-start",
  description: "Start a BrowserSkill browser session. Returns a session ID for subsequent commands.",
  category: "browser",
  parameters: {
    type: "object",
    properties: {
      browser: {
        type: "string",
        description: "Browser to use (e.g. 'chrome', 'edge'). Defaults to system default.",
      },
    },
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess"],
};

export const browserSessionStartRun: ActionRun<Record<string, unknown>, BrowserSessionStartOutput> = async (
  input,
  ctx
) => {
  const args = ["session", "start"];
  if (input.browser) args.push("--browser", String(input.browser));
  const proc = ctx.spawner.spawn("bsk", args, { cwd: ctx.projectRoot });
  let output = "";
  for await (const chunk of proc.stdout) output += chunk;
  const match = output.match(/[A-Za-z0-9]{4,}/);
  if (!match) throw new Error(`Could not parse session ID from bsk output: ${output.trim()}`);
  return { sessionId: match[0], browser: input.browser as string | undefined };
};

export interface BrowserCommandOutput {
  stdout: string;
  exitCode: number;
}

export const browserCommandDefinition: ActionDefinition = {
  id: "browser.command",
  description: "Execute a BrowserSkill command (navigate, snapshot, click, fill, evaluate, etc.) on an active session.",
  category: "browser",
  parameters: {
    type: "object",
    properties: {
      session: { type: "string", description: "Active session ID from browser.session_start" },
      subcommand: {
        type: "string",
        description: "bsk subcommand: navigate, snapshot, click, fill, evaluate, scroll, etc.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Additional arguments for the subcommand (e.g. URL for navigate).",
      },
    },
    required: ["session", "subcommand"],
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess"],
};

export const browserCommandRun: ActionRun<Record<string, unknown>, BrowserCommandOutput> = async (input, ctx) => {
  const args = [String(input.subcommand), "--session", String(input.session)];
  if (Array.isArray(input.args)) {
    for (const a of input.args) args.push(String(a));
  }
  const proc = ctx.spawner.spawn("bsk", args, { cwd: ctx.projectRoot });
  let stdout = "";
  for await (const chunk of proc.stdout) stdout += chunk;
  const exit = await proc.exited;
  return { stdout, exitCode: exit.code };
};

export const browserSessionStopDefinition: ActionDefinition = {
  id: "browser.session-stop",
  description: "Stop a BrowserSkill browser session and release the browser.",
  category: "browser",
  parameters: {
    type: "object",
    properties: {
      session: { type: "string", description: "Session ID to stop" },
    },
    required: ["session"],
    additionalProperties: false,
  },
  sideEffects: ["spawn-subprocess"],
};

export const browserSessionStopRun: ActionRun<Record<string, unknown>, { stopped: boolean; session: string }> = async (
  input,
  ctx
) => {
  const proc = ctx.spawner.spawn("bsk", ["session", "stop", "--session", String(input.session)], {
    cwd: ctx.projectRoot,
  });
  await proc.exited;
  return { stopped: true, session: String(input.session) };
};
