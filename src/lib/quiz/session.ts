import type { GradeHow } from "../grading/grade";
import type { Quiz } from "./types";

export interface AnswerRecord {
  questionId: string;
  response: string;
  correct: boolean;
  how: GradeHow;
  /** Accepted answer that a typo/alias/number response matched. */
  matched?: string;
  answeredAt: string;
}

export type SessionMode = "full" | "retry-missed";

export interface QuizSession {
  id: string;
  quiz: Quiz;
  mode: SessionMode;
  answers: AnswerRecord[];
  startedAt: string;
  finishedAt?: string;
}

export function newSession(quiz: Quiz, mode: SessionMode = "full"): QuizSession {
  return {
    id: `${quiz.id}:${Date.now().toString(36)}`,
    quiz,
    mode,
    answers: [],
    startedAt: new Date().toISOString(),
  };
}

export function currentIndex(session: QuizSession): number {
  return session.answers.length;
}

export function isFinished(session: QuizSession): boolean {
  return session.answers.length >= session.quiz.questions.length;
}

export function scoreOf(session: QuizSession): { correct: number; total: number } {
  return { correct: session.answers.filter((a) => a.correct).length, total: session.quiz.questions.length };
}

// ---------------------------------------------------------------------------
// Persist the quiz in progress so a reload (common on phones) doesn't lose it.
// ---------------------------------------------------------------------------

const ACTIVE_KEY = "wikiquiz.activeSession.v1";

export function saveActiveSession(session: QuizSession): void {
  try {
    globalThis.localStorage?.setItem(ACTIVE_KEY, JSON.stringify(session));
  } catch {
    /* ignore: resume just won't be available */
  }
}

export function loadActiveSession(): QuizSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as QuizSession;
    if (!s?.quiz?.questions?.length || !Array.isArray(s.answers) || isFinished(s)) return null;
    return s;
  } catch {
    return null;
  }
}

export function clearActiveSession(): void {
  try {
    globalThis.localStorage?.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}
