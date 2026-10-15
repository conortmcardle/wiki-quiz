import type { CategoriesResponse } from "../claude/schema";
import type { ChunkRequest } from "../claude/prompts";
import { slugify } from "../text";
import type { Article, ArticleSection } from "../wikipedia/types";
import type { Category, Difficulty, DifficultySetting, QuestionType } from "./types";

export const MIN_CATEGORIES = 4;
export const MAX_CATEGORIES = 8;

/** Articles up to this size (~20k tokens) are sent in a single question-writing call. */
export const SINGLE_CALL_CHARS = 80_000;
/** Upper bound for the article text in one question-writing call (~25k tokens). */
export const MAX_CHUNK_CHARS = 100_000;

/** Roughly how many words of text one question needs. */
const WORDS_PER_QUESTION = 35;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Clean up Claude's categories: unique slug ids, valid section ids, each
 * section in exactly one category, at most MAX_CATEGORIES. Sections Claude
 * forgot are attached to a sensible neighbour.
 */
export function normalizeCategories(raw: CategoriesResponse, article: Article): Category[] {
  const validIds = new Set(article.sections.map((s) => s.id));
  const usedIds = new Set<string>();
  const assigned = new Set<string>();
  let cats: Category[] = [];

  raw.categories.forEach((c, i) => {
    const name = c.name.trim();
    if (!name) return;
    let id = slugify(c.id) || slugify(name) || `topic-${i + 1}`;
    while (usedIds.has(id)) id = `${id}-${i + 1}`;
    usedIds.add(id);
    const sectionIds = c.sectionIds
      .map((s) => s.trim())
      .filter((s) => validIds.has(s) && !assigned.has(s));
    sectionIds.forEach((s) => assigned.add(s));
    cats.push({ id, name, description: c.description.trim(), sectionIds });
  });

  if (cats.length > MAX_CATEGORIES) {
    // Keep the categories with the most text; their sections get re-homed below.
    const words = (c: Category) => sectionWords(c, article);
    const keep = new Set([...cats].sort((a, b) => words(b) - words(a)).slice(0, MAX_CATEGORIES));
    cats = cats.filter((c) => keep.has(c));
  }

  return assignOrphanSections(cats, article);
}

/** Give every content section a category (in place on copies). */
export function assignOrphanSections(categories: Category[], article: Article): Category[] {
  if (categories.length === 0) return categories;
  const cats = categories.map((c) => ({ ...c, sectionIds: [...c.sectionIds] }));
  const owner = new Map<string, Category>();
  cats.forEach((c) => c.sectionIds.forEach((s) => owner.set(s, c)));

  article.sections.forEach((section, index) => {
    if (owner.has(section.id)) return;
    // 1) a category that already holds a sibling under the same top-level heading
    const top = section.path[0];
    let home = top
      ? article.sections.find((s) => s.id !== section.id && s.path[0] === top && owner.has(s.id))
      : undefined;
    // 2) otherwise the category of the previous section in the article
    if (!home) {
      for (let i = index - 1; i >= 0 && !home; i--) {
        if (owner.has(article.sections[i]!.id)) home = article.sections[i];
      }
    }
    const cat = home ? owner.get(home.id)! : smallest(cats, article);
    cat.sectionIds.push(section.id);
    owner.set(section.id, cat);
  });

  // Keep each category's sections in article order.
  const order = new Map(article.sections.map((s, i) => [s.id, i]));
  cats.forEach((c) => c.sectionIds.sort((a, b) => order.get(a)! - order.get(b)!));
  return cats;
}

function smallest(cats: Category[], article: Article): Category {
  return [...cats].sort((a, b) => sectionWords(a, article) - sectionWords(b, article))[0]!;
}

export function sectionWords(c: Category, article: Article): number {
  const ids = new Set(c.sectionIds);
  return article.sections.filter((s) => ids.has(s.id)).reduce((n, s) => n + s.wordCount, 0);
}

