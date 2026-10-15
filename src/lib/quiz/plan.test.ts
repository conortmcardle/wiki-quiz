import { describe, expect, it } from "vitest";
import { lyonArticle, syntheticArticle } from "../../test/helpers";
import {
  allocateQuestions,
  buildChunks,
  difficultySequence,
  largestRemainder,
  MAX_CHUNK_CHARS,
  normalizeCategories,
  typeSequence,
  withHeadroom,
} from "./plan";
import type { Category } from "./types";

const sum = (o: Record<string, number | undefined>) => Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);

describe("normalizeCategories", () => {
  const article = lyonArticle(); // sections s0..s5

  it("slugifies and de-duplicates ids, drops invalid/duplicate section ids", () => {
    const cats = normalizeCategories(
      {
        categories: [
          { id: "History & Origins", name: "History", description: " Past ", sectionIds: ["s1", "s2", "s99"] },
          { id: "history-origins", name: "Silk", description: "", sectionIds: ["s3", "s2"] },
          { id: "géographie", name: "Géographie", description: "", sectionIds: ["s0", "s4"] },
          { id: "", name: "Culture", description: "", sectionIds: ["s5"] },
          { id: "x", name: "   ", description: "", sectionIds: [] },
        ],
      },
      article,
    );
    expect(cats.map((c) => c.id)).toEqual(["history-origins", "history-origins-2", "geographie", "culture"]);
    expect(cats[0]!.sectionIds).toEqual(["s1", "s2"]);
    expect(cats[1]!.sectionIds).toEqual(["s3"]); // s2 already taken
    expect(cats[0]!.description).toBe("Past");
  });

  it("assigns every forgotten section to a category", () => {
    const cats = normalizeCategories(
      {
        categories: [
          { id: "a", name: "A", description: "", sectionIds: ["s0", "s2"] },
          { id: "b", name: "B", description: "", sectionIds: ["s5"] },
        ],
      },
      article,
    );
    const all = cats.flatMap((c) => c.sectionIds).sort();
    expect(all).toEqual(article.sections.map((s) => s.id).sort());
    // s3 (History › Silk industry) joins s2 (History › Ancient Lyon)'s category
    expect(cats.find((c) => c.id === "a")!.sectionIds).toContain("s3");
  });

  it("keeps at most 8 categories (the ones with the most text)", () => {
    const big = syntheticArticle(12, 50);
    const cats = normalizeCategories(
      {
        categories: big.sections.slice(0, 10).map((s, i) => ({
          id: `c${i}`,
          name: `C${i}`,
          description: "",
          sectionIds: i === 0 ? [s.id, "s10", "s11"] : [s.id],
        })),
      },
      big,
    );
    expect(cats).toHaveLength(8);
    expect(cats.flatMap((c) => c.sectionIds)).toHaveLength(12);
  });
});

describe("allocateQuestions", () => {
  const article = syntheticArticle(6, 200);
  const cats: Category[] = [
    { id: "a", name: "A", description: "", sectionIds: ["s0", "s1"] },
    { id: "b", name: "B", description: "", sectionIds: ["s2", "s3"] },
    { id: "c", name: "C", description: "", sectionIds: ["s4"] },
    { id: "d", name: "D", description: "", sectionIds: ["s5"] },
  ];

  it("spreads questions evenly by default", () => {
    const q = allocateQuestions(cats, article, 15);
    expect(sum(q)).toBe(15);
    expect(Math.max(...Object.values(q)) - Math.min(...Object.values(q))).toBeLessThanOrEqual(1);
  });

  it("weights toward weak categories when asked", () => {
    const q = allocateQuestions(cats, article, 12, { a: 3, b: 1, c: 1, d: 1 });
    expect(sum(q)).toBe(12);
    expect(q.a).toBe(6);
    expect(q.b).toBe(2);
  });

  it("doesn't overload categories with little text unless it must", () => {
    const small = syntheticArticle(4, 200);
    small.sections[3]!.wordCount = 40; // ~1 question's worth
    small.wordCount = 640;
    const c2: Category[] = [
      { id: "big", name: "Big", description: "", sectionIds: ["s0", "s1", "s2"] },
      { id: "tiny", name: "Tiny", description: "", sectionIds: ["s3"] },
    ];
    const q = allocateQuestions(c2, small, 10);
    expect(q.tiny).toBe(1);
    expect(q.big).toBe(9);
  });
});

