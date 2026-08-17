import { useEffect, useState, type JSX } from "react";
import type { AskUserQuestionAnswers, AskUserQuestionItem } from "../lib/ask-question";
import { useI18n } from "../i18n";
import { Button, Card, CardHeader, Row } from "../ui/index";

type Props = {
  questions: AskUserQuestionItem[];
  onSubmit: (answers: AskUserQuestionAnswers) => void;
  onCancel: () => void;
};

/**
 * Renders the AskUserQuestion tool call as selectable option groups. Supports
 * single- and multi-select questions, then emits a { question: answer } map.
 */
export function QuestionCard({ questions, onSubmit, onCancel }: Props): JSX.Element {
  const { t } = useI18n();
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [textAnswers, setTextAnswers] = useState<Record<number, string>>({});

  function toggle(qIndex: number, label: string, multi: boolean): void {
    setSelections((prev) => {
      const next = { ...prev };
      const current = new Set(next[qIndex] ?? []);
      if (multi) {
        if (current.has(label)) {
          current.delete(label);
        } else {
          current.add(label);
        }
      } else {
        current.clear();
        current.add(label);
      }
      next[qIndex] = current;
      return next;
    });
  }

  const answered = questions.every((_, i) => {
    if (questions[i]?.inputType === "text") {
      return (textAnswers[i] ?? "").trim().length > 0;
    }
    return (selections[i]?.size ?? 0) > 0;
  });

  // Keyboard: number keys select options for the first unanswered question
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const num = parseInt(e.key, 10);
      if (num < 1 || num > 9) return;
      // Find first unanswered question
      const qIdx = questions.findIndex((_, i) => (selections[i]?.size ?? 0) === 0);
      if (qIdx === -1) return;
      const q = questions[qIdx]!;
      const optIdx = num - 1;
      if (optIdx < q.options.length) {
        toggle(qIdx, q.options[optIdx]!.label, q.multiSelect === true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function submit(): void {
    const answers: AskUserQuestionAnswers = {};
    questions.forEach((q, i) => {
      if (q.inputType === "text") {
        const text = (textAnswers[i] ?? "").trim();
        if (text) {
          answers[q.question] = text;
        }
      } else {
        const picked = Array.from(selections[i] ?? []);
        if (picked.length > 0) {
          answers[q.question] = picked.join(", ");
        }
      }
    });
    onSubmit(answers);
  }

  return (
    <Card className="ui-card-enter">
      <CardHeader>{t("question.title")}</CardHeader>
      {questions.map((q, qIndex) => (
        <div key={qIndex} className="ui-q-block">
          <div className="ui-q-text">
            {q.question}
            {q.multiSelect ? (
              <span style={{ color: "var(--ui-text-faint)", fontWeight: 400 }}>{t("question.selectAny")}</span>
            ) : null}
          </div>
          {q.inputType === "text" ? (
            <input
              className="ui-q-text-input"
              type="text"
              placeholder={q.placeholder ?? "Type your answer…"}
              value={textAnswers[qIndex] ?? ""}
              onChange={(e) => setTextAnswers((prev) => ({ ...prev, [qIndex]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answered) {
                  e.preventDefault();
                  submit();
                }
              }}
              autoFocus={qIndex === 0}
            />
          ) : (
            <div className="ui-opt-row">
              {q.options.map((opt) => {
                const selected = selections[qIndex]?.has(opt.label) ?? false;
                return (
                  <button
                    key={opt.label}
                    className={`ui-opt${selected ? " selected" : ""}`}
                    onClick={() => toggle(qIndex, opt.label, q.multiSelect === true)}
                  >
                    {opt.label}
                    {opt.description ? <span className="ui-opt-desc">{opt.description}</span> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
      <Row justify="flex-end">
        <Button variant="primary" size="sm" onClick={submit} disabled={!answered}>
          {t("common.submit")}
        </Button>
        <Button size="sm" onClick={onCancel}>
          {t("common.skip")}
        </Button>
      </Row>
    </Card>
  );
}
