import { describe, expect, it } from "vitest";
import type { Question } from "../quiz/types";
import { gradeAnswer, gradeTyped, normalizeAnswer } from "./grade";
import { allowedTypos, editDistance } from "./levenshtein";
import { extractNumbers, sameNumbers } from "./numbers";

const typed = (correctAnswer: string, acceptableAnswers: string[] = []) => ({ correctAnswer, acceptableAnswers });

function expectCorrect(answer: { correctAnswer: string; acceptableAnswers: string[] }, response: string, lang = "en") {
  const r = gradeTyped(answer, response, lang);
  expect(r.correct, `"${response}" should match "${answer.correctAnswer}" (got ${r.how})`).toBe(true);
  return r;
}

function expectWrong(answer: { correctAnswer: string; acceptableAnswers: string[] }, response: string, lang = "en") {
  const r = gradeTyped(answer, response, lang);
  expect(r.correct, `"${response}" should NOT match "${answer.correctAnswer}" (got ${r.how})`).toBe(false);
  return r;
}

describe("editDistance / allowedTypos", () => {
  it("counts substitutions, insertions, deletions and transpositions", () => {
    expect(editDistance("lugdunum", "lugdunum")).toBe(0);
    expect(editDistance("lugdnum", "lugdunum")).toBe(1);
    expect(editDistance("lugudnum", "lugdunum")).toBe(1); // swapped letters
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
  });

  it("stops early above the limit", () => {
    expect(editDistance("abcdefgh", "zyxwvuts", 2)).toBe(3);
  });

  it("scales the tolerance with length", () => {
    expect(allowedTypos(4)).toBe(0);
    expect(allowedTypos(5)).toBe(1);
    expect(allowedTypos(9)).toBe(1);
    expect(allowedTypos(10)).toBe(2);
    expect(allowedTypos(30)).toBe(3);
  });
});

describe("extractNumbers", () => {
  it.each([
    ["1834", [1834]],
    ["1,834", [1834]],
    ["522 250", [522250]],
    ["1.834.000", [1834000]],
    ["3.5", [3.5]],
    ["3,5", [3.5]],
    ["21st", [21]],
    ["43 BC", [43]],
    ["1831 and 1834", [1831, 1834]],
    ["3 million", [3_000_000]],
    ["1.5 billion", [1_500_000_000]],
    ["seven", [7]],
    ["forty-three", [43]],
    ["one hundred and twenty", [120]],
    ["a hundred", [100]],
    ["two thousand and five", [2005]],
    ["two thousand one hundred", [2100]],
    ["three million", [3_000_000]],
    ["nineteen eighty-four", [1984]],
    ["eighteen thirty-one", [1831]],
    ["twenty twenty", [2020]],
    ["nineteen oh five", [1905]],
    ["third", [3]],
    ["twenty-first", [21]],
    ["the constructor of the bridge", []],
    ["no numbers here", []],
  ])("%s → %j", (text, expected) => {
    expect(extractNumbers(text)).toEqual(expected);
  });

  it("reads number words in the article's language only", () => {
    expect(extractNumbers("trois", "fr")).toEqual([3]);
    expect(extractNumbers("trois", "en")).toEqual([]);
    expect(extractNumbers("Otto von Bismarck", "en")).toEqual([]);
    expect(extractNumbers("zwölf", "de")).toEqual([12]);
  });

  it("compares numbers as multisets", () => {
    expect(sameNumbers([1834, 1831], [1831, 1834])).toBe(true);
    expect(sameNumbers([1831], [1831, 1834])).toBe(false);
  });
});

describe("normalizeAnswer", () => {
  it("ignores case, accents, punctuation and a leading article", () => {
    expect(normalizeAnswer("  The Rhône! ")).toBe("rhone");
    expect(normalizeAnswer("l'Europe")).toBe("europe");
    expect(normalizeAnswer("St. Louis")).toBe("st louis");
    expect(normalizeAnswer("A")).toBe("a"); // a lone article is the answer itself
  });
});

