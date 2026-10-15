import { describe, expect, it } from "vitest";
import type { RawQuestion } from "../claude/schema";
import { lyonArticle } from "../../test/helpers";
import type { Category, Question } from "./types";
import {
  BLANK,
  checkQuestion,
  coerceRawQuestion,
  dedupeQuestions,
  makeValidationContext,
  selectQuestions,
  validateBatch,
} from "./validate";

const article = lyonArticle();
const categories: Category[] = [
  { id: "history", name: "History", description: "", sectionIds: ["s1", "s2", "s3"] },
  { id: "geography", name: "Geography", description: "", sectionIds: ["s0", "s4"] },
  { id: "culture", name: "Culture", description: "", sectionIds: ["s5"] },
];
const ctx = makeValidationContext(article, categories);

function rq(overrides: Partial<RawQuestion> = {}): RawQuestion {
  return {
    id: "q1",
    type: "multiple_choice",
    category: "history",
    difficulty: "medium",
    prompt: "Which emperor, besides Caracalla, was born in Lugdunum?",
    options: ["Claudius", "Nero", "Trajan", "Hadrian"],
    correctAnswer: "Claudius",
    acceptableAnswers: [],
    explanation: "Claudius and Caracalla were both born there.",
    sourceSection: "s2",
    sourceQuote: "Two emperors, Claudius and Caracalla, were born there.",
    ...overrides,
  };
}

function ok(raw: RawQuestion): Question {
  const r = checkQuestion(raw, ctx);
  if (!r.ok) throw new Error(`expected valid, got: ${r.reason}`);
  return r.question;
}

function reason(raw: RawQuestion): string {
  const r = checkQuestion(raw, ctx);
  if (r.ok) throw new Error("expected rejection");
  return r.reason;
}

describe("checkQuestion: multiple choice", () => {
  it("accepts a well-formed question", () => {
    const q = ok(rq());
    expect(q.options).toHaveLength(4);
    expect(q.correctAnswer).toBe("Claudius");
    expect(q.acceptableAnswers).toEqual([]);
  });

  it("matches the correct answer to an option case/accent-insensitively and uses the option's text", () => {
    expect(ok(rq({ correctAnswer: "claudius" })).correctAnswer).toBe("Claudius");
  });

  it("requires exactly 4 options", () => {
    expect(reason(rq({ options: ["Claudius", "Nero", "Trajan"] }))).toMatch(/4 options/);
    expect(reason(rq({ options: ["Claudius", "Nero", "Trajan", "Hadrian", "Augustus"] }))).toMatch(/4 options/);
    expect(reason(rq({ options: null }))).toMatch(/4 options/);
  });

  it("requires exactly one correct option", () => {
    expect(reason(rq({ correctAnswer: "Augustus" }))).toMatch(/exactly one option/);
  });

  it("rejects duplicate options (after normalization)", () => {
    expect(reason(rq({ options: ["Claudius", "Nero", "nero", "Hadrian"] }))).toMatch(/duplicate/);
  });

  it("rejects 'all/none of the above'", () => {
    expect(reason(rq({ options: ["Claudius", "Nero", "Trajan", "None of the above"] }))).toMatch(/above/);
  });

  it("rejects distractors of a different kind for numeric answers", () => {
    const raw = rq({
      prompt: "In which year did the first Canut revolt take place?",
      options: ["1831", "1789", "Paris", "1848"],
      correctAnswer: "1831",
      sourceSection: "s3",
      sourceQuote: "The Canut revolts of 1831 and 1834 were among the first workers' uprisings",
    });
    expect(reason(raw)).toMatch(/same kind/);
    expect(ok({ ...raw, options: ["1831", "1789", "1871", "1848"] }).correctAnswer).toBe("1831");
  });

  it("rejects a giveaway correct option that is far longer than the distractors", () => {
    expect(
      reason(
        rq({
          options: ["Claudius, the Roman emperor born in Lugdunum in 10 BC", "Nero", "Trajan", "Otho"],
          correctAnswer: "Claudius, the Roman emperor born in Lugdunum in 10 BC",
        }),
      ),
    ).toMatch(/giveaway/);
  });
});

