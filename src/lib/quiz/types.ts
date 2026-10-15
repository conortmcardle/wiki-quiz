export const QUESTION_TYPES = ["multiple_choice", "short_answer", "true_false", "fill_blank"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type DifficultySetting = Difficulty | "mixed";

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: "Multiple choice",
  short_answer: "Short answer",
  true_false: "True / false",
  fill_blank: "Fill in the blank",
};

export interface Category {
  /** Short slug, stable across attempts on the same article. */
  id: string;
  name: string;
  description: string;
  /** Article section ids ("s0", "s3", ...) this category draws on. */
  sectionIds: string[];
}

export interface Question {
  id: string;
  type: QuestionType;
  /** Category id. */
  category: string;
  difficulty: Difficulty;
  prompt: string;
  /** Multiple choice only: exactly 4 options, one equal to correctAnswer. */
  options?: string[];
  /** "true"/"false" for true_false questions. */
  correctAnswer: string;
  /** Other accepted spellings/forms (short answer and fill-in-the-blank). */
  acceptableAnswers: string[];
  explanation: string;
  /** Article section id the question is based on. */
  sourceSection: string;
  /** Short verbatim quote from that section supporting the answer. */
  sourceQuote: string;
}

export interface QuizConfig {
  types: QuestionType[];
  count: number;
  difficulty: DifficultySetting;
  /** Relative weight per category id (weak-area practice). Missing = 1. */
  categoryWeights?: Record<string, number>;
  /** Prompts from earlier quizzes on this article, to avoid repeats. */
  avoidPrompts?: string[];
}

export const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  types: [...QUESTION_TYPES],
  count: 15,
  difficulty: "mixed",
};

export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 40;

export interface QuizArticleInfo {
  lang: string;
  title: string;
  displayTitle: string;
  url: string;
  pageId: number;
  revId: number;
  /** Section id → {title, anchor}, so a saved quiz can still link sections. */
  sections: Record<string, { title: string; anchor: string }>;
}

export interface Quiz {
  id: string;
  createdAt: string;
  model: string;
  article: QuizArticleInfo;
  categories: Category[];
  questions: Question[];
  config: QuizConfig;
  /** Non-fatal notes, e.g. "Only 13 of 15 questions passed validation." */
  warnings: string[];
}
