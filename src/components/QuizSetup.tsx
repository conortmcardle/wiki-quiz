import { useId, useState, type FormEvent } from "react";
import {
  DIFFICULTIES,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type DifficultySetting,
  type QuestionType,
  type QuizConfig,
} from "../lib/quiz/types";

interface Props {
  initial: QuizConfig;
  hasKey: boolean;
  onStart: (config: QuizConfig) => void;
}

const DIFFICULTY_LABELS: Record<DifficultySetting, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  mixed: "Mixed",
};

export function QuizSetup({ initial, hasKey, onStart }: Props) {
  const [types, setTypes] = useState<QuestionType[]>(initial.types);
  const [count, setCount] = useState(initial.count);
  const [difficulty, setDifficulty] = useState<DifficultySetting>(initial.difficulty);
  const id = useId();

  const toggleType = (t: QuestionType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : QUESTION_TYPES.filter((x) => x === t || prev.includes(x))));

  const valid = types.length > 0 && count >= MIN_QUESTIONS && count <= MAX_QUESTIONS;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onStart({ types, count, difficulty });
  };

  return (
    <form className="quiz-setup" onSubmit={submit}>
      <fieldset className="setup-group">
        <legend>Question types</legend>
        <div className="type-grid">
          {QUESTION_TYPES.map((t) => (
            <label key={t} className={`toggle ${types.includes(t) ? "on" : ""}`}>
              <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
              <span>{QUESTION_TYPE_LABELS[t]}</span>
            </label>
          ))}
        </div>
        {types.length === 0 && (
          <p className="field-error" role="alert">
            Pick at least one question type.
          </p>
        )}
      </fieldset>

      <div className="setup-row">
        <fieldset className="setup-group">
          <legend>
            <label htmlFor={`${id}-count`}>Number of questions</label>
          </legend>
          <div className="count-control">
            <input
              id={`${id}-count`}
              type="range"
              min={5}
              max={MAX_QUESTIONS}
              step={1}
              value={Math.min(Math.max(count, 5), MAX_QUESTIONS)}
              onChange={(e) => setCount(Number(e.target.value))}
              aria-valuetext={`${count} questions`}
            />
            <input
              className="text-input count-input"
              type="number"
              inputMode="numeric"
              min={MIN_QUESTIONS}
              max={MAX_QUESTIONS}
              value={count}
              onChange={(e) => setCount(Math.round(Number(e.target.value) || 0))}
              aria-label="Number of questions"
            />
          </div>
          {!(count >= MIN_QUESTIONS && count <= MAX_QUESTIONS) && (
            <p className="field-error" role="alert">
              Choose between {MIN_QUESTIONS} and {MAX_QUESTIONS} questions.
            </p>
          )}
        </fieldset>

        <fieldset className="setup-group">
          <legend>Difficulty</legend>
          <div className="segmented" role="radiogroup">
            {(["mixed", ...DIFFICULTIES] as DifficultySetting[]).map((d) => (
              <label key={d} className={difficulty === d ? "on" : ""}>
                <input type="radio" name={`${id}-difficulty`} value={d} checked={difficulty === d} onChange={() => setDifficulty(d)} />
                <span>{DIFFICULTY_LABELS[d]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <button type="submit" className="btn btn-primary btn-block btn-large" disabled={!valid}>
        Generate quiz
      </button>
      {!hasKey && <p className="field-hint center">You'll be asked for your Anthropic API key first.</p>}
    </form>
  );
}
