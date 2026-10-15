import { AppError } from "../errors";
import type { ArticleRef } from "./types";

/**
 * Wikipedia language subdomains: "en", "fr", "zh-yue", "be-tarask",
 * "zh-classical", "simple", ...
 */
const LANG_RE = /^(?:[a-z]{2,3}(?:-[a-z0-9]{2,12})*|simple)$/;

/** Subdomains of wikipedia.org that are not language editions. */
const NON_LANG_HOSTS = new Set(["www", "meta", "m", "test", "test2", "donate"]);

/** Characters MediaWiki never allows in a page title. */
const ILLEGAL_TITLE_CHARS = /[<>[\]{}|]/;

const MAX_TITLE_BYTES = 255;

export function isValidLang(lang: string): boolean {
  return LANG_RE.test(lang) && !NON_LANG_HOSTS.has(lang);
}

/**
 * Turn whatever the user pasted — a Wikipedia URL (desktop, mobile,
 * index.php?title=, any language) or a bare article title — into a
 * {lang, title} pair. Throws AppError("invalid-input") with a friendly
 * message when that isn't possible.
 */
export function parseArticleInput(raw: string, defaultLang = "en"): ArticleRef {
  const input = raw.trim();
  if (!input) {
    throw new AppError("invalid-input", "Paste a Wikipedia link or type an article title.");
  }

  if (looksLikeUrl(input)) {
    return parseUrl(input);
  }

  const lang = defaultLang.trim().toLowerCase();
  if (!isValidLang(lang)) {
    throw new AppError(
      "invalid-input",
      `"${defaultLang}" isn't a Wikipedia language code. Try something like "en", "fr" or "de".`,
    );
  }
  const [titlePart, fragment] = splitFragment(input);
  return { lang, title: cleanTitle(titlePart), ...(fragment ? { fragment } : {}) };
}

function looksLikeUrl(input: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return true;
  // Scheme-less "en.wikipedia.org/wiki/Lyon", or any "domain.tld/..." (so we can
  // say "that isn't Wikipedia"). Titles like "Node.js" or "Amazon.com" have no
  // slash after the domain and stay titles.
  return (
    /^([a-z0-9-]+\.)+wikipedia\.org(\/|$)/i.test(input) ||
    /^([a-z0-9-]+\.)+[a-z]{2,}\/\S*$/i.test(input)
  );
}

function parseUrl(input: string): ArticleRef {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new AppError("invalid-input", "That link doesn't look like a valid URL.");
  }

  const host = url.hostname.toLowerCase();
  const hostMatch = /^([a-z0-9-]+)\.(?:m\.)?wikipedia\.org$/.exec(host);
  if (!hostMatch) {
    throw new AppError(
      "invalid-input",
      "That isn't a Wikipedia link. Paste a URL like https://en.wikipedia.org/wiki/Lyon, or just type a title.",
    );
  }
  const lang = hostMatch[1]!;
  if (!isValidLang(lang)) {
    throw new AppError(
      "invalid-input",
      `${host} isn't a language edition of Wikipedia. Use a link like https://en.wikipedia.org/wiki/…`,
    );
  }

  const title = titleFromPath(url, lang);
  if (!title) {
    throw new AppError(
      "invalid-input",
      "Couldn't find an article title in that link. It should look like https://en.wikipedia.org/wiki/Article_name.",
    );
  }

  const fragment = url.hash ? safeDecode(url.hash.slice(1)).replace(/_/g, " ") : undefined;
  return { lang, title: cleanTitle(title), ...(fragment ? { fragment } : {}) };
}

function titleFromPath(url: URL, lang: string): string | null {
  const path = url.pathname;

  // /wiki/Title — titles can themselves contain slashes ("AC/DC").
  if (path.startsWith("/wiki/")) {
    return safeDecode(path.slice("/wiki/".length)) || null;
  }

  // /w/index.php?title=Title&oldid=...
  if (path === "/w/index.php" || path === "/w/index.php/") {
    return url.searchParams.get("title");
  }

  // Language-variant paths: /zh-hans/Title, /sr-el/Title, ...
  const variant = /^\/([a-z]{2,3}(?:-[a-z0-9]+)+)\/(.+)$/.exec(path);
  if (variant && variant[1]!.startsWith(`${lang}-`)) {
    return safeDecode(variant[2]!);
  }

  return null;
}

function splitFragment(input: string): [string, string | undefined] {
  const i = input.indexOf("#");
  if (i === -1) return [input, undefined];
  const fragment = input.slice(i + 1).trim();
  return [input.slice(0, i), fragment || undefined];
}

function cleanTitle(title: string): string {
  const cleaned = title.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    throw new AppError("invalid-input", "Paste a Wikipedia link or type an article title.");
  }
  if (ILLEGAL_TITLE_CHARS.test(cleaned)) {
    throw new AppError(
      "invalid-input",
      "Wikipedia titles can't contain < > [ ] { } or |. Check the title and try again.",
    );
  }
  if (new TextEncoder().encode(cleaned).length > MAX_TITLE_BYTES) {
    throw new AppError("invalid-input", "That title is too long to be a Wikipedia article.");
  }
  return cleaned;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Canonical URL for an article title. */
export function articleUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeTitle(title)}`;
}

/** MediaWiki-style title encoding: spaces become underscores, keep "/" and ":" readable. */
export function encodeTitle(title: string): string {
  return encodeURIComponent(title.replace(/ /g, "_"))
    .replace(/%2F/g, "/")
    .replace(/%3A/g, ":")
    .replace(/%2C/g, ",");
}
