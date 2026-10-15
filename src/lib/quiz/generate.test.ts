import { beforeEach, describe, expect, it, vi } from "vitest";
import { lyonArticle } from "../../test/helpers";
import { callClaudeJson } from "../claude/client";
import type { RawQuestion } from "../claude/schema";
import { AppError } from "../errors";
import { generateQuiz } from "./generate";
import type { Category, QuizConfig } from "./types";

vi.mock("../claude/client", () => ({ callClaudeJson: vi.fn() }));
const mockedCall = vi.mocked(callClaudeJson);

const article = lyonArticle();
const settings = { apiKey: "sk-ant-test", model: "claude-sonnet-5-5", refusalFallback: true };
const config: QuizConfig = {
  types: ["multiple_choice", "short_answer", "true_false", "fill_blank"],
  count: 8,
  difficulty: "mixed",
};

const categoriesReply = {
  categories: [
    { id: "history", name: "History", description: "Roman and industrial past", sectionIds: ["s1", "s2", "s3"] },
    { id: "geography", name: "Geography", description: "Location and climate", sectionIds: ["s0", "s4"] },
    { id: "culture", name: "Culture", description: "Festivals", sectionIds: ["s5"] },
    { id: "people", name: "People", description: "Famous natives", sectionIds: [] },
  ],
};

const q = (id: string, o: Partial<RawQuestion>): RawQuestion => ({
  id,
  type: "short_answer",
  category: "history",
  difficulty: "medium",
  prompt: "",
  options: null,
  correctAnswer: "",
  acceptableAnswers: [],
  explanation: "Because the article says so.",
  sourceSection: "s1",
  sourceQuote: "",
  ...o,
});

const GOOD: RawQuestion[] = [
  q("h1", { type: "multiple_choice", prompt: "Which emperor was born in Lugdunum along with Caracalla?", options: ["Claudius", "Nero", "Trajan", "Hadrian"], correctAnswer: "Claudius", sourceSection: "s2", sourceQuote: "Two emperors, Claudius and Caracalla, were born there." }),
  q("h2", { prompt: "What was the Roman colony on the site of Lyon called?", correctAnswer: "Lugdunum", sourceQuote: "founded as the Roman colony of Lugdunum in 43 BC" }),
  q("h3", { type: "true_false", prompt: "The first Canut revolt took place in 1831.", correctAnswer: "true", sourceSection: "s3", sourceQuote: "The Canut revolts of 1831 and 1834 were among the first workers' uprisings" }),
  q("g1", { category: "geography", type: "true_false", prompt: "Lyon lies where the Rhône meets the Loire.", correctAnswer: "false", sourceSection: "s0", sourceQuote: "located at the confluence of the rivers Rhône and Saône" }),
  q("g2", { category: "geography", type: "fill_blank", prompt: "Lyon has a _____ subtropical climate.", correctAnswer: "humid", sourceSection: "s4", sourceQuote: "Lyon has a humid subtropical climate bordering on an oceanic climate." }),
  q("g3", { category: "geography", type: "multiple_choice", prompt: "How far is Lyon from Paris?", options: ["391 km", "120 km", "580 km", "250 km"], correctAnswer: "391 km", sourceSection: "s0", sourceQuote: "391 km southeast of Paris" }),
  q("c1", { category: "culture", type: "true_false", prompt: "The Fête des Lumières is held around 8 December.", correctAnswer: "true", sourceSection: "s5", sourceQuote: "The Fête des Lumières takes place every year around 8 December." }),
  q("c2", { category: "culture", type: "multiple_choice", prompt: "In which month is the Fête des Lumières held?", options: ["December", "June", "March", "October"], correctAnswer: "December", sourceSection: "s5", sourceQuote: "takes place every year around 8 December" }),
  q("p1", { category: "people", prompt: "Apart from Claudius, which Roman emperor was born in the city?", correctAnswer: "Caracalla", sourceSection: "s2", sourceQuote: "Two emperors, Claudius and Caracalla, were born there." }),
  q("p2", { category: "people", type: "fill_blank", prompt: "The Canut revolts of 1831 and _____ were early workers' uprisings.", correctAnswer: "1834", sourceSection: "s3", sourceQuote: "The Canut revolts of 1831 and 1834 were among the first workers' uprisings of the Industrial Revolution." }),
];

const BAD: RawQuestion[] = [
  q("x1", { prompt: "Who was mayor of Lyon in 1990?", correctAnswer: "Michel Noir", sourceQuote: "Michel Noir served as mayor from 1989 to 1995." }), // not in article
  q("x2", { type: "multiple_choice", prompt: "Which river?", options: ["Rhône", "Seine"], correctAnswer: "Rhône", sourceSection: "s0", sourceQuote: "the rivers Rhône and Saône" }), // 2 options
];

function reply(data: unknown) {
  return Promise.resolve({ data, attempts: 1 }) as ReturnType<typeof callClaudeJson>;
}

beforeEach(() => {
  mockedCall.mockReset();
});