// ---------------------------------------------------------------------------
// How many questions per category
// ---------------------------------------------------------------------------

/**
 * Split `count` questions across categories in proportion to their weights
 * (default 1 each, so an even spread), without asking a category for more
 * questions than its text can support unless nothing else has room.
 * Uses the D'Hondt method so results are proportional and deterministic.
 */
export function allocateQuestions(
  categories: Category[],
  article: Article,
  count: number,
  weights: Record<string, number> = {},
): Record<string, number> {
  const result: Record<string, number> = {};
  if (categories.length === 0 || count <= 0) return result;

  const totalWords = article.wordCount || 1;
  const capacity = categories.map((c) => {
    const words = c.sectionIds.length ? sectionWords(c, article) : totalWords / categories.length;
    return Math.max(1, Math.floor(words / WORDS_PER_QUESTION));
  });
  const weight = categories.map((c) => Math.max(0, weights[c.id] ?? 1));
  const assigned = categories.map(() => 0);

  for (let k = 0; k < count; k++) {
    let best = -1;
    let bestScore = -1;
    for (const respectCapacity of [true, false]) {
      categories.forEach((_, i) => {
        if (weight[i] === 0) return;
        if (respectCapacity && assigned[i]! >= capacity[i]!) return;
        const score = weight[i]! / (assigned[i]! + 1);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best !== -1) break;
    }
    if (best === -1) best = 0; // all weights zero: fall back to the first category
    assigned[best]!++;
  }

  categories.forEach((c, i) => (result[c.id] = assigned[i]!));
  return result;
}

// ---------------------------------------------------------------------------
// Types and difficulty mix
// ---------------------------------------------------------------------------

/** Evenly interleaved list of `n` question types. */
export function typeSequence(types: QuestionType[], n: number): QuestionType[] {
  if (types.length === 0) return [];
  return Array.from({ length: n }, (_, i) => types[i % types.length]!);
}

/** `n` difficulties: all the same, or ~30% easy / 40% medium / 30% hard, interleaved. */
export function difficultySequence(setting: DifficultySetting, n: number): Difficulty[] {
  if (setting !== "mixed") return Array.from({ length: n }, () => setting);
  const pattern: Difficulty[] = ["medium", "easy", "hard", "medium", "easy", "hard", "medium", "hard", "easy", "medium"];
  return Array.from({ length: n }, (_, i) => pattern[i % pattern.length]!);
}

function countBy<T extends string>(items: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const x of items) out[x] = (out[x] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------
// Chunking long articles
// ---------------------------------------------------------------------------

interface Unit {
  sections: ArticleSection[];
  chars: number;
  perCategory: Record<string, number>;
}

/**
 * Group the article into question-writing calls. Short articles go in one
 * call. Longer ones get a call per category (or per group of small
 * categories), and any category with more text than fits in one call is split
 * by section, with its questions shared out in proportion to text length.
 * Each call therefore sees full, untruncated section text.
 */
export function buildChunks(
  article: Article,
  categories: Category[],
  quotas: Record<string, number>,
  types: QuestionType[],
  difficulty: DifficultySetting,
): ChunkRequest[] {
  const byId = new Map(article.sections.map((s) => [s.id, s]));
  const totalChars = article.sections.reduce((n, s) => n + s.text.length, 0);
  const active = categories.filter((c) => (quotas[c.id] ?? 0) > 0);

  let units: Unit[];
  if (totalChars <= SINGLE_CALL_CHARS) {
    units = [
      {
        sections: article.sections,
        chars: totalChars,
        perCategory: Object.fromEntries(active.map((c) => [c.id, quotas[c.id]!])),
      },
    ];
  } else {
    units = [];
    const homeless: Record<string, number> = {}; // categories with no sections of their own
    for (const c of active) {
      const sections = c.sectionIds.map((id) => byId.get(id)).filter((s): s is ArticleSection => !!s);
      if (sections.length === 0) {
        homeless[c.id] = quotas[c.id]!;
        continue;
      }
      units.push(...splitCategory(c.id, sections, quotas[c.id]!));
    }
    if (Object.keys(homeless).length) {
      // Put them with the introduction, which summarizes the whole article.
      const leadUnit = units.find((u) => u.sections.some((s) => s.id === "s0"));
      const lead = byId.get("s0") ?? article.sections[0];
      if (leadUnit) Object.assign(leadUnit.perCategory, homeless);
      else if (lead) units.unshift({ sections: [lead], chars: lead.text.length, perCategory: homeless });
    }
    units = packUnits(units);
  }

  // Hand each chunk a consecutive run of the interleaved type/difficulty
  // sequences: every chunk gets a mix, and the totals stay balanced.
  const totals = units.map((u) => sum(Object.values(u.perCategory)));
  const typeSeq = typeSequence(types, sum(totals));
  const diffSeq = difficultySequence(difficulty, sum(totals));
  let offset = 0;
  return units.map((u, i) => {
    const n = totals[i]!;
    const chunk = {
      sections: u.sections,
      perCategory: u.perCategory,
      perType: countBy(typeSeq.slice(offset, offset + n)),
      perDifficulty: countBy(diffSeq.slice(offset, offset + n)),
    };
    offset += n;
    return chunk;
  });
}

function splitCategory(categoryId: string, sections: ArticleSection[], quota: number): Unit[] {
  const parts: ArticleSection[][] = [[]];
  let size = 0;
  for (const s of sections) {
    if (size > 0 && size + s.text.length > MAX_CHUNK_CHARS) {
      parts.push([]);
      size = 0;
    }
    parts[parts.length - 1]!.push(s);
    size += s.text.length;
  }
  const chars = parts.map((p) => sum(p.map((s) => s.text.length)));
  let shares: number[];
  if (quota < parts.length) {
    // Fewer questions than parts: one question each for parts spread from
    // the first to the last, so neither end of a long category is skipped.
    shares = parts.map(() => 0);
    if (quota === 1) {
      const lead = parts.findIndex((p) => p.some((s) => s.id === "s0"));
      shares[lead !== -1 ? lead : Math.floor(parts.length / 2)] = 1;
    } else {
      for (let i = 0; i < quota; i++) shares[Math.round((i * (parts.length - 1)) / (quota - 1))] = 1;
    }
  } else {
    shares = largestRemainder(chars, quota);
  }
  return parts
    .map((p, i) => ({ sections: p, chars: chars[i]!, perCategory: { [categoryId]: shares[i]! } }))
    .filter((u) => u.perCategory[categoryId]! > 0);
}

/** Merge adjacent small units so short categories share a call. */
function packUnits(units: Unit[]): Unit[] {
  const out: Unit[] = [];
  for (const u of units) {
    const last = out[out.length - 1];
    if (last && last.chars + u.chars <= MAX_CHUNK_CHARS) {
      const ids = new Set(last.sections.map((s) => s.id));
      last.sections.push(...u.sections.filter((s) => !ids.has(s.id)));
      last.chars += u.chars;
      for (const [k, v] of Object.entries(u.perCategory)) last.perCategory[k] = (last.perCategory[k] ?? 0) + v;
    } else {
      out.push({ sections: [...u.sections], chars: u.chars, perCategory: { ...u.perCategory } });
    }
  }
  // Present sections in article order inside each call.
  for (const u of out) u.sections.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return out;
}

/** Split `total` into integers proportional to `weights`. */
export function largestRemainder(weights: number[], total: number): number[] {
  const sumW = sum(weights);
  if (sumW <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map((w) => (w / sumW) * total);
  const floors = exact.map(Math.floor);
  let left = total - sum(floors);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i]!++;
    left--;
  }
  return floors;
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/**
 * Ask for a few more questions than needed so validation and de-duplication
 * can drop weak ones and still leave enough.
 */
export function withHeadroom(quotas: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(quotas)) out[id] = n === 0 ? 0 : n + Math.max(1, Math.round(n * 0.25));
  return out;
}
