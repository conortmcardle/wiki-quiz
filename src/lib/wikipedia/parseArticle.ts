import type { DisambiguationOption } from "../errors";
import type { ArticleSection } from "./types";

export const LEAD_TITLE = "Introduction";

/** Elements that never contain article prose. Removed before walking. */
const NOISE_SELECTORS = [
  "style",
  "script",
  "link",
  "meta",
  "noscript",
  "annotation", // TeX source inside MathML (would duplicate the formula)
  ".mw-editsection",
  "sup.reference",
  ".reference",
  ".mw-ref",
  ".noprint",
  ".navbox",
  ".navbox-styles",
  ".vertical-navbox",
  ".sidebar",
  ".hatnote",
  ".dablink",
  ".rellink",
  ".metadata",
  ".ambox",
  ".ombox",
  ".tmbox",
  ".mbox-small",
  ".shortdescription",
  ".mw-empty-elt",
  "#toc",
  ".toc",
  ".mw-references-wrap",
  "ol.references",
  ".reflist",
  ".refbegin",
  ".catlinks",
  ".sistersitebox",
  ".side-box",
  ".portalbox",
  ".portal",
  ".authority-control",
  ".mw-authority-control",
  ".mw-cite-backlink",
  "figure",
  ".thumb",
  ".gallery",
  ".mw-gallery-traditional",
  ".mw-gallery-packed",
  "#coordinates",
  ".printfooter",
  ".mw-indicators",
  "img",
].join(",");

/**
 * Section headings that hold references/navigation rather than content, in
 * the most common Wikipedia languages. Compared after normalizeHeading().
 * Sub-sections of a dropped section are dropped too.
 */
const NON_CONTENT_HEADINGS = new Set(
  [
    // en
    "references", "notes", "footnotes", "citations", "sources", "bibliography",
    "further reading", "external links", "see also", "notes and references",
    "references and notes", "works cited", "general references", "explanatory notes",
    "reference notes", "cited sources", "notes and citations", "citations and notes",
    "general and cited references", "external links and further reading",
    // fr
    "notes et références", "références", "bibliographie", "liens externes",
    "voir aussi", "articles connexes", "annexes", "sources et bibliographie",
    // de
    "einzelnachweise", "literatur", "weblinks", "siehe auch", "anmerkungen",
    "quellen", "belege",
    // es
    "referencias", "bibliografía", "enlaces externos", "véase también", "notas",
    "notas y referencias", "fuentes",
    // it
    "note", "bibliografia", "collegamenti esterni", "voci correlate", "altri progetti",
    // pt
    "referências", "ligações externas", "ver também", "notas e referências", "fontes",
    // nl
    "referenties", "externe links", "zie ook", "bronnen", "noten",
    // pl
    "przypisy", "linki zewnętrzne", "zobacz też",
    // sv
    "referenser", "externa länkar", "se även", "noter", "källor",
    // ru
    "примечания", "литература", "ссылки", "см также",
    // ja
    "脚注", "参考文献", "関連項目", "外部リンク", "出典",
    // zh
    "外部链接", "外部連結", "参见", "參見", "注释", "註釋", "參考文獻", "参考资料", "參考資料",
  ].map(normalizeHeading),
);

function normalizeHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.:·]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNonContentHeading(title: string): boolean {
  return NON_CONTENT_HEADINGS.has(normalizeHeading(title));
}

const MAX_TABLE_ROWS = 25;
const MAX_INFOBOX_ROWS = 40;

interface SectionDraft {
  title: string;
  anchor: string;
  level: number;
  path: string[];
  blocks: string[];
}

function parseHtml(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector<HTMLElement>(".mw-parser-output") ?? doc.body;
  root.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());
  return root;
}

/**
 * Convert the HTML from MediaWiki's action=parse into a flat list of
 * sections (lead first). Handles the three heading layouts Wikipedia has
 * served: <div class="mw-heading"><h2 id>, legacy <h2><span class="mw-headline" id>,
 * and Parsoid <section><h2 id>.
 */
