# Wiki Quiz

Turn any Wikipedia article into a playable trivia quiz, then see which parts of the topic you're weakest in.

Paste a Wikipedia link (any language) or type a title. Claude reads the article, splits it into topic
categories that fit *that* article, and writes questions you can only answer from the article text. Play
them one at a time with instant feedback, then get a breakdown of your strengths and weaknesses, with links
straight to the sections worth rereading.

It's a static site: no backend, no accounts. You bring your own Anthropic API key, which stays in your
browser.

## Features

- **Any Wikipedia article, any language.** Accepts `https://fr.wikipedia.org/wiki/Lyon`, mobile links,
  `index.php?title=` links or plain titles. It follows redirects, and if a title is a disambiguation page
  it lets you pick the topic you meant.
- **Article-specific categories.** Claude defines 4–8 categories for each article (a city might get
  Geography, History, Economy, Culture; a scientist might get Early Life, Research, Awards, Legacy). Every
  question is tagged with one. Categories are saved per article, so repeat attempts are comparable.
- **Four question types:** multiple choice, short answer, true/false and fill-in-the-blank. You pick the
  types, the number of questions (default 15) and the difficulty (easy/medium/hard/mixed).
- **Grounded questions.** Every question carries a supporting quote and the section it came from. The app
  checks that the quote really appears in the article and drops questions where it doesn't. It also
  checks that multiple-choice questions have exactly one correct option and plausible distractors, and
  removes duplicates.
- **Long articles are covered evenly.** Big articles are split by section and category, so questions come
  from the whole article rather than just the introduction.
- **Lenient grading** for typed answers:
  - Case, accents, punctuation and leading articles don't matter, and listed alternative answers are
    accepted.
  - Small typos are forgiven, scaled to answer length. Short answers must be exact, so "Iran" ≠ "Iraq".
  - Numbers can be digits or words ("forty-three" = 43, "nineteen eighty-four" = 1984), but a wrong digit
    is always wrong.
- **Results that tell you what to study:**
  - Score and percentage.
  - Bar charts by topic and by question type.
  - A **Brush up on** panel naming your weakest topics, with links to the exact Wikipedia sections.
  - Every missed question with its correct answer.