describe("sequences", () => {
  it("interleaves types evenly", () => {
    expect(typeSequence(["multiple_choice", "true_false"], 5)).toEqual([
      "multiple_choice",
      "true_false",
      "multiple_choice",
      "true_false",
      "multiple_choice",
    ]);
  });

  it("mixes difficulties ~30/40/30 for 'mixed'", () => {
    const d = difficultySequence("mixed", 10);
    expect(d.filter((x) => x === "easy")).toHaveLength(3);
    expect(d.filter((x) => x === "medium")).toHaveLength(4);
    expect(d.filter((x) => x === "hard")).toHaveLength(3);
    expect(new Set(difficultySequence("hard", 4))).toEqual(new Set(["hard"]));
  });

  it("largestRemainder splits totals exactly", () => {
    expect(largestRemainder([1, 1, 1], 10)).toEqual([4, 3, 3]);
    expect(largestRemainder([0, 0], 3)).toEqual([3, 0]);
    expect(withHeadroom({ a: 4, b: 0, c: 1 })).toEqual({ a: 5, b: 0, c: 2 });
  });
});

describe("buildChunks", () => {
  it("uses a single call for short articles", () => {
    const article = lyonArticle();
    const cats: Category[] = [
      { id: "h", name: "H", description: "", sectionIds: ["s1", "s2", "s3"] },
      { id: "g", name: "G", description: "", sectionIds: ["s0", "s4"] },
      { id: "c", name: "C", description: "", sectionIds: ["s5"] },
    ];
    const chunks = buildChunks(article, cats, { h: 3, g: 2, c: 0 }, ["multiple_choice", "short_answer"], "mixed");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sections).toHaveLength(article.sections.length);
    expect(chunks[0]!.perCategory).toEqual({ h: 3, g: 2 });
    expect(sum(chunks[0]!.perType)).toBe(5);
    expect(sum(chunks[0]!.perDifficulty)).toBe(5);
  });

  it("splits long articles by category so every section's full text is sent once", () => {
    // 40 sections × ~2,000 words ≈ 850k characters
    const article = syntheticArticle(40, 2000, (i) => `Part ${Math.floor(i / 10)}`);
    const cats: Category[] = [0, 1, 2, 3].map((k) => ({
      id: `p${k}`,
      name: `Part ${k}`,
      description: "",
      sectionIds: article.sections.slice(k * 10, k * 10 + 10).map((s) => s.id),
    }));
    const quotas = { p0: 4, p1: 4, p2: 4, p3: 3 };
    const chunks = buildChunks(article, cats, quotas, ["multiple_choice", "true_false", "short_answer", "fill_blank"], "mixed");

    expect(chunks.length).toBeGreaterThan(4);
    for (const c of chunks) {
      const chars = c.sections.reduce((n, s) => n + s.text.length, 0);
      expect(chars).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(sum(c.perType)).toBe(sum(c.perCategory));
      expect(sum(c.perDifficulty)).toBe(sum(c.perCategory));
    }
    // quotas preserved per category
    const totals: Record<string, number> = {};
    for (const c of chunks) for (const [k, v] of Object.entries(c.perCategory)) totals[k] = (totals[k] ?? 0) + v;
    expect(totals).toEqual(quotas);
    // Questions come from across the article, not just the start: the
    // article's final sections are covered too.
    const covered = new Set(chunks.flatMap((c) => c.sections.map((s) => s.id)));
    expect(covered.has("s39")).toBe(true);
    expect(covered.has("s30")).toBe(true);
    // every chunk with several questions gets a mix of types, and the totals stay balanced
    for (const c of chunks.filter((c) => sum(c.perCategory) >= 2)) {
      expect(Object.keys(c.perType).length).toBeGreaterThan(1);
    }
    const typeTotals: Record<string, number> = {};
    for (const c of chunks) for (const [k, v] of Object.entries(c.perType)) typeTotals[k] = (typeTotals[k] ?? 0) + (v ?? 0);
    expect(Math.max(...Object.values(typeTotals)) - Math.min(...Object.values(typeTotals))).toBeLessThanOrEqual(1);
  });

  it("puts categories without sections in the chunk with the introduction", () => {
    const article = syntheticArticle(30, 2000);
    const cats: Category[] = [
      { id: "a", name: "A", description: "", sectionIds: article.sections.slice(0, 15).map((s) => s.id) },
      { id: "b", name: "B", description: "", sectionIds: article.sections.slice(15).map((s) => s.id) },
      { id: "c", name: "C", description: "", sectionIds: [] },
    ];
    const chunks = buildChunks(article, cats, { a: 3, b: 3, c: 2 }, ["multiple_choice"], "easy");
    const withLead = chunks.find((c) => c.sections.some((s) => s.id === "s0"))!;
    expect(withLead.perCategory.c).toBe(2);
  });

  it("spreads a category's few questions from its first part to its last", () => {
    // one category, ~600k characters → 6+ parts, only 3 questions
    const article = syntheticArticle(30, 2000);
    const cats: Category[] = [{ id: "a", name: "A", description: "", sectionIds: article.sections.map((s) => s.id) }];
    const chunks = buildChunks(article, cats, { a: 3 }, ["multiple_choice"], "easy");
    expect(chunks).toHaveLength(3);
    const ids = chunks.flatMap((c) => c.sections.map((s) => s.id));
    expect(ids).toContain("s0");
    expect(ids).toContain("s29");
  });
});
