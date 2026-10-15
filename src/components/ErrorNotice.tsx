import type { ReactNode } from "react";
import { AppError, type AppErrorKind } from "../lib/errors";

const TITLES: Record<AppErrorKind, string> = {
  "invalid-input": "That doesn't look right",
  "not-found": "Article not found",
  "not-article": "Not an article",
  disambiguation: "Which one did you mean?",
  "empty-article": "Article too short",
  network: "Connection problem",
  "wiki-api": "Wikipedia problem",
  "missing-key": "API key needed",
  "invalid-key": "API key not accepted",
  "rate-limit": "Slow down a little",
  overloaded: "Claude is busy",
  api: "Claude API error",
  "bad-output": "Couldn't build a quiz",
  refusal: "Claude declined",
  cancelled: "Cancelled",
};

interface Props {
  error: unknown;
  onRetry?: () => void;
  onPickOption?: (title: string) => void;
  onOpenSettings?: () => void;
  onDismiss?: () => void;
  children?: ReactNode;
}

export function ErrorNotice({ error, onRetry, onPickOption, onOpenSettings, onDismiss, children }: Props) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("api", "Something unexpected went wrong.", {
          detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
  const kind = appError.kind;
  const needsKey = kind === "missing-key" || kind === "invalid-key";

  return (
    <div className={`notice ${kind === "disambiguation" ? "notice-info" : "notice-error"}`} role="alert">
      <h2 className="notice-title">{TITLES[kind]}</h2>
      <p>{appError.message}</p>

      {kind === "disambiguation" && appError.options && appError.options.length > 0 && onPickOption && (
        <ul className="option-list">
          {appError.options.map((o) => (
            <li key={o.title}>
              <button type="button" className="option-button" onClick={() => onPickOption(o.title)}>
                <strong>{o.title}</strong>
                {o.description && o.description !== o.title && <span>{o.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {children}

      <div className="notice-actions">
        {needsKey && onOpenSettings && (
          <button type="button" className="btn btn-primary" onClick={onOpenSettings}>
            Open settings
          </button>
        )}
        {onRetry && kind !== "invalid-input" && kind !== "disambiguation" && !needsKey && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
        {onDismiss && (
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      {appError.detail && (
        <details className="notice-detail">
          <summary>Technical details</summary>
          <pre>{appError.detail}</pre>
        </details>
      )}
    </div>
  );
}
