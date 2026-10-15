import { beforeEach, describe, expect, it } from "vitest";
import type { QuizSession } from "../quiz/session";
import type { Question, Quiz } from "../quiz/types";
import {
  attemptMode,
  categoryTrend,
  clearQuizData,
  listHistoryArticles,
  loadHistory,
  recentPrompts,
  recordAttempt,
} from "../storage/history";
import { analyzeSession, scoreMessage, weakAreaWeights } from "./analyze";

function makeQuiz(questions: Partial<Question>[], extra: Partial<Quiz> = {}): Quiz {
  return {
    id: "en:101:x",
    createdAt: "2026-10-15T10:00:00Z",
    model: "claude-sonnet-5-5",
    article: {
      lang: "en",
      title: "Lyon",
      displayTitle: "Lyon",
      url: "https://en.wikipedia.org/wiki/Lyon",
      pageId: 101,
      revId: 5,
      sections: {
        s0: { title: "Introduction", anchor: "" },
        s1: { title: "Toponymy", anchor: "Toponymy" },
        s2: { title: "Ancient Lyon", anchor: "Ancient_Lyon" },
        s3: { title: "Silk industry", anchor: "Silk_industry" },
        s4: { title: "Climate", anchor: "Climate" },
        s5: { title: "Économie et culture", anchor: "Économie_et_culture" },
      },
    },
    categories: [
      { id: "history", name: "History", description: "The past", sectionIds: ["s1", "s2", "s3"] },
      { id: "geography", name: "Geography", description: "Places", sectionIds: ["s0", "s4"] },
      { id: "culture", name: "Culture", description: "Festivals", sectionIds: ["s5"] },
      { id: "people", name: "People", description: "Natives", sectionIds: [] },
    ],
    questions: questions.map((q, i) => ({
      id: `q${i + 1}`,
      type: "short_answer",
      category: "history",
      difficulty: "medium",
      prompt: `Question ${i + 1}?`,
      correctAnswer: "x",
      acceptableAnswers: [],
      explanation: "",
      sourceSection: "s1",
      sourceQuote: "",
      ...q,
    })),
    config: { types: ["short_answer", "multiple_choice"], count: questions.length, difficulty: "mixed" },
    warnings: [],
    ...extra,
  };
}

function session(quiz: Quiz, results: boolean[], id = "sess-1", mode: QuizSession["mode"] = "full"): QuizSession {
  return {
    id,
    quiz,
    mode,
    startedAt: "2026-10-15T10:00:00Z",
    finishedAt: "2026-10-15T10:05:00Z",
    answers: results.map((correct, i) => ({
      questionId: `q${i + 1}`,
      response: correct ? "x" : "y",
      correct,
      how: correct ? "exact" : "wrong",
      answeredAt: "2026-10-15T10:01:00Z",
    })),
  };
}

// History 2/6 (missed from s2 ×3, s3 ×1), Geography 3/3, Culture 1/2, multiple-choice mix
const QUESTIONS: Partial<Question>[] = [
  { category: "history", sourceSection: "s2" },
  { category: "history", sourceSection: "s2" },
  { category: "history", sourceSection: "s2", type: "multiple_choice", options: ["x", "a", "b", "c"] },
  { category: "history", sourceSection: "s3" },
  { category: "history", sourceSection: "s1" },
  { category: "history", sourceSection: "s1", type: "multiple_choice", options: ["x", "a", "b", "c"] },
  { category: "geography", sourceSection: "s0", type: "multiple_choice", options: ["x", "a", "b", "c"] },
  { category: "geography", sourceSection: "s4" },
  { category: "geography", sourceSection: "s4" },
  { category: "culture", sourceSection: "s5" },
  { category: "culture", sourceSection: "s5", type: "multiple_choice", options: ["x", "a", "b", "c"] },
];
const RESULTS = [false, false, false, false, true, true, true, true, true, true, false];

