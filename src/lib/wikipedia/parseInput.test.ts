import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { articleUrl, parseArticleInput } from "./parseInput";

function expectInvalid(input: string, lang?: string) {
  try {
    parseArticleInput(input, lang);
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).kind).toBe("invalid-input");
    return (err as AppError).message;
  }
  throw new Error(`expected "${input}" to be rejected`);
}

describe("parseArticleInput: URLs", () => {
  it.each([
    ["https://en.wikipedia.org/wiki/Lyon", "en", "Lyon"],
    ["http://en.wikipedia.org/wiki/Marie_Curie", "en", "Marie Curie"],
    ["https://fr.m.wikipedia.org/wiki/Lyon", "fr", "Lyon"],
    ["en.wikipedia.org/wiki/Ada_Lovelace", "en", "Ada Lovelace"],
    ["https://fr.wikipedia.org/wiki/%C3%89mile_Zola", "fr", "Émile Zola"],
    ["https://de.wikipedia.org/wiki/K%C3%B6ln?useskin=vector", "de", "Köln"],
    ["https://en.wikipedia.org/wiki/AC/DC", "en", "AC/DC"],
    ["https://en.wikipedia.org/w/index.php?title=Lyon&oldid=12345", "en", "Lyon"],
    ["https://zh.wikipedia.org/zh-hans/%E9%87%8C%E6%98%82", "zh", "里昂"],
    ["https://simple.wikipedia.org/wiki/Moon", "simple", "Moon"],
    ["https://zh-yue.wikipedia.org/wiki/香港", "zh-yue", "香港"],
    ["  https://en.wikipedia.org/wiki/Lyon  ", "en", "Lyon"],
  ])("%s → %s:%s", (input, lang, title) => {
    expect(parseArticleInput(input)).toMatchObject({ lang, title });
  });

  it("keeps the section fragment separately", () => {
    expect(parseArticleInput("https://en.wikipedia.org/wiki/Lyon#Ancient_Lyon")).toEqual({
      lang: "en",
      title: "Lyon",
      fragment: "Ancient Lyon",
    });
  });

  it("uses the URL's language even when a different default is set", () => {
    expect(parseArticleInput("https://ja.wikipedia.org/wiki/東京", "fr").lang).toBe("ja");
  });

  it.each([
    "https://example.com/wiki/Lyon",
    "https://www.wikipedia.org/",
    "https://en.wikipedia.org/",
    "https://en.wikipedia.org/w/index.php?search=lyon",
    "https://en.wikipedia.org.evil.com/wiki/Lyon",
    "google.com/search?q=lyon",
  ])("rejects %s", (input) => {
    expectInvalid(input);
  });
});

describe("parseArticleInput: plain titles", () => {
  it("uses the default language", () => {
    expect(parseArticleInput("Marie Curie")).toEqual({ lang: "en", title: "Marie Curie" });
    expect(parseArticleInput("Lyon", "fr")).toEqual({ lang: "fr", title: "Lyon" });
  });

  it("normalizes underscores and whitespace", () => {
    expect(parseArticleInput("  Marie_Curie   ").title).toBe("Marie Curie");
    expect(parseArticleInput("New   York  City").title).toBe("New York City");
  });

  it("treats dotted names without a path as titles, not URLs", () => {
    expect(parseArticleInput("Node.js").title).toBe("Node.js");
    expect(parseArticleInput("Amazon.com").title).toBe("Amazon.com");
    expect(parseArticleInput("St. Louis").title).toBe("St. Louis");
  });

  it("splits a #section off a typed title", () => {
    expect(parseArticleInput("Lyon#History")).toEqual({ lang: "en", title: "Lyon", fragment: "History" });
  });

  it("rejects empty input, illegal characters and bad language codes", () => {
    expect(expectInvalid("   ")).toMatch(/paste a wikipedia link/i);
    expect(expectInvalid("Foo [bar]")).toMatch(/can't contain/);
    expect(expectInvalid("Lyon", "French")).toMatch(/language code/);
    expectInvalid("x".repeat(300));
  });
});

describe("articleUrl", () => {
  it("encodes titles the way Wikipedia does", () => {
    expect(articleUrl("en", "Marie Curie")).toBe("https://en.wikipedia.org/wiki/Marie_Curie");
    expect(articleUrl("en", "AC/DC")).toBe("https://en.wikipedia.org/wiki/AC/DC");
    expect(articleUrl("fr", "Émile Zola")).toBe("https://fr.wikipedia.org/wiki/%C3%89mile_Zola");
  });
});