describe("checkQuestion: true/false", () => {
  it("normalizes the answer to 'true'/'false' (including other languages)", () => {
    const base = rq({
      type: "true_false",
      prompt: "Lyon is located at the confluence of the Rhône and the Saône.",
      options: null,
      correctAnswer: "True",
      sourceSection: "s0",
      sourceQuote: "located at the confluence of the rivers Rhône and Saône",
    });
    expect(ok(base).correctAnswer).toBe("true");
    expect(ok({ ...base, correctAnswer: "Faux" }).correctAnswer).toBe("false");
    expect(ok({ ...base, correctAnswer: "vrai" }).correctAnswer).toBe("true");
    expect(ok(base).options).toBeUndefined();
    expect(reason({ ...base, correctAnswer: "maybe" })).toMatch(/true\/false/);
  });

  it("drops options and aliases that don't apply", () => {
    const q = ok(
      rq({
        type: "true_false",
        prompt: "Lyon is the largest city in France.",
        options: ["true", "false"],
        correctAnswer: "false",
        acceptableAnswers: ["no"],
        sourceSection: "s0",
        sourceQuote: "is the third-largest city of France",
      }),
    );
    expect(q.options).toBeUndefined();
    expect(q.acceptableAnswers).toEqual([]);
  });
});

describe("checkQuestion: short answer and fill-in-the-blank", () => {
  const shortQ = rq({
    type: "short_answer",
    prompt: "What was the Roman name of the colony founded in 43 BC on the site of Lyon?",
    options: null,
    correctAnswer: "Lugdunum",
    acceptableAnswers: ["lugdunum", "Lugudunum", "", "Lugdunum"],
    sourceSection: "s1",
    sourceQuote: "The city was founded as the Roman colony of Lugdunum in 43 BC.",
  });

  it("accepts a short answer and cleans the alias list", () => {
    const q = ok(shortQ);
    expect(q.correctAnswer).toBe("Lugdunum");
    expect(q.acceptableAnswers).toEqual(["Lugudunum"]);
    expect(q.options).toBeUndefined();
  });

  it("rejects answers that are too long", () => {
    expect(reason({ ...shortQ, correctAnswer: "the Roman colony founded in 43 BC by the Romans themselves" })).toMatch(
      /too long/,
    );
  });

  it("rejects prompts that contain the answer", () => {
    expect(reason({ ...shortQ, prompt: "What was Lugdunum, the colony on the site of Lyon, called?" })).toMatch(
      /gives away/,
    );
  });

  it("normalizes blank markers and requires exactly one blank", () => {
    const fb = rq({
      type: "fill_blank",
      prompt: "The Canut revolts took place in 1831 and [blank].",
      options: null,
      correctAnswer: "1834",
      sourceSection: "s3",
      sourceQuote: "The Canut revolts of 1831 and 1834",
    });
    expect(ok(fb).prompt).toBe(`The Canut revolts took place in 1831 and ${BLANK}.`);
    expect(ok({ ...fb, prompt: "The Canut revolts took place in 1831 and ___." }).prompt).toContain(BLANK);
    expect(reason({ ...fb, prompt: "The Canut revolts took place in 1831 and 1834." })).toMatch(/one blank/);
    expect(reason({ ...fb, prompt: "The ___ revolts took place in 1831 and ___." })).toMatch(/one blank/);
  });
});

describe("checkQuestion: grounding in the article", () => {
  it("accepts quotes with different punctuation, case or quote marks", () => {
    expect(ok(rq({ sourceQuote: "“two emperors - Claudius and Caracalla - were born there”" })).sourceSection).toBe("s2");
  });

  it("accepts a lightly paraphrased quote but rejects one that isn't in the article", () => {
    expect(ok(rq({ sourceQuote: "Two emperors, Claudius and Caracalla, were both born there" })).sourceSection).toBe("s2");
    expect(reason(rq({ sourceQuote: "Claudius was the fourth emperor of the Julio-Claudian dynasty." }))).toMatch(
      /not found/,
    );
    expect(reason(rq({ sourceQuote: "" }))).toMatch(/missing source quote/);
  });

  it("fixes the section id when the quote is from a different section", () => {
    expect(ok(rq({ sourceSection: "s5" })).sourceSection).toBe("s2");
    expect(ok(rq({ sourceSection: "Ancient Lyon" })).sourceSection).toBe("s2");
    expect(ok(rq({ sourceSection: "" })).sourceSection).toBe("s2");
  });

  it("resolves categories by id or name and rejects unknown ones", () => {
    expect(ok(rq({ category: "History" })).category).toBe("history");
    expect(reason(rq({ category: "sports" }))).toMatch(/unknown category/);
  });

  it("fills in a missing explanation from the quote", () => {
    expect(ok(rq({ explanation: "" })).explanation).toContain("Two emperors");
  });
});

