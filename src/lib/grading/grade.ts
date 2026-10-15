import type { Question } from "../quiz/types";
import { normalizeForCompare } from "../text";
import { allowedTypos, editDistance } from "./levenshtein";
import { extractNumbers, sameNumbers } from "./numbers";

export type GradeHow =
  | "choice" // picked the right option / true-false
  | "exact" // matches the answer (ignoring case, accents, punctuation, articles)
  | "alias" // matches one of the accepted alternatives
  | "typo" // close enough: small spelling slip
  | "number" // same number, written differently ("forty-three" / "43")
  | "wrong"
  | "empty";

export interface GradeResult {
  correct: boolean;
  how: GradeHow;
  /** The accepted answer the response matched, when it differs from the response. */
  matched?: string;
}

/** Leading articles dropped before comparing ("the Rhône" = "Rhône"). */
const ARTICLES = new Set([
  "the", "a", "an",
  "le", "la", "les", "l", "un", "une",
  "der", "die", "das", "den", "dem", "ein", "eine",
  "el", "los", "las", "lo",
  "il", "gli", "i",
  "o", "os", "as", "um", "uma",
  "het", "een",
]);

/** Words that don't change a numeric answer ("about 391 km" = "391"). */
const NUMBER_FILLER = new Set([
  "about", "around", "approximately", "approx", "roughly", "circa", "ca", "c", "nearly", "almost",
  "over", "some", "in", "on", "the", "of", "year", "years", "yr", "yrs", "age", "aged",
  "km", "kilometre", "kilometres", "kilometer", "kilometers", "km2", "sq", "square",
  "m", "metre", "metres", "meter", "meters", "mi", "mile", "miles", "ft", "feet", "foot",
  "kg", "kilogram", "kilograms", "tonne", "tonnes", "ton", "tons", "percent", "per", "cent", "pct",
  "people", "inhabitants", "residents", "million", "millions", "thousand", "billion",
  "bc", "bce", "ad", "ce", "st", "nd", "rd", "th", "and", "e", "er", "eme",
]);
const ERA_BEFORE = new Set(["bc", "bce"]);
const ERA_AFTER = new Set(["ad", "ce"]);

export function normalizeAnswer(s: string): string {
  const n = normalizeForCompare(s);
  const words = n.split(" ");
  if (words.length > 1 && ARTICLES.has(words[0]!)) return words.slice(1).join(" ");
  return n;
}

/** Accepted answers, plus versions without a trailing parenthetical: "Mercury (planet)" → "Mercury". */
function candidates(q: Question): { text: string; how: "exact" | "alias" }[] {
  const out: { text: string; how: "exact" | "alias" }[] = [];
  const seen = new Set<string>();
  const add = (text: string, how: "exact" | "alias") => {
    const key = normalizeAnswer(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ text, how });
  };
  add(q.correctAnswer, "exact");
  q.acceptableAnswers.forEach((a) => add(a, "alias"));
  for (const c of [...out]) {
    const stripped = c.text.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (stripped && stripped !== c.text) add(stripped, "alias");
  }
  return out;
}

function isNumeric(text: string, lang: string): boolean {
  if (/\d/.test(text)) return true;
  const nums = extractNumbers(text, lang);
  return nums.length > 0 && significantWords(text, lang).length === 0;
}

/** Words other than numbers, number words and filler. */
function significantWords(text: string, lang: string): string[] {
  const words = normalizeForCompare(text).split(" ").filter(Boolean);
  return words.filter((w) => !/^\d+$/.test(w) && !NUMBER_FILLER.has(w) && extractNumbers(w, lang).length === 0);
}

function fuzzyWordIn(word: string, pool: string[]): boolean {
  return pool.some((p) => p === word || editDistance(p, word, allowedTypos(p.length)) <= allowedTypos(p.length));
}

function eraOf(text: string): "before" | "after" | null {
  const words = normalizeForCompare(text).split(" ");
  if (words.some((w) => ERA_BEFORE.has(w))) return "before";
  if (words.some((w) => ERA_AFTER.has(w))) return "after";
  return null;
}

/**
 * Numbers must match exactly (no typo tolerance: 1831 ≠ 1834), and any
 * other meaningful words must match too ("8 December" ≠ "8 June"), but
 * units and filler are optional ("about 391 km" = "391").
 */
function numericMatch(expected: string, response: string, lang: string): boolean {
  const en = extractNumbers(expected, lang);
  const rn = extractNumbers(response, lang);
  if (!sameNumbers(en, rn)) return false;
  const eEra = eraOf(expected);
  const rEra = eraOf(response);
  if (eEra && rEra && eEra !== rEra) return false;
  const ew = significantWords(expected, lang);
  const rw = significantWords(response, lang);
  return ew.every((w) => fuzzyWordIn(w, rw)) && rw.every((w) => fuzzyWordIn(w, ew));
}

/** Lenient grading for typed answers (short answer and fill-in-the-blank). */
export function gradeTyped(q: Pick<Question, "correctAnswer" | "acceptableAnswers">, response: string, lang = "en"): GradeResult {
  const r = normalizeAnswer(response);
  if (!r) return { correct: false, how: "empty" };
  const rCompact = r.replace(/ /g, "");
  const cands = candidates(q as Question);

  // 1) exact or alias match (case/accents/punctuation/articles/spacing ignored)
  for (const c of cands) {
    const e = normalizeAnswer(c.text);
    if (e === r || e.replace(/ /g, "") === rCompact) {
      return { correct: true, how: c.how, ...(c.how === "alias" ? { matched: c.text } : {}) };
    }
  }

  // 2) numbers written differently
  for (const c of cands) {
    if (isNumeric(c.text, lang) && numericMatch(c.text, response, lang)) {
      return { correct: true, how: "number", matched: c.text };
    }
  }

  // 3) the answer plus a word or two ("Emperor Claudius" for "Claudius")
  for (const c of cands) {
    if (isNumeric(c.text, lang)) continue;
    const e = normalizeAnswer(c.text);
    const extra = r.split(" ").length - e.split(" ").length;
    if (extra > 0 && extra <= 2 && ` ${r} `.includes(` ${e} `)) {
      return { correct: true, how: c.how, matched: c.text };
    }
  }

  // 4) small typos, scaled to answer length; never for numeric answers
  for (const c of cands) {
    if (isNumeric(c.text, lang) || /\d/.test(r)) continue;
    const eCompact = normalizeAnswer(c.text).replace(/ /g, "");
    const allowed = allowedTypos(eCompact.length);
    if (allowed > 0 && editDistance(rCompact, eCompact, allowed) <= allowed) {
      return { correct: true, how: "typo", matched: c.text };
    }
  }

  return { correct: false, how: "wrong" };
}

export function gradeAnswer(q: Question, response: string, lang = "en"): GradeResult {
  switch (q.type) {
    case "multiple_choice":
      if (!response) return { correct: false, how: "empty" };
      return normalizeForCompare(response) === normalizeForCompare(q.correctAnswer)
        ? { correct: true, how: "choice" }
        : { correct: false, how: "wrong" };
    case "true_false":
      if (!response) return { correct: false, how: "empty" };
      return response.trim().toLowerCase() === q.correctAnswer
        ? { correct: true, how: "choice" }
        : { correct: false, how: "wrong" };
    case "short_answer":
    case "fill_blank":
      return gradeTyped(q, response, lang);
  }
}