- **Practice loops:** retry just the missed questions, generate a new quiz weighted toward your weak
  topics, or start a fresh quiz on the same article (it avoids questions you've already seen).
- **Progress over time.** Each attempt is saved per article, with an overall score line and a
  topic-by-attempt table, so you can see whether your weak areas are improving.
- Works on phones. Unfinished quizzes survive a page reload. Dark mode follows your system setting.
  Keyboard shortcuts: 1–4/A–D for multiple choice, T/F for true/false, Enter for next.

## Quick start (local)

Requires Node.js 22 or later.

```bash
npm install
npm run dev          # http://localhost:5173/wiki-quiz/
```

Other scripts:

```bash
npm test             # unit tests (Vitest)
npm run typecheck    # TypeScript, no emit
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build locally
```

## Adding your API key

1. Create a key in the [Claude Console](https://console.anthropic.com/settings/keys). A dedicated key with
   a monthly spend limit is a good idea for a browser app.
2. Open the app, click **Settings**, paste the key (it starts with `sk-ant-`) and click **Save**.
3. To remove it, open **Settings** and click **Clear key**.

### Where the key lives

- The key is stored **only in your browser's `localStorage`**, under `wikiquiz.apiKey`. It is never
  committed to this repository, never sent to GitHub Pages, and never sent anywhere except
  `api.anthropic.com` when you generate a quiz.
- Requests go straight from your browser to the Anthropic Messages API using the official TypeScript SDK
  with `dangerouslyAllowBrowser: true`. That option makes the SDK send the
  `anthropic-dangerous-direct-browser-access: true` header, which Anthropic requires for browser-side
  calls.
- Anything that can run JavaScript on this page or read your browser profile (a malicious extension,
  someone using your computer) could read the key. Don't save it on shared computers, and clear it when
  you're done.

### Model and cost

The default model is `claude-sonnet-5-5`. In Settings you can switch to Claude Opus 5.5, Haiku 5.5 or
Fable 5.1, or enter any other model ID.

A quiz makes two or more API calls: one to choose categories (skipped when they're already saved for the
article), plus one or more to write questions. As a rough estimate, a 15-question quiz on a typical
article costs about 5–20 US cents with Sonnet 5.5. Long articles cost more because more text is sent.
See [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing) for current rates.

Settings also has a **refusal fallback** option (on by default). If a model declines a request, the API
re-runs it on Anthropic's recommended fallback model. It uses the `server-side-fallback-2026-07-01` beta.

## How it works

1. **Fetch.** The [MediaWiki Action API](https://www.mediawiki.org/wiki/API:Main_page) is called with
   `origin=*` for CORS:
   - `action=query` resolves the title, follows redirects, and detects missing pages, non-articles and
     disambiguation pages.
   - `action=parse` returns the article HTML.

   The HTML is split into sections (heading text, anchor and plain text). References, navboxes, edit
   links and "See also / References / External links" sections are removed. Infobox facts are kept with
   the introduction.
2. **Categories.** Claude reads the article (section previews for very long ones) and returns 4–8
   categories, each mapped to sections.
3. **Budget.** Questions are shared out across categories: evenly, or weighted toward weak topics for
   practice quizzes. Categories with little text are never asked for more questions than they can
   support.
4. **Write.** Short articles are sent in one call. Long ones are split into calls of up to about 100k
   characters along category lines, so every section is sent in full and gets its share of questions.
   Calls use structured outputs (a JSON schema), stream, and run three at a time.
5. **Validate.** Each response is parsed safely and retried once if it's malformed or cut off. Each
   question is then checked:
   - required fields;
   - quote found in the article;
   - exactly one correct option and plausible distractors for multiple choice;
   - exactly one blank for fill-in-the-blank;
   - the answer isn't given away in the prompt.

   Duplicates are removed. If too many questions fail, one top-up call asks for replacements.
6. **Play and grade** in the browser, then **analyze**: per-category and per-type accuracy, weak areas
   below 70%, and links to the sections behind the missed questions.

## Deployment (GitHub Pages)

The workflow in `.github/workflows/deploy.yml`:

- runs on every push to `main` (and on pull requests, where it only tests and builds);
- installs dependencies, runs the unit tests, type-checks and builds;
- deploys `dist/` to GitHub Pages.

To set it up on your fork or copy:

1. Push the repository to GitHub.
2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main` (or run the workflow manually from the **Actions** tab).

The site is served at `https://<user>.github.io/<repo>/`. The build reads the correct base path from
`actions/configure-pages`, so it works under any repository name, on a `<user>.github.io` repository, or
with a custom domain. For a manual build, set it yourself: `BASE_PATH=/my-path/ npm run build`. The
default is `/wiki-quiz/`.

No secrets are needed: the API key is never part of the build.

## What's stored in your browser

| Key | Contents |
|---|---|
| `wikiquiz.apiKey` | Your Anthropic API key (Settings → Clear key) |
| `wikiquiz.settings.v1`, `wikiquiz.quizPrefs.v1` | Model, fallback, language and last quiz options |
| `wikiquiz.categories.v1.<lang>:<pageId>` | The topic categories for each article |
| `wikiquiz.history.v1.<lang>:<pageId>`, `wikiquiz.history.index.v1` | Your attempts per article |
| `wikiquiz.activeSession.v1` | An unfinished quiz, so a reload can resume it |

**Settings → Delete quiz history** removes everything except your key and settings.

## Project structure

```
src/
  App.tsx                  screens and flow (home → article → generate → play → results)
  components/              UI: settings, setup, question, feedback, results, charts
  lib/
    wikipedia/             URL/title parsing, MediaWiki fetch, HTML → sections
    claude/                SDK client (browser mode), prompts, JSON schemas, error mapping
    quiz/                  category clean-up, budgeting & chunking, validation, generation pipeline
    grading/               lenient answer grading, edit distance, number parsing
    results/               score breakdowns and weak-area analysis
    storage/               settings, API key, categories cache, attempt history
  test/                    HTML fixtures and test helpers
.github/workflows/         test + deploy to GitHub Pages
```

## Tests

`npm test` runs Vitest in a jsdom environment:

- **Answer grading:** normalization, aliases, typo tolerance by length, digits vs words, units and eras.
- **Question validation:** schema coercion, multiple-choice rules, true/false and blank checks, quote
  grounding, duplicate removal, balanced selection.
- **Claude client:** the request shape (browser header, structured output, fallback beta), the retry on
  malformed or truncated JSON, refusal handling and HTTP error mapping. This uses a fake streaming API.
- **Generation pipeline:** categories, chunking long articles, top-ups and failure modes.
- **Wikipedia parsing:** three generations of MediaWiki heading markup, disambiguation, redirects and
  error mapping. This uses saved HTML fixtures.
- Results analysis and attempt history.

## Limitations

- Questions are written by an AI model. The quote check catches most invented facts, but double-check
  anything important against the article.
- Number words are understood in English, plus common standalone words in French, Spanish, Portuguese,
  Italian, German and Dutch. For other languages the app relies on the alternative answers Claude provides.
- Article text comes from Wikipedia under [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/).
  The quiz links back to the source sections.
