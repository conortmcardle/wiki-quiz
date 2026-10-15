import type { AnswerRecord, QuizSession } from "../quiz/session";
import { QUESTION_TYPE_LABELS, type Question, type QuestionType } from "../quiz/types";
import { sectionUrl } from "../wikipedia/fetchArticle";

/** A category below this accuracy goes in "Brush up on". */
export const WEAK_THRESHOLD = 0.7;
/** At most this many categories are called out as weak. */
export const MAX_WEAK_AREAS = 3;

export interface Tally {
  correct: number;
  total: number;
}

export interface BreakdownRow extends Tally {
  id: string;
  label: string;
  pct: number;
  weak: boolean;
}

export interface SectionLink {
  id: string;
  title: string;
  url: string;
  /** Questions missed from this section. */
  missed: number;
}

export interface WeakArea extends Tally {
  categoryId: string;
  name: string;
  description: string;
  pct: number;
  sections: SectionLink[];
}

export interface MissedItem {
  question: Question;
  answer: AnswerRecord;
  categoryName: string;
  section?: SectionLink;
}

export interface SessionAnalysis extends Tally {
  pct: number;
  byCategory: BreakdownRow[];
  byType: BreakdownRow[];
  weakAreas: WeakArea[];
  /** Lowest category when nothing is weak but the score isn't perfect. */
  closestToWeak?: BreakdownRow;
  missed: MissedItem[];
}

export function pct(t: Tally): number {
  return t.total === 0 ? 0 : t.correct / t.total;
}

export function analyzeSession(session: QuizSession): SessionAnalysis {
  const { quiz } = session;
  const answerById = new Map(session.answers.map((a) => [a.questionId, a]));
  const answered = quiz.questions.filter((q) => answerById.has(q.id));
  const isCorrect = (q: Question) => answerById.get(q.id)?.correct === true;

  const link = (sectionId: string, missed = 0): SectionLink | undefined => {
    const s = quiz.article.sections[sectionId];
    if (!s) return undefined;
    return { id: sectionId, title: s.title, url: sectionUrl(quiz.article, s.anchor), missed };
  };

  // By category, in the categories' own (stable) order.
  const byCategory: BreakdownRow[] = quiz.categories
    .map((c) => {
      const qs = answered.filter((q) => q.category === c.id);
      const t = { correct: qs.filter(isCorrect).length, total: qs.length };
      return { id: c.id, label: c.name, ...t, pct: pct(t), weak: t.total > 0 && pct(t) < WEAK_THRESHOLD };
    })
    .filter((r) => r.total > 0);

  const byType: BreakdownRow[] = (Object.keys(QUESTION_TYPE_LABELS) as QuestionType[])
    .map((type) => {
      const qs = answered.filter((q) => q.type === type);
      const t = { correct: qs.filter(isCorrect).length, total: qs.length };
      return { id: type, label: QUESTION_TYPE_LABELS[type], ...t, pct: pct(t), weak: t.total > 0 && pct(t) < WEAK_THRESHOLD };
    })
    .filter((r) => r.total > 0);

  const missedQs = answered.filter((q) => !isCorrect(q));

  const weakRows = byCategory
    .filter((r) => r.weak)
    .sort((a, b) => a.pct - b.pct || b.total - b.correct - (a.total - a.correct))
    .slice(0, MAX_WEAK_AREAS);

  const weakAreas: WeakArea[] = weakRows.map((row) => {
    const cat = quiz.categories.find((c) => c.id === row.id)!;
    // Sections where questions were missed first (most misses first), then the
    // category's other sections, up to three links.
    const missCounts = new Map<string, number>();
    for (const q of missedQs.filter((q) => q.category === row.id)) {
      missCounts.set(q.sourceSection, (missCounts.get(q.sourceSection) ?? 0) + 1);
    }
    const ordered = [...missCounts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    for (const id of cat.sectionIds) if (!ordered.includes(id)) ordered.push(id);
    const sections = ordered
      .slice(0, 3)
      .map((id) => link(id, missCounts.get(id) ?? 0))
      .filter((s): s is SectionLink => !!s);
    return {
      categoryId: row.id,
      name: row.label,
      description: cat.description,
      correct: row.correct,
      total: row.total,
      pct: row.pct,
      sections,
    };
  });

  const imperfect = byCategory.filter((r) => r.pct < 1).sort((a, b) => a.pct - b.pct);
  const closestToWeak = weakAreas.length === 0 ? imperfect[0] : undefined;

  const missed: MissedItem[] = missedQs.map((q) => ({
    question: q,
    answer: answerById.get(q.id)!,
    categoryName: quiz.categories.find((c) => c.id === q.category)?.name ?? q.category,
    section: link(q.sourceSection),
  }));

  const total = { correct: answered.filter(isCorrect).length, total: quiz.questions.length };
  return { ...total, pct: pct(total), byCategory, byType, weakAreas, ...(closestToWeak ? { closestToWeak } : {}), missed };
}

/**
 * Weights for a practice quiz: weak categories get several times the
 * questions, strong ones still appear but less. Categories not in this quiz
 * keep the default weight.
 */
export function weakAreaWeights(analysis: SessionAnalysis): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const row of analysis.byCategory) weights[row.id] = 0.5 + 3 * (1 - row.pct);
  return weights;
}

export function scoreMessage(p: number): string {
  if (p >= 0.95) return "Outstanding: you really know this article.";
  if (p >= 0.8) return "Great work: just a few gaps.";
  if (p >= 0.6) return "Solid: a few areas to brush up on.";
  if (p >= 0.4) return "Getting there: focus on the areas below.";
  return "Plenty to learn: start with the sections below.";
}
