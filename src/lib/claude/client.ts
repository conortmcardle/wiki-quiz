import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { AppError } from "../errors";
import { mapAnthropicError } from "./errors";
import { safeParseJson } from "./schema";

export interface ClaudeSettings {
  apiKey: string;
  model: string;
  refusalFallback: boolean;
}

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Feature support by model family. Current models (Claude 5.x, 4.5+) get
 * structured outputs and the effort parameter; anything we don't recognize
 * gets plain requests and we parse JSON out of the text instead.
 */
export function modelFeatures(model: string): { structuredOutputs: boolean; effort: boolean } {
  const m = model.toLowerCase();
  const modern = /^claude-(fable|mythos|opus|sonnet|haiku)-(5|4-[5-9])/.test(m);
  const noEffort = /^claude-(sonnet|haiku)-4-5/.test(m);
  return { structuredOutputs: modern, effort: modern && !noEffort };
}

export function createClient(apiKey: string): Anthropic {
  if (!apiKey.trim()) {
    throw new AppError("missing-key", "Add your Anthropic API key in Settings to generate quizzes.");
  }
  return new Anthropic({
    apiKey: apiKey.trim(),
    // Bring-your-own-key static app: requests go straight from this browser
    // to api.anthropic.com. The SDK sends the
    // `anthropic-dangerous-direct-browser-access: true` header for us.
    dangerouslyAllowBrowser: true,
    maxRetries: 2, // SDK retries 408/409/429/5xx and connection errors with backoff
  });
}

export interface JsonCallOptions<T> {
  settings: ClaudeSettings;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Schema sent as the structured output format (defaults to `schema`). */
  outputSchema?: z.ZodType;
  maxTokens: number;
  signal?: AbortSignal;
  /** Called with the running count of output characters, for progress UI. */
  onProgress?: (chars: number) => void;
  /** Short label for error details, e.g. "categories" or "questions (chunk 2)". */
  label: string;
}

export interface JsonCallResult<T> {
  data: T;
  attempts: number;
}

/**
 * Ask Claude for JSON matching `schema`. Uses structured outputs where the
 * model supports them, parses defensively either way, and retries once if
 * the output is malformed or cut off. Throws AppError.
 */
export async function callClaudeJson<T>(opts: JsonCallOptions<T>): Promise<JsonCallResult<T>> {
  const client = createClient(opts.settings.apiKey);
  const features = modelFeatures(opts.settings.model);
  const format = features.structuredOutputs ? zodOutputFormat(opts.outputSchema ?? opts.schema) : null;

  let lastProblem = "";
  let maxTokens = opts.maxTokens;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const userText =
      attempt === 1
        ? opts.user
        : `${opts.user}\n\nYour previous reply could not be used (${lastProblem}). Reply again with only the JSON object, complete and valid.`;

    const text = await streamText(client, { ...opts, maxTokens }, userText, format, features.effort);
    if (text.stopReason === "refusal") {
      throw new AppError(
        "refusal",
        "Claude declined to write questions for this article. Try a different article, or switch models in Settings.",
        { detail: text.refusalDetail },
      );
    }
    if (text.stopReason === "max_tokens") {
      lastProblem = "it was cut off because it was too long";
      maxTokens = Math.min(maxTokens * 2, 64000);
      continue;
    }
    const parsed = safeParseJson(text.text, opts.schema);
    if (parsed.ok) return { data: parsed.data, attempts: attempt };
    lastProblem = parsed.error;
  }

  throw new AppError("bad-output", "Claude's reply couldn't be turned into a quiz, even after a retry. Try again.", {
    detail: `${opts.label}: ${lastProblem}`,
  });
}

async function streamText<T>(
  client: Anthropic,
  opts: JsonCallOptions<T>,
  userText: string,
  format: ReturnType<typeof zodOutputFormat> | null,
  effort: boolean,
): Promise<{ text: string; stopReason: string | null; refusalDetail?: string }> {
  const { settings } = opts;
  const useFallback = settings.refusalFallback;
  try {
    const stream = client.beta.messages.stream(
      {
        model: settings.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: userText }],
        ...(format || effort
          ? {
              output_config: {
                ...(format ? { format: { type: "json_schema" as const, schema: format.schema } } : {}),
                ...(effort ? { effort: "medium" as const } : {}),
              },
            }
          : {}),
        ...(useFallback ? { fallbacks: "default" as const, betas: [FALLBACK_BETA] } : {}),
      },
      { signal: opts.signal },
    );

    let chars = 0;
    stream.on("text", (delta) => {
      chars += delta.length;
      opts.onProgress?.(chars);
    });

    const message = await stream.finalMessage();
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const refusalDetail =
      message.stop_reason === "refusal" && message.stop_details
        ? `${message.stop_details.category ?? "unspecified"}: ${message.stop_details.explanation ?? ""}`
        : undefined;
    return { text, stopReason: message.stop_reason, refusalDetail };
  } catch (err) {
    throw mapAnthropicError(err, settings.model);
  }
}
