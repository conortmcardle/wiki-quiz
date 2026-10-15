import { useCallback, useRef, useState } from "react";
import { ArticleInput } from "./components/ArticleInput";
import { ArticleOverview } from "./components/ArticleOverview";
import { ErrorNotice } from "./components/ErrorNotice";
import { GeneratingView } from "./components/GeneratingView";
import { QuizPlayer } from "./components/QuizPlayer";
import { QuizReady } from "./components/QuizReady";
import { QuizSetup } from "./components/QuizSetup";
import { SettingsPanel } from "./components/SettingsPanel";
import { AppError } from "./lib/errors";
import type { GenerationProgress } from "./lib/quiz/generate";
import {
  clearActiveSession,
  loadActiveSession,
  newSession,
  saveActiveSession,
  scoreOf,
  type QuizSession,
} from "./lib/quiz/session";
import type { Quiz, QuizConfig } from "./lib/quiz/types";
import { loadCachedCategories, saveCachedCategories } from "./lib/storage/categories";
import {
  clearApiKey,
  loadApiKey,
  loadQuizPrefs,
  loadSettings,
  saveApiKey,
  saveQuizPrefs,
  saveSettings,
  type Settings,
} from "./lib/storage/settings";
import { fetchArticle } from "./lib/wikipedia/fetchArticle";
import type { Article, ArticleRef } from "./lib/wikipedia/types";

