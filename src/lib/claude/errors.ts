import Anthropic from "@anthropic-ai/sdk";
import { AppError, isAbortError } from "../errors";

/** Turn an SDK/network error into a friendly AppError. */
export function mapAnthropicError(err: unknown, model: string): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Anthropic.APIUserAbortError || isAbortError(err)) {
    return new AppError("cancelled", "Cancelled.", { cause: err });
  }

  const detail = describe(err);

  if (err instanceof Anthropic.AuthenticationError) {
    return new AppError(
      "invalid-key",
      "Anthropic didn't accept your API key. Check it in Settings: it should start with “sk-ant-” and be active in the Claude Console.",
      { cause: err, detail },
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AppError(
      "invalid-key",
      "Your API key doesn't have permission to use this model. Check the key's workspace in the Claude Console, or pick another model in Settings.",
      { cause: err, detail },
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AppError(
      "api",
      `The model “${model}” wasn't found. Check the model name in Settings (the default is claude-sonnet-5-5).`,
      { cause: err, detail },
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get?.("retry-after"));
    return new AppError(
      "rate-limit",
      Number.isFinite(retryAfter) && retryAfter > 0
        ? `You've hit your API rate limit. Wait about ${Math.ceil(retryAfter)} seconds and try again.`
        : "You've hit your API rate limit. Wait a minute and try again, or ask for fewer questions.",
      { cause: err, detail, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) },
    );
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AppError(
      "overloaded",
      err.status === 529
        ? "Claude is overloaded right now. Wait a moment and try again."
        : "The Claude API had a temporary problem. Try again in a moment.",
      { cause: err, detail },
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    const message = err.message.toLowerCase();
    if (message.includes("credit balance")) {
      return new AppError(
        "api",
        "Your Anthropic account is out of credit. Add credit in the Claude Console, then try again.",
        { cause: err, detail },
      );
    }
    return new AppError("api", "The Claude API rejected the request.", { cause: err, detail });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AppError(
      "network",
      "Couldn't reach the Claude API. Check your internet connection (and any ad blocker or firewall blocking api.anthropic.com).",
      { cause: err, detail },
    );
  }
  if (err instanceof Anthropic.APIError) {
    return new AppError("api", `The Claude API returned an error${err.status ? ` (HTTP ${err.status})` : ""}.`, {
      cause: err,
      detail,
    });
  }
  if (err instanceof TypeError) {
    // fetch() network failures surface as TypeError in browsers
    return new AppError("network", "Couldn't reach the Claude API. Check your internet connection.", {
      cause: err,
      detail,
    });
  }
  return new AppError("api", "Something went wrong talking to Claude.", { cause: err, detail });
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const requestId = err.requestID ? ` (request id ${err.requestID})` : "";
    return `${err.status ?? ""} ${err.name}: ${err.message}${requestId}`.trim();
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
