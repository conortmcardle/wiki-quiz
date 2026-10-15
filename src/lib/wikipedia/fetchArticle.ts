import { AppError, isAbortError } from "../errors";
import { articleUrl } from "./parseInput";
import { extractDisambiguationOptions, htmlToText, parseArticleHtml } from "./parseArticle";
import type { Article, ArticleRef } from "./types";

/** Articles shorter than this can't support a meaningful quiz. */
export const MIN_ARTICLE_WORDS = 120;

export interface FetchOptions {
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
}

type ApiParams = Record<string, string | number>;

interface QueryPage {
  pageid?: number;
  ns?: number;
  title: string;
  missing?: boolean;
  invalid?: boolean;
  invalidreason?: string;
  special?: boolean;
  fullurl?: string;
  canonicalurl?: string;
  lastrevid?: number;
  pageprops?: Record<string, string>;
}

interface QueryResponse {
  query?: {
    pages?: QueryPage[];
    redirects?: { from: string; to: string; tofragment?: string }[];
    normalized?: { from: string; to: string }[];
  };
}

interface ParseResponse {
  parse?: {
    title: string;
    pageid: number;
    revid?: number;
    text: string | { "*": string };
    displaytitle?: string;
  };
}

export function languageName(lang: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

async function callApi<T>(lang: string, params: ApiParams, opts: FetchOptions): Promise<T> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  // origin=* enables anonymous CORS. Keep this a "simple" GET with no custom
  // headers so the browser doesn't need a preflight request.
  const all: ApiParams = { ...params, format: "json", formatversion: 2, origin: "*" };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, String(v));

  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await fetchFn(url.toString(), { signal: opts.signal });
  } catch (err) {
    if (isAbortError(err)) throw new AppError("cancelled", "Cancelled.", { cause: err });
    throw new AppError(
      "network",
      `Couldn't reach ${lang}.wikipedia.org. Check your internet connection, and that "${lang}" is a real Wikipedia language.`,
      { cause: err, detail: String(err) },
    );
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new AppError("wiki-api", "Wikipedia is limiting requests right now. Wait a few seconds and try again.");
    }
    throw new AppError("wiki-api", `Wikipedia returned an error (HTTP ${res.status}). Try again in a moment.`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    throw new AppError("wiki-api", "Wikipedia sent back a response we couldn't read. Try again in a moment.", {
      cause: err,
    });
  }

  const error = (data as { error?: { code?: string; info?: string } }).error;
  if (error) {
    const detail = `${error.code ?? "unknown"}: ${error.info ?? ""}`;
    switch (error.code) {
      case "missingtitle":
      case "nosuchpageid":
        throw new AppError("not-found", "That article doesn't exist on Wikipedia.", { detail });
      case "invalidtitle":
        throw new AppError("invalid-input", "That isn't a valid Wikipedia title.", { detail });
      default:
        throw new AppError("wiki-api", "Wikipedia couldn't process that request.", { detail });
    }
  }
  return data as T;
}

/**
 * Resolve a title (following redirects), reject non-articles and
 * disambiguation pages, then fetch and parse the article into sections.
 */
export async function fetchArticle(ref: ArticleRef, opts: FetchOptions = {}): Promise<Article> {
  const { lang } = ref;

  const q = await callApi<QueryResponse>(
    lang,
    {
      action: "query",
      titles: ref.title,
      redirects: 1,
      prop: "info|pageprops",
      inprop: "url",
      ppprop: "disambiguation",
    },
    opts,
  );

  const page = q.query?.pages?.[0];
  if (!page) {
    throw new AppError("wiki-api", "Wikipedia sent back an unexpected response.", {
      detail: JSON.stringify(q).slice(0, 500),
    });
  }
  if (page.invalid) {
    throw new AppError("invalid-input", `"${ref.title}" isn't a valid Wikipedia title.`, {
      detail: page.invalidreason,
    });
  }
  if (page.missing || page.pageid === undefined) {
    throw new AppError(
      "not-found",
      `There's no ${languageName(lang)} Wikipedia article called "${page.title}". Check the spelling, or search Wikipedia and paste the article's link.`,
    );
  }
  if (page.ns !== 0) {
    throw new AppError(
      "not-article",
      `"${page.title}" isn't an encyclopedia article (it's a talk, category, user or other special page). Paste a link to a regular article.`,
    );
  }

  const redirect = q.query?.redirects?.[0];

  if (page.pageprops && "disambiguation" in page.pageprops) {
    const options = await fetchDisambiguationOptions(lang, page.pageid, opts);
    throw new AppError(
      "disambiguation",
      `"${page.title}" is a disambiguation page: it lists several different topics with similar names. Pick the one you meant.`,
      { options },
    );
  }

  const p = await callApi<ParseResponse>(
    lang,
    {
      action: "parse",
      pageid: page.pageid,
      prop: "text|revid|displaytitle",
      disableeditsection: 1,
      disablelimitreport: 1,
    },
    opts,
  );
  if (!p.parse) {
    throw new AppError("wiki-api", "Wikipedia sent back an unexpected response.");
  }

  const html = typeof p.parse.text === "string" ? p.parse.text : p.parse.text["*"];
  const sections = parseArticleHtml(html);
  const wordCount = sections.reduce((n, s) => n + s.wordCount, 0);

  if (wordCount < MIN_ARTICLE_WORDS) {
    throw new AppError(
      "empty-article",
      `"${page.title}" is too short to make a quiz from (about ${wordCount} words of text). Try a longer article.`,
    );
  }

  return {
    lang,
    title: page.title,
    displayTitle: p.parse.displaytitle ? htmlToText(p.parse.displaytitle) || page.title : page.title,
    pageId: page.pageid,
    revId: p.parse.revid ?? page.lastrevid ?? 0,
    url: page.canonicalurl ?? page.fullurl ?? articleUrl(lang, page.title),
    ...(redirect ? { redirectedFrom: redirect.from } : {}),
    sections,
    wordCount,
  };
}

async function fetchDisambiguationOptions(lang: string, pageId: number, opts: FetchOptions) {
  try {
    const p = await callApi<ParseResponse>(lang, { action: "parse", pageid: pageId, prop: "text" }, opts);
    if (!p.parse) return [];
    const html = typeof p.parse.text === "string" ? p.parse.text : p.parse.text["*"];
    return extractDisambiguationOptions(html);
  } catch (err) {
    if (err instanceof AppError && err.kind === "cancelled") throw err;
    return []; // still report the disambiguation, just without suggestions
  }
}

/** Link to a section on Wikipedia (the lead links to the article itself). */
export function sectionUrl(article: Pick<Article, "url">, anchor: string): string {
  if (!anchor) return article.url;
  return `${article.url}#${encodeURIComponent(anchor.replace(/ /g, "_"))}`;
}
