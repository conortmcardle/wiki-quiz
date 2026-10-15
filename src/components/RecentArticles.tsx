import type { HistoryIndexEntry } from "../lib/storage/history";

interface Props {
  entries: HistoryIndexEntry[];
  onOpen: (entry: HistoryIndexEntry) => void;
}

export function RecentArticles({ entries, onOpen }: Props) {
  if (entries.length === 0) return null;
  return (
    <section className="card recent" aria-labelledby="recent-title">
      <h2 id="recent-title" className="section-title">
        Your articles
      </h2>
      <ul className="recent-list">
        {entries.slice(0, 8).map((e) => (
          <li key={`${e.lang}:${e.pageId}`}>
            <button type="button" className="recent-item" onClick={() => onOpen(e)}>
              <span className="recent-title">
                {e.displayTitle}
                {e.lang !== "en" && <span className="tag">{e.lang}</span>}
              </span>
              <span className="muted small">
                {e.attempts} {e.attempts === 1 ? "quiz" : "quizzes"} · last score {Math.round(e.lastPct * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
