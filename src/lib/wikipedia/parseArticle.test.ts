import { describe, expect, it } from "vitest";
import disambigHtml from "../../test/fixtures/disambig.html?raw";
import legacyHtml from "../../test/fixtures/legacy.html?raw";
import modernHtml from "../../test/fixtures/modern.html?raw";
import parsoidHtml from "../../test/fixtures/parsoid.html?raw";
import {
  countWords,
  extractDisambiguationOptions,
  htmlToText,
  isNonContentHeading,
  parseArticleHtml,
} from "./parseArticle";

describe("parseArticleHtml: current Wikipedia markup (div.mw-heading)", () => {
  const sections = parseArticleHtml(modernHtml);
  const byTitle = (t: string) => sections.find((s) => s.title === t)!;

  it("keeps content sections in order with levels, anchors and heading paths", () => {
    expect(sections.map((s) => [s.id, s.title, s.level, s.anchor])).toEqual([
      ["s0", "Introduction", 1, ""],
      ["s1", "Toponymy", 2, "Toponymy"],
      ["s2", "Ancient Lyon", 3, "Ancient_Lyon"],
      ["s3", "Silk industry", 3, "Silk_industry"],
      ["s4", "Climate", 3, "Climate"],
      ["s5", "Économie et culture", 2, "Économie_et_culture"],
    ]);
    expect(byTitle("Silk industry").path).toEqual(["History", "Silk industry"]);
    expect(byTitle("Climate").path).toEqual(["Geography", "Climate"]);
  });

  it("drops headings with no prose of their own (History, Geography)", () => {
    expect(sections.find((s) => s.title === "History")).toBeUndefined();
    expect(sections.find((s) => s.title === "Geography")).toBeUndefined();
  });

  it("drops See also / References / External links and their sub-sections", () => {
    const titles = sections.map((s) => s.title);
    for (const t of ["See also", "References", "Citations", "Sources", "External links"]) {
      expect(titles).not.toContain(t);
    }
    const all = sections.map((s) => s.text).join("\n");
    expect(all).not.toContain("Some book about Lyon");
    expect(all).not.toContain("Official website");
  });

  it("strips citations, edit links, hatnotes, navboxes, styles, figures and the short description", () => {
    const all = sections.map((s) => s.text).join("\n");
    expect(all).not.toMatch(/\[\d+\]/);
    expect(all).not.toMatch(/\bedit\b/);
    expect(all).not.toContain("citation needed");
    expect(all).not.toContain("For other uses");
    expect(all).not.toContain("Main article");
    expect(all).not.toContain("Cities in France");
    expect(all).not.toContain("font-style");
    expect(all).not.toContain("Roman theatre on Fourvière");
    expect(all).not.toContain("City in Auvergne-Rhône-Alpes");
  });

  it("puts infobox facts into the lead", () => {
    const lead = byTitle("Introduction").text;
    expect(lead).toContain("Key facts:");
    expect(lead).toContain("Country: France");
    expect(lead).toContain("Population: 522,250");
    expect(lead).toContain("Lyon (/liˈɒn/) is the third-largest city of France.");
    expect(lead).toContain("391 km southeast of Paris.");
  });

  it("turns lists into '- item' lines and keeps nested items", () => {
    const silk = byTitle("Silk industry").text;
    expect(silk).toContain("- First revolt: 1831");
    expect(silk).toMatch(/- Second revolt: 1834 Suppressed by the army/);
  });

  it("includes wikitable rows", () => {
    const climate = byTitle("Climate").text;
    expect(climate).toContain("Climate data for Lyon");
    expect(climate).toContain("Mean high °C | 7.1 | 27.8");
  });

  it("counts words", () => {
    expect(byTitle("Toponymy").wordCount).toBe(countWords(byTitle("Toponymy").text));
    expect(byTitle("Toponymy").wordCount).toBeGreaterThan(10);
  });
});

describe("parseArticleHtml: legacy markup (span.mw-headline)", () => {
  const sections = parseArticleHtml(legacyHtml);

  it("reads anchors from the headline span and ignores the TOC heading", () => {
    expect(sections.map((s) => [s.title, s.anchor, s.level])).toEqual([
      ["Introduction", "", 1],
      ["Early life", "Early_life", 2],
      ["Education", "Education", 3],
    ]);
    expect(sections[0]!.text).not.toContain("Contents");
    expect(sections[0]!.text).toContain("first woman to win a Nobel Prize");
  });
});

describe("parseArticleHtml: Parsoid markup (nested <section>)", () => {
  const sections = parseArticleHtml(parsoidHtml);

  it("walks nested sections in document order", () => {
    expect(sections.map((s) => [s.title, s.level, s.path.join(" > ")])).toEqual([
      ["Introduction", 1, ""],
      ["Childhood", 3, "Biography > Childhood"],
      ["Adult years", 3, "Biography > Adult years"],
      ["Legacy", 2, "Legacy"],
    ]);
  });

  it("removes Parsoid refs and TeX annotations", () => {
    const all = sections.map((s) => s.text).join("\n");
    expect(all).not.toContain("[1]");
    expect(all).not.toContain("B_8");
    expect(all).toContain("Analytical Engine.");
  });
});

describe("helpers", () => {
  it("recognizes reference-type headings in several languages", () => {
    for (const h of ["References", "Notes et références", "Einzelnachweise", "Véase también", "See also", "Liens externes"]) {
      expect(isNonContentHeading(h)).toBe(true);
    }
    for (const h of ["History", "Notable people", "Économie"]) {
      expect(isNonContentHeading(h)).toBe(false);
    }
  });

  it("counts CJK text sensibly", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("东京是日本的首都")).toBe(4);
  });

  it("strips markup from display titles", () => {
    expect(htmlToText("<i>Hamlet</i>")).toBe("Hamlet");
  });
});

describe("extractDisambiguationOptions", () => {
  it("lists the first live internal link of each item, without duplicates, red links, special pages or navboxes", () => {
    const options = extractDisambiguationOptions(disambigHtml);
    expect(options.map((o) => o.title)).toEqual([
      "Mercury (planet)",
      "Mercury (element)",
      "Mercury (mythology)",
      "Freddie Mercury",
    ]);
    expect(options[0]!.description).toBe("the planet closest to the Sun");
    expect(options[3]!.description).toBe("(1946–1991), lead singer of Queen");
  });

  it("understands Parsoid ./Title links", () => {
    const html = `<ul><li><a href="./Mercury_(planet)">Mercury (planet)</a>, a planet</li></ul>`;
    expect(extractDisambiguationOptions(html)[0]!.title).toBe("Mercury (planet)");
  });
});
