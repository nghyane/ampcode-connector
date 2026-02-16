/** Integration test: @google/genai SDK → proxy → Antigravity CCA → response.
 *
 *  Proves the proxy correctly translates between Amp CLI's Vertex AI format
 *  and Cloud Code Assist's /v1internal envelope — using the real SDK and real endpoint.
 *
 *  Forces Antigravity by swapping router order at runtime. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GoogleGenAI } from "@google/genai";
import * as store from "../src/auth/store.ts";
import { provider as antigravity } from "../src/providers/antigravity.ts";
import { provider as gemini } from "../src/providers/gemini.ts";
import * as rewriter from "../src/proxy/rewriter.ts";
import * as path from "../src/utils/path.ts";

let creds: ReturnType<typeof store.get>;

beforeAll(() => {
  creds = store.get("google");
  if (!creds) throw new Error("No google credentials — run `bun run login` first");
});

/** Minimal proxy that forces a specific provider. */
function proxyServer(provider: typeof gemini | typeof antigravity) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const sub = path.subpath(pathname);
      const body = req.method === "POST" ? await req.text() : "";
      const model = path.model(body) ?? path.modelFromUrl(sub);
      const rewrite = model ? rewriter.rewrite(model) : undefined;
      return provider.forward(sub, body, req.headers, rewrite);
    },
  });
}

describe("antigravity provider via @google/genai SDK", () => {
  let server: ReturnType<typeof Bun.serve>;
  let client: InstanceType<typeof GoogleGenAI>;

  beforeAll(() => {
    server = proxyServer(antigravity);
    client = new GoogleGenAI({
      apiKey: "placeholder",
      vertexai: true,
      httpOptions: {
        baseUrl: `http://localhost:${server.port}/api/provider/google`,
        headers: { Authorization: "Bearer test" },
      },
    });
  });

  afterAll(() => server?.stop());

  test("non-streaming generateContent", async () => {
    const result = await client.models.generateContent({
      model: "gemini-3-flash",
      contents: [{ role: "user", parts: [{ text: "Say hi in one word" }] }],
      config: { maxOutputTokens: 500, temperature: 0.1 },
    });

    expect(result.candidates).toBeDefined();
    expect(result.candidates!.length).toBeGreaterThan(0);
    expect(result.text).toBeTruthy();
    expect(result.modelVersion).toContain("gemini");
  });

  test("streaming generateContentStream", async () => {
    const stream = await client.models.generateContentStream({
      model: "gemini-3-flash",
      contents: [{ role: "user", parts: [{ text: "Say hello in one word" }] }],
      config: { maxOutputTokens: 500, temperature: 0.1 },
    });

    let chunks = 0;
    let gotContent = false;
    for await (const chunk of stream) {
      chunks++;
      if (chunk.text) gotContent = true;
    }

    expect(chunks).toBeGreaterThan(0);
    expect(gotContent).toBe(true);
  });
});

describe("direct SDK to CCA rejects Vertex paths", () => {
  test("returns 404 (proves proxy translation is required)", async () => {
    const direct = new GoogleGenAI({
      apiKey: "placeholder",
      vertexai: true,
      httpOptions: {
        baseUrl: "https://cloudcode-pa.googleapis.com",
        headers: { Authorization: `Bearer ${creds!.accessToken}` },
      },
    });

    try {
      await direct.models.generateContent({
        model: "gemini-3-flash",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        config: { maxOutputTokens: 10 },
      });
      throw new Error("Should have thrown");
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(404);
    }
  });
});
