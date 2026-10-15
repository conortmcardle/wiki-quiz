import { parseArticleHtml } from "../lib/wikipedia/parseArticle";
import type { Article, ArticleSection } from "../lib/wikipedia/types";
import modernHtml from "./fixtures/modern.html?raw";

export function articleFromHtml(html: string, overrides: Partial<Article> = {}): Article {
  const sections = parseArticleHtml(html);
  return {
    lang: "en",
    title: "Lyon",
    displayTitle: "Lyon",
    pageId: 101,
    revId: 5,
    url: "https://en.wikipedia.org/wiki/Lyon",
    sections,
    wordCount: sections.reduce((n, s) => n + s.wordCount, 0),
    ...overrides,
  };
}

export function lyonArticle(): Article {
  return articleFromHtml(modernHtml);
}

/** Synthetic article with `n` sections of roughly `words` words each. */
export function syntheticArticle(n: number, words: number, topLevel = (i: number) => `Part ${i}`): Article {
  const sections: ArticleSection[] = Array.from({ length: n }, (_, i) => {
    const text = Array.from({ length: words }, (_, w) => `word${i}x${w}`).join(" ");
    return {
      id: `s${i}`,
      title: i === 0 ? "Introduction" : `Section ${i}`,
      anchor: i === 0 ? "" : `Section_${i}`,
      level: i === 0 ? 1 : 2,
      path: i === 0 ? [] : [topLevel(i), `Section ${i}`].filter((v, j, a) => a.indexOf(v) === j),
      text,
      wordCount: words,
    };
  });
  return {
    lang: "en",
    title: "Synthetic",
    displayTitle: "Synthetic",
    pageId: 1,
    revId: 1,
    url: "https://en.wikipedia.org/wiki/Synthetic",
    sections,
    wordCount: n * words,
  };
}

// ---------------------------------------------------------------------------
// Fake Anthropic Messages API (server-sent events) for the client tests.
// ---------------------------------------------------------------------------

export interface FakeTurn {
  text?: string;
  stopReason?: "end_turn" | "max_tokens" | "refusal";
  status?: number;
  errorType?: string;
  headers?: Record<string, string>;
}

export function sseResponse(turn: FakeTurn): Response {
  if (turn.status && turn.status >= 400) {
    return new Response(
      JSON.stringify({ type: "error", error: { type: turn.errorType ?? "api_error", message: `fake ${turn.status}` } }),
      { status: turn.status, headers: { "content-type": "application/json", "request-id": "req_test", ...turn.headers } },
    );
  }
  const text = turn.text ?? "";
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    ],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    // split into a few deltas like a real stream
    ...chunkString(text, 40).map(
      (piece) =>
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }] as [
          string,
          unknown,
        ],
    ),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: {
          stop_reason: turn.stopReason ?? "end_turn",
          stop_sequence: null,
          ...(turn.stopReason === "refusal"
            ? { stop_details: { type: "refusal", category: "general_harms", explanation: "test refusal" } }
            : {}),
        },
        usage: { output_tokens: 20 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
}

function chunkString(s: string, size: number): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

export interface RecordedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** Install a fake fetch that replies with `turns` in order and records requests. */
export function fakeAnthropic(turns: FakeTurn[]) {
  const requests: RecordedRequest[] = [];
  let i = 0;
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const bodyText = typeof init?.body === "string" ? init.body : "";
    requests.push({ url, headers, body: bodyText ? JSON.parse(bodyText) : {} });
    const turn = turns[Math.min(i++, turns.length - 1)]!;
    return sseResponse(turn);
  };
  return { fetchFn, requests };
}