describe("gradeTyped: lenient text matching", () => {
  it("accepts case, accent, punctuation and article differences", () => {
    expect(expectCorrect(typed("Lugdunum"), "lugdunum").how).toBe("exact");
    expectCorrect(typed("Saône"), "saone");
    expectCorrect(typed("Rhône"), "the Rhone");
    expectCorrect(typed("St. Louis"), "st louis");
    expectCorrect(typed("Marie Skłodowska"), "marie sklodowska");
    expectCorrect(typed("Notre-Dame"), "notre dame");
    expectCorrect(typed("MarieCurie"), "Marie Curie");
  });

  it("accepts listed aliases", () => {
    const r = expectCorrect(typed("Lugdunum", ["Lugudunum"]), "lugudunum");
    expect(r.how).toBe("alias");
    expect(r.matched).toBe("Lugudunum");
    expectCorrect(typed("December", ["Dec"]), "dec.");
  });

  it("accepts the answer without a trailing parenthetical", () => {
    expectCorrect(typed("Mercury (planet)"), "Mercury");
  });

  it("accepts the answer with a word or two of context", () => {
    expectCorrect(typed("Claudius"), "Emperor Claudius");
    expectWrong(typed("Claudius"), "a Roman emperor who was not Claudius at all");
  });

  it("forgives small typos, scaled to answer length", () => {
    expect(expectCorrect(typed("Lugdunum"), "Lugdnum").how).toBe("typo");
    expectCorrect(typed("Caracalla"), "Caracala");
    expectCorrect(typed("Claudius"), "Claudious");
    expectCorrect(typed("Industrial Revolution"), "industrial revoluton");
    expectCorrect(typed("Gallia Lugdunensis"), "Galia Lugdunensis");
  });

  it("doesn't let typo tolerance turn one real answer into another", () => {
    expectWrong(typed("Iraq"), "Iran"); // short answers must be exact
    expectWrong(typed("Austria"), "Australia");
    expectWrong(typed("Lyon"), "Lion");
    expectWrong(typed("Claudius"), "Nero");
  });

  it("rejects empty answers", () => {
    expect(gradeTyped(typed("Lyon"), "   ").how).toBe("empty");
  });
});

describe("gradeTyped: numbers", () => {
  it("treats digits and words as the same number", () => {
    expect(expectCorrect(typed("3"), "three").how).toBe("number");
    expectCorrect(typed("three"), "3");
    expectCorrect(typed("1834"), "eighteen thirty-four");
    expectCorrect(typed("1,834"), "1834");
    expectCorrect(typed("third"), "3rd");
    expectCorrect(typed("43 BC"), "forty-three BC");
    expectCorrect(typed("3 million"), "3,000,000");
  });

  it("never forgives a wrong digit", () => {
    expectWrong(typed("1831"), "1834");
    expectWrong(typed("1831"), "1832");
    expectWrong(typed("391 km"), "390 km");
  });

  it("makes units and filler optional but keeps meaningful words", () => {
    expectCorrect(typed("391 km"), "391");
    expectCorrect(typed("391 km"), "about 391 kilometres");
    expectCorrect(typed("43 BC"), "43");
    expectCorrect(typed("8 December"), "December 8");
    expectCorrect(typed("8 December"), "8 Decmber");
    expectWrong(typed("8 December"), "8 June");
    expectWrong(typed("8 December"), "8");
    expectWrong(typed("43 BC"), "43 AD");
  });

  it("understands number words in the article's language", () => {
    expectCorrect(typed("3"), "trois", "fr");
    expectCorrect(typed("12"), "zwölf", "de");
  });
});

describe("gradeAnswer by question type", () => {
  const base: Question = {
    id: "q1",
    type: "multiple_choice",
    category: "history",
    difficulty: "easy",
    prompt: "?",
    options: ["Claudius", "Nero", "Trajan", "Hadrian"],
    correctAnswer: "Claudius",
    acceptableAnswers: [],
    explanation: "",
    sourceSection: "s2",
    sourceQuote: "",
  };

  it("multiple choice: the chosen option must be the correct one", () => {
    expect(gradeAnswer(base, "Claudius")).toEqual({ correct: true, how: "choice" });
    expect(gradeAnswer(base, "Nero").correct).toBe(false);
    expect(gradeAnswer(base, "").how).toBe("empty");
  });

  it("true/false", () => {
    const tf: Question = { ...base, type: "true_false", options: undefined, correctAnswer: "false" };
    expect(gradeAnswer(tf, "false").correct).toBe(true);
    expect(gradeAnswer(tf, "true").correct).toBe(false);
  });

  it("short answer and fill-in-the-blank use lenient matching", () => {
    const sa: Question = { ...base, type: "short_answer", options: undefined, correctAnswer: "Lugdunum" };
    expect(gradeAnswer(sa, "lugdnum").how).toBe("typo");
    const fb: Question = { ...base, type: "fill_blank", options: undefined, correctAnswer: "1834" };
    expect(gradeAnswer(fb, "eighteen thirty-four").how).toBe("number");
  });
});
