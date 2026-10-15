import { useCallback, useRef, useState } from "react";
import { ArticleInput } from "./components/ArticleInput";
import { ArticleOverview } from "./components/ArticleOverview";
import { ErrorNotice } from "./components/ErrorNotice";
import { GeneratingView } from "./components/GeneratingView";
import { QuizPlayer } from "./components/QuizPlayer";
import { QuizReady } from "./components/QuizReady";
import { QuizSetup } from "./components/QuizSetup";
import { RecentArticles } from "./components/RecentArticles";
import { Results } from "./components/Results";
import { SettingsPanel } from "./components/SettingsPanel";
import { AppError } from "./lib/errors";
import type { GenerationProgress } from "./lib/quiz/generate";
import {
  clearActiveSession,
  loadActiveSession,
  newSession,
  saveActiveSession,
  type QuizSession,
} from "./lib/quiz/session";
import type { Quiz, QuizArticleInfo, QuizConfig } from "./lib/quiz/types";
import { weakAreaWeights, type SessionAnalysis } from "./lib/results/analyze";
import { loadCachedCategories, saveCachedCategories } from "./lib/storage/categories";
import {
  clearQuizData,
  listHistoryArticles,
  loadHistory,
  recentPrompts,
  recordAttempt,
  type ArticleHistory,
  type HistoryIndexEntry,
} from "./lib/storage/history";
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
import { shuffle } from "./lib/text";
import { fetchArticle } from "./lib/wikipedia/fetchArticle";
import type { Article, ArticleRef } from "./lib/wikipedia/types";

type View =
  | { name: "home"; error?: unknown; lastRef?: ArticleRef }
  | { name: "loading-article"; ref: ArticleRef }
  | { name: "article"; article: Article; error?: unknown; lastConfig?: QuizConfig }
  | { name: "generating"; title: string; config: QuizConfig; progress: GenerationProgress; back: View }
  | { name: "ready"; article: Article; quiz: Quiz }
  | { name: "playing"; article: Article | null; session: QuizSession }
  | { name: "results"; article: Article | null; session: QuizSession; history: ArticleHistory | null; error?: unknown };

