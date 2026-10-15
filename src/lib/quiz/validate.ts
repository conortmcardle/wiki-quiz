import { RawQuestionSchema, type RawQuestion } from "../claude/schema";
import { jaccard, ngrams, normalizeForCompare, tokenize, wordCount } from "../text";
import type { Article, ArticleSection } from "../wikipedia/types";
import type { Category, Question, QuestionType } from "./types";

export const BLANK = "_____";

/** Longest correct answer we accept for short-answer / fill-in-the-blank. */
const MAX_SHORT_ANSWER_WORDS = 8;
/**
 * Share of a quote's word bigrams that must appear in the section. Tolerates
 * a changed or inserted word; a made-up sentence scores far lower.
 */
const QUOTE_MATCH_THRESHOLD = 0.65;
/** Prompts at least this similar (Jaccard on words) are duplicates. */
const DUPLICATE_PROMPT_SIMILARITY = 0.75;

export type Rejection = { reason: string; prompt?: string };
export type CheckResult = { ok: true; question: Question } | { ok: false; reason: string };

const TYPE_ALIASES: Record<string, QuestionType> = {
  multiple_choice: "multiple_choice",
  multiplechoice: "multiple_choice",
  mcq: "multiple_choice",
  mc: "multiple_choice",
  short_answer: "short_answer",
  shortanswer: "short_answer",
  short: "short_answer",
  one_word: "short_answer",
  true_false: "true_false",
  truefalse: "true_false",
  tf: "true_false",
  boolean: "true_false",
  fill_blank: "fill_blank",
  fill_in_the_blank: "fill_blank",
  fill_in_blank: "fill_blank",
  fillblank: "fill_blank",
  cloze: "fill_blank",
};

/**
 * Coerce near-miss shapes (type "multiple-choice", boolean answers, missing
 * arrays) before the strict schema check, so one sloppy field doesn't cost a
 * whole question. Returns null if it still doesn't fit the schema.
 */
export function coerceRawQuestion(input: unknown): RawQuestion | null {
  if (!input || typeof input !== "object") return null;
  const o = { ...(input as Record<string, unknown>) };
  if (typeof o.type === "string") {
    const key = o.type.toLowerCase().replace(/[\s/-]+/g, "_");
    o.type = TYPE_ALIASES[key] ?? TYPE_ALIASES[key.replace(/_/g, "")] ?? o.type;
  }
  if (typeof o.difficulty === "string") o.difficulty = o.difficulty.toLowerCase().trim();
  if (typeof o.correctAnswer === "boolean" || typeof o.correctAnswer === "number") {
    o.correctAnswer = String(o.correctAnswer);
  }
  if (o.options === undefined) o.options = null;
  if (!Array.isArray(o.acceptableAnswers)) o.acceptableAnswers = [];
  o.acceptableAnswers = (o.acceptableAnswers as unknown[]).filter((x) => typeof x === "string" || typeof x === "number").map(String);
  if (Array.isArray(o.options)) o.options = (o.options as unknown[]).map((x) => String(x));
  for (const k of ["id", "explanation", "sourceQuote", "sourceSection", "category"]) {
    if (o[k] === undefined || o[k] === null) o[k] = "";
    if (typeof o[k] === "number") o[k] = String(o[k]);
  }
  const parsed = RawQuestionSchema.safeParse(o);
  return parsed.success ? parsed.data : null;
}

const TRUE_WORDS = new Set(["true", "yes", "vrai", "wahr", "verdadero", "vero", "verdadeiro", "waar", "prawda", "sant", "sann", "истина", "верно", "正しい", "正确", "對", "对"]);
const FALSE_WORDS = new Set(["false", "no", "faux", "falsch", "falso", "onwaar", "falsz", "nepravda", "falskt", "ложь", "неверно", "誤り", "错误", "錯誤", "错", "錯"]);

function normalizeTrueFalse(answer: string): "true" | "false" | null {
  const a = normalizeForCompare(answer);
  if (TRUE_WORDS.has(a)) return "true";
  if (FALSE_WORDS.has(a)) return "false";
  return null;
}

const BANNED_OPTIONS = /\b(all|none|both|neither) of the (above|options|answers)\b|^(all|none) of these$/i;
const NUMERIC_ANSWER = /^[\d\s.,:/–-]+$/;

