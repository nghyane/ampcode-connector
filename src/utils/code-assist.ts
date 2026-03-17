/** Cloud Code Assist request/URL helpers shared by Gemini CLI and Antigravity. */

interface WrapOptions {
  projectId: string;
  model: string;
  body: Record<string, unknown>;
  userAgent: "antigravity" | "pi-coding-agent";
  requestIdPrefix: "agent" | "pi";
  requestType?: "agent";
}

/** Wrap a raw request body in the Cloud Code Assist envelope. */
function wrapRequest(opts: WrapOptions): string {
  return JSON.stringify({
    project: opts.projectId,
    model: opts.model,
    request: opts.body,
    ...(opts.requestType && { requestType: opts.requestType }),
    userAgent: opts.userAgent,
    requestId: `${opts.requestIdPrefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  });
}

/** Build the Cloud Code Assist URL for a given action. Preserves the original action
 *  (generateContent vs streamGenerateContent). Only adds ?alt=sse for streaming actions. */
export function buildUrl(endpoint: string, action: string): string {
  const streaming = action.toLowerCase().includes("stream");
  return `${endpoint}/v1internal:${action}${streaming ? "?alt=sse" : ""}`;
}

/** Unwrap Cloud Code Assist SSE envelope: {"response":{...},"traceId":"..."} → inner response.
 *  Returns empty string for [DONE] sentinel (Google SDK doesn't expect it). */
export function unwrap(data: string): string {
  if (data === "[DONE]") return "";
  try {
    const parsed = JSON.parse(data) as { response?: unknown };
    if (parsed.response !== undefined) return JSON.stringify(parsed.response);
    return data;
  } catch {
    return data;
  }
}

/** Chain CCA unwrap with an optional rewrite function. */
export function withUnwrap(rewrite?: (d: string) => string): (d: string) => string {
  return rewrite ? (d: string) => rewrite(unwrap(d)) : unwrap;
}

/** Ensure every function_response part has a non-empty name.
 *  Gemini API rejects requests where function_response.name is empty.
 *  Uses two strategies:
 *  1. Positional: a model turn with N functionCall parts is followed by a user turn
 *     with N functionResponse parts in the same order — match by index.
 *  2. ID-based fallback: match function_response.id → function_call.id.
 *  Handles both camelCase (functionCall) and snake_case (function_call) keys. */
function fixFunctionResponseNames(body: Record<string, unknown>): void {
  const contents = body.contents;
  if (!Array.isArray(contents)) return;

  type Part = Record<string, unknown>;
  type Content = { role?: string; parts?: Part[] };
  const getFc = (p: Part) => (p.functionCall ?? p.function_call) as Record<string, unknown> | undefined;
  const getFr = (p: Part) => (p.functionResponse ?? p.function_response) as Record<string, unknown> | undefined;

  // Pass 1: positional matching — pair consecutive model/user turns
  for (let i = 0; i < contents.length - 1; i++) {
    const modelTurn = contents[i] as Content;
    const userTurn = contents[i + 1] as Content;
    if (modelTurn.role !== "model" || userTurn.role !== "user") continue;
    if (!Array.isArray(modelTurn.parts) || !Array.isArray(userTurn.parts)) continue;

    const fcParts = modelTurn.parts.filter((p) => getFc(p as Part));
    const frParts = userTurn.parts.filter((p) => getFr(p as Part));
    if (fcParts.length === 0 || fcParts.length !== frParts.length) continue;

    for (let j = 0; j < frParts.length; j++) {
      const fr = getFr(frParts[j] as Part)!;
      if (typeof fr.name === "string" && fr.name) continue;
      const fc = getFc(fcParts[j] as Part)!;
      if (typeof fc.name === "string") {
        fr.name = fc.name;
      }
    }
  }

  // Pass 2: ID-based fallback for any remaining empty names
  const nameById = new Map<string, string>();
  for (const content of contents) {
    const parts = (content as Content)?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const fc = getFc(part as Part);
      if (fc && typeof fc.name === "string" && typeof fc.id === "string") {
        nameById.set(fc.id, fc.name);
      }
    }
  }

  if (nameById.size === 0) return;

  for (const content of contents) {
    const parts = (content as Content)?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const fr = getFr(part as Part);
      if (!fr || (typeof fr.name === "string" && fr.name)) continue;
      const resolved = typeof fr.id === "string" ? nameById.get(fr.id) : undefined;
      if (resolved) {
        fr.name = resolved;
      }
    }
  }
}

/** Wrap body in CCA envelope if not already wrapped. */
export function maybeWrap(
  parsed: Record<string, unknown> | null,
  raw: string,
  projectId: string,
  model: string,
  opts: { userAgent: "antigravity" | "pi-coding-agent"; requestIdPrefix: "agent" | "pi"; requestType?: "agent" },
): string {
  if (!parsed) return raw;
  if (parsed.project) return raw;
  fixFunctionResponseNames(parsed);
  return wrapRequest({ projectId, model, body: parsed, ...opts });
}
