import { useMemo } from "react";
import { analyzeSession, pct, scoreMessage, WEAK_THRESHOLD, type SessionAnalysis } from "../lib/results/analyze";
import type { QuizSession } from "../lib/quiz/session";
import type { ArticleHistory } from "../lib/storage/history";
import { displayAnswer } from "./AnswerFeedback";
import { MeterChart } from "./MeterChart";
import { ProgressHistory } from "./ProgressHistory";

interface Props {
  session: QuizSession;
  history: ArticleHistory | null;
  onRetryMissed: () => void;
  onPracticeWeak: (analysis: SessionAnalysis) => void;
  onNewQuiz: () => void;
  onAnotherArticle: () => void;
}

export function Results({ session, history, onRetryMissed, onPracticeWeak, onNewQuiz, onAnotherArticle }: Props) {
  const analysis = useMemo(() => analyzeSession(session), [session]);
  const { quiz } = session;
  const isRetry = session.mode === "retry-missed";

  // Previous comparable attempt (full or practice quiz) for deltas.
  const previous = useMemo(() => {
    if (!history || isRetry) return null;
    const comparable = history.attempts.filter((a) => a.mode !== "retry-missed" && a.id !== session.id);
    return comparable[comparable.length - 1] ?? null;
  }, [history, isRetry, session.id]);

  const scoreDelta = previous ? Math.round((analysis.pct - previous.correct / previous.total) * 100) : null;
  const categoryRows = analysis.byCategory.map((r) => {
    const prev = previous?.byCategory[r.id];
    return prev && prev.total > 0 ? { ...r, previousPct: pct(prev) } : r;
  });
  const typeRows = analysis.byType.map((r) => {
    const prev = previous?.byType[r.id as keyof typeof previous.byType];
    return prev && prev.total > 0 ? { ...r, previousPct: pct(prev) } : r;
  });
  const canPractice = analysis.byCategory.some((r) => r.pct < 1);

  return (
    <div className="results">
      {/* Score */}
      <section className="card results-hero" aria-labelledby="results-title">
        <p className="eyebrow">{isRetry ? "Retry round" : "Results"}</p>
        <h2 id="results-title" className="article-title">
          <a href={quiz.article.url} target="_blank" rel="noreferrer">
            {quiz.article.displayTitle}
          </a>
        </h2>
        <div className="hero-score">
          <p className="hero-figure">
            {analysis.correct}
            <span className="hero-of">/{analysis.total}</span>
          </p>
          <div>
            <p className="hero-pct">{Math.round(analysis.pct * 100)}%</p>
            {scoreDelta !== null && scoreDelta !== 0 && (
              <p className={`small ${scoreDelta > 0 ? "delta-up" : "delta-down"}`}>
                <span aria-hidden="true">{scoreDelta > 0 ? "▲" : "▼"}</span> {Math.abs(scoreDelta)} points{" "}
                {scoreDelta > 0 ? "better" : "lower"} than last time
              </p>
            )}
            {scoreDelta === 0 && <p className="small muted">Same as last time</p>}
          </div>
        </div>
        <p className="hero-message">{scoreMessage(analysis.pct)}</p>
      </section>

      {/* Brush up on */}
      <section className={`card brush-up ${analysis.weakAreas.length ? "has-weak" : ""}`} aria-labelledby="brush-title">
        <h2 id="brush-title" className="section-title">
          Brush up on
        </h2>
        {analysis.weakAreas.length > 0 ? (
          <>
            <p className="muted small section-sub">
              Your weakest {analysis.weakAreas.length === 1 ? "topic" : "topics"} (below {Math.round(WEAK_THRESHOLD * 100)}%),
              with the parts of the article to reread.
            </p>
            <ol className="weak-list">
              {analysis.weakAreas.map((w) => (
                <li key={w.categoryId} className="weak-item">
                  <div className="weak-head">
                    <h3>
                      <span className="weak-icon" aria-hidden="true">
                        ⚠
                      </span>
                      {w.name}
                    </h3>
                    <span className="weak-score">
                      {w.correct}/{w.total} · {Math.round(w.pct * 100)}%
                      {w.total === 1 && <span className="muted small"> (1 question)</span>}
                    </span>
                  </div>
                  {w.description && <p className="muted small">{w.description}</p>}
                  <ul className="section-links">
                    {w.sections.map((s) => (
                      <li key={s.id}>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          Read “{s.title}”<span aria-hidden="true"> ↗</span>
                        </a>
                        {s.missed > 0 && (
                          <span className="muted small">
                            {" "}
                            · {s.missed} missed {s.missed === 1 ? "question" : "questions"}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </>
        ) : analysis.closestToWeak ? (
          <p>
            No weak spots: every topic scored {Math.round(WEAK_THRESHOLD * 100)}% or better. Your lowest was{" "}
            <strong>{analysis.closestToWeak.label}</strong> ({analysis.closestToWeak.correct}/{analysis.closestToWeak.total}).
          </p>
        ) : (
          <p>Nothing to brush up on: a perfect score! Try a harder quiz or another article.</p>
        )}

        <div className="results-actions">
          {analysis.missed.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={onRetryMissed}>
              Retry {analysis.missed.length} missed {analysis.missed.length === 1 ? "question" : "questions"}
            </button>
          )}
          {canPractice && (
            <button type="button" className="btn btn-secondary" onClick={() => onPracticeWeak(analysis)}>
              New quiz on my weak areas
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onNewQuiz}>
            New quiz on this article
          </button>
          <button type="button" className="btn btn-ghost" onClick={onAnotherArticle}>
            Try another article
          </button>
        </div>
      </section>

      {/* Breakdowns */}
      <section className="card" aria-labelledby="breakdown-title">
        <h2 id="breakdown-title" className="section-title">
          Breakdown
        </h2>
        {previous && <p className="muted small section-sub">▲▼ show the change in percentage points since your last quiz.</p>}
        <div className="breakdowns">
          <MeterChart title="By topic" rows={categoryRows} flagWeak />
          <MeterChart title="By question type" rows={typeRows} />
        </div>
      </section>

      {history && !isRetry && <ProgressHistory history={history} currentId={session.id} />}

      {/* Missed questions */}
      {analysis.missed.length > 0 && (
        <section className="card" aria-labelledby="missed-title">
          <h2 id="missed-title" className="section-title">
            Questions you missed ({analysis.missed.length})
          </h2>
          <ol className="missed-list">
            {analysis.missed.map(({ question, answer, categoryName, section }) => (
              <li key={question.id} className="missed-item">
                <p className="missed-prompt">{question.prompt}</p>
                <dl className="missed-answers">
                  <div>
                    <dt>Your answer</dt>
                    <dd className={answer.response ? "wrong-answer" : "muted"}>
                      {answer.response
                        ? question.type === "true_false"
                          ? answer.response === "true"
                            ? "True"
                            : "False"
                          : answer.response
                        : "(skipped)"}
                    </dd>
                  </div>
                  <div>
                    <dt>Correct answer</dt>
                    <dd className="right-answer">{displayAnswer(question)}</dd>
                  </div>
                </dl>
                <p className="muted small">
                  {question.explanation}{" "}
                  <span className="missed-meta">
                    {categoryName}
                    {section && (
                      <>
                        {" · "}
                        <a href={section.url} target="_blank" rel="noreferrer">
                          {section.title}
                          <span aria-hidden="true"> ↗</span>
                        </a>
                      </>
                    )}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
