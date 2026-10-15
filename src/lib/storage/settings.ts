import { DEFAULT_QUIZ_CONFIG, MAX_QUESTIONS, MIN_QUESTIONS, QUESTION_TYPES, type QuestionType, type QuizConfig } from "../quiz/types";

/**
 * User settings, persisted in localStorage only. The API key is stored under
 * its own key so it can be cleared on its own, and it never leaves the
 * browser except in requests to api.anthropic.com.
 */

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export const API_KEY_STORAGE_KEY = "wikiquiz.apiKey";
const SETTINGS_STORAGE_KEY = "wikiquiz.settings.v1";

export interface Settings {
  model: string;
  /** Language used when the user types a plain title. */
  defaultLang: string;
  /** Let the API re-run a declined request on a fallback model (supported models only). */
  refusalFallback: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  defaultLang: "en",
  refusalFallback: true,
};

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // e.g. disabled cookies / privacy mode
  }
}

export function loadSettings(): Settings {
  try {
    const raw = storage()?.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : DEFAULT_SETTINGS.model,
      defaultLang:
        typeof parsed.defaultLang === "string" && parsed.defaultLang.trim()
          ? parsed.defaultLang.trim()
          : DEFAULT_SETTINGS.defaultLang,
      refusalFallback:
        typeof parsed.refusalFallback === "boolean" ? parsed.refusalFallback : DEFAULT_SETTINGS.refusalFallback,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    storage()?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or unavailable: settings just won't persist */
  }
}

export function loadApiKey(): string {
  try {
    return storage()?.getItem(API_KEY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) storage()?.setItem(API_KEY_STORAGE_KEY, trimmed);
    else storage()?.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function clearApiKey(): void {
  try {
    storage()?.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** "sk-ant-…a1b2" — enough to recognize a key without revealing it. */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "•".repeat(key.length);
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Last-used quiz options
// ---------------------------------------------------------------------------

const QUIZ_PREFS_KEY = "wikiquiz.quizPrefs.v1";

export function loadQuizPrefs(): QuizConfig {
  try {
    const raw = storage()?.getItem(QUIZ_PREFS_KEY);
    if (!raw) return { ...DEFAULT_QUIZ_CONFIG };
    const p = JSON.parse(raw) as Partial<QuizConfig>;
    const types = Array.isArray(p.types) ? p.types.filter((t): t is QuestionType => QUESTION_TYPES.includes(t)) : [];
    const count = typeof p.count === "number" && p.count >= MIN_QUESTIONS && p.count <= MAX_QUESTIONS ? Math.round(p.count) : DEFAULT_QUIZ_CONFIG.count;
    const difficulty = p.difficulty && ["easy", "medium", "hard", "mixed"].includes(p.difficulty) ? p.difficulty : DEFAULT_QUIZ_CONFIG.difficulty;
    return { types: types.length ? types : [...DEFAULT_QUIZ_CONFIG.types], count, difficulty };
  } catch {
    return { ...DEFAULT_QUIZ_CONFIG };
  }
}

export function saveQuizPrefs(config: QuizConfig): void {
  try {
    storage()?.setItem(
      QUIZ_PREFS_KEY,
      JSON.stringify({ types: config.types, count: config.count, difficulty: config.difficulty }),
    );
  } catch {
    /* ignore */
  }
}
