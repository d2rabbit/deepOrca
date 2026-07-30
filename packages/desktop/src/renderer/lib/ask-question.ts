// Ported from the CLI's ask-user-question core so the desktop UI can detect and
// answer AskUserQuestion tool calls.

import type { SessionMessage } from "../../shared/ipc";

export type AskUserQuestionOption = { label: string; description?: string };
export type AskUserQuestionItem = {
  question: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
  /** If "text", render a free-text input instead of option buttons. */
  inputType?: "text" | "choice";
  /** Placeholder for text input. */
  placeholder?: string;
};
export type PendingAskUserQuestion = { messageId: string; sessionId: string; questions: AskUserQuestionItem[] };
export type AskUserQuestionAnswers = Record<string, string>;

export function findPendingAskUserQuestion(
  messages: SessionMessage[],
  status: string | null
): PendingAskUserQuestion | null {
  if (status !== "waiting_for_user") {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "tool" || message.visible === false) {
      continue;
    }
    const questions = parseContent(message.content);
    if (questions.length === 0) {
      continue;
    }
    return { messageId: message.id, sessionId: message.sessionId, questions };
  }
  return null;
}

export function formatAskUserQuestionAnswers(answers: AskUserQuestionAnswers): string {
  const text = Object.entries(answers)
    .map(([q, a]) => `"${escape(q)}"="${escape(a)}"`)
    .join(", ");
  return `User has answered your questions: ${text}. You can now continue with the user's answers in mind.`;
}

export function formatAskUserQuestionDecline(): string {
  return "The user declined to answer the questions. Continue with the available context, or ask again if the information is required.";
}

function parseContent(content: string | null): AskUserQuestionItem[] {
  if (!content) {
    return [];
  }
  try {
    const parsed = JSON.parse(content) as { awaitUserResponse?: unknown; metadata?: unknown };
    if (parsed.awaitUserResponse !== true) {
      return [];
    }
    const metadata = parsed.metadata as { kind?: unknown; questions?: unknown } | null;
    if (!metadata || metadata.kind !== "ask_user_question") {
      return [];
    }
    return normalizeQuestions(metadata.questions);
  } catch {
    return [];
  }
}

function normalizeQuestions(raw: unknown): AskUserQuestionItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const questions: AskUserQuestionItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const question =
      typeof (item as { question?: unknown }).question === "string"
        ? (item as { question: string }).question.trim()
        : "";
    const rawOptions = (item as { options?: unknown }).options;
    if (!question || !Array.isArray(rawOptions) || rawOptions.length === 0) {
      continue;
    }
    const options = rawOptions.map((o) => normalizeOption(o)).filter((o): o is AskUserQuestionOption => Boolean(o));
    if (options.length === 0) {
      continue;
    }
    const multiSelect =
      typeof (item as { multiSelect?: unknown }).multiSelect === "boolean"
        ? (item as { multiSelect: boolean }).multiSelect
        : undefined;
    questions.push({ question, multiSelect, options });
  }
  return questions;
}

function normalizeOption(raw: unknown): AskUserQuestionOption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const label = typeof (raw as { label?: unknown }).label === "string" ? (raw as { label: string }).label.trim() : "";
  if (!label) {
    return null;
  }
  const description =
    typeof (raw as { description?: unknown }).description === "string"
      ? (raw as { description: string }).description.trim()
      : "";
  return { label, description: description || undefined };
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
}
