import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fakeAnthropic, type FakeTurn } from "../../test/helpers";
import { AppError } from "../errors";
import { callClaudeJson, FALLBACK_BETA, modelFeatures } from "./client";

const Schema = z.object({ answer: z.string() });

function setup(turns: FakeTurn[], settings: Partial<{ apiKey: string; model: string; refusalFallback: boolean }> = {}) {
  const fake = fakeAnthropic(turns);
  vi.stubGlobal("fetch", fake.fetchFn);
  const call = () =>
    callClaudeJson({
      settings: { apiKey: "sk-ant-test", model: "claude-sonnet-5-5", refusalFallback: true, ...settings },
      system: "sys",
      user: "Give me JSON",
      schema: Schema,
      maxTokens: 1000,
      label: "test",
    });
  return { ...fake, call };
}

async function appError(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callClaudeJson", () => {
  it("sends a browser-direct request with structured output, effort and refusal fallback", async () => {
    const { call, requests } = setup([{ text: '{"answer":"Lyon"}' }]);
    const result = await call();
    expect(result).toEqual({ data: { answer: "Lyon" }, attempts: 1 });

    const req = requests[0]!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(req.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(req.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(req.headers.get("anthropic-beta")).toContain(FALLBACK_BETA);
    expect(req.body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 1000,
      stream: true,
      system: "sys",
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    const schema = (req.body.output_config as { format: { schema: { properties: object } } }).format.schema;
    expect(Object.keys(schema.properties)).toEqual(["answer"]);
  });

  it("omits the fallback when disabled, and structured output/effort for unknown models", async () => {
    const { call, requests } = setup([{ text: 'Here: {"answer":"x"}' }], { model: "my-custom-model", refusalFallback: false });
    await call();
    expect(requests[0]!.body.fallbacks).toBeUndefined();
    expect(requests[0]!.body.output_config).toBeUndefined();
    expect(requests[0]!.headers.get("anthropic-beta")).toBeNull();
  });

  it("retries once on malformed JSON, telling the model what went wrong", async () => {
    const { call, requests } = setup([{ text: '{"answer": "Ly' }, { text: '{"answer":"Lyon"}' }]);
    const result = await call();
    expect(result.attempts).toBe(2);
    expect(requests).toHaveLength(2);
    const retryText = (requests[1]!.body.messages as { content: string }[])[0]!.content;
    expect(retryText).toMatch(/could not be used \(Malformed JSON/);
  });

  it("retries once on schema mismatch, then gives up with a bad-output error", async () => {
    const { call, requests } = setup([{ text: '{"wrong":1}' }, { text: '{"still":"wrong"}' }]);
    const err = await appError(call());
    expect(err.kind).toBe("bad-output");
    expect(err.detail).toMatch(/answer/);
    expect(requests).toHaveLength(2);
  });

  it("retries a truncated (max_tokens) reply with a bigger budget", async () => {
    const { call, requests } = setup([{ text: '{"answer":', stopReason: "max_tokens" }, { text: '{"answer":"ok"}' }]);
    expect((await call()).data.answer).toBe("ok");
    expect(requests[1]!.body.max_tokens).toBe(2000);
  });

  it("reports refusals without retrying", async () => {
    const { call, requests } = setup([{ text: "", stopReason: "refusal" }]);
    const err = await appError(call());
    expect(err.kind).toBe("refusal");
    expect(err.detail).toMatch(/general_harms/);
    expect(requests).toHaveLength(1);
  });

  it("maps HTTP errors to friendly kinds", async () => {
    expect((await appError(setup([{ status: 401, errorType: "authentication_error" }]).call())).kind).toBe("invalid-key");
    expect((await appError(setup([{ status: 404, errorType: "not_found_error" }]).call())).message).toMatch(
      /claude-sonnet-5-5/,
    );
    const rate = await appError(
      setup([{ status: 429, errorType: "rate_limit_error", headers: { "retry-after": "20", "retry-after-ms": "1" } }]).call(),
    );
    expect(rate.kind).toBe("rate-limit");
    expect(rate.retryAfterSeconds).toBe(20);
    expect((await appError(setup([{ status: 529, errorType: "overloaded_error", headers: { "retry-after-ms": "1" } }]).call())).kind).toBe(
      "overloaded",
    );
    expect((await appError(setup([{ status: 400, errorType: "invalid_request_error" }]).call())).kind).toBe("api");
  });

  it("maps network failures", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await appError(
      callClaudeJson({
        settings: { apiKey: "sk-ant-test", model: "claude-sonnet-5-5", refusalFallback: true },
        system: "s",
        user: "u",
        schema: Schema,
        maxTokens: 10,
        label: "t",
      }),
    );
    expect(err.kind).toBe("network");
  }, 20_000);

  it("asks for a key before calling the API", async () => {
    const { requests } = setup([{ text: "{}" }]);
    const err = await appError(
      callClaudeJson({
        settings: { apiKey: "  ", model: "claude-sonnet-5-5", refusalFallback: true },
        system: "s",
        user: "u",
        schema: Schema,
        maxTokens: 10,
        label: "t",
      }),
    );
    expect(err.kind).toBe("missing-key");
    expect(requests).toHaveLength(0);
  });
});

describe("modelFeatures", () => {
  it("knows which models support structured outputs and effort", () => {
    expect(modelFeatures("claude-sonnet-5-5")).toEqual({ structuredOutputs: true, effort: true });
    expect(modelFeatures("claude-opus-5-5")).toEqual({ structuredOutputs: true, effort: true });
    expect(modelFeatures("claude-haiku-5-5")).toEqual({ structuredOutputs: true, effort: true });
    expect(modelFeatures("claude-haiku-4-5")).toEqual({ structuredOutputs: true, effort: false });
    expect(modelFeatures("something-else")).toEqual({ structuredOutputs: false, effort: false });
  });
});
