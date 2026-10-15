/**
 * One error type for everything the UI needs to explain to the user.
 * `kind` drives the friendly message and which recovery actions are offered.
 */
export type AppErrorKind =
  | "invalid-input" // not a Wikipedia URL / empty title
  | "not-found" // article doesn't exist
  | "not-article" // talk page, category, special page, ...
  | "disambiguation" // title points at a disambiguation page
  | "empty-article" // article exists but has almost no prose
  | "network" // fetch failed (offline, DNS, CORS, ...)
  | "wiki-api" // MediaWiki returned an unexpected error
  | "missing-key" // no Anthropic API key saved
  | "invalid-key" // 401 / 403 from Anthropic
  | "rate-limit" // 429
  | "overloaded" // 529 / 5xx
  | "api" // other Anthropic API error (400, 404, ...)
  | "bad-output" // Claude's output couldn't be turned into a usable quiz
  | "refusal" // Claude declined the request
  | "cancelled"; // user aborted

export interface DisambiguationOption {
  title: string;
  description: string;
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  /** Extra technical detail, shown collapsed under the friendly message. */
  readonly detail?: string;
  /** For `disambiguation`: candidate articles the user can pick instead. */
  readonly options?: DisambiguationOption[];
  /** For `rate-limit`: seconds the API asked us to wait, when known. */
  readonly retryAfterSeconds?: number;

  constructor(
    kind: AppErrorKind,
    message: string,
    extra: {
      detail?: string;
      options?: DisambiguationOption[];
      retryAfterSeconds?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: extra.cause });
    this.name = "AppError";
    this.kind = kind;
    this.detail = extra.detail;
    this.options = extra.options;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
