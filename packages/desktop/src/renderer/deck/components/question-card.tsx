// AskUserQuestion decision block: the engine's awaitUserResponse tool call
// rendered as an accent-ringed decision card (设计稿 decision-block). Without
// it a waiting_for_user session had no answer surface in the Deck at all.
// Pure-TS parsing/formatting is shared with the classic layer
// (renderer/lib/ask-question); only the visual shell is deck-local.
import { useEffect, useState, type JSX } from "react";
import type { AskUserQuestionAnswers, AskUserQuestionItem } from "../../lib/ask-question";
import { useI18n } from "../../i18n";
import { GiIcon } from "../icons";

export function QuestionBlock(props: {
  questions: AskUserQuestionItem[];
  onSubmit(answers: AskUserQuestionAnswers): void;
  onDecline(): void;
}): JSX.Element {
  const { t } = useI18n();
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [textAnswers, setTextAnswers] = useState<Record<number, string>>({});

  const toggle = (qIndex: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[qIndex] ?? []);
      if (multi) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [qIndex]: current };
    });
  };

  // Number keys pick options for the first unanswered question (design demo
  // parity: 1/2/3 作答） — never while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const num = parseInt(e.key, 10);
      if (num < 1 || num > 9) return;
      const qIdx = props.questions.findIndex((q, i) => q.inputType !== "text" && (selections[i]?.size ?? 0) === 0);
      if (qIdx === -1) return;
      const q = props.questions[qIdx];
      const opt = q?.options[num - 1];
      if (q && opt) {
        e.preventDefault();
        toggle(qIdx, opt.label, q.multiSelect === true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const answered = props.questions.every((q, i) =>
    q.inputType === "text" ? (textAnswers[i] ?? "").trim().length > 0 : (selections[i]?.size ?? 0) > 0
  );

  const submit = () => {
    const answers: AskUserQuestionAnswers = {};
    props.questions.forEach((q, i) => {
      if (q.inputType === "text") {
        const text = (textAnswers[i] ?? "").trim();
        if (text) answers[q.question] = text;
      } else {
        const picked = [...(selections[i] ?? [])];
        if (picked.length > 0) answers[q.question] = picked.join(", ");
      }
    });
    props.onSubmit(answers);
  };

  return (
    <section className="deck-decision deck-gc" aria-label={t("deck.question.title")} data-test-id="deck-question">
      <div className="deck-decision-title">
        <GiIcon id="alert" lg /> {t("deck.question.title")}
      </div>
      {props.questions.map((q, qIndex) => (
        <div key={qIndex}>
          <div className="deck-decision-q">
            {q.question}
            {q.multiSelect ? <span className="dim">{t("deck.question.multi")}</span> : null}
          </div>
          {q.inputType === "text" ? (
            <input
              className="deck-decision-text"
              type="text"
              placeholder={q.placeholder ?? t("deck.question.textPlaceholder")}
              value={textAnswers[qIndex] ?? ""}
              onChange={(e) => setTextAnswers((prev) => ({ ...prev, [qIndex]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answered) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          ) : (
            <div className="deck-decision-opts">
              {q.options.map((opt, optIndex) => {
                const selected = selections[qIndex]?.has(opt.label) ?? false;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`deck-decision-opt${selected ? " sel" : ""}`}
                    onClick={() => toggle(qIndex, opt.label, q.multiSelect === true)}
                  >
                    <span className="deck-kbd">{optIndex + 1}</span>
                    <span>
                      {opt.label}
                      {opt.description ? <span className="desc"> — {opt.description}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <div className="deck-pending-submit">
        <button type="button" className="deck-op" onClick={props.onDecline}>
          {t("deck.question.decline")}
        </button>
        <button type="button" className="deck-op primary" disabled={!answered} onClick={submit}>
          {t("common.submit")}
        </button>
      </div>
    </section>
  );
}