describe("analyzeSession", () => {
  const a = analyzeSession(session(makeQuiz(QUESTIONS), RESULTS));

  it("scores the quiz", () => {
    expect(a.correct).toBe(6);
    expect(a.total).toBe(11);
    expect(a.pct).toBeCloseTo(6 / 11);
  });

  it("breaks down by category (stable order, unused categories omitted)", () => {
    expect(a.byCategory.map((r) => [r.label, r.correct, r.total, r.weak])).toEqual([
      ["History", 2, 6, true],
      ["Geography", 3, 3, false],
      ["Culture", 1, 2, true],
    ]);
  });

  it("breaks down by question type", () => {
    expect(a.byType.map((r) => [r.label, r.correct, r.total])).toEqual([
      ["Multiple choice", 2, 4],
      ["Short answer", 4, 7],
    ]);
  });

  it("names the weakest categories first and links the sections where questions were missed", () => {
    expect(a.weakAreas.map((w) => w.name)).toEqual(["History", "Culture"]);
    const history = a.weakAreas[0]!;
    expect(history.sections.map((s) => [s.title, s.missed])).toEqual([
      ["Ancient Lyon", 3],
      ["Silk industry", 1],
      ["Toponymy", 0],
    ]);
    expect(history.sections[0]!.url).toBe("https://en.wikipedia.org/wiki/Lyon#Ancient_Lyon");
    expect(a.weakAreas[1]!.sections[0]!.url).toBe("https://en.wikipedia.org/wiki/Lyon#%C3%89conomie_et_culture");
  });

  it("lists every missed question with its section", () => {
    expect(a.missed).toHaveLength(5);
    expect(a.missed[0]!.categoryName).toBe("History");
    expect(a.missed[0]!.section?.title).toBe("Ancient Lyon");
    expect(a.missed[0]!.answer.response).toBe("y");
  });

  it("reports 'closest to weak' instead when nothing is below the threshold", () => {
    const b = analyzeSession(session(makeQuiz(QUESTIONS), RESULTS.map((_, i) => i !== 0)));
    expect(b.weakAreas).toEqual([]);
    expect(b.closestToWeak?.label).toBe("History");
    const perfect = analyzeSession(session(makeQuiz(QUESTIONS), RESULTS.map(() => true)));
    expect(perfect.closestToWeak).toBeUndefined();
    expect(perfect.missed).toEqual([]);
  });

  it("caps the weak list at three", () => {
    const qs: Partial<Question>[] = ["history", "geography", "culture", "people"].map((category) => ({ category }));
    const all = analyzeSession(session(makeQuiz(qs), [false, false, false, false]));
    expect(all.weakAreas).toHaveLength(3);
  });

  it("weights practice quizzes toward weak categories", () => {
    const w = weakAreaWeights(a);
    expect(w.history).toBeGreaterThan(w.culture!);
    expect(w.culture).toBeGreaterThan(w.geography!);
    expect(w.geography).toBe(0.5);
  });

  it("has an encouraging message for every score", () => {
    expect(scoreMessage(1)).toMatch(/Outstanding/);
    expect(scoreMessage(0.1)).toMatch(/Plenty/);
  });
});

describe("attempt history", () => {
  beforeEach(() => localStorage.clear());

  it("records attempts per article, once per session", () => {
    const quiz = makeQuiz(QUESTIONS);
    recordAttempt(session(quiz, RESULTS, "a1"));
    recordAttempt(session(quiz, RESULTS, "a1")); // same session again: ignored
    const h = recordAttempt(session(quiz, RESULTS.map(() => true), "a2"));
    expect(h.attempts.map((x) => [x.id, x.correct, x.total, x.mode])).toEqual([
      ["a1", 6, 11, "full"],
      ["a2", 11, 11, "full"],
    ]);
    expect(h.attempts[0]!.byCategory.history).toEqual({ correct: 2, total: 6 });
    expect(h.attempts[0]!.byType.multiple_choice).toEqual({ correct: 2, total: 4 });
    expect(loadHistory("en", 101)?.attempts).toHaveLength(2);
  });

  it("tracks per-category improvement across attempts, leaving out retry rounds", () => {
    const quiz = makeQuiz(QUESTIONS);
    recordAttempt(session(quiz, RESULTS, "a1"));
    recordAttempt(session(makeQuiz(QUESTIONS.slice(0, 2)), [true, true], "r1", "retry-missed"));
    const h = recordAttempt(session(quiz, RESULTS.map(() => true), "a2"));
    const trend = categoryTrend(h);
    expect(trend.attempts.map((x) => x.id)).toEqual(["a1", "a2"]);
    const history = trend.rows.find((r) => r.id === "history")!;
    expect(history.cells).toEqual([
      { correct: 2, total: 6 },
      { correct: 6, total: 6 },
    ]);
    expect(trend.rows.find((r) => r.id === "people")).toBeUndefined(); // never asked
  });

  it("labels practice quizzes and retries", () => {
    const quiz = makeQuiz(QUESTIONS);
    expect(attemptMode(session(quiz, []))).toBe("full");
    expect(attemptMode(session(makeQuiz(QUESTIONS, { config: { ...quiz.config, categoryWeights: { history: 3 } } }), []))).toBe("focus");
    expect(attemptMode(session(quiz, [], "x", "retry-missed"))).toBe("retry-missed");
  });

  it("keeps an index of played articles and recent prompts for avoiding repeats", () => {
    recordAttempt(session(makeQuiz(QUESTIONS), RESULTS, "a1"));
    const index = listHistoryArticles();
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ title: "Lyon", attempts: 1 });
    expect(index[0]!.lastPct).toBeCloseTo(6 / 11);
    expect(recentPrompts(loadHistory("en", 101))).toContain("Question 1?");
  });

  it("clears quiz data but keeps the API key", () => {
    localStorage.setItem("wikiquiz.apiKey", "sk-ant-x");
    recordAttempt(session(makeQuiz(QUESTIONS), RESULTS, "a1"));
    clearQuizData();
    expect(loadHistory("en", 101)).toBeNull();
    expect(localStorage.getItem("wikiquiz.apiKey")).toBe("sk-ant-x");
  });
});
