import { describe, expect, test } from "bun:test";
import * as path from "../src/utils/path.ts";

describe("path.model", () => {
  test("extracts model from valid JSON body", () => {
    const body = JSON.stringify({ model: "claude-opus-4-6", stream: true });
    expect(path.model(body)).toBe("claude-opus-4-6");
  });

  test("returns null for missing model field", () => {
    const body = JSON.stringify({ stream: true });
    expect(path.model(body)).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(path.model("not json")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(path.model("")).toBeNull();
  });

  test("extracts OpenAI model", () => {
    const body = JSON.stringify({ model: "gpt-5", messages: [] });
    expect(path.model(body)).toBe("gpt-5");
  });

  test("extracts Gemini model", () => {
    const body = JSON.stringify({ model: "gemini-3-pro-preview" });
    expect(path.model(body)).toBe("gemini-3-pro-preview");
  });
});

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