export function parseArticleHtml(html: string): ArticleSection[] {
  const root = parseHtml(html);

  const drafts: SectionDraft[] = [
    { title: LEAD_TITLE, anchor: "", level: 1, path: [], blocks: [] },
  ];
  const headingStack: { level: number; title: string }[] = [];
  let skipBelowLevel: number | null = null; // inside a dropped section

  const current = () => drafts[drafts.length - 1]!;
  const addBlock = (text: string) => {
    if (skipBelowLevel !== null) return;
    const t = cleanText(text);
    if (t) current().blocks.push(t);
  };

  const startSection = (heading: HTMLElement) => {
    const level = Number(heading.tagName.slice(1));
    const title = cleanText(textOf(heading));
    const anchor =
      heading.id ||
      heading.querySelector<HTMLElement>(".mw-headline[id]")?.id ||
      title.replace(/ /g, "_");

    while (headingStack.length && headingStack[headingStack.length - 1]!.level >= level) {
      headingStack.pop();
    }
    headingStack.push({ level, title });

    if (skipBelowLevel !== null && level > skipBelowLevel) return; // still inside dropped section
    skipBelowLevel = isNonContentHeading(title) ? level : null;
    if (skipBelowLevel !== null) return;

    drafts.push({ title, anchor, level, path: headingStack.map((h) => h.title), blocks: [] });
  };

  const walk = (container: Element) => {
    for (const el of Array.from(container.children) as HTMLElement[]) {
      const tag = el.tagName;

      if (/^H[2-6]$/.test(tag)) {
        startSection(el);
        continue;
      }
      if (tag === "DIV" && el.classList.contains("mw-heading")) {
        const h = el.querySelector<HTMLElement>("h2,h3,h4,h5,h6");
        if (h) startSection(h);
        continue;
      }
      if (isInfobox(el)) {
        const lines = infoboxLines(el);
        if (lines.length) addBlock(`Key facts:\n${lines.join("\n")}`);
        continue;
      }

      switch (tag) {
        case "P":
        case "BLOCKQUOTE":
        case "PRE":
          addBlock(textOf(el));
          break;
        case "UL":
        case "OL": {
          const items = Array.from(el.children)
            .filter((c) => c.tagName === "LI")
            .map((li) => cleanText(textOf(li)))
            .filter(Boolean);
          if (items.length) addBlock(items.map((i) => `- ${i}`).join("\n"));
          break;
        }
        case "DL": {
          const items = Array.from(el.children)
            .map((c) => cleanText(textOf(c)))
            .filter(Boolean);
          if (items.length) addBlock(items.join("\n"));
          break;
        }
        case "TABLE":
          if (el.classList.contains("wikitable")) {
            const rows = tableLines(el);
            if (rows.length) addBlock(rows.join("\n"));
          }
          break;
        case "DIV":
        case "SECTION":
        case "ARTICLE":
        case "MAIN":
        case "CENTER":
          walk(el);
          break;
        default:
          break;
      }
    }
  };

  walk(root);

  return drafts
    .map((d) => ({ ...d, text: d.blocks.join("\n\n") }))
    .filter((d) => d.text.length > 0)
    .map((d, i) => ({
      id: `s${i}`,
      title: d.title,
      anchor: d.anchor,
      level: d.level,
      path: d.path,
      text: d.text,
      wordCount: countWords(d.text),
    }));
}

function isInfobox(el: Element): boolean {
  return Array.from(el.classList).some((c) => /^infobox(_v\d+)?$/.test(c));
}

function infoboxLines(el: Element): string[] {
  const lines: string[] = [];
  for (const tr of Array.from(el.querySelectorAll("tr"))) {
    if (lines.length >= MAX_INFOBOX_ROWS) break;
    const th = tr.querySelector(":scope > th");
    const td = tr.querySelector(":scope > td");
    const label = th ? cleanText(textOf(th)) : "";
    const value = td ? cleanText(textOf(td)) : "";
    if (label && value) lines.push(`${label}: ${value}`);
    else if (value && tr.children.length === 1) lines.push(value);
  }
  return lines;
}

