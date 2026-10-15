import { useState, type FormEvent } from "react";
import { AppError } from "../lib/errors";
import { parseArticleInput } from "../lib/wikipedia/parseInput";
import type { ArticleRef } from "../lib/wikipedia/types";

const COMMON_LANGS = ["en", "fr", "de", "es", "it", "pt", "nl", "pl", "sv", "ru", "ja", "zh", "simple"];

const EXAMPLES: { label: string; value: string; lang: string }[] = [
  { label: "Lyon", value: "https://en.wikipedia.org/wiki/Lyon", lang: "en" },
  { label: "Marie Curie", value: "Marie Curie", lang: "en" },
  { label: "Tour Eiffel (fr)", value: "https://fr.wikipedia.org/wiki/Tour_Eiffel", lang: "fr" },
];

interface Props {
  defaultLang: string;
  busy: boolean;
  onSubmit: (ref: ArticleRef) => void;
  onLangChange: (lang: string) => void;
}

export function ArticleInput({ defaultLang, busy, onSubmit, onLangChange }: Props) {
  const [value, setValue] = useState("");
  const [lang, setLang] = useState(defaultLang);
  const [error, setError] = useState<string | null>(null);

  const submit = (raw: string, language: string) => {
    try {
      const ref = parseArticleInput(raw, language);
      setError(null);
      onSubmit(ref);
    } catch (err) {
      setError(err instanceof AppError ? err.message : String(err));
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(value, lang);
  };

  return (
    <form className="card article-input" onSubmit={handleSubmit} noValidate>
      <label htmlFor="article" className="field-label">
        Wikipedia article
      </label>
      <div className="input-row">
        <input
          id="article"
          className="text-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Paste a link or type a title"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "article-error" : "article-hint"}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? "Loading…" : "Load article"}
        </button>
      </div>

      {error ? (
        <p id="article-error" className="field-error" role="alert">
          {error}
        </p>
      ) : (
        <p id="article-hint" className="field-hint">
          Any language works: links like <code>fr.wikipedia.org/wiki/Lyon</code> pick the language
          automatically. Plain titles use the language below.
        </p>
      )}

      <div className="input-meta">
        <label className="lang-field">
          <span>Language for titles</span>
          <input
            className="text-input lang-input"
            list="lang-options"
            value={lang}
            maxLength={16}
            onChange={(e) => {
              const v = e.target.value.trim().toLowerCase();
              setLang(v);
              if (v) onLangChange(v);
            }}
            disabled={busy}
            aria-label="Wikipedia language code for plain titles"
          />
          <datalist id="lang-options">
            {COMMON_LANGS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </label>

        <div className="examples">
          <span>Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => {
                setValue(ex.value);
                submit(ex.value, ex.lang);
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
