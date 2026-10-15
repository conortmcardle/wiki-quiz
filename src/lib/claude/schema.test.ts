import { describe, expect, it } from "vitest";
import { CategoriesResponseSchema, extractJson, QuestionsResponseSchema, safeParseJson } from "./schema";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON inside a code fence or surrounded by prose", () => {
    expect(extractJson('Here you go:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":3} Hope that helps.')).toEqual({ a: 3 });
  });

  it("throws on malformed or missing JSON", () => {
    expect(() => extractJson('{"a":')).toThrow();
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("safeParseJson", () => {
  const goodCategory = { categories: [{ id: "h", name: "History", description: "d", sectionIds: ["s1"] }] };

  it("returns data when the JSON matches the schema", () => {
    const r = safeParseJson(JSON.stringify(goodCategory), CategoriesResponseSchema);
    expect(r.ok && r.data.categories[0]!.name).toBe("History");
  });

  it("reports malformed JSON without throwing", () => {
    const r = safeParseJson('{"categories": [', CategoriesResponseSchema);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Malformed JSON/);
  });

  it("reports schema mismatches with the failing path", () => {
    const r = safeParseJson('{"categories": [{"id": "h"}]}', CategoriesResponseSchema);
    expect(!r.ok && r.error).toMatch(/categories\.0\.name/);
  });

  it("enforces question field types", () => {
    const q = {
      id: "q1",
      type: "essay",
      category: "h",
      difficulty: "easy",
      prompt: "p",
      options: null,
      correctAnswer: "a",
      acceptableAnswers: [],
      explanation: "e",
      sourceSection: "s1",
      sourceQuote: "q",
    };
    expect(safeParseJson(JSON.stringify({ questions: [q] }), QuestionsResponseSchema).ok).toBe(false);
    expect(safeParseJson(JSON.stringify({ questions: [{ ...q, type: "short_answer" }] }), QuestionsResponseSchema).ok).toBe(true);
  });
});
