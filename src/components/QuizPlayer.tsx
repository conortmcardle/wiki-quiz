import { useCallback, useState } from "react";
import { gradeAnswer } from "../lib/grading/grade";
import { currentIndex, scoreOf, type QuizSession } from "../lib/quiz/session";
import { AnswerFeedback } from "./AnswerFeedback";
import { QuestionView } from "./QuestionView";

interface Props {
  session: QuizSession;
  /** Called after every answer (for saving progress). */
  onChange: (session: QuizSession) => void;
  onFinish: (session: QuizSession) => void;
  onQuit: () => void;
}

export function QuizPlayer({ session, onChange, onFinish, onQuit }: Props) {
  const { quiz } = session;
  // Index of the question on screen. It runs one behind answers.length while
  // feedback for the latest answer is showing.
  const [shown, setShown] = useState(() => Math.min(currentIndex(session), quiz.questions.length - 1));
  const [confirmQuit, setConfirmQuit] = useState(false);

  const question = quiz.questions[shown]!;
  const answer = session.answers.find((a) => a.questionId === question.id);
  const isLast = shown === quiz.questions.length - 1;
  const { correct } = scoreOf(session);
  const categoryName = quiz.categories.find((c) => c.id === question.category)?.name ?? question.category;

  const onAnswer = useCallback(
    (response: string) => {
      if (session.answers.some((a) => a.questionId === question.id)) return;
      const grade = gradeAnswer(question, response, quiz.article.lang);
      const next: QuizSession = {
        ...session,
        answers: [
          ...session.answers,
          {
            questionId: question.id,
            response,
            correct: grade.correct,
            how: grade.how,
            ...(grade.matched ? { matched: grade.matched } : {}),
            answeredAt: new Date().toISOString(),
          },
        ],
      };
      onChange(next);
    },
    [session, question, quiz.article.lang, onChange],
  );

  const onNext = () => {
    if (isLast) {
      onFinish({ ...session, finishedAt: new Date().toISOString() });
    } else {
      setShown((i) => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const progress = (session.answers.length / quiz.questions.length) * 100;

  return (
    <section className="card player" aria-label={`Quiz on ${quiz.article.displayTitle}`}>
      <div className="player-head">
        <div>
          <p className="eyebrow">
            {session.mode === "retry-missed" ? "Retrying missed questions · " : ""}
            {quiz.article.displayTitle}
          </p>
          <p className="player-count">
            Question {shown + 1} <span className="muted">of {quiz.questions.length}</span>
          </p>
        </div>
        <div className="player-score" aria-label={`Score: ${correct} correct so far`}>
          <span className="score-num">{correct}</span>
          <span className="muted small">correct</span>
        </div>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={quiz.questions.length}
        aria-valuenow={session.answers.length}
        aria-label="Quiz progress"
      >
        <div className="progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <QuestionView question={question} categoryName={categoryName} answer={answer} onAnswer={onAnswer} />

      {answer && <AnswerFeedback question={question} answer={answer} article={quiz.article} isLast={isLast} onNext={onNext} />}

      <div className="player-foot">
        {confirmQuit ? (
          <p className="quit-confirm">
            Quit this quiz? Your answers so far won't be saved.{" "}
            <button type="button" className="btn btn-danger btn-small" onClick={onQuit}>
              Quit
            </button>{" "}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmQuit(false)}>
              Keep playing
            </button>
          </p>
        ) : (
          <button type="button" className="link-button" onClick={() => setConfirmQuit(true)}>
            Quit quiz
          </button>
        )}
      </div>
    </section>
  );
}
