import { describe, expect, it } from "vitest";
import disambigHtml from "../../test/fixtures/disambig.html?raw";
import modernHtml from "../../test/fixtures/modern.html?raw";
import { AppError } from "../errors";
import { fetchArticle, sectionUrl } from "./fetchArticle";

type Handler = (params: URLSearchParams) => unknown;

/** A fake fetch that answers MediaWiki API calls by `action`. */
function fakeWiki(handlers: { query?: Handler; parse?: Handler }) {
  const calls: URL[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const action = url.searchParams.get("action") as "query" | "parse";
    const body = handlers[action]?.(url.searchParams);
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const lyonPage = {
  pageid: 8638634,
  ns: 0,
  title: "Lyon",
  lastrevid: 999,
  fullurl: "https://en.wikipedia.org/wiki/Lyon",
  canonicalurl: "https://en.wikipedia.org/wiki/Lyon",
};

async function expectAppError(p: Promise<unknown>, kind: AppError["kind"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).kind).toBe(kind);
  return err as AppError;
}

describe("fetchArticle", () => {
  it("resolves redirects, then parses the article into sections", async () => {
    const { fetchFn, calls } = fakeWiki({
      query: () => ({
        query: { redirects: [{ from: "Lyons", to: "Lyon" }], pages: [lyonPage] },
      }),
      parse: () => ({ parse: { title: "Lyon", pageid: 8638634, revid: 1234, text: modernHtml, displaytitle: "<span>Lyon</span>" } }),
    });

    const article = await fetchArticle({ lang: "en", title: "Lyons" }, { fetchFn });

    expect(article).toMatchObject({
      lang: "en",
      title: "Lyon",
      displayTitle: "Lyon",
      pageId: 8638634,
      revId: 1234,
      url: "https://en.wikipedia.org/wiki/Lyon",
      redirectedFrom: "Lyons",
    });
    expect(article.sections.length).toBeGreaterThan(3);
    expect(article.wordCount).toBe(article.sections.reduce((n, s) => n + s.wordCount, 0));

    // Request shape: right host, CORS-enabled, redirects followed, JSON v2.
    expect(calls).toHaveLength(2);
    const [q, p] = calls as [URL, URL];
    expect(q.host).toBe("en.wikipedia.org");
    expect(q.pathname).toBe("/w/api.php");
    expect(q.searchParams.get("origin")).toBe("*");
    expect(q.searchParams.get("redirects")).toBe("1");
    expect(q.searchParams.get("formatversion")).toBe("2");
    expect(q.searchParams.get("titles")).toBe("Lyons");
    expect(p.searchParams.get("action")).toBe("parse");
    expect(p.searchParams.get("pageid")).toBe("8638634");
    expect(p.searchParams.get("origin")).toBe("*");
  });

  it("uses the language subdomain", async () => {
    const { fetchFn, calls } = fakeWiki({
      query: () => ({ query: { pages: [{ ...lyonPage, canonicalurl: "https://fr.wikipedia.org/wiki/Lyon" }] } }),
      parse: () => ({ parse: { title: "Lyon", pageid: 1, revid: 1, text: modernHtml } }),
    });
    const article = await fetchArticle({ lang: "fr", title: "Lyon" }, { fetchFn });
    expect(calls[0]!.host).toBe("fr.wikipedia.org");
    expect(article.url).toBe("https://fr.wikipedia.org/wiki/Lyon");
  });

  it("reports missing articles", async () => {
    const { fetchFn } = fakeWiki({ query: () => ({ query: { pages: [{ ns: 0, title: "Asdfgh", missing: true }] } }) });
    const err = await expectAppError(fetchArticle({ lang: "en", title: "asdfgh" }, { fetchFn }), "not-found");
    expect(err.message).toContain("English Wikipedia");
    expect(err.message).toContain('"Asdfgh"');
  });

  it("rejects non-article namespaces", async () => {
    const { fetchFn } = fakeWiki({ query: () => ({ query: { pages: [{ pageid: 5, ns: 1, title: "Talk:Lyon" }] } }) });
    await expectAppError(fetchArticle({ lang: "en", title: "Talk:Lyon" }, { fetchFn }), "not-article");
  });

  it("rejects invalid titles", async () => {
    const { fetchFn } = fakeWiki({
      query: () => ({ query: { pages: [{ title: "x", invalid: true, invalidreason: "bad" }] } }),
    });
    await expectAppError(fetchArticle({ lang: "en", title: "x" }, { fetchFn }), "invalid-input");
  });

  it("detects disambiguation pages and offers the candidates", async () => {
    const { fetchFn } = fakeWiki({
      query: () => ({ query: { pages: [{ pageid: 7, ns: 0, title: "Mercury", pageprops: { disambiguation: "" } }] } }),
      parse: () => ({ parse: { title: "Mercury", pageid: 7, text: disambigHtml } }),
    });
    const err = await expectAppError(fetchArticle({ lang: "en", title: "Mercury" }, { fetchFn }), "disambiguation");
    expect(err.options?.map((o) => o.title)).toContain("Mercury (planet)");
  });

  it("still reports a disambiguation page if fetching its candidates fails", async () => {
    const { fetchFn } = fakeWiki({
      query: () => ({ query: { pages: [{ pageid: 7, ns: 0, title: "Mercury", pageprops: { disambiguation: "" } }] } }),
      parse: () => new Response("oops", { status: 500 }),
    });
    const err = await expectAppError(fetchArticle({ lang: "en", title: "Mercury" }, { fetchFn }), "disambiguation");
    expect(err.options).toEqual([]);
  });

  it("refuses stubs that are too short to quiz on", async () => {
    const { fetchFn } = fakeWiki({
      query: () => ({ query: { pages: [lyonPage] } }),
      parse: () => ({ parse: { title: "Lyon", pageid: 1, revid: 1, text: "<p>Tiny stub.</p>" } }),
    });
    await expectAppError(fetchArticle({ lang: "en", title: "Lyon" }, { fetchFn }), "empty-article");
  });

  it("maps network failures, HTTP errors and API errors", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expectAppError(fetchArticle({ lang: "en", title: "Lyon" }, { fetchFn: offline }), "network");

    const http500 = fakeWiki({ query: () => new Response("", { status: 503 }) });
    await expectAppError(fetchArticle({ lang: "en", title: "Lyon" }, { fetchFn: http500.fetchFn }), "wiki-api");

    const notJson = fakeWiki({ query: () => new Response("<html>", { status: 200 }) });
    await expectAppError(fetchArticle({ lang: "en", title: "Lyon" }, { fetchFn: notJson.fetchFn }), "wiki-api");

    const apiError = fakeWiki({ query: () => ({ error: { code: "missingtitle", info: "The page you specified doesn't exist." } }) });
    await expectAppError(fetchArticle({ lang: "en", title: "Lyon" }, { fetchFn: apiError.fetchFn }), "not-found");
  });

  it("reports cancellation separately from network errors", async () => {
    const aborting = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    await expectAppError(fetchArticle({ lang: "en", title: "Lyon" }, { fetchFn: aborting }), "cancelled");
  });
});

describe("sectionUrl", () => {
  const article = { url: "https://en.wikipedia.org/wiki/Lyon" };
  it("links the lead to the article and sections to their anchors", () => {
    expect(sectionUrl(article, "")).toBe("https://en.wikipedia.org/wiki/Lyon");
    expect(sectionUrl(article, "Ancient_Lyon")).toBe("https://en.wikipedia.org/wiki/Lyon#Ancient_Lyon");
    expect(sectionUrl(article, "Économie_et_culture")).toBe(
      "https://en.wikipedia.org/wiki/Lyon#%C3%89conomie_et_culture",
    );
  });
});
