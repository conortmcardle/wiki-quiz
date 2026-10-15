/**
 * Text normalization shared by validation (quote matching, duplicate
 * detection) and grading: lowercase, accents removed, punctuation → spaces.
 */
export function normalizeForCompare(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // combining accents
    .toLowerCase()
    .replace(/[ßẞ]/g, "ss")
    .replace(/[æ]/g, "ae")
    .replace(/[œ]/g, "oe")
    .replace(/[ø]/g, "o")
    .replace(/[đ]/g, "d")
    .replace(/[ł]/g, "l")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const SPACELESS_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Words for spaced languages; characters for Chinese/Japanese/Thai. */
export function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  if (SPACELESS_SCRIPT.test(normalized)) {
    return Array.from(normalized.replace(/\s+/g, ""));
  }
  return normalized.split(" ").filter(Boolean);
}

export function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function slugify(s: string): string {
  return normalizeForCompare(s).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

export function wordCount(s: string): number {
  return tokenize(normalizeForCompare(s)).length;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
