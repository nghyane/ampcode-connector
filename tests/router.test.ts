import { describe, expect, test } from "bun:test";
import { resolveModel, rewriteBodyModel } from "../src/routing/models.ts";
import { parseBody } from "../src/server/body.ts";
import * as path from "../src/utils/path.ts";

describe("path.modelFromUrl", () => {
  test("extracts model from Gemini-style path", () => {
    expect(path.modelFromUrl("/v1beta/models/gemini-pro:generateContent")).toBe("gemini-pro");
  });

  test("extracts model from streaming path", () => {
    expect(path.modelFromUrl("/v1beta/models/gemini-3-flash-preview:streamGenerateContent")).toBe(
      "gemini-3-flash-preview",
    );
  });

  test("returns null for non-matching path", () => {
    expect(path.modelFromUrl("/v1/messages")).toBeNull();
  });

  test("returns null for empty path", () => {
    expect(path.modelFromUrl("")).toBeNull();
  });

  test("extracts from nested model path", () => {
    expect(path.modelFromUrl("/api/v1beta/models/gemini-pro:generateContent")).toBe("gemini-pro");
  });
});

describe("resolveModel", () => {
  test("strips -api-preview suffix", () => {
    expect(resolveModel("gpt-5.3-codex-api-preview")).toBe("gpt-5.3-codex");
  });

  test("leaves normal models unchanged", () => {
    expect(resolveModel("gpt-5.2-codex")).toBe("gpt-5.2-codex");
    expect(resolveModel("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(resolveModel("gemini-3-pro-preview")).toBe("gemini-3-pro-preview");
  });
});

describe("rewriteBodyModel", () => {
  test("replaces model in body string", () => {
    const parsed = { model: "gpt-5.3-codex-api-preview", stream: true };
    const result = rewriteBodyModel(parsed, "gpt-5.3-codex");
    expect(JSON.parse(result).model).toBe("gpt-5.3-codex");
  });

  test("preserves other fields", () => {
    const parsed = { model: "gpt-5.3-codex-api-preview", messages: [{ role: "user" }], stream: true };
    const result = rewriteBodyModel(parsed, "gpt-5.3-codex");
    const out = JSON.parse(result);
    expect(out.model).toBe("gpt-5.3-codex");
    expect(out.messages).toEqual([{ role: "user" }]);
    expect(out.stream).toBe(true);
  });

  test("does not mutate original parsed object", () => {
    const parsed = { model: "gpt-5.3-codex-api-preview", stream: true };
    rewriteBodyModel(parsed, "gpt-5.3-codex");
    expect(parsed.model).toBe("gpt-5.3-codex-api-preview");
  });
});

describe("parseBody", () => {
  test("extracts model from JSON body", () => {
    const body = parseBody(JSON.stringify({ model: "claude-opus-4-6", stream: true }), "/v1/messages");
    expect(body.ampModel).toBe("claude-opus-4-6");
    expect(body.stream).toBe(true);
    expect(body.forwardBody).toBe(body.raw);
  });

  test("falls back to URL model when body has no model field", () => {
    const body = parseBody(JSON.stringify({ stream: true }), "/v1beta/models/gemini-pro:generateContent");
    expect(body.ampModel).toBe("gemini-pro");
  });

  test("returns null model for empty body", () => {
    const body = parseBody("", "/v1/messages");
    expect(body.ampModel).toBeNull();
    expect(body.stream).toBe(false);
  });

  test("rewrites -api-preview model in forwardBody", () => {
    const raw = JSON.stringify({ model: "gpt-5.3-codex-api-preview", stream: true });
    const body = parseBody(raw, "/v1/chat/completions");
    expect(body.ampModel).toBe("gpt-5.3-codex-api-preview");
    expect(JSON.parse(body.forwardBody).model).toBe("gpt-5.3-codex");
    expect(body.raw).toBe(raw);
  });

  test("handles invalid JSON gracefully", () => {
    const body = parseBody("not json", "/v1/messages");
    expect(body.parsed).toBeNull();
    expect(body.forwardBody).toBe("not json");
  });
});
