import type { ReactNode } from "react";
import { languageName, sectionUrl } from "../lib/wikipedia/fetchArticle";
import type { Article } from "../lib/wikipedia/types";

interface Props {
  article: Article;
  onChangeArticle: () => void;
  children?: ReactNode;
}

export function ArticleOverview({ article, onChangeArticle, children }: Props) {
  return (
    <section className="card article-overview" aria-labelledby="article-title">
      <div className="article-head">
        <div>
          <p className="eyebrow">{languageName(article.lang)} Wikipedia</p>
          <h2 id="article-title" className="article-title">
            <a href={article.url} target="_blank" rel="noreferrer">
              {article.displayTitle}
            </a>
          </h2>
          {article.redirectedFrom && (
            <p className="muted small">Redirected from “{article.redirectedFrom}”</p>
          )}
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={onChangeArticle}>
          Change
        </button>
      </div>

      <p className="article-stats">
        <span>{article.wordCount.toLocaleString()} words</span>
        <span aria-hidden="true">·</span>
        <span>{article.sections.length} sections</span>
      </p>

      <details className="section-outline">
        <summary>Article sections</summary>
        <ol>
          {article.sections.map((s) => (
            <li key={s.id}>
              {s.path.length > 1 && <span className="muted">{s.path.slice(0, -1).join(" › ")} › </span>}
              <a href={sectionUrl(article, s.anchor)} target="_blank" rel="noreferrer">
                {s.title}
              </a>
              <span className="muted small"> · {s.wordCount.toLocaleString()} words</span>
            </li>
          ))}
        </ol>
      </details>

      {children}
    </section>
  );
}
