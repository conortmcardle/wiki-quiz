import { z } from "zod";
import { callClaudeJson, type ClaudeSettings } from "../claude/client";
import {
  buildCategoriesPrompt,
  buildQuestionsPrompt,
  buildQuestionsSystem,
  CATEGORIES_SYSTEM,
  type ChunkRequest,
} from "../claude/prompts";
import { CategoriesResponseSchema, QuestionsResponseSchema } from "../claude/schema";
import { AppError } from "../errors";
import { shuffle } from "../text";
import type { Article } from "../wikipedia/types";
import {
  allocateQuestions,
  buildChunks,
  MAX_CATEGORIES,
  MIN_CATEGORIES,
  normalizeCategories,
  withHeadroom,
} from "./plan";
import type { Category, Question, Quiz, QuizConfig } from "./types";
import { MIN_QUESTIONS } from "./types";
import { dedupeQuestions, makeValidationContext, selectQuestions, validateBatch, type Rejection } from "./validate";

export interface GenerationProgress {
  phase: "categories" | "questions" | "checking";
  message: string;
  /** Question-writing calls finished / total (phase "questions"). */
  done?: number;
  total?: number;
}

export interface GenerateOptions {
  article: Article;
  config: QuizConfig;
  settings: ClaudeSettings;
  /** Reuse these instead of asking Claude (keeps history comparable). */
  categories?: Category[] | null;
  signal?: AbortSignal;
  onProgress?: (p: GenerationProgress) => void;
  /** Called once fresh categories are created, so the caller can cache them. */
  onCategories?: (categories: Category[]) => void;
}

const CONCURRENCY = 3;

/** Response envelope: questions are validated one by one, not all-or-nothing. */
const QuestionsEnvelopeSchema = z.object({ questions: z.array(z.unknown()) });

export async function generateCategories(
  article: Article,
  settings: ClaudeSettings,
  signal?: AbortSignal,
): Promise<Category[]> {
  let prompt = buildCategoriesPrompt(article);
  let categories: Category[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data } = await callClaudeJson({
      settings,
      system: CATEGORIES_SYSTEM,
      user: prompt,
      schema: CategoriesResponseSchema,
      maxTokens: 8000,
      signal,
      label: "categories",
    });
    categories = normalizeCategories(data, article);
    if (categories.length >= MIN_CATEGORIES && categories.length <= MAX_CATEGORIES) return categories;
    prompt = `${buildCategoriesPrompt(article)}\n\nImportant: your previous answer had ${categories.length} usable categories. Return between ${MIN_CATEGORIES} and ${MAX_CATEGORIES}.`;
  }
  if (categories.length >= 2) return categories; // short article: accept what we can get
  throw new AppError("bad-output", "Claude couldn't split this article into topic categories. Try again or pick a longer article.", {
    detail: `got ${categories.length} categories`,
  });
}

async function writeQuestions(
  article: Article,
  categories: Category[],
  chunk: ChunkRequest,
  avoidPrompts: string[],
  settings: ClaudeSettings,
  label: string,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const asked = Object.values(chunk.perCategory).reduce((a, b) => a + b, 0);
  const { data } = await callClaudeJson({
    settings,
    system: buildQuestionsSystem(article.lang),
    user: buildQuestionsPrompt(article, categories, chunk, avoidPrompts),
    schema: QuestionsEnvelopeSchema,
    outputSchema: QuestionsResponseSchema,
    // ~350 output tokens per question plus room for adaptive thinking.
    maxTokens: Math.min(64000, 6000 + asked * 600),
    signal,
    label,
  });
  return data.questions;
}

/** Run async jobs with a concurrency limit, failing fast on fatal errors. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Errors that mean "stop everything" rather than "this one chunk failed". */
function isFatal(err: unknown): boolean {
  return !(err instanceof AppError) || err.kind !== "bad-output";
}

/**
 * Full pipeline: categories → per-category question budget → chunked
 * question writing → validation, de-duplication and balanced selection,
 * with one top-up round if too many questions were rejected.
 */
