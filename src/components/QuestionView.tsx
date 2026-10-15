import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AnswerRecord } from "../lib/quiz/session";
import { QUESTION_TYPE_LABELS, type Question } from "../lib/quiz/types";
import { BLANK } from "../lib/quiz/validate";

interface Props {
  question: Question;
  categoryName: string;
  /** Set once answered: locks the inputs and shows right/wrong styling. */
  answer?: AnswerRecord;
  onAnswer: (response: string) => void;
}

const LETTERS = ["A", "B", "C", "D"];
const DIFFICULTY_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

export function QuestionView({ question, categoryName, answer, onAnswer }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answered = answer !== undefined;
  const typed = question.type === "short_answer" || question.type === "fill_blank";

  // New question: reset input and move focus somewhere sensible.
  useEffect(() => {
    setText("");
    if (typed) inputRef.current?.focus({ preventScroll: true });
    else headingRef.current?.focus({ preventScroll: true });
  }, [question.id, typed]);

  // Keyboard shortcuts for choice questions: 1–4 / A–D, T / F.
  useEffect(() => {
    if (answered || typed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (question.type === "multiple_choice" && question.options) {
        const i = "1234".indexOf(k) !== -1 ? "1234".indexOf(k) : "abcd".indexOf(k);
        if (i !== -1 && question.options[i]) {
          e.preventDefault();
          onAnswer(question.options[i]!);
        }
      } else if (question.type === "true_false" && (k === "t" || k === "f")) {
        e.preventDefault();
        onAnswer(k === "t" ? "true" : "false");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answered, typed, question, onAnswer]);

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    if (!answered && text.trim()) onAnswer(text.trim());
  };

  const choiceClass = (value: string) => {
    if (!answered) return "choice";
    const isCorrect = value.toLowerCase() === question.correctAnswer.toLowerCase();
    const isPicked = value === answer.response;
    return `choice ${isCorrect ? "choice-correct" : isPicked ? "choice-wrong" : "choice-dim"}`;
  };

  return (
    <div className="question">
      <div className="question-meta">
        <span className="tag tag-category">{categoryName}</span>
        <span className="tag">{QUESTION_TYPE_LABELS[question.type]}</span>
        <span className={`tag tag-${question.difficulty}`}>{DIFFICULTY_LABELS[question.difficulty]}</span>
      </div>

      <h2 className="question-prompt" ref={headingRef} tabIndex={-1}>
        {question.type === "fill_blank" ? <FillBlankPrompt prompt={question.prompt} value={answered ? answer.response : text} /> : question.prompt}
      </h2>

      {question.type === "multiple_choice" && question.options && (
        <ol className="choices" aria-label="Options">
          {question.options.map((opt, i) => (
            <li key={opt}>
              <button
                type="button"
                className={choiceClass(opt)}
                disabled={answered}
                aria-pressed={answered && answer.response === opt ? true : undefined}
                onClick={() => onAnswer(opt)}
              >
                <span className="choice-key" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                <span className="choice-text">{opt}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {question.type === "true_false" && (
        <div className="choices tf-choices" role="group" aria-label="True or false">
          {(["true", "false"] as const).map((v) => (
            <button key={v} type="button" className={choiceClass(v)} disabled={answered} onClick={() => onAnswer(v)}>
              <span className="choice-key" aria-hidden="true">
                {v === "true" ? "T" : "F"}
              </span>
              <span className="choice-text">{v === "true" ? "True" : "False"}</span>
            </button>
          ))}
        </div>
      )}

      {typed && (
        <form className="typed-answer" onSubmit={submitTyped}>
          <label htmlFor={`answer-${question.id}`} className="visually-hidden">
            Your answer
          </label>
          <input
            ref={inputRef}
            id={`answer-${question.id}`}
            className={`text-input ${answered ? (answer.correct ? "input-correct" : "input-wrong") : ""}`}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder={question.type === "fill_blank" ? "Fill in the blank" : "Type your answer"}
            value={answered ? answer.response : text}
            onChange={(e) => setText(e.target.value)}
            readOnly={answered}
          />
          {!answered && (
            <div className="typed-actions">
              <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
                Check answer
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onAnswer("")}>
                I don't know
              </button>
            </div>
          )}
        </form>
      )}

      {!answered && !typed && (
        <p className="muted small key-hint">
          {question.type === "multiple_choice" ? "Tip: press 1–4 or A–D." : "Tip: press T or F."}
        </p>
      )}
    </div>
  );
}

function FillBlankPrompt({ prompt, value }: { prompt: string; value: string }) {
  const [before, after] = prompt.split(BLANK);
  return (
    <>
      {before}
      <span className={`blank ${value ? "filled" : ""}`} aria-label={value ? `blank: ${value}` : "blank"}>
        {value || "   "}
      </span>
      {after}
    </>
  );
}
