/**
 * Find the numbers in an answer, whether written as digits ("1,834", "3.5",
 * "21st") or as English words ("forty-three", "one hundred and twenty",
 * "nineteen eighty-four", "third"). Common standalone number words in a few
 * other languages are recognized too; Claude is also asked to list
 * alternative forms as acceptable answers, which covers the rest.
 */

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, nought: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100, hundredth: 100, thousand: 1_000, thousandth: 1_000,
  million: 1_000_000, millionth: 1_000_000, billion: 1_000_000_000, billionth: 1_000_000_000,
};

/**
 * Standalone number words in other common Wikipedia languages (accents
 * stripped). Only used when the article is in that language, since many are
 * ordinary words or names elsewhere ("due", "Otto", "Dix").
 */
const OTHER_LANG: Record<string, Record<string, number>> = {
  fr: {
    un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
    onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30,
    quarante: 40, cinquante: 50, soixante: 60, cent: 100, mille: 1000, premier: 1, premiere: 1,
    deuxieme: 2, troisieme: 3,
  },
  es: {
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
    once: 11, doce: 12, veinte: 20, treinta: 30, cien: 100, mil: 1000, primero: 1, segundo: 2, tercero: 3,
  },
  pt: {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
    dez: 10, vinte: 20, cem: 100, mil: 1000,
  },
  it: {
    uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
    venti: 20, cento: 100, mille: 1000, primo: 1, secondo: 2, terzo: 3,
  },
  de: {
    eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
    zehn: 10, elf: 11, zwolf: 12, zwanzig: 20, dreissig: 30, hundert: 100, tausend: 1000,
  },
  nl: {
    een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10,
    twaalf: 12, twintig: 20, honderd: 100, duizend: 1000,
  },
};

/**
 * Digit literals, longest form first:
 *   1,834 / 1 834 / 522 250 (comma/space thousands groups, optional .decimal)
 *   1.834,5 (dot thousands groups, optional ,decimal)
 *   3.5 / 3,5 / 1834
 * followed by an optional ordinal suffix (21st, 3e, 2ème, 1er).
 */
const DIGITS =
  /(?<!\d)(?:(\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?)|(\d{1,3}(?:\.\d{3})+(?:,\d+)?)|(\d+(?:[.,]\d+)?))(?!\d)(?:\s*(hundred|thousand|millions?|billions?|milliards?|millones|mill[oó]n|milion[ei]|milh[õo]es|millionen|mio|mrd|mn|bn|k)(?![\p{L}]))?/giu;

/** Scale words that can follow digits: "3 million", "1.5 bn", "2 Mio.". */
const DIGIT_SCALES: Record<string, number> = {
  hundred: 100, thousand: 1e3, k: 1e3,
  million: 1e6, millions: 1e6, millones: 1e6, millon: 1e6, "millón": 1e6, milione: 1e6, milioni: 1e6,
  "milhões": 1e6, milhoes: 1e6, millionen: 1e6, mio: 1e6, mn: 1e6,
  billion: 1e9, billions: 1e9, milliard: 1e9, milliards: 1e9, mrd: 1e9, bn: 1e9,
};

function stripAccents(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/ß/g, "ss");
}

export function extractNumbers(raw: string, lang = "en"): number[] {
  const values: number[] = [];
  const otherWords = OTHER_LANG[lang.split("-")[0]!] ?? {};

  // 1) Digit literals. Blank them out so they aren't read again as words.
  const rest = raw.replace(
    DIGITS,
    (_m, commaGrouped?: string, dotGrouped?: string, plain?: string, scaleWord?: string) => {
      let v: number;
      if (commaGrouped) v = Number(commaGrouped.replace(/[,\s]/g, ""));
      else if (dotGrouped) v = Number(dotGrouped.replace(/\./g, "").replace(",", "."));
      else v = Number(plain!.replace(",", "."));
      if (scaleWord) v *= DIGIT_SCALES[scaleWord.toLowerCase()] ?? 1;
      if (Number.isFinite(v)) values.push(Math.round(v * 1e6) / 1e6);
      return " ";
    },
  );

  // 2) Number words.
  const tokens = stripAccents(rest)
    .replace(/[-‐–—]/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  let total = 0; // finished thousand/million groups
  let current = 0; // value below the last big scale
  let active = false;
  let yearStyle = false; // already used "nineteen eighty" → 1980

  const flush = () => {
    if (active) values.push(total + current);
    total = 0;
    current = 0;
    active = false;
    yearStyle = false;
  };
  const start = (v: number) => {
    flush();
    current = v;
    active = true;
  };
  /** "nineteen" + "eighty" → 1980, "twenty" + "twenty" → 2020, "eighteen" + "oh" → 1800 */
  const canYear = () => !yearStyle && total === 0 && current >= 10 && current < 100;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];

    if (Object.hasOwn(UNITS, t)) {
      const u = UNITS[t]!;
      const lastTwo = current % 100;
      if (!active) start(u);
      else if (current === 0) current = u; // after "thousand"/"million"
      else if (u < 10 && lastTwo >= 20 && lastTwo % 10 === 0) current += u; // forty-three, 1980 + 4
      else if (lastTwo === 0) current += u; // one hundred (and) five, 1800 + 5
      else if (canYear()) {
        current = current * 100 + u;
        yearStyle = true;
      } else start(u);
    } else if (Object.hasOwn(TENS, t)) {
      const v = TENS[t]!;
      if (!active) start(v);
      else if (current === 0 || current % 100 === 0) current += v; // two thousand twenty, one hundred twenty
      else if (canYear()) {
        current = current * 100 + v;
        yearStyle = true;
      } else start(v);
    } else if (Object.hasOwn(SCALES, t)) {
      const scale = SCALES[t]!;
      if (!active) {
        current = 1;
        active = true;
      }
      if (scale === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * scale;
        current = 0;
      }
    } else if (t === "and" && active && isNumberWord(next)) {
      continue; // one hundred and five
    } else if (t === "a" && next !== undefined && Object.hasOwn(SCALES, next)) {
      continue; // a hundred
    } else if (Object.hasOwn(otherWords, t)) {
      flush();
      values.push(otherWords[t]!);
    } else {
      flush();
    }
  }
  flush();
  return values;
}

function isNumberWord(t: string | undefined): boolean {
  return t !== undefined && (Object.hasOwn(UNITS, t) || Object.hasOwn(TENS, t) || Object.hasOwn(SCALES, t));
}

/** Same numbers, in any order. */
export function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => Math.abs(v - y[i]!) < 1e-9);
}
