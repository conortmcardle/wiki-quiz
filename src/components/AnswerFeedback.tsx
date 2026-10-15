import { useEffect, useRef } from "react";
import type { AnswerRecord } from "../lib/quiz/session";
import type { Question, QuizArticleInfo } from "../lib/quiz/types";
import { sectionUrl } from "../lib/wikipedia/fetchArticle";

interface Props {
  question: Question;
  answer: AnswerRecord;
  article: QuizArticleInfo;
  isLast: boolean;
  onNext: () => void;
}

export function displayAnswer(q: Question): string {
  if (q.type === "true_false") return q.correctAnswer === "true" ? "True" : "False";
  return q.correctAnswer;
}

export function AnswerFeedback({ question, answer, article, isLast, onNext }: Props) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
    nextRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [question.id]);

  const section = article.sections[question.sourceSection];
  const link = sectionUrl(article, section?.anchor ?? "");
  const typed = question.type === "short_answer" || question.type === "fill_blank";

  let verdict: string;
  if (answer.correct) {
    verdict =
      answer.how === "typo"
        ? "Correct (small typo accepted)"
        : answer.how === "alias" || answer.how === "number"
          ? "Correct"
          : "Correct!";
  } else {
    verdict = answer.how === "empty" ? "Skipped" : "Not quite";
  }

  return (
    <div className={`feedback ${answer.correct ? "feedback-correct" : "feedback-wrong"}`} role="status" aria-live="polite">
      <p className="feedback-verdict">
        <span className="feedback-icon" aria-hidden="true">
          {answer.correct ? "✓" : "✗"}
        </span>
        {verdict}
      </p>

      {(!answer.correct || answer.how === "typo") && (
        <p className="feedback-answer">
          {answer.correct ? "Exact spelling: " : "Correct answer: "}
          <strong>{displayAnswer(question)}</strong>
          {typed && !answer.correct && question.acceptableAnswers.length > 0 && (
            <span className="muted small"> (also accepted: {question.acceptableAnswers.slice(0, 4).join(", ")})</span>
          )}
        </p>
      )}
      {typed && !answer.correct && answer.response && (
        <p className="muted small">You answered: “{answer.response}”</p>
      )}

      <p className="feedback-explanation">{question.explanation}</p>

      <blockquote className="source-quote">
        <p>“{question.sourceQuote}”</p>
        <footer>
          <a href={link} target="_blank" rel="noreferrer">
            {section ? `Read “${section.title}” on Wikipedia` : "Read the article on Wikipedia"}
            <span aria-hidden="true"> ↗</span>
          </a>
        </footer>
      </blockquote>

      <button ref={nextRef} type="button" className="btn btn-primary btn-block btn-large" onClick={onNext}>
        {isLast ? "See results" : "Next question"}
      </button>
    </div>
  );
}