describe("coerceRawQuestion / validateBatch", () => {
  it("repairs near-miss shapes", () => {
    const raw = coerceRawQuestion({
      ...rq(),
      type: "Multiple-Choice",
      difficulty: "Hard",
      acceptableAnswers: undefined,
    });
    expect(raw?.type).toBe("multiple_choice");
    expect(raw?.difficulty).toBe("hard");
    expect(raw?.acceptableAnswers).toEqual([]);

    const tf = coerceRawQuestion({ ...rq(), type: "true/false", options: undefined, correctAnswer: false });
    expect(tf?.type).toBe("true_false");
    expect(tf?.correctAnswer).toBe("false");
    expect(tf?.options).toBeNull();
  });

  it("rejects things that aren't questions at all", () => {
    expect(coerceRawQuestion(null)).toBeNull();
    expect(coerceRawQuestion("q")).toBeNull();
    expect(coerceRawQuestion({ ...rq(), type: "essay" })).toBeNull();
    expect(coerceRawQuestion({ prompt: "only a prompt" })).toBeNull();
  });

  it("validates a mixed batch question by question", () => {
    const { valid, rejected } = validateBatch(
      [rq(), { garbage: true }, rq({ id: "q3", correctAnswer: "Augustus" })],
      ctx,
    );
    expect(valid).toHaveLength(1);
    expect(rejected.map((r) => r.reason)).toEqual(["didn't match the question schema", "correct answer must match exactly one option"]);
  });
});

describe("dedupeQuestions", () => {
  const base = ok(rq());

  it("drops near-identical prompts", () => {
    const again = { ...base, id: "q2", prompt: "Besides Caracalla, which emperor was born in Lugdunum?" };
    const { kept, dropped } = dedupeQuestions([base, again]);
    expect(kept).toHaveLength(1);
    expect(dropped[0]!.reason).toBe("duplicate");
  });

  it("drops a second question testing the same answer from the same quote", () => {
    const sameFact = ok(
      rq({
        id: "q2",
        type: "short_answer",
        prompt: "Name the Roman emperor (other than Caracalla) who was a native of the city.",
        options: null,
        correctAnswer: "Claudius",
      }),
    );
    expect(dedupeQuestions([base, sameFact]).kept).toHaveLength(1);
  });

  it("keeps different questions, including true/false ones with the same answer", () => {
    const tf1 = ok(
      rq({ id: "t1", type: "true_false", prompt: "Lyon is the third-largest city of France.", options: null, correctAnswer: "true", sourceSection: "s0", sourceQuote: "is the third-largest city of France" }),
    );
    const tf2 = ok(
      rq({ id: "t2", type: "true_false", prompt: "The Fête des Lumières is held around 8 December.", options: null, correctAnswer: "true", category: "culture", sourceSection: "s5", sourceQuote: "The Fête des Lumières takes place every year around 8 December." }),
    );
    expect(dedupeQuestions([base, tf1, tf2]).kept).toHaveLength(3);
  });

  it("drops repeats of prompts from earlier quizzes", () => {
    const { kept, dropped } = dedupeQuestions([base], ["Which emperor, besides Caracalla, was born in Lugdunum?"]);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toMatch(/earlier quiz/);
  });
});

describe("selectQuestions", () => {
  const mk = (id: string, category: string, type: Question["type"]): Question => ({
    ...ok(rq()),
    id,
    category,
    type,
  });

  it("meets per-category targets, balances types and interleaves categories", () => {
    const pool = [
      mk("h1", "history", "multiple_choice"),
      mk("h2", "history", "multiple_choice"),
      mk("h3", "history", "true_false"),
      mk("g1", "geography", "short_answer"),
      mk("g2", "geography", "short_answer"),
      mk("c1", "culture", "fill_blank"),
    ];
    const out = selectQuestions(pool, { history: 2, geography: 1, culture: 1 }, ["multiple_choice", "true_false", "short_answer", "fill_blank"], 4);
    expect(out.map((q) => q.id)).toEqual(["h1", "g1", "c1", "h3"]);
  });

  it("fills a shortfall in one category from the others", () => {
    const pool = [mk("h1", "history", "multiple_choice"), mk("h2", "history", "multiple_choice"), mk("g1", "geography", "true_false")];
    const out = selectQuestions(pool, { history: 1, geography: 1, culture: 1 }, ["multiple_choice", "true_false"], 3);
    expect(out).toHaveLength(3);
    expect(out.filter((q) => q.category === "history")).toHaveLength(2);
  });

  it("returns fewer when the pool is too small", () => {
    expect(selectQuestions([mk("h1", "history", "multiple_choice")], { history: 3 }, ["multiple_choice"], 3)).toHaveLength(1);
  });
});