export async function generateQuiz(opts: GenerateOptions): Promise<Quiz> {
  const { article, config, settings, signal, onProgress } = opts;
  if (config.types.length === 0) {
    throw new AppError("invalid-input", "Pick at least one question type.");
  }

  // 1. Categories (cached per article when possible).
  let categories = opts.categories ?? null;
  if (!categories || categories.length === 0) {
    onProgress?.({ phase: "categories", message: "Reading the article and choosing topic categories…" });
    categories = await generateCategories(article, settings, signal);
    opts.onCategories?.(categories);
  }

  // 2. Budget per category, then 3. chunked question writing.
  const targets = allocateQuestions(categories, article, config.count, config.categoryWeights);
  const chunks = buildChunks(article, categories, withHeadroom(targets), config.types, config.difficulty);
  const ctx = makeValidationContext(article, categories);
  const warnings: string[] = [];
  const rejected: Rejection[] = [];
  let pool: Question[] = [];
  let failedChunks = 0;

  // Cancel sibling requests as soon as one fails fatally (bad key, rate limit, ...).
  const inner = new AbortController();
  if (signal?.aborted) inner.abort();
  signal?.addEventListener("abort", () => inner.abort(), { once: true });

  const runChunks = async (list: ChunkRequest[], what: string, avoidPrompts: string[]) => {
    let done = 0;
    onProgress?.({ phase: "questions", message: `Writing ${what}…`, done, total: list.length });
    const outputs = await mapLimit(list, CONCURRENCY, async (chunk, i) => {
      try {
        return await writeQuestions(
          article,
          categories!,
          chunk,
          avoidPrompts,
          settings,
          `questions (part ${i + 1}/${list.length})`,
          inner.signal,
        );
      } catch (err) {
        if (isFatal(err)) {
          inner.abort();
          throw err;
        }
        failedChunks++;
        return [] as unknown[];
      } finally {
        done++;
        onProgress?.({ phase: "questions", message: `Writing ${what}…`, done, total: list.length });
      }
    });
    onProgress?.({ phase: "checking", message: "Checking questions against the article…" });
    for (const out of outputs) {
      const { valid, rejected: r } = validateBatch(out, ctx);
      pool.push(...valid);
      rejected.push(...r);
    }
    const { kept, dropped } = dedupeQuestions(pool, config.avoidPrompts);
    pool = kept;
    rejected.push(...dropped);
  };

  await runChunks(chunks, "questions", config.avoidPrompts ?? []);

  // 4. Top-up: if validation left us short, ask once more for the missing categories.
  let selected = selectQuestions(pool, targets, config.types, config.count);
  if (selected.length < config.count) {
    const have: Record<string, number> = {};
    for (const q of pool) have[q.category] = (have[q.category] ?? 0) + 1;
    const missing: Record<string, number> = {};
    let missingTotal = 0;
    for (const [cat, n] of Object.entries(targets)) {
      const short = Math.max(0, n - (have[cat] ?? 0));
      if (short > 0) {
        missing[cat] = short;
        missingTotal += short;
      }
    }
    if (missingTotal === 0) missing[categories[0]!.id] = config.count - selected.length;
    const topUp = buildChunks(article, categories, withHeadroom(missing), config.types, config.difficulty);
    await runChunks(topUp, "a few more questions", [...(config.avoidPrompts ?? []), ...pool.map((q) => q.prompt)]);
    selected = selectQuestions(pool, targets, config.types, config.count);
  }

  if (selected.length < Math.min(MIN_QUESTIONS, config.count)) {
    const reasons = summarizeRejections(rejected);
    throw new AppError(
      "bad-output",
      "Claude's questions didn't pass the checks (for example, answers that couldn't be found in the article). Try again, or try different question types.",
      { detail: `${selected.length} usable questions. ${reasons}${failedChunks ? ` ${failedChunks} request(s) returned unusable output.` : ""}` },
    );
  }
  if (selected.length < config.count) {
    warnings.push(`Only ${selected.length} of ${config.count} questions passed the quality checks.`);
  }

  // 5. Final touches: stable ids, shuffled multiple-choice options.
  const questions = selected.map((q, i) => ({
    ...q,
    id: `q${i + 1}`,
    ...(q.options ? { options: shuffle(q.options) } : {}),
  }));

  const usedCats = new Set(questions.map((q) => q.category));
  return {
    id: `${article.lang}:${article.pageId}:${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    model: settings.model,
    article: {
      lang: article.lang,
      title: article.title,
      displayTitle: article.displayTitle,
      url: article.url,
      pageId: article.pageId,
      revId: article.revId,
      sections: Object.fromEntries(article.sections.map((s) => [s.id, { title: s.title, anchor: s.anchor }])),
    },
    // Keep all categories (even unused ones) so history stays comparable,
    // but order them with used ones first.
    categories: [...categories].sort((a, b) => Number(usedCats.has(b.id)) - Number(usedCats.has(a.id))),
    questions,
    config,
    warnings,
  };
}

function summarizeRejections(rejected: Rejection[]): string {
  if (rejected.length === 0) return "";
  const counts = new Map<string, number>();
  for (const r of rejected) {
    const key = r.reason.replace(/".*?"/g, "…").replace(/got \d+/, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return `Rejected: ${[...counts.entries()].map(([k, n]) => `${k} ×${n}`).join(", ")}.`;
}