/** True if `answer` appears as a whole phrase inside `text` (normalized). */
function containsPhrase(text: string, answer: string): boolean {
  const t = ` ${normalizeForCompare(text)} `;
  const a = normalizeForCompare(answer);
  return a.length > 0 && t.includes(` ${a} `);
}

export class QuoteIndex {
  private readonly cache = new Map<string, { norm: string; grams: Set<string> }>();
  constructor(private readonly sections: ArticleSection[]) {}

  private entry(s: ArticleSection) {
    let e = this.cache.get(s.id);
    if (!e) {
      const norm = normalizeForCompare(s.text);
      e = { norm, grams: new Set(ngrams(tokenize(norm), 2)) };
      this.cache.set(s.id, e);
    }
    return e;
  }

  /** How well a quote matches a section: 1 = verbatim, else bigram coverage. */
  score(quote: string, section: ArticleSection): number {
    const q = normalizeForCompare(quote);
    if (!q) return 0;
    const e = this.entry(section);
    if (` ${e.norm} `.includes(` ${q} `)) return 1;
    const tokens = tokenize(q);
    if (tokens.length < 4) return 0; // too short to match fuzzily: must be verbatim
    const grams = ngrams(tokens, 2);
    let hit = 0;
    for (const g of grams) if (e.grams.has(g)) hit++;
    return hit / grams.length;
  }

  /** Best matching section for the quote, preferring `preferredId` on ties. */
  locate(quote: string, preferredId?: string): { section: ArticleSection; score: number } | null {
    let best: { section: ArticleSection; score: number } | null = null;
    const ordered = preferredId
      ? [...this.sections].sort((a, b) => (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0))
      : this.sections;
    for (const s of ordered) {
      const score = this.score(quote, s);
      if (!best || score > best.score) best = { section: s, score };
      if (score === 1) break;
    }
    return best && best.score >= QUOTE_MATCH_THRESHOLD ? best : null;
  }
}

export interface ValidationContext {
  article: Article;
  categories: Category[];
  quotes: QuoteIndex;
}

export function makeValidationContext(article: Article, categories: Category[]): ValidationContext {
  return { article, categories, quotes: new QuoteIndex(article.sections) };
}

function resolveCategory(value: string, categories: Category[]): string | null {
  const v = value.trim();
  const exact = categories.find((c) => c.id === v);
  if (exact) return exact.id;
  const n = normalizeForCompare(v);
  const loose = categories.find((c) => normalizeForCompare(c.id) === n || normalizeForCompare(c.name) === n);
  return loose?.id ?? null;
}

