import { describe, expect, test } from "bun:test";
import * as rewriter from "../src/proxy/rewriter.ts";
import * as sse from "../src/utils/streaming.ts";

describe("rewriter.rewrite", () => {
  const rewrite = rewriter.rewrite("claude-opus-4-6");

  test("rewrites model field in JSON data", () => {
    const data = JSON.stringify({ model: "claude-sonnet-4-20250514", content: "hello" });
    const result = rewrite(data);
    const parsed = JSON.parse(result);
    expect(parsed.model).toBe("claude-opus-4-6");
  });

  test("rewrites nested model fields", () => {
    const data = JSON.stringify({
      message: { model: "claude-sonnet-4-20250514", role: "assistant" },
    });
    const result = rewrite(data);
    const parsed = JSON.parse(result);
    expect(parsed.message.model).toBe("claude-opus-4-6");
  });

  test("passes through [DONE] marker", () => {
    expect(rewrite("[DONE]")).toBe("[DONE]");
  });

  test("passes through non-JSON data unchanged", () => {
    expect(rewrite("not json")).toBe("not json");
  });

  test("does not add model field if not present", () => {
    const data = JSON.stringify({ content: "hello", role: "assistant" });
    const result = rewrite(data);
    const parsed = JSON.parse(result);
    expect(parsed.model).toBeUndefined();
  });

  test("suppresses thinking blocks when tool_use is present", () => {
    const data = JSON.stringify({
      content: [
        { type: "thinking", text: "Let me think..." },
        { type: "tool_use", name: "read_file", input: {} },
        { type: "text", text: "Here is the result" },
      ],
    });
    const result = rewrite(data);
    const parsed = JSON.parse(result);
    expect(parsed.content).toHaveLength(2);
    expect(parsed.content[0].type).toBe("tool_use");
    expect(parsed.content[1].type).toBe("text");
  });

  test("keeps thinking blocks when no tool_use", () => {
    const data = JSON.stringify({
      content: [
        { type: "thinking", text: "Let me think..." },
        { type: "text", text: "Here is the result" },
      ],
    });
    const result = rewrite(data);
    const parsed = JSON.parse(result);
    expect(parsed.content).toHaveLength(2);
    expect(parsed.content[0].type).toBe("thinking");
  });
});

describe("sse.parse", () => {
  test("parses single event", () => {
    const chunk = 'data: {"model":"claude"}\n\n';
    const events = sse.parse(chunk);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('{"model":"claude"}');
  });

  test("parses multiple events", () => {
    const chunk = 'data: {"chunk":1}\n\ndata: {"chunk":2}\n\n';
    const events = sse.parse(chunk);
    expect(events).toHaveLength(2);
  });

  test("parses event with event type", () => {
    const chunk = 'event: message\ndata: {"text":"hi"}\n\n';
    const events = sse.parse(chunk);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("message");
    expect(events[0]!.data).toBe('{"text":"hi"}');
  });

  test("handles [DONE] marker", () => {
    const chunk = "data: [DONE]\n\n";
    const events = sse.parse(chunk);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe("[DONE]");
  });

  test("ignores empty chunks", () => {
    expect(sse.parse("")).toHaveLength(0);
    expect(sse.parse("\n\n")).toHaveLength(0);
  });
});

describe("sse.encode", () => {
  test("encodes basic data event", () => {
    const encoded = sse.encode({ data: '{"model":"claude"}' });
    expect(encoded).toBe('data: {"model":"claude"}\n\n');
  });

  test("encodes event with type", () => {
    const encoded = sse.encode({ event: "message", data: "hello" });
    expect(encoded).toBe("event: message\ndata: hello\n\n");
  });

  test("encodes multi-line data", () => {
    const encoded = sse.encode({ data: "line1\nline2" });
    expect(encoded).toBe("data: line1\ndata: line2\n\n");
  });
});
