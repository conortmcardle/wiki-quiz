import type { Article, ArticleSection } from "../wikipedia/types";
import { languageName } from "../wikipedia/fetchArticle";
import type { Category, Difficulty, QuestionType } from "../quiz/types";

/** Above this many characters the categories pass sees section previews only. */
export const CATEGORY_FULL_TEXT_LIMIT = 120_000;
const CATEGORY_PREVIEW_CHARS = 900;

function sectionLabel(s: ArticleSection): string {
  return s.path.length ? s.path.join(" › ") : s.title;
}

function renderSection(s: ArticleSection, maxChars?: number): string {
  const text =
    maxChars && s.text.length > maxChars ? `${s.text.slice(0, maxChars)} […section continues, ${s.wordCount} words total]` : s.text;
  return `<section id="${s.id}" title="${sectionLabel(s).replace(/"/g, "'")}">\n${text}\n</section>`;
}

// ---------------------------------------------------------------------------
// Pass 1: categories
// ---------------------------------------------------------------------------

export const CATEGORIES_SYSTEM = `You help build trivia quizzes from a single Wikipedia article. Your job in this step is to divide the article's subject matter into topic categories that will be used to tag quiz questions and to show the player which areas they are strong or weak in.`;

export function buildCategoriesPrompt(article: Article): string {
  const totalChars = article.sections.reduce((n, s) => n + s.text.length, 0);
  const preview = totalChars > CATEGORY_FULL_TEXT_LIMIT;
  const lang = languageName(article.lang);

  return `Article: "${article.title}" (${lang} Wikipedia, ${article.wordCount} words, ${article.sections.length} sections).
${preview ? "The article is long, so each section below is shortened to its opening; the full text will be used later when writing questions.\n" : ""}
${article.sections.map((s) => renderSection(s, preview ? CATEGORY_PREVIEW_CHARS : undefined)).join("\n\n")}

Define between 4 and 8 topic categories that fit this specific article. Base them on what the article actually covers, not on a generic template: a city might get Geography, History, Economy, Culture, Notable People; a scientist might get Early Life, Research, Awards, Legacy.

Requirements:
- Each category must be backed by enough article text to support several quiz questions. If the article is short, use fewer, broader categories (but at least 4).
- Categories should not overlap much; together they should cover the whole article.
- "name": 1–3 words, written in ${lang} (the article's language).
- "id": a short lowercase ASCII slug (letters, digits, hyphens), unique.
- "description": one short sentence on what the category covers in this article.
- "sectionIds": the ids of the sections (like "s3") whose content belongs to the category. Put every section in exactly one category, the one it fits best. The introduction (s0) summarizes the whole article; assign it to the category it says the most about.

Reply with JSON: {"categories": [{"id", "name", "description", "sectionIds"}]}`;
}

// ---------------------------------------------------------------------------
// Pass 2: questions (one call per chunk of sections)
// ---------------------------------------------------------------------------

export function buildQuestionsSystem(lang: string): string {
  const language = languageName(lang);
  return `You write trivia quiz questions from a single Wikipedia article. A player will answer them to find out how well they know the topic.

Grounding (most important):
- Every question must be answerable from the article text you are given, and nothing else. Do not use outside knowledge, even if you know more about the subject. If the article doesn't clearly state something, don't ask about it.
- "sourceQuote" must be copied exactly, character for character, from the article text: a short excerpt (roughly 5–30 words) that proves the answer. "sourceSection" is the id of the section it comes from (e.g. "s3").

Language: write prompts, options, answers and explanations in ${language}, the article's language. The one exception: for true_false questions "correctAnswer" is always the English word "true" or "false".

Question types:
- multiple_choice: exactly 4 options and exactly one correct answer; "correctAnswer" is copied exactly from "options". Distractors must be plausible: the same kind of thing as the answer (all years, all people, all cities, ...), similar in length and style, ideally other names/dates/places that appear in the article, but definitely wrong according to the article. No "all of the above" or "none of the above". Don't make the correct option the longest or most detailed one.
- short_answer: the answer is one word or a short phrase (at most 4 words), such as a name, place, number, date or term. Ask so that only one answer is correct.
- fill_blank: a sentence based closely on the article with one key word or short phrase replaced by "_____" (five underscores, appearing once). "correctAnswer" is the missing text.
- true_false: a clear statement that is unambiguously true or false according to the article. Make false statements by changing one specific detail (a date, number, name or place). Aim for a mix of true and false.
- "options" is null for every type except multiple_choice.
- For short_answer and fill_blank, "acceptableAnswers" lists other ways a person might correctly write the answer: alternative spellings, with or without accents, common abbreviations, a surname alone when that's unambiguous, numerals vs. words ("3" / "three"), transliterations. Don't include broader, partial or different answers. Use [] for multiple_choice and true_false.

Difficulty:
- easy: a prominent, central fact (often stated in the introduction).
- medium: a specific detail a reader of the article would likely remember.
- hard: an obscure detail, a precise number or date, or a connection between two facts in the article.

Quality:
- Ask about the subject itself, not about the article ("According to the article…" or "Which section…" are not allowed).
- Don't give the answer away in the prompt or in other options. Each question tests a different fact.
- Skip trivial facts about wording, citations or formatting.
- "explanation": 1–2 sentences on why the answer is correct, based on the article.
- "id": any unique string such as "q1".`;
}

export interface ChunkRequest {
  sections: ArticleSection[];
  /** Number of questions to write per category id. */
  perCategory: Record<string, number>;
  perType: Partial<Record<QuestionType, number>>;
  perDifficulty: Partial<Record<Difficulty, number>>;
}

export function buildQuestionsPrompt(
  article: Article,
  categories: Category[],
  chunk: ChunkRequest,
  avoidPrompts: string[] = [],
): string {
  const total = Object.values(chunk.perCategory).reduce((a, b) => a + b, 0);
  const catLines = categories
    .map((c) => `- ${c.id}: ${c.name}. ${c.description}`)
    .join("\n");
  const quota = Object.entries(chunk.perCategory)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${id}: ${n}`)
    .join(", ");
  const types = Object.entries(chunk.perType)
    .filter(([, n]) => n && n > 0)
    .map(([t, n]) => `${t}: ${n}`)
    .join(", ");
  const diffs = Object.entries(chunk.perDifficulty)
    .filter(([, n]) => n && n > 0)
    .map(([d, n]) => `${d}: ${n}`)
    .join(", ");
  const avoid = avoidPrompts.length
    ? `\nThe player has already seen these questions. Ask about different facts:\n${avoidPrompts
        .slice(0, 60)
        .map((p) => `- ${p}`)
        .join("\n")}\n`
    : "";

  return `Article: "${article.title}" (${languageName(article.lang)} Wikipedia)

Quiz categories (tag every question with exactly one of these ids in "category"):
${catLines}

Article sections for this batch:

${chunk.sections.map((s) => renderSection(s)).join("\n\n")}

Write ${total} questions using only the sections above.
- Questions per category: ${quota}
- Question types: ${types}
- Difficulty: ${diffs}
- Spread the questions across the different sections and facts instead of taking several from the same paragraph.
${avoid}
Reply with JSON: {"questions": [...]}`;
}