function resolveSection(value: string, sections: ArticleSection[]): ArticleSection | undefined {
  const v = value.trim();
  const byId = sections.find((s) => s.id === v);
  if (byId) return byId;
  const n = normalizeForCompare(v.replace(/^#/, ""));
  return sections.find(
    (s) => normalizeForCompare(s.title) === n || normalizeForCompare(s.anchor) === n || normalizeForCompare(s.path.join(" ")) === n,
  );
}

function cleanAliases(aliases: string[], correct: string): string[] {
  const seen = new Set([normalizeForCompare(correct)]);
  const out: string[] = [];
  for (const a of aliases) {
    const t = a.trim();
    const n = normalizeForCompare(t);
    if (!n || seen.has(n) || wordCount(t) > MAX_SHORT_ANSWER_WORDS + 2) continue;
    seen.add(n);
    out.push(t);
  }
  return out;
}

/**
 * Check one question against the article and the quiz rules. Fixes what can
 * be fixed safely (section id, answer casing, blank markers) and rejects the
 * rest with a reason.
 */
export function checkQuestion(raw: RawQuestion, ctx: ValidationContext): CheckResult {
  const prompt = raw.prompt.trim().replace(/\s+/g, " ");
  if (!prompt) return { ok: false, reason: "empty prompt" };
  if (prompt.length > 500) return { ok: false, reason: "prompt too long" };

  const category = resolveCategory(raw.category, ctx.categories);
  if (!category) return { ok: false, reason: `unknown category "${raw.category}"` };

  // Grounding: the supporting quote must really be in the article.
  const quote = raw.sourceQuote.trim().replace(/^["“«„']+|["”»“']+$/g, "").trim();
  if (!quote) return { ok: false, reason: "missing source quote" };
  const claimed = resolveSection(raw.sourceSection, ctx.article.sections);
  const located = ctx.quotes.locate(quote, claimed?.id);
  if (!located) return { ok: false, reason: "source quote not found in the article" };
  const sourceSection = located.section.id;

  let correctAnswer = raw.correctAnswer.trim();
  if (!correctAnswer) return { ok: false, reason: "missing answer" };
  let options: string[] | undefined;
  let acceptableAnswers: string[] = [];
  let finalPrompt = prompt;

  switch (raw.type) {
    case "multiple_choice": {
      const opts = (raw.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (opts.length !== 4) return { ok: false, reason: `multiple choice needs 4 options, got ${opts.length}` };
      const norms = opts.map(normalizeForCompare);
      if (new Set(norms).size !== 4) return { ok: false, reason: "duplicate options" };
      const correctNorm = normalizeForCompare(correctAnswer);
      const matches = opts.filter((_, i) => norms[i] === correctNorm);
      if (matches.length !== 1) return { ok: false, reason: "correct answer must match exactly one option" };
      correctAnswer = matches[0]!;
      if (opts.some((o) => BANNED_OPTIONS.test(o))) return { ok: false, reason: '"all/none of the above" option' };
      const distractors = opts.filter((o) => o !== correctAnswer);
      if (NUMERIC_ANSWER.test(correctAnswer) && distractors.some((d) => !/\d/.test(d))) {
        return { ok: false, reason: "distractors aren't the same kind of answer" };
      }
      const longest = Math.max(...distractors.map((d) => d.length));
      if (correctAnswer.length > 25 && correctAnswer.length > longest * 2.5) {
        return { ok: false, reason: "correct option is a giveaway (much longer than the others)" };
      }
      options = opts;
      break;
    }
    case "true_false": {
      const tf = normalizeTrueFalse(correctAnswer);
      if (!tf) return { ok: false, reason: `true/false answer was "${correctAnswer}"` };
      correctAnswer = tf;
      break;
    }
    case "short_answer":
    case "fill_blank": {
      if (wordCount(correctAnswer) > MAX_SHORT_ANSWER_WORDS) return { ok: false, reason: "answer too long" };
      if (raw.type === "fill_blank") {
        finalPrompt = prompt.replace(/_{3,}|\[\s*blank\s*\]|\(\s*blank\s*\)|\.{4,}|…{2,}/gi, BLANK);
        const blanks = finalPrompt.split(BLANK).length - 1;
        if (blanks !== 1) return { ok: false, reason: `fill-in-the-blank needs exactly one blank, got ${blanks}` };
      }
      if (containsPhrase(finalPrompt.replace(BLANK, " "), correctAnswer)) {
        return { ok: false, reason: "prompt gives away the answer" };
      }
      acceptableAnswers = cleanAliases(raw.acceptableAnswers, correctAnswer);
      break;
    }
  }

  return {
    ok: true,
    question: {
      id: raw.id,
      type: raw.type,
      category,
      difficulty: raw.difficulty,
      prompt: finalPrompt,
      ...(options ? { options } : {}),
      correctAnswer,
      acceptableAnswers,
      explanation: raw.explanation.trim() || `The article says: “${quote}”`,
      sourceSection,
      sourceQuote: quote,
    },
  };
}

function promptSet(q: Pick<Question, "prompt">): Set<string> {
  // Ignore very short words so "the/of/in" don't make questions look alike.
  return new Set(tokenize(normalizeForCompare(q.prompt)).filter((t) => t.length > 2 || /\d/.test(t) || t.length === 1 && /\p{Script=Han}/u.test(t)));
}

/**
 * Drop near-duplicates: questions with almost the same wording, or testing
 * the same answer from the same passage. Also drops repeats of `avoid`
 * (prompts from earlier quizzes) when they're nearly identical.
 */
export function dedupeQuestions(
  questions: Question[],
  avoid: string[] = [],
): { kept: Question[]; dropped: Rejection[] } {
  const kept: Question[] = [];
  const dropped: Rejection[] = [];
  const keptSets: Set<string>[] = [];
  const avoidSets = avoid.map((p) => promptSet({ prompt: p }));

  for (const q of questions) {
    const set = promptSet(q);
    const answer = normalizeForCompare(q.correctAnswer);
    const quote = normalizeForCompare(q.sourceQuote);

    const dupIndex = kept.findIndex((k, i) => {
      const sim = jaccard(set, keptSets[i]!);
      if (sim >= DUPLICATE_PROMPT_SIMILARITY) return true;
      const sameAnswer = normalizeForCompare(k.correctAnswer) === answer && q.type !== "true_false" && k.type !== "true_false";
      if (sameAnswer && (normalizeForCompare(k.sourceQuote) === quote || (k.sourceSection === q.sourceSection && sim >= 0.4))) {
        return true;
      }
      return false;
    });
    if (dupIndex !== -1) {
      dropped.push({ reason: "duplicate", prompt: q.prompt });
      continue;
    }
    if (avoidSets.some((a) => jaccard(set, a) >= 0.85)) {
      dropped.push({ reason: "repeat of an earlier quiz", prompt: q.prompt });
      continue;
    }
    kept.push(q);
    keptSets.push(set);
  }
  return { kept, dropped };
}

/** Validate a batch of raw model output. */
export function validateBatch(
  rawQuestions: unknown[],
  ctx: ValidationContext,
): { valid: Question[]; rejected: Rejection[] } {
  const valid: Question[] = [];
  const rejected: Rejection[] = [];
  for (const item of rawQuestions) {
    const raw = coerceRawQuestion(item);
    if (!raw) {
      rejected.push({ reason: "didn't match the question schema" });
      continue;
    }
    const result = checkQuestion(raw, ctx);
    if (result.ok) valid.push(result.question);
    else rejected.push({ reason: result.reason, prompt: raw.prompt });
  }
  return { valid, rejected };
}

/**
 * Pick the final questions: up to each category's target, favouring
 * under-represented question types, then fill any shortfall from other
 * categories. Result is interleaved by category so topics alternate.
 */
export function selectQuestions(
  pool: Question[],
  targets: Record<string, number>,
  types: QuestionType[],
  count: number,
): Question[] {
  const byCat = new Map<string, Question[]>();
  for (const q of pool) {
    if (!byCat.has(q.category)) byCat.set(q.category, []);
    byCat.get(q.category)!.push(q);
  }
  const typeCount = new Map<QuestionType, number>(types.map((t) => [t, 0]));
  const picked = new Map<string, Question[]>();
  const take = (cat: string) => {
    const list = byCat.get(cat);
    if (!list || list.length === 0) return false;
    // choose the question whose type is currently least used
    let bestI = 0;
    let bestCount = Infinity;
    list.forEach((q, i) => {
      const c = typeCount.get(q.type) ?? Infinity;
      if (c < bestCount) {
        bestCount = c;
        bestI = i;
      }
    });
    const [q] = list.splice(bestI, 1);
    typeCount.set(q!.type, (typeCount.get(q!.type) ?? 0) + 1);
    if (!picked.has(cat)) picked.set(cat, []);
    picked.get(cat)!.push(q!);
    return true;
  };

  const cats = Object.keys(targets);
  let total = 0;
  // Round-robin up to each target, so a short fall in one category spreads evenly.
  let progress = true;
  while (total < count && progress) {
    progress = false;
    for (const cat of cats) {
      if (total >= count) break;
      if ((picked.get(cat)?.length ?? 0) < (targets[cat] ?? 0) && take(cat)) {
        total++;
        progress = true;
      }
    }
  }
  // Shortfall: take leftovers from any category, round-robin.
  const allCats = [...new Set([...cats, ...byCat.keys()])];
  progress = true;
  while (total < count && progress) {
    progress = false;
    for (const cat of allCats) {
      if (total >= count) break;
      if (take(cat)) {
        total++;
        progress = true;
      }
    }
  }

  // Interleave categories.
  const lists = allCats.map((c) => picked.get(c) ?? []).filter((l) => l.length);
  const out: Question[] = [];
  while (lists.some((l) => l.length)) {
    for (const l of lists) {
      const q = l.shift();
      if (q) out.push(q);
    }
  }
  return out;
}
