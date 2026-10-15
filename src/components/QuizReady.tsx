import { QUESTION_TYPE_LABELS, type Quiz } from "../lib/quiz/types";

interface Props {
  quiz: Quiz;
  onStart: () => void;
  onBack: () => void;
}

export function QuizReady({ quiz, onStart, onBack }: Props) {
  const perCategory = quiz.categories
    .map((c) => ({ c, n: quiz.questions.filter((q) => q.category === c.id).length }))
    .filter((x) => x.n > 0);
  const types = [...new Set(quiz.questions.map((q) => q.type))];

  return (
    <section className="card quiz-ready" aria-labelledby="ready-title">
      <p className="eyebrow">Quiz ready</p>
      <h2 id="ready-title" className="article-title">
        {quiz.article.displayTitle}
      </h2>
      <p className="article-stats">
        <span>{quiz.questions.length} questions</span>
        <span aria-hidden="true">·</span>
        <span>{types.map((t) => QUESTION_TYPE_LABELS[t].toLowerCase()).join(", ")}</span>
      </p>

      {quiz.warnings.map((w) => (
        <p key={w} className="notice notice-warn small">
          {w}
        </p>
      ))}

      <h3 className="subhead">Topics covered</h3>
      <ul className="category-chips">
        {perCategory.map(({ c, n }) => (
          <li key={c.id} title={c.description}>
            <span>{c.name}</span>
            <span className="chip-count">{n}</span>
          </li>
        ))}
      </ul>

      <div className="ready-actions">
        <button type="button" className="btn btn-primary btn-large" onClick={onStart} autoFocus>
          Start quiz
        </button>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Change options
        </button>
      </div>
    </section>
  );
}
