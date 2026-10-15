import type { QuizSession } from "../quiz/session";
import type { QuestionType } from "../quiz/types";
import type { Tally } from "../results/analyze";

/**
 * Attempt history per article, in localStorage, so you can see whether weak
 * areas improve over repeated attempts. Categories are stable per article
 * (see storage/categories.ts), so per-category scores are comparable.
 */

export type AttemptMode = "full" | "focus" | "retry-missed";

export interface AttemptSummary {
  id: string;
  date: string;
  mode: AttemptMode;
  model: string;
  correct: number;
  total: number;
  byCategory: Record<string, Tally>;
  byType: Partial<Record<QuestionType, Tally>>;
  /** Question prompts (kept for recent attempts) so new quizzes avoid repeats. */
  prompts?: string[];
}

export interface ArticleHistory {
  version: 1;
  article: { lang: string; title: string; displayTitle: string; url: string; pageId: number };
  categoryNames: Record<string, string>;
  attempts: AttemptSummary[];
}

export interface HistoryIndexEntry {
  lang: string;
  pageId: number;
  title: string;
  displayTitle: string;
  url: string;
  lastPlayed: string;
  attempts: number;
  lastPct: number;
}

const MAX_ATTEMPTS = 50;
const KEEP_PROMPTS_FOR = 10;
const INDEX_KEY = "wikiquiz.history.index.v1";
const PREFIX = "wikiquiz.";

function key(lang: string, pageId: number): string {
  return `wikiquiz.history.v1.${lang}:${pageId}`;
}

function read<T>(k: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(k, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function attemptMode(session: QuizSession): AttemptMode {
  if (session.mode === "retry-missed") return "retry-missed";
  return session.quiz.config.categoryWeights ? "focus" : "full";
}

export function summarize(session: QuizSession): AttemptSummary {
  const answers = new Map(session.answers.map((a) => [a.questionId, a]));
  const byCategory: Record<string, Tally> = {};
  const byType: Partial<Record<QuestionType, Tally>> = {};
  let correct = 0;
  for (const q of session.quiz.questions) {
    const ok = answers.get(q.id)?.correct === true;
    if (ok) correct++;
    const c = (byCategory[q.category] ??= { correct: 0, total: 0 });
    c.total++;
    if (ok) c.correct++;
    const t = (byType[q.type] ??= { correct: 0, total: 0 });
    t.total++;
    if (ok) t.correct++;
  }
  return {
    id: session.id,
    date: session.finishedAt ?? new Date().toISOString(),
    mode: attemptMode(session),
    model: session.quiz.model,
    correct,
    total: session.quiz.questions.length,
    byCategory,
    byType,
    prompts: session.quiz.questions.map((q) => q.prompt),
  };
}

export function loadHistory(lang: string, pageId: number): ArticleHistory | null {
  const h = read<ArticleHistory>(key(lang, pageId));
  return h && h.version === 1 && Array.isArray(h.attempts) ? h : null;
}

/** Save a finished session (idempotent per session id). Returns the updated history. */
export function recordAttempt(session: QuizSession): ArticleHistory {
  const { article, categories } = session.quiz;
  const existing = loadHistory(article.lang, article.pageId);
  const history: ArticleHistory = existing ?? {
    version: 1,
    article: {
      lang: article.lang,
      title: article.title,
      displayTitle: article.displayTitle,
      url: article.url,
      pageId: article.pageId,
    },
    categoryNames: {},
    attempts: [],
  };
  for (const c of categories) history.categoryNames[c.id] = c.name;

  const summary = summarize(session);
  if (!history.attempts.some((a) => a.id === summary.id)) {
    history.attempts.push(summary);
    history.attempts = history.attempts.slice(-MAX_ATTEMPTS);
    // Only recent attempts keep their prompts (enough to avoid repeats).
    history.attempts.forEach((a, i) => {
      if (i < history.attempts.length - KEEP_PROMPTS_FOR) delete a.prompts;
    });
  }
  write(key(article.lang, article.pageId), history);
  updateIndex(history);
  return history;
}

function updateIndex(history: ArticleHistory): void {
  const index = (read<HistoryIndexEntry[]>(INDEX_KEY) ?? []).filter(
    (e) => !(e.lang === history.article.lang && e.pageId === history.article.pageId),
  );
  const last = [...history.attempts].reverse().find((a) => a.mode !== "retry-missed") ?? history.attempts.at(-1);
  index.unshift({
    ...history.article,
    lastPlayed: last?.date ?? new Date().toISOString(),
    attempts: history.attempts.length,
    lastPct: last && last.total ? last.correct / last.total : 0,
  });
  write(INDEX_KEY, index.slice(0, 30));
}

/** Articles you've played, most recent first. */
export function listHistoryArticles(): HistoryIndexEntry[] {
  return read<HistoryIndexEntry[]>(INDEX_KEY) ?? [];
}

/** Prompts from recent attempts, newest first, for "avoid repeats". */
export function recentPrompts(history: ArticleHistory | null, max = 60): string[] {
  if (!history) return [];
  const out: string[] = [];
  for (const a of [...history.attempts].reverse()) {
    for (const p of a.prompts ?? []) {
      if (out.length >= max) return out;
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export interface CategoryTrend {
  /** Full and focus attempts, oldest first (retry-missed rounds are left out). */
  attempts: AttemptSummary[];
  rows: { id: string; name: string; cells: (Tally | null)[] }[];
}

/** Per-category scores across the last `max` attempts. */
export function categoryTrend(history: ArticleHistory, max = 6): CategoryTrend {
  const attempts = history.attempts.filter((a) => a.mode !== "retry-missed").slice(-max);
  const ids = Object.keys(history.categoryNames).filter((id) => attempts.some((a) => a.byCategory[id]));
  return {
    attempts,
    rows: ids.map((id) => ({
      id,
      name: history.categoryNames[id] ?? id,
      cells: attempts.map((a) => a.byCategory[id] ?? null),
    })),
  };
}

/** Remove every saved quiz, category set and attempt (keeps the API key and settings). */
export function clearQuizData(): void {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    const doomed: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (
        k &&
        k.startsWith(PREFIX) &&
        (k.startsWith("wikiquiz.history.") || k.startsWith("wikiquiz.categories.") || k.startsWith("wikiquiz.activeSession."))
      ) {
        doomed.push(k);
      }
    }
    doomed.forEach((k) => ls.removeItem(k));
  } catch {
    /* ignore */
  }
}
