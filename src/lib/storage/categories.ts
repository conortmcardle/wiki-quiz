import { assignOrphanSections } from "../quiz/plan";
import type { Category } from "../quiz/types";
import type { Article } from "../wikipedia/types";

/**
 * Categories are cached per article so every quiz on the same article uses
 * the same categories — that's what makes "History: 2/6 → 5/6" comparable
 * across attempts. Sections are stored by anchor (not by "s3"-style id) so
 * the mapping survives edits to the article.
 */

interface StoredCategories {
  version: 1;
  savedAt: string;
  categories: { id: string; name: string; description: string; sectionAnchors: string[] }[];
}

function key(article: Pick<Article, "lang" | "pageId">): string {
  return `wikiquiz.categories.v1.${article.lang}:${article.pageId}`;
}

export function loadCachedCategories(article: Article): Category[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(key(article));
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredCategories;
    if (stored.version !== 1 || !Array.isArray(stored.categories)) return null;

    const byAnchor = new Map(article.sections.map((s) => [s.anchor, s.id]));
    const cats: Category[] = stored.categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sectionIds: c.sectionAnchors.map((a) => byAnchor.get(a)).filter((id): id is string => !!id),
    }));
    // If the article was restructured so much that most categories lost all
    // their sections, start over with fresh categories.
    const live = cats.filter((c) => c.sectionIds.length > 0).length;
    if (cats.length < 2 || live < Math.ceil(cats.length / 2)) return null;
    return assignOrphanSections(cats, article);
  } catch {
    return null;
  }
}

export function saveCachedCategories(article: Article, categories: Category[]): void {
  const anchorOf = new Map(article.sections.map((s) => [s.id, s.anchor]));
  const stored: StoredCategories = {
    version: 1,
    savedAt: new Date().toISOString(),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      sectionAnchors: c.sectionIds.map((id) => anchorOf.get(id)).filter((a): a is string => a !== undefined),
    })),
  };
  try {
    globalThis.localStorage?.setItem(key(article), JSON.stringify(stored));
  } catch {
    /* storage full/unavailable: categories just won't be reused */
  }
}

export function clearCachedCategories(article: Pick<Article, "lang" | "pageId">): void {
  try {
    globalThis.localStorage?.removeItem(key(article));
  } catch {
    /* ignore */
  }
}
