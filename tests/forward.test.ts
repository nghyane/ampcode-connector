import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bufferResponseJson } from "../src/providers/codex-state.ts";
import { denied, type ForwardOptions, forward } from "../src/providers/forward.ts";

/** Minimal HTTP server that simulates provider responses. */
const baseUrl = "http://mock.local";
const originalFetch = globalThis.fetch;

// Track requests for assertions
const requests: { url: string; body: string; headers: Record<string, string> }[] = [];

// Configurable response behavior
const nextResponses: Array<{ status: number; body: string; headers?: Record<string, string> } | { error: Error }> = [];

function enqueue(status: number, body: string, headers?: Record<string, string>): void {
  nextResponses.push({ status, body, headers });
}

function enqueueError(error: Error): void {
  nextResponses.push({ error });
}

beforeAll(() => {
  globalThis.fetch = (async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const body = await req.text();
    const hdrs: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      hdrs[k] = v;
    });
    requests.push({ url: req.url, body, headers: hdrs });

    const next = nextResponses.shift();
    if (!next) return new Response("no mock configured", { status: 500 });
    if ("error" in next) throw next.error;

    return new Response(next.body, {
      status: next.status,
      headers: { "Content-Type": "application/json", ...next.headers },
    });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function opts(overrides?: Partial<ForwardOptions>): ForwardOptions {
  return {
    url: `${baseUrl}/test`,
    body: '{"prompt":"hello"}',
    streaming: false,
    headers: { "Content-Type": "application/json" },
    providerName: "TestProvider",
    ...overrides,
  };
}

function clearRequests(): void {
  requests.length = 0;
  nextResponses.length = 0;
}

describe("forward", () => {
  test("returns successful JSON response", async () => {
    clearRequests();
    enqueue(200, '{"result":"ok"}');

    const res = await forward(opts());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toBe('{"prompt":"hello"}');
  });

  test("retries on 500 and eventually succeeds", async () => {
    clearRequests();
    enqueue(500, "server error");
    enqueue(500, "server error");
    enqueue(200, '{"result":"recovered"}');

    const res = await forward(opts());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "recovered" });
    expect(requests).toHaveLength(3);
  });

  test("retries on fetch error and eventually succeeds", async () => {
    clearRequests();
    enqueueError(new Error("ECONNRESET"));
    enqueue(200, '{"ok":true}');

    const res = await forward(opts());
    expect(res.status).toBe(200);
    expect(requests).toHaveLength(2);
  });

  test("returns error response on non-retryable 4xx", async () => {
    clearRequests();
    enqueue(422, '{"error":"validation"}');

    const res = await forward(opts());
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('{"error":"validation"}');
    expect(requests).toHaveLength(1);
  });

  test("returns 429 without retry (handled at routing layer)", async () => {
    clearRequests();
    enqueue(429, '{"error":"rate limited"}');

    const res = await forward(opts());
    expect(res.status).toBe(429);
    expect(requests).toHaveLength(1);
  });

  test("applies rewrite to non-streaming response", async () => {
    clearRequests();
    enqueue(200, '{"model":"real-model"}');

    const rewrite = (data: string) => data.replace("real-model", "fake-model");
    const res = await forward(opts({ rewrite }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"model":"fake-model"}');
  });

  test("logs email context on error", async () => {
    clearRequests();
    enqueue(403, '{"error":"forbidden"}');

    const res = await forward(opts({ email: "user@test.com" }));
    expect(res.status).toBe(403);
  });

  test("exhausts retries on persistent 500", async () => {
    clearRequests();
    enqueue(500, "fail");
    enqueue(500, "fail");
    enqueue(500, "fail");
    enqueue(500, "fail"); // attempt 0,1,2,3

    const res = await forward(opts());
    // After MAX_RETRIES (3), the 4th 500 is returned as-is
    expect(res.status).toBe(500);
    expect(requests).toHaveLength(4);
  });

  test("returns actionable Anthropic transport diagnostics after fetch retries are exhausted", async () => {
    clearRequests();
    enqueueError(new Error("ECONNRESET"));
    enqueueError(new Error("ECONNRESET"));
    enqueueError(new Error("ECONNRESET"));
    enqueueError(new Error("ECONNRESET"));

    const res = await forward(
      opts({
        providerName: "Anthropic",
      }),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("connection_error");
    expect(body.error.message).toContain("Anthropic connection error after retries were exhausted.");
    expect(body.error.message).toContain("MTU");
  });

  test("strips unsupported Codex request fields before forwarding", async () => {
    clearRequests();
    enqueue(200, '{"result":"ok"}');

    const res = await forward(
      opts({
        providerName: "OpenAI Codex",
        body: JSON.stringify({
          model: "gpt-5.4",
          prompt_cache_retention: "24h",
          safety_identifier: "amp-user",
          stream: true,
          stream_options: { include_obfuscation: false },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(requests[0]!.body)).toEqual({ model: "gpt-5.4", stream: true });
  });

  test("backfills empty Codex streaming completed output from output_item.done events", async () => {
    clearRequests();
    enqueue(
      200,
      [
        'data: {"type":"response.created","response":{"id":"resp_1"}}',
        "",
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"hello"}]}}',
        "",
        'data: {"type":"response.completed","response":{"id":"resp_1","output":[],"usage":{"input_tokens":1,"output_tokens":1}}}',
        "",
      ].join("\n"),
      { "Content-Type": "text/event-stream" },
    );

    const res = await forward(
      opts({
        providerName: "OpenAI Codex",
        streaming: true,
        body: JSON.stringify({ model: "gpt-5.4", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"response.completed"');
    expect(text).toContain('"output":[{"type":"message","id":"msg_1"');
    expect(text).toContain('"text":"hello"');
  });

  test("backfills missing Codex message output when completed output only has reasoning", async () => {
    clearRequests();
    enqueue(
      200,
      [
        'data: {"type":"response.created","response":{"id":"resp_1"}}',
        "",
        'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"{\\"goal\\":\\"continue\\"}"}]}}',
        "",
        'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"reasoning","id":"rs_1","summary":[]}],"usage":{"input_tokens":1,"output_tokens":1}}}',
        "",
      ].join("\n"),
      { "Content-Type": "text/event-stream" },
    );

    const res = await forward(
      opts({
        providerName: "OpenAI Codex",
        streaming: true,
        body: JSON.stringify({ model: "gpt-5.4", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"reasoning","id":"rs_1"');
    expect(text).toContain('"type":"message","id":"msg_1"');
    expect(text).toContain("goal");
  });

  test("synthesizes missing Codex message output from output_text events", async () => {
    clearRequests();
    enqueue(
      200,
      [
        'data: {"type":"response.created","response":{"id":"resp_1"}}',
        "",
        'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"message","id":"msg_1","role":"assistant","content":[]}}',
        "",
        'data: {"type":"response.content_part.added","output_index":1,"content_index":0,"part":{"type":"output_text","text":""}}',
        "",
        'data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"{\\"goal\\":"}',
        "",
        'data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"\\"continue\\"}"}',
        "",
        'data: {"type":"response.output_text.done","output_index":1,"content_index":0,"text":"{\\"goal\\":\\"continue\\"}"}',
        "",
        'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"reasoning","id":"rs_1","summary":[]}],"usage":{"input_tokens":1,"output_tokens":1}}}',
        "",
      ].join("\n"),
      { "Content-Type": "text/event-stream" },
    );

    const res = await forward(
      opts({
        providerName: "OpenAI Codex",
        streaming: true,
        body: JSON.stringify({ model: "gpt-5.4", stream: true }),
      }),
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"reasoning","id":"rs_1"');
    expect(text).toContain('"type":"message","role":"assistant"');
    expect(text).toContain("goal");
  });
});

describe("bufferResponseJson", () => {
  test("synthesizes handoff message output while buffering Codex SSE", async () => {
    const response = new Response(
      [
        'data: {"type":"response.created","response":{"id":"resp_1"}}',
        "",
        'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"message","id":"msg_1","role":"assistant","content":[]}}',
        "",
        'data: {"type":"response.content_part.added","output_index":1,"content_index":0,"part":{"type":"output_text","text":""}}',
        "",
        'data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"{\\"goal\\":"}',
        "",
        'data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"\\"continue\\"}"}',
        "",
        'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"reasoning","id":"rs_1","summary":[]}],"usage":{"input_tokens":1,"output_tokens":1}}}',
        "",
      ].join("\n"),
      { headers: { "Content-Type": "text/event-stream" } },
    );

    const fullResponse = await bufferResponseJson(response);
    expect(fullResponse?.output).toEqual([
      { type: "reasoning", id: "rs_1", summary: [] },
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: '{"goal":"continue"}', annotations: [] }],
        status: "completed",
      },
    ]);
  });
});

describe("denied", () => {
  test("returns 401 with provider name", async () => {
    const res = denied("Anthropic");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Anthropic");
    expect(body.error.message).toContain("login");
  });
});