describe("generateQuiz", () => {
  it("creates categories, writes questions, validates and balances them", async () => {
    mockedCall.mockImplementation((opts) =>
      opts.label === "categories" ? reply(categoriesReply) : reply({ questions: [...GOOD, ...BAD] }),
    );
    const onCategories = vi.fn();
    const progress: string[] = [];

    const quiz = await generateQuiz({
      article,
      config,
      settings,
      onCategories,
      onProgress: (p) => progress.push(p.phase),
    });

    expect(mockedCall).toHaveBeenCalledTimes(2); // categories + one question call (short article)
    expect(onCategories).toHaveBeenCalledOnce();
    expect(progress).toEqual(expect.arrayContaining(["categories", "questions", "checking"]));

    expect(quiz.questions).toHaveLength(8);
    expect(quiz.questions.map((x) => x.id)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
    expect(new Set(quiz.questions.map((x) => x.category))).toEqual(new Set(["history", "geography", "culture", "people"]));
    expect(quiz.questions.some((x) => x.prompt.includes("mayor"))).toBe(false);
    for (const x of quiz.questions.filter((x) => x.type === "multiple_choice")) {
      expect(x.options).toHaveLength(4);
      expect(x.options).toContain(x.correctAnswer);
    }
    expect(quiz.warnings).toEqual([]);
    expect(quiz.categories).toHaveLength(4);
    expect(quiz.article.sections.s2).toEqual({ title: "Ancient Lyon", anchor: "Ancient_Lyon" });

    // The question call carried the article sections, the category list and the quota.
    const questionCall = mockedCall.mock.calls[1]![0];
    expect(questionCall.user).toContain('<section id="s3"');
    expect(questionCall.user).toContain("- people: People.");
    expect(questionCall.user).toMatch(/Questions per category: history: \d/);
  });

  it("reuses cached categories instead of asking again", async () => {
    mockedCall.mockImplementation(() => reply({ questions: GOOD }));
    const cats: Category[] = categoriesReply.categories.map((c) => ({ ...c }));
    const quiz = await generateQuiz({ article, config: { ...config, count: 4 }, settings, categories: cats });
    expect(mockedCall).toHaveBeenCalledTimes(1);
    expect(mockedCall.mock.calls[0]![0].label).toMatch(/questions/);
    expect(quiz.questions).toHaveLength(4);
  });

  it("tops up once when validation leaves too few questions, avoiding repeats", async () => {
    let questionCalls = 0;
    mockedCall.mockImplementation((opts) => {
      if (opts.label === "categories") return reply(categoriesReply);
      questionCalls++;
      return reply({ questions: questionCalls === 1 ? [...GOOD.slice(0, 3), ...BAD] : GOOD.slice(3) });
    });
    const quiz = await generateQuiz({ article, config, settings });
    expect(questionCalls).toBe(2);
    expect(quiz.questions).toHaveLength(8);
    const topUpPrompt = mockedCall.mock.calls[2]![0].user;
    expect(topUpPrompt).toContain("already seen these questions");
    expect(topUpPrompt).toContain("Which emperor was born in Lugdunum along with Caracalla?");
  });

  it("returns a shorter quiz with a warning when even the top-up falls short", async () => {
    mockedCall.mockImplementation((opts) =>
      opts.label === "categories" ? reply(categoriesReply) : reply({ questions: GOOD.slice(0, 5) }),
    );
    const quiz = await generateQuiz({ article, config, settings });
    expect(quiz.questions).toHaveLength(5);
    expect(quiz.warnings[0]).toMatch(/Only 5 of 8/);
  });

  it("fails with a helpful error when nothing passes validation", async () => {
    mockedCall.mockImplementation((opts) =>
      opts.label === "categories" ? reply(categoriesReply) : reply({ questions: BAD }),
    );
    const err = (await generateQuiz({ article, config, settings }).catch((e: unknown) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.kind).toBe("bad-output");
    expect(err.detail).toMatch(/source quote not found/);
  });

  it("stops on fatal API errors such as rate limits", async () => {
    mockedCall.mockImplementation((opts) =>
      opts.label === "categories"
        ? reply(categoriesReply)
        : Promise.reject(new AppError("rate-limit", "slow down")),
    );
    const err = (await generateQuiz({ article, config, settings }).catch((e: unknown) => e)) as AppError;
    expect(err.kind).toBe("rate-limit");
  });

  it("keeps going when one call returns unusable output", async () => {
    let n = 0;
    mockedCall.mockImplementation((opts) => {
      if (opts.label === "categories") return reply(categoriesReply);
      n++;
      return n === 1 ? Promise.reject(new AppError("bad-output", "junk")) : reply({ questions: GOOD });
    });
    const quiz = await generateQuiz({ article, config, settings });
    expect(quiz.questions).toHaveLength(8);
  });

  it("asks again when Claude returns too few categories", async () => {
    let n = 0;
    mockedCall.mockImplementation((opts) => {
      if (opts.label !== "categories") return reply({ questions: GOOD });
      n++;
      return reply(n === 1 ? { categories: categoriesReply.categories.slice(0, 2) } : categoriesReply);
    });
    const quiz = await generateQuiz({ article, config, settings });
    expect(n).toBe(2);
    expect(mockedCall.mock.calls[1]![0].user).toMatch(/had 2 usable categories/);
    expect(quiz.categories).toHaveLength(4);
  });

  it("weights questions toward weak categories", async () => {
    mockedCall.mockImplementation(() => reply({ questions: GOOD }));
    const cats: Category[] = categoriesReply.categories.map((c) => ({ ...c }));
    await generateQuiz({
      article,
      config: { ...config, count: 6, categoryWeights: { history: 4, geography: 1, culture: 1, people: 0 } },
      settings,
      categories: cats,
    });
    const prompt = mockedCall.mock.calls[0]![0].user;
    const quota = /Questions per category: (.*)/.exec(prompt)![1]!;
    expect(quota).not.toContain("people");
    const historyAsked = Number(/history: (\d+)/.exec(quota)![1]);
    const cultureAsked = Number(/culture: (\d+)/.exec(quota)![1]);
    expect(historyAsked).toBeGreaterThan(cultureAsked);
  });
});