type View =
  | { name: "home"; error?: unknown; lastRef?: ArticleRef }
  | { name: "loading-article"; ref: ArticleRef }
  | { name: "article"; article: Article; error?: unknown; lastConfig?: QuizConfig }
  | { name: "generating"; article: Article; config: QuizConfig; progress: GenerationProgress }
  | { name: "ready"; article: Article; quiz: Quiz }
  | { name: "playing"; article: Article | null; session: QuizSession }
  | { name: "results"; article: Article | null; session: QuizSession };

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [apiKey, setApiKey] = useState<string>(loadApiKey);
  const [quizPrefs, setQuizPrefs] = useState<QuizConfig>(loadQuizPrefs);
  const [view, setView] = useState<View>({ name: "home" });
  const [settingsOpen, setSettingsOpen] = useState<{ reason?: string } | null>(null);
  const [resumable, setResumable] = useState<QuizSession | null>(loadActiveSession);
  const abortRef = useRef<AbortController | null>(null);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const newController = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  };

  const loadArticle = useCallback(async (ref: ArticleRef) => {
    const controller = newController();
    setView({ name: "loading-article", ref });
    try {
      const article = await fetchArticle(ref, { signal: controller.signal });
      if (!controller.signal.aborted) setView({ name: "article", article });
    } catch (err) {
      if (err instanceof AppError && err.kind === "cancelled") return;
      if (!controller.signal.aborted) setView({ name: "home", error: err, lastRef: ref });
    }
  }, []);

  const startGeneration = async (article: Article, config: QuizConfig) => {
    saveQuizPrefs(config);
    setQuizPrefs({ types: config.types, count: config.count, difficulty: config.difficulty });
    if (!apiKey) {
      setSettingsOpen({ reason: "Add your Anthropic API key to generate a quiz. It stays in this browser." });
      return;
    }
    const controller = newController();
    setView({ name: "generating", article, config, progress: { phase: "categories", message: "Starting…" } });
    try {
      // The Claude SDK + schema code is only needed from here on: load it lazily.
      const { generateQuiz } = await import("./lib/quiz/generate");
      const quiz = await generateQuiz({
        article,
        config,
        settings: { apiKey, model: settings.model, refusalFallback: settings.refusalFallback },
        categories: loadCachedCategories(article),
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) {
            setView((v) => (v.name === "generating" ? { ...v, progress } : v));
          }
        },
        onCategories: (cats) => saveCachedCategories(article, cats),
      });
      if (!controller.signal.aborted) setView({ name: "ready", article, quiz });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof AppError && err.kind === "cancelled")) return;
      setView({ name: "article", article, error: err, lastConfig: config });
    }
  };

  const cancel = (next: View) => {
    abortRef.current?.abort();
    setView(next);
  };

  const play = (article: Article | null, session: QuizSession) => {
    saveActiveSession(session);
    setResumable(null);
    setView({ name: "playing", article, session });
  };

  const quitQuiz = (article: Article | null) => {
    clearActiveSession();
    setView(article ? { name: "article", article } : { name: "home" });
  };

  const keyMissing = !apiKey;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="brand">
            <button type="button" className="brand-button" onClick={() => cancel({ name: "home" })}>
              <span className="brand-mark" aria-hidden="true">
                W?
              </span>
              Wiki Quiz
            </button>
          </h1>
          <div className="header-actions">
            <button
              type="button"
              className={`btn btn-ghost btn-small ${keyMissing ? "needs-attention" : ""}`}
              onClick={() => setSettingsOpen({})}
            >
              Settings
              {keyMissing && <span className="dot" aria-label="(API key needed)" />}
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        {view.name === "home" && (
          <>
            <p className="lede">
              Turn any Wikipedia article into a quiz, then find out which parts of the topic you're weakest in.
            </p>
            {resumable && (
              <div className="notice notice-info resume">
                <p>
                  You have an unfinished quiz on <strong>{resumable.quiz.article.displayTitle}</strong> (question{" "}
                  {resumable.answers.length + 1} of {resumable.quiz.questions.length}).
                </p>
                <div className="notice-actions">
                  <button type="button" className="btn btn-primary" onClick={() => play(null, resumable)}>
                    Resume quiz
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      clearActiveSession();
                      setResumable(null);
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
            <ArticleInput
              defaultLang={settings.defaultLang}
              busy={false}
              onSubmit={loadArticle}
              onLangChange={(lang) => updateSettings({ defaultLang: lang })}
            />
            {view.error !== undefined && (
              <ErrorNotice
                error={view.error}
                onRetry={view.lastRef ? () => loadArticle(view.lastRef!) : undefined}
                onPickOption={(title) => loadArticle({ lang: view.lastRef?.lang ?? settings.defaultLang, title })}
                onDismiss={() => setView({ name: "home" })}
              />
            )}
          </>
        )}

        {view.name === "loading-article" && (
          <div className="card loading-card" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>
              Fetching <strong>{view.ref.title}</strong> from {view.ref.lang}.wikipedia.org…
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => cancel({ name: "home" })}>
              Cancel
            </button>
          </div>
        )}

        {view.name === "article" && (
          <>
            {view.error !== undefined && (
              <ErrorNotice
                error={view.error}
                onRetry={view.lastConfig ? () => startGeneration(view.article, view.lastConfig!) : undefined}
                onOpenSettings={() => setSettingsOpen({})}
                onDismiss={() => setView({ name: "article", article: view.article })}
              />
            )}
            <ArticleOverview article={view.article} onChangeArticle={() => setView({ name: "home" })}>
              <QuizSetup
                initial={view.lastConfig ?? quizPrefs}
                hasKey={!keyMissing}
                onStart={(config) => startGeneration(view.article, config)}
              />
            </ArticleOverview>
          </>
        )}

        {view.name === "generating" && (
          <GeneratingView
            title={view.article.displayTitle}
            progress={view.progress}
            model={settings.model}
            onCancel={() => cancel({ name: "article", article: view.article, lastConfig: view.config })}
          />
        )}

        {view.name === "ready" && (
          <QuizReady
            quiz={view.quiz}
            onStart={() => play(view.article, newSession(view.quiz))}
            onBack={() => setView({ name: "article", article: view.article, lastConfig: view.quiz.config })}
          />
        )}
        {view.name === "playing" && (
          <QuizPlayer
            key={view.session.id}
            session={view.session}
            onChange={(session) => {
              saveActiveSession(session);
              setView({ ...view, session });
            }}
            onFinish={(session) => {
              clearActiveSession();
              setView({ name: "results", article: view.article, session });
            }}
            onQuit={() => quitQuiz(view.article)}
          />
        )}

        {view.name === "results" && (
          <section className="card">
            <p className="eyebrow">Results</p>
            <h2 className="article-title">{view.session.quiz.article.displayTitle}</h2>
            <p className="big-score">
              {scoreOf(view.session).correct} / {scoreOf(view.session).total}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => quitQuiz(view.article)}>
              Done
            </button>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Article text from <a href="https://www.wikipedia.org/">Wikipedia</a> (CC BY-SA). Questions generated by
          Claude, so double-check anything important against the article.
        </p>
      </footer>

      <SettingsPanel
        open={settingsOpen !== null}
        reason={settingsOpen?.reason}
        apiKey={apiKey}
        settings={settings}
        onSaveKey={(key) => {
          saveApiKey(key);
          setApiKey(key);
          setSettingsOpen(null);
        }}
        onClearKey={() => {
          clearApiKey();
          setApiKey("");
        }}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(null)}
      />
    </div>
  );
}
