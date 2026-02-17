import { describe, expect, test } from "bun:test";
import * as path from "../src/utils/path.ts";

describe("path.passthrough", () => {
  test("identifies management routes", () => {
    expect(path.passthrough("/api/internal")).toBe(true);
    expect(path.passthrough("/api/internal/config")).toBe(true);
    expect(path.passthrough("/api/user")).toBe(true);
    expect(path.passthrough("/api/user/profile")).toBe(true);
    expect(path.passthrough("/api/auth")).toBe(true);
    expect(path.passthrough("/api/auth/login")).toBe(true);
    expect(path.passthrough("/api/meta")).toBe(true);
    expect(path.passthrough("/api/telemetry")).toBe(true);
    expect(path.passthrough("/api/threads")).toBe(true);
    expect(path.passthrough("/api/threads/123")).toBe(true);
    expect(path.passthrough("/api/otel")).toBe(true);
    expect(path.passthrough("/api/tab")).toBe(true);
    expect(path.passthrough("/api/durable-thread-workers")).toBe(true);
  });

  test("rejects browser routes (handled separately)", () => {
    expect(path.passthrough("/threads")).toBe(false);
    expect(path.passthrough("/docs")).toBe(false);
    expect(path.passthrough("/settings")).toBe(false);
    expect(path.passthrough("/auth")).toBe(false);
  });

  test("identifies exact match routes", () => {
    expect(path.browser("/threads.rss")).toBe(true);
    expect(path.browser("/news.rss")).toBe(true);
  });

  test("rejects provider routes", () => {
    expect(path.passthrough("/api/provider/anthropic/v1/messages")).toBe(false);
    expect(path.passthrough("/api/provider/openai/v1/chat/completions")).toBe(false);
    expect(path.passthrough("/api/provider/google/v1beta/models")).toBe(false);
  });

  test("rejects root path", () => {
    expect(path.passthrough("/")).toBe(false);
  });
});

describe("path.browser", () => {
  test("identifies auth routes", () => {
    expect(path.browser("/auth")).toBe(true);
    expect(path.browser("/auth/cli-login")).toBe(true);
    expect(path.browser("/auth/sign-in")).toBe(true);
    expect(path.browser("/auth/callback")).toBe(true);
  });

  test("identifies other browser routes", () => {
    expect(path.browser("/threads")).toBe(true);
    expect(path.browser("/threads/abc")).toBe(true);
    expect(path.browser("/docs")).toBe(true);
    expect(path.browser("/docs/api")).toBe(true);
    expect(path.browser("/settings")).toBe(true);
  });

  test("rejects API routes", () => {
    expect(path.browser("/api/internal")).toBe(false);
    expect(path.browser("/api/provider/anthropic/v1/messages")).toBe(false);
  });
});

describe("path.provider", () => {
  test("extracts anthropic", () => {
    expect(path.provider("/api/provider/anthropic/v1/messages")).toBe("anthropic");
  });

  test("extracts openai", () => {
    expect(path.provider("/api/provider/openai/v1/chat/completions")).toBe("openai");
  });

  test("extracts google", () => {
    expect(path.provider("/api/provider/google/v1beta/models/gemini-pro:generateContent")).toBe("google");
  });

  test("extracts other Amp providers (passthrough to upstream)", () => {
    expect(path.provider("/api/provider/xai/v1/chat/completions")).toBe("xai");
    expect(path.provider("/api/provider/cerebras/v1/chat/completions")).toBe("cerebras");
    expect(path.provider("/api/provider/fireworks/v1/chat/completions")).toBe("fireworks");
    expect(path.provider("/api/provider/groq/v1/chat/completions")).toBe("groq");
    expect(path.provider("/api/provider/baseten/v1/chat/completions")).toBe("baseten");
    expect(path.provider("/api/provider/kimi/v1/chat/completions")).toBe("kimi");
  });

  test("returns null for non-provider paths", () => {
    expect(path.provider("/api/internal")).toBeNull();
    expect(path.provider("/")).toBeNull();
    expect(path.provider("/api/user")).toBeNull();
  });
});

describe("path.subpath", () => {
  test("extracts sub-path for anthropic", () => {
    expect(path.subpath("/api/provider/anthropic/v1/messages")).toBe("/v1/messages");
  });

  test("extracts sub-path for openai", () => {
    expect(path.subpath("/api/provider/openai/v1/chat/completions")).toBe("/v1/chat/completions");
  });

  test("extracts sub-path for google", () => {
    expect(path.subpath("/api/provider/google/v1beta/models/gemini-pro:generateContent")).toBe(
      "/v1beta/models/gemini-pro:generateContent",
    );
  });

  test("returns original path if no match", () => {
    expect(path.subpath("/api/internal")).toBe("/api/internal");
  });
});
