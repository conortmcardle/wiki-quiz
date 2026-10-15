import { z } from "zod";
import { DIFFICULTIES, QUESTION_TYPES } from "../quiz/types";

/**
 * Schemas for what Claude returns. They are sent to the API as structured
 * output formats (so the model is constrained to this shape) and used again
 * client-side to parse the response safely. Semantic checks (exactly one
 * correct MC option, quote really in the article, ...) live in quiz/validate.ts.
 */

export const CategoriesResponseSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().describe("Short lowercase slug, e.g. 'early-life'"),
      name: z.string().describe("1–3 word display name, in the article's language"),
      description: z.string().describe("One sentence: what this category covers in this article"),
      sectionIds: z.array(z.string()).describe("Ids of the sections (e.g. 's3') this category draws on"),
    }),
  ),
});
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;

export const RawQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(QUESTION_TYPES),
  category: z.string().describe("A category id from the list provided"),
  difficulty: z.enum(DIFFICULTIES),
  prompt: z.string(),
  options: z
    .array(z.string())
    .nullable()
    .describe("Multiple choice: exactly 4 options including the correct one. Other types: null"),
  correctAnswer: z.string().describe('For true_false: exactly "true" or "false"'),
  acceptableAnswers: z
    .array(z.string())
    .describe("Other accepted forms of the answer (aliases, spellings, numerals vs words). May be empty"),
  explanation: z.string(),
  sourceSection: z.string().describe("Id of the section the answer comes from, e.g. 's3'"),
  sourceQuote: z.string().describe("Short exact quote from that section that proves the answer"),
});
export type RawQuestion = z.infer<typeof RawQuestionSchema>;

export const QuestionsResponseSchema = z.object({
  questions: z.array(RawQuestionSchema),
});
export type QuestionsResponse = z.infer<typeof QuestionsResponseSchema>;

/**
 * Lenient JSON extraction for models without structured outputs (or a
 * response wrapped in prose / code fences).
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]!);
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)); // throws if still malformed
  }
  throw new SyntaxError("No JSON object found in the response");
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** JSON.parse + schema check, never throws. */
export function safeParseJson<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    return { ok: false, error: `Malformed JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `JSON didn't match the schema: ${issues}` };
  }
  return { ok: true, data: result.data };
}