function isArticle(x: Article | QuizArticleInfo): x is Article {
  return Array.isArray((x as Article).sections);
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [apiKey, setApiKey] = useState<string>(loadApiKey);
  const [quizPrefs, setQuizPrefs] = useState<QuizConfig>(loadQuizPrefs);
  const [view, setView] = useState<View>({ name: "home" });
  const [settingsOpen, setSettingsOpen] = useState<{ reason?: string } | null>(null);
  const [resumable, setResumable] = useState<QuizSession | null>(loadActiveSession);
  const [recent, setRecent] = useState<HistoryIndexEntry[]>(listHistoryArticles);
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

  const goHome = () => {
    abortRef.current?.abort();
    setRecent(listHistoryArticles());
    setResumable(loadActiveSession());
    setView({ name: "home" });
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

  /**
   * Generate a quiz. `source` is the loaded article, or (when coming from a
   * resumed quiz's results) just its saved info, in which case the article is
   * fetched again first. `back` is where errors and Cancel return to.
   */
  const startGeneration = async (source: Article | QuizArticleInfo, config: QuizConfig, back?: View) => {
    if (!config.categoryWeights && !config.avoidPrompts) {
      saveQuizPrefs(config);
      setQuizPrefs({ types: config.types, count: config.count, difficulty: config.difficulty });
    }
    if (!apiKey) {
      setSettingsOpen({ reason: "Add your Anthropic API key to generate a quiz. It stays in this browser." });
      return;
    }
    const returnTo: View = back ?? (isArticle(source) ? { name: "article", article: source } : { name: "home" });
    const controller = newController();
    const title = isArticle(source) ? source.displayTitle : source.displayTitle;
    setView({
      name: "generating",
      title,
      config,
      back: returnTo,
      progress: { phase: "categories", message: isArticle(source) ? "Starting…" : "Fetching the article from Wikipedia…" },
    });
    let article: Article | null = isArticle(source) ? source : null;
    try {
      if (!article) article = await fetchArticle({ lang: source.lang, title: source.title }, { signal: controller.signal });
      const loaded = article;
      // The Claude SDK + schema code is only needed from here on: load it lazily.
      const { generateQuiz } = await import("./lib/quiz/generate");
      const quiz = await generateQuiz({
        article: loaded,
        config,
        settings: { apiKey, model: settings.model, refusalFallback: settings.refusalFallback },
        categories: loadCachedCategories(loaded),
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setView((v) => (v.name === "generating" ? { ...v, progress } : v));
        },
        onCategories: (cats) => saveCachedCategories(loaded, cats),
      });
      if (!controller.signal.aborted) setView({ name: "ready", article: loaded, quiz });
    } catch (err) {
      if (controller.signal.aborted || (err instanceof AppError && err.kind === "cancelled")) return;
      if (returnTo.name === "results") setView({ ...returnTo, error: err });
      else if (article) setView({ name: "article", article, error: err, lastConfig: config });
      else setView({ name: "home", error: err });
    }
  };

  const play = (article: Article | null, session: QuizSession) => {
    saveActiveSession(session);
    setResumable(null);
    setView({ name: "playing", article, session });
  };

  const quitQuiz = (article: Article | null) => {
    clearActiveSession();
    if (article) setView({ name: "article", article });
    else goHome();
  };

  const finishQuiz = (article: Article | null, session: QuizSession) => {
    clearActiveSession();
    const history = recordAttempt(session);
    setView({ name: "results", article, session, history });
    window.scrollTo({ top: 0 });
  };

  // --- Results actions -----------------------------------------------------

  const retryMissed = (article: Article | null, session: QuizSession) => {
    const missedIds = new Set(session.answers.filter((a) => !a.correct).map((a) => a.questionId));
    const questions = session.quiz.questions
      .filter((q) => missedIds.has(q.id))
      .map((q) => (q.options ? { ...q, options: shuffle(q.options) } : q));
    const quiz: Quiz = { ...session.quiz, id: `${session.quiz.id}:retry`, questions, warnings: [] };
    play(article, newSession(quiz, "retry-missed"));
  };

  const avoidList = (session: QuizSession, history: ArticleHistory | null) => {
    const prompts = [...session.quiz.questions.map((q) => q.prompt), ...recentPrompts(history)];
    return [...new Set(prompts)].slice(0, 60);
  };

  const practiceWeak = (current: Extract<View, { name: "results" }>, analysis: SessionAnalysis) => {
    const { types, count, difficulty } = current.session.quiz.config;
    startGeneration(
      current.article ?? current.session.quiz.article,
      {
        types,
        count: Math.max(count, 5),
        difficulty,
        categoryWeights: weakAreaWeights(analysis),
        avoidPrompts: avoidList(current.session, current.history),
      },
      { ...current, error: undefined },
    );
  };

  const newQuizSameArticle = (current: Extract<View, { name: "results" }>) => {
    const { types, count, difficulty } = current.session.quiz.config;
    startGeneration(
      current.article ?? current.session.quiz.article,
      { types, count: Math.max(count, 5), difficulty, avoidPrompts: avoidList(current.session, current.history) },
      { ...current, error: undefined },
    );
  };

  const keyMissing = !apiKey;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <h1 className="brand">
            <button type="button" className="brand-button" onClick={goHome}>
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
                onOpenSettings={() => setSettingsOpen({})}
                onDismiss={() => setView({ name: "home" })}
              />
            )}
            <RecentArticles entries={recent} onOpen={(e) => loadArticle({ lang: e.lang, title: e.title })} />
          </>
        )}

        {view.name === "loading-article" && (
          <div className="card loading-card" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>
              Fetching <strong>{view.ref.title}</strong> from {view.ref.lang}.wikipedia.org…
            </p>
            <button type="button" className="btn btn-ghost" onClick={goHome}>
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
            <ArticleOverview article={view.article} onChangeArticle={goHome}>
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
            title={view.title}
            progress={view.progress}
            model={settings.model}
            focus={!!view.config.categoryWeights}
            onCancel={() => {
              abortRef.current?.abort();
              setView(view.back);
            }}
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
            onFinish={(session) => finishQuiz(view.article, session)}
            onQuit={() => quitQuiz(view.article)}
          />
        )}

        {view.name === "results" && (
          <>
            {view.error !== undefined && (
              <ErrorNotice
                error={view.error}
                onOpenSettings={() => setSettingsOpen({})}
                onDismiss={() => setView({ ...view, error: undefined })}
              />
            )}
            <Results
              key={view.session.id}
              session={view.session}
              history={view.history}
              onRetryMissed={() => retryMissed(view.article, view.session)}
              onPracticeWeak={(analysis) => practiceWeak(view, analysis)}
              onNewQuiz={() => newQuizSameArticle(view)}
              onAnotherArticle={goHome}
            />
          </>
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
        onClearHistory={() => {
          clearQuizData();
          setRecent([]);
          setResumable(null);
          if (view.name === "results") setView({ ...view, history: loadHistory(view.session.quiz.article.lang, view.session.quiz.article.pageId) });
        }}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(null)}
      />
    </div>
  );
}
