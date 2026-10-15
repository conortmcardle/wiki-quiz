/** What the user asked for, before we've talked to Wikipedia. */
export interface ArticleRef {
  /** Wikipedia language subdomain, e.g. "en", "fr", "zh-yue", "simple". */
  lang: string;
  /** Title as typed / decoded from the URL (spaces, not underscores). */
  title: string;
  /** Section anchor from the URL, if any (informational only). */
  fragment?: string;
}

export interface ArticleSection {
  /** Stable id within the article: "s0" is the lead, then "s1", "s2", ... */
  id: string;
  /** Heading text ("Introduction" for the lead). */
  title: string;
  /** HTML id of the heading on Wikipedia, used for #links. "" for the lead. */
  anchor: string;
  /** 1 for the lead, 2–6 for h2–h6. */
  level: number;
  /** Heading trail, e.g. ["History", "Middle Ages"]. Empty for the lead. */
  path: string[];
  /** Plain text: paragraphs/list items separated by blank lines. */
  text: string;
  wordCount: number;
}

export interface Article {
  lang: string;
  title: string;
  /** Display title with markup stripped (may differ in case/italics). */
  displayTitle: string;
  pageId: number;
  revId: number;
  /** Canonical article URL, e.g. https://fr.wikipedia.org/wiki/Lyon */
  url: string;
  /** Set when the requested title was a redirect. */
  redirectedFrom?: string;
  sections: ArticleSection[];
  wordCount: number;
}