function tableLines(table: Element): string[] {
  const caption = table.querySelector("caption");
  const lines: string[] = caption ? [cleanText(textOf(caption))] : [];
  const rows = Array.from(table.querySelectorAll("tr")).slice(0, MAX_TABLE_ROWS);
  for (const tr of rows) {
    const cells = Array.from(tr.children)
      .filter((c) => c.tagName === "TD" || c.tagName === "TH")
      .map((c) => cleanText(textOf(c)));
    if (cells.some(Boolean)) lines.push(cells.join(" | "));
  }
  return lines.filter(Boolean);
}

/** textContent, but with <br> and block boundaries turned into spaces. */
function textOf(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
  clone.querySelectorAll("li, p, div, td, th, dd, dt").forEach((b) => b.append(" "));
  return clone.textContent ?? "";
}

function cleanText(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])(?=\s|$)/g, "$1")
    .replace(/\(\s*[;,]?\s*\)/g, "") // "( )" left behind after removing pronunciations/refs
    .replace(/\s{2,}/g, " ")
    .trim();
}

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

export function countWords(text: string): number {
  const cjk = text.match(CJK_CHAR)?.length ?? 0;
  const words = text.replace(CJK_CHAR, " ").match(/\S+/g)?.length ?? 0;
  return words + Math.round(cjk / 2);
}

/** Plain text of an HTML fragment (used for displaytitle). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return cleanText(doc.body.textContent ?? "");
}

const NAMESPACE_PREFIXES = new Set(
  [
    "special", "help", "file", "image", "category", "wikipedia", "template", "portal",
    "talk", "user", "wiktionary", "wikt", "draft", "module", "mediawiki",
    "spécial", "aide", "fichier", "catégorie", "modèle", "utilisateur", "discussion",
    "spezial", "hilfe", "datei", "kategorie", "vorlage", "benutzer",
    "especial", "ayuda", "archivo", "categoría", "plantilla", "usuario",
    "speciale", "aiuto", "categoria",
  ].map((s) => s.toLowerCase()),
);

/**
 * Pull the candidate articles out of a disambiguation page: the first
 * internal link of each list item, with the item text as a description.
 */
export function extractDisambiguationOptions(html: string, max = 50): DisambiguationOption[] {
  const root = parseHtml(html);
  const seen = new Set<string>();
  const options: DisambiguationOption[] = [];

  for (const li of Array.from(root.querySelectorAll("li"))) {
    if (options.length >= max) break;
    const link = Array.from(li.querySelectorAll<HTMLAnchorElement>("a[href]")).find(
      (a) => !a.classList.contains("new") && !a.classList.contains("external") && !a.classList.contains("extiw"),
    );
    if (!link) continue;
    const title = titleFromHref(link.getAttribute("href") ?? "");
    if (!title || seen.has(title)) continue;
    const prefix = title.includes(":") ? title.slice(0, title.indexOf(":")).toLowerCase() : "";
    if (prefix && NAMESPACE_PREFIXES.has(prefix)) continue;
    seen.add(title);

    let description = cleanText(textOf(li));
    // "Mercury (planet), the planet closest to the Sun" → "the planet closest to the Sun"
    const linkText = cleanText(textOf(link));
    if (linkText && description.startsWith(linkText)) {
      description = description.slice(linkText.length).replace(/^[\s,;:–—-]+/, "");
    }
    if (description.length > 180) description = `${description.slice(0, 177)}…`;
    options.push({ title, description });
  }
  return options;
}

function titleFromHref(href: string): string | null {
  // Legacy parser: /wiki/Title ; Parsoid: ./Title
  const m = /^(?:\/wiki\/|\.\/)([^?#]+)/.exec(href);
  if (!m) return null;
  let t = m[1]!;
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep raw */
  }
  return t.replace(/_/g, " ").trim() || null;
}
