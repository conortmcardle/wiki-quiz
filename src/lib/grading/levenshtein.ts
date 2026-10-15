/**
 * Edit distance with adjacent transpositions counted as one edit
 * (optimal string alignment), so "Lugudnum" vs "Lugdunum" is 1 typo, not 2.
 * Stops early and returns `max + 1` once the distance must exceed `max`.
 */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  const s = Array.from(a);
  const t = Array.from(b);
  if (Math.abs(s.length - t.length) > max) return max + 1;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let prevPrev: number[] = [];
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        d = Math.min(d, prevPrev[j - 2]! + 1);
      }
      cur.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[t.length]!;
}

/**
 * How many typos to forgive for an answer of `length` characters (letters,
 * spaces removed). Short answers must be exact: "Iran"/"Iraq" are different
 * countries. Longer ones allow roughly one slip per five letters, capped at 3.
 */
export function allowedTypos(length: number): number {
  if (length <= 4) return 0;
  if (length <= 9) return 1;
  if (length <= 14) return 2;
  return 3;
}
