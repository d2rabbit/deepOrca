// Tuning constants for the session engine (split of session.ts).
import { formatSessionPrompt } from "./common/session-prompts";
import type { PermissionScope } from "./settings";

export const MAX_SESSION_ENTRIES = 50;

export const BACKGROUND_FAILURE_LOG_TAIL_CHARS = 4000;

/** Retry window after a failed router/embedding load (R4 backoff). */
export const ROUTING_LOAD_RETRY_BACKOFF_MS = 60_000;

/** Subagent nesting cap (deep review 2026-08-15, B6). */
export const MAX_SUBAGENT_DEPTH = 4;

// Compaction wants faithful, reproducible summaries — a fixed low temperature
// (instead of the user's conversational setting) keeps them deterministic.
export const COMPACTION_TEMPERATURE = 0.3;

export const PLAN_MODE_ON_STATUS_MESSAGE = () => formatSessionPrompt("planModeOn");

export const PLAN_MODE_OFF_STATUS_MESSAGE = () => formatSessionPrompt("planModeOff");

export const PLAN_MODE_FORCE_ASK_SCOPES = [
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "mutate-git-log",
] as const satisfies readonly PermissionScope[];
